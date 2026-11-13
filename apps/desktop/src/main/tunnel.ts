import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Official cloudflared build (the tunnel that gives the phone a public https address), pinned
 * to one release and checked against the SHA-256 of each asset. Nothing downloaded runs
 * unless it matches. To update: bump the version and copy the new hashes from the release
 * (GitHub API `assets[].digest`, or the "SHA256 Checksums" block in the release notes).
 */
export const CLOUDFLARED_VERSION = '2026.11.0';
const RELEASES = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/`;

/** SHA-256 of the release assets (for .tgz: of the archive as downloaded). */
export const CLOUDFLARED_SHA256: Readonly<Record<string, string>> = {
  'cloudflared-windows-amd64.exe':
    'd5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a',
  'cloudflared-linux-amd64': '51f7c68b57ed7269164075d7e789efce5b59355982f06392deeb037d982a51fd',
  'cloudflared-linux-arm64': 'abe54a006acf9faf2d19ee9d953cb0d0804e92f59c5382a162e57b84d086f56f',
  'cloudflared-darwin-amd64.tgz':
    '8a59d51120cebbe902f0a8d6e1b7a7fd4f9a5bb4dcb3e0f05872483e75e7db6b',
  'cloudflared-darwin-arm64.tgz':
    '8c2f90277ef06a6080bb40b964d33f09f1188102f8798f2e344174b6cf41accf',
};

function asset(): string | null {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null;
  if (!arch) return null;
  if (process.platform === 'linux') return `cloudflared-linux-${arch}`;
  if (process.platform === 'win32')
    return arch === 'amd64' ? 'cloudflared-windows-amd64.exe' : null;
  if (process.platform === 'darwin') return `cloudflared-darwin-${arch}.tgz`;
  return null;
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Hash of a file, or null if it can't be read. */
async function fileHash(file: string): Promise<string | null> {
  return readFile(file).then(sha256, () => null);
}

/** cloudflared already installed on the system, or the verified copy the app downloads once. */
async function binary(onProgress: (msg: string) => void): Promise<string> {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const onPath = spawnSync(exe, ['--version'], { stdio: 'ignore', timeout: 5000 });
  if (onPath.status === 0) return exe;

  const name = asset();
  const expected = name ? CLOUDFLARED_SHA256[name] : undefined;
  if (!name || !expected)
    throw new Error('El acceso a distancia no está disponible en este sistema.');

  // One folder per pinned version: copies downloaded by older (unverified) builds are ignored.
  const dir = join(app.getPath('userData'), 'bin', `cloudflared-${CLOUDFLARED_VERSION}`);
  const file = join(dir, exe);
  const archive = name.endsWith('.tgz');
  // Raw binaries are checked against the pinned hash every time. Archives can't be (the hash
  // is of the .tgz): we keep the hash of the binary extracted from a verified archive.
  const marker = join(dir, 'cloudflared.sha256');
  const have = await fileHash(file);
  if (have) {
    const want = archive ? (await readFile(marker, 'utf8').catch(() => '')).trim() : expected;
    if (want && have === want) return file;
    await rm(file, { force: true });
  }

  onProgress('Descargando el componente de conexión (solo la primera vez)…');
  const res = await fetch(RELEASES + name);
  if (!res.ok) throw new Error(`No se pudo descargar cloudflared (HTTP ${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (sha256(data) !== expected)
    throw new Error(
      'El componente de conexión descargado no coincide con la versión verificada; no se ejecutará.',
    );
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.download`;
  await writeFile(tmp, data, { mode: 0o700 });
  if (archive) {
    const r = spawnSync('tar', ['-xzf', tmp, '-C', dir, 'cloudflared'], { stdio: 'ignore' });
    await rm(tmp, { force: true });
    if (r.status !== 0) throw new Error('No se pudo descomprimir cloudflared.');
    const extracted = await fileHash(file);
    if (!extracted) throw new Error('No se pudo descomprimir cloudflared.');
    await writeFile(marker, extracted, { mode: 0o600 });
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
    const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = proc;
    return await new Promise<string>((ok, fail) => {
      let found = false;
      let log = '';
      let url = '';
      const timer = setTimeout(() => {
        this.stop();
        fail(new Error('Cloudflare no respondió a tiempo. Revisa la conexión a internet.'));
      }, 45_000);
      const read = (chunk: Buffer) => {
        if (found) return;
        log = (log + chunk.toString('utf8')).slice(-4000);
        url ||= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log)?.[0] ?? '';
        // The address is printed before Cloudflare can route it: opened that early, the phone
        // gets an error (and may remember the name as missing). Wait for the first connection.
        if (url && /Registered tunnel connection/.test(log)) {
          found = true;
          clearTimeout(timer);
          ok(url);
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
