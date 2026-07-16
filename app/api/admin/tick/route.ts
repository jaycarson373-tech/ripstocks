import { authorized } from "@/lib/automation-auth";

export const dynamic="force-dynamic";
export async function POST(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const authorization=request.headers.get("authorization")||"";
  const base=new URL(request.url).origin;
  const call=(path:string)=>fetch(`${base}${path}`,{method:"POST",headers:{authorization},cache:"no-store"}).then(async response=>({status:response.status,body:await response.json()}));
  const main=await call("/api/admin/restock?scope=main");
  const twentyMinuteBoundary=Math.floor(Date.now()/600_000)%2===0;
  const holder=twentyMinuteBoundary?await call("/api/admin/restock?scope=holder"):null;
  const airdrop=twentyMinuteBoundary?await call("/api/admin/holder-epoch"):null;
  return Response.json({ok:true,main,holder,airdrop});
}
