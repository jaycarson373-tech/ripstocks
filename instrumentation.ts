const schedulerState=globalThis as typeof globalThis&{__ripstocksScheduler?:ReturnType<typeof setInterval>};

function clean(value:string|undefined){return (value||"").trim().replace(/^(["'])(.*)\1$/,"$2")}

export async function register(){
  if(process.env.NEXT_RUNTIME!=="nodejs"||schedulerState.__ripstocksScheduler)return;
  const domain=clean(process.env.RAILWAY_PUBLIC_DOMAIN);
  const secret=clean(process.env.AUTOMATION_SECRET||process.env.CRON_SECRET);
  if(!domain||!secret)return;
  const tick=async()=>{
    try{await fetch(`https://${domain}/api/admin/tick`,{method:"POST",headers:{authorization:`Bearer ${secret}`},cache:"no-store"})}catch(error){console.error("RipStocks scheduler tick failed",error)}
  };
  setTimeout(()=>void tick(),15_000);
  schedulerState.__ripstocksScheduler=setInterval(()=>void tick(),60_000);
  schedulerState.__ripstocksScheduler.unref?.();
}
