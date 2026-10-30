#!/usr/bin/env node
// Zinarix Studio Pro licenses (Ed25519), for the seller only.
//   node scripts/license.mjs issue <email> [--name "Nombre"] [--days 365]  -> prints a key
//   node scripts/license.mjs verify <key>                                  -> what a key grants
//   node scripts/license.mjs pubkey                                        -> public key of the private key
// The private key is NEVER in the repo: ~/.omni-signing/license.key by default
// (override: ZINARIX_LICENSE_KEY=/path/to/license-private.pem).
import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = process.env.ZINARIX_LICENSE_KEY ?? join(homedir(), '.omni-signing/license.key');
const [cmd, arg, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

/** The public key compiled into the app (apps/desktop/src/main/license.ts). */
function appPublicKey() {
  const src = readFileSync(join(root, 'apps/desktop/src/main/license.ts'), 'utf8');
  const pem = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(src)?.[0];
  if (!pem) throw new Error('public key not found in license.ts');
  return createPublicKey(pem);
}

function loadPrivate() {
  if (!existsSync(keyPath)) {
    console.error(
      `missing private key: ${keyPath}\nSet ZINARIX_LICENSE_KEY to license-private.pem.`,
    );
    process.exit(1);
  }
  const key = createPrivateKey(readFileSync(keyPath));
  const mine = createPublicKey(key).export({ type: 'spki', format: 'der' });
  if (!mine.equals(appPublicKey().export({ type: 'spki', format: 'der' }))) {
    console.error('this private key does not match the public key inside the app');
    process.exit(1);
  }
  return key;
}

if (cmd === 'issue') {
  if (!arg || !arg.includes('@')) {
    console.error('usage: license.mjs issue <email> [--name "Nombre"] [--days 365]');
    process.exit(2);
  }
  const key = loadPrivate();
  const iat = Date.now();
  const days = Number(opt('days') ?? 0);
  const payload = { v: 1, id: `manual-${randomUUID()}`, plan: 'pro', email: arg };
  if (opt('name')) payload.name = opt('name');
  payload.iat = iat;
  if (days > 0) payload.exp = iat + days * 86_400_000;
  const body = `ZX1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  console.log(`${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`);
} else if (cmd === 'verify') {
  const m = /^ZX1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec((arg ?? '').replace(/\s+/g, ''));
  if (!m) {
    console.error('not a Zinarix Studio key');
    process.exit(1);
  }
  const ok = verify(
    null,
    Buffer.from(`ZX1.${m[1]}`),
    appPublicKey(),
    Buffer.from(m[2], 'base64url'),
  );
  const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  console.log(ok ? 'firma OK' : 'firma INVÁLIDA', p);
  process.exit(ok ? 0 : 1);
} else if (cmd === 'pubkey') {
  console.log(createPublicKey(loadPrivate()).export({ type: 'spki', format: 'pem' }));
} else {
  console.error('usage: license.mjs issue <email> | verify <key> | pubkey');
  process.exit(2);
}
