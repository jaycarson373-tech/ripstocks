const base=(process.env.RAILWAY_API_URL||process.env.API_URL||"").replace(/\/$/,"");
const secret=process.env.AUTOMATION_SECRET||"";
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
