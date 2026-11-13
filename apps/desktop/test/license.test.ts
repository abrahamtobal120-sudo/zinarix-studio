import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  licenseStatus,
  normalizeKey,
  parseLicense,
  signLicense,
  type LicensePayload,
} from '../src/main/license.js';
import { newer, parseRemote, verifyConfig } from '../src/main/remote.js';
import { EDITIONS, editionOf } from '../src/shared/edition.js';
import {
  AI_FEATURES,
  DEFAULT_PLANS,
  FREE_FEATURES,
  PRO_AI_FEATURES,
  PRO_FEATURES,
} from '../src/shared/plans.js';

/**
 * Plans and licenses: charging is off unless the owner turns it on from the (signed)
 * website config, only signed keys unlock plans, keys are checked offline and agents stay in
 * every plan.
 */

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 28);

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1,
  id: 'cs_test_1',
  plan: 'pro',
  email: 'ana@example.com',
  iat: NOW - DAY,
  ...over,
});
const keyFor = (p: LicensePayload) => signLicense(p, (d) => sign(null, d, privateKey));
const billingOn = { ...DEFAULT_PLANS, billing: true };

describe('license keys', () => {
  it('accepts a signed key, even pasted with spaces and line breaks', () => {
    const key = keyFor(payload({ name: 'Ana' }));
    const pasted = `  "${key.slice(0, 30)}\n ${key.slice(30)}" `;
    expect(normalizeKey(pasted)).toBe(key);
    expect(parseLicense(pasted, PUB)).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
  });

  it('rejects tampered, foreign and malformed keys', () => {
    const key = keyFor(payload());
    const [head, body, sig] = key.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...payload(), email: 'pirata@example.com' }),
    ).toString('base64url');
    expect(() => parseLicense(`${head}.${forged}.${sig}`, PUB)).toThrow(/firma/);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    expect(() => parseLicense(key, other.toString())).toThrow(/firma/);
    expect(() => parseLicense('hola', PUB)).toThrow(/ZX1/);
    expect(() => parseLicense(`ZX1.${body}`, PUB)).toThrow(/ZX1/);
    // A key signed with the app's real key cannot be made without the private key.
    expect(() => parseLicense(key)).toThrow(/firma/);
  });

  it('the old owner flag and plan codes in the state file grant nothing in a packaged app', () => {
    for (const s of [{ owner: true }, { codePlan: 'proai' as const }]) {
      const st = licenseStatus({ ...s, plans: billingOn, billingSince: NOW - 99 * DAY }, NOW, PUB);
      expect(st.plan).toBe('free');
    }
  });
});

describe('plans forced from the state file (development builds only)', () => {
  const dev = { devPlans: true };
  it('a forced plan beats charging on or off; "free" is the free plan even when open', () => {
    for (const plans of [DEFAULT_PLANS, billingOn]) {
      expect(licenseStatus({ codePlan: 'free', plans }, NOW, PUB, undefined, dev)).toMatchObject({
        plan: 'free',
        features: FREE_FEATURES,
        code: true,
      });
      expect(licenseStatus({ codePlan: 'pro', plans }, NOW, PUB, undefined, dev).features).toEqual(
        PRO_FEATURES,
      );
      expect(licenseStatus({ codePlan: 'ai', plans }, NOW, PUB, undefined, dev).features).toEqual(
        AI_FEATURES,
      );
      expect(licenseStatus({ codePlan: 'proai', plans }, NOW, PUB, undefined, dev).features).toEqual(
        PRO_AI_FEATURES,
      );
    }
  });

  it('AI and Pro + AI keys grant their plan', () => {
    for (const plan of ['ai', 'proai'] as const) {
      const st = licenseStatus({ license: keyFor(payload({ plan })), plans: billingOn }, NOW, PUB);
      expect(st.plan).toBe(plan);
      expect(st.features.ai).toBe(true);
    }
  });
});

describe('plan of an installation', () => {
  it('is open (everything, nothing to pay) while charging is off', () => {
    for (const s of [{}, { firstRun: NOW - 400 * DAY }, { plans: DEFAULT_PLANS }]) {
      const st = licenseStatus(s, NOW, PUB);
      expect(st.plan).toBe('open');
      expect(st.billing).toBe(false);
      expect(st.features).toEqual(PRO_FEATURES);
    }
  });

  it('starts the trial when charging is switched on, even for long-time users', () => {
    const st = licenseStatus(
      { plans: billingOn, firstRun: NOW - 300 * DAY, billingSince: NOW - 2 * DAY },
      NOW,
      PUB,
    );
    expect(st).toMatchObject({ plan: 'trial', trialDaysLeft: 12, features: PRO_FEATURES });
  });

  it('falls back to the free plan after the trial, agents (delegation) included', () => {
    const plans = { ...billingOn, free: { ...FREE_FEATURES, maxChats: 3 } };
    const st = licenseStatus({ plans, billingSince: NOW - 20 * DAY }, NOW, PUB);
    expect(st.plan).toBe('free');
    expect(st.features).toMatchObject({ maxChats: 3, split: false, windows: false });
    expect(st.features.delegation).toBe(true);
  });

  it('a valid key is Pro; an expired one says why and falls back', () => {
    const pro = licenseStatus(
      { plans: billingOn, billingSince: NOW - 30 * DAY, license: keyFor(payload()) },
      NOW,
      PUB,
    );
    expect(pro).toMatchObject({ plan: 'pro', email: 'ana@example.com', expires: null });
    const old = licenseStatus(
      {
        plans: billingOn,
        billingSince: NOW - 30 * DAY,
        license: keyFor(payload({ exp: NOW - DAY })),
      },
      NOW,
      PUB,
    );
    expect(old.plan).toBe('free');
    expect(old.problem).toMatch(/venció/);
  });

  it('a signed owner key beats everything, charging on or off', () => {
    const license = keyFor(payload({ plan: 'proai', owner: true }));
    for (const plans of [DEFAULT_PLANS, billingOn]) {
      const st = licenseStatus({ license, plans, billingSince: NOW - 99 * DAY }, NOW, PUB);
      expect(st.plan).toBe('owner');
      expect(st.features).toEqual(PRO_AI_FEATURES);
    }
    const forged = license.replace(/\.[^.]+$/, '.AAAA');
    expect(licenseStatus({ license: forged, plans: billingOn }, NOW, PUB).plan).toBe('trial');
  });

  it('a revoked key (refund, dispute) stops counting and says why', () => {
    const st = licenseStatus(
      {
        license: keyFor(payload()),
        revoked: ['cs_test_1'],
        plans: billingOn,
        billingSince: NOW - 30 * DAY,
      },
      NOW,
      PUB,
    );
    expect(st.plan).toBe('free');
    expect(st.problem).toMatch(/cancelada/);
  });
});

describe('remote control file (app-config.json)', () => {
  it('the published file keeps charging off and parses', () => {
    const file = fileURLToPath(new URL('../../../website/app-config.json', import.meta.url));
    const cfg = parseRemote(JSON.parse(readFileSync(file, 'utf8')));
    expect(cfg.plans.billing).toBe(false);
    expect(cfg.plans.free.delegation).toBe(true);
  });

  it('fills defaults, keeps agents in the free plan and reads notices and versions', () => {
    const cfg = parseRemote({
      billing: true,
      free: { maxChats: 1, split: false, windows: false, delegation: false },
      notice: { id: 'v0.6', text: 'Nueva versión', url: 'https://example.com' },
      latestVersion: '0.6.0',
    });
    expect(cfg.plans).toMatchObject({ billing: true, trialDays: 14 });
    expect(cfg.plans.free.delegation).toBe(true);
    expect(cfg.notice?.id).toBe('v0.6');
    expect(cfg.latestVersion).toBe('0.6.0');
    expect(parseRemote({}).plans).toEqual(DEFAULT_PLANS);
  });

  it('reads the revoked list', () => {
    expect(parseRemote({ revoked: ['cs_live_x'] }).revoked).toEqual(['cs_live_x']);
    expect(parseRemote({}).revoked).toEqual([]);
  });

  it('only trusts a config signed with the seller key, under its own prefix', () => {
    const body = JSON.stringify({ billing: true });
    const good = sign(null, Buffer.from(`zinarix-app-config:v1:${body}`), privateKey).toString(
      'base64',
    );
    expect(verifyConfig(body, good, PUB)).toBe(true);
    expect(verifyConfig(JSON.stringify({ billing: false }), good, PUB)).toBe(false);
    // A license signature is not a config signature.
    const raw = sign(null, Buffer.from(body), privateKey).toString('base64');
    expect(verifyConfig(body, raw, PUB)).toBe(false);
    expect(verifyConfig(body, 'nope', PUB)).toBe(false);
    expect(verifyConfig(body, good)).toBe(false);
  });

  it('rejects unsafe links and odd versions', () => {
    expect(() => parseRemote({ buyUrl: 'http://evil.example' })).toThrow();
    expect(() => parseRemote({ notice: { id: 'a', text: 'b', url: 'javascript:1' } })).toThrow();
    expect(() => parseRemote({ latestVersion: 'latest' })).toThrow();
  });

  it('compares versions', () => {
    expect(newer('0.6.0', '0.5.0')).toBe(true);
    expect(newer('0.10.0', '0.9.9')).toBe(true);
    expect(newer('0.5.0', '0.5.0')).toBe(false);
    expect(newer('0.4.9', '0.5.0')).toBe(false);
  });
});

describe('website: /api/license (after a Stripe payment)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  let ip = 0;
  async function call(session: Record<string, unknown> | null, id = 'cs_test_abc123') {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    if (!('STRIPE_PAYMENT_LINK' in process.env) && !process.env.STRIPE_LINK_AI)
      process.env.STRIPE_PAYMENT_LINK = 'plink_1';
    process.env.LICENSE_PRIVATE_KEY = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString()
      .replace(/\n/g, '\\n');
    const fetchMock = vi.fn(async () =>
      session
        ? new Response(JSON.stringify(session), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const url = pathToFileURL(
      fileURLToPath(new URL('../../../website/api/license.mjs', import.meta.url)),
    ).href;
    const handler = (await import(url)).default as (req: unknown, res: unknown) => Promise<void>;
    const out: { status?: number; body?: { key?: string; error?: string } } = {};
    const res = {
      setHeader: () => res,
      status(n: number) {
        out.status = n;
        return res;
      },
      json(b: { key?: string }) {
        out.body = b;
        return res;
      },
    };
    await handler({ query: { session_id: id }, headers: { 'x-real-ip': `10.0.0.${++ip}` } }, res);
    return { ...out, fetchMock };
  }

  const paid = {
    id: 'cs_test_abc123',
    status: 'complete',
    mode: 'payment',
    payment_status: 'paid',
    created: Math.floor(Date.now() / 1000) - 60,
    payment_intent: {
      status: 'succeeded',
      latest_charge: { refunded: false, amount_refunded: 0, disputed: false },
    },
    customer_details: { email: 'ana@example.com', name: 'Ana' },
    payment_link: 'plink_1',
    metadata: {},
  };

  it('a paid session gets a key the app accepts, and always the same one', async () => {
    const a = await call(paid);
    expect(a.status).toBe(200);
    const p = parseLicense(a.body!.key!, PUB);
    expect(p).toMatchObject({ id: 'cs_test_abc123', email: 'ana@example.com', name: 'Ana' });
    expect(p.exp).toBeUndefined();
    const b = await call(paid);
    expect(b.body!.key).toBe(a.body!.key);
    // The page only shows a hint of the email.
    expect((a.body as { email?: string }).email).toBe('a…@example.com');
  });

  it('refunded, disputed or revoked purchases get no key', async () => {
    const charge = paid.payment_intent.latest_charge;
    const withCharge = (c: object) => ({
      ...paid,
      payment_intent: { ...paid.payment_intent, latest_charge: { ...charge, ...c } },
    });
    expect((await call(withCharge({ refunded: true }))).status).toBe(403);
    expect((await call(withCharge({ amount_refunded: 500 }))).status).toBe(403);
    expect((await call(withCharge({ disputed: true }))).status).toBe(403);
    process.env.REVOKED_LICENSES = 'cs_test_zzz, cs_test_abc123';
    const r = await call(paid);
    expect(r.status).toBe(403);
    expect(r.fetchMock).not.toHaveBeenCalled();
  });

  it('a session id stops handing out the key after the claim window', async () => {
    const old = await call({ ...paid, created: Math.floor(Date.now() / 1000) - 10 * 86_400 });
    expect(old.status).toBe(410);
  });

  it('with no payment link configured, no purchase gets a key', async () => {
    process.env.STRIPE_PAYMENT_LINK = '';
    const r = await call(paid);
    expect(r.status).toBe(503);
    expect(r.fetchMock).not.toHaveBeenCalled();
  });

  it('keys can expire (per payment link metadata)', async () => {
    const r = await call({ ...paid, metadata: { days: '365' } });
    expect(parseLicense(r.body!.key!, PUB).exp).toBe(paid.created * 1000 + 365 * DAY);
  });

  it('the payment link decides the plan', async () => {
    process.env.STRIPE_PAYMENT_LINK = 'plink_pro';
    process.env.STRIPE_LINK_AI = 'plink_ai';
    const r = await call({ ...paid, payment_link: 'plink_ai' });
    expect(parseLicense(r.body!.key!, PUB).plan).toBe('ai');
    delete process.env.STRIPE_PAYMENT_LINK;
    delete process.env.STRIPE_LINK_AI;
  });

  it('no key for unpaid, unknown, foreign or malformed purchases', async () => {
    expect((await call({ ...paid, payment_status: 'unpaid' })).status).toBe(402);
    expect((await call(null)).status).toBe(404);
    process.env.STRIPE_PAYMENT_LINK = 'plink_other';
    expect((await call(paid)).status).toBe(403);
    delete process.env.STRIPE_PAYMENT_LINK;
    const bad = await call(paid, '../../v1/charges');
    expect(bad.status).toBe(400);
    expect(bad.fetchMock).not.toHaveBeenCalled();
  });
});

describe('editions (one app per plan)', () => {
  it('the standard app is unchanged', () => {
    const dev = { devPlans: true };
    const st = licenseStatus({ codePlan: 'proai' }, NOW, PUB, EDITIONS.standard, dev);
    expect(st.features).toEqual(PRO_AI_FEATURES);
    expect(st.edition).toBeUndefined();
  });

  it('an edition never grants more than its plan', () => {
    expect(licenseStatus({}, NOW, PUB, EDITIONS.ai).features).toEqual(FREE_FEATURES);
    const dev = { devPlans: true };
    expect(licenseStatus({ codePlan: 'proai' }, NOW, PUB, EDITIONS.pro, dev).features).toEqual(
      PRO_FEATURES,
    );
    expect(licenseStatus({ codePlan: 'proai' }, NOW, PUB, EDITIONS.ai, dev).features).toEqual(
      AI_FEATURES,
    );
  });

  it('a key of another plan says which app to download', () => {
    const st = licenseStatus(
      { license: keyFor(payload({ plan: 'ai' })), plans: billingOn },
      NOW,
      PUB,
      EDITIONS.pro,
    );
    expect(st.edition).toBe('pro');
    expect(st.features).toEqual(FREE_FEATURES);
    expect(st.problem).toMatch(/Zinarix Studio AI/);
  });

  it('editionOf falls back to the standard app', () => {
    expect(editionOf(undefined)).toBe(EDITIONS.standard);
    expect(editionOf('nope')).toBe(EDITIONS.standard);
    expect(editionOf('proai').productName).toBe('Zinarix Studio Pro + AI');
  });
});
