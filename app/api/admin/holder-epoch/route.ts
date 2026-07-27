import { createHash, randomInt } from "node:crypto";
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

type HolderTicket = { owner:string; amountAtoms:bigint; tickets:bigint };
type FairDraw = { winner:string; eligibleHolders:number; totalTickets:bigint; winningTicket:bigint; randomSeed:string; randomSource:string; holderHash:string };

async function jsonBody<T>(response: Response) {
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

function sha256(input:string) {
  return createHash("sha256").update(input).digest("hex");
}

function holderTicketAtoms() {
  const decimals=Number(process.env.STOCKDROPS_TOKEN_DECIMALS||process.env.HOLDER_TOKEN_DECIMALS||6);
  const tokens=Number(process.env.HOLDER_TICKET_TOKENS||250_000);
  return BigInt(Math.trunc(tokens * 10 ** decimals));
}

function amountToAtoms(amount:string|number,decimals:number) {
  const raw=String(amount||"0");
  if(!raw.includes("."))return BigInt(raw);
  return BigInt(Math.floor(Number(raw) * 10 ** decimals));
}

async function eligibleHolders(){
  const mint=requiredEnv("HOLDER_TOKEN_MINT");
  const excluded=new Set([process.env.MAIN_TREASURY_WALLET,process.env.HOLDER_AIRDROP_WALLET].filter(Boolean));
  const holders=new Map<string,HolderTicket>();
  const defaultDecimals=Number(process.env.STOCKDROPS_TOKEN_DECIMALS||process.env.HOLDER_TOKEN_DECIMALS||6);
  const ticketAtoms=holderTicketAtoms();
  let cursor:string|undefined;
  for(let page=0;page<10;page++){
    const response=await fetch(rpcUrl(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:`holders-${page}`,method:"getTokenAccounts",params:{mint,limit:1000,...(cursor?{cursor}:{})}}),cache:"no-store"});
    if(!response.ok)throw new Error(`Holder snapshot failed: ${await response.text()}`);
    const payload=await response.json() as {result?:{token_accounts?:Array<{owner:string;amount:number|string;decimals?:number}>;cursor?:string};error?:{message:string}};
    if(payload.error)throw new Error(payload.error.message);
    for(const account of payload.result?.token_accounts||[]){
      if(excluded.has(account.owner))continue;
      const amountAtoms=amountToAtoms(account.amount,account.decimals ?? defaultDecimals);
      const tickets=amountAtoms / ticketAtoms;
      if(tickets<=BigInt(0))continue;
      const previous=holders.get(account.owner);
      holders.set(account.owner,{owner:account.owner,amountAtoms:(previous?.amountAtoms||BigInt(0))+amountAtoms,tickets:(previous?.tickets||BigInt(0))+tickets});
    }
    cursor=payload.result?.cursor;
    if(!cursor)break;
  }
  return [...holders.values()].sort((a,b)=>a.owner.localeCompare(b.owner));
}

function pickWinner(holders:HolderTicket[],epochId:number,randomSource:string):FairDraw {
  const totalTickets=holders.reduce((sum,holder)=>sum+holder.tickets,BigInt(0));
  if(totalTickets<=BigInt(0))throw new Error("No eligible holder tickets");
  const holderHash=sha256(holders.map(holder=>`${holder.owner}:${holder.tickets.toString()}`).join("|"));
  const randomSeed=sha256(`stockdrops-drop:${epochId}:${randomSource}:${holderHash}:${totalTickets.toString()}`);
  const winningTicket=BigInt(`0x${randomSeed}`)%totalTickets;
  let cursor=BigInt(0);
  for(const holder of holders){
    cursor+=holder.tickets;
    if(winningTicket<cursor)return {winner:holder.owner,eligibleHolders:holders.length,totalTickets,winningTicket,randomSeed,randomSource,holderHash};
  }
  const fallback=holders[holders.length-1];
  return {winner:fallback.owner,eligibleHolders:holders.length,totalTickets,winningTicket,randomSeed,randomSource,holderHash};
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

async function createEpoch(epoch:any){
  const extended=await supabase("airdrop_epochs",{
    method:"POST",
    headers:{Prefer:"resolution=ignore-duplicates,return=representation"},
    body:JSON.stringify(epoch)
  });
  if(extended.ok)return extended;
  const text=await extended.text();
  if(!/column|schema cache|random_seed|total_tickets|winning_ticket|ticket_size_tokens/i.test(text))throw new Error(`Could not create holder epoch: ${text}`);
  const {random_seed,random_source,total_tickets,winning_ticket,ticket_size_tokens,holder_snapshot_hash,...baseEpoch}=epoch;
  return supabase("airdrop_epochs",{
    method:"POST",
    headers:{Prefer:"resolution=ignore-duplicates,return=representation"},
    body:JSON.stringify(baseEpoch)
  });
}

async function reserveAirdropLot(epochId:number,fair:FairDraw){
  const existing=await supabase(`airdrop_epochs?select=id,winner_wallet,eligible_holders,status,transaction_signature&id=eq.${epochId}&limit=1`);
  if(!existing.ok)throw new Error(`Could not check holder epoch: ${await existing.text()}`);
  const [epoch]=await jsonBody<HolderEpoch[]>(existing) || [];
  if(epoch?.transaction_signature||epoch?.status==="distributed")return {skipped:"This holder-drop epoch is already distributed."};
  if(epoch){
    const lot=await reservedHolderLot(epochId) || await reserveAvailableLotForEpoch(epochId);
    if(!lot)return {skipped:"No holder inventory available"};
    return {lot,winner:epoch.winner_wallet||fair.winner,eligibleCount:epoch.eligible_holders||fair.eligibleHolders,totalTickets:fair.totalTickets,winningTicket:fair.winningTicket,randomSeed:fair.randomSeed,randomSource:fair.randomSource,resumed:true};
  }

  const lots=await availableHolderLots();
  if(!lots.length)return {skipped:"No holder inventory available"};

  const startsAt=new Date(epochId*AIRDROP_INTERVAL_MS).toISOString();
  const endsAt=new Date((epochId+1)*AIRDROP_INTERVAL_MS).toISOString();
  const created=await createEpoch({id:epochId,starts_at:startsAt,ends_at:endsAt,snapshot_at:new Date().toISOString(),eligible_holders:fair.eligibleHolders,winner_wallet:fair.winner,status:"snapshotted",random_seed:fair.randomSeed,random_source:fair.randomSource,total_tickets:fair.totalTickets.toString(),winning_ticket:fair.winningTicket.toString(),ticket_size_tokens:Number(process.env.HOLDER_TICKET_TOKENS||250_000),holder_snapshot_hash:fair.holderHash});
  if(!created.ok)throw new Error(`Could not create holder epoch: ${await created.text()}`);
  if(!(await jsonBody<Array<{id:number}>>(created))?.length)return {skipped:"This holder-drop epoch is already recorded."};

  const lot=await reserveAvailableLotForEpoch(epochId,lots);
  if(lot)return {lot,winner:fair.winner,eligibleCount:fair.eligibleHolders,totalTickets:fair.totalTickets,winningTicket:fair.winningTicket,randomSeed:fair.randomSeed,randomSource:fair.randomSource};

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
    const connection=new Connection(rpcUrl(),"confirmed");
    const epochId=Math.floor(Date.now()/AIRDROP_INTERVAL_MS);
    const holders=await eligibleHolders();
    const randomSource=(await connection.getLatestBlockhash("finalized")).blockhash;
    const fair=holders.length?pickWinner(holders,epochId,randomSource):null;
    if(body.dryRun){
      const lots=await availableHolderLots();
      return Response.json({ok:true,dryRun:true,epochId,eligibleHolders:holders.length,totalTickets:fair?.totalTickets.toString()||"0",ticketSizeTokens:Number(process.env.HOLDER_TICKET_TOKENS||250_000),winningTicket:fair?.winningTicket.toString()||null,randomSeed:fair?.randomSeed||null,randomSource:fair?.randomSource||null,holderPacksAvailable:lots.length,nextDropAt:new Date((epochId+1)*AIRDROP_INTERVAL_MS).toISOString()});
    }
    if(!fair)return Response.json({ok:true,skipped:"No eligible holder has at least one 250k DROPS ticket",epochId});
    const reserved=await reserveAirdropLot(epochId,fair);
    if("skipped" in reserved)return Response.json({ok:true,skipped:reserved.skipped,epochId});
    const lot=reserved.lot;
    const payoutWinner=reserved.winner;
    const mint=new PublicKey(lot.mint); const program=new PublicKey(lot.token_program); const owner=new PublicKey(payoutWinner);
    const from=getAssociatedTokenAddressSync(mint,wallet,false,program); const to=getAssociatedTokenAddressSync(mint,owner,false,program);
    const transaction=new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(wallet,to,owner,mint,program),createTransferCheckedInstruction(from,mint,to,wallet,BigInt(lot.token_amount),lot.decimals,[],program));
    const signature=await connection.sendTransaction(transaction,[signer],{skipPreflight:false,maxRetries:3});
    const confirmation=await connection.confirmTransaction(signature,"confirmed");
    if(confirmation.value.err)throw new Error(`Holder payout ${signature} failed`);
    const complete=await supabase("rpc/complete_airdrop_epoch",{method:"POST",body:JSON.stringify({p_epoch_id:epochId,p_lot_id:lot.id,p_signature:signature})});
    if(!complete.ok)throw new Error(`Payout confirmed, but proof recording needs reconciliation: ${await complete.text()}`);
    return Response.json({ok:true,epochId,eligibleHolders:reserved.eligibleCount,totalTickets:reserved.totalTickets.toString(),winningTicket:reserved.winningTicket.toString(),randomSeed:reserved.randomSeed,randomSource:reserved.randomSource,winner:payoutWinner,symbol:lot.symbol,value:Number(lot.purchase_value),signature,resumed:"resumed" in reserved});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Holder epoch failed"},{status:503})}
}
