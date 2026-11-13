#!/usr/bin/env node
// Signs website/app-config.json so installed apps trust it (apps/desktop/src/main/remote.ts).
//   node scripts/sign-app-config.mjs        -> writes website/app-config.json.sig
//   node scripts/sign-app-config.mjs verify -> checks the signature
// Uses the same Ed25519 private key as the licenses (~/.omni-signing/license.key, or
// ZINARIX_LICENSE_KEY), under its own prefix so a config signature can never be a license.
// Run it every time you edit app-config.json, and publish both files together: an app that
// finds an unsigned or mismatched file ignores it and keeps the last good one.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'website/app-config.json');
const keyPath = process.env.ZINARIX_LICENSE_KEY ?? join(homedir(), '.omni-signing/license.key');
const DOMAIN = 'zinarix-app-config:v1:';

function appPublicKey() {
  const src = readFileSync(join(root, 'apps/desktop/src/main/license.ts'), 'utf8');
  const pem = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(src)?.[0];
  if (!pem) throw new Error('public key not found in license.ts');
  return createPublicKey(pem);
}

const body = readFileSync(file, 'utf8');
JSON.parse(body); // refuse to sign broken JSON
const data = Buffer.from(DOMAIN + body, 'utf8');

if (process.argv[2] === 'verify') {
  const ok = verify(null, data, appPublicKey(), Buffer.from(readFileSync(`${file}.sig`, 'utf8').trim(), 'base64'));
  console.log(ok ? 'firma OK' : 'firma INVÁLIDA');
  process.exit(ok ? 0 : 1);
}
if (!existsSync(keyPath)) {
  console.error(`missing private key: ${keyPath}\nSet ZINARIX_LICENSE_KEY to license-private.pem.`);
  process.exit(1);
}
const key = createPrivateKey(readFileSync(keyPath));
const mine = createPublicKey(key).export({ type: 'spki', format: 'der' });
if (!mine.equals(appPublicKey().export({ type: 'spki', format: 'der' }))) {
  console.error('this private key does not match the public key inside the app');
  process.exit(1);
}
writeFileSync(`${file}.sig`, sign(null, data, key).toString('base64') + '\n');
console.log(`signed ${file}`);
