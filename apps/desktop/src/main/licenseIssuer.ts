import { createPrivateKey, createPublicKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IssuedKey, IssuerStatus, IssueRequest } from '../shared/plans.js';
import { LICENSE_PUBLIC_KEY, signLicense, type LicensePayload } from './license.js';

/**
 * The owner's key desk: makes signed license keys on the seller's own PC. It only works where
 * the private key lives (~/.omni-signing/license.key, or ZINARIX_LICENSE_KEY), the same one
 * scripts/license.mjs uses; everyone else's app has no way to make keys. Every key made is
 * kept in a ledger next to the private key (issued.json), never in the repo or the app data.
 */

export const GIFT_COUNT = 30;
const DAY = 86_400_000;

export interface IssuerOptions {
  keyPath?: string;
  ledgerPath?: string;
  publicKeyPem?: string;
  now?: () => number;
}

export class LicenseIssuer {
  private readonly keyPath: string;
  private readonly ledgerPath: string;
  private readonly publicKeyPem: string;
  private readonly now: () => number;

  constructor(opts: IssuerOptions = {}) {
    this.keyPath =
      opts.keyPath ??
      process.env.ZINARIX_LICENSE_KEY ??
      join(homedir(), '.omni-signing', 'license.key');
    this.ledgerPath = opts.ledgerPath ?? join(dirname(this.keyPath), 'issued.json');
    this.publicKeyPem = opts.publicKeyPem ?? LICENSE_PUBLIC_KEY;
    this.now = opts.now ?? Date.now;
  }

  /** The private key, only when it is the one whose public half is inside the app. */
  private privateKey(): KeyObject | null {
    if (!existsSync(this.keyPath)) return null;
    try {
      const key = createPrivateKey(readFileSync(this.keyPath));
      const mine = createPublicKey(key).export({ type: 'spki', format: 'der' });
      const app = createPublicKey(this.publicKeyPem).export({ type: 'spki', format: 'der' });
      return mine.equals(app) ? key : null;
    } catch {
      return null;
    }
  }

  private read(): IssuedKey[] {
    try {
      const v = JSON.parse(readFileSync(this.ledgerPath, 'utf8')) as unknown;
      return Array.isArray(v) ? (v as IssuedKey[]) : [];
    } catch {
      return [];
    }
  }

  private write(list: IssuedKey[]): void {
    mkdirSync(dirname(this.ledgerPath), { recursive: true });
    const tmp = `${this.ledgerPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
    renameSync(tmp, this.ledgerPath);
  }

  status(): IssuerStatus {
    const ok = this.privateKey() !== null;
    return {
      available: ok,
      keyPath: this.keyPath,
      reason: ok
        ? undefined
        : existsSync(this.keyPath)
          ? 'La llave privada de esta PC no corresponde a la llave pública de la app.'
          : 'Esta PC no tiene la llave privada para firmar claves.',
      keys: ok ? this.read().sort((a, b) => b.iat - a.iat) : [],
    };
  }

  private make(key: KeyObject, req: IssueRequest, gift: boolean, n?: number): IssuedKey {
    const iat = this.now();
    const days = Math.max(0, Math.floor(req.days ?? 0));
    const payload: LicensePayload = {
      v: 1,
      id: `${gift ? 'gift' : 'manual'}-${randomUUID()}`,
      plan: req.plan,
      email: req.email?.trim() || (gift ? 'regalo@zinarix-studio' : 'cliente@zinarix-studio'),
      iat,
    };
    const name =
      req.name?.trim() || (gift && n ? `Regalo Pro + AI #${String(n).padStart(2, '0')}` : '');
    if (name) payload.name = name;
    if (days > 0) payload.exp = iat + days * DAY;
    const licenseKey = signLicense(payload, (data) => sign(null, data, key));
    return {
      id: payload.id,
      key: licenseKey,
      plan: payload.plan,
      email: payload.email,
      name: payload.name,
      iat,
      exp: payload.exp ?? null,
      gift,
      given: false,
    };
  }

  /** New keys (1–100 at a time). */
  issue(req: IssueRequest): IssuerStatus {
    const key = this.privateKey();
    if (!key) throw new Error(this.status().reason);
    if (!['pro', 'ai', 'proai'].includes(req.plan)) throw new Error('Plan no válido.');
    const count = Math.min(100, Math.max(1, Math.floor(req.count ?? 1)));
    const list = this.read();
    for (let i = 0; i < count; i++) list.push(this.make(key, req, false));
    this.write(list);
    return this.status();
  }

  /** Tops the gift batch up to GIFT_COUNT free Pro + AI keys (no expiry). */
  ensureGifts(): IssuerStatus {
    const key = this.privateKey();
    if (!key) return this.status();
    const list = this.read();
    let have = list.filter((k) => k.gift).length;
    if (have >= GIFT_COUNT) return this.status();
    while (have < GIFT_COUNT) {
      have++;
      list.push(this.make(key, { plan: 'proai' }, true, have));
    }
    this.write(list);
    return this.status();
  }

  /** Marks a key as handed out (or not), with an optional note (who got it). */
  mark(id: string, given: boolean, note?: string): IssuerStatus {
    if (!this.privateKey()) throw new Error(this.status().reason);
    const list = this.read();
    const k = list.find((x) => x.id === id);
    if (!k) throw new Error('No encontré esa clave.');
    k.given = given;
    if (note !== undefined) k.note = note.slice(0, 200);
    this.write(list);
    return this.status();
  }
}
