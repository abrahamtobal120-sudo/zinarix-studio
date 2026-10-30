import { createHash, createPublicKey, verify } from 'node:crypto';
import type { LicenseStatus, PlansConfig } from '../shared/plans.js';
import { DEFAULT_PLANS, PRO_FEATURES } from '../shared/plans.js';

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

export interface LicensePayload {
  v: 1;
  /** Unique id (the payment it came from). */
  id: string;
  plan: 'pro';
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
  if (p.v !== 1 || p.plan !== 'pro' || typeof p.email !== 'string')
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
  if (s.owner) return { ...base, plan: 'owner', features: PRO_FEATURES, expires: null };
  let problem: string | undefined;
  if (s.license) {
    try {
      const p = parseLicense(s.license, publicKeyPem);
      if (p.exp && p.exp < now) problem = 'Tu licencia Pro venció. Renuévala para seguir con Pro.';
      else
        return {
          ...base,
          plan: 'pro',
          features: PRO_FEATURES,
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
