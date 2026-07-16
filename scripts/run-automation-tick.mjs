const clean=value=>(value||"").trim().replace(/^(["'])(.*)\1$/,"$2");
const rawBase=clean(process.env.RAILWAY_API_URL||process.env.API_URL);
const base=(/^https?:\/\//.test(rawBase)?rawBase:`https://${rawBase}`).replace(/\/$/,"");
const secret=clean(process.env.AUTOMATION_SECRET||process.env.CRON_SECRET);
if(!base||!secret){
  console.error("Missing RAILWAY_API_URL or AUTOMATION_SECRET");
  process.exit(1);
}
try{
  const response=await fetch(`${base}/api/admin/tick`,{method:"POST",headers:{authorization:`Bearer ${secret}`}});
  const body=await response.text();
  console.log(body);
  process.exit(response.ok?0:1);
}catch(error){
  console.error(error);
  process.exit(1);
}
