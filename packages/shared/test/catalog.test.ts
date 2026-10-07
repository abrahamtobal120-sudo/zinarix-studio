import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Catalog, exitCodeFor, OmniError, setLocale, t } from '@omni/shared';

const root = new URL('../../../catalog/', import.meta.url);
const bytes = readFileSync(new URL('providers.json', root));
const catalog = Catalog.parse(JSON.parse(bytes.toString('utf8')));

describe('providers.json', () => {
  it('has the 50 required providers with unique ids', () => {
    expect(catalog.providers.length).toBeGreaterThanOrEqual(50);
    expect(new Set(catalog.providers.map((p) => p.id)).size).toBe(catalog.providers.length);
  });

  it('covers every category including local runtimes', () => {
    const cats = new Set(catalog.providers.map((p) => p.category));
    for (const c of ['lab', 'aggregator', 'enterprise', 'asia', 'local']) expect(cats).toContain(c);
  });

  it('records a verification date for every active provider', () => {
    const missing = catalog.providers.filter(
      (p) => p.status === 'active' && p.category !== 'local' && !p.verifiedAt,
    );
    expect(missing.map((p) => p.id)).toEqual([]);
  });

  it('declares placeholders for every templated base URL', () => {
    for (const p of catalog.providers) {
      const names = [...p.baseUrl.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
      for (const n of names)
        expect(
          p.baseUrlParams.map((x) => x.name),
          p.id,
        ).toContain(n);
    }
  });

  it('is signed with the bundled Ed25519 key', () => {
    const sig = readFileSync(new URL('providers.json.sig', root), 'utf8');
    const pub = createPublicKey(readFileSync(new URL('keys/catalog.pub', root)));
    expect(verify(null, bytes, pub, Buffer.from(sig.trim(), 'base64'))).toBe(true);
  });
});

describe('i18n + errors', () => {
  it('translates in both languages', () => {
    setLocale('en');
    expect(t('auth.saved', { provider: 'Groq', store: 'keychain' })).toBe(
      'Groq key saved to keychain.',
    );
    setLocale('es');
    expect(t('auth.saved', { provider: 'Groq', store: 'keychain' })).toBe(
      'Llave de Groq guardada en keychain.',
    );
  });

  it('maps error codes to stable exit codes', () => {
    expect(exitCodeFor(new OmniError('auth', 'x'))).toBe(3);
    expect(exitCodeFor(new OmniError('rate_limit', 'x'))).toBe(4);
    expect(exitCodeFor(new OmniError('budget', 'x'))).toBe(5);
    expect(exitCodeFor(new Error('x'))).toBe(1);
  });
});
