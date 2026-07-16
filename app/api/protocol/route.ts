import { NextResponse } from "next/server";
import { calculatePackEv, emptySnapshot, HOLDER_DROP_PACK_BUDGET_USD, synchronizedEpochEndsAt, type ProtocolSnapshot } from "@/lib/protocol";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json(emptySnapshot(), { headers: { "Cache-Control": "no-store" } });
  const response = await fetch(`${url}/rest/v1/rpc/protocol_public_snapshot`, { method:"POST", headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"}, body:"{}", cache:"no-store" });
  if (!response.ok) return NextResponse.json(emptySnapshot(), { status: 200, headers: { "Cache-Control": "no-store" } });
  const row = await response.json() as Partial<ProtocolSnapshot>;
  const snapshot = { ...emptySnapshot(), ...row, serverNow:new Date().toISOString(), epochEndsAt:synchronizedEpochEndsAt().toISOString() };
  snapshot.currentPackEv = calculatePackEv(Number(snapshot.remainingStockInventory), Number(snapshot.packsRemaining));
  snapshot.nextHolderPackValue = Number(snapshot.holderAirdropTreasury) >= HOLDER_DROP_PACK_BUDGET_USD ? HOLDER_DROP_PACK_BUDGET_USD : 0;
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
