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
    expect(maskKey('key-abc123456')).toBe('••••');
    // Medium keys keep only the prefix: the last 4 would be too large a share.
    expect(maskKey('key-abc1234567890xy')).toBe('key-••••');
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
    // The secret itself must be gone, not just a marker added next to it.
    const secret = input.replace(/^.*?(?:key=|Bearer |PASSWORD="|admin:)/s, '').slice(0, 12);
    expect(r.text).not.toContain(secret);
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

describe('redactDeep(Error)', () => {
  it('keeps name, message and stack, redacted', () => {
    const key = 'sk-' + 'proj-ERRORERRORERRORERRORERROR00';
    const out = redactDeep(new TypeError(`bad key ${key}`)) as unknown as Record<string, string>;
    expect(out.name).toBe('TypeError');
    expect(out.message).toBe(`bad key ${REDACTED}`);
    expect(out.stack).toContain('TypeError');
    expect(JSON.stringify(out)).not.toContain(key);
  });
});

describe('logger', () => {
  it('survives unserializable data', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'omni-log-')), 'x.log');
    expect(() => createLogger({ file }).info('x', { big: 10n })).not.toThrow();
    expect(readFileSync(file, 'utf8')).toContain('[unserializable]');
  });

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

describe('provider key formats', () => {
  it.each([
    ['google-oauth', `ya29.${'a1B2'.repeat(10)}`],
    ['perplexity', `pplx-${'a1'.repeat(24)}`],
    ['replicate', `r8_${'Ab3'.repeat(12)}`],
    ['nvidia', `nvapi-${'xY9_'.repeat(14)}`],
    ['cerebras', `csk-${'k3y'.repeat(12)}`],
    ['fireworks', `fw_${'Q8w'.repeat(9)}`],
    ['together', `tgp_v1_${'Zz1'.repeat(12)}`],
    ['gitlab', `glpat-${'Ab1'.repeat(8)}`],
    ['npm', `npm_${'A1b2'.repeat(9)}`],
    ['stripe-webhook', `whsec_${'Wh1'.repeat(10)}`],
    ['supabase', `sbp_${'5ab'.repeat(14)}`],
  ])('redacts %s keys', (_id, key) => {
    expect(redact(`key = ${key} end`)).not.toContain(key);
  });
});

describe('StreamRedactor', () => {
  it('redacts a registered secret split across chunks, and keeps the text intact', async () => {
    const { StreamRedactor, registerSecret: reg } = await import('../src/redact.js');
    const key = 'zz-registered-stream-secret-0123456789';
    reg(key);
    const text = `Intro text that is long enough to stream. Your key is ${key} — keep it safe. ${'More words follow here. '.repeat(10)}`;
    for (const size of [1, 3, 7, 50]) {
      const r = new StreamRedactor();
      let out = '';
      for (let i = 0; i < text.length; i += size) out += r.push(text.slice(i, i + size));
      out += r.flush();
      expect(out).not.toContain(key);
      expect(out).toBe(text.replace(key, REDACTED));
    }
  });

  it('holds an unfinished private key block until it ends', async () => {
    const { StreamRedactor } = await import('../src/redact.js');
    const pem = `-----BEGIN PRIVATE KEY-----\n${'QUJD'.repeat(80)}\n-----END PRIVATE KEY-----`;
    const r = new StreamRedactor();
    let out = '';
    for (const line of `start ${pem} end`.split(/(?<=\n)/)) out += r.push(line);
    out += r.flush();
    expect(out).not.toContain('QUJDQUJD');
  });
});
