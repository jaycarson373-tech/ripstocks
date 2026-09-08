import test from "node:test";
import assert from "node:assert/strict";
import { runWorkerLoop } from "./worker-loop.mjs";

test("shutdown waits for the active tick to release and never starts another tick", async () => {
  const controller = new AbortController();
  const calls = [];
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const run = runWorkerLoop({ signal: controller.signal, pollMs: 60_000, onError: assert.fail,
    tick: async () => { calls.push("acquire"); try { await held; } finally { calls.push("release"); } },
  });
  controller.abort();
  assert.deepEqual(calls, ["acquire"]);
  finish();
  await run;
  assert.deepEqual(calls, ["acquire", "release"]);
});

test("shutdown wakes an idle worker immediately", async () => {
  const controller = new AbortController();
  let calls = 0;
  const run = runWorkerLoop({ signal: controller.signal, pollMs: 60_000, onError: assert.fail,
    tick: async () => { calls++; setImmediate(() => controller.abort()); },
  });
  await run;
  assert.equal(calls, 1);
});

test("once mode reports a tick error without restarting it", async () => {
  const failure = new Error("RPC unavailable");
  const errors = [];
  await runWorkerLoop({ signal: new AbortController().signal, pollMs: 0, once: true,
    tick: async () => { throw failure; }, onError: error => errors.push(error),
  });
  assert.deepEqual(errors, [failure]);
});
