import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from './token-store.js';
import type {
  VercelDeploymentView,
  VercelEnvView,
  VercelProjectInfo,
  VercelProjectView,
  VercelSettings,
  VercelStatus,
} from '../shared/api.js';

const API = 'https://api.vercel.com';
const MAX_LOG = 400_000;

/** The service refused the token (as opposed to a network or server failure). */
class AuthError extends Error {}

/** Where the Vercel CLI keeps its login (`vercel login`), per platform. */
function cliAuthFiles(): string[] {
  const home = homedir();
  const xdg = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
  return [
    join(xdg, 'com.vercel.cli', 'auth.json'),
    join(home, 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    join(appData, 'com.vercel.cli', 'Data', 'auth.json'),
    join(appData, 'com.vercel.cli', 'auth.json'),
    join(home, '.vercel', 'auth.json'),
  ];
}

interface CliAuth {
  token?: unknown;
  refreshToken?: unknown;
  /** Seconds since the epoch. */
  expiresAt?: unknown;
  dpop?: unknown;
}

function cliAuth(): { file: string; auth: CliAuth } | null {
  for (const file of cliAuthFiles()) {
    try {
      const auth = JSON.parse(readFileSync(file, 'utf8')) as CliAuth;
      if (typeof auth.token === 'string' && auth.token) return { file, auth };
    } catch {
      /* missing or unreadable */
    }
  }
  return null;
}

/** OAuth client of the Vercel CLI: its logins last hours and are renewed with the refresh token. */
const CLI_CLIENT_ID = 'cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp';
const TOKEN_URL = 'https://api.vercel.com/login/oauth/token';

let renewing: Promise<string | null> | null = null;

/**
 * Renews the CLI login like the CLI does and writes it back to its auth.json (the refresh token
 * rotates, so the CLI has to get the new one too). null: there is nothing to renew with.
 */
function renewCli(): Promise<string | null> {
  renewing ??= (async () => {
    const found = cliAuth();
    const refresh = found?.auth.refreshToken;
    // Logins bound to a DPoP key need that key to renew: only the CLI can do it.
    if (!found || typeof refresh !== 'string' || !refresh || found.auth.dpop) return null;
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLI_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refresh,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof j.access_token !== 'string' || !j.access_token) return null;
    const auth: CliAuth = {
      ...found.auth,
      token: j.access_token,
      refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : refresh,
      expiresAt:
        Math.floor(Date.now() / 1000) + (typeof j.expires_in === 'number' ? j.expires_in : 3600),
    };
    writeFileSync(found.file, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
    return j.access_token;
  })()
    .catch(() => null)
    .finally(() => (renewing = null));
  return renewing;
}

/** The CLI login, renewed first when it is about to expire. */
async function cliToken(): Promise<string | null> {
  const found = cliAuth();
  if (!found) return null;
  const exp = found.auth.expiresAt;
  if (typeof exp === 'number' && exp * 1000 < Date.now() + 60_000)
    return (await renewCli()) ?? (found.auth.token as string);
  return found.auth.token as string;
}

function cliInstalled(): Promise<boolean> {
  return new Promise((res) =>
    execFile(
      'vercel',
      ['--version'],
      { timeout: 15_000, windowsHide: true, shell: process.platform === 'win32' },
      (err) => res(!err),
    ),
  );
}

/** Only ids Vercel itself issues go into URLs. */
function checkId(id: string): string {
  if (!/^[\w-]{1,128}$/.test(id)) throw new Error('Identificador de Vercel no válido.');
  return id;
}

function checkDomain(name: string): string {
  const d = name.trim().toLowerCase();
  if (!/^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(d))
    throw new Error('Dominio no válido.');
  return d;
}

const ENV_TARGETS = ['production', 'preview', 'development'] as const;

/** Build settings the panel can read and change (null = Vercel's default for the framework). */
const SETTING_KEYS = [
  'framework',
  'buildCommand',
  'installCommand',
  'devCommand',
  'outputDirectory',
  'rootDirectory',
  'nodeVersion',
] as const;

/**
 * Vercel REST API with the user's token. The token stays in the main process: either one
 * pasted in the app (kept by TokenStore) or the Vercel CLI login of this machine.
 */
export class Vercel {
  private cli: boolean | null = null;

  constructor(private readonly dir: string) {}

  private get store(): TokenStore {
    return new TokenStore(join(this.dir, 'vercel-token.bin'), 'vercel');
  }

  private async token(): Promise<{ token: string; source: 'app' | 'cli' } | null> {
    const saved = this.store.get();
    if (saved) return { token: saved, source: 'app' };
    const t = await cliToken();
    return t ? { token: t, source: 'cli' } : null;
  }

  private async req<T>(
    path: string,
    teamId: string | null,
    init: { method?: string; body?: unknown; text?: boolean } = {},
  ): Promise<T> {
    const tok = await this.token();
    if (!tok) throw new Error('Conecta tu cuenta de Vercel primero.');
    const url = new URL(path, API);
    if (teamId) url.searchParams.set('teamId', checkId(teamId));
    const call = (token: string) =>
      fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    let r = await call(tok.token);
    // The CLI login expired before its date: renew it once and retry.
    if (r.status === 401 && tok.source === 'cli') {
      const fresh = await renewCli();
      if (fresh) r = await call(fresh);
    }
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try {
        const e = (await r.json()) as { error?: { message?: string } };
        if (e.error?.message) msg = e.error.message;
      } catch {
        /* not JSON */
      }
      if (r.status === 401 || r.status === 403)
        throw new AuthError(`Vercel rechazó el token (${msg}). Vuelve a conectar tu cuenta.`);
      throw new Error(msg);
    }
    const body = await r.text();
    if (init.text) return body as T;
    return (body ? JSON.parse(body) : null) as T;
  }

  async status(): Promise<VercelStatus> {
    this.cli ??= await cliInstalled();
    const tok = await this.token();
    const base: VercelStatus = {
      connected: false,
      source: null,
      user: null,
      teams: [],
      cli: this.cli,
    };
    if (!tok) return base;
    try {
      // A network hiccup (e.g. right after startup) gets a second try before giving up.
      const { user } = await this.req<{ user: { username: string } }>('/v2/user', null).catch(
        async (e: unknown) => {
          if (e instanceof AuthError) throw e;
          await new Promise((r) => setTimeout(r, 2000));
          return this.req<{ user: { username: string } }>('/v2/user', null);
        },
      );
      const { teams } = await this.req<{ teams: { id: string; name: string; slug: string }[] }>(
        '/v2/teams?limit=50',
        null,
      ).catch(() => ({ teams: [] }));
      return {
        ...base,
        connected: true,
        source: tok.source,
        user: user.username,
        teams: teams.map((t) => ({ id: t.id, name: t.name || t.slug, slug: t.slug })),
      };
    } catch (e) {
      // Not reachable is not logged out: the token stays and the panel retries.
      if (e instanceof AuthError) return { ...base, source: tok.source };
      return { ...base, source: tok.source, offline: (e as Error).message || String(e) };
    }
  }

  async setToken(token: string): Promise<VercelStatus> {
    const t = token.trim();
    if (!/^[\w-]{8,200}$/.test(t)) throw new Error('El token no tiene un formato válido.');
    const r = await fetch(`${API}/v2/user`, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error('Vercel rechazó ese token.');
    this.store.set(t);
    return this.status();
  }

  /** Forgets the app's token (the CLI login, if any, is the CLI's: `vercel logout`). */
  async logout(): Promise<VercelStatus> {
    this.store.delete();
    return this.status();
  }

  async projects(teamId: string | null): Promise<VercelProjectView[]> {
    const { projects } = await this.req<{
      projects: {
        id: string;
        name: string;
        framework?: string | null;
        accountId: string;
        updatedAt: number;
        link?: {
          type?: string;
          org?: string;
          repo?: string;
          projectNamespace?: string;
          projectName?: string;
        };
      }[];
    }>('/v9/projects?limit=100', teamId);
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      framework: p.framework ?? null,
      teamId,
      repo: p.link
        ? `${p.link.org ?? p.link.projectNamespace ?? ''}/${p.link.repo ?? p.link.projectName ?? ''}`
        : null,
      updatedAt: p.updatedAt,
    }));
  }

  async project(projectId: string, teamId: string | null): Promise<VercelProjectInfo> {
    const id = checkId(projectId);
    const [d, e] = await Promise.all([
      this.req<{
        domains: {
          name: string;
          verified: boolean;
          redirect?: string | null;
          gitBranch?: string | null;
        }[];
      }>(`/v9/projects/${id}/domains?limit=50`, teamId).catch(() => ({ domains: [] })),
      this.req<{
        envs: {
          id: string;
          key: string;
          target?: string[] | string;
          type: string;
          gitBranch?: string;
        }[];
      }>(`/v9/projects/${id}/env`, teamId).catch(() => ({ envs: [] })),
    ]);
    const envs: VercelEnvView[] = e.envs.map((x) => ({
      id: x.id,
      key: x.key,
      branch: x.gitBranch ?? null,
      targets: Array.isArray(x.target) ? x.target : x.target ? [x.target] : [],
      type: x.type,
    }));
    return {
      domains: d.domains.map((x) => ({
        name: x.name,
        verified: x.verified,
        redirect: x.redirect ?? null,
        branch: x.gitBranch ?? null,
      })),
      envs,
    };
  }

  async deployments(projectId: string, teamId: string | null): Promise<VercelDeploymentView[]> {
    const { deployments } = await this.req<{
      deployments: {
        uid: string;
        url: string;
        state?: string;
        readyState?: string;
        target?: string | null;
        created: number;
        meta?: Record<string, string>;
        creator?: { username?: string };
        inspectorUrl?: string | null;
      }[];
    }>(`/v6/deployments?projectId=${checkId(projectId)}&limit=30`, teamId);
    return deployments.map((d) => ({
      id: d.uid,
      url: d.url,
      state: d.readyState ?? d.state ?? 'QUEUED',
      target: d.target ?? 'preview',
      created: d.created,
      branch:
        d.meta?.githubCommitRef ?? d.meta?.gitlabCommitRef ?? d.meta?.bitbucketCommitRef ?? null,
      commit:
        d.meta?.githubCommitMessage ??
        d.meta?.gitlabCommitMessage ??
        d.meta?.bitbucketCommitMessage ??
        null,
      sha: d.meta?.githubCommitSha ?? d.meta?.gitlabCommitSha ?? d.meta?.bitbucketCommitSha ?? null,
      creator: d.creator?.username ?? null,
      inspectorUrl: d.inspectorUrl ?? null,
    }));
  }

  async logs(deploymentId: string, teamId: string | null): Promise<string> {
    const events = await this.req<
      { type: string; created: number; text?: string; payload?: { text?: string } }[]
    >(
      `/v3/deployments/${checkId(deploymentId)}/events?builds=1&direction=forward&limit=-1`,
      teamId,
    );
    const lines = events
      .filter((e) => ['stdout', 'stderr', 'command', 'exit'].includes(e.type) || e.payload?.text)
      .map((e) => e.payload?.text ?? e.text ?? '')
      .filter(Boolean);
    const text = lines.join('\n');
    return text.length > MAX_LOG ? `…\n${text.slice(-MAX_LOG)}` : text;
  }

  async cancel(deploymentId: string, teamId: string | null): Promise<void> {
    await this.req(`/v12/deployments/${checkId(deploymentId)}/cancel`, teamId, { method: 'PATCH' });
  }

  async redeploy(
    deploymentId: string,
    teamId: string | null,
    production: boolean,
  ): Promise<string> {
    const id = checkId(deploymentId);
    const d = await this.req<{ name: string }>(`/v13/deployments/${id}`, teamId);
    const r = await this.req<{ url: string }>('/v13/deployments?forceNew=1', teamId, {
      method: 'POST',
      body: { name: d.name, deploymentId: id, ...(production ? { target: 'production' } : {}) },
    });
    return `https://${r.url}`;
  }

  /** Makes a READY deployment the production one again (instant rollback, no rebuild). */
  async promote(projectId: string, deploymentId: string, teamId: string | null): Promise<void> {
    await this.req(`/v10/projects/${checkId(projectId)}/promote/${checkId(deploymentId)}`, teamId, {
      method: 'POST',
    });
  }

  async removeDeployment(deploymentId: string, teamId: string | null): Promise<void> {
    await this.req(`/v13/deployments/${checkId(deploymentId)}`, teamId, { method: 'DELETE' });
  }

  /** Creates or replaces a variable (stored encrypted by Vercel; the value is never read back). */
  async setEnv(
    projectId: string,
    teamId: string | null,
    key: string,
    value: string,
    targets: string[],
  ): Promise<void> {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(key))
      throw new Error('Nombre de variable no válido (letras, números y _).');
    const target = targets.filter((x) => (ENV_TARGETS as readonly string[]).includes(x));
    if (!target.length) throw new Error('Elige al menos un entorno.');
    await this.req(`/v10/projects/${checkId(projectId)}/env?upsert=true`, teamId, {
      method: 'POST',
      body: { key, value, type: 'encrypted', target },
    });
  }

  async deleteEnv(projectId: string, teamId: string | null, envId: string): Promise<void> {
    await this.req(`/v9/projects/${checkId(projectId)}/env/${checkId(envId)}`, teamId, {
      method: 'DELETE',
    });
  }

  async addDomain(projectId: string, teamId: string | null, name: string): Promise<void> {
    await this.req(`/v10/projects/${checkId(projectId)}/domains`, teamId, {
      method: 'POST',
      body: { name: checkDomain(name) },
    });
  }

  async removeDomain(projectId: string, teamId: string | null, name: string): Promise<void> {
    await this.req(
      `/v9/projects/${checkId(projectId)}/domains/${encodeURIComponent(checkDomain(name))}`,
      teamId,
      { method: 'DELETE' },
    );
  }

  /** Asks Vercel to check the DNS of a domain again. */
  async verifyDomain(projectId: string, teamId: string | null, name: string): Promise<boolean> {
    const r = await this.req<{ verified?: boolean }>(
      `/v9/projects/${checkId(projectId)}/domains/${encodeURIComponent(checkDomain(name))}/verify`,
      teamId,
      { method: 'POST' },
    );
    return r?.verified ?? false;
  }

  async settings(projectId: string, teamId: string | null): Promise<VercelSettings> {
    const p = await this.req<Record<string, unknown>>(`/v9/projects/${checkId(projectId)}`, teamId);
    const str = (k: string) => (typeof p[k] === 'string' && p[k] ? (p[k] as string) : null);
    return Object.fromEntries(SETTING_KEYS.map((k) => [k, str(k)])) as unknown as VercelSettings;
  }

  /** Changes build settings; an empty value goes back to Vercel's default. */
  async updateSettings(
    projectId: string,
    teamId: string | null,
    patch: Partial<VercelSettings>,
  ): Promise<void> {
    const body: Record<string, string | null> = {};
    for (const k of SETTING_KEYS) {
      if (!(k in patch)) continue;
      const v = patch[k]?.trim() ?? '';
      if (v.length > 256) throw new Error('Valor demasiado largo.');
      body[k] = v || null;
    }
    if (body.nodeVersion === null) delete body.nodeVersion;
    if (!Object.keys(body).length) return;
    await this.req(`/v9/projects/${checkId(projectId)}`, teamId, { method: 'PATCH', body });
  }
}

/** .vercel/project.json written by `vercel link` in the open folder. */
export function linkedProject(root: string): { projectId: string; teamId: string | null } | null {
  try {
    const j = JSON.parse(readFileSync(join(root, '.vercel', 'project.json'), 'utf8')) as {
      projectId?: unknown;
      orgId?: unknown;
    };
    if (typeof j.projectId !== 'string') return null;
    const org = typeof j.orgId === 'string' ? j.orgId : '';
    return { projectId: j.projectId, teamId: org.startsWith('team_') ? org : null };
  } catch {
    return null;
  }
}
