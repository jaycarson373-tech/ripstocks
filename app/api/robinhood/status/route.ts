import { NextResponse } from "next/server";

const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

async function ethCall(rpcUrl: string, to: string, data: string) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Robinhood RPC returned ${response.status}`);
  const payload = await response.json() as { result?: string; error?: { message?: string } };
  if (!payload.result || payload.error) throw new Error(payload.error?.message || "Robinhood RPC call failed");
  return BigInt(payload.result);
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
  const packsLive = process.env.PACKS_LIVE === "true";
  const automation = await automationSnapshot();
  const safe = {
    configured: ADDRESS_PATTERN.test(contract),
    packsLive: false,
    inventoryCount: 0,
    maxPrizeUsd: null as number | null,
    packPriceUsd: 20,
    ...automation,
  };

  if (!safe.configured) return NextResponse.json(safe, { headers: { "Cache-Control": "no-store" } });

  try {
    const rpcUrl = process.env.ROBINHOOD_RPC_URL || DEFAULT_RPC;
    const [inventory, maxPrize, packPrice] = await Promise.all([
      ethCall(rpcUrl, contract, "0x5b98c83d"),
      ethCall(rpcUrl, contract, "0x91d5116f"),
      ethCall(rpcUrl, contract, "0x335c8b63"),
    ]);
    return NextResponse.json({
      configured: true,
      packsLive: packsLive && inventory > BigInt(0),
      inventoryCount: Number(inventory),
      maxPrizeUsd: Number(maxPrize) / 1_000_000,
      packPriceUsd: Number(packPrice) / 1_000_000,
      ...automation,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(safe, { headers: { "Cache-Control": "no-store" } });
  }
}
