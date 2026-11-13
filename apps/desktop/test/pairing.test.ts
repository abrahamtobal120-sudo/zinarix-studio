import { describe, expect, it } from 'vitest';
import { LOCK_MS, MAX_LOCK_MS, MAX_TRIES, PairingGuard, sameSecret } from '../src/main/pairing.js';

function guard() {
  let t = 1_000_000;
  const g = new PairingGuard(() => t);
  return { g, advance: (ms: number) => (t += ms) };
}

describe('pairing PIN guard', () => {
  it('accepts the right PIN (digits only) and rejects a wrong one', () => {
    const { g } = guard();
    expect(g.check('phone', '123 456', '123456')).toEqual({ ok: true });
    expect(g.check('phone', '000000', '123456')).toMatchObject({ ok: false, error: 'PIN incorrecto' });
    expect(g.check('phone', '', '')).toMatchObject({ ok: false });
  });

  it('locks the channel after MAX_TRIES failures, even for the right PIN', () => {
    const { g, advance } = guard();
    for (let i = 1; i < MAX_TRIES; i++)
      expect(g.check('phone', '000000', '123456')).not.toHaveProperty('rotated');
    const last = g.check('phone', '000000', '123456');
    expect(last).toMatchObject({ ok: false, rotated: true });
    expect(g.lockedFor('phone')).toBe(LOCK_MS);
    // During the lock the PIN is not even looked at.
    const locked = g.check('phone', '123456', '123456');
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toMatch(/10 minutos/);
    advance(LOCK_MS);
    expect(g.lockedFor('phone')).toBe(0);
    expect(g.check('phone', '123456', '123456')).toEqual({ ok: true });
  });

  it('each new lock lasts longer, up to the cap, and a good PIN resets it', () => {
    const { g, advance } = guard();
    const fail = () => {
      for (let i = 0; i < MAX_TRIES; i++) g.check('telegram', '1', '123456');
    };
    fail();
    expect(g.lockedFor('telegram')).toBe(LOCK_MS);
    advance(LOCK_MS);
    fail();
    expect(g.lockedFor('telegram')).toBe(2 * LOCK_MS);
    for (let k = 0; k < 20; k++) {
      advance(MAX_LOCK_MS);
      fail();
    }
    expect(g.lockedFor('telegram')).toBe(MAX_LOCK_MS);
    advance(MAX_LOCK_MS);
    expect(g.check('telegram', '123456', '123456').ok).toBe(true);
    fail();
    expect(g.lockedFor('telegram')).toBe(LOCK_MS);
  });

  it('channels are counted separately', () => {
    const { g } = guard();
    for (let i = 0; i < MAX_TRIES; i++) g.check('discord', '1', '123456');
    expect(g.lockedFor('discord')).toBeGreaterThan(0);
    expect(g.lockedFor('phone')).toBe(0);
    expect(g.check('phone', '123456', '123456').ok).toBe(true);
  });

  it('compares secrets of any length', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', 'x')).toBe(false);
  });
});

describe('PairingGuard persistence', () => {
  it('keeps the lock across a restart (a new guard reading the same file)', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const file = join(mkdtempSync(join(tmpdir(), 'zx-pair-')), 'guard.json');
    let t = 1_000_000;
    const a = new PairingGuard(() => t, () => file);
    for (let i = 0; i < MAX_TRIES; i++) a.check('phone', '000000', '123456');
    // "Restart": a fresh guard must still be locked, even with the right PIN.
    const b = new PairingGuard(() => t, () => file);
    expect(b.lockedFor('phone')).toBe(LOCK_MS);
    expect(b.check('phone', '123456', '123456').ok).toBe(false);
    // Tries below the limit are kept too.
    t += LOCK_MS + 1;
    b.check('phone', '000000', '123456');
    const c = new PairingGuard(() => t, () => file);
    for (let i = 0; i < MAX_TRIES - 2; i++) c.check('phone', '000000', '123456');
    expect(c.check('phone', '000000', '123456')).toMatchObject({ rotated: true });
    // The second lock lasts twice as long.
    expect(c.lockedFor('phone')).toBe(LOCK_MS * 2);
  });
});
