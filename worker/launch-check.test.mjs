import test from "node:test";
import assert from "node:assert/strict";
import { inspectLaunchInputs } from "./launch-check.mjs";

test("launch inputs report all missing fields without inventing a wallet", () => {
  const result = inspectLaunchInputs({});
  assert.equal(result.problems.length, 5);
  assert.equal(result.wallet, null);
  assert.equal(result.databaseUrl, null);
  assert.equal(result.contract, null);
});

test("launch checks never echo private keys, API keys, or invalid input values", () => {
  const result = inspectLaunchInputs({ AUTOMATION_PRIVATE_KEY: "PRIVATE_TEST_SECRET", ZEROX_API_KEY: "API_TEST_SECRET", PONS_TOKEN_ADDRESS: "BAD_TOKEN_INPUT", SUPABASE_URL: "https://private.invalid?secret=SECRET_QUERY", SUPABASE_SERVICE_ROLE_KEY: "DATABASE_TEST_SECRET" });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TEST_SECRET|API_TEST_SECRET|BAD_TOKEN_INPUT|SECRET_QUERY|DATABASE_TEST_SECRET/);
});

test("database credentials cannot be sent to unrelated hosts or embedded-credential URLs", () => {
  for (const url of ["http://example.supabase.co", "https://example.supabase.co.evil.test", "https://example.supabase.co@evil.test", "https://user:password@example.supabase.co", "https://example.supabase.co/other", "https://example.supabase.co?query=secret"]) {
    assert.equal(inspectLaunchInputs({ SUPABASE_URL: url }).databaseUrl, null);
  }
  assert.equal(inspectLaunchInputs({ SUPABASE_URL: "https://example.supabase.co/" }).databaseUrl, "https://example.supabase.co");
});
