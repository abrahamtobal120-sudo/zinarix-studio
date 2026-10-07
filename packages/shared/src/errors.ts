export type OmniErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'not_found'
  | 'aborted'
  | 'config'
  | 'budget'
  | 'privacy'
  | 'unsupported'
  | 'unknown';

/**
 * Normalized error across every provider. `message` must never contain a secret:
 * every constructor call site passes provider text through the redactor first.
 */
export class OmniError extends Error {
  readonly code: OmniErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly provider?: string;
  readonly retryAfterMs?: number;

  constructor(
    code: OmniErrorCode,
    message: string,
    opts: { retryable?: boolean; status?: number; provider?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'OmniError';
    this.code = code;
    this.retryable =
      opts.retryable ??
      (code === 'rate_limit' || code === 'server' || code === 'network' || code === 'timeout');
    this.status = opts.status;
    this.provider = opts.provider;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function isOmniError(e: unknown): e is OmniError {
  return e instanceof OmniError;
}

export function errorCodeForStatus(status: number): OmniErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

/** CLI exit codes, stable for scripts and CI. */
export const ExitCode = {
  ok: 0,
  error: 1,
  usage: 2,
  auth: 3,
  rateLimit: 4,
  budget: 5,
  findings: 6,
  aborted: 130,
} as const;

export function exitCodeFor(e: unknown): number {
  if (!isOmniError(e)) return ExitCode.error;
  switch (e.code) {
    case 'auth':
      return ExitCode.auth;
    case 'rate_limit':
      return ExitCode.rateLimit;
    case 'budget':
      return ExitCode.budget;
    case 'aborted':
      return ExitCode.aborted;
    case 'config':
    case 'bad_request':
      return ExitCode.usage;
    default:
      return ExitCode.error;
  }
}
