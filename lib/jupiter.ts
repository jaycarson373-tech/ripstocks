import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

const JUPITER_BASE="https://api.jup.ag/swap/v1";

function headers():Record<string,string>{
  const key=process.env.JUPITER_API_KEY?.trim();
  return key?{"x-api-key":key}:{};
}

export async function quoteExactInput(inputMint:PublicKey,outputMint:PublicKey,inputAtoms:bigint){
  const quoteUrl=new URL(`${JUPITER_BASE}/quote`);
  quoteUrl.searchParams.set("inputMint",inputMint.toBase58());
  quoteUrl.searchParams.set("outputMint",outputMint.toBase58());
  quoteUrl.searchParams.set("amount",inputAtoms.toString());
  quoteUrl.searchParams.set("slippageBps",process.env.JUPITER_SLIPPAGE_BPS||"100");
  quoteUrl.searchParams.set("restrictIntermediateTokens","true");
  return fetch(quoteUrl,{headers:headers(),cache:"no-store"}).then(async response=>{
    if(!response.ok)throw new Error(`Jupiter quote failed: ${await response.text()}`);
    return response.json();
  });
}

export async function swapExactInput(args:{connection:Connection;signer:Keypair;inputMint:PublicKey;outputMint:PublicKey;inputAtoms:bigint;destinationTokenAccount?:PublicKey}){
  const quoteResponse=await quoteExactInput(args.inputMint,args.outputMint,args.inputAtoms);
  const body={quoteResponse,userPublicKey:args.signer.publicKey.toBase58(),...(args.destinationTokenAccount?{destinationTokenAccount:args.destinationTokenAccount.toBase58()}:{}),dynamicComputeUnitLimit:true,prioritizationFeeLamports:{priorityLevelWithMaxLamports:{maxLamports:1_000_000,priorityLevel:"high"}}};
  const swap=await fetch(`${JUPITER_BASE}/swap`,{method:"POST",headers:{...headers(),"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"}).then(async response=>{
    if(!response.ok)throw new Error(`Jupiter swap failed: ${await response.text()}`);
    return response.json() as Promise<{swapTransaction:string}>;
  });
  const transaction=VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction,"base64"));
  transaction.sign([args.signer]);
  const signature=await args.connection.sendRawTransaction(transaction.serialize(),{skipPreflight:false,maxRetries:3});
  const confirmation=await args.connection.confirmTransaction(signature,"confirmed");
  if(confirmation.value.err)throw new Error(`Swap ${signature} failed`);
  return {signature,quotedOutputAtoms:String(quoteResponse.outAmount)};
}
