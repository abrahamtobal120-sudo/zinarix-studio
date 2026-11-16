/**
 * Fase 5B: runs a background task's command inside the operating system's sandbox.
 * - Linux: bubblewrap (bwrap). Not installed, or user namespaces off = no sandbox.
 * - macOS: sandbox-exec with a generated profile (deprecated by Apple, still works; Codex
 *   CLI uses it too).
 * - Windows: a low-integrity token in a Job Object (main/sandboxWin.ts). Writes are confined;
 *   network and reads are not, so its commands still ask (and then run confined).
 * A sandbox is never faked.
 * Detection runs a probe once and is cached; the rules themselves are in shared/sandbox.ts.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  NO_SANDBOX,
  bwrapArgs,
  macProfile,
  secretDirs,
  winLauncherArgs,
  type SandboxCaps,
  type SandboxPaths,
} from '../shared/sandbox.js';
import { detectWindowsSandbox, windowsPowerShell } from './sandboxWin.js';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const PROBE_TIMEOUT = 5000;

/** Runs a probe; true when it exits with 0 in time. */
function probe(file: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, PROBE_TIMEOUT);
    child.on('error', () => {
      clearTimeout(t);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve(code === 0);
    });
  });
}

/** What the sandbox of this machine can do (the probe confines `true` for real). */
export async function detectSandbox(platform = process.platform): Promise<SandboxCaps> {
  if (platform === 'linux') {
    const tmp = tmpdir();
    const ok = await probe('bwrap', [
      ...bwrapArgs({ root: tmp, tmp, hidden: [] }),
      '--',
      '/bin/sh',
      '-c',
      'true',
    ]);
    return ok
      ? { kind: 'bwrap', write: true, network: true, secrets: true }
      : {
          ...NO_SANDBOX,
          reason:
            'No se encontró bubblewrap (bwrap) o el sistema no permite user namespaces. Instálalo con el gestor de paquetes (por ejemplo, apt install bubblewrap).',
        };
  }
  if (platform === 'darwin') {
    const ok =
      existsSync(SANDBOX_EXEC) &&
      (await probe(SANDBOX_EXEC, [
        '-p',
        '(version 1)\n(allow default)\n(deny network*)',
        '/usr/bin/true',
      ]));
    return ok
      ? { kind: 'sandbox-exec', write: true, network: true, secrets: true }
      : { ...NO_SANDBOX, reason: 'sandbox-exec no está disponible en este Mac.' };
  }
  if (platform === 'win32') return detectWindowsSandbox();
  return NO_SANDBOX;
}

let cached: Promise<SandboxCaps> | undefined;

/** detectSandbox(), once per app run. */
export function sandboxCaps(): Promise<SandboxCaps> {
  cached ??= detectSandbox();
  return cached;
}

/** The folders a confined command of the task in `root` uses and the ones it cannot see. */
export function sandboxPaths(root: string, dataDir: string, taskId: string): SandboxPaths {
  const real = (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  };
  const tmp = join(tmpdir(), `zinarix-task-${taskId.replace(/[^\w-]/g, '')}`);
  mkdirSync(tmp, { recursive: true });
  const hidden = [real(dataDir), ...secretDirs(homedir())].filter((p) => existsSync(p));
  return { root: real(root), tmp: real(tmp), hidden };
}

/** How to start `command` (a shell line) confined, or undefined when there is no sandbox. */
export function sandboxedSpawn(
  caps: SandboxCaps,
  paths: SandboxPaths,
  command: string,
): { file: string; args: string[] } | undefined {
  if (caps.kind === 'bwrap')
    return { file: 'bwrap', args: [...bwrapArgs(paths), '--', '/bin/bash', '-lc', command] };
  if (caps.kind === 'sandbox-exec')
    return {
      file: SANDBOX_EXEC,
      args: ['-p', macProfile(paths), '/bin/bash', '-lc', command],
    };
  // The whole tree of the command gets at most 3/4 of the memory of the machine.
  if (caps.kind === 'windows' && caps.helper)
    return {
      file: windowsPowerShell(),
      args: winLauncherArgs(caps.helper, paths, command, totalmem() * 0.75),
    };
  return undefined;
}
