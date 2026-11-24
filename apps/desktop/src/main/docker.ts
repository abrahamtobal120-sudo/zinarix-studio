import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { childEnv } from './env.js';
import type {
  DockerAction,
  DockerContainer,
  DockerDetails,
  DockerDiskRow,
  DockerJob,
  DockerPrune,
  DockerStats,
  DockerImage,
  DockerNetwork,
  DockerRunSpec,
  DockerStatus,
  DockerVolume,
} from '../shared/docker.js';
import {
  composeProject,
  isDockerfile,
  parseDiskUsage,
  parseInspect,
  parseStats,
  pruneArgs,
  validTag,
  parseJsonLines,
  validImage,
  validName,
  validPort,
  validEnv,
  validVolume,
} from '../shared/docker.js';

/**
 * Fase 2B (plan de funciones): Docker through its own CLI (`docker … --format '{{json .}}'`),
 * so it works the same with Docker Desktop, Colima, Rancher or a remote DOCKER_HOST. Commands
 * are always run without a shell and with validated arguments (never a raw command line).
 */

const run = (args: string[], timeout = 30_000, cwd?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      'docker',
      args,
      { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: childEnv(process.env), cwd },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || '').trim() || err.message;
          reject(new Error(msg.split('\n').slice(-4).join('\n')));
        } else resolve(String(stdout));
      },
    );
  });

const COMPOSE_NAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

export class DockerService {
  /** Live `docker logs -f` per stream key. */
  private streams = new Map<string, ChildProcess>();

  async status(): Promise<DockerStatus> {
    let client: string;
    try {
      client = (await run(['version', '--format', '{{.Client.Version}}'], 10_000)).trim();
    } catch (e) {
      const m = (e as Error).message;
      // The client prints its version even when the engine is down.
      const v = /^\s*([\d.]+)/m.exec(m)?.[1];
      if (!v && /ENOENT|not recognized|not found/i.test(m)) return { state: 'missing' };
      client = v ?? '';
    }
    try {
      const server = (await run(['version', '--format', '{{.Server.Version}}'], 15_000)).trim();
      return { state: 'running', client, server };
    } catch (e) {
      return { state: 'stopped', client, message: (e as Error).message, canStart: !!desktopPath() };
    }
  }

  /** Opens Docker Desktop (Windows / macOS) so its engine starts. */
  startDesktop(): void {
    const p = desktopPath();
    if (!p) throw new Error('Docker Desktop no está instalado.');
    if (process.platform === 'darwin')
      spawn('open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' }).unref();
    else spawn(p, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  }

  async containers(): Promise<DockerContainer[]> {
    const rows = parseJsonLines(await run(['ps', '-a', '--no-trunc', '--format', '{{json .}}']));
    return rows.map((r) => ({
      id: String(r.ID ?? '').slice(0, 12),
      name: String(r.Names ?? ''),
      image: String(r.Image ?? ''),
      command: String(r.Command ?? '').replace(/^"|"$/g, ''),
      state: String(r.State ?? '').toLowerCase(),
      status: String(r.Status ?? ''),
      ports: String(r.Ports ?? ''),
      created: String(r.CreatedAt ?? ''),
      project: composeProject(String(r.Labels ?? '')),
    }));
  }

  async images(): Promise<DockerImage[]> {
    const rows = parseJsonLines(await run(['images', '--format', '{{json .}}']));
    return rows.map((r) => ({
      id: String(r.ID ?? ''),
      repository: String(r.Repository ?? ''),
      tag: String(r.Tag ?? ''),
      size: String(r.Size ?? ''),
      created: String(r.CreatedSince ?? r.CreatedAt ?? ''),
    }));
  }

  async volumes(): Promise<DockerVolume[]> {
    const rows = parseJsonLines(await run(['volume', 'ls', '--format', '{{json .}}']));
    return rows.map((r) => ({ name: String(r.Name ?? ''), driver: String(r.Driver ?? '') }));
  }

  async networks(): Promise<DockerNetwork[]> {
    const rows = parseJsonLines(await run(['network', 'ls', '--format', '{{json .}}']));
    return rows.map((r) => ({
      id: String(r.ID ?? ''),
      name: String(r.Name ?? ''),
      driver: String(r.Driver ?? ''),
      scope: String(r.Scope ?? ''),
    }));
  }

  async action(action: DockerAction, target: string): Promise<string> {
    if (action === 'rmi' ? !validImage(target) : !validName(target))
      throw new Error('Nombre no válido.');
    const args: Record<DockerAction, string[]> = {
      start: ['start', target],
      stop: ['stop', target],
      restart: ['restart', target],
      pause: ['pause', target],
      unpause: ['unpause', target],
      rm: ['rm', '-f', target],
      rmi: ['rmi', target],
      'volume-rm': ['volume', 'rm', target],
    };
    return (await run(args[action], 120_000)).trim();
  }

  async logs(target: string, tail = 200): Promise<string> {
    if (!validName(target)) throw new Error('Nombre no válido.');
    // Containers write to stdout and stderr: both are the log.
    return new Promise((resolve, reject) => {
      execFile(
        'docker',
        ['logs', '--tail', String(Math.max(1, Math.min(5000, tail))), '--timestamps', target],
        {
          timeout: 30_000,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          env: childEnv(process.env),
        },
        (err, stdout, stderr) => {
          if (err && !stdout && !stderr) return reject(err);
          if (err && /No such container/i.test(String(stderr)))
            return reject(new Error(String(stderr).trim()));
          resolve(interleave(String(stdout), String(stderr)));
        },
      );
    });
  }

  /** Follows a container's log; `onData` gets chunks until stopLogs (or the container ends). */
  followLogs(
    key: string,
    target: string,
    onData: (chunk: string) => void,
    onEnd: () => void,
  ): void {
    if (!validName(target)) throw new Error('Nombre no válido.');
    this.stopLogs(key);
    const p = spawn('docker', ['logs', '-f', '--tail', '300', target], {
      windowsHide: true,
      env: childEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.streams.set(key, p);
    p.stdout.on('data', (b: Buffer) => onData(b.toString('utf8')));
    p.stderr.on('data', (b: Buffer) => onData(b.toString('utf8')));
    p.on('close', () => {
      if (this.streams.get(key) === p) this.streams.delete(key);
      onEnd();
    });
    p.on('error', () => undefined);
  }

  stopLogs(key: string): void {
    const p = this.streams.get(key);
    if (!p) return;
    this.streams.delete(key);
    p.kill();
  }

  stopAllLogs(prefix = ''): void {
    for (const k of [...this.streams.keys()]) if (k.startsWith(prefix)) this.stopLogs(k);
  }

  /** `docker run -d` from a checked spec (no raw flags: no --privileged, no host network…). */
  async runContainer(spec: DockerRunSpec): Promise<string> {
    const args = runArgs(spec);
    return (await run(args, 15 * 60_000)).trim();
  }

  /** Compose files of the project (top folder and one level down). */
  async composeFiles(root: string): Promise<string[]> {
    return findFiles(root, (n) => COMPOSE_NAMES.includes(n.toLowerCase()));
  }

  async compose(
    root: string,
    file: string,
    action: 'up' | 'down' | 'ps' | 'restart' | 'pull',
  ): Promise<string> {
    const files = await this.composeFiles(root);
    if (!files.includes(file)) throw new Error('Ese archivo de compose no está en el proyecto.');
    const abs = join(root, file);
    const base = ['compose', '-f', abs];
    const args: Record<typeof action, string[]> = {
      up: [...base, 'up', '-d', '--remove-orphans'],
      down: [...base, 'down'],
      ps: [...base, 'ps', '-a'],
      restart: [...base, 'restart'],
      pull: [...base, 'pull'],
    };
    // compose writes its progress on stderr.
    return new Promise((resolve, reject) => {
      execFile(
        'docker',
        args[action],
        {
          timeout: 20 * 60_000,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          env: childEnv(process.env),
          cwd: join(abs, '..'),
        },
        (err, stdout, stderr) => {
          const text = `${String(stdout)}${String(stderr)}`.trim();
          if (err) reject(new Error(text.split('\n').slice(-8).join('\n') || err.message));
          else resolve(text);
        },
      );
    });
  }

  /** CPU, memory, network and disk use of the running containers (takes ~2 s). */
  async stats(): Promise<DockerStats[]> {
    return parseStats(
      parseJsonLines(await run(['stats', '--no-stream', '--format', '{{json .}}'], 30_000)),
    );
  }

  async inspect(target: string): Promise<DockerDetails> {
    if (!validName(target)) throw new Error('Nombre no válido.');
    const list = JSON.parse(await run(['inspect', '--type', 'container', target])) as unknown[];
    if (!Array.isArray(list) || !list.length) throw new Error(`No existe el contenedor ${target}.`);
    return parseInspect(list[0]);
  }

  /** Disk used by images, containers, volumes and the build cache. */
  async diskUsage(): Promise<DockerDiskRow[]> {
    return parseDiskUsage(
      parseJsonLines(await run(['system', 'df', '--format', '{{json .}}'], 60_000)),
    );
  }

  /** Removes what nothing uses (one kind at a time); returns docker's summary. */
  async prune(kind: DockerPrune): Promise<string> {
    return (await run(pruneArgs(kind), 10 * 60_000)).trim();
  }

  /** Dockerfiles of the project (top folder and one level down). */
  async dockerfiles(root: string): Promise<string[]> {
    return findFiles(root, (n) => isDockerfile(n));
  }

  /** Arguments of a pull / build job (throws on anything not allowed). */
  async jobArgs(root: string | null, job: DockerJob): Promise<{ args: string[]; cwd?: string }> {
    if (job.kind === 'pull') {
      if (!validImage(job.image)) throw new Error('Imagen no válida.');
      return { args: ['pull', job.image] };
    }
    if (!root) throw new Error('No hay carpeta abierta.');
    if (!validTag(job.tag))
      throw new Error('Nombre de imagen no válido (minúsculas, p. ej. mi-app:dev).');
    const files = await this.dockerfiles(root);
    if (!files.includes(job.dockerfile)) throw new Error('Ese Dockerfile no está en el proyecto.');
    const abs = join(root, job.dockerfile);
    const ctx = join(abs, '..');
    return { args: ['build', '-t', job.tag, '-f', abs, ctx], cwd: ctx };
  }

  /** Streams a pull / build: output chunks to onData, then onEnd(exit code 0?). */
  async startJob(
    key: string,
    root: string | null,
    job: DockerJob,
    onData: (chunk: string) => void,
    onEnd: (ok: boolean) => void,
  ): Promise<void> {
    const { args, cwd } = await this.jobArgs(root, job);
    this.stopLogs(key);
    const p = spawn('docker', args, {
      windowsHide: true,
      cwd,
      // Plain progress lines (BuildKit's fancy output needs a terminal).
      env: { ...childEnv(process.env), BUILDKIT_PROGRESS: 'plain' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.streams.set(key, p);
    p.stdout.on('data', (b: Buffer) => onData(b.toString('utf8')));
    p.stderr.on('data', (b: Buffer) => onData(b.toString('utf8')));
    let ended = false;
    const end = (ok: boolean) => {
      if (ended) return;
      ended = true;
      if (this.streams.get(key) === p) this.streams.delete(key);
      onEnd(ok);
    };
    p.on('close', (code) => end(code === 0));
    p.on('error', (e) => {
      onData(`${e.message}\n`);
      end(false);
    });
  }

  /** The same job, waited for (the agent's docker_pull / docker_build): output tail. */
  async runJob(root: string | null, job: DockerJob): Promise<string> {
    const { args, cwd } = await this.jobArgs(root, job);
    return new Promise((resolve, reject) => {
      execFile(
        'docker',
        args,
        {
          timeout: 30 * 60_000,
          windowsHide: true,
          maxBuffer: 64 * 1024 * 1024,
          cwd,
          env: { ...childEnv(process.env), BUILDKIT_PROGRESS: 'plain' },
        },
        (err, stdout, stderr) => {
          const text = `${String(stdout)}${String(stderr)}`.trim();
          const tail = text.split('\n').slice(-60).join('\n');
          if (err) reject(new Error(tail || err.message));
          else resolve(tail);
        },
      );
    });
  }

  dispose(): void {
    this.stopAllLogs();
  }
}

/** Files of a folder whose name matches (top folder and one level down), relative paths. */
async function findFiles(root: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const look = async (dir: string, depth: number) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries)
      if (e.isFile() && match(e.name))
        out.push(relative(root, join(dir, e.name)).replace(/\\/g, '/'));
    if (depth > 0)
      for (const e of entries)
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
          await look(join(dir, e.name), depth - 1);
  };
  await look(root, 1);
  return out;
}

/** Arguments of `docker run` for a spec (throws on anything not allowed). */
export function runArgs(spec: DockerRunSpec): string[] {
  if (!validImage(spec.image)) throw new Error('Imagen no válida.');
  const args = ['run', '-d'];
  if (spec.name) {
    if (!validName(spec.name)) throw new Error('Nombre no válido.');
    args.push('--name', spec.name);
  }
  for (const p of spec.ports ?? []) {
    if (!validPort(p)) throw new Error(`Puerto no válido: ${p}`);
    args.push('-p', p);
  }
  for (const e of spec.env ?? []) {
    if (!validEnv(e)) throw new Error(`Variable no válida: ${String(e).split('=')[0]}`);
    args.push('-e', e);
  }
  for (const v of spec.volumes ?? []) {
    if (!validVolume(v)) throw new Error(`Volumen no válido: ${v}`);
    args.push('-v', v);
  }
  if (spec.restart) {
    if (!['no', 'always', 'unless-stopped', 'on-failure'].includes(spec.restart))
      throw new Error('restart no válido.');
    args.push('--restart', spec.restart);
  }
  if (spec.rm) args.push('--rm');
  args.push(spec.image);
  if (spec.command?.length) {
    if (
      spec.command.length > 50 ||
      spec.command.some((c) => typeof c !== 'string' || c.length > 2000)
    )
      throw new Error('Comando no válido.');
    args.push(...spec.command);
  }
  return args;
}

/** stdout and stderr of `docker logs --timestamps`, merged back in time order. */
function interleave(out: string, err: string): string {
  const lines = [...out.split('\n'), ...err.split('\n')].filter((l) => l.trim());
  if (lines.every((l) => /^\d{4}-\d\d-\d\dT/.test(l))) lines.sort();
  return lines.join('\n');
}

function desktopPath(): string | null {
  if (process.platform === 'win32') {
    const p = join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Docker',
      'Docker',
      'Docker Desktop.exe',
    );
    return existsSync(p) ? p : null;
  }
  if (process.platform === 'darwin')
    return existsSync('/Applications/Docker.app') ? '/Applications/Docker.app' : null;
  return null;
}
