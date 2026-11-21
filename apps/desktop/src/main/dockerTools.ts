import type { ToolDefinition } from '@omni/shared';
import type { DockerService } from './docker.js';
import type { SystemPreview } from './system.js';
import {
  hostMounts,
  pruneArgs,
  secretKey,
  validImage,
  validTag,
  type DockerAction,
  type DockerJob,
  type DockerPrune,
  type DockerRunSpec,
} from '../shared/docker.js';
import { runArgs } from './docker.js';

/**
 * Fase 2B (plan de funciones): Docker for the agent. Listing and reading logs is free; anything
 * that changes containers is approved by the user (removing, running and compose every time).
 */

const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

export const DOCKER_TOOLS: ToolDefinition[] = [
  {
    name: 'docker_ps',
    description:
      'List Docker containers (running and stopped: name, image, state, ports, compose project). what="images" lists images, "volumes" volumes, "networks" networks, "compose" the compose files of the project, "dockerfiles" its Dockerfiles, "stats" CPU / memory / network use of the running containers, "disk" the disk used by images, containers, volumes and build cache (and how much can be freed). Also tells whether Docker is running.',
    parameters: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['containers', 'images', 'volumes', 'networks', 'compose', 'dockerfiles', 'stats', 'disk'],
        },
      },
    },
  },
  {
    name: 'docker_logs',
    description: 'Last lines of the log of a container (stdout and stderr, with timestamps).',
    parameters: {
      type: 'object',
      properties: {
        container: { type: 'string', description: 'Container name or id' },
        tail: { type: 'integer', minimum: 1, maximum: 2000, description: 'Lines (default 200)' },
      },
      required: ['container'],
    },
  },
  {
    name: 'docker_inspect',
    description:
      'Details of one container: image, command, working dir, state and exit code, health, restart policy, published ports, mounts (volumes and host folders), networks with IPs, environment variable names (values of secret-looking ones are hidden), compose project and service.',
    parameters: {
      type: 'object',
      properties: { container: { type: 'string', description: 'Container name or id' } },
      required: ['container'],
    },
  },
  {
    name: 'docker_action',
    description:
      'Change a container: start, stop, restart, pause, unpause or rm (remove, forced). rmi removes an image, volume-rm a volume (its data is lost). The user approves each call.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'pause', 'unpause', 'rm', 'rmi', 'volume-rm'] },
        target: { type: 'string', description: 'Container name / id, image, or volume' },
      },
      required: ['action', 'target'],
    },
  },
  {
    name: 'docker_run',
    description:
      'Start a new container in the background (docker run -d) from an image (pulled when missing). Only these options exist: name, ports ("8080:80"), env ("KEY=value"), volumes ("name:/data" or "./folder:/data"), restart policy, rm, and the command after the image. The user approves each call.',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'e.g. postgres:16, redis, nginx:alpine' },
        name: { type: 'string' },
        ports: strings('host:container ports, e.g. ["5432:5432"]'),
        env: strings('Environment variables, e.g. ["POSTGRES_PASSWORD=dev"]'),
        volumes: strings('Volumes, e.g. ["pgdata:/var/lib/postgresql/data"]'),
        restart: { type: 'string', enum: ['no', 'always', 'unless-stopped', 'on-failure'] },
        rm: { type: 'boolean', description: 'Remove the container when it stops' },
        command: strings('Command and arguments after the image'),
      },
      required: ['image'],
    },
  },
  {
    name: 'docker_compose',
    description:
      'docker compose with a compose file of the project (see docker_ps what="compose"): up (-d, build and start), down (stop and remove the containers), restart, pull, or ps. up/down/restart/pull are approved by the user.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Compose file, relative to the project (e.g. docker-compose.yml)' },
        action: { type: 'string', enum: ['up', 'down', 'restart', 'pull', 'ps'] },
      },
      required: ['file', 'action'],
    },
  },
  {
    name: 'docker_pull',
    description: 'Download (pull) an image from its registry, e.g. postgres:16. The user approves it.',
    parameters: {
      type: 'object',
      properties: { image: { type: 'string', description: 'Image reference, e.g. redis:7-alpine' } },
      required: ['image'],
    },
  },
  {
    name: 'docker_build',
    description:
      'Build an image from a Dockerfile of the project (see docker_ps what="dockerfiles"); the build context is the folder of the Dockerfile. Returns the end of the build output (errors included). The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        dockerfile: { type: 'string', description: 'Dockerfile path relative to the project, e.g. Dockerfile or api/Dockerfile' },
        tag: { type: 'string', description: 'Name of the image, lowercase, e.g. my-app:dev' },
      },
      required: ['dockerfile', 'tag'],
    },
  },
  {
    name: 'docker_prune',
    description:
      'Free disk space: kind "containers" removes stopped containers, "images" dangling (untagged) images, "build" the build cache, "volumes" volumes no container uses (their data is lost). Check docker_ps what="disk" first. The user approves each call.',
    parameters: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['containers', 'images', 'build', 'volumes'] } },
      required: ['kind'],
    },
  },
];

export const DOCKER_TOOL_NAMES = new Set(DOCKER_TOOLS.map((t) => t.name));

export const DOCKER_PROMPT_PART =
  '- docker_ps, docker_inspect, docker_logs, docker_action, docker_run, docker_compose, docker_pull, docker_build and docker_prune: the user\'s Docker (containers, images, volumes, compose files and Dockerfiles of the project, resource use). Read state and logs freely; changes are approved. When Docker is not running, tell the user to open Docker Desktop (the Docker panel has a button).';

const ACTION_ES: Record<DockerAction, string> = {
  start: 'iniciar',
  stop: 'detener',
  restart: 'reiniciar',
  pause: 'pausar',
  unpause: 'reanudar',
  rm: 'borrar el contenedor',
  rmi: 'borrar la imagen',
  'volume-rm': 'borrar el volumen',
};

const PRUNE_ES: Record<DockerPrune, string> = {
  containers: 'los contenedores detenidos',
  images: 'las imágenes sin nombre',
  build: 'la caché de construcción',
  volumes: 'los volúmenes sin usar',
};

const arr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

export function specFrom(a: Record<string, unknown>): DockerRunSpec {
  return {
    image: String(a.image ?? ''),
    ...(typeof a.name === 'string' && a.name ? { name: a.name } : {}),
    ...(arr(a.ports) ? { ports: arr(a.ports) } : {}),
    ...(arr(a.env) ? { env: arr(a.env) } : {}),
    ...(arr(a.volumes) ? { volumes: arr(a.volumes) } : {}),
    ...(typeof a.restart === 'string' ? { restart: a.restart as DockerRunSpec['restart'] } : {}),
    ...(a.rm === true ? { rm: true } : {}),
    ...(arr(a.command) ? { command: arr(a.command) } : {}),
  };
}

/** Shows the run as a command line, with env values hidden. */
function shownArgs(args: string[]): string {
  return [
    'docker',
    ...args.map((x, i) => (args[i - 1] === '-e' ? `${x.split('=')[0]}=…` : /\s/.test(x) ? JSON.stringify(x) : x)),
  ].join(' ');
}

export function dockerPreview(name: string, a: Record<string, unknown>): SystemPreview | { error: string } | null {
  try {
    if (name === 'docker_ps' || name === 'docker_logs' || name === 'docker_inspect') return null;
    if (name === 'docker_pull') {
      if (!validImage(a.image)) return { error: 'Invalid image reference.' };
      return {
        risk: 'medium',
        action: `Docker: descargar la imagen ${a.image}`,
        warning: 'Descarga una imagen de internet (puede ocupar varios GB).',
        command: `docker pull ${a.image}`,
        allowKey: `docker_pull:${a.image}`,
      };
    }
    if (name === 'docker_build') {
      if (!validTag(a.tag)) return { error: 'Invalid tag: use lowercase, e.g. my-app:dev.' };
      return {
        risk: 'high',
        action: `Docker: construir la imagen ${String(a.tag)} con ${String(a.dockerfile)}`,
        warning: 'Ejecuta los pasos del Dockerfile (RUN) y descarga lo que pidan.',
        command: `docker build -t ${String(a.tag)} -f ${String(a.dockerfile)} .`,
        allowKey: `docker_build:${String(a.dockerfile)}:${String(a.tag)}`,
      };
    }
    if (name === 'docker_prune') {
      const kind = a.kind as DockerPrune;
      const args = pruneArgs(kind);
      return {
        risk: 'high',
        action: `Docker: limpiar ${PRUNE_ES[kind]}`,
        warning:
          kind === 'volumes'
            ? 'Borra los volúmenes que ningún contenedor usa: sus datos se pierden para siempre.'
            : 'Borra lo que no se usa y no se puede deshacer.',
        command: `docker ${args.join(' ')}`,
        // No allowKey: never "always".
      };
    }
    if (name === 'docker_compose' && a.action === 'ps') return null;
    if (name === 'docker_action') {
      const action = a.action as DockerAction;
      if (!ACTION_ES[action]) return { error: 'Unknown action.' };
      const destroys = action === 'rm' || action === 'rmi' || action === 'volume-rm';
      return {
        risk: destroys ? 'high' : 'medium',
        action: `Docker: ${ACTION_ES[action]} ${String(a.target)}`,
        warning: destroys
          ? action === 'volume-rm'
            ? 'Los datos del volumen se pierden para siempre.'
            : 'Se borra y no se puede deshacer.'
          : 'Cambia el estado de un contenedor.',
        command: `docker ${action === 'rm' ? 'rm -f' : action === 'volume-rm' ? 'volume rm' : action} ${String(a.target)}`,
        // Start / stop / restart of the same container may be allowed "always"; deleting never.
        ...(destroys ? {} : { allowKey: `docker_action:${action}:${String(a.target)}` }),
      };
    }
    if (name === 'docker_run') {
      const spec = specFrom(a);
      const args = runArgs(spec);
      const mounts = hostMounts(spec.volumes);
      return {
        risk: 'high',
        action: `Docker: crear y ejecutar un contenedor de ${spec.image}`,
        warning: mounts.length
          ? `El contenedor podrá leer y escribir estas carpetas de tu PC: ${mounts.join(', ')}.`
          : 'Descarga la imagen si falta y ejecuta un programa en un contenedor.',
        command: shownArgs(args),
      };
    }
    if (name === 'docker_compose') {
      const act = String(a.action);
      if (!['up', 'down', 'restart', 'pull'].includes(act)) return { error: 'Unknown action.' };
      return {
        risk: act === 'down' ? 'high' : 'medium',
        action: `docker compose ${act} (${String(a.file)})`,
        warning:
          act === 'down'
            ? 'Detiene y borra los contenedores de este compose (los volúmenes se conservan).'
            : 'Construye, descarga o inicia los servicios del archivo compose.',
        command: `docker compose -f ${String(a.file)} ${act}${act === 'up' ? ' -d' : ''}`,
      };
    }
    return null;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const cut = (s: string, n = 20_000) => (s.length > n ? `${s.slice(0, n)}\n… (cut)` : s);

export async function runDockerTool(
  docker: DockerService | undefined,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
): Promise<{ ok: boolean; content: string; summary: string }> {
  if (!docker) return { ok: false, content: 'Docker is not available here.', summary: 'no disponible' };
  try {
    if (name === 'docker_ps' && a.what === 'dockerfiles') {
      if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
      const files = await docker.dockerfiles(root);
      return {
        ok: true,
        content: files.length ? files.join('\n') : 'No Dockerfile in the project.',
        summary: `${files.length} Dockerfile`,
      };
    }
    if (name === 'docker_ps' && a.what === 'compose') {
      if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
      const files = await docker.composeFiles(root);
      return {
        ok: true,
        content: files.length ? files.join('\n') : 'No compose file in the project.',
        summary: `${files.length} compose`,
      };
    }
    const st = await docker.status();
    if (st.state === 'missing')
      return { ok: false, content: 'Docker is not installed (no "docker" command).', summary: 'sin Docker' };
    if (st.state === 'stopped')
      return {
        ok: false,
        content: `Docker is installed (client ${st.client}) but its engine is not running: ${st.message}. Ask the user to start Docker Desktop.`,
        summary: 'Docker apagado',
      };
    if (name === 'docker_ps') {
      const what = typeof a.what === 'string' ? a.what : 'containers';
      if (what === 'images') {
        const list = await docker.images();
        return {
          ok: true,
          content: list.map((i) => `${i.repository}:${i.tag}  ${i.id}  ${i.size}  ${i.created}`).join('\n') || 'No images.',
          summary: `${list.length} imágenes`,
        };
      }
      if (what === 'stats') {
        const list = await docker.stats();
        return {
          ok: true,
          content:
            list.map((x) => `${x.name}  cpu=${x.cpu}  mem=${x.mem} (${x.memPerc})  net=${x.net}  disk=${x.block}  pids=${x.pids}`).join('\n') ||
            'No running containers.',
          summary: `${list.length} en marcha`,
        };
      }
      if (what === 'disk') {
        const rows = await docker.diskUsage();
        return {
          ok: true,
          content: rows.map((r) => `${r.type}: ${r.total} (active ${r.active}), size ${r.size}, reclaimable ${r.reclaimable}`).join('\n'),
          summary: 'espacio en disco',
        };
      }
      if (what === 'volumes') {
        const list = await docker.volumes();
        return { ok: true, content: list.map((v) => `${v.name} (${v.driver})`).join('\n') || 'No volumes.', summary: `${list.length} volúmenes` };
      }
      if (what === 'networks') {
        const list = await docker.networks();
        return { ok: true, content: list.map((n) => `${n.name} (${n.driver}, ${n.scope})`).join('\n'), summary: `${list.length} redes` };
      }
      const list = await docker.containers();
      return {
        ok: true,
        content:
          `Docker ${st.server}\n` +
          (list
            .map((c) => `${c.name}  [${c.state}] ${c.status}  image=${c.image}${c.ports ? `  ports=${c.ports}` : ''}${c.project ? `  compose=${c.project}` : ''}`)
            .join('\n') || 'No containers.'),
        summary: `${list.length} contenedores`,
      };
    }
    if (name === 'docker_inspect') {
      const d = await docker.inspect(String(a.container ?? ''));
      const env = d.env.map((e) => `${e.key}=${secretKey(e.key) ? '(hidden)' : e.value.slice(0, 200)}`);
      const lines = [
        `${d.name} (${d.id})  image=${d.image}`,
        `state=${d.state}${d.exitCode != null && d.state !== 'running' ? ` exit=${d.exitCode}` : ''}${d.health ? ` health=${d.health}` : ''}  started=${d.startedAt}`,
        `command: ${d.command || '(image default)'}${d.workdir ? `  workdir=${d.workdir}` : ''}`,
        `restart: ${d.restart}`,
        `ports: ${d.ports.map((p) => (p.host ? `${p.host}->${p.container}` : p.container)).join(', ') || 'none'}`,
        `mounts: ${d.mounts.map((m) => `${m.type} ${m.source} -> ${m.destination}${m.rw ? '' : ' (ro)'}`).join('; ') || 'none'}`,
        `networks: ${d.networks.map((n) => `${n.name}${n.ip ? ` ${n.ip}` : ''}`).join(', ') || 'none'}`,
        ...(d.project ? [`compose: ${d.project} / ${d.service ?? ''}`] : []),
        `env:\n  ${env.join('\n  ') || '(none)'}`,
      ];
      return { ok: true, content: lines.join('\n'), summary: d.state };
    }
    if (name === 'docker_pull' || name === 'docker_build') {
      const job: DockerJob =
        name === 'docker_pull'
          ? { kind: 'pull', image: String(a.image ?? '') }
          : { kind: 'build', dockerfile: String(a.dockerfile ?? ''), tag: String(a.tag ?? '') };
      const out = await docker.runJob(root ?? null, job);
      return { ok: true, content: cut(out || 'Done.'), summary: name === 'docker_pull' ? 'descargada' : 'construida' };
    }
    if (name === 'docker_prune') {
      const out = await docker.prune(a.kind as DockerPrune);
      return { ok: true, content: out || 'Nothing to remove.', summary: `limpieza: ${String(a.kind)}` };
    }
    if (name === 'docker_logs') {
      const log = await docker.logs(String(a.container ?? ''), typeof a.tail === 'number' ? a.tail : 200);
      return { ok: true, content: cut(log || '(empty log)'), summary: `${log.split('\n').length} líneas` };
    }
    if (name === 'docker_action') {
      const out = await docker.action(a.action as DockerAction, String(a.target ?? ''));
      return { ok: true, content: out || 'Done.', summary: ACTION_ES[a.action as DockerAction] ?? 'hecho' };
    }
    if (name === 'docker_run') {
      const id = await docker.runContainer(specFrom(a));
      return { ok: true, content: `Started container ${id.slice(0, 12)}.`, summary: id.slice(0, 12) };
    }
    if (name === 'docker_compose') {
      if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
      const out = await docker.compose(root, String(a.file ?? ''), a.action as 'up');
      return { ok: true, content: cut(out || 'Done.'), summary: `compose ${String(a.action)}` };
    }
    return { ok: false, content: `Unknown tool ${name}.`, summary: 'desconocida' };
  } catch (e) {
    return { ok: false, content: (e as Error).message, summary: 'error' };
  }
}
