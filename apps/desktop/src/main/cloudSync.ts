import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
} from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { OmniCore, StoredMessage, Conversation } from '@omni/core';
import type { CloudSyncStatus, MemoryView } from '../shared/api.js';
import type { Knowledge } from './knowledge.js';
import type { Supabase } from './supabase.js';
import { TokenStore } from './token-store.js';

/**
 * Cloud sync with the user's own Supabase project ("cada quien conecta la suya").
 *
 * Everything travels end-to-end encrypted: a sync passphrase only the user knows goes
 * through scrypt into an AES-256-GCM key; Supabase only ever stores opaque blobs. The key
 * stays on this PC (OS keychain); the passphrase itself is never saved.
 *
 * One table, public.zinarix_sync, one row per item: (kind, id) → encrypted JSON. A server
 * sequence (rev) bumps on every write, so each device pulls only what changed since its last
 * cursor. Locally, sync_state keeps a cheap fingerprint of what was last exchanged: an item
 * whose fingerprint differs changed here; one that is gone was deleted here. Conflicts (both
 * sides changed) go to the newest timestamp. RLS is on with no policies: only the project's
 * secret key (kept in this main process) can read or write the table.
 */

type Kind = 'conv' | 'mem' | 'usage';
const KINDS: Kind[] = ['conv', 'mem', 'usage'];

interface Config {
  account: string | null;
  ref: string;
  projectName: string;
  deviceId: string;
  deviceName: string;
  /** Highest server rev already pulled. */
  cursor: number;
  lastSync: number | null;
  lastError: string | null;
  /** Items brought in / sent in the last sync. */
  lastIn: number;
  lastOut: number;
}

interface RemoteRow {
  kind: string;
  id: string;
  updated_at: number;
  deleted: boolean;
  device: string;
  blob: string | null;
  rev: number;
}

interface LocalItem {
  fp: string;
  mtime: number;
  /** The plaintext payload (built only when it is going to be uploaded). */
  payload: () => unknown;
}

interface ConvPayload {
  conversation: Omit<Conversation, 'messageCount'>;
  messages: Omit<StoredMessage, 'role'>[];
}

type UsageRowTuple = [
  number,
  string,
  string,
  string,
  string | null,
  number,
  number,
  number,
  number | null,
  number | null,
  number,
];
interface UsagePayload {
  device: string;
  month: string;
  rows: UsageRowTuple[];
}

const CHECK = 'zinarix-sync-ok';
const META = { kind: 'meta', id: 'key' } as const;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
/** Upload batch: conversations can be large, PostgREST takes a few MB per request. */
const PUSH_BATCH = 20;
const PULL_PAGE = 200;
/** Pull a few revs back: rows from transactions that committed out of order still arrive. */
const REV_OVERLAP = 50;
const INTERVAL_MS = 3 * 60_000;

const SCHEMA_SQL = `
create sequence if not exists public.zinarix_sync_rev;
create table if not exists public.zinarix_sync (
  kind text not null,
  id text not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  device text not null,
  blob text,
  rev bigint not null default nextval('public.zinarix_sync_rev'),
  primary key (kind, id)
);
create index if not exists zinarix_sync_rev_idx on public.zinarix_sync (rev);
alter table public.zinarix_sync enable row level security;
revoke all on public.zinarix_sync from anon, authenticated;
create or replace function public.zinarix_sync_bump() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.rev := nextval('public.zinarix_sync_rev');
  return new;
end $$;
drop trigger if exists zinarix_sync_bump on public.zinarix_sync;
create trigger zinarix_sync_bump before insert or update on public.zinarix_sync
  for each row execute function public.zinarix_sync_bump();
notify pgrst, 'reload schema';
`;

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) =>
    scrypt(passphrase.normalize('NFKC'), salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))),
  );
}

function seal(key: Buffer, aad: string, value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(gzipSync(JSON.stringify(value))), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]).toString('base64');
}

function unseal(key: Buffer, aad: string, blob: string): unknown {
  const b = Buffer.from(blob, 'base64');
  if (b[0] !== 1 || b.length < 29) throw new Error('unknown sync blob format');
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(1, 13), { authTagLength: 16 });
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(13, 29));
  const plain = Buffer.concat([d.update(b.subarray(29)), d.final()]);
  return JSON.parse(gunzipSync(plain).toString('utf8')) as unknown;
}

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('base64url');

const monthOf = (ts: number) => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthRange = (month: string): [number, number] => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
};

export class CloudSync {
  private readonly file: string;
  private readonly keyStore: TokenStore;
  private cfg: Config | null;
  private key: Buffer | null = null;
  private service: { url: string; headers: Record<string, string> } | null = null;
  private running: Promise<CloudSyncStatus> | null = null;
  private timer?: NodeJS.Timeout;
  private soon?: NodeJS.Timeout;
  /** Told after every sync (main broadcasts the status; history/memories may have changed). */
  onStatus?: (s: CloudSyncStatus, changed: { conv: boolean; mem: boolean }) => void;

  constructor(
    private readonly dir: string,
    private readonly core: OmniCore,
    private readonly supabase: Supabase,
    private readonly knowledge: Knowledge,
  ) {
    this.file = join(dir, 'cloud-sync.json');
    this.keyStore = new TokenStore(join(dir, 'cloud-sync.key'), 'cloud-sync-key');
    this.cfg = this.load();
  }

  private load(): Config | null {
    try {
      if (!existsSync(this.file)) return null;
      const c = JSON.parse(readFileSync(this.file, 'utf8')) as Config;
      return c?.ref ? c : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    if (this.cfg) writeFileSync(this.file, JSON.stringify(this.cfg, null, 1), { mode: 0o600 });
  }

  private loadKey(): Buffer | null {
    if (this.key) return this.key;
    const k = this.keyStore.get();
    this.key = k ? Buffer.from(k, 'base64') : null;
    return this.key?.length === 32 ? this.key : null;
  }

  status(): CloudSyncStatus {
    const c = this.cfg;
    return {
      connected: !!c && !!this.loadKey(),
      ref: c?.ref ?? null,
      projectName: c?.projectName ?? null,
      account: c?.account ?? null,
      deviceName: c?.deviceName ?? null,
      lastSync: c?.lastSync ?? null,
      lastError: c?.lastError ?? null,
      lastIn: c?.lastIn ?? 0,
      lastOut: c?.lastOut ?? 0,
      syncing: !!this.running,
    };
  }

  /** Starts the periodic sync (and a first one shortly after startup) when connected. */
  start(): void {
    clearInterval(this.timer);
    if (!this.status().connected) return;
    this.timer = setInterval(() => void this.syncNow().catch(() => undefined), INTERVAL_MS);
    this.timer.unref?.();
    this.later(20_000);
  }

  stop(): void {
    clearInterval(this.timer);
    clearTimeout(this.soon);
  }

  /** Something changed locally (a chat ended, a memory was saved): sync in a little while. */
  later(ms = 15_000): void {
    if (!this.status().connected) return;
    clearTimeout(this.soon);
    this.soon = setTimeout(() => void this.syncNow().catch(() => undefined), ms);
    this.soon.unref?.();
  }

  /**
   * Links a Supabase project: installs the table, then derives the key from the passphrase.
   * The first device creates the key check; later devices must type the same passphrase.
   */
  async connect(account: string | null, ref: string, passphrase: string): Promise<CloudSyncStatus> {
    if (passphrase.length < 8) throw new Error('La frase debe tener al menos 8 caracteres.');
    const sb = this.supabase.forAccount(account ?? undefined);
    const project = (await sb.projects()).find((p) => p.ref === ref);
    if (!project) throw new Error('No se encontró ese proyecto en tu cuenta de Supabase.');
    await sb.query(ref, SCHEMA_SQL);
    this.stop();
    this.service = null;
    this.cfg = {
      account,
      ref,
      projectName: project.name,
      deviceId: this.cfg?.deviceId ?? randomUUID(),
      deviceName: hostname().slice(0, 60) || 'PC',
      cursor: 0,
      lastSync: null,
      lastError: null,
      lastIn: 0,
      lastOut: 0,
    };
    // PostgREST may take a moment to see the new table after the schema reload.
    let meta: RemoteRow | undefined;
    for (let i = 0; ; i++) {
      try {
        meta = (await this.get(`kind=eq.meta&id=eq.key&select=*`))[0];
        break;
      } catch (e) {
        if (i >= 4) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    let key: Buffer;
    if (meta?.blob) {
      const m = JSON.parse(meta.blob) as { v: number; salt: string; check: string };
      key = await deriveKey(passphrase, Buffer.from(m.salt, 'base64'));
      let ok = false;
      try {
        ok = unseal(key, 'meta:key', m.check) === CHECK;
      } catch {
        ok = false;
      }
      if (!ok)
        throw new Error(
          'La frase no coincide con la que se usó en tu otra PC. Escribe la misma frase.',
        );
    } else {
      const salt = randomBytes(16);
      key = await deriveKey(passphrase, salt);
      await this.upsert([
        {
          ...META,
          updated_at: Date.now(),
          deleted: false,
          device: this.cfg.deviceId,
          blob: JSON.stringify({
            v: 1,
            salt: salt.toString('base64'),
            check: seal(key, 'meta:key', CHECK),
          }),
        },
      ]);
    }
    this.keyStore.set(key.toString('base64'));
    this.key = key;
    // A fresh link merges everything: nothing counts as already exchanged.
    this.core.db.exec('DELETE FROM sync_state');
    this.save();
    this.start();
    return this.syncNow();
  }

  /** Unlinks this PC. Nothing is deleted from Supabase or from this PC. */
  disconnect(): CloudSyncStatus {
    this.stop();
    this.keyStore.delete();
    rmSync(this.file, { force: true });
    this.core.db.exec('DELETE FROM sync_state');
    this.cfg = null;
    this.key = null;
    this.service = null;
    return this.status();
  }

  syncNow(): Promise<CloudSyncStatus> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<CloudSyncStatus> {
    const cfg = this.cfg;
    const key = this.loadKey();
    if (!cfg || !key) return this.status();
    const changed = { conv: false, mem: false };
    try {
      const inCount = await this.pull(cfg, key, changed);
      const outCount = await this.push(cfg, key);
      cfg.lastIn = inCount;
      cfg.lastOut = outCount;
      cfg.lastSync = Date.now();
      cfg.lastError = null;
    } catch (e) {
      cfg.lastError = (e as Error).message || String(e);
      // The secret key may have been rotated: look it up again next time.
      this.service = null;
    }
    this.save();
    const s = { ...this.status(), syncing: false };
    this.onStatus?.(s, changed);
    if (s.lastError) throw new Error(s.lastError);
    return s;
  }

  // ------------------------------------------------------------------ local side

  private state(kind: Kind): Map<string, string> {
    const rows = this.core.db.prepare('SELECT id, fp FROM sync_state WHERE kind = ?').all(kind) as {
      id: string;
      fp: string;
    }[];
    return new Map(rows.map((r) => [r.id, r.fp]));
  }

  private setState(kind: Kind, id: string, fp: string | null): void {
    if (fp === null)
      this.core.db.prepare('DELETE FROM sync_state WHERE kind = ? AND id = ?').run(kind, id);
    else
      this.core.db
        .prepare('INSERT OR REPLACE INTO sync_state (kind, id, fp) VALUES (?, ?, ?)')
        .run(kind, id, fp);
  }

  /** What this PC has now, per kind: id → fingerprint, time, payload. */
  private local(kind: Kind, deviceId: string): Map<string, LocalItem> {
    const out = new Map<string, LocalItem>();
    if (kind === 'conv') {
      for (const c of this.core.history.fingerprints())
        out.set(c.id, {
          fp: c.fp,
          mtime: c.updatedAt,
          payload: (): ConvPayload | null => {
            const d = this.core.history.get(c.id);
            if (!d) return null;
            const { messageCount: _n, ...conversation } = d.conversation;
            return {
              conversation,
              messages: d.messages.map((m) => ({
                message: m.message,
                model: m.model,
                ts: m.ts,
                display: m.display,
              })),
            };
          },
        });
    } else if (kind === 'mem') {
      for (const m of this.knowledge.memories(undefined, true))
        out.set(m.id, { fp: sha(m), mtime: m.created, payload: () => m });
    } else {
      const rows = this.core.db
        .prepare(
          `SELECT ts, provider, model, role, project, input_tokens, output_tokens, cached_tokens,
             cost_usd, latency_ms, ok, device FROM usage ORDER BY ts, id`,
        )
        .all() as Record<string, string | number | null>[];
      const groups = new Map<string, UsagePayload>();
      for (const r of rows) {
        const device = (r.device as string | null) ?? deviceId;
        const month = monthOf(r.ts as number);
        const id = `${device}:${month}`;
        let g = groups.get(id);
        if (!g) groups.set(id, (g = { device, month, rows: [] }));
        g.rows.push([
          r.ts as number,
          r.provider as string,
          r.model as string,
          r.role as string,
          r.project as string | null,
          r.input_tokens as number,
          r.output_tokens as number,
          r.cached_tokens as number,
          r.cost_usd as number | null,
          r.latency_ms as number | null,
          r.ok as number,
        ]);
      }
      for (const [id, g] of groups)
        out.set(id, { fp: sha(g), mtime: g.rows.at(-1)?.[0] ?? 0, payload: () => g });
    }
    return out;
  }

  private async apply(kind: Kind, id: string, value: unknown, deviceId: string): Promise<void> {
    if (kind === 'conv') {
      const p = value as ConvPayload;
      if (!p?.conversation?.id || p.conversation.id !== id || !Array.isArray(p.messages)) return;
      this.core.history.importConversation(p.conversation, p.messages);
    } else if (kind === 'mem') {
      const m = value as MemoryView;
      if (m?.id !== id || typeof m.text !== 'string') return;
      await this.knowledge.putMemory(m);
    } else {
      const u = value as UsagePayload;
      // This PC's own usage is never overwritten from the cloud.
      if (!u?.device || u.device === deviceId || !Array.isArray(u.rows)) return;
      const [from, to] = monthRange(u.month);
      const db = this.core.db;
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM usage WHERE device = ? AND ts >= ? AND ts < ?').run(
          u.device,
          from,
          to,
        );
        const ins = db.prepare(
          `INSERT INTO usage (ts, provider, model, role, project, input_tokens, output_tokens,
             cached_tokens, cost_usd, latency_ms, ok, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of u.rows) ins.run(...r, u.device);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  private async remove(kind: Kind, id: string, deviceId: string): Promise<void> {
    if (kind === 'conv') this.core.history.delete(id);
    else if (kind === 'mem') await this.knowledge.removeMemory(id);
    else {
      const [device, month] = id.split(/:(?=[^:]+$)/) as [string, string];
      if (device === deviceId || !month) return;
      const [from, to] = monthRange(month);
      this.core.db
        .prepare('DELETE FROM usage WHERE device = ? AND ts >= ? AND ts < ?')
        .run(device, from, to);
    }
  }

  // ------------------------------------------------------------------ sync passes

  private async pull(
    cfg: Config,
    key: Buffer,
    changed: { conv: boolean; mem: boolean },
  ): Promise<number> {
    let count = 0;
    let cursor = Math.max(0, cfg.cursor - REV_OVERLAP);
    let maxRev = cfg.cursor;
    const locals = new Map<Kind, Map<string, LocalItem>>();
    const states = new Map<Kind, Map<string, string>>();
    for (;;) {
      const page = await this.get(
        `rev=gt.${cursor}&kind=neq.meta&order=rev.asc&limit=${PULL_PAGE}&select=*`,
      );
      for (const r of page) {
        cursor = Math.max(cursor, r.rev);
        maxRev = Math.max(maxRev, r.rev);
        const kind = r.kind as Kind;
        if (!KINDS.includes(kind)) continue;
        if (!locals.has(kind)) {
          locals.set(kind, this.local(kind, cfg.deviceId));
          states.set(kind, this.state(kind));
        }
        const local = locals.get(kind)!.get(r.id);
        const known = states.get(kind)!.get(r.id);
        const localChanged = (local?.fp ?? null) !== (known ?? null);
        // Our own write coming back: nothing to do.
        if (r.device === cfg.deviceId && !localChanged) continue;
        if (r.deleted) {
          if (!local) {
            this.setState(kind, r.id, null);
            continue;
          }
          // Edited here after it was deleted elsewhere: keep it (it is uploaded again).
          if (localChanged && local.mtime > r.updated_at) continue;
          await this.remove(kind, r.id, cfg.deviceId);
          this.setState(kind, r.id, null);
          states.get(kind)!.delete(r.id);
          locals.get(kind)!.delete(r.id);
        } else {
          if (!r.blob) continue;
          if (local && localChanged && local.mtime > r.updated_at) continue;
          let value: unknown;
          try {
            value = unseal(key, `${kind}:${r.id}`, r.blob);
          } catch {
            throw new Error(
              'No se pudo descifrar lo que hay en la nube: la frase de esta PC no coincide. Desconecta y vuelve a conectar con la frase correcta.',
            );
          }
          await this.apply(kind, r.id, value, cfg.deviceId);
          const fresh = this.local(kind, cfg.deviceId);
          locals.set(kind, fresh);
          const fp = fresh.get(r.id)?.fp;
          if (fp) {
            this.setState(kind, r.id, fp);
            states.get(kind)!.set(r.id, fp);
          }
        }
        count++;
        if (kind === 'conv') changed.conv = true;
        if (kind === 'mem') changed.mem = true;
      }
      if (page.length < PULL_PAGE) break;
    }
    cfg.cursor = maxRev;
    return count;
  }

  private async push(cfg: Config, key: Buffer): Promise<number> {
    const out: Omit<RemoteRow, 'rev'>[] = [];
    const done: [Kind, string, string | null][] = [];
    for (const kind of KINDS) {
      const local = this.local(kind, cfg.deviceId);
      const state = this.state(kind);
      for (const [id, item] of local) {
        if (state.get(id) === item.fp) continue;
        // Other PCs' usage is theirs to upload.
        if (kind === 'usage' && !id.startsWith(`${cfg.deviceId}:`)) {
          done.push([kind, id, item.fp]);
          continue;
        }
        const value = item.payload();
        if (value == null) continue;
        out.push({
          kind,
          id,
          updated_at: item.mtime || Date.now(),
          deleted: false,
          device: cfg.deviceId,
          blob: seal(key, `${kind}:${id}`, value),
        });
        done.push([kind, id, item.fp]);
      }
      for (const id of state.keys()) {
        if (local.has(id)) continue;
        out.push({
          kind,
          id,
          updated_at: Date.now(),
          deleted: true,
          device: cfg.deviceId,
          blob: null,
        });
        done.push([kind, id, null]);
      }
    }
    for (let i = 0; i < out.length; i += PUSH_BATCH) {
      await this.upsert(out.slice(i, i + PUSH_BATCH));
    }
    for (const [kind, id, fp] of done) this.setState(kind, id, fp);
    return out.length;
  }

  // ------------------------------------------------------------------ PostgREST

  private async rest(): Promise<{ url: string; headers: Record<string, string> }> {
    if (this.service) return this.service;
    const cfg = this.cfg;
    if (!cfg) throw new Error('La nube no está conectada.');
    const { key, legacy } = await this.supabase
      .forAccount(cfg.account ?? undefined)
      .serviceKey(cfg.ref);
    this.service = {
      url: `https://${cfg.ref}.supabase.co/rest/v1/zinarix_sync`,
      headers: { apikey: key, ...(legacy ? { Authorization: `Bearer ${key}` } : {}) },
    };
    return this.service;
  }

  private async get(query: string): Promise<RemoteRow[]> {
    const s = await this.rest();
    const r = await fetch(`${s.url}?${query}`, {
      headers: s.headers,
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`Supabase (${r.status}): ${(await r.text()).slice(0, 300)}`);
    const rows = (await r.json()) as RemoteRow[];
    return rows.map((x) => ({ ...x, rev: Number(x.rev), updated_at: Number(x.updated_at) }));
  }

  private async upsert(rows: Omit<RemoteRow, 'rev'>[]): Promise<void> {
    if (!rows.length) return;
    const s = await this.rest();
    const r = await fetch(`${s.url}?on_conflict=kind,id`, {
      method: 'POST',
      headers: {
        ...s.headers,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`Supabase (${r.status}): ${(await r.text()).slice(0, 300)}`);
  }
}
