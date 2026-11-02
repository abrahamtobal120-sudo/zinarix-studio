import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Entry } from '@napi-rs/keyring';
import { KeychainStore } from '@omni/core';
import { safeStorage } from 'electron';

const SERVICE = 'zinarix-studio';
const keychain = new KeychainStore(SERVICE);

/**
 * One service token kept by the app. Electron safeStorage encrypts it into `file`; where
 * safeStorage has no backend (e.g. KDE without KWallet, even with gnome-keyring running), it
 * goes straight to the OS keychain (Secret Service / Keychain / Credential Manager) instead.
 */
export class TokenStore {
  constructor(
    private readonly file: string,
    private readonly account: string,
  ) {}

  get(): string | null {
    if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(readFileSync(this.file));
      } catch {
        /* keychain changed: try the OS keychain */
      }
    }
    if (!keychain.available()) return null;
    try {
      return new Entry(SERVICE, this.account).getPassword() || null;
    } catch {
      return null;
    }
  }

  set(token: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      writeFileSync(this.file, safeStorage.encryptString(token), { mode: 0o600 });
      return;
    }
    if (!keychain.available())
      throw new Error(
        'Este sistema no tiene llavero para guardar el token cifrado. Instala y abre ' +
          'gnome-keyring o KWallet, o inicia sesión con la CLI.',
      );
    new Entry(SERVICE, this.account).setPassword(token);
  }

  delete(): void {
    rmSync(this.file, { force: true });
    if (!keychain.available()) return;
    try {
      new Entry(SERVICE, this.account).deletePassword();
    } catch {
      /* nothing stored there */
    }
  }
}
