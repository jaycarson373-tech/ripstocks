import { NextResponse } from "next/server";
import { STOCK_TOKEN_BY_ADDRESS } from "@/app/lib/stock-tokens";

const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const PRIZE_DELIVERED_TOPIC = "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656";
const MAX_LOOKBACK_BLOCKS = BigInt(95_000);

type RpcEnvelope<T> = { id?: number; result?: T; error?: { message?: string } };
type RpcLog = {
  address: string;
  blockNumber: string;
  transactionHash: string;
  topics: string[];
  data: string;
};
type RpcBlock = { timestamp?: string };

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Robinhood RPC returned ${response.status}`);
  const payload = await response.json() as RpcEnvelope<T>;
  if (payload.result === undefined || payload.error) throw new Error(payload.error?.message || "Robinhood RPC request failed");
  return payload.result;
}

async function rpcBatch<T>(rpcUrl: string, calls: Array<{ method: string; params: unknown[] }>) {
  if (!calls.length) return [];
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calls.map((call, id) => ({ jsonrpc: "2.0", id, ...call }))),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Robinhood RPC returned ${response.status}`);
  const payload = await response.json() as RpcEnvelope<T>[];
  if (!Array.isArray(payload) || payload.length !== calls.length || payload.some((item) => item.result === undefined || item.error)) throw new Error("Robinhood RPC batch failed");
  return payload.sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).map((item) => item.result as T);
}

function decodePull(log: RpcLog) {
  if (log.topics.length < 4) throw new Error("Malformed prize event");
  const data = log.data.replace(/^0x/, "");
  if (data.length < 128) throw new Error("Malformed prize event data");
  const stockAddress = `0x${log.topics[3].slice(-40)}`.toLowerCase();
  const stock = STOCK_TOKEN_BY_ADDRESS.get(stockAddress);
  if (!stock) return null;
  return {
    requestId: BigInt(log.topics[1]).toString(),
    wallet: `0x${log.topics[2].slice(-40)}`,
    symbol: stock.symbol,
    name: stock.name,
    tokenAmount: BigInt(`0x${data.slice(0, 64)}`),
    valueUsd: Number(BigInt(`0x${data.slice(64, 128)}`)) / 1_000_000,
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };
}

function formatUnits(value: bigint, decimals = 18) {
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, 8);
  return fraction ? `${whole}.${fraction}` : whole;
}

export async function GET(request: Request) {
  const contract = (process.env.NEXT_PUBLIC_STONKRIPS_CONTRACT || "").trim();
  if (!ADDRESS_PATTERN.test(contract)) {
    return NextResponse.json({ configured: false, pulls: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const rpcUrl = process.env.ROBINHOOD_RPC_URL || DEFAULT_RPC;
    const walletParam = new URL(request.url).searchParams.get("wallet")?.trim() || "";
    const wallet = ADDRESS_PATTERN.test(walletParam) ? walletParam.toLowerCase() : null;
    const launchRequestId = /^\d+$/.test(process.env.PUBLIC_LAUNCH_REQUEST_ID || "")
      ? BigInt(process.env.PUBLIC_LAUNCH_REQUEST_ID as string)
      : BigInt(1);
    const resultLimit = wallet ? 100 : 12;
    const topics = wallet ? [PRIZE_DELIVERED_TOPIC, null, `0x${wallet.slice(2).padStart(64, "0")}`] : [PRIZE_DELIVERED_TOPIC];
    const latest = BigInt(await rpc<string>(rpcUrl, "eth_blockNumber", []));
    const configuredStart = process.env.PACK_CONTRACT_START_BLOCK;
    const lookbackFloor = latest > MAX_LOOKBACK_BLOCKS ? latest - MAX_LOOKBACK_BLOCKS : BigInt(0);
    const requestedStart = configuredStart && /^\d+$/.test(configuredStart) ? BigInt(configuredStart) : lookbackFloor;
    const minimum = requestedStart > lookbackFloor ? requestedStart : lookbackFloor;
    const logs = await rpc<RpcLog[]>(rpcUrl, "eth_getLogs", [{
      address: contract,
      topics,
      fromBlock: `0x${minimum.toString(16)}`,
      toBlock: `0x${latest.toString(16)}`,
    }]);

    const decoded = logs
      .map(decodePull)
      .filter((pull): pull is NonNullable<typeof pull> => Boolean(pull))
      .filter((pull) => BigInt(pull.requestId) >= launchRequestId)
      .sort((a, b) => (BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1))
      .slice(0, resultLimit);
    const blockNumbers = [...new Set(decoded.map((pull) => pull.blockNumber))];
    const blocks = await rpcBatch<RpcBlock>(rpcUrl, blockNumbers.map((number) => ({ method: "eth_getBlockByNumber", params: [number, false] })));
    const timestamps = new Map(blockNumbers.map((number, index) => [number, blocks[index]?.timestamp ? Number(BigInt(blocks[index].timestamp as string)) * 1_000 : null]));
    return NextResponse.json({
      configured: true,
      pulls: decoded.map((pull) => ({
        requestId: pull.requestId,
        wallet: pull.wallet,
        symbol: pull.symbol,
        name: pull.name,
        tokenAmount: formatUnits(pull.tokenAmount),
        valueUsd: pull.valueUsd,
        transactionHash: pull.transactionHash,
        timestamp: timestamps.get(pull.blockNumber) || null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { configured: true, pulls: [], error: "RECENT_PULLS_UNAVAILABLE" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
