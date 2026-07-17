import { authorized } from "@/lib/automation-auth";
import { AIRDROP_INTERVAL_MS } from "@/lib/protocol";

export const dynamic="force-dynamic";
export async function POST(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const authorization=request.headers.get("authorization")||"";
  const base=new URL(request.url).origin;
  const call=(path:string)=>fetch(`${base}${path}`,{method:"POST",headers:{authorization},cache:"no-store"}).then(async response=>{
    const text=await response.text();
    const body=text?JSON.parse(text):null;
    return {status:response.status,body};
  }).catch(error=>({status:503,body:{ok:false,error:error instanceof Error?error.message:"Automation call failed"}}));
  const fiveMinuteBoundary=Date.now()%AIRDROP_INTERVAL_MS<180_000;
  const waiting={status:200,body:{ok:true,skipped:"Waiting for the next 5-minute window."}};
  const main=fiveMinuteBoundary?await call("/api/admin/restock?scope=main"):waiting;
  const holder=fiveMinuteBoundary?await call("/api/admin/restock?scope=holder"):null;
  const airdrop=fiveMinuteBoundary?await call("/api/admin/holder-epoch"):null;
  return Response.json({ok:true,main,holder,airdrop});
}
