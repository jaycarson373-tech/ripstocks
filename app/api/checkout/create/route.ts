import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { corsHeaders, json, optionsResponse } from "@/lib/cors";
import { PACK_PRICE_USDC_ATOMS, publicKeyEnv, rpcUrl, supabase, USDC_MINT } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export function OPTIONS(){ return optionsResponse(); }

async function reserveInventory(wallet:string){
  const expires=new Date(Date.now()+3*60_000).toISOString();
  await supabase(`inventory_lots?status=eq.reserved&reserved_until=lt.${encodeURIComponent(new Date().toISOString())}`,{method:"PATCH",body:JSON.stringify({status:"available",reserved_order_id:null,reserved_until:null})});
  for(let attempt=0;attempt<3;attempt++){
    const available=await supabase("inventory_lots?select=id&status=eq.available&order=created_at.asc&limit=20");
    if(!available.ok)throw new Error(await available.text());
    const lots=await available.json() as Array<{id:string}>;
    if(!lots.length)return null;
    const lot=lots[Math.floor(Math.random()*lots.length)];
    const order=await supabase("pack_orders",{method:"POST",body:JSON.stringify({wallet,tier:10,status:"pending"})});
    if(!order.ok)throw new Error(await order.text());
    const [created]=await order.json() as Array<{id:string}>;
    if(!created?.id)throw new Error("Could not create checkout order");
    const reserved=await supabase(`inventory_lots?id=eq.${encodeURIComponent(lot.id)}&status=eq.available`,{method:"PATCH",body:JSON.stringify({status:"reserved",reserved_order_id:created.id,reserved_until:expires})});
    if(reserved.ok&&((await reserved.json()) as unknown[]).length)return created.id;
    await supabase(`pack_orders?id=eq.${encodeURIComponent(created.id)}`,{method:"PATCH",body:JSON.stringify({status:"failed"})});
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { wallet } = await request.json() as { wallet?: string };
    const buyer = new PublicKey(wallet || "");
    const treasury = publicKeyEnv("MAIN_TREASURY_WALLET");
    const orderId = await reserveInventory(buyer.toBase58());
    if (!orderId) return json({error:"No verified packs are available."},409);
    const mint = new PublicKey(USDC_MINT);
    const buyerAta = getAssociatedTokenAddressSync(mint,buyer);
    const treasuryAta = getAssociatedTokenAddressSync(mint,treasury);
    const connection = new Connection(rpcUrl(),"confirmed");
    const transaction = new Transaction({feePayer:buyer,recentBlockhash:(await connection.getLatestBlockhash("confirmed")).blockhash});
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(buyer,treasuryAta,treasury,mint));
    transaction.add(createTransferCheckedInstruction(buyerAta,mint,treasuryAta,buyer,PACK_PRICE_USDC_ATOMS,6));
    return json({orderId,transaction:transaction.serialize({requireAllSignatures:false,verifySignatures:false}).toString("base64"),amountUsdc:10});
  } catch (error) { return json({error:error instanceof Error?error.message:"Checkout unavailable"},503); }
}
