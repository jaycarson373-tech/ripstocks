import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { corsHeaders, json, optionsResponse } from "@/lib/cors";
import { PACK_PRICE_USDC_ATOMS, publicKeyEnv, rpcUrl, supabase, USDC_MINT } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export function OPTIONS(){ return optionsResponse(); }

export async function POST(request: Request) {
  try {
    const { wallet } = await request.json() as { wallet?: string };
    const buyer = new PublicKey(wallet || "");
    const treasury = publicKeyEnv("MAIN_TREASURY_WALLET");
    const reserve = await supabase("rpc/reserve_pack_checkout", { method:"POST", body:JSON.stringify({p_wallet:buyer.toBase58()}) });
    if (!reserve.ok) return json({error:await reserve.text()}, reserve.status===409?409:503);
    const reserved = await reserve.json() as Array<{order_id:string}>;
    const orderId = reserved[0]?.order_id;
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
