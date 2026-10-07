import { argon2Sync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { Entry, findCredentials } from '@napi-rs/keyring';
import { OmniError } from '@omni/shared';
import type { CatalogEntry } from '@omni/shared';
import { Secret } from '@omni/security';

export type StoreName = 'env' | 'keychain' | 'file';

export interface KeyStore {
  readonly name: StoreName;
  available(): boolean;
  get(providerId: string): Promise<Secret | undefined>;
  set(providerId: string, value: string): Promise<void>;
  delete(providerId: string): Promise<boolean>;
  list(): Promise<string[]>;
}

// ---------------- Environment variables (CI) ----------------

export function envVarNames(entry: CatalogEntry): string[] {
  return [...entry.envVars, `OMNI_KEY_${entry.id.toUpperCase().replace(/-/g, '_')}`];
}

export class EnvStore implements KeyStore {
  readonly name = 'env' as const;
  constructor(
    private readonly providers: Map<string, CatalogEntry>,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  available() {
    return true;
  }

  async get(id: string) {
    const entry = this.providers.get(id);
    if (!entry) return undefined;
    for (const name of envVarNames(entry)) {
      const v = this.env[name]?.trim();
      if (v) return new Secret(v);
    }
    return undefined;
  }

  async set(): Promise<void> {
    throw new OmniError('config', 'environment variables are read-only');
  }

  async delete() {
    return false;
  }

  async list() {
    const out: string[] = [];
    for (const id of this.providers.keys()) if (await this.get(id)) out.push(id);
    return out;
  }
}

// ---------------- OS keychain ----------------

const SERVICE = 'omnicode';

export class KeychainStore implements KeyStore {
  readonly name = 'keychain' as const;
  #available: boolean | undefined;

  constructor(
    private readonly service = SERVICE,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  available(): boolean {
    if (this.#available !== undefined) return this.#available;
    if (this.env.OMNI_NO_KEYCHAIN === '1') return (this.#available = false);
    try {
      const probe = new Entry(this.service, '__omni_probe__');
      probe.setPassword('probe');
      const ok = probe.getPassword() === 'probe';
      probe.deletePassword();
      this.#available = ok;
    } catch {
      this.#available = false;
    }
    return this.#available;
  }

  async get(id: string) {
    if (!this.available()) return undefined;
    try {
      const v = new Entry(this.service, id).getPassword();
      return v ? new Secret(v) : undefined;
    } catch {
      return undefined;
    }
  }

  async set(id: string, value: string) {
    new Entry(this.service, id).setPassword(value);
  }

  async delete(id: string) {
    if (!this.available()) return false;
    try {
      return new Entry(this.service, id).deletePassword();
    } catch {
      return false;
    }
  }

  async list() {
    if (!this.available()) return [];
    try {
      return findCredentials(this.service)
        .map((c) => c.account)
        .filter((a) => a !== '__omni_probe__');
    } catch {
      return [];
    }
  }
}

// ---------------- Encrypted file (servers without a keychain) ----------------

interface VaultFile {
  v: 1;
  kdf: { alg: 'argon2id'; memory: number; passes: number; parallelism: number; salt: string };
  iv: string;
  tag: string;
  data: string;
}

const KDF = { memory: 65536, passes: 3, parallelism: 1 };

function deriveKey(password: string, salt: Buffer, p = KDF): Buffer {
  return argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: p.memory,
    passes: p.passes,
    parallelism: p.parallelism,
    tagLength: 32,
  });
}

/**
 * ~/.omni/vault.enc: AES-256-GCM, key derived with Argon2id from a master password,
 * file mode 600. The password comes from OMNI_VAULT_PASSWORD or an interactive prompt.
 */
export class FileVault implements KeyStore {
  readonly name = 'file' as const;
  #cache: Record<string, string> | undefined;
  #password: string | undefined;

  constructor(
    private readonly file: string,
    private readonly askPassword: () => Promise<string>,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  available() {
    return true;
  }

  exists() {
    return existsSync(this.file);
  }

  private async password(): Promise<string> {
    this.#password ??= this.env.OMNI_VAULT_PASSWORD || (await this.askPassword());
    if (!this.#password) throw new OmniError('config', 'vault password required');
    return this.#password;
  }

  private async read(): Promise<Record<string, string>> {
    if (this.#cache) return this.#cache;
    if (!this.exists()) return (this.#cache = {});
    const vf = JSON.parse(readFileSync(this.file, 'utf8')) as VaultFile;
    const key = deriveKey(await this.password(), Buffer.from(vf.kdf.salt, 'base64'), vf.kdf);
    try {
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(vf.iv, 'base64'));
      d.setAuthTag(Buffer.from(vf.tag, 'base64'));
      const plain = Buffer.concat([d.update(Buffer.from(vf.data, 'base64')), d.final()]).toString(
        'utf8',
      );
      this.#cache = JSON.parse(plain) as Record<string, string>;
    } catch {
      this.#password = undefined;
      throw new OmniError('auth', 'wrong vault password or corrupted vault');
    }
    for (const v of Object.values(this.#cache)) new Secret(v); // register for redaction
    return this.#cache;
  }

  private async write(data: Record<string, string>): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveKey(await this.password(), salt);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
    const vf: VaultFile = {
      v: 1,
      kdf: { alg: 'argon2id', ...KDF, salt: salt.toString('base64') },
      iv: iv.toString('base64'),
      tag: c.getAuthTag().toString('base64'),
      data: enc.toString('base64'),
    };
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(vf), { mode: 0o600 });
    renameSync(tmp, this.file);
    this.#cache = data;
  }

  async get(id: string) {
    if (!this.exists()) return undefined;
    const v = (await this.read())[id];
    return v ? new Secret(v) : undefined;
  }

  async set(id: string, value: string) {
    const data = { ...(await this.read()), [id]: value };
    await this.write(data);
  }

  async delete(id: string) {
    if (!this.exists()) return false;
    const data = { ...(await this.read()) };
    if (!(id in data)) return false;
    delete data[id];
    await this.write(data);
    return true;
  }

  async list() {
    if (!this.exists()) return [];
    return Object.keys(await this.read());
  }

  destroy() {
    rmSync(this.file, { force: true });
    this.#cache = undefined;
  }
}

// ---------------- Facade ----------------

export interface KeyLookup {
  secret: Secret;
  store: StoreName;
}

/** Resolution order: environment → OS keychain → encrypted file. */
export class Vault {
  constructor(
    readonly env: EnvStore,
    readonly keychain: KeychainStore,
    readonly file: FileVault,
  ) {}

  async get(id: string): Promise<KeyLookup | undefined> {
    const fromEnv = await this.env.get(id);
    if (fromEnv) return { secret: fromEnv, store: 'env' };
    const fromKeychain = await this.keychain.get(id);
    if (fromKeychain) return { secret: fromKeychain, store: 'keychain' };
    const fromFile = await this.file.get(id);
    if (fromFile) return { secret: fromFile, store: 'file' };
    return undefined;
  }

  /** Stores in the keychain when available, otherwise in the encrypted file. */
  async set(id: string, value: string, prefer?: 'keychain' | 'file'): Promise<StoreName> {
    const trimmed = value.trim();
    if (!trimmed) throw new OmniError('config', 'empty key');
    new Secret(trimmed); // register for redaction before anything else can echo it
    if (prefer !== 'file' && this.keychain.available()) {
      await this.keychain.set(id, trimmed);
      return 'keychain';
    }
    await this.file.set(id, trimmed);
    return 'file';
  }

  async delete(id: string): Promise<boolean> {
    const a = await this.keychain.delete(id);
    const b = await this.file.delete(id);
    return a || b;
  }

  async list(): Promise<{ id: string; store: StoreName }[]> {
    const seen = new Map<string, StoreName>();
    for (const id of await this.file.list()) seen.set(id, 'file');
    for (const id of await this.keychain.list()) seen.set(id, 'keychain');
    for (const id of await this.env.list()) seen.set(id, 'env');
    return [...seen].map(([id, store]) => ({ id, store }));
  }

  async wipe(): Promise<void> {
    for (const id of await this.keychain.list()) await this.keychain.delete(id);
    this.file.destroy();
  }
}
