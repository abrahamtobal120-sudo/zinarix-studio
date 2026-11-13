import { argon2Sync, createCipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileVault } from '../src/vault.js';

const tmpVault = () => join(mkdtempSync(join(tmpdir(), 'omni-vault-')), 'vault.enc');

/** A vault.enc as older versions of the CLI wrote it (Argon2id). */
function writeArgon2Vault(file: string, password: string, data: Record<string, string>) {
  const salt = randomBytes(16);
  const kdf = { alg: 'argon2id', memory: 8192, passes: 1, parallelism: 1 };
  const key = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: kdf.memory,
    passes: kdf.passes,
    parallelism: kdf.parallelism,
    tagLength: 32,
  });
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  writeFileSync(
    file,
    JSON.stringify({
      v: 1,
      kdf: { ...kdf, salt: salt.toString('base64') },
      iv: iv.toString('base64'),
      tag: c.getAuthTag().toString('base64'),
      data: enc.toString('base64'),
    }),
  );
}

const alg = (file: string) => JSON.parse(readFileSync(file, 'utf8')).kdf.alg as string;

describe('FileVault format interop (CLI + desktop share vault.enc)', () => {
  it('writes new vaults with scrypt even where Argon2 is available', async () => {
    const file = tmpVault();
    await new FileVault(file, async () => 'pw', {}).set('a', 'key-a');
    expect(alg(file)).toBe('scrypt');
  });

  it('keeps scrypt (and its salt) on rewrite', async () => {
    const file = tmpVault();
    const v = new FileVault(file, async () => 'pw', {});
    await v.set('a', 'key-a');
    const before = JSON.parse(readFileSync(file, 'utf8'));
    await v.set('b', 'key-b');
    const after = JSON.parse(readFileSync(file, 'utf8'));
    expect(after.kdf).toEqual(before.kdf);
    expect(after.iv).not.toBe(before.iv);
  });

  it('re-saves a legacy Argon2id vault as scrypt when it is unlocked', async () => {
    const file = tmpVault();
    writeArgon2Vault(file, 'pw', { a: 'key-a' });
    const v = new FileVault(file, async () => 'pw', {});
    expect((await v.get('a'))?.reveal()).toBe('key-a');
    expect(alg(file)).toBe('scrypt');
    expect((await new FileVault(file, async () => 'pw', {}).get('a'))?.reveal()).toBe('key-a');
  });

  it('uses 16-byte GCM tags and rejects truncated ones', async () => {
    const file = tmpVault();
    await new FileVault(file, async () => 'pw', {}).set('a', 'key-a');
    const vf = JSON.parse(readFileSync(file, 'utf8'));
    expect(Buffer.from(vf.tag, 'base64')).toHaveLength(16);
    vf.tag = Buffer.from(vf.tag, 'base64').subarray(0, 4).toString('base64');
    writeFileSync(file, JSON.stringify(vf));
    await expect(new FileVault(file, async () => 'pw', {}).get('a')).rejects.toMatchObject({
      code: 'auth',
    });
  });
});

describe('FileVault concurrent saves', () => {
  it('keeps every key when saves run concurrently (same and separate instances)', async () => {
    const file = tmpVault();
    const a = new FileVault(file, async () => 'pw', {});
    const b = new FileVault(file, async () => 'pw', {});
    await Promise.all([a.set('k1', 'v1'), b.set('k2', 'v2'), a.set('k3', 'v3'), b.set('k4', 'v4')]);
    const fresh = new FileVault(file, async () => 'pw', {});
    expect((await fresh.list()).sort()).toEqual(['k1', 'k2', 'k3', 'k4']);
  });

  it('merges into what another process wrote instead of a stale cache', async () => {
    const file = tmpVault();
    const desktop = new FileVault(file, async () => 'pw', {});
    await desktop.set('anthropic', 'sk-1');
    expect(await desktop.list()).toEqual(['anthropic']); // cached
    // Another process (e.g. the CLI) adds a key behind this instance's back.
    await new FileVault(file, async () => 'pw', {}).set('groq', 'gsk-1');
    await desktop.set('openai', 'sk-2');
    expect((await new FileVault(file, async () => 'pw', {}).list()).sort()).toEqual([
      'anthropic',
      'groq',
      'openai',
    ]);
    // Reads notice the file changed too.
    expect((await desktop.get('groq'))?.reveal()).toBe('gsk-1');
  });

  it('deletes without dropping keys added concurrently', async () => {
    const file = tmpVault();
    const v = new FileVault(file, async () => 'pw', {});
    await v.set('a', '1');
    await v.set('b', '2');
    await Promise.all([v.delete('a'), v.set('c', '3')]);
    expect((await new FileVault(file, async () => 'pw', {}).list()).sort()).toEqual(['b', 'c']);
  });

  it('takes over a stale lock left by a crashed process and removes its own', async () => {
    const file = tmpVault();
    writeFileSync(`${file}.lock`, '');
    const old = new Date(Date.now() - 120_000);
    utimesSync(`${file}.lock`, old, old);
    await new FileVault(file, async () => 'pw', {}).set('a', '1');
    expect(existsSync(`${file}.lock`)).toBe(false);
    expect(await new FileVault(file, async () => 'pw', {}).list()).toEqual(['a']);
  });
});
