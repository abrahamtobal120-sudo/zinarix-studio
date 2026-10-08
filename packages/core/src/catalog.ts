import { createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Catalog, OmniError } from '@omni/shared';
import type { CatalogEntry } from '@omni/shared';
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
  if (!res.success) {
    const issues = res.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new OmniError('config', `${source}: invalid catalog: ${issues.join('; ')}`);
  }
  return res.data;
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
  for (const custom of config.customProviders) providers.set(custom.id, custom);
  return { catalog, source, providers };
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
    const host = new URL(baseUrl).hostname;
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}
