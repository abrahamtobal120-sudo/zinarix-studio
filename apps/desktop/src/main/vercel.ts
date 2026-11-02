import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from './token-store.js';
import type {
  VercelDeploymentView,
  VercelEnvView,
  VercelProjectInfo,
  VercelProjectView,
  VercelStatus,
} from '../shared/api.js';

const API = 'https://api.vercel.com';
const MAX_LOG = 400_000;

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

function cliToken(): string | null {
  for (const f of cliAuthFiles()) {
    try {
      const t = (JSON.parse(readFileSync(f, 'utf8')) as { token?: unknown }).token;
      if (typeof t === 'string' && t) return t;
    } catch {
      /* missing or unreadable */
    }
  }
  return null;
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

  private token(): { token: string; source: 'app' | 'cli' } | null {
    const saved = this.store.get();
    if (saved) return { token: saved, source: 'app' };
    const t = cliToken();
    return t ? { token: t, source: 'cli' } : null;
  }

  private async req<T>(
    path: string,
    teamId: string | null,
    init: { method?: string; body?: unknown; text?: boolean } = {},
  ): Promise<T> {
    const tok = this.token();
    if (!tok) throw new Error('Conecta tu cuenta de Vercel primero.');
    const url = new URL(path, API);
    if (teamId) url.searchParams.set('teamId', checkId(teamId));
    const r = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try {
        const e = (await r.json()) as { error?: { message?: string } };
        if (e.error?.message) msg = e.error.message;
      } catch {
        /* not JSON */
      }
      if (r.status === 401 || r.status === 403)
        msg = `Vercel rechazó el token (${msg}). Vuelve a conectar tu cuenta.`;
      throw new Error(msg);
    }
    return (init.text ? await r.text() : await r.json()) as T;
  }

  async status(): Promise<VercelStatus> {
    this.cli ??= await cliInstalled();
    const tok = this.token();
    const base: VercelStatus = {
      connected: false,
      source: null,
      user: null,
      teams: [],
      cli: this.cli,
    };
    if (!tok) return base;
    try {
      const { user } = await this.req<{ user: { username: string } }>('/v2/user', null);
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
    } catch {
      return { ...base, source: tok.source };
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
      this.req<{ domains: { name: string; verified: boolean }[] }>(
        `/v9/projects/${id}/domains?limit=20`,
        teamId,
      ).catch(() => ({ domains: [] })),
      this.req<{ envs: { key: string; target?: string[] | string; type: string }[] }>(
        `/v9/projects/${id}/env`,
        teamId,
      ).catch(() => ({ envs: [] })),
    ]);
    const envs: VercelEnvView[] = e.envs.map((x) => ({
      key: x.key,
      targets: Array.isArray(x.target) ? x.target : x.target ? [x.target] : [],
      type: x.type,
    }));
    return { domains: d.domains.map((x) => ({ name: x.name, verified: x.verified })), envs };
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
