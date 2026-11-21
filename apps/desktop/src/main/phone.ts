import { createHash, randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import type {
  PhoneAction,
  PhoneAllow,
  PhoneConfigPatch,
  PhoneConfigView,
  PhoneDevice,
  PhoneModels,
  PhoneRepo,
  PhoneSnapshot,
  PhoneStatus,
} from '../shared/api.js';
import { THEME_IDS, UI_ZOOM_STEPS } from '../shared/api.js';
import { PairingGuard, sameSecret } from './pairing.js';
import type { PairChannel, PinCheck } from './pairing.js';
import { phoneLang, phonePage } from './phonePage.js';
import { Tunnel } from './tunnel.js';
import { beaconError, RELAY_PAGE, relayLink, type PhoneBeacon } from './phoneBeacon.js';

/** Preferred port (the phone keeps working after a restart); another one if it is taken. */
const PORT = 47390;

const Action = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('send'), text: z.string().min(1).max(20_000) }),
  z.object({
    kind: z.literal('decide'),
    toolCallId: z.string().min(1).max(200),
    decision: z.enum(['approve', 'deny']),
  }),
  z.object({ kind: z.literal('stop') }),
  z.object({ kind: z.literal('select'), chatId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('newChat') }),
  z.object({ kind: z.literal('agent'), on: z.boolean() }),
  z.object({ kind: z.literal('mode'), mode: z.enum(['ask', 'plan', 'agent', 'auto', 'full']) }),
  z.object({ kind: z.literal('model'), ref: z.string().min(3).max(300).nullable() }),
  z.object({ kind: z.literal('closeChat'), chatId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('clearQueue') }),
  z.object({ kind: z.literal('window'), id: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('openFile'), path: z.string().min(1).max(4096) }),
]);

/** A file or folder of the project, for the phone's file browser. */
export interface PhoneFileEntry {
  name: string;
  /** Relative to the project root, '/' separated. */
  path: string;
  dir: boolean;
  size?: number;
  mtime?: number;
}

/** The project files of the window the phone controls (see main.ts). Paths are relative. */
export interface PhoneFiles {
  list(path: string): Promise<{ root: string; name: string; entries: PhoneFileEntry[] }>;
  read(path: string): Promise<{ content: string; binary: boolean; tooLarge: boolean; size: number }>;
  /** The bytes of a file (images, downloads), up to a few MB. */
  raw(path: string): Promise<Uint8Array>;
  write(path: string, content: string): Promise<void>;
  create(path: string, dir: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** To the recycle bin of the computer (it can be restored from there). */
  trash(path: string): Promise<void>;
  /** Project files whose path contains `query`. */
  find(query: string): Promise<string[]>;
}

/** A terminal the phone can see: one of the computer's or one the phone opened. */
export interface PhoneTerm {
  id: number;
  name: string;
  /** Opened from the phone (it may close it and change its size). */
  phone: boolean;
  alive: boolean;
  cols: number;
  rows: number;
}

/** The terminals of the window the phone controls (see main.ts). */
export interface PhoneTerminals {
  list(): PhoneTerm[];
  create(cols: number, rows: number): PhoneTerm;
  /**
   * Output after `since` (an offset in the terminal's output). Waits up to ~20 s for new
   * output when there is none. `from` > `since` when older output was dropped.
   */
  read(
    id: number,
    since: number,
    abort: AbortSignal,
  ): Promise<{ from: number; data: string; next: number; alive: boolean; cols: number; rows: number }>;
  write(id: number, data: string): void;
  resize(id: number, cols: number, rows: number): void;
  kill(id: number): void;
}

/** Git of the project the phone controls (see main.ts). */
export interface PhoneGit {
  status(): Promise<unknown>;
  diff(path: string): Promise<string>;
  /** Stages everything (or `paths`) and commits. */
  commit(message: string, paths?: string[]): Promise<void>;
  sync(op: 'pull' | 'push' | 'fetch'): Promise<string>;
  log(): Promise<unknown>;
}

/** Zinarix's settings for the phone's "Configuración" screen (see main.ts). */
export interface PhoneConfig {
  get(): Promise<PhoneConfigView>;
  /** Applies a change already checked by PhoneConfigPatchSchema; throws a message for the phone. */
  set(patch: PhoneConfigPatch): Promise<void>;
}

export interface PhoneTools {
  files?: PhoneFiles;
  terminals?: PhoneTerminals;
  git?: PhoneGit;
  config?: PhoneConfig;
}

const Ref = z.string().min(3).max(300);
const Usd = z.number().min(0).max(1_000_000);
/** What the phone may change in Zinarix's settings (keys, fonts and commands stay on the PC). */
export const PhoneConfigPatchSchema = z
  .object({
    defaultModel: Ref,
    role: z.object({ role: z.enum(['chat', 'agent', 'inline']), ref: Ref.nullable() }),
    localOnly: z.boolean(),
    theme: z.enum(THEME_IDS),
    prefs: z
      .object({
        uiZoom: z.number().int().refine((n) => UI_ZOOM_STEPS.includes(n)),
        fontSize: z.number().int().min(8).max(40),
        tabSize: z.number().int().min(1).max(16),
        wordWrap: z.boolean(),
        minimap: z.boolean(),
        lineNumbers: z.boolean(),
        formatOnSave: z.boolean(),
        autoSave: z.boolean(),
        inlineCompletions: z.boolean(),
        nextEdit: z.boolean(),
        autoImport: z.boolean(),
        projectRules: z.boolean(),
        lsp: z.boolean(),
        helperBubble: z.boolean(),
        windowEffects: z.boolean(),
        taskParallel: z.number().int().min(1).max(8),
      })
      .partial()
      .strict(),
    budget: z.object({
      provider: z.string().min(1).max(100),
      daily: Usd.optional(),
      monthly: Usd.optional(),
    }),
  })
  .partial()
  .strict();

const Rel = z.string().max(4096);
const Dim = z.number().int().min(2).max(500);

/** The repositories of this computer, for the phone (see main.ts). */
export interface PhoneRepos {
  list(): Promise<PhoneRepo[]>;
  /** git pull (fast-forward only); returns git's output. Only paths that list() returns. */
  pull(path: string): Promise<string>;
  /**
   * Opens the repository in the window the phone controls (the chat then works on it), or in
   * a new window when `newWindow` (several folders open at once, like on the computer). A
   * folder already open in some window just switches the phone to that window.
   */
  open(path: string, newWindow?: boolean): Promise<void>;
}

/** The models the phone can pick (see main.ts). */
export interface PhoneModelSource {
  list(): Promise<PhoneModels>;
  /** Makes `ref` the app's default model (every chat without a model of its own). */
  setDefault(ref: string): void;
}

const RepoPath = z.object({ path: z.string().min(1).max(4096), newWindow: z.boolean().optional() });

/** Every IPv4 of this computer on its networks (not loopback). */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
}

/** IPv4 of this computer on the local network (Wi-Fi / Ethernet), private ranges first. */
export function lanAddress(): string | null {
  const all = lanAddresses();
  const priv = (ip: string) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return all.find(priv) ?? all[0] ?? null;
}

const same = sameSecret;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** "Android · Chrome", "iPhone · Safari"… from the browser's user agent. */
export function deviceName(ua: string): string {
  const model = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/|\))/.exec(ua)?.[1]?.trim();
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? model && model.length > 2 && !/^wv$/i.test(model)
          ? model
          : 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Dispositivo';
  const browser = /EdgA?\/|EdgiOS/.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Firefox|FxiOS/.test(ua)
        ? 'Firefox'
        : /OPR\/|OPiOS/.test(ua)
          ? 'Opera'
          : /CriOS|Chrome/.test(ua)
            ? 'Chrome'
            : /Safari/.test(ua)
              ? 'Safari'
              : '';
  return browser ? `${os} · ${browser}` : os;
}

/** A paired phone, as saved: only the SHA-256 of its token (the phone keeps the token). */
interface SavedDevice extends PhoneDevice {
  hash: string;
}

/**
 * What survives a restart (userData/phone-remote.json): whether the remote and the access
 * from anywhere were on, the paired phones and the key of the link. Same link, same pairing:
 * the phone reconnects by itself when Zinarix opens again.
 */
interface Saved {
  enabled?: boolean;
  remote?: boolean;
  /** The port it listened on last time (the link keeps it, also when 47390 was taken). */
  port?: number;
  /** The secret after # in the link from anywhere (the same one every time). */
  key?: string;
  devices?: SavedDevice[];
  /** The user's own Cloudflare tunnel: always the same address. Token sealed by `store.seal`. */
  fixed?: { host: string; token: string };
  /** Gist that holds the current tunnel address: the permanent link (see phoneBeacon.ts). */
  relay?: string;
  /** What the phones may use besides the chats (missing = on). */
  allow?: Partial<PhoneAllow>;
}

/** Where the state is kept, and how the tunnel token is sealed (Electron safeStorage). */
export interface PhoneStore {
  file: () => string;
  seal?: (plain: string) => string;
  open?: (sealed: string) => string;
}

/** A new device that typed the right PIN, waiting for the user's OK on the computer. */
export interface PairRequest {
  channel: PairChannel;
  /** Who is asking, in words for the dialog (address and browser, or the bot user). */
  who: string;
}

/**
 * Remote control from a phone on the same network: a small page served over HTTP. The phone
 * pairs once with a PIN shown on the computer and gets a token; with it, it sees the chats
 * and sends messages, approvals and stops, which go to the window that started it.
 *
 * Optionally also from anywhere: a Cloudflare tunnel gives a public https address. Pairing
 * through it needs, besides the PIN, a long random key that only travels in the link the
 * user copies (after the #, so it is not even sent to Cloudflare in the URL).
 */
export class PhoneRemote {
  private server: Server | null = null;
  private host = '';
  private pin = '';
  /** Wrong PINs per channel, and the lock after too many (see pairing.ts). */
  private guard: PairingGuard;
  /** A pairing waiting for the user's OK (one at a time). */
  private approving = false;
  private saved: Saved | null = null;
  /** Retries of the tunnel after it fell (it opens again by itself). */
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private seenSaved = 0;
  private streams = new Set<ServerResponse>();
  private snapshot: PhoneSnapshot | null = null;
  /** Grows with each snapshot; long polls wait until it changes. */
  private version = 0;
  private waiters = new Set<() => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private port = 0;
  private tunnel = new Tunnel();
  private remote: {
    url?: string;
    key: string;
    progress?: string;
    error?: string;
    /** The gist already points to `url`: the permanent link works. */
    relayed?: boolean;
    /** Why there is no permanent link (no gh, not signed in). */
    relayError?: string;
  } | null = null;

  constructor(
    private onAction: (a: PhoneAction) => void,
    private onStatus: (s: PhoneStatus) => void,
    private repos: PhoneRepos,
    /** Asks the user on the computer whether to let a new device in (true = allowed). */
    private approve: (req: PairRequest) => Promise<boolean>,
    /** File that keeps the wrong-PIN counters across restarts (see pairing.ts). */
    guardFile?: () => string,
    private models?: PhoneModelSource,
    private store?: PhoneStore,
    private tools: PhoneTools = {},
    /** Writes the current address where the permanent link reads it (none: no such link). */
    private beacon?: PhoneBeacon,
  ) {
    this.guard = new PairingGuard(Date.now, guardFile);
  }

  private state(): Saved {
    if (this.saved) return this.saved;
    let saved: Saved = {};
    try {
      const file = this.store?.file();
      if (file && existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8')) as Saved;
    } catch {
      saved = {};
    }
    if (!saved || typeof saved !== 'object') saved = {};
    if (!Array.isArray(saved.devices)) saved.devices = [];
    saved.devices = saved.devices.filter(
      (d) => d && typeof d.hash === 'string' && /^[0-9a-f]{64}$/.test(d.hash),
    );
    if (typeof saved.key !== 'string' || saved.key.length < 32) {
      saved.key = randomBytes(24).toString('hex');
      this.saved = saved;
      this.save();
    }
    this.saved = saved;
    return saved;
  }

  private save(): void {
    const file = this.store?.file();
    if (!file || !this.saved) return;
    try {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.saved, null, 1), { mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      // Not fatal: it only would not survive a restart.
    }
  }

  /** What was on when Zinarix closed: the remote, and the access from anywhere. */
  wanted(): { enabled: boolean; remote: boolean } {
    const s = this.state();
    return { enabled: !!s.enabled, remote: !!s.remote };
  }

  /** The paired phones (last used first). */
  devices(): PhoneDevice[] {
    return this.state()
      .devices!.map(({ id, name, at, seen, remote }) => ({ id, name, at, seen, remote }))
      .sort((a, b) => (b.seen ?? b.at) - (a.seen ?? a.at));
  }

  /** Unpairs one phone (or all with null, which also changes the link's key). */
  forget(id: string | null): PhoneStatus {
    const s = this.state();
    s.devices = id ? s.devices!.filter((d) => d.id !== id) : [];
    if (!id) s.key = randomBytes(24).toString('hex');
    if (!id && this.remote) this.remote.key = s.key!;
    this.save();
    // Cuts the live streams: an unpaired phone stops seeing the chats right away.
    for (const st of this.streams) st.end();
    this.streams.clear();
    this.wake();
    return this.status();
  }

  /**
   * The user's own Cloudflare tunnel (dashboard → Zero Trust → Tunnels): a fixed address like
   * https://zinarix.mydomain.com that never changes. null goes back to the free random one.
   */
  async setFixed(fixed: { host: string; token: string } | null): Promise<PhoneStatus> {
    const s = this.state();
    if (fixed) {
      const host = fixed.host
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host))
        throw new Error('La dirección no es válida (ejemplo: zinarix.midominio.com).');
      const token = fixed.token
        .trim()
        .replace(/^.*--token\s+/, '')
        .trim();
      if (!/^[A-Za-z0-9+/=_-]{40,}$/.test(token))
        throw new Error('El token del túnel no es válido: copia el que da Cloudflare al crearlo.');
      if (!this.store?.seal)
        throw new Error('No se puede guardar el token de forma segura en esta computadora.');
      s.fixed = { host, token: this.store.seal(token) };
    } else delete s.fixed;
    this.save();
    // Running from anywhere: it opens again with the new address.
    if (this.remote) {
      this.closeTunnel();
      if (s.remote) return this.setRemote(true, false);
    }
    return this.status();
  }

  /** Files, terminal and git for the phones (each one can be turned off on the computer). */
  allowed(): PhoneAllow {
    const a = this.state().allow ?? {};
    return {
      files: a.files !== false && !!this.tools.files,
      terminal: a.terminal !== false && !!this.tools.terminals,
      git: a.git !== false && !!this.tools.git,
      config: a.config !== false && !!this.tools.config,
    };
  }

  setAllow(allow: PhoneAllow): PhoneStatus {
    const s = this.state();
    s.allow = {
      files: allow.files,
      terminal: allow.terminal,
      git: allow.git,
      config: allow.config ?? s.allow?.config,
    };
    this.save();
    if (!allow.terminal) this.onTerminalOff?.();
    this.wake();
    return this.status();
  }

  /** Called when the terminal is turned off for the phones (main closes the phone's shells). */
  onTerminalOff?: () => void;

  private fixedTunnel(): { host: string; token: string } | undefined {
    const f = this.state().fixed;
    if (!f || !this.store?.open) return undefined;
    try {
      return { host: f.host, token: this.store.open(f.token) };
    } catch {
      return undefined;
    }
  }

  private closeTunnel(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.tunnel.stop();
    this.remote = null;
  }

  status(): PhoneStatus {
    const s = this.state();
    const common = {
      devices: this.devices(),
      fixedHost: s.fixed?.host,
      autostart: !!s.enabled,
      allow: this.allowed(),
    };
    if (!this.server) return { running: false, phones: 0, ...common };
    const r = this.remote;
    const ip = lanAddress();
    return {
      running: true,
      url: `http://${ip ? `${ip}:${this.port}` : this.host}`,
      pin: this.pin,
      phones: s.devices!.length,
      remote: r
        ? {
            url: r.url
              ? r.relayed && s.relay && !s.fixed
                ? relayLink(s.relay, r.key)
                : `${r.url}/#k=${r.key}`
              : undefined,
            progress: r.progress,
            error: r.error,
            fixed: !!s.fixed,
            permanent: !!s.fixed || (!!r.url && !!r.relayed && !!s.relay),
            relayError: s.fixed ? undefined : r.relayError,
          }
        : undefined,
      ...common,
    };
  }

  async start(): Promise<PhoneStatus> {
    const saved = this.state();
    if (!saved.enabled) {
      saved.enabled = true;
      this.save();
    }
    if (this.server) return this.status();
    const ip = lanAddress();
    if (!ip)
      return {
        running: false,
        phones: 0,
        error: 'Esta computadora no está conectada a una red (Wi-Fi o cable).',
      };
    const server = createServer((req, res) => void this.route(req, res));
    const port = await new Promise<number>((ok, fail) => {
      const listen = (p: number) => {
        const onError = (e: NodeJS.ErrnoException) =>
          e.code === 'EADDRINUSE' && p !== 0 ? listen(p === PORT ? 0 : PORT) : fail(e);
        server.once('error', onError);
        server.listen(p, '0.0.0.0', () => {
          // Listening: this attempt's handler must not stay attached (nor fire on a later error).
          server.off('error', onError);
          const a = server.address();
          ok(typeof a === 'object' && a ? a.port : p);
        });
      };
      const last = saved.port;
      listen(typeof last === 'number' && last > 1024 && last < 65536 ? last : PORT);
    });
    if (saved.port !== port) {
      saved.port = port;
      this.save();
    }
    this.server = server;
    this.port = port;
    this.host = `${ip}:${port}`;
    this.newPin();
    this.heartbeat = setInterval(() => {
      for (const s of this.streams) s.write(': ping\n\n');
    }, 20_000);
    this.heartbeat.unref();
    return this.status();
  }

  /** Turns access from anywhere (the tunnel) on or off; progress arrives through onStatus. */
  async setRemote(on: boolean, user = true): Promise<PhoneStatus> {
    const saved = this.state();
    if (user && !!saved.remote !== on) {
      saved.remote = on;
      this.save();
    }
    if (!on || !this.server) {
      if (user && !on && this.remote) this.unpublish();
      this.closeTunnel();
      return this.status();
    }
    if (this.remote?.url || this.remote?.progress) return this.status();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    // The key is saved: the link stays the same after a restart (and the phone stays paired).
    const remote: NonNullable<PhoneRemote['remote']> = { key: saved.key! };
    this.remote = remote;
    const live = () => this.remote === remote;
    const fixed = this.fixedTunnel();
    try {
      const url = await this.tunnel.start(
        this.port,
        (progress) => {
          if (!live()) return;
          remote.progress = progress;
          this.onStatus(this.status());
        },
        (error) => {
          if (!live()) return;
          remote.url = undefined;
          remote.error = `${error} Reconectando…`;
          this.onStatus(this.status());
          this.retryRemote(remote);
        },
        fixed,
      );
      if (!live()) {
        this.tunnel.stop();
        return this.status();
      }
      remote.url = url;
      this.retries = 0;
      if (!fixed) this.publish(remote, url);
    } catch (e) {
      if (live()) {
        remote.error = e instanceof Error ? e.message : String(e);
        // No internet yet (Zinarix opening with the computer): keep trying in the background.
        if (!user) this.retryRemote(remote);
      }
    }
    remote.progress = undefined;
    return this.status();
  }

  /**
   * Writes the new address in the gist of the permanent link. Until it is written the status
   * shows the direct address; a phone that has the permanent link waits on the relay page.
   */
  private publish(remote: NonNullable<PhoneRemote['remote']>, url: string): void {
    if (!this.beacon) return;
    const s = this.state();
    this.beacon(url, s.relay).then(
      (id) => {
        if (id && id !== s.relay) {
          s.relay = id;
          this.save();
        }
        if (this.remote !== remote || remote.url !== url) return;
        remote.relayed = true;
        remote.relayError = undefined;
        this.onStatus(this.status());
      },
      (e) => {
        if (this.remote !== remote) return;
        remote.relayError = beaconError(e);
        this.onStatus(this.status());
      },
    );
  }

  /** The remote was turned off by the user: the permanent link says so (best effort). */
  private unpublish(): void {
    const id = this.state().relay;
    if (id && this.beacon) this.beacon(null, id).catch(() => {});
  }

  /** The tunnel fell (internet cut, sleep): open it again, waiting longer each time. */
  private retryRemote(remote: NonNullable<PhoneRemote['remote']>): void {
    if (this.retryTimer || !this.server || !this.state().remote) return;
    const wait = Math.min(120_000, 5_000 * 2 ** Math.min(this.retries++, 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.remote !== remote || !this.server) return;
      this.remote = null;
      void this.setRemote(true, false).then((st) => this.onStatus(st));
    }, wait);
    this.retryTimer.unref?.();
  }

  /** `user`: the user turned it off (it stays off next time); else Zinarix is closing. */
  stop(user = false): PhoneStatus {
    if (user) {
      const saved = this.state();
      saved.enabled = false;
      saved.remote = false;
      this.save();
      if (this.remote) this.unpublish();
    }
    this.closeTunnel();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const s of this.streams) s.end();
    this.streams.clear();
    this.snapshot = null;
    this.wake();
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = null;
    return this.status();
  }

  /** The window's chats changed: every connected phone gets the new view. */
  push(snapshot: PhoneSnapshot): void {
    if (!this.server) return;
    this.snapshot = snapshot;
    this.version++;
    this.wake();
    const data = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const s of this.streams) s.write(data);
  }

  private wake(): void {
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  /**
   * The PIN shown on the computer (phones and chat bots pair with it), compared in constant
   * time. Too many wrong tries lock that channel for a while (longer each time) and change
   * the PIN, so guessing is hopeless.
   */
  checkPin(pin: string, channel: PairChannel): PinCheck {
    if (!this.server) return { ok: false, error: 'El control desde el celular está apagado.' };
    const r = this.guard.check(channel, pin, this.pin);
    if (!r.ok && r.rotated) {
      this.newPin();
      this.onStatus(this.status());
    }
    return r;
  }

  /**
   * Full pairing of a new device: the right PIN, then the user's OK on the computer. A
   * rejected (or unanswered) request changes the PIN: whoever typed it is not welcome.
   */
  async pair(
    channel: PairChannel,
    pin: string,
    who: string,
    /** The PIN was right and the dialog is about to show. */
    onWaiting?: () => void,
  ): Promise<PinCheck> {
    if (this.approving)
      return { ok: false, error: 'Ya hay otra conexión esperando aprobación en la computadora.' };
    const r = this.checkPin(pin, channel);
    if (!r.ok) return r;
    this.approving = true;
    let allowed = false;
    try {
      onWaiting?.();
      allowed = await this.approve({ channel, who });
    } catch {
      allowed = false;
    } finally {
      this.approving = false;
    }
    if (!this.server) return { ok: false, error: 'El control desde el celular se apagó.' };
    if (!allowed) {
      this.newPin();
      this.onStatus(this.status());
      return { ok: false, error: 'La conexión fue rechazada en la computadora.' };
    }
    return { ok: true };
  }

  private newPin(): void {
    this.pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private authorized(req: IncomingMessage, url: URL): SavedDevice | null {
    const header = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    // EventSource cannot send headers: the event stream carries the token in the URL.
    const token = header ?? url.searchParams.get('token') ?? '';
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const hash = sha(token);
    const device = this.state().devices!.find((d) => same(d.hash, hash)) ?? null;
    if (device) {
      device.seen = Date.now();
      // Last seen on disk now and then (not on every request).
      if (device.seen - this.seenSaved > 10 * 60_000) {
        this.seenSaved = device.seen;
        this.save();
      }
    }
    return device;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Only these addresses: a web page elsewhere cannot reach the remote through DNS tricks.
      const host = req.headers.host ?? '';
      const tunnelHost = this.remote?.url ? new URL(this.remote.url).host : null;
      // Any address of this computer on its networks (the Wi-Fi may give it a new one).
      const lan = () => lanAddresses().some((ip) => host === `${ip}:${this.port}`);
      if (
        host !== this.host &&
        host !== tunnelHost &&
        host !== `127.0.0.1:${this.port}` &&
        !lan()
      )
        return end(res, 421, { error: 'host' });
      // The tunnel reaches the server from this same computer: everything local is "remote".
      const viaTunnel = /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');
      const url = new URL(req.url ?? '/', `http://${this.host}`);
      if (req.method === 'GET' && url.pathname === '/') {
        const nonce = randomBytes(16).toString('base64');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data: blob:; media-src blob:; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
        return void res.end(phonePage(nonce, phoneLang(req.headers['accept-language'])));
      }
      // Installable as an app on the phone (home screen icon, full screen, same link).
      if (req.method === 'GET' && url.pathname === '/manifest.webmanifest') {
        res.writeHead(200, {
          'Content-Type': 'application/manifest+json',
          'Cache-Control': 'no-cache',
        });
        return void res.end(JSON.stringify(MANIFEST));
      }
      // The permanent link's page asks whether this address is alive before sending the phone
      // here (a dead tunnel answers with Cloudflare's error page, without this header).
      if (req.method === 'GET' && url.pathname === '/api/alive') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': new URL(RELAY_PAGE).origin,
          'Cache-Control': 'no-store',
        });
        return void res.end();
      }
      if (req.method === 'GET' && url.pathname === '/icon.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=86400' });
        return void res.end(ICON);
      }
      if (req.method === 'POST' && url.pathname === '/api/pair') {
        const { pin, key } = z
          .object({ pin: z.string().max(20), key: z.string().max(200).optional() })
          .parse(await body(req));
        // Through the tunnel the address is public: the key of the link is required too.
        if (viaTunnel && !(this.remote?.url && same(key ?? '', this.remote.key)))
          return end(res, 403, { error: 'Enlace incompleto: copia otra vez el enlace de Zinarix' });
        const ua = String(req.headers['user-agent'] ?? '').slice(0, 160);
        const where = viaTunnel
          ? 'Un celular a través de internet (enlace de Cloudflare)'
          : `Un celular en tu red, dirección ${req.socket.remoteAddress ?? '?'}`;
        const paired = await this.pair('phone', pin, ua ? `${where}\n${ua}` : where);
        if (!paired.ok) return end(res, 403, { error: paired.error });
        // The phone gave up while the dialog was open: nobody would get the token.
        if (res.destroyed || !res.socket || res.socket.destroyed) return;
        const token = randomBytes(32).toString('hex');
        const now = Date.now();
        this.state().devices!.push({
          id: randomBytes(6).toString('hex'),
          hash: sha(token),
          name: deviceName(ua),
          at: now,
          seen: now,
          remote: viaTunnel,
        });
        this.save();
        this.onStatus(this.status());
        return end(res, 200, { token });
      }
      if (!url.pathname.startsWith('/api/')) return end(res, 404, { error: 'not found' });
      const device = this.authorized(req, url);
      if (!device) return end(res, 401, { error: 'unpaired' });
      // "Disconnect this phone", from the phone itself.
      if (req.method === 'POST' && url.pathname === '/api/unpair') {
        const s = this.state();
        s.devices = s.devices!.filter((d) => d !== device);
        this.save();
        this.onStatus(this.status());
        return end(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/me')
        return end(res, 200, { id: device.id, name: device.name, at: device.at });
      if (req.method === 'POST' && url.pathname === '/api/rename') {
        const { name } = z
          .object({ name: z.string().trim().min(1).max(60) })
          .parse(await body(req));
        device.name = name;
        this.save();
        this.onStatus(this.status());
        return end(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        this.streams.add(res);
        req.on('close', () => this.streams.delete(res));
        if (this.snapshot) res.write(`data: ${JSON.stringify(this.snapshot)}\n\n`);
        return;
      }
      // Long polling, for the tunnel: Cloudflare holds an event stream back, not a response.
      if (req.method === 'GET' && url.pathname === '/api/poll') {
        const seen = Number(url.searchParams.get('v'));
        const changed = () => this.snapshot !== null && this.version !== seen;
        if (!changed()) {
          await new Promise<void>((ok) => {
            const done = () => {
              clearTimeout(timer);
              this.waiters.delete(done);
              ok();
            };
            const timer = setTimeout(done, 25_000);
            this.waiters.add(done);
            req.on('close', done);
          });
        }
        if (!changed()) return void res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
        return end(res, 200, { v: this.version, snapshot: this.snapshot });
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        this.onAction(Action.parse(await body(req)));
        return end(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/models') {
        if (!this.models) return end(res, 404, { error: 'not found' });
        return end(res, 200, await this.models.list());
      }
      if (req.method === 'POST' && url.pathname === '/api/models/default') {
        if (!this.models) return end(res, 404, { error: 'not found' });
        const { ref } = z.object({ ref: z.string().min(3).max(300) }).parse(await body(req));
        const known = (await this.models.list()).models.some((m) => m.ref === ref);
        if (!known) return end(res, 409, { error: 'Ese modelo no está conectado.' });
        this.models.setDefault(ref);
        return end(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/repos')
        return end(res, 200, { repos: await this.repos.list() });
      if (
        req.method === 'POST' &&
        (url.pathname === '/api/repos/pull' || url.pathname === '/api/repos/open')
      ) {
        const { path, newWindow } = RepoPath.parse(await body(req));
        try {
          if (url.pathname.endsWith('/pull'))
            return end(res, 200, { output: await this.repos.pull(path) });
          await this.repos.open(path, newWindow);
          return end(res, 200, { ok: true });
        } catch (e) {
          return end(res, 409, { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/caps') return end(res, 200, this.allowed());
      if (url.pathname.startsWith('/api/files/')) return await this.filesRoute(req, res, url);
      if (url.pathname.startsWith('/api/term')) return await this.termRoute(req, res, url);
      if (url.pathname.startsWith('/api/git/')) return await this.gitRoute(req, res, url);
      if (url.pathname === '/api/config') return await this.configRoute(req, res);
      end(res, 404, { error: 'not found' });
    } catch {
      end(res, 400, { error: 'bad request' });
    }
  }

  /** Turned off on the computer (Configuración → Celular): the phone explains where. */
  private off(res: ServerResponse): void {
    end(res, 403, {
      error: 'Desactivado en la computadora (Configuración → Celular).',
      off: true,
    });
  }

  private async filesRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const files = this.tools.files;
    if (!files || !this.allowed().files) return this.off(res);
    const op = url.pathname.slice('/api/files/'.length);
    const path = Rel.parse(url.searchParams.get('path') ?? '');
    try {
      if (req.method === 'GET' && op === 'list') return end(res, 200, await files.list(path));
      if (req.method === 'GET' && op === 'read') return end(res, 200, await files.read(path));
      if (req.method === 'GET' && op === 'find') {
        const q = z.string().min(1).max(200).parse(url.searchParams.get('q'));
        return end(res, 200, { paths: await files.find(q) });
      }
      if (req.method === 'GET' && op === 'raw') {
        const bytes = await files.raw(path);
        res.writeHead(200, {
          // Never rendered as a page of this origin: the phone shows it as a blob.
          'Content-Type': 'application/octet-stream',
          'Content-Length': bytes.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'attachment',
        });
        return void res.end(bytes);
      }
      if (req.method !== 'POST') return end(res, 404, { error: 'not found' });
      if (op === 'write') {
        const b = z
          .object({ path: Rel.min(1), content: z.string().max(4_000_000) })
          .parse(await body(req, 6_000_000));
        await files.write(b.path, b.content);
        return end(res, 200, { ok: true });
      }
      if (op === 'create') {
        const b = z.object({ path: Rel.min(1), dir: z.boolean() }).parse(await body(req));
        await files.create(b.path, b.dir);
        return end(res, 200, { ok: true });
      }
      if (op === 'rename') {
        const b = z.object({ from: Rel.min(1), to: Rel.min(1) }).parse(await body(req));
        await files.rename(b.from, b.to);
        return end(res, 200, { ok: true });
      }
      if (op === 'trash') {
        const b = z.object({ path: Rel.min(1) }).parse(await body(req));
        await files.trash(b.path);
        return end(res, 200, { ok: true });
      }
      end(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof z.ZodError) throw e;
      end(res, 409, { error: friendly(e) });
    }
  }

  private async termRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const t = this.tools.terminals;
    if (!t || !this.allowed().terminal) return this.off(res);
    const op = url.pathname.slice('/api/term'.length);
    try {
      if (req.method === 'GET' && op === 's') return end(res, 200, { terms: t.list() });
      if (req.method === 'GET' && op === '/read') {
        const id = z.coerce.number().int().parse(url.searchParams.get('id'));
        const since = z.coerce.number().int().min(0).parse(url.searchParams.get('since') ?? 0);
        if (!t.list().some((x) => x.id === id))
          return end(res, 404, { error: 'Esa terminal ya no existe.' });
        const abort = new AbortController();
        req.on('close', () => abort.abort());
        return end(res, 200, await t.read(id, since, abort.signal));
      }
      if (req.method !== 'POST') return end(res, 404, { error: 'not found' });
      if (op === '/new') {
        const b = z.object({ cols: Dim, rows: Dim }).parse(await body(req));
        return end(res, 200, t.create(b.cols, b.rows));
      }
      const b = z
        .object({
          id: z.number().int(),
          data: z.string().max(100_000).optional(),
          cols: Dim.optional(),
          rows: Dim.optional(),
        })
        .parse(await body(req, 200_000));
      if (!t.list().some((x) => x.id === b.id))
        return end(res, 404, { error: 'Esa terminal ya no existe.' });
      if (op === '/write' && b.data !== undefined) t.write(b.id, b.data);
      else if (op === '/resize' && b.cols && b.rows) t.resize(b.id, b.cols, b.rows);
      else if (op === '/kill') t.kill(b.id);
      else return end(res, 404, { error: 'not found' });
      return end(res, 200, { ok: true });
    } catch (e) {
      if (e instanceof z.ZodError) throw e;
      end(res, 409, { error: friendly(e) });
    }
  }

  private async configRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const c = this.tools.config;
    if (!c || !this.allowed().config) return this.off(res);
    try {
      if (req.method === 'GET') return end(res, 200, await c.get());
      if (req.method === 'POST') {
        await c.set(PhoneConfigPatchSchema.parse(await body(req)));
        return end(res, 200, await c.get());
      }
      end(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof z.ZodError) throw e;
      end(res, 409, { error: friendly(e) });
    }
  }

  private async gitRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const g = this.tools.git;
    if (!g || !this.allowed().git) return this.off(res);
    const op = url.pathname.slice('/api/git/'.length);
    try {
      if (req.method === 'GET' && op === 'status') return end(res, 200, await g.status());
      if (req.method === 'GET' && op === 'log') return end(res, 200, { commits: await g.log() });
      if (req.method === 'GET' && op === 'diff')
        return end(res, 200, { diff: await g.diff(Rel.min(1).parse(url.searchParams.get('path'))) });
      if (req.method === 'POST' && op === 'commit') {
        const b = z
          .object({
            message: z.string().trim().min(1).max(20_000),
            paths: z.array(Rel.min(1)).max(5000).optional(),
          })
          .parse(await body(req, 1_000_000));
        await g.commit(b.message, b.paths);
        return end(res, 200, { ok: true });
      }
      if (req.method === 'POST' && op === 'sync') {
        const b = z.object({ op: z.enum(['pull', 'push', 'fetch']) }).parse(await body(req));
        return end(res, 200, { output: await g.sync(b.op) });
      }
      end(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof z.ZodError) throw e;
      end(res, 409, { error: friendly(e) });
    }
  }
}

/** An error for the phone, in words (no stack). */
function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/ENOENT/.test(m)) return 'No existe.';
  if (/EEXIST|already exists/.test(m)) return 'Ya existe uno con ese nombre.';
  if (/EACCES|EPERM/.test(m)) return 'Sin permiso para hacerlo en la computadora.';
  if (/escapes the workspace|absolute paths/.test(m)) return 'Solo se puede dentro del proyecto.';
  return m.slice(0, 2000);
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cff"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><path d="M150 150h212v40L208 322h154v40H150v-40l154-132H150z" fill="#fff"/></svg>`;

const MANIFEST = {
  name: 'Zinarix Studio',
  short_name: 'Zinarix',
  description: 'Controla Zinarix Studio desde el celular',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#1a1b1e',
  theme_color: '#131417',
  icons: [
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
  ],
};

function end(res: ServerResponse, code: number, json: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(json));
}

/** A JSON body (only JSON: a page on another site cannot post it without asking first). */
async function body(req: IncomingMessage, max = 64_000): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('json only');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > max) throw new Error('too big');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
