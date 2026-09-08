import { NextResponse } from "next/server";
import { decodeFunctionResult, encodeFunctionData, encodePacked, keccak256, parseAbi } from "viem";
import { STOCK_TOKEN_BY_ADDRESS } from "@/app/lib/stock-tokens";

const DELIVERED = "0xc69fc309161aff2ea1fca64cb7735c168e84ea865b4e3683d8f84b742339d656";
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
type Log = { topics: string[]; data: string; transactionHash: string; removed?: boolean };
const packAbi = parseAbi([
  "function requests(uint256) view returns (address,bytes32,bytes32,uint256,bool)",
  "function inventoryCount() view returns (uint256)",
  "function prizeAt(uint256) view returns (address,uint256,uint256)",
]);

function tokenAmountFromAtoms(amount: bigint) {
  const atoms = amount.toString().padStart(19, "0");
  const fraction = atoms.slice(-18).replace(/0+$/, "");
  return `${atoms.slice(0, -18)}${fraction ? `.${fraction}` : ""}`;
}

async function rpc<T>(method: string, params: unknown[]) {
  const response = await fetch(process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(5_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("RPC_UNAVAILABLE");
  const value = await response.json() as { result?: T; error?: unknown };
  if (value.error || value.result === undefined) throw new Error("RPC_UNAVAILABLE");
  return value.result;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const id = query.get("requestId") || "";
  const buyer = query.get("buyer") || "";
  const from = query.get("fromBlock") || "";
  const contract = (process.env.NEXT_PUBLIC_STONKRIPS_CONTRACT || "").trim();
  const headers = { "Cache-Control": "no-store" };
  if (!addressPattern.test(contract) || !addressPattern.test(buyer) || !/^[1-9]\d{0,76}$/.test(id) || !/^\d{1,20}$/.test(from)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  }
  try {
    const latest = BigInt(await rpc<string>("eth_blockNumber", []));
    const requestData = encodeFunctionData({ abi: packAbi, functionName: "requests", args: [BigInt(id)] });
    const requestResult = await rpc<string>("eth_call", [{ to: contract, data: requestData }, "latest"]);
    const [requestBuyer, commitment, fallbackSeed, entropyBlock, settled] = decodeFunctionResult({ abi: packAbi, functionName: "requests", data: requestResult as `0x${string}` });
    if (requestBuyer.toLowerCase() !== buyer.toLowerCase()) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers });

    // The inventory is locked for the lifetime of an active request. Reproduce
    // the contract's exact index from its committed future block, then read the
    // locked prize. This is read-only, starts the reel before delivery, and can
    // neither choose nor reroll the result.
    if (!settled && latest > entropyBlock) {
      let entropy = fallbackSeed;
      if (latest <= entropyBlock + BigInt(256)) {
        const entropySource = await rpc<{ hash?: `0x${string}` }>("eth_getBlockByNumber", [`0x${entropyBlock.toString(16)}`, false]);
        if (!entropySource.hash) throw new Error("ENTROPY_UNAVAILABLE");
        entropy = entropySource.hash;
      }
      const countData = encodeFunctionData({ abi: packAbi, functionName: "inventoryCount" });
      const countResult = await rpc<string>("eth_call", [{ to: contract, data: countData }, "latest"]);
      const inventoryCount = decodeFunctionResult({ abi: packAbi, functionName: "inventoryCount", data: countResult as `0x${string}` });
      if (inventoryCount <= BigInt(0)) throw new Error("INVENTORY_UNAVAILABLE");
      const index = BigInt(keccak256(encodePacked(
        ["bytes32", "bytes32", "address", "uint256", "address"],
        [commitment, entropy, requestBuyer, BigInt(id), contract as `0x${string}`],
      ))) % inventoryCount;
      const prizeData = encodeFunctionData({ abi: packAbi, functionName: "prizeAt", args: [index] });
      const prizeResult = await rpc<string>("eth_call", [{ to: contract, data: prizeData }, "latest"]);
      const [token, tokenAtoms, declaredUsdMicros] = decodeFunctionResult({ abi: packAbi, functionName: "prizeAt", data: prizeResult as `0x${string}` });
      const stock = STOCK_TOKEN_BY_ADDRESS.get(token.toLowerCase());
      if (!stock) throw new Error("UNKNOWN_STOCK");
      return NextResponse.json({ outcome: {
        requestId: id, wallet: buyer.toLowerCase(), symbol: stock.symbol, name: stock.name,
        tokenAmount: tokenAmountFromAtoms(tokenAtoms), valueUsd: Number(declaredUsdMicros) / 1_000_000,
      }, delivered: null }, { headers });
    }

    if (!settled) return NextResponse.json({ outcome: null, delivered: null }, { headers });
    const floor = latest > BigInt(95_000) ? latest - BigInt(95_000) : BigInt(0);
    const start = BigInt(from) > floor ? BigInt(from) : floor;
    if (start > latest) return NextResponse.json({ outcome: null, delivered: null }, { headers });
    const logs = await rpc<Log[]>("eth_getLogs", [{ address: contract, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${latest.toString(16)}`, topics: [DELIVERED, `0x${BigInt(id).toString(16).padStart(64, "0")}`, `0x${buyer.slice(2).toLowerCase().padStart(64, "0")}`] }]);
    const log = logs.find(item => !item.removed && item.topics.length === 4 && item.data.length >= 130);
    if (!log) return NextResponse.json({ outcome: null, delivered: null }, { headers });
    const stock = STOCK_TOKEN_BY_ADDRESS.get(`0x${log.topics[3].slice(-40)}`.toLowerCase());
    if (!stock) throw new Error("UNKNOWN_STOCK");
    const data = log.data.slice(2);
    const deliveredResult = {
      requestId: id, wallet: buyer.toLowerCase(), symbol: stock.symbol, name: stock.name,
      tokenAmount: tokenAmountFromAtoms(BigInt(`0x${data.slice(0, 64)}`)), valueUsd: Number(BigInt(`0x${data.slice(64, 128)}`)) / 1_000_000,
      transactionHash: log.transactionHash,
    };
    return NextResponse.json({ outcome: deliveredResult, delivered: deliveredResult }, { headers });
  } catch { return NextResponse.json({ error: "DELIVERY_CHECK_UNAVAILABLE" }, { status: 502, headers }); }
}
