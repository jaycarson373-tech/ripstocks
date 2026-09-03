import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const requestHeaders = await headers();
  const country = (requestHeaders.get("cf-ipcountry") || requestHeaders.get("x-vercel-ip-country") || "").toUpperCase();
  return NextResponse.json({
    country: country || null,
    allowed: true,
  }, { headers: { "Cache-Control": "no-store" } });
}
