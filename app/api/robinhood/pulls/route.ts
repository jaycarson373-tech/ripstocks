import { NextResponse } from "next/server";
import { STOCK_TOKEN_BY_ADDRESS } from "@/app/lib/stock-tokens";

const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const PRIZE_DELIVERED_TOPIC = "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656";
const BLOCK_WINDOW = BigInt(9_500);
const MAX_WINDOWS = 10;

type RpcEnvelope<T> = { result?: T; error?: { message?: string } };
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

function decodePull(log: RpcLog) {
  if (log.topics.length < 4) throw new Error("Malformed prize event");
  const data = log.data.replace(/^0x/, "");
  if (data.length < 128) throw new Error("Malformed prize event data");
  const stockAddress = `0x${log.topics[3].slice(-40)}`.toLowerCase();
  const stock = STOCK_TOKEN_BY_ADDRESS.get(stockAddress);
  if (!stock) return null;
  return {
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

export async function GET() {
  const contract = (process.env.NEXT_PUBLIC_STONKRIPS_CONTRACT || "").trim();
  if (!ADDRESS_PATTERN.test(contract)) {
    return NextResponse.json({ configured: false, pulls: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const rpcUrl = process.env.ROBINHOOD_RPC_URL || DEFAULT_RPC;
    const latest = BigInt(await rpc<string>(rpcUrl, "eth_blockNumber", []));
    const configuredStart = process.env.PACK_CONTRACT_START_BLOCK;
    const minimum = configuredStart && /^\d+$/.test(configuredStart) ? BigInt(configuredStart) : latest > BLOCK_WINDOW * BigInt(MAX_WINDOWS) ? latest - BLOCK_WINDOW * BigInt(MAX_WINDOWS) : BigInt(0);
    const logs: RpcLog[] = [];
    let toBlock = latest;
    for (let window = 0; window < MAX_WINDOWS && toBlock >= minimum && logs.length < 12; window += 1) {
      const fromBlock = toBlock > BLOCK_WINDOW ? toBlock - BLOCK_WINDOW + BigInt(1) : BigInt(0);
      const boundedFrom = fromBlock < minimum ? minimum : fromBlock;
      const batch = await rpc<RpcLog[]>(rpcUrl, "eth_getLogs", [{
        address: contract,
        topics: [PRIZE_DELIVERED_TOPIC],
        fromBlock: `0x${boundedFrom.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      }]);
      logs.push(...batch);
      if (boundedFrom === BigInt(0) || boundedFrom === minimum) break;
      toBlock = boundedFrom - BigInt(1);
    }

    const decoded = logs
      .map(decodePull)
      .filter((pull): pull is NonNullable<typeof pull> => Boolean(pull))
      .sort((a, b) => (BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1))
      .slice(0, 12);
    const blockNumbers = [...new Set(decoded.map((pull) => pull.blockNumber))];
    const blocks = await Promise.all(blockNumbers.map((number) => rpc<RpcBlock>(rpcUrl, "eth_getBlockByNumber", [number, false])));
    const timestamps = new Map(blockNumbers.map((number, index) => [number, blocks[index]?.timestamp ? Number(BigInt(blocks[index].timestamp as string)) * 1_000 : null]));
    return NextResponse.json({
      configured: true,
      pulls: decoded.map((pull) => ({
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
