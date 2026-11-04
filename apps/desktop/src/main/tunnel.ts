import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

/** Official cloudflared builds (the tunnel that gives the phone a public https address). */
const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';

function asset(): string | null {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null;
  if (!arch) return null;
  if (process.platform === 'linux') return `cloudflared-linux-${arch}`;
  if (process.platform === 'win32') return arch === 'amd64' ? 'cloudflared-windows-amd64.exe' : null;
  if (process.platform === 'darwin') return `cloudflared-darwin-${arch}.tgz`;
  return null;
}

/** cloudflared already installed on the system, or the copy the app downloads once. */
async function binary(onProgress: (msg: string) => void): Promise<string> {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const onPath = spawnSync(exe, ['--version'], { stdio: 'ignore', timeout: 5000 });
  if (onPath.status === 0) return exe;

  const dir = join(app.getPath('userData'), 'bin');
  const file = join(dir, exe);
  if (await stat(file).then((s) => s.size > 1_000_000, () => false)) return file;

  const name = asset();
  if (!name) throw new Error('El acceso a distancia no está disponible en este sistema.');
  onProgress('Descargando el componente de conexión (solo la primera vez)…');
  const res = await fetch(RELEASES + name);
  if (!res.ok) throw new Error(`No se pudo descargar cloudflared (HTTP ${res.status}).`);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.download`;
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  if (name.endsWith('.tgz')) {
    const r = spawnSync('tar', ['-xzf', tmp, '-C', dir, 'cloudflared'], { stdio: 'ignore' });
    await rm(tmp, { force: true });
    if (r.status !== 0) throw new Error('No se pudo descomprimir cloudflared.');
  } else {
    await rename(tmp, file);
  }
  await chmod(file, 0o755);
  return file;
}

/**
 * A Cloudflare quick tunnel to a local port: a random https://….trycloudflare.com address
 * that reaches this computer from anywhere, without opening ports or creating an account.
 */
export class Tunnel {
  private proc: ChildProcess | null = null;

  get running(): boolean {
    return this.proc !== null;
  }

  /** Resolves with the public URL; `onExit` runs if the tunnel dies later on its own. */
  async start(
    port: number,
    onProgress: (msg: string) => void,
    onExit: (error: string) => void,
  ): Promise<string> {
    this.stop();
    const bin = await binary(onProgress);
    onProgress('Abriendo la conexión segura…');
    const proc = spawn(
      bin,
      ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    this.proc = proc;
    return await new Promise<string>((ok, fail) => {
      let found = false;
      let log = '';
      const timer = setTimeout(() => {
        this.stop();
        fail(new Error('Cloudflare no respondió a tiempo. Revisa la conexión a internet.'));
      }, 45_000);
      const read = (chunk: Buffer) => {
        if (found) return;
        log = (log + chunk.toString('utf8')).slice(-4000);
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log);
        if (m) {
          found = true;
          clearTimeout(timer);
          ok(m[0]);
        }
      };
      proc.stdout?.on('data', read);
      proc.stderr?.on('data', read);
      proc.on('error', (e) => {
        clearTimeout(timer);
        if (this.proc === proc) this.proc = null;
        if (!found) fail(e);
      });
      proc.on('exit', () => {
        clearTimeout(timer);
        const mine = this.proc === proc;
        if (mine) this.proc = null;
        if (!found) fail(new Error('No se pudo abrir la conexión a distancia.'));
        else if (mine) onExit('Se cerró la conexión a distancia.');
      });
    });
  }

  stop(): void {
    const p = this.proc;
    this.proc = null;
    p?.kill();
  }
}
