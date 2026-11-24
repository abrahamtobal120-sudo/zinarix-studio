import assert from 'node:assert/strict';
import { compare, sort } from './src/semver.mjs';

assert.equal(compare('1.10.0', '1.9.0'), 1);
assert.equal(compare('1.9.0', '1.10.0'), -1);
assert.equal(compare('10.0.0', '9.9.9'), 1);
assert.equal(compare('1.2.3', '1.2.3'), 0);
assert.equal(compare('1.0.0-beta', '1.0.0'), -1);
assert.equal(compare('1.0.0', '1.0.0-rc'), 1);
assert.equal(compare('1.0.0-alpha', '1.0.0-beta'), -1);
assert.equal(compare('1.0.0-beta', '1.0.0-beta'), 0);
assert.equal(compare('1.0.1-alpha', '1.0.0'), 1);
assert.deepEqual(sort(['1.10.0', '1.0.0', '1.2.0', '1.0.0-beta', '1.9.3']), [
  '1.0.0-beta',
  '1.0.0',
  '1.2.0',
  '1.9.3',
  '1.10.0',
]);
