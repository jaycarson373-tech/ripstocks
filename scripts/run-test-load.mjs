const clean=value=>(value||"").trim().replace(/^(["'])(.*)\1$/,"$2");
const rawBase=clean(process.env.RAILWAY_API_URL||process.env.API_URL);
const base=(/^https?:\/\//.test(rawBase)?rawBase:`https://${rawBase}`).replace(/\/$/,"");
const secret=clean(process.env.AUTOMATION_SECRET||process.env.CRON_SECRET);
if(!base||!secret){console.error("Missing RAILWAY_API_URL or AUTOMATION_SECRET");process.exit(1)}
const launchBudgets={main:[10,10],holder:[1,1,1,2,2,2,2,3,3,3]};
const run=async(scope,testId)=>{
  const response=await fetch(`${base}/api/admin/test-load`,{method:"POST",headers:{authorization:`Bearer ${secret}`,"content-type":"application/json"},body:JSON.stringify({scope,testId,budgets:launchBudgets[scope]})});
  const body=await response.json();
  if(!response.ok)throw new Error(`${scope}: ${body.error||response.status}`);
  console.log(JSON.stringify({scope:body.scope,packsAdded:body.packsAdded,totalUsd:body.totalUsd}));
};
try{
  await run("main","memepacks-main-20260718");
  await run("holder","memepacks-holder-20260718");
  process.exit(0);
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exit(1)}
