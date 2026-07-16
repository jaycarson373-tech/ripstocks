import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { authorized } from "@/lib/automation-auth";
import { parseTargets } from "@/lib/inventory-plan";
import { publicKeyEnv, rpcUrl, supabase } from "@/lib/server-config";

export const dynamic="force-dynamic";

type TokenBalance={accountIndex:number;mint:string;owner?:string;programId?:string;uiTokenAmount:{amount:string;decimals:number}};

export async function POST(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const {scope,signature,usdValue}=await request.json() as {scope?:"main"|"holder";signature?:string;usdValue?:number};
    if(scope!=="main"&&scope!=="holder")return Response.json({error:"scope must be main or holder"},{status:400});
    if(!signature||!/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature))return Response.json({error:"Valid signature required"},{status:400});
    if(!Number.isFinite(usdValue)||Number(usdValue)<=0||Number(usdValue)>30)return Response.json({error:"Valid usdValue required"},{status:400});
    const wallet=publicKeyEnv(scope==="main"?"MAIN_TREASURY_WALLET":"HOLDER_AIRDROP_WALLET").toBase58();
    const targets=parseTargets();
    const targetByMint=new Map(targets.map(target=>[target.mint,target]));
    const table=scope==="main"?"inventory_lots":"airdrop_inventory_lots";
    const existing=await supabase(`${table}?select=id&acquisition_signature=eq.${encodeURIComponent(signature)}&limit=1`);
    if(!existing.ok)throw new Error(`Could not check existing inventory: ${await existing.text()}`);
    if(((await existing.json()) as unknown[]).length)return Response.json({ok:true,scope,alreadyRecorded:true});
    const connection=new Connection(rpcUrl(),"confirmed");
    const transaction=await connection.getParsedTransaction(signature,{commitment:"confirmed",maxSupportedTransactionVersion:0});
    if(!transaction||!transaction.meta||transaction.meta.err)throw new Error("Transaction is not confirmed cleanly");
    const meta=transaction.meta;
    const pre=new Map<number,TokenBalance>((meta.preTokenBalances as TokenBalance[]|undefined||[]).map(balance=>[balance.accountIndex,balance]));
    const candidates=(meta.postTokenBalances as TokenBalance[]|undefined||[]).flatMap(post=>{
      if(post.owner!==wallet||post.programId!==TOKEN_2022_PROGRAM_ID.toBase58()||!targetByMint.has(post.mint))return [];
      const before=BigInt(pre.get(post.accountIndex)?.uiTokenAmount.amount||"0");
      const after=BigInt(post.uiTokenAmount.amount||"0");
      const delta=after-before;
      return delta>BigInt(0)?[{post,delta}]:[];
    });
    if(candidates.length!==1)throw new Error("Could not identify exactly one owned xStock output");
    const {post,delta}=candidates[0];
    const target=targetByMint.get(post.mint);
    if(!target)throw new Error("Unapproved xStock mint");
    const row=scope==="main"
      ?{symbol:target.symbol,mint:target.mint,token_amount:delta.toString(),decimals:post.uiTokenAmount.decimals,token_program:TOKEN_2022_PROGRAM_ID.toBase58(),usd_value:usdValue,acquisition_signature:signature,status:"available"}
      :{symbol:target.symbol,mint:target.mint,token_amount:delta.toString(),decimals:post.uiTokenAmount.decimals,token_program:TOKEN_2022_PROGRAM_ID.toBase58(),purchase_value:usdValue,acquisition_signature:signature,status:"available"};
    const inserted=await supabase(table,{method:"POST",body:JSON.stringify(row)});
    if(!inserted.ok)throw new Error(`Inventory insert failed: ${await inserted.text()}`);
    if(scope==="main")await supabase("pack_inventory_ledger",{method:"POST",body:JSON.stringify({entry_type:"inventory_purchase",usdc_delta:0,stock_value_delta:usdValue,packs_delta:1,transaction_signature:signature,metadata:{funding:"sol_test_load_reconcile"}})});
    return Response.json({ok:true,scope,packsAdded:1,totalUsd:usdValue});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Reconcile failed"},{status:503})}
}
