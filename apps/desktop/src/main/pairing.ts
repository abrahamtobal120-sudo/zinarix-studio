import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Where a pairing attempt comes from: each one has its own counter and lock. */
export type PairChannel = 'phone' | 'telegram' | 'discord';

/** Wrong PINs in a row (per channel) before pairing through that channel locks. */
export const MAX_TRIES = 5;
/** First lock; each further lock doubles it, up to MAX_LOCK_MS. */
export const LOCK_MS = 10 * 60_000;
export const MAX_LOCK_MS = 24 * 60 * 60_000;

export type PinCheck =
  | { ok: true }
  | { ok: false; error: string; /** The PIN was rotated (the desktop must show the new one). */ rotated?: boolean };

/** Constant-time comparison of two strings of any length (hashes first, so lengths never leak). */
export function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(h(a), h(b));
}

/** Minutes, for the message the person trying to pair sees. */
function minutes(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return m === 1 ? '1 minuto' : `${m} minutos`;
}

interface ChannelState {
  fails: number;
  /** How many times it has locked since the last good PIN (each lock lasts longer). */
  locks: number;
  until: number;
}

/**
 * Brute-force guard for the pairing PIN. Wrong tries count per channel (the phone page, each
 * bot), and after MAX_TRIES the channel locks for LOCK_MS, doubling on every new lock; tries
 * during a lock are rejected without even looking at the PIN. A good PIN resets the channel.
 * The caller rotates the PIN when `rotated` comes back true.
 */
export class PairingGuard {
  private state = new Map<PairChannel, ChannelState>();
  private loaded = false;

  /**
   * `file`: where the counters are kept, so closing and reopening the app (or restarting the
   * phone server) does not hand out a fresh set of tries. Without it they live in memory.
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly file?: () => string,
  ) {}

  private load(): void {
    if (this.loaded || !this.file) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(readFileSync(this.file(), 'utf8')) as Record<string, unknown>;
      for (const ch of ['phone', 'telegram', 'discord'] as const) {
        const v = raw[ch] as Partial<ChannelState> | undefined;
        if (!v || typeof v !== 'object') continue;
        const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
        // A lock never lasts longer than MAX_LOCK_MS from now (a clock moved back cannot
        // make it endless).
        const until = Math.min(num(v.until), this.now() + MAX_LOCK_MS);
        this.state.set(ch, { fails: Math.min(num(v.fails), MAX_TRIES), locks: Math.min(num(v.locks), 32), until });
      }
    } catch {
      /* no file yet, or unreadable: start clean */
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      const f = this.file();
      mkdirSync(dirname(f), { recursive: true });
      const tmp = `${f}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.state)), 'utf8');
      renameSync(tmp, f);
    } catch (e) {
      console.warn('[pairing] could not save the PIN counters:', e);
    }
  }

  private get(ch: PairChannel): ChannelState {
    this.load();
    let s = this.state.get(ch);
    if (!s) this.state.set(ch, (s = { fails: 0, locks: 0, until: 0 }));
    return s;
  }

  /** Milliseconds left of the lock on the channel (0 = open). */
  lockedFor(ch: PairChannel): number {
    return Math.max(0, this.get(ch).until - this.now());
  }

  check(ch: PairChannel, typed: string, pin: string): PinCheck {
    const s = this.get(ch);
    const left = this.lockedFor(ch);
    if (left > 0)
      return {
        ok: false,
        error: `Demasiados intentos con PIN incorrecto. Vuelve a intentarlo en ${minutes(left)}.`,
      };
    if (pin && sameSecret(typed.replace(/\D/g, ''), pin)) {
      this.state.delete(ch);
      this.save();
      return { ok: true };
    }
    if (++s.fails < MAX_TRIES) {
      this.save();
      return { ok: false, error: 'PIN incorrecto' };
    }
    s.fails = 0;
    const ms = Math.min(MAX_LOCK_MS, LOCK_MS * 2 ** s.locks);
    s.locks++;
    s.until = this.now() + ms;
    this.save();
    return {
      ok: false,
      rotated: true,
      error: `Demasiados intentos con PIN incorrecto. Vuelve a intentarlo en ${minutes(ms)}.`,
    };
  }
}
