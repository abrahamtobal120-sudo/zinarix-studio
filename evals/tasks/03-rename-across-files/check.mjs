import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as api from './src/index.mjs';

assert.equal(typeof api.getUser, 'function');
assert.equal(api.getUsr, undefined);
assert.equal(api.getUser(1).name, 'Ada');
assert.equal(api.getUser(99), null);
assert.equal(api.greet(2), 'Hello, Linus!');
assert.equal(api.greet(99), 'Hello, stranger!');
assert.equal(api.isAdmin(1), true);
assert.equal(api.isAdmin(3), false);
for (const dir of ['src', 'docs'])
  for (const name of readdirSync(dir))
    assert.ok(!readFileSync(join(dir, name), 'utf8').includes('getUsr'), dir + '/' + name);
