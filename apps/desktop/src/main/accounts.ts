import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TokenStore } from './token-store.js';

export interface SavedAccount {
  id: string;
  /** What the panel shows (user name, organizations…); filled in once the service answers. */
  label: string;
}

interface Saved {
  active: string | null;
  accounts: SavedAccount[];
}

/** Id of the account migrated from the single token older versions kept. */
const LEGACY = 'main';

/**
 * The accounts of one service kept by the app (several at once, one of them active). The list
 * lives in `<service>-accounts.json`; each token in its own TokenStore. A token saved by an
 * older version (one account per service) shows up as the first account.
 */
export class AccountList {
  private readonly file: string;

  constructor(
    private readonly dir: string,
    private readonly service: string,
  ) {
    this.file = join(dir, `${service}-accounts.json`);
  }

  private store(id: string): TokenStore {
    return id === LEGACY
      ? new TokenStore(join(this.dir, `${this.service}-token.bin`), this.service)
      : new TokenStore(join(this.dir, `${this.service}-token-${id}.bin`), `${this.service}:${id}`);
  }

  private read(): Saved {
    if (existsSync(this.file)) {
      try {
        const s = JSON.parse(readFileSync(this.file, 'utf8')) as Saved;
        if (Array.isArray(s.accounts)) return s;
      } catch {
        /* unreadable: start over */
      }
    }
    // Older versions: one token and no list.
    if (this.store(LEGACY).get()) return { active: LEGACY, accounts: [{ id: LEGACY, label: '' }] };
    return { active: null, accounts: [] };
  }

  private write(s: Saved): void {
    writeFileSync(this.file, JSON.stringify(s, null, 2), { mode: 0o600 });
  }

  list(): SavedAccount[] {
    return this.read().accounts;
  }

  active(): SavedAccount | null {
    const s = this.read();
    return s.accounts.find((a) => a.id === s.active) ?? s.accounts[0] ?? null;
  }

  token(id: string): string | null {
    return this.store(id).get();
  }

  /**
   * Keeps a new account and makes it the active one. The same token again only makes that
   * account active; another token of the same user is kept as one more account.
   */
  add(token: string, label: string): void {
    const s = this.read();
    const same = s.accounts.find((a) => this.token(a.id) === token);
    const id = same?.id ?? randomBytes(6).toString('hex');
    this.store(id).set(token);
    if (same) same.label = label;
    else s.accounts.push({ id, label });
    s.active = id;
    this.write(s);
  }

  label(id: string, label: string): void {
    const s = this.read();
    const a = s.accounts.find((x) => x.id === id);
    if (!a || a.label === label) return;
    a.label = label;
    this.write(s);
  }

  use(id: string): void {
    const s = this.read();
    if (!s.accounts.some((a) => a.id === id)) throw new Error('Esa cuenta ya no está conectada.');
    s.active = id;
    this.write(s);
  }

  /** Forgets an account and its token; the next one left becomes active. */
  remove(id: string): void {
    const s = this.read();
    this.store(id).delete();
    s.accounts = s.accounts.filter((a) => a.id !== id);
    if (s.active === id || !s.accounts.some((a) => a.id === s.active))
      s.active = s.accounts[0]?.id ?? null;
    this.write(s);
  }
}
