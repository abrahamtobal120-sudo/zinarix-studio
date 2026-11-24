import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NotebookKernels } from '../src/main/jupyter.js';
import { runNotebookTool } from '../src/main/notebookTools.js';
import { DockerService } from '../src/main/docker.js';
import { dockerPreview, runDockerTool } from '../src/main/dockerTools.js';
import {
  ansiSpans,
  emptyNotebook,
  fromCodePoints,
  newCell,
  notebookToScript,
  parseCompleteReply,
  parseVariables,
  scriptExtension,
  serializeNotebook,
  toCodePoints,
  type NotebookEvent,
} from '../src/shared/notebook.js';
import {
  isDockerfile,
  parseDiskUsage,
  parseInspect,
  parseStats,
  pruneArgs,
  secretKey,
  validTag,
} from '../src/shared/docker.js';

// Mejoras de la Fase 2 (plan de funciones): notebook colors, export, completions, variables;
// Docker stats, details, disk, clean-up, pull and build.

describe('ANSI colors of outputs', () => {
  it('splits styled runs: 16 colors, bold, reset, 256 and true color', () => {
    const s = ansiSpans(
      '\u001b[0;31mZeroDivisionError\u001b[0m: x \u001b[1;32mok\u001b[39m!\u001b[38;5;196mR\u001b[48;2;1;2;3mB',
    );
    expect(s).toEqual([
      { text: 'ZeroDivisionError', fg: 1 },
      { text: ': x ' },
      { text: 'ok', fg: 2, bold: true },
      { text: '!', bold: true },
      { text: 'R', bold: true, fg: 'rgb(255,0,0)' },
      { text: 'B', bold: true, fg: 'rgb(255,0,0)', bg: 'rgb(1,2,3)' },
    ]);
  });

  it('drops other escapes and keeps plain text whole', () => {
    expect(ansiSpans('a\u001b[2Kb\u001b]0;title\u0007c')).toEqual([{ text: 'abc' }]);
    expect(ansiSpans('')).toEqual([]);
    expect(ansiSpans('\u001b[91mx').at(0)).toEqual({ text: 'x', fg: 9 });
  });
});

describe('export as a script', () => {
  it('writes the percent format with markdown commented out', () => {
    const nb = emptyNotebook();
    nb.cells = [
      newCell('markdown', '# Título\n\ntexto'),
      newCell('code', 'x = 1\nprint(x)\n\n'),
      newCell('raw', 'r'),
    ];
    expect(notebookToScript(nb)).toBe(
      '# %% [markdown]\n# # Título\n#\n# texto\n\n# %%\nx = 1\nprint(x)\n\n# %% [raw]\n# r\n',
    );
    expect(scriptExtension(nb)).toBe('.py');
    nb.metadata.language_info = { name: 'julia', file_extension: '.jl' };
    expect(scriptExtension(nb)).toBe('.jl');
    nb.metadata.language_info = { name: 'x', file_extension: '../evil' };
    expect(scriptExtension(nb)).toBe('.py');
  });
});

describe('kernel completions', () => {
  it('converts cursors between UTF-16 and code points', () => {
    const s = 'a😀b';
    expect(toCodePoints(s, 3)).toBe(2);
    expect(fromCodePoints(s, 2)).toBe(3);
    expect(fromCodePoints(s, 99)).toBe(s.length);
  });

  it('reads matches, their range and kinds', () => {
    const code = 'é = 1\nnp.ar';
    const r = parseCompleteReply(code, {
      status: 'ok',
      matches: ['np.array', 'np.arange', 'np.array'],
      cursor_start: 6,
      cursor_end: 11,
      metadata: {
        _jupyter_types_experimental: [
          { text: 'np.array', type: 'function', signature: '(object)' },
          { text: 'np.arange', type: '<unknown>' },
        ],
      },
    });
    expect(r).toEqual({
      start: 6,
      end: 11,
      matches: [
        { text: 'np.array', type: 'function', signature: '(object)' },
        { text: 'np.arange' },
      ],
    });
    expect(parseCompleteReply(code, { status: 'error' })).toBeNull();
  });
});

describe('variables', () => {
  it('decodes the base64 JSON the kernel returns', () => {
    const rows = [['df', 'pandas.DataFrame', '3x2', 3, '   a  b\n0  1  2']];
    const b64 = Buffer.from(JSON.stringify(rows)).toString('base64');
    expect(parseVariables({ status: 'ok', data: { 'text/plain': `'${b64}'` } })).toEqual([
      { name: 'df', type: 'pandas.DataFrame', shape: '3x2', size: 3, value: '   a  b\n0  1  2' },
    ]);
    expect(parseVariables({ status: 'error' })).toBeNull();
    expect(parseVariables({ status: 'ok', data: { 'text/plain': "'%%%'" } })).toBeNull();
  });
});

// Real kernel: needs Python with jupyter_server + ipykernel (ZINARIX_PYTHON or on PATH).
const root = mkdtempSync(join(tmpdir(), 'zs-nb2-'));
writeFileSync(join(root, 'v.ipynb'), serializeNotebook(emptyNotebook()));
const events: NotebookEvent[] = [];
const kernels = new NotebookKernels((e) => events.push(e));
const status = await kernels.status(root);
afterAll(async () => {
  await kernels.dispose();
  rmSync(root, { recursive: true, force: true });
});

function run(cellId: string, code: string) {
  return new Promise<void>((resolve) => {
    const off = kernels.on((e) => {
      if (e.kind === 'done' && e.cellId === cellId) {
        off();
        resolve();
      }
    });
    void kernels.execute('v.ipynb', cellId, code);
  });
}

describe.skipIf(!status.ok)('kernel completions, docs and variables (live)', () => {
  it('asks the running kernel', { timeout: 120_000 }, async () => {
    // Without a kernel nothing is started just to complete.
    expect(await kernels.complete('v.ipynb', 'pri', 3)).toBeNull();
    await kernels.start(root, 'v.ipynb', 'python3');
    await run('c1', "numeros = [1, 2, 3]\ntexto = 'hola'\nimport json\ndef f(): pass");
    const c = await kernels.complete('v.ipynb', 'numeros.ap', 10);
    // Applying the replaced range gives the full name (IPython answers "append" from 8 or
    // "numeros.append" from 0, depending on its version).
    const code = 'numeros.ap';
    expect(c?.matches.map((m) => code.slice(0, c.start) + m.text + code.slice(c.end))).toContain(
      'numeros.append',
    );
    const doc = await kernels.inspect('v.ipynb', 'len', 3);
    expect(doc).toMatch(/number of items/i);
    const vars = await kernels.variables('v.ipynb');
    // Modules and functions are left out; the run left no history behind.
    expect(vars?.map((v) => v.name).sort()).toEqual(['numeros', 'texto']);
    expect(vars?.find((v) => v.name === 'numeros')).toMatchObject({
      type: 'list',
      size: 3,
      value: '[1, 2, 3]',
    });
    const tool = await runNotebookTool(
      () => kernels,
      'notebook_variables',
      { path: 'v.ipynb' },
      root,
    );
    expect(tool.ok).toBe(true);
    expect(tool.content).toContain('texto: str len=4');
    // Silent: the execution count did not move.
    const dones: NotebookEvent[] = [];
    const off = kernels.on((e) => e.kind === 'done' && dones.push(e));
    await run('c2', '1');
    off();
    expect(dones[0]).toMatchObject({ executionCount: 2 });
  });
});

// ------------------------------------------------------------------ Docker

describe('docker parsing and checks', () => {
  it('reads docker inspect', () => {
    const d = parseInspect({
      Id: 'abcdef0123456789',
      Name: '/web',
      Created: '2026-11-20T10:00:00Z',
      State: { Status: 'exited', ExitCode: 137, StartedAt: 'x', Health: { Status: 'unhealthy' } },
      Config: {
        Image: 'nginx:alpine',
        Env: ['PATH=/usr/bin', 'DB_PASSWORD=secreto'],
        Cmd: ['nginx', '-g', 'daemon off;'],
        WorkingDir: '/app',
        Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'web' },
      },
      HostConfig: { RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 } },
      NetworkSettings: {
        Ports: {
          '80/tcp': [
            { HostIp: '0.0.0.0', HostPort: '8080' },
            { HostIp: '::', HostPort: '8080' },
          ],
          '443/tcp': null,
        },
        Networks: { shop_default: { IPAddress: '172.18.0.2' } },
      },
      Mounts: [
        { Type: 'volume', Name: 'data', Source: '/var/lib/x', Destination: '/data', RW: false },
      ],
    });
    expect(d).toMatchObject({
      id: 'abcdef012345',
      name: 'web',
      image: 'nginx:alpine',
      state: 'exited',
      exitCode: 137,
      health: 'unhealthy',
      command: 'nginx -g "daemon off;"',
      restart: 'on-failure:3',
      ports: [
        { container: '80/tcp', host: '8080' },
        { container: '443/tcp', host: '' },
      ],
      mounts: [{ type: 'volume', source: 'data', destination: '/data', rw: false }],
      networks: [{ name: 'shop_default', ip: '172.18.0.2' }],
      project: 'shop',
      service: 'web',
    });
    expect(d.env[1]).toEqual({ key: 'DB_PASSWORD', value: 'secreto' });
  });

  it('reads stats and disk usage rows', () => {
    expect(
      parseStats([
        {
          Name: 'web',
          CPUPerc: '0.50%',
          MemUsage: '24MiB / 7GiB',
          MemPerc: '0.3%',
          NetIO: '1kB / 2kB',
          BlockIO: '0B / 0B',
          PIDs: '3',
        },
      ])[0],
    ).toMatchObject({ name: 'web', cpu: '0.50%', mem: '24MiB / 7GiB' });
    expect(
      parseDiskUsage([
        { Type: 'Images', TotalCount: '4', Active: '1', Size: '1.2GB', Reclaimable: '900MB (75%)' },
      ])[0],
    ).toEqual({
      type: 'Images',
      total: '4',
      active: '1',
      size: '1.2GB',
      reclaimable: '900MB (75%)',
    });
  });

  it('checks tags, Dockerfile names, secrets and clean-ups', () => {
    expect(validTag('my-app:dev')).toBe(true);
    expect(validTag('localhost:5000/team/app')).toBe(true);
    expect(validTag('My-App:dev')).toBe(false);
    expect(validTag('app@sha256:' + 'a'.repeat(64))).toBe(false);
    expect(validTag('--rm')).toBe(false);
    for (const n of ['Dockerfile', 'dockerfile.dev', 'api.Dockerfile', 'Containerfile'])
      expect(isDockerfile(n)).toBe(true);
    for (const n of ['Dockerfile.', 'docker-compose.yml', 'README.md'])
      expect(isDockerfile(n)).toBe(false);
    expect(secretKey('POSTGRES_PASSWORD')).toBe(true);
    expect(secretKey('API_KEY')).toBe(true);
    expect(secretKey('PATH')).toBe(false);
    // Images: only the dangling ones, never -a.
    expect(pruneArgs('images')).toEqual(['image', 'prune', '-f']);
    expect(() => pruneArgs('everything' as never)).toThrow();
  });

  it('approval cards of the new tools', () => {
    expect(dockerPreview('docker_inspect', { container: 'web' })).toBeNull();
    expect(dockerPreview('docker_pull', { image: 'redis:7' })).toMatchObject({
      risk: 'medium',
      allowKey: 'docker_pull:redis:7',
    });
    expect(dockerPreview('docker_pull', { image: '--help' })).toHaveProperty('error');
    expect(dockerPreview('docker_build', { dockerfile: 'Dockerfile', tag: 'Bad' })).toHaveProperty(
      'error',
    );
    expect(
      dockerPreview('docker_build', { dockerfile: 'Dockerfile', tag: 'app:dev' }),
    ).toMatchObject({ risk: 'high' });
    const prune = dockerPreview('docker_prune', { kind: 'volumes' });
    expect(prune).toMatchObject({ risk: 'high', command: 'docker volume prune -f' });
    // Never "always".
    expect(prune).not.toHaveProperty('allowKey');
  });

  it('refuses a build with a Dockerfile outside the project', async () => {
    const svc = new DockerService();
    const dir = mkdtempSync(join(tmpdir(), 'zs-dkb-'));
    writeFileSync(join(dir, 'Dockerfile'), 'FROM scratch\n');
    await expect(
      svc.jobArgs(dir, { kind: 'build', dockerfile: '../Dockerfile', tag: 'x:y' }),
    ).rejects.toThrow(/no está en el proyecto/);
    const ok = await svc.jobArgs(dir, { kind: 'build', dockerfile: 'Dockerfile', tag: 'x:y' });
    expect(ok.args.slice(0, 3)).toEqual(['build', '-t', 'x:y']);
    expect(await svc.dockerfiles(dir)).toEqual(['Dockerfile']);
    rmSync(dir, { recursive: true, force: true });
  });
});

// Real engine: skipped (not faked) when Docker is not running or hello-world is not pulled.
const live = new DockerService();
const engine = await live.status();
let hasHello = false;
if (engine.state === 'running')
  try {
    hasHello = execFileSync('docker', ['images', '-q', 'hello-world']).toString().trim().length > 0;
  } catch {
    hasHello = false;
  }

describe.skipIf(engine.state !== 'running')('docker on the real engine (mejoras)', () => {
  it('disk usage and stats answer', { timeout: 60_000 }, async () => {
    const disk = await runDockerTool(live, 'docker_ps', { what: 'disk' }, undefined);
    expect(disk.ok).toBe(true);
    expect(disk.content).toMatch(/Images:/);
    const stats = await runDockerTool(live, 'docker_ps', { what: 'stats' }, undefined);
    expect(stats.ok).toBe(true);
  });

  it.skipIf(!hasHello)('inspects a container', { timeout: 60_000 }, async () => {
    const name = `zs-insp-${Date.now().toString(36)}`;
    await live.runContainer({
      image: 'hello-world',
      name,
      env: ['SECRET_TOKEN=abc', 'COLOR=blue'],
    });
    try {
      const d = await live.inspect(name);
      expect(d.name).toBe(name);
      expect(d.image).toBe('hello-world');
      const tool = await runDockerTool(live, 'docker_inspect', { container: name }, undefined);
      expect(tool.content).toContain('COLOR=blue');
      expect(tool.content).toContain('SECRET_TOKEN=(hidden)');
      expect(tool.content).not.toContain('=abc');
    } finally {
      await live.action('rm', name);
    }
  });
});
