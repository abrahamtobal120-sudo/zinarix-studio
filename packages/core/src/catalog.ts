import { createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Catalog, CatalogEntry, OmniError } from '@omni/shared';
import type { OmniConfig } from './config.js';
import type { OmniPaths } from './paths.js';

const require = createRequire(import.meta.url);

/** Packaged apps ship the catalog next to their bundle and point OMNI_CATALOG_DIR at it. */
export function bundledCatalogPath(): string {
  const dir = process.env.OMNI_CATALOG_DIR;
  return dir ? join(dir, 'providers.json') : require.resolve('@omni/catalog/providers.json');
}

export function bundledPublicKey(): string {
  const dir = process.env.OMNI_CATALOG_DIR;
  return readFileSync(
    dir ? join(dir, 'keys', 'catalog.pub') : require.resolve('@omni/catalog/keys/catalog.pub'),
    'utf8',
  );
}

export function parseCatalog(text: string, source: string): Catalog {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new OmniError('config', `${source}: invalid JSON (${(e as Error).message})`);
  }
  const res = Catalog.safeParse(raw);
  if (res.success) return res.data;
  // One provider this build does not understand (e.g. a newer adapter) must not take every
  // other provider down with it: keep the entries that are valid, drop the rest.
  const list = (raw as { providers?: unknown } | null)?.providers;
  if (Array.isArray(list)) {
    const kept: CatalogEntry[] = [];
    const seen = new Set<string>();
    for (const p of list) {
      const e = CatalogEntry.safeParse(p);
      if (e.success && !seen.has(e.data.id)) {
        seen.add(e.data.id);
        kept.push(e.data);
      }
    }
    const partial = Catalog.safeParse({ ...(raw as object), providers: kept });
    if (partial.success && kept.length) return partial.data;
  }
  const issues = res.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new OmniError('config', `${source}: invalid catalog: ${issues.join('; ')}`);
}

/** Ed25519 detached signature over the exact bytes of providers.json (base64). */
export function verifyCatalogSignature(
  data: Buffer,
  signatureB64: string,
  publicKeyPem: string,
): boolean {
  try {
    return verify(
      null,
      data,
      createPublicKey(publicKeyPem),
      Buffer.from(signatureB64.trim(), 'base64'),
    );
  } catch {
    return false;
  }
}

export interface LoadedCatalog {
  catalog: Catalog;
  source: 'bundled' | 'update';
  providers: Map<string, CatalogEntry>;
  /** config.json entries that were ignored because they would weaken the signed catalog. */
  rejected: string[];
}

/**
 * Bundled catalog, or a hot update in ~/.omni/catalog if (and only if) its signature
 * verifies against the bundled public key. User-defined endpoints are merged last.
 */
export function loadCatalog(
  paths: OmniPaths,
  config: OmniConfig,
  publicKeyPem = bundledPublicKey(),
): LoadedCatalog {
  let catalog: Catalog | undefined;
  let source: LoadedCatalog['source'] = 'bundled';
  if (existsSync(paths.catalogOverride) && existsSync(paths.catalogOverrideSig)) {
    const data = readFileSync(paths.catalogOverride);
    const sig = readFileSync(paths.catalogOverrideSig, 'utf8');
    if (verifyCatalogSignature(data, sig, publicKeyPem)) {
      try {
        catalog = parseCatalog(data.toString('utf8'), paths.catalogOverride);
        source = 'update';
      } catch {
        catalog = undefined;
      }
    }
  }
  catalog ??= parseCatalog(readFileSync(bundledCatalogPath(), 'utf8'), 'bundled catalog');
  const providers = new Map(catalog.providers.map((p) => [p.id, p]));
  const rejected = configIssues(config, catalog);
  for (const custom of config.customProviders)
    if (!providers.has(custom.id)) providers.set(custom.id, custom);
  return { catalog, source, providers, rejected };
}

/**
 * config.json is not signed, so it must not be able to redirect a signed provider's key:
 * a custom provider cannot reuse a catalog id, and a baseUrl override of a catalog
 * provider must stay on the same registrable domain (or loopback). Returns one readable
 * line per violation; `saveConfig` refuses them and `loadCatalog` ignores them.
 */
export function configIssues(config: OmniConfig, catalog: Catalog): string[] {
  const signed = new Map(catalog.providers.map((p) => [p.id, p]));
  const out: string[] = [];
  for (const c of config.customProviders) {
    if (signed.has(c.id))
      out.push(
        `customProviders: "${c.id}" is already a catalog provider; pick another id (e.g. "${c.id}-custom")`,
      );
  }
  for (const [id, p] of Object.entries(config.providers)) {
    const entry = signed.get(id);
    if (!entry || !p.baseUrl) continue;
    const why = baseUrlOverrideIssue(entry, p.baseUrl);
    if (why) out.push(`providers.${id}.baseUrl: ${why}`);
  }
  return out;
}

export function isLoopbackHost(host: string): boolean {
  // URL.hostname keeps the brackets of IPv6 literals ("[::1]").
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' || h === '::1' || h.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(h)
  );
}

// Second-level labels under a ccTLD that act as public suffixes (co.uk, com.cn, ...).
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

/** eTLD+1 approximation without a public-suffix list: good enough to compare two hosts. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1]!)) return labels.join('.');
  const n =
    labels[labels.length - 1]!.length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]!) ? 3 : 2;
  return labels.slice(-n).join('.');
}

function hostOf(url: string): string | undefined {
  try {
    // Catalog URLs may hold {placeholders} in the host (https://{resource}.openai.azure.com).
    return new URL(url.replace(/\{[a-z_]+\}/g, 'x')).hostname;
  } catch {
    return undefined;
  }
}

/** Why a user baseUrl override of a catalog provider is refused, or undefined if allowed. */
export function baseUrlOverrideIssue(entry: CatalogEntry, override: string): string | undefined {
  const host = hostOf(override);
  if (!host) return `invalid URL "${override}"`;
  if (isLoopbackHost(host)) return undefined;
  // Keyless local servers (Ollama, LM Studio...) may live anywhere on the LAN: no key to leak.
  if (entry.auth.type === 'none' && !entry.auth.optional) return undefined;
  const expected = hostOf(entry.baseUrl);
  if (expected && registrableDomain(host) === registrableDomain(expected)) return undefined;
  return `"${host}" is not on ${expected ? registrableDomain(expected) : 'the catalog domain'} nor loopback; the ${entry.name} key would be sent to another server. Add it as a custom provider instead (omni providers add-custom).`;
}

/**
 * Credentials must not travel in clear text: plain http:// is only allowed to loopback
 * hosts. Throws a config error when `baseUrl` is http to anything else.
 */
export function assertSecureTransport(provider: string, baseUrl: string): void {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new OmniError('config', `${provider}: invalid base URL "${baseUrl}"`);
  }
  if (u.protocol === 'https:' || isLoopbackHost(u.hostname)) return;
  throw new OmniError(
    'config',
    `${provider}: refusing to send credentials over plain HTTP to ${u.host}; use https:// (http:// is only allowed for localhost)`,
    { provider, retryable: false },
  );
}

export async function updateCatalogFromUrl(
  url: string,
  paths: OmniPaths,
  opts: { fetch?: typeof fetch; publicKeyPem?: string } = {},
): Promise<Catalog> {
  const f = opts.fetch ?? fetch;
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
    throw new OmniError('config', 'catalog updates must use https');
  }
  const [dataRes, sigRes] = await Promise.all([f(url), f(`${url}.sig`)]);
  if (!dataRes.ok || !sigRes.ok)
    throw new OmniError(
      'network',
      `could not download catalog (${dataRes.status}/${sigRes.status})`,
    );
  const data = Buffer.from(await dataRes.arrayBuffer());
  const sig = await sigRes.text();
  if (!verifyCatalogSignature(data, sig, opts.publicKeyPem ?? bundledPublicKey())) {
    throw new OmniError('config', 'invalid catalog signature');
  }
  const catalog = parseCatalog(data.toString('utf8'), url);
  mkdirSync(dirname(paths.catalogOverride), { recursive: true, mode: 0o700 });
  writeFileSync(paths.catalogOverride, data, { mode: 0o600 });
  writeFileSync(paths.catalogOverrideSig, sig, { mode: 0o600 });
  return catalog;
}

/** Resolves {placeholders} in a catalog base URL from user params or defaults. */
export function resolveBaseUrl(
  entry: CatalogEntry,
  params: Record<string, string>,
  override?: string,
): string {
  const url = override ?? entry.baseUrl;
  return url.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    const spec = entry.baseUrlParams.find((p) => p.name === name);
    // Empty strings (blank form fields) count as unset so the catalog default applies.
    const v = params[name]?.trim() || spec?.default;
    if (!v && spec?.optional) return '';
    if (!v) {
      const label = entry.baseUrlParams.find((p) => p.name === name)?.label ?? name;
      throw new OmniError(
        'config',
        `${entry.id} needs "${label}": omni auth add ${entry.id} --param ${name}=<value>`,
      );
    }
    return encodeURIComponent(v).replace(/%2E/g, '.');
  });
}

/** User params merged over catalog defaults; blank values are dropped. */
export function resolveParams(
  entry: CatalogEntry,
  params: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of entry.baseUrlParams) if (p.default) out[p.name] = p.default;
  for (const [k, v] of Object.entries(params)) if (v.trim()) out[k] = v.trim();
  return out;
}

export function isLocalProvider(entry: CatalogEntry, baseUrl: string): boolean {
  if (entry.category === 'local') return true;
  try {
    return isLoopbackHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
