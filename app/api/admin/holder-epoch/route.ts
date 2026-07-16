import { randomInt } from "node:crypto";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { authorized } from "@/lib/automation-auth";
import { AIRDROP_INTERVAL_MS } from "@/lib/protocol";
import { keypairEnv, publicKeyEnv, requiredEnv, rpcUrl, supabase } from "@/lib/server-config";

export const dynamic="force-dynamic";

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

export async function POST(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const signer=keypairEnv("HOLDER_AIRDROP_SIGNER_SECRET");
    const wallet=publicKeyEnv("HOLDER_AIRDROP_WALLET");
    if(!signer.publicKey.equals(wallet))throw new Error("Holder signer does not match configured wallet");
    const epochId=Math.floor(Date.now()/AIRDROP_INTERVAL_MS);
    const holders=await eligibleHolders();
    if(!holders.length)return Response.json({ok:true,skipped:"No eligible holders in the synchronized snapshot",epochId});
    const winner=holders[randomInt(holders.length)];
    const reserve=await supabase("rpc/reserve_airdrop_epoch",{method:"POST",body:JSON.stringify({p_epoch_id:epochId,p_winner: winner,p_eligible_holders:holders.length})});
    if(!reserve.ok)return Response.json({ok:true,skipped:await reserve.text(),epochId});
    const [lot]=await reserve.json() as Array<{lot_id:string;symbol:string;mint:string;token_amount:string;decimals:number;token_program:string;purchase_value:number}>;
    if(!lot)return Response.json({ok:true,skipped:"No holder inventory available",epochId});
    const connection=new Connection(rpcUrl(),"confirmed");
    const mint=new PublicKey(lot.mint); const program=new PublicKey(lot.token_program); const owner=new PublicKey(winner);
    const from=getAssociatedTokenAddressSync(mint,wallet,false,program); const to=getAssociatedTokenAddressSync(mint,owner,false,program);
    const transaction=new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(wallet,to,owner,mint,program),createTransferCheckedInstruction(from,mint,to,wallet,BigInt(lot.token_amount),lot.decimals,[],program));
    const signature=await connection.sendTransaction(transaction,[signer],{skipPreflight:false,maxRetries:3});
    const confirmation=await connection.confirmTransaction(signature,"confirmed");
    if(confirmation.value.err)throw new Error(`Holder payout ${signature} failed`);
    const complete=await supabase("rpc/complete_airdrop_epoch",{method:"POST",body:JSON.stringify({p_epoch_id:epochId,p_lot_id:lot.lot_id,p_signature:signature})});
    if(!complete.ok)throw new Error(`Payout confirmed, but proof recording needs reconciliation: ${await complete.text()}`);
    return Response.json({ok:true,epochId,eligibleHolders:holders.length,winner,symbol:lot.symbol,value:Number(lot.purchase_value),signature});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Holder epoch failed"},{status:503})}
}
