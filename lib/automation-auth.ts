import { timingSafeEqual } from "node:crypto";

export function authorized(request:Request){
  const expected=process.env.AUTOMATION_SECRET?.trim()||"";
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(!expected||expected.length!==supplied.length)return false;
  return timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
}
