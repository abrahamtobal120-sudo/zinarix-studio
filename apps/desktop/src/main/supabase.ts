import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import type {
  SupabaseBucketView,
  SupabaseFunctionView,
  SupabaseHealthView,
  SupabaseProjectView,
  SupabaseQueryResult,
  SupabaseStatus,
  SupabaseTableView,
} from '../shared/api.js';

const API = 'https://api.supabase.com';
/** Rows sent back to the UI for one query (the rest is counted, not sent). */
const MAX_ROWS = 500;
const MAX_CELL = 2000;

/** Schemas Supabase manages itself: not shown in the table list. */
const SYSTEM_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'auth',
  'storage',
  'realtime',
  '_realtime',
  'supabase_functions',
  'supabase_migrations',
  'extensions',
  'graphql',
  'graphql_public',
  'vault',
  'pgsodium',
  'pgsodium_masks',
  'net',
  'cron',
  'pgbouncer',
  '_analytics',
];

const TABLES_SQL = `select n.nspname as schema, c.relname as name, greatest(c.reltuples, 0)::bigint as rows,
  c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname not like 'pg\\_%'
  and n.nspname not in (${SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(', ')})
order by 1, 2`;

/** Where the Supabase CLI keeps its login (`supabase login`) when there is no keychain. */
function cliToken(): string | null {
  const env = process.env.SUPABASE_ACCESS_TOKEN;
  if (env) return env.trim();
  try {
    const t = readFileSync(join(homedir(), '.supabase', 'access-token'), 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

function cliInstalled(): Promise<boolean> {
  return new Promise((res) =>
    execFile(
      'supabase',
      ['--version'],
      { timeout: 15_000, windowsHide: true, shell: process.platform === 'win32' },
      (err) => res(!err),
    ),
  );
}

/** Project refs are 20 lowercase letters; only those go into URLs. */
function checkRef(ref: string): string {
  if (!/^[a-z0-9]{8,40}$/.test(ref))
    throw new Error('Referencia de proyecto de Supabase no válida.');
  return ref;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** A cell as short text for the result grid. */
function cell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s;
}

/**
 * Supabase Management API with the user's personal access token. The token stays in the main
 * process: one pasted in the app (encrypted with safeStorage) or the Supabase CLI login.
 */
export class Supabase {
  private cli: boolean | null = null;

  constructor(private readonly dir: string) {}

  private get file(): string {
    return join(this.dir, 'supabase-token.bin');
  }

  private token(): { token: string; source: 'app' | 'cli' } | null {
    if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) {
      try {
        return { token: safeStorage.decryptString(readFileSync(this.file)), source: 'app' };
      } catch {
        /* keychain changed: fall back to the CLI login */
      }
    }
    const t = cliToken();
    return t ? { token: t, source: 'cli' } : null;
  }

  private async req<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const tok = this.token();
    if (!tok) throw new Error('Conecta tu cuenta de Supabase primero.');
    const r = await fetch(new URL(path, API), {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try {
        const e = JSON.parse(text) as { message?: string; error?: string };
        msg = e.message || e.error || msg;
      } catch {
        if (text.trim()) msg = text.trim().slice(0, 500);
      }
      if (r.status === 401)
        msg = `Supabase rechazó el token (${msg}). Vuelve a conectar tu cuenta.`;
      throw new Error(msg);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  async status(): Promise<SupabaseStatus> {
    this.cli ??= await cliInstalled();
    const tok = this.token();
    const base: SupabaseStatus = { connected: false, source: null, orgs: [], cli: this.cli };
    if (!tok) return base;
    try {
      const orgs = await this.req<{ id: string; name: string }[]>('/v1/organizations');
      return {
        ...base,
        connected: true,
        source: tok.source,
        orgs: orgs.map((o) => ({ id: o.id, name: o.name })),
      };
    } catch {
      return { ...base, source: tok.source };
    }
  }

  async setToken(token: string): Promise<SupabaseStatus> {
    const t = token.trim();
    if (!/^[\w-]{20,200}$/.test(t)) throw new Error('El token no tiene un formato válido.');
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Este sistema no tiene llavero para guardar el token cifrado.');
    const r = await fetch(`${API}/v1/organizations`, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error('Supabase rechazó ese token.');
    writeFileSync(this.file, safeStorage.encryptString(t), { mode: 0o600 });
    return this.status();
  }

  /** Forgets the app's token (the CLI login, if any, is the CLI's: `supabase logout`). */
  async logout(): Promise<SupabaseStatus> {
    rmSync(this.file, { force: true });
    return this.status();
  }

  async projects(): Promise<SupabaseProjectView[]> {
    const list = await this.req<
      {
        id: string;
        ref?: string;
        name: string;
        organization_id: string;
        region: string;
        status: string;
        created_at: string;
        database?: { host?: string; version?: string };
      }[]
    >('/v1/projects');
    return list.map((p) => ({
      ref: p.ref ?? p.id,
      name: p.name,
      orgId: p.organization_id,
      region: p.region,
      status: p.status,
      created: Date.parse(p.created_at) || 0,
      dbVersion: p.database?.version ?? null,
    }));
  }

  async health(ref: string): Promise<SupabaseHealthView[]> {
    const services = ['db', 'auth', 'rest', 'storage', 'realtime'];
    const q = services.map((s) => `services=${s}`).join('&');
    const list = await this.req<{ name: string; healthy: boolean; status: string }[]>(
      `/v1/projects/${checkRef(ref)}/health?${q}`,
    );
    return list.map((s) => ({ name: s.name, healthy: s.healthy, status: s.status }));
  }

  /** Runs SQL on the project's database (the UI asks before anything that writes). */
  async query(ref: string, sql: string): Promise<SupabaseQueryResult> {
    const started = Date.now();
    const out = await this.req<unknown>(`/v1/projects/${checkRef(ref)}/database/query`, {
      method: 'POST',
      body: { query: sql },
    });
    const rows = Array.isArray(out) ? (out as Record<string, unknown>[]) : [];
    const columns: string[] = [];
    for (const r of rows.slice(0, MAX_ROWS))
      for (const k of Object.keys(r ?? {})) if (!columns.includes(k)) columns.push(k);
    return {
      columns,
      rows: rows.slice(0, MAX_ROWS).map((r) => columns.map((c) => cell(r?.[c]))),
      total: rows.length,
      ms: Date.now() - started,
    };
  }

  async tables(ref: string): Promise<SupabaseTableView[]> {
    const r = await this.query(ref, TABLES_SQL);
    const at = (name: string) => r.columns.indexOf(name);
    return r.rows.map((row) => ({
      schema: row[at('schema')] ?? 'public',
      name: row[at('name')] ?? '',
      rows: Number(row[at('rows')] ?? 0),
      rls: row[at('rls')] === 'true',
    }));
  }

  /** First rows of a table. */
  preview(ref: string, schema: string, table: string): Promise<SupabaseQueryResult> {
    return this.query(ref, `select * from ${ident(schema)}.${ident(table)} limit 100`);
  }

  async functions(ref: string): Promise<SupabaseFunctionView[]> {
    const list = await this.req<
      { slug: string; name: string; status: string; version: number; updated_at: number }[]
    >(`/v1/projects/${checkRef(ref)}/functions`);
    return list.map((f) => ({
      slug: f.slug,
      name: f.name,
      status: f.status,
      version: f.version,
      updated: f.updated_at,
    }));
  }

  async buckets(ref: string): Promise<SupabaseBucketView[]> {
    const list = await this.req<{ id: string; name: string; public: boolean }[]>(
      `/v1/projects/${checkRef(ref)}/storage/buckets`,
    );
    return list.map((b) => ({ id: b.id, name: b.name, public: b.public }));
  }

  async restore(ref: string): Promise<void> {
    await this.req(`/v1/projects/${checkRef(ref)}/restore`, { method: 'POST' });
  }
}

/** supabase/.temp/project-ref written by `supabase link` in the open folder. */
export function linkedSupabase(root: string): string | null {
  try {
    const ref = readFileSync(join(root, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
    return /^[a-z0-9]{8,40}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}
