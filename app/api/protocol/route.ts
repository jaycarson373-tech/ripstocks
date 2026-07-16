import { NextResponse } from "next/server";
import { calculatePackEv, emptySnapshot, synchronizedEpochEndsAt, type ProtocolSnapshot } from "@/lib/protocol";

export const dynamic = "force-dynamic";

async function rest<T>(url:string,key:string,path:string):Promise<T[]>{
  const response=await fetch(`${url}/rest/v1/${path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},cache:"no-store"});
  return response.ok?await response.json() as T[]:[];
}

export async function GET() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json(emptySnapshot(), { headers: { "Cache-Control": "no-store" } });
  const response = await fetch(`${url}/rest/v1/rpc/protocol_public_snapshot`, { method:"POST", headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"}, body:"{}", cache:"no-store" });
  if (!response.ok) return NextResponse.json(emptySnapshot(), { status: 200, headers: { "Cache-Control": "no-store" } });
  const row = await response.json() as Partial<ProtocolSnapshot>;
  const snapshot = { ...emptySnapshot(), ...row, serverNow:new Date().toISOString(), epochEndsAt:synchronizedEpochEndsAt().toISOString() };
  const [mainLogs,holderLogs,holderInventory]=await Promise.all([
    rest<{created_at:string;usd_value:number;acquisition_signature:string}>(url,key,"inventory_lots?select=created_at,usd_value,acquisition_signature&order=created_at.desc&limit=8"),
    rest<{created_at:string;purchase_value:number;acquisition_signature:string}>(url,key,"airdrop_inventory_lots?select=created_at,purchase_value,acquisition_signature&order=created_at.desc&limit=8"),
    rest<{purchase_value:number}>(url,key,"airdrop_inventory_lots?select=purchase_value&status=eq.available"),
  ]);
  const holderInventoryValue=holderInventory.reduce((sum,lot)=>sum+Number(lot.purchase_value),0);
  snapshot.inventoryLogs=[
    ...mainLogs.map(log=>({source:"Main Treasury",message:"Another paid-pack inventory lot bought",count:1,value:Number(log.usd_value),time:log.created_at,signature:log.acquisition_signature})),
    ...holderLogs.map(log=>({source:"Holder Wallet",message:"Another holder-drop pack bought",count:1,value:Number(log.purchase_value),time:log.created_at,signature:log.acquisition_signature})),
  ].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)).slice(0,8);
  snapshot.currentPackEv = calculatePackEv(Number(snapshot.remainingStockInventory), Number(snapshot.packsRemaining));
  snapshot.holderAirdropTreasury = Number(snapshot.holderAirdropTreasury) + holderInventoryValue;
  snapshot.averageHolderDropValue = Number(snapshot.totalHolderDrops) > 0 ? Number(snapshot.totalValueAirdropped) / Number(snapshot.totalHolderDrops) : calculatePackEv(holderInventoryValue, Number(snapshot.holderPacksAvailable));
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
