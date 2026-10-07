#!/usr/bin/env node
// Catalog signing (Ed25519).
//   node scripts/sign-catalog.mjs keygen            -> new keypair; private key OUTSIDE the repo
//   node scripts/sign-catalog.mjs sign [file]       -> writes <file>.sig (base64 detached signature)
//   node scripts/sign-catalog.mjs verify [file]     -> checks <file>.sig against catalog/keys/catalog.pub
// The private key path defaults to ~/.omni-signing/catalog.key (override: OMNI_CATALOG_SIGNING_KEY).
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pubPath = join(root, 'catalog/keys/catalog.pub');
const keyPath =
  process.env.OMNI_CATALOG_SIGNING_KEY ?? join(homedir(), '.omni-signing/catalog.key');
const [cmd, fileArg] = process.argv.slice(2);
const file = fileArg ?? join(root, 'catalog/providers.json');

if (cmd === 'keygen') {
  if (existsSync(keyPath)) {
    console.error(`refusing to overwrite ${keyPath}`);
    process.exit(1);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`private key: ${keyPath}\npublic key:  ${pubPath}`);
} else if (cmd === 'sign') {
  const sig = sign(null, readFileSync(file), createPrivateKey(readFileSync(keyPath)));
  writeFileSync(`${file}.sig`, sig.toString('base64') + '\n');
  console.log(`signed ${file}`);
} else if (cmd === 'verify') {
  const ok = verify(
    null,
    readFileSync(file),
    createPublicKey(readFileSync(pubPath)),
    Buffer.from(readFileSync(`${file}.sig`, 'utf8').trim(), 'base64'),
  );
  console.log(ok ? 'signature OK' : 'signature INVALID');
  process.exit(ok ? 0 : 1);
} else {
  console.error('usage: sign-catalog.mjs keygen | sign [file] | verify [file]');
  process.exit(2);
}
