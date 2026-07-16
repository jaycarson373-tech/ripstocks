import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { authorized } from "@/lib/automation-auth";
import { HOLDER_INVENTORY_LOTS, MAIN_INVENTORY_LOTS, parseTargets } from "@/lib/inventory-plan";
import { swapExactInput } from "@/lib/jupiter";
import { keypairEnv, publicKeyEnv, rpcUrl, supabase, USDC_MINT } from "@/lib/server-config";

export const dynamic="force-dynamic";
const USDC_DECIMALS=6;

async function jsonBody(response:Response){const text=await response.text();return text?JSON.parse(text):null}

async function ensureTokenAccount(connection:Connection,payer:ReturnType<typeof keypairEnv>,mint:PublicKey){
  const account=getAssociatedTokenAddressSync(mint,payer.publicKey,false,TOKEN_2022_PROGRAM_ID);
  const transaction=new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,account,payer.publicKey,mint,TOKEN_2022_PROGRAM_ID));
  const signature=await connection.sendTransaction(transaction,[payer],{skipPreflight:false,maxRetries:3});
  const confirmation=await connection.confirmTransaction(signature,"confirmed");
  if(confirmation.value.err)throw new Error(`Token account setup ${signature} failed`);
  return account;
}

async function receivedBalance(connection:Connection,account:PublicKey,beforeAtoms:bigint){
  let last=beforeAtoms;
  let decimals=0;
  for(let attempt=0;attempt<12;attempt++){
    const balance=await connection.getTokenAccountBalance(account,"confirmed").catch(()=>null);
    if(!balance){await new Promise(resolve=>setTimeout(resolve,750));continue}
    last=BigInt(balance.value.amount||"0");
    decimals=balance.value.decimals;
    if(last>beforeAtoms)return {received:last-beforeAtoms,decimals};
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  return {received:last-beforeAtoms,decimals};
}

async function tokenBalance(connection:Connection,account:PublicKey){
  for(let attempt=0;attempt<12;attempt++){
    const balance=await connection.getTokenAccountBalance(account,"confirmed").catch(()=>null);
    if(balance)return balance;
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  throw new Error("Token account was not readable after setup");
}

export async function POST(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const scope=new URL(request.url).searchParams.get("scope");
    if(scope!=="main"&&scope!=="holder")return Response.json({error:"scope must be main or holder"},{status:400});
    const signer=keypairEnv(scope==="main"?"MAIN_TREASURY_SIGNER_SECRET":"HOLDER_AIRDROP_SIGNER_SECRET");
    const configured=publicKeyEnv(scope==="main"?"MAIN_TREASURY_WALLET":"HOLDER_AIRDROP_WALLET");
    if(!signer.publicKey.equals(configured))throw new Error(`${scope} signer does not match configured wallet`);
    const intervalMinutes=20;
    const slot=Math.floor(Date.now()/(intervalMinutes*60_000));
    const runKey=`restock:${scope}:${slot}`;
    const lock=await supabase("automation_runs",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify({run_key:runKey,kind:`${scope}_restock`,status:"running"})});
    const locked=await jsonBody(lock) as Array<{run_key:string}>|null;
    if(!lock.ok)throw new Error(`Could not acquire automation lock: ${JSON.stringify(locked)}`);
    if(!locked?.length)return Response.json({ok:true,skipped:"This synchronized run already executed."});
    const connection=new Connection(rpcUrl(),"confirmed");
    const sol=(await connection.getBalance(signer.publicKey,"confirmed"))/1e9;
    const buffer=Number(process.env.SOL_GAS_BUFFER||0.111);
    if(sol<buffer)throw new Error(`Wallet is below the ${buffer} SOL gas buffer`);
    const usdcMint=new PublicKey(USDC_MINT);
    const usdcAta=getAssociatedTokenAddressSync(usdcMint,signer.publicKey);
    const usdcBalance=await connection.getTokenAccountBalance(usdcAta,"confirmed").catch(()=>null);
    const availableUsdc=Number(usdcBalance?.value.uiAmountString||0);
    const lots=scope==="main"?MAIN_INVENTORY_LOTS:HOLDER_INVENTORY_LOTS;
    const countTable=scope==="main"?"inventory_lots":"airdrop_inventory_lots";
    const countResponse=await supabase(`${countTable}?select=id`,{headers:{Prefer:"count=exact"}});
    const count=Number(countResponse.headers.get("content-range")?.split("/")[1]||0);
    const usd=lots[count%lots.length];
    if(availableUsdc<usd)return Response.json({ok:true,skipped:"Insufficient available USDC for the next inventory lot",availableUsdc,nextLotUsd:usd});
    const targets=parseTargets();
    const target=targets[count%targets.length];
    const mint=new PublicKey(target.mint);
    const destination=await ensureTokenAccount(connection,signer,mint);
    const before=await tokenBalance(connection,destination);
    const beforeAtoms=BigInt(before.value.amount||"0");
    const swap=await swapExactInput({connection,signer,inputMint:usdcMint,outputMint:mint,inputAtoms:BigInt(Math.round(usd*10**USDC_DECIMALS)),destinationTokenAccount:destination});
    const after=await receivedBalance(connection,destination,beforeAtoms);
    const received=after.received;
    if(received<=BigInt(0))throw new Error(`Swap ${swap.signature} confirmed without received inventory`);
    const row=scope==="main"?{symbol:target.symbol,mint:target.mint,token_amount:received.toString(),decimals:after.decimals,token_program:TOKEN_2022_PROGRAM_ID.toBase58(),usd_value:usd,acquisition_signature:swap.signature,status:"available"}:{symbol:target.symbol,mint:target.mint,token_amount:received.toString(),decimals:after.decimals,token_program:TOKEN_2022_PROGRAM_ID.toBase58(),purchase_value:usd,acquisition_signature:swap.signature,status:"available"};
    const inserted=await supabase(countTable,{method:"POST",body:JSON.stringify(row)});
    if(!inserted.ok)throw new Error(`Swap confirmed, but inventory recording needs reconciliation: ${await inserted.text()}`);
    if(scope==="main")await supabase("pack_inventory_ledger",{method:"POST",body:JSON.stringify({entry_type:"inventory_purchase",usdc_delta:-usd,stock_value_delta:usd,packs_delta:1,transaction_signature:swap.signature,metadata:{symbol:target.symbol,mint:target.mint}})});
    await supabase(`automation_runs?run_key=eq.${encodeURIComponent(runKey)}`,{method:"PATCH",body:JSON.stringify({status:"confirmed",transaction_signature:swap.signature,completed_at:new Date().toISOString()})});
    return Response.json({ok:true,scope,symbol:target.symbol,usd,receivedAtoms:received.toString(),signature:swap.signature});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Restock failed"},{status:503})}
}
