import { headers } from "next/headers";
import { NextResponse } from "next/server";

const RESTRICTED_COUNTRIES = new Set(["US", "CA", "GB", "CH"]);

export async function GET() {
  const requestHeaders = await headers();
  const country = (requestHeaders.get("cf-ipcountry") || requestHeaders.get("x-vercel-ip-country") || "").toUpperCase();
  return NextResponse.json({
    country: country || null,
    allowed: country ? !RESTRICTED_COUNTRIES.has(country) : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
