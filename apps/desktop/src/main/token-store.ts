import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Entry } from '@napi-rs/keyring';
import { KeychainStore } from '@omni/core';
import { safeStorage } from 'electron';

const SERVICE = 'zinarix-studio';
const keychain = new KeychainStore(SERVICE);

/**
 * Last resort for systems with no keychain at all (minimal Linux, WSL, headless): AES-256-GCM
 * with a random per-install key kept in `dir/local-secret.key` (0600, user-only). Weaker than
 * an OS keychain, but the secret never sits in plain text and the app works everywhere.
 */
function localKey(dir: string): Buffer {
  const file = join(dir, 'local-secret.key');
  if (existsSync(file)) {
    const key = readFileSync(file);
    if (key.length === 32) return key;
  }
  const key = randomBytes(32);
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

export function sealLocal(dir: string, text: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', localKey(dir), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openLocal(dir: string, data: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', localKey(dir), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

/**
 * One service token kept by the app, in the best store the system offers, picked
 * automatically: Electron safeStorage (encrypted into `file`), else the OS keychain directly
 * (Secret Service / Keychain / Credential Manager; e.g. KDE without KWallet but with
 * gnome-keyring), else a locally encrypted file (`file.local`).
 */
export class TokenStore {
  private readonly localFile: string;

  constructor(
    private readonly file: string,
    private readonly account: string,
  ) {
    this.localFile = `${file}.local`;
  }

  get(): string | null {
    if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(readFileSync(this.file));
      } catch {
        /* keychain changed: try the other stores */
      }
    }
    if (keychain.available()) {
      try {
        const v = new Entry(SERVICE, this.account).getPassword();
        if (v) return v;
      } catch {
        /* nothing stored there */
      }
    }
    if (existsSync(this.localFile)) {
      try {
        return openLocal(dirname(this.file), readFileSync(this.localFile));
      } catch {
        return null;
      }
    }
    return null;
  }

  set(token: string): void {
    this.delete();
    if (safeStorage.isEncryptionAvailable()) {
      writeFileSync(this.file, safeStorage.encryptString(token), { mode: 0o600 });
      return;
    }
    if (keychain.available()) {
      try {
        new Entry(SERVICE, this.account).setPassword(token);
        return;
      } catch {
        /* keychain refused: fall back to the local file */
      }
    }
    writeFileSync(this.localFile, sealLocal(dirname(this.file), token), { mode: 0o600 });
  }

  delete(): void {
    rmSync(this.file, { force: true });
    rmSync(this.localFile, { force: true });
    if (!keychain.available()) return;
    try {
      new Entry(SERVICE, this.account).deletePassword();
    } catch {
      /* nothing stored there */
    }
  }
}
