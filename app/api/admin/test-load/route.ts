import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { authorized } from "@/lib/automation-auth";
import { quoteExactInput, swapExactInput } from "@/lib/jupiter";
import { parseTargets } from "@/lib/inventory-plan";
import { keypairEnv, publicKeyEnv, rpcUrl, supabase, USDC_MINT } from "@/lib/server-config";

export const dynamic="force-dynamic";
const WRAPPED_SOL=new PublicKey("So11111111111111111111111111111111111111112");
const LOADER_VERSION="ata-destination-v2";

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
    const balance=await connection.getTokenAccountBalance(account,"confirmed");
    last=BigInt(balance.value.amount||"0");
    decimals=balance.value.decimals;
    if(last>beforeAtoms)return {received:last-beforeAtoms,decimals};
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  return {received:last-beforeAtoms,decimals};
}

export async function POST(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const {scope,testId,dryRun=false,budgets:requestedBudgets}=await request.json() as {scope?:"main"|"holder";testId?:string;dryRun?:boolean;budgets?:number[]};
    if(scope!=="main"&&scope!=="holder")return Response.json({error:"scope must be main or holder"},{status:400});
    if(!testId||!/^[a-zA-Z0-9_-]{8,64}$/.test(testId))return Response.json({error:"A unique testId is required"},{status:400});
    const budgets=Array.isArray(requestedBudgets)&&requestedBudgets.length?requestedBudgets:(scope==="main"?[10,10]:[5,5,5,5]);
    if(budgets.length>4||budgets.some(value=>!Number.isFinite(value)||value<=0||value>30))return Response.json({error:"Invalid test budgets"},{status:400});
    const budgetTotal=budgets.reduce((sum,value)=>sum+value,0);
    const signer=keypairEnv(scope==="main"?"MAIN_TREASURY_SIGNER_SECRET":"HOLDER_AIRDROP_SIGNER_SECRET");
    const configured=publicKeyEnv(scope==="main"?"MAIN_TREASURY_WALLET":"HOLDER_AIRDROP_WALLET");
    if(!signer.publicKey.equals(configured))throw new Error("Signer does not match configured wallet");
    const connection=new Connection(rpcUrl(),"confirmed");
    const buffer=Number(process.env.SOL_GAS_BUFFER||0.111);
    const solBalance=(await connection.getBalance(signer.publicKey,"confirmed"))/1e9;
    const solToUsdc=await quoteExactInput(WRAPPED_SOL,new PublicKey(USDC_MINT),BigInt(1_000_000_000));
    const usdPerSol=Number(solToUsdc.outAmount)/1_000_000;
    const requiredSol=budgetTotal/usdPerSol;
    if(!Number.isFinite(usdPerSol)||usdPerSol<=0)throw new Error("Could not establish SOL/USD quote");
    if(solBalance-requiredSol<buffer)throw new Error(`Test would breach the ${buffer} SOL reserve`);
    const targets=parseTargets();
    const table=scope==="main"?"inventory_lots":"airdrop_inventory_lots";
    const tableCheck=await supabase(`${table}?select=id&limit=1`);
    if(!tableCheck.ok)throw new Error(`Database inventory table is unavailable: ${await tableCheck.text()}`);
    if(dryRun)return Response.json({ok:true,dryRun:true,scope,plannedPacks:budgets.length,totalUsd:budgetTotal,reserveProtected:true,loaderVersion:LOADER_VERSION});
    const runKey=`test-load:${scope}:${testId}`;
    const lock=await supabase("automation_runs",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify({run_key:runKey,kind:`${scope}_test_load`,status:"running"})});
    const locked=await lock.json() as Array<unknown>;
    if(!lock.ok||!locked.length)return Response.json({error:"This test load was already submitted"},{status:409});
    const results:Array<{usd:number;signature:string}>=[];
    for(let index=0;index<budgets.length;index++){
      const usd=budgets[index]; const target=targets[(Date.now()+index)%targets.length]; const mint=new PublicKey(target.mint);
      const destination=await ensureTokenAccount(connection,signer,mint);
      const before=await connection.getTokenAccountBalance(destination,"confirmed");
      const beforeAtoms=BigInt(before.value.amount||"0");
      const lamports=BigInt(Math.floor((usd/usdPerSol)*1_000_000_000));
      const swap=await swapExactInput({connection,signer,inputMint:WRAPPED_SOL,outputMint:mint,inputAtoms:lamports,destinationTokenAccount:destination});
      const after=await receivedBalance(connection,destination,beforeAtoms);
      const received=after.received;
      if(received<=BigInt(0))throw new Error(`Confirmed swap ${swap.signature} has no received inventory`);
      const row=scope==="main"?{symbol:target.symbol,mint:target.mint,token_amount:received.toString(),decimals:after.decimals,token_program:TOKEN_2022_PROGRAM_ID.toBase58(),usd_value:usd,acquisition_signature:swap.signature,status:"available"}:{symbol:target.symbol,mint:target.mint,token_amount:received.toString(),decimals:after.decimals,token_program:TOKEN_2022_PROGRAM_ID.toBase58(),purchase_value:usd,acquisition_signature:swap.signature,status:"available"};
      const insert=await supabase(table,{method:"POST",body:JSON.stringify(row)});
      if(!insert.ok)throw new Error(`Swap confirmed but inventory recording needs reconciliation: ${await insert.text()}`);
      if(scope==="main")await supabase("pack_inventory_ledger",{method:"POST",body:JSON.stringify({entry_type:"inventory_purchase",usdc_delta:0,stock_value_delta:usd,packs_delta:1,transaction_signature:swap.signature,metadata:{funding:"sol_test_load"}})});
      results.push({usd,signature:swap.signature});
    }
    await supabase(`automation_runs?run_key=eq.${encodeURIComponent(runKey)}`,{method:"PATCH",body:JSON.stringify({status:"confirmed",completed_at:new Date().toISOString()})});
    return Response.json({ok:true,scope,packsAdded:results.length,totalUsd:budgetTotal,loaderVersion:LOADER_VERSION,transactions:results.map(result=>result.signature)});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Test load failed"},{status:503})}
}
