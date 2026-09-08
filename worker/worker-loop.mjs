import { setTimeout as pause } from "node:timers/promises";

// SIGTERM stops new work, but the current tick must finish its finally/release.
export async function runWorkerLoop({ tick, signal, pollMs, once = false, onError }) {
  while (!signal.aborted) {
    try { await tick(); }
    catch (error) { if (!signal.aborted) await onError(error); }
    if (once || signal.aborted) return;
    try { await pause(pollMs, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  }
}
