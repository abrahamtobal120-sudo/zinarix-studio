import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, join } from 'node:path';
import type { IPty } from '@lydell/node-pty';
import { childEnv } from './env.js';

const require = createRequire(import.meta.url);

interface Shell {
  file: string;
  args: string[];
}

/** A shell the user can pick in the terminal panel ("PowerShell", "Git Bash", "WSL"…). */
export interface ShellProfile {
  id: string;
  name: string;
}

interface Profile extends ShellProfile, Shell {}

/** Full path of a program on PATH (with PATHEXT on Windows), or undefined. */
function which(name: string): string | undefined {
  const exts =
    process.platform === 'win32'
      ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())]
      : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

function firstExisting(paths: (string | undefined)[]): string | undefined {
  return paths.find((p): p is string => Boolean(p && existsSync(p)));
}

/**
 * Shells installed on this machine, default first. Windows: PowerShell 7, Windows
 * PowerShell, cmd, Git Bash and WSL, by full path (a packaged app may start with a short
 * PATH, and COMSPEC can be missing). Linux/macOS: the login shell plus the other common ones.
 */
function profiles(): Profile[] {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
    const sys32 = join(root, 'System32');
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    const list: Profile[] = [];
    const pwsh = which('pwsh') ?? firstExisting([join(pf, 'PowerShell', '7', 'pwsh.exe')]);
    if (pwsh) list.push({ id: 'pwsh', name: 'PowerShell 7', file: pwsh, args: ['-NoLogo'] });
    const ps = join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    list.push({
      id: 'powershell',
      name: 'Windows PowerShell',
      file: existsSync(ps) ? ps : 'powershell.exe',
      args: ['-NoLogo'],
    });
    list.push({
      id: 'cmd',
      name: 'Símbolo del sistema (cmd)',
      file: process.env.COMSPEC ?? join(sys32, 'cmd.exe'),
      args: [],
    });
    const git = which('git');
    const bash = firstExisting([
      join(pf, 'Git', 'bin', 'bash.exe'),
      process.env['ProgramFiles(x86)'] &&
        join(process.env['ProgramFiles(x86)']!, 'Git', 'bin', 'bash.exe'),
      process.env.LOCALAPPDATA &&
        join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
      // git.exe lives in <Git>\cmd or <Git>\bin.
      git && join(dirname(dirname(git)), 'bin', 'bash.exe'),
    ]);
    if (bash) list.push({ id: 'gitbash', name: 'Git Bash', file: bash, args: ['--login', '-i'] });
    const wsl = firstExisting([join(sys32, 'wsl.exe')]);
    if (wsl) list.push({ id: 'wsl', name: 'WSL (Linux)', file: wsl, args: [] });
    return list;
  }
  const list: Profile[] = [];
  const login = process.env.SHELL || '/bin/bash';
  list.push({ id: 'default', name: basename(login), file: login, args: ['-l'] });
  for (const name of ['bash', 'zsh', 'fish', 'sh']) {
    const file = which(name) ?? firstExisting([`/bin/${name}`, `/usr/bin/${name}`]);
    if (file && basename(file) !== basename(login))
      list.push({ id: name, name, file, args: name === 'sh' ? [] : ['-l'] });
  }
  return list;
}

/** Shells the user can pick in the panel (see profiles). */
export function shellProfiles(): ShellProfile[] {
  return profiles().map(({ id, name }) => ({ id, name }));
}

/**
 * Administrator shell inside the panel: `sudo -s` on Linux/macOS (asks for the password in
 * the terminal itself); gsudo on Windows when installed. undefined: Windows without gsudo
 * (see openElevatedWindow).
 */
function adminShell(base: Shell): Shell | undefined {
  if (process.platform === 'win32') {
    const gsudo = which('gsudo');
    return gsudo ? { file: gsudo, args: [base.file, ...base.args] } : undefined;
  }
  const sudo = which('sudo') ?? (existsSync('/usr/bin/sudo') ? '/usr/bin/sudo' : undefined);
  if (!sudo)
    throw new Error('sudo no está instalado: no se puede abrir una terminal de administrador.');
  return { file: sudo, args: ['-s'] };
}

/**
 * Windows without gsudo: a console can only be elevated in a new process, so this opens an
 * elevated PowerShell window (UAC prompt) in `cwd`.
 */
function openElevatedWindow(cwd: string): void {
  const dir = cwd.replace(/'/g, "''");
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Start-Process powershell.exe -Verb RunAs -WorkingDirectory '${dir}' -ArgumentList '-NoExit','-NoLogo'`,
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.on('error', () => {});
  child.unref();
}

/** Integrated terminals (xterm.js in the renderer, node-pty here). */
export class Terminals {
  private next = 1;
  private readonly ptys = new Map<number, IPty>();

  constructor(
    private readonly onData: (id: number, data: string) => void,
    private readonly onExit: (id: number, code: number) => void,
  ) {}

  /**
   * Starts a shell. admin: an administrator shell (see adminShell). Returns null when the
   * administrator shell was opened as a separate window instead (Windows without gsudo).
   */
  create(
    cwd: string,
    cols: number,
    rows: number,
    admin = false,
    profile?: string,
  ): { id: number; name: string } | null {
    const pty = require('@lydell/node-pty') as typeof import('@lydell/node-pty');
    // Never hand provider keys the app can read (catalog envVars, OMNI_KEY_*) to child shells.
    const env = {
      ...childEnv(process.env),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'ZinarixStudio',
    };
    const all = profiles();
    const picked = profile ? all.find((p) => p.id === profile) : undefined;
    if (profile && !picked) throw new Error(`Esa terminal ya no está disponible: ${profile}`);
    // A picked shell is tried alone; the default falls back through the others.
    let candidates: Profile[] = picked ? [picked] : all;
    if (admin) {
      const base = candidates[0]!;
      const a = adminShell(base);
      if (!a) {
        openElevatedWindow(cwd);
        return null;
      }
      candidates = [{ ...base, ...a, name: `admin` }];
    }
    let p: IPty | undefined;
    let name = '';
    let lastError: unknown;
    for (const c of candidates) {
      try {
        p = pty.spawn(c.file, c.args, { name: 'xterm-256color', cols, rows, cwd, env });
        name = c.name;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!p) {
      const msg = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`No se pudo iniciar la terminal: ${msg}`);
    }
    const id = this.next++;
    this.ptys.set(id, p);
    p.onData((d) => this.onData(id, d));
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id);
      this.onExit(id, exitCode);
    });
    return { id, name };
  }

  write(id: number, data: string): void {
    this.ptys.get(id)?.write(data);
  }

  resize(id: number, cols: number, rows: number): void {
    try {
      this.ptys.get(id)?.resize(Math.max(2, cols), Math.max(1, rows));
    } catch {
      // pty already gone
    }
  }

  kill(id: number): void {
    this.ptys.get(id)?.kill();
    this.ptys.delete(id);
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }
}
