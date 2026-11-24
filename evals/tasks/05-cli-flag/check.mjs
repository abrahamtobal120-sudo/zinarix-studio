import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

writeFileSync('__sample.txt', 'a b c\nd e\n');
writeFileSync('__empty.txt', '');
const run = (...args) =>
  spawnSync(process.execPath, ['src/cli.mjs', ...args], { encoding: 'utf8' });

let r = run('__sample.txt');
assert.equal(r.status, 0);
assert.equal(r.stdout.trim(), 'words: 5');

for (const args of [
  ['--json', '__sample.txt'],
  ['__sample.txt', '--json'],
]) {
  r = run(...args);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { file: '__sample.txt', words: 5, lines: 2 });
  assert.equal(r.stdout.trim().split('\n').length, 1);
}
r = run('--json', '__empty.txt');
assert.deepEqual(JSON.parse(r.stdout), { file: '__empty.txt', words: 0, lines: 0 });

r = run('__missing.txt');
assert.equal(r.status, 2);
assert.ok(r.stderr.startsWith('error:'), r.stderr);
assert.ok(!/\n\s+at /.test(r.stderr), 'stack trace');
