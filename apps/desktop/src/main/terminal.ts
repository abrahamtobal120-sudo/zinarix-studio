import { createRequire } from 'node:module';
import type { IPty } from '@lydell/node-pty';

const require = createRequire(import.meta.url);

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32')
    return { file: process.env.COMSPEC ?? 'powershell.exe', args: [] };
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

/** Integrated terminals (xterm.js in the renderer, node-pty here). */
export class Terminals {
  private next = 1;
  private readonly ptys = new Map<number, IPty>();

  constructor(
    private readonly onData: (id: number, data: string) => void,
    private readonly onExit: (id: number, code: number) => void,
  ) {}

  create(cwd: string, cols: number, rows: number): number {
    const pty = require('@lydell/node-pty') as typeof import('@lydell/node-pty');
    const { file, args } = defaultShell();
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'ZinarixStudio',
    } as Record<string, string>;
    // Never hand provider keys loaded by the app to child shells.
    for (const k of Object.keys(env))
      if (k.startsWith('OMNI_KEY_') || k === 'OMNI_VAULT_PASSWORD') delete env[k];
    const p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
    const id = this.next++;
    this.ptys.set(id, p);
    p.onData((d) => this.onData(id, d));
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id);
      this.onExit(id, exitCode);
    });
    return id;
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
