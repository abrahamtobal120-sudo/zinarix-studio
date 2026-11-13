import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Electron's BoringSSL has no Argon2: argon2Sync throws ERR_CRYPTO_ARGON2_NOT_SUPPORTED.
vi.mock('node:crypto', async (orig) => {
  const real = await orig<typeof import('node:crypto')>();
  return {
    ...real,
    argon2Sync: () => {
      throw Object.assign(new Error('Argon2 algorithm not supported'), {
        code: 'ERR_CRYPTO_ARGON2_NOT_SUPPORTED',
      });
    },
  };
});

const { FileVault } = await import('../src/vault.js');

describe('FileVault without Argon2', () => {
  it('stores and reads keys using scrypt', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'omni-scrypt-')), 'vault.enc');
    const v = new FileVault(file, async () => 'pw', {});
    await v.set('google', 'y'.repeat(3000));
    expect(JSON.parse(readFileSync(file, 'utf8')).kdf.alg).toBe('scrypt');
    const again = new FileVault(file, async () => 'pw', {});
    expect((await again.get('google'))?.reveal()).toBe('y'.repeat(3000));
  });

  it('rejects scrypt parameters out of range', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'omni-scrypt-')), 'vault.enc');
    const v = new FileVault(file, async () => 'pw', {});
    await v.set('a', 'b');
    const vf = JSON.parse(readFileSync(file, 'utf8'));
    vf.kdf.N = 2 ** 24;
    writeFileSync(file, JSON.stringify(vf));
    await expect(new FileVault(file, async () => 'pw', {}).get('a')).rejects.toThrow(/out of range/);
  });

  it('explains how to recover an Argon2id vault instead of a raw crypto error', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'omni-scrypt-')), 'vault.enc');
    // As written by an older CLI (Node has Argon2); contents are unreachable here anyway.
    writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        kdf: { alg: 'argon2id', memory: 65536, passes: 3, parallelism: 1, salt: 'AAAA' },
        iv: 'AAAAAAAAAAAAAAAA',
        tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
        data: 'AAAA',
      }),
    );
    const v = new FileVault(file, async () => 'pw', {});
    const err = await v.get('a').catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'OmniError', code: 'unsupported', retryable: false });
    expect((err as Error).message).toMatch(/Argon2id/);
    expect((err as Error).message).toMatch(/omni auth list/);
    // Writing must not silently replace the vault (and its keys) either.
    await expect(v.set('b', 'c')).rejects.toMatchObject({ code: 'unsupported' });
    expect(JSON.parse(readFileSync(file, 'utf8')).kdf.alg).toBe('argon2id');
  });
});
