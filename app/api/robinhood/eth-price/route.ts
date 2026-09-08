import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("ETH price unavailable");
    const payload = await response.json() as { data?: { amount?: string } };
    const ethUsd = Number(payload.data?.amount);
    if (!Number.isFinite(ethUsd) || ethUsd <= 0) throw new Error("Invalid ETH price");
    return NextResponse.json({ ethUsd }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "GAS_PRICE_CHECK_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
