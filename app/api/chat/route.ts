import { json, optionsResponse } from "@/lib/cors";
import { supabase } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export function OPTIONS(){ return optionsResponse(); }

type ChatMessage = { id:string; created_at:string; wallet:string; message:string };

function cleanBase(value:string|undefined){
  const clean=(value||"").trim().replace(/^(["'])(.*)\1$/,"$2").replace(/\/$/,"");
  return clean ? (/^https?:\/\//.test(clean) ? clean : `https://${clean}`) : "";
}

async function proxy(request:Request){
  const railwayBase=cleanBase(process.env.NEXT_PUBLIC_RAILWAY_API_URL||process.env.RAILWAY_API_URL);
  if(!railwayBase||new URL(railwayBase).host===new URL(request.url).host)return null;
  const upstream=await fetch(`${railwayBase}/api/chat`,{
    method:request.method,
    headers:{"Content-Type":"application/json"},
    body:request.method==="POST"?await request.text():undefined,
    cache:"no-store"
  });
  return json(await upstream.json().catch(()=>({messages:[]})),upstream.status);
}

export async function GET(request:Request) {
  const proxied=await proxy(request);
  if(proxied)return proxied;
  const response=await supabase("live_chat_messages?select=id,created_at,wallet,message&order=created_at.desc&limit=40");
  if(!response.ok)return json({messages:[]});
  const messages=await response.json() as ChatMessage[];
  return json({messages:messages.reverse()});
}

export async function POST(request:Request) {
  const proxied=await proxy(request);
  if(proxied)return proxied;
  const body=await request.json().catch(()=>({})) as {wallet?:string;message?:string};
  const wallet=String(body.wallet||"spectator").slice(0,60);
  const message=String(body.message||"").replace(/\s+/g," ").trim().slice(0,180);
  if(!message)return json({error:"Message required"},400);
  const response=await supabase("live_chat_messages",{method:"POST",body:JSON.stringify({wallet,message})});
  if(!response.ok)return json({error:"Chat storage is not ready yet."},503);
  const [created]=await response.json() as ChatMessage[];
  return json({message:created});
}
