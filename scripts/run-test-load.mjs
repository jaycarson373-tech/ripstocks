const base=(process.env.RAILWAY_API_URL||process.env.API_URL||"").replace(/\/$/,"");
const secret=process.env.AUTOMATION_SECRET||"";
if(!base||!secret){console.error("Missing RAILWAY_API_URL or AUTOMATION_SECRET");process.exit(1)}
const run=async(scope,testId)=>{
  const response=await fetch(`${base}/api/admin/test-load`,{method:"POST",headers:{authorization:`Bearer ${secret}`,"content-type":"application/json"},body:JSON.stringify({scope,testId})});
  const body=await response.json();
  if(!response.ok)throw new Error(`${scope}: ${body.error||response.status}`);
  console.log(JSON.stringify({scope:body.scope,packsAdded:body.packsAdded,totalUsd:body.totalUsd}));
};
try{
  await run("main","launch-main-20260716");
  await run("holder","launch-holder-20260716");
  process.exit(0);
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exit(1)}
