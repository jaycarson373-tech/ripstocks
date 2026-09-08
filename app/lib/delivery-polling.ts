// A slow network gets a small notice, never a replacement for the reel.
export const OPENING_WAIT_MS = 30_000;

export function deliveryPause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

// A timeout is a presentation state, never the end of a paid receipt lookup.
export async function pollDelivery<T>({ read, onDelivered, signal, pause = deliveryPause }: {
  read: (signal: AbortSignal) => Promise<T | null>;
  onDelivered: (result: T) => void;
  signal: AbortSignal;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  let attempts = 0;
  while (!signal.aborted) {
    try {
      const result = await read(signal);
      if (signal.aborted) return;
      if (result !== null) { onDelivered(result); return; }
    } catch { /* Retry only the read, never the purchase or delivery transaction. */ }
    if (signal.aborted) return;
    await pause(++attempts < 8 ? 1_000 : 3_000, signal);
  }
}
