import { NextResponse } from "next/server";
import { STOCK_TOKENS, STOCK_TOKEN_BY_ADDRESS } from "@/app/lib/stock-tokens";

const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const INVENTORY_COUNT_SELECTOR = "0x5b98c83d";
const INVENTORY_VALUE_SELECTOR = "0xcba71e93";
const PACK_PRICE_SELECTOR = "0x335c8b63";
const PACKS_ENABLED_SELECTOR = "0xc4de49c7";
const PRIZE_AT_SELECTOR = "0xe0a35431";

type RpcResponse = { id: number; result?: string; error?: { message?: string } };

function word(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

function formatUnits(value: bigint, decimals = 18) {
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, 8);
  return fraction ? `${whole}.${fraction}` : whole;
}

async function rpc(rpcUrl: string, method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Robinhood RPC returned ${response.status}`);
  const payload = await response.json() as RpcResponse;
  if (!payload.result || payload.error) throw new Error(payload.error?.message || "Robinhood RPC call failed");
  return payload.result;
}

async function ethCall(rpcUrl: string, to: string, data: string) {
  return BigInt(await rpc(rpcUrl, "eth_call", [{ to, data }, "latest"]));
}

async function prizeCalls(rpcUrl: string, contract: string, count: number) {
  if (count === 0) return [];
  if (count > 500) throw new Error("Inventory is too large for the public snapshot endpoint");
  const body = Array.from({ length: count }, (_, index) => ({
    jsonrpc: "2.0",
    id: index,
    method: "eth_call",
    params: [{ to: contract, data: `${PRIZE_AT_SELECTOR}${word(BigInt(index))}` }, "latest"],
  }));
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Robinhood RPC batch returned ${response.status}`);
  const payload = await response.json() as RpcResponse[];
  if (!Array.isArray(payload) || payload.some((item) => !item.result || item.error)) {
    throw new Error("Robinhood RPC inventory batch failed");
  }
  return payload.sort((a, b) => a.id - b.id).map((item) => item.result as string);
}

function decodePrize(encoded: string) {
  const value = encoded.replace(/^0x/, "");
  if (value.length < 192) throw new Error("Invalid prize response");
  return {
    tokenAddress: `0x${value.slice(24, 64)}`.toLowerCase(),
    tokenAmount: BigInt(`0x${value.slice(64, 128)}`),
    loadedValueMicros: BigInt(`0x${value.slice(128, 192)}`),
  };
}

async function liveValuations(amounts: Map<string, bigint>) {
  const symbols = STOCK_TOKENS.filter((stock) => amounts.has(stock.address.toLowerCase()));
  if (!symbols.length) return new Map<string, number>();
  try {
    const [assetsResponse, ...priceResponses] = await Promise.all([
      fetch("https://api.robinhood.com/rhj/assets", { next: { revalidate: 300 } }),
      ...symbols.map((stock) => fetch(`https://api.robinhood.com/rhj/prices/${stock.symbol}`, { next: { revalidate: 60 } })),
    ]);
    if (!assetsResponse.ok || priceResponses.some((response) => !response.ok)) return new Map<string, number>();
    const assetsPayload = await assetsResponse.json() as { assets?: Array<{ tokenSymbol?: string; currentMultiplier?: string }> };
    const multipliers = new Map((assetsPayload.assets || []).map((asset) => [asset.tokenSymbol, Number(asset.currentMultiplier || "1")]));
    const prices = await Promise.all(priceResponses.map((response) => response.json() as Promise<{ quotes?: Array<{ tokenSymbol?: string; bid?: string; isTradingHalt?: boolean }> }>));
    const values = new Map<string, number>();
    symbols.forEach((stock, index) => {
      const quote = prices[index].quotes?.find((item) => item.tokenSymbol === stock.symbol);
      const amount = amounts.get(stock.address.toLowerCase());
      if (!amount || !quote?.bid || quote.isTradingHalt) return;
      const value = Number(formatUnits(amount)) * Number(quote.bid) * (multipliers.get(stock.symbol) || 1);
      if (Number.isFinite(value)) values.set(stock.address.toLowerCase(), value);
    });
    return values;
  } catch {
    return new Map<string, number>();
  }
}

async function automationSnapshot() {
  const automationLive = process.env.AUTOMATION_PUBLIC_LIVE === "true";
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const fallback = { automationLive, completedEpochs: null as number | null, lastEpochStatus: null as string | null };
  if (!supabaseUrl || !serviceKey) return fallback;
  try {
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "count=exact" };
    const [latestResponse, countResponse] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/pons_epochs?select=status&order=epoch_key.desc&limit=1`, { headers, cache: "no-store" }),
      fetch(`${supabaseUrl}/rest/v1/pons_epochs?select=id&status=eq.complete&limit=1`, { headers, cache: "no-store" }),
    ]);
    if (!latestResponse.ok || !countResponse.ok) return fallback;
    const latest = await latestResponse.json() as Array<{ status?: string }>;
    const range = countResponse.headers.get("content-range") || "";
    const total = Number.parseInt(range.split("/")[1] || "", 10);
    return {
      automationLive,
      completedEpochs: Number.isFinite(total) ? total : null,
      lastEpochStatus: latest[0]?.status || null,
    };
  } catch {
    return fallback;
  }
}

export async function GET() {
  const contract = (process.env.NEXT_PUBLIC_STONKRIPS_CONTRACT || "").trim();
  const publicGateEnabled = process.env.PACKS_LIVE === "true";
  const automation = await automationSnapshot();
  const safe = {
    configured: ADDRESS_PATTERN.test(contract),
    packsLive: false,
    operatorEnabled: false,
    inventoryCount: 0,
    inventoryValueUsd: null as number | null,
    maxPrizeUsd: null as number | null,
    packPriceUsd: 20,
    inventory: [] as Array<{
      symbol: string;
      tokenAmount: string;
      loadedValueUsd: number;
      currentValueUsd: number | null;
      fundedPulls: number;
      probabilityPct: number;
    }>,
    inventoryDataAvailable: false,
    ...automation,
  };

  if (!safe.configured) return NextResponse.json(safe, { headers: { "Cache-Control": "no-store" } });

  try {
    const rpcUrl = process.env.ROBINHOOD_RPC_URL || DEFAULT_RPC;
    const [inventoryRaw, inventoryValue, packPrice, onchainEnabled] = await Promise.all([
      ethCall(rpcUrl, contract, INVENTORY_COUNT_SELECTOR),
      ethCall(rpcUrl, contract, INVENTORY_VALUE_SELECTOR),
      ethCall(rpcUrl, contract, PACK_PRICE_SELECTOR),
      ethCall(rpcUrl, contract, PACKS_ENABLED_SELECTOR),
    ]);
    const inventoryCount = Number(inventoryRaw);
    const decoded = (await prizeCalls(rpcUrl, contract, inventoryCount)).map(decodePrize);
    const grouped = new Map<string, { tokenAmount: bigint; loadedValueMicros: bigint; fundedPulls: number }>();
    for (const prize of decoded) {
      const current = grouped.get(prize.tokenAddress) || { tokenAmount: BigInt(0), loadedValueMicros: BigInt(0), fundedPulls: 0 };
      current.tokenAmount += prize.tokenAmount;
      current.loadedValueMicros += prize.loadedValueMicros;
      current.fundedPulls += 1;
      grouped.set(prize.tokenAddress, current);
    }
    const amounts = new Map([...grouped].map(([address, item]) => [address, item.tokenAmount]));
    const valuations = await liveValuations(amounts);
    const inventory = [...grouped].flatMap(([address, item]) => {
      const stock = STOCK_TOKEN_BY_ADDRESS.get(address);
      if (!stock) return [];
      return [{
        symbol: stock.symbol,
        tokenAmount: formatUnits(item.tokenAmount),
        loadedValueUsd: Number(item.loadedValueMicros) / 1_000_000,
        currentValueUsd: valuations.get(address) ?? null,
        fundedPulls: item.fundedPulls,
        probabilityPct: inventoryCount ? (item.fundedPulls / inventoryCount) * 100 : 0,
      }];
    });
    const maxPrizeUsd = decoded.reduce((max, prize) => prize.loadedValueMicros > max ? prize.loadedValueMicros : max, BigInt(0));
    const operatorEnabled = publicGateEnabled && onchainEnabled !== BigInt(0);
    return NextResponse.json({
      configured: true,
      packsLive: operatorEnabled && inventoryCount > 0,
      operatorEnabled,
      inventoryCount,
      inventoryValueUsd: Number(inventoryValue) / 1_000_000,
      maxPrizeUsd: Number(maxPrizeUsd) / 1_000_000,
      packPriceUsd: Number(packPrice) / 1_000_000,
      inventory,
      inventoryDataAvailable: true,
      ...automation,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(safe, { headers: { "Cache-Control": "no-store" } });
  }
}
