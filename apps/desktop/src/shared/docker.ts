/**
 * Docker panel and docker_* agent tools (Fase 2B del plan de funciones): shared types and the
 * pure checks of what may be passed to the docker CLI. No Node or DOM imports: tested in Node.
 */

export type DockerStatus =
  | { state: 'running'; client: string; server: string }
  /** The CLI is there but the engine does not answer (Docker Desktop closed…). */
  | { state: 'stopped'; client: string; message: string; canStart: boolean }
  | { state: 'missing' };

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  command: string;
  /** running, exited, paused, created, restarting, dead… */
  state: string;
  /** "Up 3 minutes", "Exited (0) 2 hours ago". */
  status: string;
  ports: string;
  created: string;
  /** docker compose project, when it belongs to one. */
  project: string | null;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export type DockerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'rm' | 'rmi' | 'volume-rm';

export interface DockerRunSpec {
  image: string;
  name?: string;
  /** "8080:80", "127.0.0.1:5432:5432", "53:53/udp". */
  ports?: string[];
  /** "KEY=value". */
  env?: string[];
  /** "named-volume:/data", "C:\\proj\\data:/data:ro", "./data:/data". */
  volumes?: string[];
  restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  /** Remove the container when it stops. */
  rm?: boolean;
  /** Command and arguments after the image. */
  command?: string[];
}

export type DockerEvent =
  | { kind: 'logs'; key: string; chunk: string }
  | { kind: 'logs-end'; key: string }
  /** A pull / build streamed with the "logs" chunks ended (ok = exit code 0). */
  | { kind: 'job-end'; key: string; ok: boolean };

/** Live use of a running container (docker stats --no-stream). */
export interface DockerStats {
  name: string;
  /** "0.52%". */
  cpu: string;
  /** "24.5MiB / 7.6GiB". */
  mem: string;
  memPerc: string;
  net: string;
  block: string;
  pids: string;
}

/** What `docker inspect` tells about a container, for the details view and docker_inspect. */
export interface DockerDetails {
  id: string;
  name: string;
  image: string;
  created: string;
  state: string;
  startedAt: string;
  exitCode: number | null;
  /** healthy / unhealthy / starting, when the image has a HEALTHCHECK. */
  health: string | null;
  command: string;
  workdir: string;
  restart: string;
  ports: { container: string; host: string }[];
  env: { key: string; value: string }[];
  mounts: { type: string; source: string; destination: string; rw: boolean }[];
  networks: { name: string; ip: string }[];
  /** compose project / service, when it belongs to one. */
  project: string | null;
  service: string | null;
}

/** One row of `docker system df`. */
export interface DockerDiskRow {
  /** Images, Containers, Local Volumes, Build Cache. */
  type: string;
  total: string;
  active: string;
  size: string;
  reclaimable: string;
}

/** What "clean up" removes: stopped containers, dangling images, build cache, unused volumes. */
export type DockerPrune = 'containers' | 'images' | 'build' | 'volumes';

export type DockerJob =
  | { kind: 'pull'; image: string }
  /** dockerfile: relative to the project (one of the Dockerfiles found); tag: name:tag. */
  | { kind: 'build'; dockerfile: string; tag: string };

/** One JSON object per line (`--format '{{json .}}'`); bad lines are skipped. */
export function parseJsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      const v = JSON.parse(s) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      // a warning line, not JSON
    }
  }
  return out;
}

/** Compose project from the Labels column ("a=b,com.docker.compose.project=web,…"). */
export function composeProject(labels: string): string | null {
  const m = /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(labels);
  return m ? m[1]! : null;
}

/** Container name or id (also what `docker logs` / `start` accept). */
export function validName(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s);
}

/** Image reference: [registry[:port]/]path[:tag][@sha256:…]. Never starts with "-". */
export function validImage(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length <= 256 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._\-/:]*(@sha256:[a-f0-9]{64})?$/.test(s)
  );
}

export function validPort(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(?:(\d{1,5}):)?(\d{1,5})(?:\/(tcp|udp|sctp))?$/.exec(s);
  if (!m) return false;
  return [m[2], m[3]].every((p) => p === undefined || (Number(p) >= 1 && Number(p) <= 65535));
}

export function validEnv(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 32_768 && /^[A-Za-z_][A-Za-z0-9_.]*=/.test(s) && !/[\r\n\0]/.test(s);
}

/** "source:/container/path[:ro|rw]"; the source is a named volume or a host path. */
export function validVolume(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 1024 || /[\r\n\0]/.test(s) || s.startsWith('-')) return false;
  // A Windows drive ("C:\…") has a colon of its own.
  const drive = /^[A-Za-z]:[\\/]/.test(s) ? s.slice(0, 2) : '';
  const parts = s.slice(drive.length).split(':');
  if (parts.length < 2 || parts.length > 3) return false;
  const [src, dst, mode] = [drive + parts[0], parts[1]!, parts[2]];
  if (!src || src === drive) return false;
  if (!dst.startsWith('/')) return false;
  return mode === undefined || mode === 'ro' || mode === 'rw';
}

/** Volumes that mount a host folder (not a named volume): shown in the approval. */
export function hostMounts(volumes: string[] = []): string[] {
  return volumes.filter((v) => /^([A-Za-z]:[\\/]|[./~\\])/.test(v));
}

/** Image name docker build accepts as a tag (lowercase repository). */
export function validTag(s: unknown): s is string {
  if (!validImage(s) || s.includes('@')) return false;
  const colon = s.lastIndexOf(':');
  const hasTag = colon > s.lastIndexOf('/');
  const repo = hasTag ? s.slice(0, colon) : s;
  const tag = hasTag ? s.slice(colon + 1) : 'latest';
  return repo === repo.toLowerCase() && /^\w[\w.-]{0,127}$/.test(tag);
}

/** Names whose values look like secrets (hidden from the agent, masked in the panel). */
export function secretKey(k: string): boolean {
  return /pass|secret|token|key|pwd|auth|credential|private|cookie|session|dsn|database_url/i.test(k);
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** One element of `docker inspect <container>` → the details shown. */
export function parseInspect(raw: unknown): DockerDetails {
  const r = obj(raw);
  const st = obj(r.State);
  const cfg = obj(r.Config);
  const host = obj(r.HostConfig);
  const net = obj(r.NetworkSettings);
  const labels = obj(cfg.Labels);
  const ports: DockerDetails['ports'] = [];
  for (const [cport, binds] of Object.entries(obj(net.Ports))) {
    if (Array.isArray(binds) && binds.length)
      for (const b of binds) {
        const bo = obj(b);
        const ip = str(bo.HostIp);
        ports.push({ container: cport, host: `${ip && ip !== '0.0.0.0' && ip !== '::' ? `${ip}:` : ''}${str(bo.HostPort)}` });
      }
    else ports.push({ container: cport, host: '' });
  }
  // Same host port on IPv4 and IPv6 shows once.
  const seen = new Set<string>();
  const uniq = ports.filter((p) => {
    const k = `${p.container}|${p.host}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const env = (Array.isArray(cfg.Env) ? cfg.Env : []).map((e) => {
    const s = str(e);
    const i = s.indexOf('=');
    return i < 0 ? { key: s, value: '' } : { key: s.slice(0, i), value: s.slice(i + 1) };
  });
  const cmd = [...(Array.isArray(cfg.Entrypoint) ? cfg.Entrypoint : []), ...(Array.isArray(cfg.Cmd) ? cfg.Cmd : [])]
    .map(str)
    .map((x) => (/\s/.test(x) ? JSON.stringify(x) : x))
    .join(' ');
  const rp = obj(host.RestartPolicy);
  const health = obj(st.Health);
  return {
    id: str(r.Id).slice(0, 12),
    name: str(r.Name).replace(/^\//, ''),
    image: str(cfg.Image) || str(r.Image),
    created: str(r.Created),
    state: str(st.Status),
    startedAt: str(st.StartedAt),
    exitCode: typeof st.ExitCode === 'number' ? st.ExitCode : null,
    health: str(health.Status) || null,
    command: cmd,
    workdir: str(cfg.WorkingDir),
    restart: `${str(rp.Name) || 'no'}${typeof rp.MaximumRetryCount === 'number' && rp.MaximumRetryCount > 0 ? `:${rp.MaximumRetryCount}` : ''}`,
    ports: uniq,
    env,
    mounts: (Array.isArray(r.Mounts) ? r.Mounts : []).map((m) => {
      const mo = obj(m);
      return {
        type: str(mo.Type),
        source: str(mo.Type) === 'volume' ? str(mo.Name) || str(mo.Source) : str(mo.Source),
        destination: str(mo.Destination),
        rw: mo.RW !== false,
      };
    }),
    networks: Object.entries(obj(net.Networks)).map(([name, n]) => ({ name, ip: str(obj(n).IPAddress) })),
    project: str(labels['com.docker.compose.project']) || null,
    service: str(labels['com.docker.compose.service']) || null,
  };
}

/** Rows of `docker stats --no-stream --format '{{json .}}'`. */
export function parseStats(rows: Record<string, unknown>[]): DockerStats[] {
  return rows.map((r) => ({
    name: str(r.Name),
    cpu: str(r.CPUPerc),
    mem: str(r.MemUsage),
    memPerc: str(r.MemPerc),
    net: str(r.NetIO),
    block: str(r.BlockIO),
    pids: str(r.PIDs),
  }));
}

/** Rows of `docker system df --format '{{json .}}'`. */
export function parseDiskUsage(rows: Record<string, unknown>[]): DockerDiskRow[] {
  return rows.map((r) => ({
    type: str(r.Type),
    total: str(r.TotalCount),
    active: str(r.Active),
    size: str(r.Size),
    reclaimable: str(r.Reclaimable),
  }));
}

/** Arguments of each clean-up (never "-a" on images: only the dangling ones). */
export function pruneArgs(kind: DockerPrune): string[] {
  const args: Record<DockerPrune, string[]> = {
    containers: ['container', 'prune', '-f'],
    images: ['image', 'prune', '-f'],
    build: ['builder', 'prune', '-f'],
    volumes: ['volume', 'prune', '-f'],
  };
  const a = args[kind];
  if (!a) throw new Error('Limpieza no válida.');
  return a;
}

/** "Dockerfile", "Dockerfile.dev", "api.Dockerfile", "Containerfile". */
export function isDockerfile(name: string): boolean {
  return /^(dockerfile|containerfile)(\.[\w.-]+)?$|^[\w.-]+\.dockerfile$/i.test(name);
}
