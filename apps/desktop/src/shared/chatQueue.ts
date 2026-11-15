/**
 * The chat's message queue: when a queued message fails for a passing reason (the network
 * dropped, the provider was overloaded or rate limited, a timeout), it is retried by itself
 * a few times with a growing wait, instead of leaving the rest of the queue stuck.
 */

/** Error codes (describeError in main/ai.ts) worth a retry: they usually pass by themselves. */
export const TRANSIENT_CODES: readonly string[] = ['network', 'server', 'rate_limit', 'timeout'];

/** Waits before retry 1, 2, 3 (ms). After the last one the queue waits for the user. */
export const QUEUE_RETRY_DELAYS: readonly number[] = [5_000, 15_000, 45_000];

/**
 * How long to wait before retrying a message that failed with `code`, after `tries` retries
 * already made; null = do not retry (not transient, or no retries left).
 */
export function queueRetryDelay(code: string | undefined, tries: number): number | null {
  if (!code || !TRANSIENT_CODES.includes(code)) return null;
  return QUEUE_RETRY_DELAYS[tries] ?? null;
}
