import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { STATUS_PROVIDER_TIMEOUT_MS, statusRequestOptions } from "../app/lib/status-request.mjs";

test("status provider requests preserve request settings and carry a bounded abort signal", () => {
  const options = statusRequestOptions({ method: "POST", cache: "no-store" });
  assert.equal(options.method, "POST");
  assert.equal(options.cache, "no-store");
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.equal(STATUS_PROVIDER_TIMEOUT_MS, 8_000);
});

test("status provider timeout signal aborts stalled requests", async () => {
  const signal = statusRequestOptions({}, 5).signal;
  await setTimeout(15);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, "TimeoutError");
});
