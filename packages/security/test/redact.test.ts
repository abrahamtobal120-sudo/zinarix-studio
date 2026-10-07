import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REDACTED,
  Secret,
  clearRegisteredSecrets,
  createLogger,
  maskKey,
  redact,
  redactDeep,
  redactWithReport,
} from '@omni/security';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterEach(() => clearRegisteredSecrets());

describe('Secret', () => {
  const raw = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXa9F2';

  it('never stringifies to the raw value', () => {
    const s = new Secret(raw);
    expect(String(s)).toBe('sk-…a9F2');
    expect(`${s}`).not.toContain('ABCDEF');
    expect(JSON.stringify({ s })).not.toContain(raw);
    expect(inspect(s)).not.toContain(raw);
    expect(inspect({ nested: s })).not.toContain(raw);
    expect(s.reveal()).toBe(raw);
  });

  it('masks short values entirely', () => {
    expect(maskKey('abc')).toBe('••••');
  });

  it('registers its value for exact-match redaction', () => {
    const odd = 'zz-custom-provider-token-0001';
    new Secret(odd);
    expect(redact(`error: token ${odd} rejected`)).toBe(`error: token ${REDACTED} rejected`);
  });
});

describe('redact patterns', () => {
  const cases: [string, string][] = [
    ['anthropic', 'key=' + 'sk-ant' + '-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['openai', 'sk-' + 'proj-1234567890abcdefghijklmnop'],
    ['google', 'AIza' + 'SyA1234567890abcdefghijklmnopqrstuv'],
    ['aws', 'AKIA' + 'IOSFODNN7EXAMPLE'],
    ['groq', 'gsk' + '_abcdefghijklmnopqrstuvwxyz123456'],
    ['github', 'ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['hf', 'hf' + '_abcdefghijklmnopqrstuvwxyzABCDEFGH'],
    [
      'jwt',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ],
    ['bearer', 'Authorization: Bearer abcdefghijklmnop1234567890'],
    ['assignment', 'DB_PASSWORD="hunter2hunter2hunter2"'],
    ['url', 'postgres://admin:s3cr3tpass@db.internal:5432/app'],
    ['pem', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----'],
  ];
  it.each(cases)('redacts %s', (_name, input) => {
    const r = redactWithReport(`before ${input} after`);
    expect(r.count).toBeGreaterThan(0);
    expect(r.text).toContain(REDACTED);
    expect(r.text.startsWith('before ')).toBe(true);
  });

  it('keeps ordinary code untouched', () => {
    const code =
      'const total = items.reduce((a, b) => a + b.price, 0);\nfunction getToken() { return null; }';
    expect(redact(code)).toBe(code);
  });

  it('redacts sensitive keys deeply', () => {
    const out = redactDeep({
      headers: { authorization: 'Bearer xyz', 'x-other': 'ok' },
      list: ['sk-ant' + '-api03-bbbbbbbbbbbbbbbbbbbbbbbb'],
    });
    expect(out.headers.authorization).toBe(REDACTED);
    expect(out.headers['x-other']).toBe('ok');
    expect(out.list[0]).toBe(REDACTED);
  });
});

describe('logger', () => {
  it('writes redacted JSON lines', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'omni-log-')), 'x.log');
    const log = createLogger({ file, level: 'debug' });
    log.info('calling with ' + 'sk-ant' + '-api03-cccccccccccccccccccccccccc', {
      apiKey: 'plain',
      nested: { token: 'abc' },
    });
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('sk-ant-api03');
    expect(text).not.toContain('plain');
    expect(JSON.parse(text).data.apiKey).toBe(REDACTED);
  });
});
