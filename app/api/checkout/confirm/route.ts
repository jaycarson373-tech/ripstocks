import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { json, optionsResponse } from "@/lib/cors";
import { keypairEnv, PACK_PRICE_USDC_ATOMS, publicKeyEnv, rpcUrl, supabase, USDC_MINT } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export function OPTIONS(){ return optionsResponse(); }
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function POST(request:Request){
  try{
    const {orderId,paymentSignature,wallet}=await request.json() as {orderId?:string;paymentSignature?:string;wallet?:string};
    if(!orderId||!paymentSignature||!wallet)return json({error:"Missing checkout proof"},400);
    const buyer=new PublicKey(wallet); const treasury=publicKeyEnv("MAIN_TREASURY_WALLET");
    const connection=new Connection(rpcUrl(),"confirmed");
    let paid=false;
    for(let attempt=0;attempt<8;attempt++){
      const tx=await connection.getParsedTransaction(paymentSignature,{commitment:"confirmed",maxSupportedTransactionVersion:0});
      if(tx?.meta?.err) return json({error:"Payment transaction failed"},400);
      if(tx){
        const pre=tx.meta?.preTokenBalances?.filter(x=>x.mint===USDC_MINT&&x.owner===treasury.toBase58()).reduce((n,x)=>n+BigInt(x.uiTokenAmount.amount),BigInt(0))??BigInt(0);
        const post=tx.meta?.postTokenBalances?.filter(x=>x.mint===USDC_MINT&&x.owner===treasury.toBase58()).reduce((n,x)=>n+BigInt(x.uiTokenAmount.amount),BigInt(0))??BigInt(0);
        const buyerPre=tx.meta?.preTokenBalances?.filter(x=>x.mint===USDC_MINT&&x.owner===buyer.toBase58()).reduce((n,x)=>n+BigInt(x.uiTokenAmount.amount),BigInt(0))??BigInt(0);
        const buyerPost=tx.meta?.postTokenBalances?.filter(x=>x.mint===USDC_MINT&&x.owner===buyer.toBase58()).reduce((n,x)=>n+BigInt(x.uiTokenAmount.amount),BigInt(0))??BigInt(0);
        paid=post-pre>=PACK_PRICE_USDC_ATOMS&&buyerPre-buyerPost>=PACK_PRICE_USDC_ATOMS; if(paid)break;
      }
      await pause(750);
    }
    if(!paid)return json({error:"The $10 USDC payment was not confirmed"},400);
    const claim=await supabase("rpc/claim_paid_inventory_lot",{method:"POST",body:JSON.stringify({p_order_id:orderId,p_wallet:buyer.toBase58(),p_payment_signature:paymentSignature})});
    if(!claim.ok)return json({error:await claim.text()},409);
    const [lot]=await claim.json() as Array<{lot_id:string;symbol:string;mint:string;token_amount:string;decimals:number;usd_value:number}>;
    if(!lot)return json({error:"Payment verified; fulfillment queued"},202);
    const signer=keypairEnv("MAIN_TREASURY_SIGNER_SECRET");
    if(!signer.publicKey.equals(treasury))throw new Error("Main Treasury signer does not match its public key");
    const mint=new PublicKey(lot.mint); const from=getAssociatedTokenAddressSync(mint,treasury); const to=getAssociatedTokenAddressSync(mint,buyer);
    const payout=new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(treasury,to,buyer,mint),createTransferCheckedInstruction(from,mint,to,treasury,BigInt(lot.token_amount),lot.decimals));
    const fulfillmentSignature=await connection.sendTransaction(payout,[signer],{skipPreflight:false,maxRetries:3});
    await connection.confirmTransaction(fulfillmentSignature,"confirmed");
    const finish=await supabase("rpc/complete_pack_fulfillment",{method:"POST",body:JSON.stringify({p_order_id:orderId,p_lot_id:lot.lot_id,p_fulfillment_signature:fulfillmentSignature})});
    if(!finish.ok)throw new Error("Payout confirmed but database proof is pending reconciliation");
    return json({orderId,symbol:lot.symbol,value:Number(lot.usd_value),paymentSignature,fulfillmentSignature});
  }catch(error){return json({error:error instanceof Error?error.message:"Fulfillment unavailable"},503)}
}
