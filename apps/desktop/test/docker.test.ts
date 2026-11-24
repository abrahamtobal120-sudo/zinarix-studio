import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  composeProject,
  hostMounts,
  parseJsonLines,
  validEnv,
  validImage,
  validName,
  validPort,
  validVolume,
} from '../src/shared/docker.js';
import { DockerService, runArgs } from '../src/main/docker.js';
import { dockerPreview, runDockerTool, specFrom } from '../src/main/dockerTools.js';

describe('docker CLI output', () => {
  it('reads one JSON object per line and skips the rest', () => {
    const rows = parseJsonLines(
      '{"ID":"abc","Names":"web"}\nWARNING: something\n\n{"ID":"def"}\r\n{bad',
    );
    expect(rows).toEqual([{ ID: 'abc', Names: 'web' }, { ID: 'def' }]);
  });

  it('finds the compose project in the labels', () => {
    expect(
      composeProject('a=b,com.docker.compose.project=shop,com.docker.compose.service=db'),
    ).toBe('shop');
    expect(composeProject('maintainer=me')).toBeNull();
  });
});

describe('argument checks', () => {
  it('names and images never look like flags', () => {
    expect(validName('web-1')).toBe(true);
    expect(validName('-rf')).toBe(false);
    expect(validName('a b')).toBe(false);
    expect(validImage('postgres:16')).toBe(true);
    expect(validImage('ghcr.io/org/app:1.2@sha256:' + 'a'.repeat(64))).toBe(true);
    expect(validImage('localhost:5000/x')).toBe(true);
    expect(validImage('--privileged')).toBe(false);
    expect(validImage('nginx; rm -rf /')).toBe(false);
  });

  it('ports, env and volumes', () => {
    for (const p of ['80', '8080:80', '127.0.0.1:5432:5432', '53:53/udp'])
      expect(validPort(p)).toBe(true);
    for (const p of ['0:80', '99999:1', '80:80:80', 'abc']) expect(validPort(p)).toBe(false);
    expect(validEnv('POSTGRES_PASSWORD=dev')).toBe(true);
    expect(validEnv('=x')).toBe(false);
    expect(validEnv('A=1\nB=2')).toBe(false);
    for (const v of [
      'pgdata:/var/lib/postgresql/data',
      './data:/data:ro',
      'C:\\proj\\data:/data',
      '/srv:/srv:rw',
    ])
      expect(validVolume(v)).toBe(true);
    for (const v of ['data', 'data:relative', 'a:/b:exec', '-v:/x', 'C:\\x'])
      expect(validVolume(v)).toBe(false);
    expect(hostMounts(['pgdata:/d', './x:/y', 'C:\\a:/b'])).toEqual(['./x:/y', 'C:\\a:/b']);
  });
});

describe('docker run', () => {
  it('builds the arguments from the allowed options only', () => {
    const args = runArgs({
      image: 'postgres:16',
      name: 'db',
      ports: ['5432:5432'],
      env: ['POSTGRES_PASSWORD=dev'],
      volumes: ['pgdata:/var/lib/postgresql/data'],
      restart: 'unless-stopped',
      command: ['postgres', '-c', 'log_statement=all'],
    });
    expect(args).toEqual([
      'run',
      '-d',
      '--name',
      'db',
      '-p',
      '5432:5432',
      '-e',
      'POSTGRES_PASSWORD=dev',
      '-v',
      'pgdata:/var/lib/postgresql/data',
      '--restart',
      'unless-stopped',
      'postgres:16',
      'postgres',
      '-c',
      'log_statement=all',
    ]);
  });

  it('refuses bad values', () => {
    expect(() => runArgs({ image: '--privileged' })).toThrow();
    expect(() => runArgs({ image: 'nginx', ports: ['x'] })).toThrow(/Puerto/);
    expect(() => runArgs({ image: 'nginx', restart: 'sometimes' as never })).toThrow();
  });
});

describe('approval cards', () => {
  it('reads are free; changes are approved, deleting never "always"', () => {
    expect(dockerPreview('docker_ps', {})).toBeNull();
    expect(dockerPreview('docker_logs', { container: 'web' })).toBeNull();
    expect(dockerPreview('docker_compose', { file: 'x.yml', action: 'ps' })).toBeNull();
    const stop = dockerPreview('docker_action', { action: 'stop', target: 'web' });
    expect(stop && 'allowKey' in stop && stop.allowKey).toBe('docker_action:stop:web');
    const rm = dockerPreview('docker_action', { action: 'rm', target: 'web' });
    expect(rm && 'risk' in rm && rm.risk).toBe('high');
    expect(rm && 'allowKey' in rm && rm.allowKey).toBeFalsy();
  });

  it('a run card hides env values and warns about host folders', () => {
    const card = dockerPreview('docker_run', {
      image: 'nginx',
      env: ['SECRET=hunter2'],
      volumes: ['./site:/usr/share/nginx/html:ro'],
      ports: ['8080:80'],
    });
    expect(card && 'command' in card && card.command).toContain('SECRET=…');
    expect(card && 'command' in card && card.command).not.toContain('hunter2');
    expect(card && 'warning' in card && card.warning).toContain('./site');
    expect(dockerPreview('docker_run', { image: '-x' })).toHaveProperty('error');
  });

  it('specFrom keeps only known fields', () => {
    expect(specFrom({ image: 'redis', privileged: true, ports: ['6379:6379', 5] })).toEqual({
      image: 'redis',
      ports: ['6379:6379'],
    });
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

describe.skipIf(!hasHello)('docker tools on the real engine', () => {
  it('runs a container, lists it, reads its log and removes it', async () => {
    const name = `zs-test-${Date.now().toString(36)}`;
    const run = await runDockerTool(live, 'docker_run', { image: 'hello-world', name }, undefined);
    expect(run.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    const ps = await runDockerTool(live, 'docker_ps', {}, undefined);
    expect(ps.content).toContain(name);
    const logs = await runDockerTool(live, 'docker_logs', { container: name }, undefined);
    expect(logs.content).toContain('Hello from Docker!');
    const rm = await runDockerTool(
      live,
      'docker_action',
      { action: 'rm', target: name },
      undefined,
    );
    expect(rm.ok).toBe(true);
    const after = await runDockerTool(live, 'docker_ps', {}, undefined);
    expect(after.content).not.toContain(name);
  }, 60_000);
});
