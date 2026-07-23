const schedulerState=globalThis as typeof globalThis&{__packripsScheduler?:ReturnType<typeof setInterval>};

function clean(value:string|undefined){return (value||"").trim().replace(/^(["'])(.*)\1$/,"$2")}

export async function register(){
  if(process.env.NEXT_RUNTIME!=="nodejs"||schedulerState.__packripsScheduler)return;
  const port=clean(process.env.PORT)||"3000";
  const base=`http://127.0.0.1:${port}`;
  const secret=clean(process.env.AUTOMATION_SECRET||process.env.CRON_SECRET);
  if(!secret)return;
  const tick=async()=>{
    try{await fetch(`${base}/api/admin/tick`,{method:"POST",headers:{authorization:`Bearer ${secret}`},cache:"no-store"})}catch(error){console.error("PackRips scheduler tick failed",error)}
  };
  setTimeout(()=>void tick(),15_000);
  schedulerState.__packripsScheduler=setInterval(()=>void tick(),60_000);
  schedulerState.__packripsScheduler.unref?.();
}
