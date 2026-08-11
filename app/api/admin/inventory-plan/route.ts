import { timingSafeEqual } from "node:crypto";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { buildInventoryPlan, parseTargets, SOL_GAS_BUFFER } from "@/lib/inventory-plan";
import { json } from "@/lib/cors";
import { protocolWallet, requiredEnv, rpcUrl } from "@/lib/server-config";

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
    const wallet=protocolWallet();
    const lamports=await connection.getBalance(wallet);
    const mainSol=lamports/LAMPORTS_PER_SOL,holderSol=mainSol;
    return json({mode:"practice",ready:mainSol>=SOL_GAS_BUFFER&&holderSol>=SOL_GAS_BUFFER,balances:{mainSol,holderSol},plan,warnings:[...(mainSol<SOL_GAS_BUFFER?["Main Treasury is below the 0.111 SOL gas reserve"]:[]),...(holderSol<SOL_GAS_BUFFER?["Holder Airdrop Wallet is below the 0.111 SOL gas reserve"]:[])]});
  }catch(error){return json({error:error instanceof Error?error.message:"Unable to build inventory plan"},503)}
}
