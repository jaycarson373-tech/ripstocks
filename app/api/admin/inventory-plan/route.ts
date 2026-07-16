import { timingSafeEqual } from "node:crypto";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { buildInventoryPlan, parseTargets, SOL_GAS_BUFFER } from "@/lib/inventory-plan";
import { json } from "@/lib/cors";
import { publicKeyEnv, requiredEnv, rpcUrl } from "@/lib/server-config";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function authorized(request:Request){
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  const expected=requiredEnv("AUTOMATION_SECRET");
  const a=Buffer.from(supplied),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}

export async function POST(request:Request){
  try{
    if(!authorized(request))return json({error:"Unauthorized"},401);
    const targets=parseTargets(); const plan=buildInventoryPlan(targets);
    const connection=new Connection(rpcUrl(),"confirmed");
    const main=publicKeyEnv("MAIN_TREASURY_WALLET"),holder=publicKeyEnv("HOLDER_AIRDROP_WALLET");
    const [mainLamports,holderLamports]=await Promise.all([connection.getBalance(main),connection.getBalance(holder)]);
    const mainSol=mainLamports/LAMPORTS_PER_SOL,holderSol=holderLamports/LAMPORTS_PER_SOL;
    return json({mode:"practice",ready:mainSol>=SOL_GAS_BUFFER&&holderSol>=SOL_GAS_BUFFER,balances:{mainSol,holderSol},plan,warnings:[...(mainSol<SOL_GAS_BUFFER?["Main Treasury is below the 0.111 SOL gas reserve"]:[]),...(holderSol<SOL_GAS_BUFFER?["Holder Airdrop Wallet is below the 0.111 SOL gas reserve"]:[])]});
  }catch(error){return json({error:error instanceof Error?error.message:"Unable to build inventory plan"},503)}
}
