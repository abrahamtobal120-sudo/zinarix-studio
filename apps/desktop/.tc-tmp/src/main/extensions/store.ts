import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ExtensionSearchItem, InstalledExtension } from '../../shared/devtools.js';
import { parseVsix } from './vsix.js';

const API = 'https://open-vsx.org/api';
const MAX_VSIX = 80 * 1024 * 1024;
const MAX_ICON = 256 * 1024;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type Fetch = typeof fetch;

async function readCapped(r: Response, max: number): Promise<Buffer> {
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > max) throw new Error('download too large');
  if (!r.body) return Buffer.from(await r.arrayBuffer());
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new Error('download too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Only Open VSX (and its file CDN) is ever contacted. */
export function openVsxUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'open-vsx.org' || u.hostname.endsWith('.open-vsx.org'));
  } catch {
    return false;
  }
}

interface Meta {
  id: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  enabled: boolean;
  icon?: string;
  installedAt: number;
}

/**
 * Extensions from Open VSX (the open registry; Microsoft's marketplace only allows VS Code
 * itself). Installed into <userData>/extensions/<id>-<version>/ with only the manifest and
 * the files of contributions Zinarix can apply.
 */
export class ExtensionStore {
  readonly dir: string;
  constructor(
    userData: string,
    private readonly http: Fetch = fetch,
  ) {
    this.dir = join(userData, 'extensions');
  }

  private async getJson<T>(url: string): Promise<T> {
    const r = await this.http(url, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`Open VSX: HTTP ${r.status}`);
    return JSON.parse((await readCapped(r, 8 * 1024 * 1024)).toString('utf8')) as T;
  }

  async search(query: string): Promise<ExtensionSearchItem[]> {
    const q = new URLSearchParams({ query, size: '40', sortBy: 'relevance', sortOrder: 'desc' });
    const r = await this.getJson<{
      extensions?: {
        namespace: string;
        name: string;
        version: string;
        displayName?: string;
        description?: string;
        downloadCount?: number;
        files?: { icon?: string };
      }[];
    }>(`${API}/-/search?${q}`);
    return (r.extensions ?? []).map((e) => ({
      id: `${e.namespace}.${e.name}`,
      namespace: e.namespace,
      name: e.name,
      displayName: e.displayName || e.name,
      version: e.version,
      description: e.description ?? '',
      publisher: e.namespace,
      downloads: e.downloadCount ?? 0,
      iconUrl: e.files?.icon && openVsxUrl(e.files.icon) ? e.files.icon : undefined,
    }));
  }

  /** An Open VSX icon as a data URL (the renderer's CSP only allows data: images). */
  async icon(url: string): Promise<string | null> {
    if (!openVsxUrl(url)) return null;
    const r = await this.http(url);
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') ?? 'image/png').split(';')[0]!.trim();
    if (!type.startsWith('image/')) return null;
    const buf = await readCapped(r, MAX_ICON);
    return `data:${type};base64,${buf.toString('base64')}`;
  }

  async install(namespace: string, name: string): Promise<InstalledExtension> {
    if (!NAME_RE.test(namespace) || !NAME_RE.test(name)) throw new Error('invalid extension id');
    const info = await this.getJson<{
      namespace: string;
      name: string;
      version: string;
      displayName?: string;
      description?: string;
      files?: { download?: string };
    }>(`${API}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
    const url = info.files?.download;
    if (!url || !openVsxUrl(url)) throw new Error('Open VSX did not give a download link.');
    if (!NAME_RE.test(info.version)) throw new Error('invalid version');
    const r = await this.http(url);
    if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
    const vsix = parseVsix(await readCapped(r, MAX_VSIX));
    const id = `${namespace}.${name}`;
    await this.removeAll(id);
    const target = join(this.dir, `${id}-${info.version}`);
    const root = resolve(target) + sep;
    for (const [rel, data] of vsix.files) {
      const out = resolve(target, rel);
      if (!out.startsWith(root)) continue; // zip-slip (already filtered by safeEntryPath)
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, data);
    }
    const m = vsix.manifest;
    const meta: Meta = {
      id,
      displayName: info.displayName || (typeof m.displayName === 'string' ? m.displayName : name),
      publisher: typeof m.publisher === 'string' ? m.publisher : namespace,
      version: info.version,
      description: info.description ?? (typeof m.description === 'string' ? m.description : ''),
      enabled: true,
      icon: vsix.icon,
      installedAt: Date.now(),
    };
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'zinarix-meta.json'), JSON.stringify(meta));
    await writeFile(
      join(target, 'zinarix-contributions.json'),
      JSON.stringify({
        themes: vsix.themes,
        languages: vsix.languages,
        snippets: vsix.snippets,
        unsupported: vsix.unsupported,
      }),
    );
    return (await this.list()).find((x) => x.id === id)!;
  }

  private async dirs(): Promise<string[]> {
    try {
      return (await readdir(this.dir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }

  /** Folders of one extension (by its meta id: "a.b-1.0" and "a.b-c-1.0" are different). */
  private async foldersOf(id: string): Promise<string[]> {
    const out: string[] = [];
    for (const d of await this.dirs()) {
      if (!d.startsWith(`${id}-`) || !NAME_RE.test(d)) continue;
      try {
        const meta = JSON.parse(
          await readFile(join(this.dir, d, 'zinarix-meta.json'), 'utf8'),
        ) as Meta;
        if (meta.id === id) out.push(d);
      } catch {
        // half-installed: only if the rest of the name is a version
        if (/^\d/.test(d.slice(id.length + 1))) out.push(d);
      }
    }
    return out;
  }

  private async removeAll(id: string): Promise<void> {
    for (const d of await this.foldersOf(id))
      await rm(join(this.dir, d), { recursive: true, force: true });
  }

  async list(): Promise<InstalledExtension[]> {
    const out: InstalledExtension[] = [];
    for (const d of await this.dirs()) {
      try {
        const meta = JSON.parse(await readFile(join(this.dir, d, 'zinarix-meta.json'), 'utf8')) as Meta;
        const c = JSON.parse(
          await readFile(join(this.dir, d, 'zinarix-contributions.json'), 'utf8'),
        ) as Pick<InstalledExtension, 'themes' | 'languages' | 'snippets' | 'unsupported'>;
        out.push({
          id: meta.id,
          displayName: meta.displayName,
          publisher: meta.publisher,
          version: meta.version,
          description: meta.description,
          enabled: meta.enabled,
          icon: meta.icon,
          themes: c.themes ?? [],
          languages: c.languages ?? [],
          snippets: c.snippets ?? [],
          unsupported: c.unsupported ?? [],
        });
      } catch {
        // half-installed folder: ignored
      }
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async uninstall(id: string): Promise<void> {
    if (!NAME_RE.test(id)) throw new Error('invalid extension id');
    await this.removeAll(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    for (const d of await this.foldersOf(id)) {
      const p = join(this.dir, d, 'zinarix-meta.json');
      try {
        const meta = JSON.parse(await readFile(p, 'utf8')) as Meta;
        meta.enabled = enabled;
        await writeFile(p, JSON.stringify(meta));
      } catch {
        // missing meta
      }
    }
  }
}
