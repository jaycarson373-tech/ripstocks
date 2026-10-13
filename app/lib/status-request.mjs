/** Bound public status-provider requests so a stalled RPC cannot hang the UI. */
export const STATUS_PROVIDER_TIMEOUT_MS = 8_000;

export function statusRequestOptions(options = {}) {
  return {
    ...options,
    signal: AbortSignal.timeout(STATUS_PROVIDER_TIMEOUT_MS),
  };
}
