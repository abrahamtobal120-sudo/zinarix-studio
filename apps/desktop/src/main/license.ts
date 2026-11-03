import { createHash, createPublicKey, verify } from 'node:crypto';
import type { LicenseStatus, PaidPlan, PlanFeatures, PlansConfig } from '../shared/plans.js';
import {
  AI_FEATURES,
  DEFAULT_PLANS,
  FREE_FEATURES,
  PRO_AI_FEATURES,
  PRO_FEATURES,
} from '../shared/plans.js';

/**
 * License keys: `ZX1.<payload>.<signature>`, where payload is base64url JSON and the
 * signature is Ed25519 over `ZX1.<payload>`, made with the private key that only the seller
 * has (scripts/license.mjs, or the website after a payment). The app only holds the public
 * key below, so it can check a key offline but never make one.
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8L5XRiEBieWNmEXBKBQENGnNfXs3bcTX/WYhD0tuBiU=
-----END PUBLIC KEY-----`;

/** SHA-256 of the owner's word (the app's author uses it instead of buying a license). */
const OWNER_HASH = '74eda8cdcd7947be8e6f67efe64ea6e8b37ed31f6b29a075406629cd091ebe56';

/**
 * Plan codes (SHA-256 of `zinarix-plan:<code without spaces>`): typed where a key goes, they
 * put this copy on a plan, to try each one. zinarix at: free (even while charging is off),
 * zinarixpro at: Pro, zinarixai at: AI, zinarixproai at: Pro + AI.
 */
const PLAN_CODES: Record<string, PaidPlan> = {
  '242803bc4121ebb5b325318a6176ac7ac928527e56b243f4d28bf4482d3ebbee': 'free',
  '43745c65a7ffdb389eaaccdfce85190ebb0e93b240d52b91c6507aa02e382578': 'pro',
  '66de10d753ffcecb2c929329cdb17e26f02060d90e43e1aefb5546dd52f41cf8': 'ai',
  '3629e4aa99e26c97b6fe1a0700baa36d614e820406c9a6b9c4bf5b72c4e46c2b': 'proai',
};

const PAID: PaidPlan[] = ['pro', 'ai', 'proai'];

/** What each plan you can buy or set with a code includes. */
export const PLAN_FEATURES: Record<PaidPlan, PlanFeatures> = {
  free: FREE_FEATURES,
  pro: PRO_FEATURES,
  ai: AI_FEATURES,
  proai: PRO_AI_FEATURES,
};

export interface LicensePayload {
  v: 1;
  /** Unique id (the payment it came from). */
  id: string;
  /** Keys made before AI existed are all 'pro'. */
  plan: Exclude<PaidPlan, 'free'>;
  email: string;
  name?: string;
  /** Issued at (ms). */
  iat: number;
  /** Expires at (ms); null or absent: never. */
  exp?: number | null;
}

const b64url = (b: Buffer) => b.toString('base64url');

/** Keys pasted from an email often carry spaces, line breaks or quotes. */
export function normalizeKey(input: string): string {
  return input.replace(/[\s"'`]+/g, '');
}

export function isOwnerCode(input: string): boolean {
  const word = input.trim().toLowerCase();
  if (!word || word.length > 64) return false;
  return createHash('sha256').update(`zinarix-owner:${word}`).digest('hex') === OWNER_HASH;
}

/** The plan a code sets (any case, with or without spaces), or null. */
export function planCode(input: string): PaidPlan | null {
  const word = input.replace(/\s+/g, '').toLowerCase();
  if (!word || word.length > 64) return null;
  const hash = createHash('sha256').update(`zinarix-plan:${word}`).digest('hex');
  return PLAN_CODES[hash] ?? null;
}

/** Checks a license key and returns what it grants; throws a readable error otherwise. */
export function parseLicense(input: string, publicKeyPem = LICENSE_PUBLIC_KEY): LicensePayload {
  const key = normalizeKey(input);
  const m = /^ZX1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key);
  if (!m) throw new Error('Esa no es una clave de licencia de Zinarix Studio (empieza con ZX1.).');
  const signed = Buffer.from(`ZX1.${m[1]}`);
  const ok = verify(null, signed, createPublicKey(publicKeyPem), Buffer.from(m[2]!, 'base64url'));
  if (!ok) throw new Error('La clave de licencia no es válida (la firma no coincide).');
  let p: LicensePayload;
  try {
    p = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')) as LicensePayload;
  } catch {
    throw new Error('La clave de licencia está dañada.');
  }
  if (p.v !== 1 || !PAID.includes(p.plan) || typeof p.email !== 'string')
    throw new Error('Esta clave es de una versión más nueva de Zinarix Studio: actualiza la app.');
  return p;
}

/** Makes a key (seller side: scripts/license.mjs and the website use the same format). */
export function signLicense(payload: LicensePayload, sign: (data: Buffer) => Buffer): string {
  const body = `ZX1.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  return `${body}.${b64url(sign(Buffer.from(body)))}`;
}

export interface StoredLicense {
  /** The activated key, if any. */
  license?: string;
  /** Activated with the owner's word. */
  owner?: boolean;
  /** Set with a plan code (zinarix at, zinarixpro at…). */
  codePlan?: PaidPlan;
  /** First launch (ms). */
  firstRun?: number;
  /** When this copy first saw billing switched on (ms): the trial runs from here. */
  billingSince?: number;
  /** Last plans.json read from the website (used offline). */
  plans?: PlansConfig;
}

const DAY = 86_400_000;

/** What this installation may use right now. */
export function licenseStatus(
  s: StoredLicense,
  now = Date.now(),
  publicKeyPem = LICENSE_PUBLIC_KEY,
): LicenseStatus {
  const cfg = s.plans ?? DEFAULT_PLANS;
  const base = { billing: cfg.billing, buyUrl: cfg.buyUrl, free: cfg.free };
  if (s.owner) return { ...base, plan: 'owner', features: PRO_AI_FEATURES, expires: null };
  if (s.codePlan && s.codePlan in PLAN_FEATURES) {
    // "zinarix at": the free plan as people will get it once charging is on.
    if (s.codePlan === 'free') return { ...base, plan: 'free', features: cfg.free, code: true };
    return {
      ...base,
      plan: s.codePlan,
      features: PLAN_FEATURES[s.codePlan],
      expires: null,
      code: true,
    };
  }
  let problem: string | undefined;
  if (s.license) {
    try {
      const p = parseLicense(s.license, publicKeyPem);
      if (p.exp && p.exp < now) problem = 'Tu licencia venció. Renuévala para seguir con tu plan.';
      else
        return {
          ...base,
          plan: p.plan,
          features: PLAN_FEATURES[p.plan],
          email: p.email,
          name: p.name,
          expires: p.exp ?? null,
        };
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  // Charging off (the owner's switch): everything for everyone.
  if (!cfg.billing) return { ...base, plan: 'open', features: PRO_FEATURES };
  // The trial starts when this copy first sees charging on, never earlier: people who
  // used the app while it was free still get their full trial.
  const start = Math.max(s.billingSince ?? now, s.firstRun ?? 0);
  const trialEndsAt = start + cfg.trialDays * DAY;
  if (now < trialEndsAt)
    return {
      ...base,
      plan: 'trial',
      features: PRO_FEATURES,
      trialEndsAt,
      trialDaysLeft: Math.max(1, Math.ceil((trialEndsAt - now) / DAY)),
      ...(problem ? { problem } : {}),
    };
  return {
    ...base,
    plan: 'free',
    features: cfg.free,
    trialEndsAt,
    ...(problem ? { problem } : {}),
  };
}
