/**
 * Zinarix 3D Pro: the "permanent bridge" settings. When it is on, the bridge (blenderBridge.ts)
 * opens with the app on a fixed port and token, and a discovery file tells any Blender with the
 * Zinarix AI add-on where it is, so a Blender opened outside Zinarix uses the connected models
 * too. No Electron imports, so the tests drive it with temp folders.
 *
 * Web pages can use it too: loopback origins always, other sites only when the user lists
 * their origin (CORS); they get the URL and token from the user, not from the file.
 *
 *   <userData>/blender-bridge.json     {permanent, port, token, origins}   (the app's settings)
 *   ~/.zinarix/blender-bridge.json     {url, token, pid}          (read by the add-on; only while open)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { newBridgeToken, normalizeOrigin, type BridgeInfo } from './blenderBridge.js';

export interface BridgeSettings {
  permanent: boolean;
  port: number;
  token: string;
  /** Web origins allowed to call it from a browser, e.g. "https://my-app.vercel.app". */
  origins: string[];
}

/** Most web origins kept. */
export const MAX_ORIGINS = 50;

/** Cleans what the user typed: valid http(s) origins only, no duplicates. */
export function cleanOrigins(list: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const v of list) {
    const o = typeof v === 'string' ? normalizeOrigin(v) : null;
    if (o) out.add(o);
    if (out.size >= MAX_ORIGINS) break;
  }
  return [...out];
}

/** Preferred port of the permanent bridge (a random one if it is taken). */
export const BRIDGE_PORT = 47_815;

/** Where the add-on looks for the bridge; ZINARIX_BRIDGE_FILE overrides it (tests, portable). */
export function discoveryPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZINARIX_BRIDGE_FILE?.trim() || join(homedir(), '.zinarix', 'blender-bridge.json');
}

export class BridgeStore {
  private readonly file: string;

  constructor(
    userData: string,
    private readonly discovery = discoveryPath(),
  ) {
    this.file = join(userData, 'blender-bridge.json');
  }

  load(): BridgeSettings {
    let raw: Partial<BridgeSettings> = {};
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<BridgeSettings>;
    } catch {
      /* first run or a broken file: defaults */
    }
    const port =
      Number.isInteger(raw.port) && raw.port! >= 1024 && raw.port! <= 65_535
        ? raw.port!
        : BRIDGE_PORT;
    const token =
      typeof raw.token === 'string' && /^[\w-]{32,}$/.test(raw.token)
        ? raw.token
        : newBridgeToken();
    const origins = cleanOrigins(Array.isArray(raw.origins) ? raw.origins : []);
    const s = { permanent: raw.permanent === true, port, token, origins };
    if (
      s.token !== raw.token ||
      s.port !== raw.port ||
      JSON.stringify(origins) !== JSON.stringify(raw.origins)
    )
      this.save(s);
    return s;
  }

  save(s: BridgeSettings): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(s, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  /** Tells Blender's add-on where the bridge is (owner-only file: it holds the token). */
  publish(info: BridgeInfo): void {
    mkdirSync(dirname(this.discovery), { recursive: true });
    writeFileSync(
      this.discovery,
      JSON.stringify({ url: info.url, token: info.token, pid: process.pid }, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  /** Removes the discovery file, only if it is ours (another Zinarix instance may own it). */
  unpublish(): void {
    try {
      const d = JSON.parse(readFileSync(this.discovery, 'utf8')) as { pid?: unknown };
      if (d.pid !== process.pid) return;
    } catch {
      return;
    }
    rmSync(this.discovery, { force: true });
  }
}
