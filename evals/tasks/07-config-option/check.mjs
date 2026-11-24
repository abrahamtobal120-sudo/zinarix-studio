import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { loadConfig } from './src/config.mjs';

const real = loadConfig();
assert.equal(real.timeoutMs, 8000);
assert.equal(real.port, 8080);
assert.equal(real.host, '0.0.0.0');

const withCfg = (obj) => {
  writeFileSync('__cfg.json', JSON.stringify(obj));
  return loadConfig('__cfg.json');
};
assert.equal(withCfg({}).timeoutMs, 5000);
assert.equal(withCfg({}).port, 3000);
assert.equal(withCfg({ timeoutMs: 250 }).timeoutMs, 250);
for (const bad of [0, -1, 1.5, '100', null])
  assert.throws(() => withCfg({ timeoutMs: bad }), /timeoutMs/, String(bad));
assert.throws(() => withCfg({ port: 0 }), /port/);
