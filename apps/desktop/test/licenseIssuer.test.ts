import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { licenseStatus, parseLicense } from '../src/main/license';
import { GIFT_COUNT, LicenseIssuer } from '../src/main/licenseIssuer';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zs-issuer-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyPath = join(dir, 'license.key');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { dir, keyPath, pub };
}

describe('LicenseIssuer', () => {
  it('makes 30 gift Pro + AI keys once, valid and never expiring', () => {
    const { keyPath, pub } = setup();
    const iss = new LicenseIssuer({ keyPath, publicKeyPem: pub });
    const st = iss.ensureGifts();
    expect(st.available).toBe(true);
    expect(st.keys.filter((k) => k.gift)).toHaveLength(GIFT_COUNT);
    expect(iss.ensureGifts().keys).toHaveLength(GIFT_COUNT);
    for (const k of st.keys) {
      const p = parseLicense(k.key, pub);
      expect(p.plan).toBe('proai');
      expect(p.exp).toBeUndefined();
      expect(licenseStatus({ license: k.key }, Date.now(), pub).plan).toBe('proai');
    }
  });

  it('issues keys with expiry and marks them as given', () => {
    const { keyPath, pub } = setup();
    const iss = new LicenseIssuer({ keyPath, publicKeyPem: pub, now: () => 1000 });
    const st = iss.issue({ plan: 'pro', email: 'a@b.c', days: 10, count: 3 });
    expect(st.keys).toHaveLength(3);
    expect(parseLicense(st.keys[0]!.key, pub).exp).toBe(1000 + 10 * 86_400_000);
    const m = iss.mark(st.keys[0]!.id, true, 'Juan');
    expect(m.keys.find((k) => k.id === st.keys[0]!.id)).toMatchObject({
      given: true,
      note: 'Juan',
    });
  });

  it('refuses a private key that does not match the app', () => {
    const { keyPath } = setup();
    const other = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString();
    const iss = new LicenseIssuer({ keyPath, publicKeyPem: other });
    expect(iss.status().available).toBe(false);
    expect(() => iss.issue({ plan: 'proai' })).toThrow();
  });
});
