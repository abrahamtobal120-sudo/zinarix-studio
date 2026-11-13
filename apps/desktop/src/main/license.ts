import { createPublicKey, verify } from 'node:crypto';
import type { LicenseStatus, PaidPlan, PlanFeatures, PlansConfig } from '../shared/plans.js';
import {
  AI_FEATURES,
  DEFAULT_PLANS,
  FREE_FEATURES,
  PRO_AI_FEATURES,
  PRO_FEATURES,
} from '../shared/plans.js';
import type { Edition } from '../shared/edition.js';
import { clampFeatures, EDITIONS } from '../shared/edition.js';

/**
 * License keys: `ZX1.<payload>.<signature>`, where payload is base64url JSON and the
 * signature is Ed25519 over `ZX1.<payload>`, made with the private key that only the seller
 * has (scripts/license.mjs, or the website after a payment). The app only holds the public
 * key below, so it can check a key offline but never make one.
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8L5XRiEBieWNmEXBKBQENGnNfXs3bcTX/WYhD0tuBiU=
-----END PUBLIC KEY-----`;

const PAID: PaidPlan[] = ['pro', 'ai', 'proai'];

/** What each plan you can buy or set with a code includes. */
export const PLAN_FEATURES: Record<PaidPlan, PlanFeatures> = {
  free: FREE_FEATURES,
  pro: PRO_FEATURES,
  ai: AI_FEATURES,
  proai: PRO_AI_FEATURES,
};

/**
 * What a plan grants with the website's settings: AI is the free plan plus Zinarix AI, so it
 * follows the free plan the website sets (the plan table shows the same numbers for both).
 */
function planFeatures(plan: PaidPlan, cfg: PlansConfig): PlanFeatures {
  if (plan === 'free') return cfg.free;
  if (plan === 'ai') return { ...cfg.free, ai: true };
  return PLAN_FEATURES[plan];
}

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
  /** The app's author: everything, in any edition (made with scripts/license.mjs --owner). */
  owner?: boolean;
}

const b64url = (b: Buffer) => b.toString('base64url');

/** Keys pasted from an email often carry spaces, line breaks or quotes. */
export function normalizeKey(input: string): string {
  return input.replace(/[\s"'`]+/g, '');
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
  /** Old installs: the owner's word. Ignored now (the owner uses a signed key). */
  owner?: boolean;
  /**
   * A plan forced from the state file, for screenshots and tests. Only honoured in
   * development builds (licenseStatus(..., { devPlans: true })); packaged apps ignore it.
   */
  codePlan?: PaidPlan;
  /** License ids the seller revoked (refunds, disputes), from the signed app-config.json. */
  revoked?: string[];
  /** First launch (ms). */
  firstRun?: number;
  /** When this copy first saw billing switched on (ms): the trial runs from here. */
  billingSince?: number;
  /** Last plans.json read from the website (used offline). */
  plans?: PlansConfig;
}

const DAY = 86_400_000;

const PLAN_LABEL: Record<PaidPlan, string> = {
  free: 'Gratis',
  pro: 'Pro',
  ai: 'AI',
  proai: 'Pro + AI',
};

/** What this installation may use right now (inside what its edition can grant). */
export function licenseStatus(
  s: StoredLicense,
  now = Date.now(),
  publicKeyPem = LICENSE_PUBLIC_KEY,
  edition: Edition = EDITIONS.standard,
  opts: { devPlans?: boolean } = {},
): LicenseStatus {
  const st = planStatus(s, now, publicKeyPem, opts.devPlans === true);
  if (edition.id === 'standard') return st;
  const out: LicenseStatus = {
    ...st,
    edition: edition.id,
    features: clampFeatures(st.features, edition.ceiling),
  };
  const plan = st.plan;
  if ((plan === 'pro' || plan === 'ai' || plan === 'proai') && !edition.plans.includes(plan))
    out.problem = `Tu clave es del plan ${PLAN_LABEL[plan]}: esta app es ${edition.productName}. Descarga Zinarix Studio ${PLAN_LABEL[plan]} para usarla completa.`;
  return out;
}

function planStatus(
  s: StoredLicense,
  now: number,
  publicKeyPem: string,
  devPlans: boolean,
): LicenseStatus {
  const cfg = s.plans ?? DEFAULT_PLANS;
  const base = { billing: cfg.billing, buyUrl: cfg.buyUrl, free: cfg.free };
  if (devPlans && s.codePlan && s.codePlan in PLAN_FEATURES) {
    // "zinarix at": the free plan as people will get it once charging is on.
    if (s.codePlan === 'free') return { ...base, plan: 'free', features: cfg.free, code: true };
    return {
      ...base,
      plan: s.codePlan,
      features: planFeatures(s.codePlan, cfg),
      expires: null,
      code: true,
    };
  }
  let problem: string | undefined;
  if (s.license) {
    try {
      const p = parseLicense(s.license, publicKeyPem);
      if (s.revoked?.includes(p.id))
        problem = 'Esta licencia fue cancelada (reembolso o disputa del pago).';
      else if (p.exp && p.exp < now)
        problem = 'Tu licencia venció. Renuévala para seguir con tu plan.';
      else if (p.owner)
        return { ...base, plan: 'owner', features: PRO_AI_FEATURES, expires: p.exp ?? null };
      else
        return {
          ...base,
          plan: p.plan,
          features: planFeatures(p.plan, cfg),
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
