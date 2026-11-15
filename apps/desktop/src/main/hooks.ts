import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  EMPTY_KIT,
  KIT_DIRS,
  dedupe,
  kitTemplate,
  parseAgentDef,
  parseCommand,
  parseHookSettings,
  parseSkill,
  type AgentKit,
  type HookDef,
  type HookResult,
  type KitKind,
} from '../shared/agentKit.js';
import { childEnv } from './env.js';
import type { Workspace } from './workspace.js';

/**
 * Fase 4, main side: reads subagents, skills, "/" commands and hooks from the project
 * (.zinarix/…, .claude/…) and from the user's ~/.zinarix, and runs hook commands.
 */

const MAX_KIT_FILE = 256 * 1024;
const MAX_PER_DIR = 100;
const MAX_HOOK_OUTPUT = 64 * 1024;

/** The user's own folder for agents, skills, commands and settings (all projects). */
export function userKitRoot(): string {
  return join(homedir(), '.zinarix');
}

type Reader = {
  /** Text of a file, or null (missing, too big, outside the folder). */
  read(rel: string): string | null;
  /** Entries of a folder (names), or []. */
  list(rel: string): { name: string; dir: boolean }[];
  /** How a path is shown to the agent (project-relative or absolute). */
  show(rel: string): string;
};

function projectReader(ws: Workspace): Reader {
  return {
    read(rel) {
      try {
        const abs = ws.resolve(rel);
        if (!existsSync(abs)) return null;
        const st = statSync(abs);
        return st.isFile() && st.size <= MAX_KIT_FILE ? readFileSync(abs, 'utf8') : null;
      } catch {
        return null; // escapes the project (symlink) or unreadable
      }
    },
    list(rel) {
      try {
        const abs = ws.resolve(rel);
        if (!existsSync(abs)) return [];
        return readdirSync(abs, { withFileTypes: true })
          .map((d) => ({ name: d.name, dir: d.isDirectory() }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, MAX_PER_DIR);
      } catch {
        return [];
      }
    },
    show: (rel) => rel,
  };
}

function userReader(root: string): Reader {
  const abs = (rel: string) => join(root, ...rel.split('/'));
  return {
    read(rel) {
      try {
        const p = abs(rel);
        if (!existsSync(p)) return null;
        const st = statSync(p);
        return st.isFile() && st.size <= MAX_KIT_FILE ? readFileSync(p, 'utf8') : null;
      } catch {
        return null;
      }
    },
    list(rel) {
      try {
        const p = abs(rel);
        if (!existsSync(p)) return [];
        return readdirSync(p, { withFileTypes: true })
          .map((d) => ({ name: d.name, dir: d.isDirectory() }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, MAX_PER_DIR);
      } catch {
        return [];
      }
    },
    show: (rel) => abs(rel),
  };
}

function readKit(r: Reader, base: string, hooks: boolean): AgentKit {
  const kit: AgentKit = { agents: [], skills: [], commands: [], hooks: [] };
  // ~/.zinarix/agents, not ~/.zinarix/.zinarix/agents
  const dirs = (list: readonly string[]) =>
    base
      ? list.filter((d) => d.startsWith('.zinarix/')).map((d) => d.slice('.zinarix/'.length))
      : list;
  for (const dir of dirs(KIT_DIRS.agents))
    for (const e of r.list(dir)) {
      if (e.dir || !e.name.toLowerCase().endsWith('.md')) continue;
      const text = r.read(`${dir}/${e.name}`);
      const def = text === null ? null : parseAgentDef(r.show(`${dir}/${e.name}`), text);
      if (def) kit.agents.push(def);
    }
  for (const dir of dirs(KIT_DIRS.skills))
    for (const e of r.list(dir)) {
      if (!e.dir) continue;
      const text = r.read(`${dir}/${e.name}/SKILL.md`) ?? r.read(`${dir}/${e.name}/skill.md`);
      const def = text === null ? null : parseSkill(r.show(`${dir}/${e.name}`), text);
      if (def) kit.skills.push(def);
    }
  for (const dir of dirs(KIT_DIRS.commands))
    for (const e of r.list(dir)) {
      if (e.dir || !e.name.toLowerCase().endsWith('.md')) continue;
      const text = r.read(`${dir}/${e.name}`);
      const def = text === null ? null : parseCommand(r.show(`${dir}/${e.name}`), text);
      if (def) kit.commands.push(def);
    }
  if (hooks)
    for (const file of dirs(KIT_DIRS.settings)) {
      const text = r.read(file);
      if (text !== null) kit.hooks.push(...parseHookSettings(text, r.show(file)));
    }
  return kit;
}

/**
 * Everything the project and the user add to the agent. The project's definitions win when
 * a name repeats; hooks of both are kept (they all run).
 */
export function loadKit(
  ws: Workspace | undefined,
  userRoot: string | null = userKitRoot(),
): AgentKit {
  const parts: AgentKit[] = [];
  if (ws) parts.push(readKit(projectReader(ws), '', true));
  if (userRoot) parts.push(readKit(userReader(userRoot), userRoot, true));
  if (!parts.length) return EMPTY_KIT;
  return {
    agents: dedupe(parts.flatMap((p) => p.agents)),
    skills: dedupe(parts.flatMap((p) => p.skills)),
    commands: dedupe(parts.flatMap((p) => p.commands)),
    hooks: parts.flatMap((p) => p.hooks),
  };
}

/**
 * Hook sets the user approved "always", per project folder (like the project's MCP file):
 * <userData>/hooks-trust.json. A changed hook command needs a new approval.
 */
export class HookTrust {
  private trust: Record<string, string[]> = {};

  constructor(private readonly dir: string) {
    try {
      const v = JSON.parse(readFileSync(join(dir, 'hooks-trust.json'), 'utf8')) as unknown;
      if (v && typeof v === 'object') this.trust = v as Record<string, string[]>;
    } catch {
      this.trust = {};
    }
  }

  has(root: string, fingerprint: string): boolean {
    return Array.isArray(this.trust[root]) && this.trust[root]!.includes(fingerprint);
  }

  add(root: string, fingerprint: string): void {
    // Only the latest few sets per folder (an edited settings.json leaves old ones behind).
    this.trust[root] = [
      fingerprint,
      ...(this.trust[root] ?? []).filter((f) => f !== fingerprint),
    ].slice(0, 5);
    try {
      writeFileSync(
        join(this.dir, 'hooks-trust.json'),
        JSON.stringify(this.trust, null, 2),
        'utf8',
      );
    } catch {
      // read-only profile: trusted for this run only
    }
  }
}

/**
 * A new subagent, skill or "/" command in the project's .zinarix folder, from a template.
 * Never overwrites: a name in use gets "-2", "-3"…  Returns the project-relative path.
 */
export function createKitFile(ws: Workspace, kind: KitKind, name: string): string {
  const kit = loadKit(ws, null);
  const taken =
    kind === 'agent'
      ? kit.agents.map((a) => a.name)
      : kind === 'skill'
        ? kit.skills.map((k) => k.name)
        : kit.commands.map((c) => c.name);
  for (let i = 0; i < 50; i++) {
    const t = kitTemplate(kind, name, taken);
    const abs = ws.resolve(t.path);
    if (existsSync(kind === 'skill' ? dirname(abs) : abs)) {
      taken.push(t.name);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, t.content, { encoding: 'utf8', flag: 'wx' });
    return t.path;
  }
  throw new Error('No free name for the new file.');
}

/** Files that come with a skill (scripts, templates…), for use_skill. */
export function skillFiles(ws: Workspace | undefined, dir: string): string[] {
  const out: string[] = [];
  const walk = (r: Reader, rel: string, depth: number) => {
    for (const e of r.list(rel)) {
      if (out.length >= 60) return;
      const p = `${rel}/${e.name}`;
      if (e.dir) {
        if (depth < 3) walk(r, p, depth + 1);
      } else if (!/^skill\.md$/i.test(e.name)) out.push(r.show(p));
    }
  };
  const user = userKitRoot();
  if (dir.startsWith(user)) {
    const rel = dir
      .slice(user.length)
      .replace(/^[\\/]+/, '')
      .split(/[\\/]/)
      .join('/');
    walk(userReader(user), rel, 0);
  } else if (ws) walk(projectReader(ws), dir, 0);
  return out;
}

/**
 * Runs one hook: the JSON goes on stdin, the shell is the same as run_command's (PowerShell
 * on Windows). Provider keys never reach it (childEnv). Killed on timeout or when the turn stops.
 */
export function runHook(
  hook: HookDef,
  input: Record<string, unknown>,
  cwd: string,
  signal: AbortSignal,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const env: Record<string, string> = {
      ...childEnv(process.env),
      ZINARIX_PROJECT_DIR: cwd,
      // Hooks written for Claude Code read this one.
      CLAUDE_PROJECT_DIR: cwd,
      ZINARIX_HOOK_EVENT: hook.event,
    };
    // PowerShell -Command exits 0/1, not the program's code: pass the real one on (exit 2 blocks).
    const script = isWin
      ? `${hook.command}\n$zxOk = $?; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $zxOk) { exit 1 }`
      : hook.command;
    let child;
    try {
      child = spawn(
        isWin ? 'powershell.exe' : process.env.SHELL || '/bin/sh',
        isWin ? ['-NoProfile', '-NonInteractive', '-Command', script] : ['-c', script],
        { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !isWin },
      );
    } catch (e) {
      resolve({ code: 127, stdout: '', stderr: e instanceof Error ? e.message : String(e) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_HOOK_OUTPUT) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_HOOK_OUTPUT) stderr += d.toString('utf8');
    });
    const kill = () => {
      try {
        if (isWin && child.pid)
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          }).on('error', () => child.kill());
        else if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill();
      }
    };
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, ...(timedOut ? { timedOut } : {}) });
    };
    const onAbort = () => {
      kill();
      done(130);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
      done(null);
    }, hook.timeout * 1000);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    child.on('error', (e) => {
      stderr += e.message;
      done(127);
    });
    child.on('close', (code) => done(code));
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}
