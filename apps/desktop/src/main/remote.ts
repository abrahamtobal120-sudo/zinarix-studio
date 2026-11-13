import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { LICENSE_PUBLIC_KEY } from './license.js';
import type { PlansConfig, RemoteNotice } from '../shared/plans.js';
import { CONFIG_URL, DEFAULT_PLANS, DOWNLOAD_URL } from '../shared/plans.js';

const REPO = 'abrahamtobal120-sudo/zinarix-studio';

const features = z.object({
  maxChats: z.number().int().min(1).max(999),
  split: z.boolean(),
  windows: z.boolean(),
  delegation: z.boolean().default(true),
});

/** app-config.json: anything missing or wrong falls back to the safe default (free for all). */
const Remote = z.object({
  billing: z.boolean().default(false),
  trialDays: z.number().int().min(0).max(365).default(DEFAULT_PLANS.trialDays),
  free: features.default(DEFAULT_PLANS.free),
  buyUrl: z.string().url().startsWith('https://').default(DEFAULT_PLANS.buyUrl),
  latestVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  downloadUrl: z.string().url().startsWith('https://').optional(),
  /** License ids (Stripe session ids) that no longer count: refunds, disputes. */
  revoked: z.array(z.string().min(1).max(200)).max(20_000).default([]),
  notice: z
    .object({
      id: z.string().min(1).max(100),
      text: z.string().min(1).max(500),
      url: z.string().url().startsWith('https://').optional(),
    })
    .optional(),
});

export interface RemoteConfig {
  plans: PlansConfig;
  notice?: RemoteNotice;
  latestVersion?: string;
  downloadUrl: string;
  revoked: string[];
}

export function parseRemote(json: unknown): RemoteConfig {
  const r = Remote.parse(json);
  return {
    plans: {
      billing: r.billing,
      trialDays: r.trialDays,
      // Agents (delegation included) are in every plan.
      free: { ...r.free, delegation: true },
      buyUrl: r.buyUrl,
    },
    notice: r.notice,
    latestVersion: r.latestVersion,
    downloadUrl: r.downloadUrl ?? DOWNLOAD_URL,
    revoked: r.revoked,
  };
}

async function getJson(url: string): Promise<unknown> {
  return JSON.parse(await getText(url));
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json', 'User-Agent': 'ZinarixStudio' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** What the signature of app-config.json covers (scripts/sign-app-config.mjs). */
const CONFIG_DOMAIN = 'zinarix-app-config:v1:';

/**
 * app-config.json is signed with the seller's Ed25519 key (the same one licenses use, under
 * its own prefix) into app-config.json.sig: a copy or a proxy cannot switch charging off.
 */
export function verifyConfig(body: string, sigB64: string, publicKeyPem = LICENSE_PUBLIC_KEY) {
  try {
    return verify(
      null,
      Buffer.from(CONFIG_DOMAIN + body, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(sigB64.trim(), 'base64'),
    );
  } catch {
    return false;
  }
}

export interface FetchRemoteOptions {
  /** Packaged apps: always the official URL, and only a signed file counts. */
  packaged: boolean;
  publicKeyPem?: string;
}

/**
 * The owner's control file; null when unreachable or unsigned (the last known one stays in
 * use). ZINARIX_CONFIG_URL (tests) only works in development builds, where an unsigned file
 * is also accepted.
 */
export async function fetchRemote(opts: FetchRemoteOptions): Promise<RemoteConfig | null> {
  const dev = !opts.packaged;
  const url = (dev && process.env.ZINARIX_CONFIG_URL) || CONFIG_URL;
  try {
    const body = await getText(url);
    const sig = await getText(`${url}.sig`).catch(() => null);
    const signed = sig !== null && verifyConfig(body, sig, opts.publicKeyPem);
    if (!signed && !dev) return null;
    return parseRemote(JSON.parse(body));
  } catch {
    return null;
  }
}

/** Newest published version on GitHub (the releases the installers come from). */
export async function latestRelease(): Promise<string | null> {
  try {
    const r = (await getJson(`https://api.github.com/repos/${REPO}/releases/latest`)) as {
      tag_name?: string;
    };
    const v = /^v?(\d+\.\d+\.\d+)$/.exec(r.tag_name ?? '')?.[1];
    return v ?? null;
  } catch {
    return null;
  }
}

/** a > b for x.y.z versions. */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}
