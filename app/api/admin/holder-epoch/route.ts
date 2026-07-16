import { randomInt } from "node:crypto";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { authorized } from "@/lib/automation-auth";
import { AIRDROP_INTERVAL_MS } from "@/lib/protocol";
import { keypairEnv, publicKeyEnv, requiredEnv, rpcUrl, supabase } from "@/lib/server-config";

export const dynamic="force-dynamic";

type HolderLot = {
  id: string;
  symbol: string;
  mint: string;
  token_amount: string;
  decimals: number;
  token_program: string;
  purchase_value: number | string;
};

type HolderEpoch = {
  id: number;
  winner_wallet: string | null;
  eligible_holders: number | null;
  status: string;
  transaction_signature: string | null;
};

async function jsonBody<T>(response: Response) {
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function eligibleHolders(){
  const mint=requiredEnv("HOLDER_TOKEN_MINT");
  const excluded=new Set([process.env.MAIN_TREASURY_WALLET,process.env.HOLDER_AIRDROP_WALLET].filter(Boolean));
  const holders=new Set<string>();
  let cursor:string|undefined;
  for(let page=0;page<10;page++){
    const response=await fetch(rpcUrl(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:`holders-${page}`,method:"getTokenAccounts",params:{mint,limit:1000,...(cursor?{cursor}:{})}}),cache:"no-store"});
    if(!response.ok)throw new Error(`Holder snapshot failed: ${await response.text()}`);
    const payload=await response.json() as {result?:{token_accounts?:Array<{owner:string;amount:number}>;cursor?:string};error?:{message:string}};
    if(payload.error)throw new Error(payload.error.message);
    for(const account of payload.result?.token_accounts||[])if(Number(account.amount)>0&&!excluded.has(account.owner))holders.add(account.owner);
    cursor=payload.result?.cursor;
    if(!cursor)break;
  }
  return [...holders];
}

async function availableHolderLots(limit=50) {
  const response=await supabase(`airdrop_inventory_lots?select=id,symbol,mint,token_amount,decimals,token_program,purchase_value&status=eq.available&limit=${limit}`);
  if(!response.ok)throw new Error(`Could not read holder inventory: ${await response.text()}`);
  return await jsonBody<HolderLot[]>(response) || [];
}

async function reservedHolderLot(epochId:number) {
  const response=await supabase(`airdrop_inventory_lots?select=id,symbol,mint,token_amount,decimals,token_program,purchase_value&epoch_id=eq.${epochId}&status=eq.reserved&limit=1`);
  if(!response.ok)throw new Error(`Could not read reserved holder inventory: ${await response.text()}`);
  return ((await jsonBody<HolderLot[]>(response)) || [])[0] || null;
}

async function reserveAvailableLotForEpoch(epochId:number,lots?:HolderLot[]) {
  lots = lots || await availableHolderLots();
  for(let attempt=0;attempt<Math.min(lots.length,8);attempt++){
    const lot=lots[randomInt(lots.length)];
    const reserved=await supabase(`airdrop_inventory_lots?id=eq.${encodeURIComponent(lot.id)}&status=eq.available`,{
      method:"PATCH",
      body:JSON.stringify({status:"reserved",epoch_id:epochId})
    });
    if(reserved.ok&&((await jsonBody<HolderLot[]>(reserved))||[]).length)return lot;
  }
  return null;
}

async function reserveAirdropLot(epochId:number,winner:string,eligibleCount:number){
  const existing=await supabase(`airdrop_epochs?select=id,winner_wallet,eligible_holders,status,transaction_signature&id=eq.${epochId}&limit=1`);
  if(!existing.ok)throw new Error(`Could not check holder epoch: ${await existing.text()}`);
  const [epoch]=await jsonBody<HolderEpoch[]>(existing) || [];
  if(epoch?.transaction_signature||epoch?.status==="distributed")return {skipped:"This holder-drop epoch is already distributed."};
  if(epoch){
    const lot=await reservedHolderLot(epochId) || await reserveAvailableLotForEpoch(epochId);
    if(!lot)return {skipped:"No holder inventory available"};
    return {lot,winner:epoch.winner_wallet||winner,eligibleCount:epoch.eligible_holders||eligibleCount,resumed:true};
  }

  const lots=await availableHolderLots();
  if(!lots.length)return {skipped:"No holder inventory available"};

  const startsAt=new Date(epochId*AIRDROP_INTERVAL_MS).toISOString();
  const endsAt=new Date((epochId+1)*AIRDROP_INTERVAL_MS).toISOString();
  const created=await supabase("airdrop_epochs",{
    method:"POST",
    headers:{Prefer:"resolution=ignore-duplicates,return=representation"},
    body:JSON.stringify({id:epochId,starts_at:startsAt,ends_at:endsAt,snapshot_at:new Date().toISOString(),eligible_holders:eligibleCount,winner_wallet:winner,status:"snapshotted"})
  });
  if(!created.ok)throw new Error(`Could not create holder epoch: ${await created.text()}`);
  if(!(await jsonBody<Array<{id:number}>>(created))?.length)return {skipped:"This holder-drop epoch is already recorded."};

  const lot=await reserveAvailableLotForEpoch(epochId,lots);
  if(lot)return {lot,winner,eligibleCount};

  await supabase(`airdrop_epochs?id=eq.${epochId}`,{method:"DELETE"});
  return {skipped:"No holder inventory available"};
}

export async function POST(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const body=await request.json().catch(()=>({})) as {dryRun?:boolean};
    const signer=keypairEnv("HOLDER_AIRDROP_SIGNER_SECRET");
    const wallet=publicKeyEnv("HOLDER_AIRDROP_WALLET");
    if(!signer.publicKey.equals(wallet))throw new Error("Holder signer does not match configured wallet");
    const epochId=Math.floor(Date.now()/AIRDROP_INTERVAL_MS);
    const holders=await eligibleHolders();
    if(body.dryRun){
      const lots=await availableHolderLots();
      return Response.json({ok:true,dryRun:true,epochId,eligibleHolders:holders.length,holderPacksAvailable:lots.length,nextDropAt:new Date((epochId+1)*AIRDROP_INTERVAL_MS).toISOString()});
    }
    if(!holders.length)return Response.json({ok:true,skipped:"No eligible holders in the synchronized snapshot",epochId});
    const winner=holders[randomInt(holders.length)];
    const reserved=await reserveAirdropLot(epochId,winner,holders.length);
    if("skipped" in reserved)return Response.json({ok:true,skipped:reserved.skipped,epochId});
    const lot=reserved.lot;
    const payoutWinner=reserved.winner;
    const connection=new Connection(rpcUrl(),"confirmed");
    const mint=new PublicKey(lot.mint); const program=new PublicKey(lot.token_program); const owner=new PublicKey(payoutWinner);
    const from=getAssociatedTokenAddressSync(mint,wallet,false,program); const to=getAssociatedTokenAddressSync(mint,owner,false,program);
    const transaction=new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(wallet,to,owner,mint,program),createTransferCheckedInstruction(from,mint,to,wallet,BigInt(lot.token_amount),lot.decimals,[],program));
    const signature=await connection.sendTransaction(transaction,[signer],{skipPreflight:false,maxRetries:3});
    const confirmation=await connection.confirmTransaction(signature,"confirmed");
    if(confirmation.value.err)throw new Error(`Holder payout ${signature} failed`);
    const complete=await supabase("rpc/complete_airdrop_epoch",{method:"POST",body:JSON.stringify({p_epoch_id:epochId,p_lot_id:lot.id,p_signature:signature})});
    if(!complete.ok)throw new Error(`Payout confirmed, but proof recording needs reconciliation: ${await complete.text()}`);
    return Response.json({ok:true,epochId,eligibleHolders:reserved.eligibleCount,winner:payoutWinner,symbol:lot.symbol,value:Number(lot.purchase_value),signature,resumed:"resumed" in reserved});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Holder epoch failed"},{status:503})}
}
