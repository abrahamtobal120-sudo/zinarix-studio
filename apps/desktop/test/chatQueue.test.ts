/** The chat queue retries passing errors (network, overloaded provider) a few times. */
import { describe, expect, it } from 'vitest';
import { QUEUE_RETRY_DELAYS, queueRetryDelay } from '../src/shared/chatQueue';

describe('queueRetryDelay', () => {
  it('retries passing errors with a growing wait', () => {
    expect(queueRetryDelay('network', 0)).toBe(QUEUE_RETRY_DELAYS[0]);
    expect(queueRetryDelay('server', 1)).toBe(QUEUE_RETRY_DELAYS[1]);
    expect(queueRetryDelay('rate_limit', 2)).toBe(QUEUE_RETRY_DELAYS[2]);
    expect(QUEUE_RETRY_DELAYS[1]!).toBeGreaterThan(QUEUE_RETRY_DELAYS[0]!);
  });

  it('gives up after the last retry', () => {
    expect(queueRetryDelay('timeout', QUEUE_RETRY_DELAYS.length)).toBeNull();
  });

  it('never retries errors that will not pass by themselves', () => {
    for (const code of ['auth', 'cancelled', 'unknown', 'bad_request', undefined])
      expect(queueRetryDelay(code, 0)).toBeNull();
  });
});
