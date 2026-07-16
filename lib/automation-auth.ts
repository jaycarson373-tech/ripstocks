import { timingSafeEqual } from "node:crypto";

export function authorized(request:Request){
  const normalize=(value:string)=>value.trim().replace(/^(["'])(.*)\1$/,"$2");
  const supplied=normalize(request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"");
  const configured=[process.env.AUTOMATION_SECRET,process.env.CRON_SECRET].filter((value):value is string=>Boolean(value)).map(normalize);
  return configured.some(expected=>expected.length===supplied.length&&timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)));
}
