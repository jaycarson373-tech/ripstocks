// Supabase's current sb_secret_ keys are not JWTs. Send them only as apikey.
// Retain legacy service_role JWT support without putting secrets in browsers.
export function supabaseHeaders(key) {
  if (!key || key.startsWith("sb_publishable_")) throw new Error("A Supabase backend secret or service_role key is required");
  if (key.startsWith("sb_secret_")) return { apikey: key };
  return { apikey: key, Authorization: `Bearer ${key}` };
}
