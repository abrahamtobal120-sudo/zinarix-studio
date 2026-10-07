/**
 * Secret redaction. Two layers:
 *  1. Exact values of every credential the process has loaded (registered by `Secret`).
 *  2. Pattern rules (Gitleaks-style) for secrets we have never seen, e.g. inside files that
 *     are about to be sent to a model as context.
 */

export const REDACTED = '[REDACTADO]';

interface Rule {
  id: string;
  re: RegExp;
  /** Index of the capture group holding the secret; 0 = whole match. */
  group?: number;
}

const RULES: Rule[] = [
  {
    id: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { id: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { id: 'google-api', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  {
    id: 'aws-secret',
    re: /(aws_?secret_?access_?key["'\s:=]+)([A-Za-z0-9/+=]{40})/gi,
    group: 2,
  },
  { id: 'groq', re: /\bgsk_[A-Za-z0-9]{20,}/g },
  { id: 'xai', re: /\bxai-[A-Za-z0-9]{20,}/g },
  {
    id: 'github',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  },
  { id: 'huggingface', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { id: 'slack', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: 'stripe', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: 'bearer', re: /(\bBearer\s+)([A-Za-z0-9._~+/=-]{16,})/g, group: 2 },
  {
    id: 'generic-assignment',
    re: /((?:api[_-]?key|secret|token|passw(?:or)?d|access[_-]?key)["']?\s*[:=]\s*["']?)([^\s"'`,;]{12,})/gi,
    group: 2,
  },
  { id: 'url-credentials', re: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi, group: 2 },
];

const known = new Set<string>();

/** Registers an exact secret value so it is scrubbed from every redacted output. */
export function registerSecret(value: string): void {
  if (value.length >= 6) known.add(value);
}

/** For tests only. */
export function clearRegisteredSecrets(): void {
  known.clear();
}

export interface RedactionResult {
  text: string;
  count: number;
  rules: string[];
}

export function redactWithReport(input: string): RedactionResult {
  let text = input;
  let count = 0;
  const rules = new Set<string>();

  for (const value of known) {
    if (text.includes(value)) {
      const parts = text.split(value);
      count += parts.length - 1;
      text = parts.join(REDACTED);
      rules.add('known-secret');
    }
  }

  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      const match = args[0] as string;
      if (match.includes(REDACTED)) return match;
      count++;
      rules.add(rule.id);
      if (!rule.group) return REDACTED;
      const groups = args.slice(1, -2) as (string | undefined)[];
      return groups.map((g, i) => (i + 1 === rule.group ? REDACTED : (g ?? ''))).join('');
    });
  }

  return { text, count, rules: [...rules] };
}

export function redact(input: string): string {
  return redactWithReport(input).text;
}

/** Deep-redacts any JSON-like value (strings inside objects/arrays). */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /^(api[_-]?key|authorization|x-api-key|password|secret|token)$/i.test(k)
        ? REDACTED
        : redactDeep(v);
    }
    return out as T;
  }
  return value;
}
