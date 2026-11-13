import { argon2Sync, createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
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

/**
 * Names that hold configuration, not credentials (endpoints, account/project ids, regions).
 * The catalog keeps those in `envParams`; this guard also covers catalogs (hot updates,
 * custom providers) that still list them in `envVars`, so a URL is never sent as a key.
 */
export const NON_CREDENTIAL_ENV =
  /(?:_|^)(?:ENDPOINT|BASE_URL|URL|HOST|ACCOUNT_ID|PROJECT_ID|PROJECT|REGION|LOCATION|DEPLOYMENT|RESOURCE|WORKSPACE(?:_ID|_HOST)?|ORG(?:ANIZATION)?(?:_ID)?|API_VERSION)$/;

export function isCredentialEnvName(name: string): boolean {
  return !NON_CREDENTIAL_ENV.test(name);
}

/** Environment variables that may hold this provider's key, in lookup order. */
export function envVarNames(entry: CatalogEntry): string[] {
  return [
    ...entry.envVars.filter(isCredentialEnvName),
    `OMNI_KEY_${entry.id.toUpperCase().replace(/-/g, '_')}`,
  ];
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

  /**
   * Writes and reads back: Windows Credential Manager rejects values over 1280 UTF-16 chars
   * (long OAuth/JWT tokens) and a locked keychain may accept a value and drop it.
   */
  async set(id: string, value: string) {
    const entry = new Entry(this.service, id);
    entry.setPassword(value);
    if (entry.getPassword() !== value)
      throw new OmniError('config', 'the OS keychain did not keep the key');
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

type Argon2Kdf = {
  alg: 'argon2id';
  memory: number;
  passes: number;
  parallelism: number;
  salt: string;
};
/** Used where Argon2 is missing: Electron's BoringSSL has none (ERR_CRYPTO_ARGON2_NOT_SUPPORTED). */
type ScryptKdf = { alg: 'scrypt'; N: number; r: number; p: number; salt: string };
type Kdf = Argon2Kdf | ScryptKdf;

interface VaultFile {
  v: 1;
  kdf: Kdf;
  iv: string;
  tag: string;
  data: string;
}

const SCRYPT = { N: 65536, r: 8, p: 1 };

/**
 * Bounds for KDF parameters read from vault.enc. The file is not authenticated before the
 * key is derived, so a tampered `memory: 2**31` would hang or kill the process (local DoS).
 * Argon2 memory is in KiB: 8 MiB to 1 GiB. scrypt uses 128·N·r bytes: N ≤ 2^20 and r ≤ 8
 * keep it at 1 GiB too.
 */
const KDF_LIMITS = {
  argon2id: { memory: [8192, 1048576], passes: [1, 16], parallelism: [1, 16] },
  scrypt: { N: [16384, 1048576], r: [1, 8], p: [1, 16] },
} as const;

function checkKdf(kdf: unknown): Kdf {
  const k = (kdf ?? {}) as Record<string, unknown>;
  if ((k.alg !== 'argon2id' && k.alg !== 'scrypt') || typeof k.salt !== 'string')
    throw new OmniError('config', 'corrupted vault: unsupported kdf');
  for (const [name, [min, max]] of Object.entries(KDF_LIMITS[k.alg])) {
    const v = k[name];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      throw new OmniError('config', `corrupted vault: kdf.${name} out of range`);
  }
  if (k.alg === 'scrypt' && ((k.N as number) & ((k.N as number) - 1)) !== 0)
    throw new OmniError('config', 'corrupted vault: kdf.N out of range');
  return k as Kdf;
}

let argon2: boolean | undefined;
function argon2Supported(): boolean {
  if (argon2 !== undefined) return argon2;
  try {
    argon2Sync('argon2id', {
      message: 'probe',
      nonce: Buffer.alloc(16),
      memory: 8192,
      passes: 1,
      parallelism: 1,
      tagLength: 32,
    });
    argon2 = true;
  } catch {
    argon2 = false;
  }
  return argon2;
}

/**
 * KDF for a vault being written. Always scrypt: Electron (the desktop app) has no Argon2,
 * and the CLI and the desktop can share ~/.omni/vault.enc, so a file written by either one
 * must stay readable by both. An existing scrypt file keeps its parameters and salt (same
 * derived key, fresh IV); Argon2id vaults from older versions are read and re-saved as scrypt.
 */
function kdfForWrite(existing: Kdf | undefined): ScryptKdf {
  if (existing?.alg === 'scrypt') return existing;
  return { alg: 'scrypt', ...SCRYPT, salt: randomBytes(16).toString('base64') };
}

function argon2Unsupported(file: string): OmniError {
  return new OmniError(
    'unsupported',
    `${file} was encrypted with Argon2id, which this app cannot read (the desktop app's ` +
      `runtime has no Argon2). Unlock it once with the Zinarix CLI (\`omni auth list\`) to ` +
      `re-save it in the compatible scrypt format, or remove the file and add the keys again.`,
    { retryable: false },
  );
}

function deriveKey(password: string, kdf: Kdf, file: string): Buffer {
  const salt = Buffer.from(kdf.salt, 'base64');
  if (kdf.alg === 'scrypt')
    return scryptSync(password, salt, 32, {
      N: kdf.N,
      r: kdf.r,
      p: kdf.p,
      maxmem: 256 * kdf.N * kdf.r,
    });
  if (!argon2Supported()) throw argon2Unsupported(file);
  try {
    return argon2Sync('argon2id', {
      message: password,
      nonce: salt,
      memory: kdf.memory,
      passes: kdf.passes,
      parallelism: kdf.parallelism,
      tagLength: 32,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_CRYPTO_ARGON2_NOT_SUPPORTED')
      throw argon2Unsupported(file);
    throw e;
  }
}

const GCM = { authTagLength: 16 } as const;

/**
 * Saves to one vault file run one at a time inside this process (every FileVault instance
 * for the same path shares the queue), so two concurrent `set` calls cannot both start from
 * the same contents and drop each other's key.
 */
const writeQueues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (writeQueues.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(key, tail);
  void tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key);
  });
  return run;
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Cross-process lock (vault.enc.lock, created exclusively) so the CLI and the desktop app
 * do not interleave read-modify-write cycles. A lock older than LOCK_STALE_MS is left over
 * from a crashed process and is taken over.
 */
async function withFileLock<T>(lock: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx', 0o600));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue; // released between the open and the stat
      }
      if (Date.now() > deadline)
        throw new OmniError(
          'config',
          `the vault is locked by another Zinarix process (${lock}); retry, or delete that file if no other Zinarix process is running`,
        );
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** rename over an existing file; Windows refuses it briefly while another process reads it. */
function replaceFile(tmp: string, file: string): void {
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 20 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) {
        rmSync(tmp, { force: true });
        throw e;
      }
      sleepSync(25);
    }
  }
}

/**
 * ~/.omni/vault.enc: AES-256-GCM, key derived from a master password with scrypt (Argon2id
 * files from older versions are still read), file mode 600. The password comes from
 * OMNI_VAULT_PASSWORD or an interactive prompt.
 *
 * Every save re-reads the file under a lock and applies only its own change, then writes a
 * temp file and renames it over vault.enc: concurrent saves (in this process or another,
 * e.g. CLI + desktop) keep each other's keys, and a crash never leaves a half-written vault.
 */
export class FileVault implements KeyStore {
  readonly name = 'file' as const;
  #cache: Record<string, string> | undefined;
  /** mtime/size of the file the cache came from: another process may have rewritten it. */
  #cacheStamp: string | undefined;
  #password: string | undefined;
  /** Last derived key, so a save does not run the (deliberately slow) KDF twice. */
  #key: { kdf: string; key: Buffer } | undefined;

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

  /** True once the master password was entered (or the vault is empty) in this process. */
  unlocked() {
    return this.#cache !== undefined;
  }

  private async password(): Promise<string> {
    this.#password ??= this.env.OMNI_VAULT_PASSWORD || (await this.askPassword());
    if (!this.#password) throw new OmniError('config', 'vault password required');
    return this.#password;
  }

  private stamp(): string | undefined {
    try {
      const s = statSync(this.file);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return undefined;
    }
  }

  private async key(kdf: Kdf): Promise<Buffer> {
    const id = JSON.stringify(kdf);
    if (this.#key?.kdf === id) return this.#key.key;
    const key = deriveKey(await this.password(), kdf, this.file);
    this.#key = { kdf: id, key };
    return key;
  }

  /** Decrypts the file as it is on disk now (no cache). */
  private async load(): Promise<{ data: Record<string, string>; kdf?: Kdf }> {
    const stamp = this.stamp();
    if (!stamp) return { data: {} };
    let vf: VaultFile;
    try {
      vf = JSON.parse(readFileSync(this.file, 'utf8')) as VaultFile;
    } catch {
      throw new OmniError('config', 'corrupted vault: invalid JSON');
    }
    const kdf = checkKdf(vf.kdf);
    const key = await this.key(kdf);
    let data: Record<string, string>;
    try {
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(vf.iv, 'base64'), GCM);
      d.setAuthTag(Buffer.from(vf.tag, 'base64'));
      const plain = Buffer.concat([d.update(Buffer.from(vf.data, 'base64')), d.final()]).toString(
        'utf8',
      );
      data = JSON.parse(plain) as Record<string, string>;
    } catch {
      this.#password = undefined;
      this.#key = undefined;
      throw new OmniError('auth', 'wrong vault password or corrupted vault');
    }
    for (const v of Object.values(data)) new Secret(v); // register for redaction
    this.#cache = data;
    this.#cacheStamp = stamp;
    return { data, kdf };
  }

  private async read(): Promise<Record<string, string>> {
    if (this.#cache && this.#cacheStamp === this.stamp()) return this.#cache;
    if (!this.exists()) {
      this.#cacheStamp = undefined;
      return (this.#cache = {});
    }
    const { data, kdf } = await this.load();
    // Re-save Argon2id vaults as scrypt so the desktop app (no Argon2) can open them too.
    if (kdf?.alg === 'argon2id') await this.update(() => undefined).catch(() => undefined);
    return data;
  }

  /**
   * Read-modify-write under the in-process queue and the cross-process lock: the change is
   * applied to the file's current contents, never to a possibly stale cache.
   */
  private async update<T>(mutate: (data: Record<string, string>) => T): Promise<T> {
    await this.password(); // prompt before taking the lock, never while holding it
    return serialize(resolve(this.file).toLowerCase(), () =>
      withFileLock(`${this.file}.lock`, async () => {
        const current = await this.load();
        const data = { ...current.data };
        const result = mutate(data);
        await this.write(data, current.kdf);
        return result;
      }),
    );
  }

  private async write(data: Record<string, string>, existing: Kdf | undefined): Promise<void> {
    const kdf = kdfForWrite(existing);
    const iv = randomBytes(12);
    const key = await this.key(kdf);
    const c = createCipheriv('aes-256-gcm', key, iv, GCM);
    const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
    const vf: VaultFile = {
      v: 1,
      kdf,
      iv: iv.toString('base64'),
      tag: c.getAuthTag().toString('base64'),
      data: enc.toString('base64'),
    };
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(vf), { mode: 0o600 });
    replaceFile(tmp, this.file);
    this.#cache = data;
    this.#cacheStamp = this.stamp();
  }

  async get(id: string) {
    if (!this.exists()) return undefined;
    const v = (await this.read())[id];
    return v ? new Secret(v) : undefined;
  }

  async set(id: string, value: string) {
    await this.update((data) => {
      data[id] = value;
    });
  }

  async delete(id: string) {
    if (!this.exists()) return false;
    // Unlocks (and checks the password) first; only rewrites when the key is there.
    if (!(id in (await this.read()))) return false;
    return this.update((data) => {
      if (!(id in data)) return false;
      delete data[id];
      return true;
    });
  }

  async list() {
    if (!this.exists()) return [];
    return Object.keys(await this.read());
  }

  destroy() {
    rmSync(this.file, { force: true });
    this.#cache = undefined;
    this.#cacheStamp = undefined;
    this.#key = undefined;
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

  /**
   * `unlockFile: false` only reads the encrypted file if it is already unlocked, so a
   * lookup for a keyless provider never prompts for (or fails on) the master password.
   */
  async get(id: string, opts: { unlockFile?: boolean } = {}): Promise<KeyLookup | undefined> {
    const fromEnv = await this.env.get(id);
    if (fromEnv) return { secret: fromEnv, store: 'env' };
    const fromKeychain = await this.keychain.get(id);
    if (fromKeychain) return { secret: fromKeychain, store: 'keychain' };
    if (opts.unlockFile === false && !this.file.unlocked()) return undefined;
    const fromFile = await this.file.get(id);
    if (fromFile) return { secret: fromFile, store: 'file' };
    return undefined;
  }

  /**
   * Stores in the keychain when available, otherwise in the encrypted file. A value the
   * keychain refuses (e.g. longer than Windows Credential Manager's limit) goes to the file;
   * any old keychain copy is removed first, since reads prefer the keychain.
   */
  async set(id: string, value: string, prefer?: 'keychain' | 'file'): Promise<StoreName> {
    const trimmed = value.trim();
    if (!trimmed) throw new OmniError('config', 'empty key');
    new Secret(trimmed); // register for redaction before anything else can echo it
    if (prefer !== 'file' && this.keychain.available()) {
      try {
        await this.keychain.set(id, trimmed);
        if (this.file.exists() && this.file.unlocked()) await this.file.delete(id);
        return 'keychain';
      } catch {
        /* refused by the keychain: fall back to the encrypted file */
      }
    }
    await this.keychain.delete(id);
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
