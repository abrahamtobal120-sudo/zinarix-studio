import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AccountList, type SavedAccount } from './accounts.js';
import type {
  SupabaseApiInfo,
  SupabaseAuthConfig,
  SupabaseBackupsView,
  SupabaseBucketView,
  SupabaseColumnView,
  SupabaseEmailConfig,
  SupabaseEmailKind,
  SupabaseSmtpConfig,
  SupabaseFunctionView,
  SupabaseMigrationView,
  SupabaseHealthView,
  SupabaseProjectView,
  SupabaseQueryResult,
  SupabaseStatus,
  SupabaseTableView,
  SupabaseUserView,
} from '../shared/api.js';

const API = 'https://api.supabase.com';
const EMAIL_KINDS: SupabaseEmailKind[] = [
  'confirmation',
  'invite',
  'magic_link',
  'recovery',
  'email_change',
  'reauthentication',
];
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

/** The service refused the token (as opposed to a network or server failure). */
class AuthError extends Error {}

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

function orgNames(orgs: { name: string }[]): string {
  return Array.isArray(orgs) ? orgs.map((o) => o.name).join(', ') : '';
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A cell as short text for the result grid. */
function cell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s;
}

/**
 * Supabase Management API with the user's personal access token. The token stays in the main
 * process: one pasted in the app (kept by TokenStore) or the Supabase CLI login.
 */
export class Supabase {
  private cli: boolean | null = null;

  private readonly accounts: AccountList;

  /** pinned: the account this instance uses instead of the active one (see forAccount). */
  constructor(
    private readonly dir: string,
    private readonly pinned?: SavedAccount,
  ) {
    this.accounts = new AccountList(dir, 'supabase');
  }

  /** The connected accounts and which one the panel uses. */
  accountList(): { accounts: SavedAccount[]; active: string | null } {
    return { accounts: this.accounts.list(), active: this.accounts.active()?.id ?? null };
  }

  /**
   * The same service on one connected account (by id or label), without changing the one the
   * panel uses. No account: the active one.
   */
  forAccount(account?: string): Supabase {
    if (!account) return this;
    const list = this.accounts.list();
    const acc = list.find((a) => a.id === account) ?? list.find((a) => a.label === account);
    if (!acc) throw new Error(`No connected Supabase account "${account}".`);
    return new Supabase(this.dir, acc);
  }

  private token(): { token: string; source: 'app' | 'cli' } | null {
    const acc = this.pinned ?? this.accounts.active();
    const saved = acc && this.accounts.token(acc.id);
    if (saved) return { token: saved, source: 'app' };
    if (this.pinned) return null;
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
        throw new AuthError(`Supabase rechazó el token (${msg}). Vuelve a conectar tu cuenta.`);
      throw new Error(msg);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  async status(): Promise<SupabaseStatus> {
    this.cli ??= await cliInstalled();
    const tok = this.token();
    const active = tok?.source === 'app' ? this.accounts.active() : null;
    const base: SupabaseStatus = {
      connected: false,
      source: null,
      orgs: [],
      cli: this.cli,
      accounts: this.accounts.list(),
      active: active?.id ?? null,
    };
    if (!tok) return base;
    try {
      // A network hiccup (e.g. right after startup) gets a second try before giving up.
      const orgs = await this.req<{ id: string; name: string }[]>('/v1/organizations').catch(
        async (e: unknown) => {
          if (e instanceof AuthError) throw e;
          await new Promise((r) => setTimeout(r, 2000));
          return this.req<{ id: string; name: string }[]>('/v1/organizations');
        },
      );
      // A personal token has no user name: its organizations name the account.
      if (active) this.accounts.label(active.id, orgNames(orgs));
      return {
        ...base,
        accounts: this.accounts.list(),
        connected: true,
        source: tok.source,
        orgs: orgs.map((o) => ({ id: o.id, name: o.name })),
      };
    } catch (e) {
      // Not reachable is not logged out: the token stays and the panel retries.
      if (e instanceof AuthError) return { ...base, source: tok.source };
      return { ...base, source: tok.source, offline: (e as Error).message || String(e) };
    }
  }

  async setToken(token: string): Promise<SupabaseStatus> {
    const t = token.trim();
    if (!/^[\w-]{20,200}$/.test(t)) throw new Error('El token no tiene un formato válido.');
    const r = await fetch(`${API}/v1/organizations`, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error('Supabase rechazó ese token.');
    const orgs = (await r.json().catch(() => [])) as { name: string }[];
    this.accounts.add(t, orgNames(orgs));
    return this.status();
  }

  /** Makes another connected account the one the panel and the AI use. */
  async useAccount(id: string): Promise<SupabaseStatus> {
    this.accounts.use(id);
    return this.status();
  }

  /**
   * Forgets one of the app's accounts (the active one by default). The CLI login, if any, is
   * the CLI's: `supabase logout`.
   */
  async logout(id?: string): Promise<SupabaseStatus> {
    const target = id ?? this.accounts.active()?.id;
    if (target) this.accounts.remove(target);
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

  /** One page (100 rows) of a table. */
  preview(ref: string, schema: string, table: string, page = 0): Promise<SupabaseQueryResult> {
    const offset = Math.max(0, Math.floor(page)) * 100;
    return this.query(
      ref,
      `select * from ${ident(schema)}.${ident(table)} limit 100 offset ${offset}`,
    );
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

  async pause(ref: string): Promise<void> {
    await this.req(`/v1/projects/${checkRef(ref)}/pause`, { method: 'POST' });
  }

  /** Rows of a query as objects keyed by column name. */
  private async objects(ref: string, sql: string): Promise<Record<string, string | null>[]> {
    const r = await this.query(ref, sql);
    return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i] ?? null])));
  }

  async columns(ref: string, schema: string, table: string): Promise<SupabaseColumnView[]> {
    const rows = await this.objects(
      ref,
      `select c.column_name as name, c.data_type as type, c.is_nullable = 'YES' as nullable,
  c.column_default as "default",
  exists (select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage k
      on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
    where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = c.table_schema
      and tc.table_name = c.table_name and k.column_name = c.column_name) as pk
from information_schema.columns c
where c.table_schema = ${lit(schema)} and c.table_name = ${lit(table)}
order by c.ordinal_position`,
    );
    return rows.map((r) => ({
      name: r.name ?? '',
      type: r.type ?? '',
      nullable: r.nullable === 'true',
      default: r.default ?? null,
      pk: r.pk === 'true',
    }));
  }

  /** Turns row level security of a table on or off. */
  async setRls(ref: string, schema: string, table: string, on: boolean): Promise<void> {
    await this.query(
      ref,
      `alter table ${ident(schema)}.${ident(table)} ${on ? 'enable' : 'disable'} row level security`,
    );
  }

  /** Last sign-ups of the project (auth.users, read with the management API). */
  async users(ref: string): Promise<SupabaseUserView[]> {
    const rows = await this.objects(
      ref,
      `select id, email, phone, created_at, last_sign_in_at, email_confirmed_at is not null as confirmed,
  coalesce(raw_app_meta_data->>'provider', 'email') as provider
from auth.users order by created_at desc limit 200`,
    );
    return rows.map((r) => ({
      id: r.id ?? '',
      email: r.email || r.phone || null,
      provider: r.provider ?? 'email',
      confirmed: r.confirmed === 'true',
      created: Date.parse(r.created_at ?? '') || 0,
      lastSignIn: Date.parse(r.last_sign_in_at ?? '') || null,
    }));
  }

  async userCount(ref: string): Promise<number> {
    const [r] = await this.objects(ref, 'select count(*) as n from auth.users');
    return Number(r?.n ?? 0);
  }

  /** Migrations applied with the CLI (none when the project never used `supabase db push`). */
  async migrations(ref: string): Promise<SupabaseMigrationView[]> {
    const rows = await this.objects(
      ref,
      `select version, name from supabase_migrations.schema_migrations order by version desc limit 200`,
    ).catch(() => []);
    return rows.map((r) => ({ version: r.version ?? '', name: r.name ?? null }));
  }

  /** Files of a bucket (storage.objects). */
  async files(ref: string, bucket: string): Promise<SupabaseQueryResult> {
    return this.query(
      ref,
      `select name, metadata->>'mimetype' as type, pg_size_pretty((metadata->>'size')::bigint) as size,
  updated_at from storage.objects where bucket_id = ${lit(bucket)} order by updated_at desc limit 200`,
    );
  }

  /** Project URL and the public (anon / publishable) keys. Secret keys are never sent to the UI. */
  async apiInfo(ref: string): Promise<SupabaseApiInfo> {
    const list = await this.req<{ name: string; api_key?: string | null; type?: string }[]>(
      `/v1/projects/${checkRef(ref)}/api-keys?reveal=false`,
    );
    const keys = list
      .filter((k) => k.api_key && (k.name === 'anon' || k.type === 'publishable'))
      .map((k) => ({ name: k.name, key: k.api_key! }));
    return { url: `https://${ref}.supabase.co`, keys };
  }

  async deleteUser(ref: string, id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('ID de usuario no válido.');
    await this.query(ref, `delete from auth.users where id = ${lit(id)}`);
  }

  /** Names of the Edge Function secrets (values are never read back). */
  async secrets(ref: string): Promise<string[]> {
    const list = await this.req<{ name: string }[]>(`/v1/projects/${checkRef(ref)}/secrets`);
    return list.map((s) => s.name).sort();
  }

  async setSecret(ref: string, name: string, value: string): Promise<void> {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(name) || /^SUPABASE_/i.test(name))
      throw new Error('Nombre no válido (letras, números y _; no puede empezar por SUPABASE_).');
    await this.req(`/v1/projects/${checkRef(ref)}/secrets`, {
      method: 'POST',
      body: [{ name, value }],
    });
  }

  async deleteSecret(ref: string, name: string): Promise<void> {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(name)) throw new Error('Nombre no válido.');
    await this.req(`/v1/projects/${checkRef(ref)}/secrets`, { method: 'DELETE', body: [name] });
  }

  async authConfig(ref: string): Promise<SupabaseAuthConfig> {
    const c = await this.req<{
      site_url?: string | null;
      uri_allow_list?: string | null;
      disable_signup?: boolean | null;
      mailer_autoconfirm?: boolean | null;
    }>(`/v1/projects/${checkRef(ref)}/config/auth`);
    return {
      siteUrl: c.site_url ?? '',
      redirectUrls: (c.uri_allow_list ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      disableSignup: !!c.disable_signup,
      autoconfirm: !!c.mailer_autoconfirm,
    };
  }

  async setAuthConfig(ref: string, c: SupabaseAuthConfig): Promise<void> {
    await this.req(`/v1/projects/${checkRef(ref)}/config/auth`, {
      method: 'PATCH',
      body: {
        site_url: c.siteUrl.trim(),
        uri_allow_list: c.redirectUrls
          .map((x) => x.trim())
          .filter(Boolean)
          .join(','),
        disable_signup: c.disableSignup,
        mailer_autoconfirm: c.autoconfirm,
      },
    });
  }

  async backups(ref: string): Promise<SupabaseBackupsView> {
    const r = await this.req<{
      pitr_enabled?: boolean;
      backups?: { inserted_at: string; status: string; is_physical_backup?: boolean }[];
    }>(`/v1/projects/${checkRef(ref)}/database/backups`);
    return {
      pitr: !!r.pitr_enabled,
      list: (r.backups ?? [])
        .map((b) => ({ at: Date.parse(b.inserted_at) || 0, status: b.status }))
        .sort((a, b) => b.at - a.at),
    };
  }

  async emailConfig(ref: string): Promise<SupabaseEmailConfig> {
    const c = await this.req<Record<string, string | number | boolean | null | undefined>>(
      `/v1/projects/${checkRef(ref)}/config/auth`,
    );
    const str = (k: string) => (c[k] == null ? '' : String(c[k]));
    const templates = Object.fromEntries(
      EMAIL_KINDS.map((k) => [
        k,
        { subject: str(`mailer_subjects_${k}`), content: str(`mailer_templates_${k}_content`) },
      ]),
    ) as SupabaseEmailConfig['templates'];
    return {
      smtp: str('smtp_host')
        ? {
            host: str('smtp_host'),
            port: str('smtp_port'),
            user: str('smtp_user'),
            senderEmail: str('smtp_admin_email'),
            senderName: str('smtp_sender_name'),
          }
        : null,
      hasPass: !!c.smtp_pass,
      rateLimit: typeof c.rate_limit_email_sent === 'number' ? c.rate_limit_email_sent : null,
      templates,
    };
  }

  async setSmtp(
    ref: string,
    smtp: SupabaseSmtpConfig | null,
    rateLimit: number | null,
  ): Promise<void> {
    const body: Record<string, string | number | null> = smtp
      ? {
          smtp_host: smtp.host.trim(),
          smtp_port: smtp.port.trim(),
          smtp_user: smtp.user.trim(),
          smtp_admin_email: smtp.senderEmail.trim(),
          smtp_sender_name: smtp.senderName.trim(),
          ...(smtp.pass ? { smtp_pass: smtp.pass } : {}),
        }
      : {
          smtp_host: null,
          smtp_port: null,
          smtp_user: null,
          smtp_pass: null,
          smtp_admin_email: null,
          smtp_sender_name: null,
        };
    // The email rate limit can only be raised with a custom SMTP.
    if (smtp && rateLimit) body.rate_limit_email_sent = rateLimit;
    await this.req(`/v1/projects/${checkRef(ref)}/config/auth`, { method: 'PATCH', body });
  }

  async setEmailTemplate(
    ref: string,
    kind: SupabaseEmailKind,
    subject: string,
    content: string,
  ): Promise<void> {
    if (!EMAIL_KINDS.includes(kind)) throw new Error('Plantilla no válida.');
    await this.req(`/v1/projects/${checkRef(ref)}/config/auth`, {
      method: 'PATCH',
      body: {
        [`mailer_subjects_${kind}`]: subject,
        [`mailer_templates_${kind}_content`]: content,
      },
    });
  }

  /**
   * Invite, magic link or password reset through the project's Auth API. It needs the secret
   * (service_role) key, which is read here and never leaves the main process.
   */
  async sendEmail(
    ref: string,
    kind: 'invite' | 'magiclink' | 'recovery',
    email: string,
    redirectTo: string,
  ): Promise<void> {
    const list = await this.req<{ name: string; api_key?: string | null; type?: string }[]>(
      `/v1/projects/${checkRef(ref)}/api-keys?reveal=true`,
    );
    const legacy = list.find((k) => k.name === 'service_role' && k.api_key)?.api_key;
    const secret = legacy ?? list.find((k) => k.type === 'secret' && k.api_key)?.api_key;
    if (!secret) throw new Error('El proyecto no tiene una clave secreta (service_role).');
    const url = new URL(
      `/auth/v1/${kind === 'magiclink' ? 'otp' : kind === 'recovery' ? 'recover' : 'invite'}`,
      `https://${ref}.supabase.co`,
    );
    if (redirectTo.trim()) url.searchParams.set('redirect_to', redirectTo.trim());
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: secret,
        // Legacy keys are JWTs and go in Authorization too; new sb_secret_ keys only as apikey.
        ...(legacy ? { Authorization: `Bearer ${legacy}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(kind === 'magiclink' ? { email, create_user: false } : { email }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const text = await r.text();
      let msg = `${r.status} ${r.statusText}`;
      try {
        const e = JSON.parse(text) as {
          msg?: string;
          message?: string;
          error_description?: string;
        };
        msg = e.msg || e.message || e.error_description || msg;
      } catch {
        if (text.trim()) msg = text.trim().slice(0, 500);
      }
      throw new Error(msg);
    }
  }

  async deleteFunction(ref: string, slug: string): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(slug)) throw new Error('Nombre de función no válido.');
    await this.req(`/v1/projects/${checkRef(ref)}/functions/${slug}`, { method: 'DELETE' });
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
