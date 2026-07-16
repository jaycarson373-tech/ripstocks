import { NextResponse } from "next/server";

export function corsHeaders() {
  return { "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://www.ripstocks.fun", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type" };
}
export function optionsResponse() { return new NextResponse(null, { status:204, headers:corsHeaders() }); }
export function json(data: unknown, status=200) { return NextResponse.json(data, { status, headers:corsHeaders() }); }
