import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatReport, formatRow } from './src/report.mjs';

assert.equal(formatRow('Ana', 3.5), 'Ana'.padEnd(20) + '      3.50');
const out = formatReport([
  { name: 'Ana', amount: 3.5 },
  { name: 'Luis', amount: 10 },
]).split('\n');
assert.equal(out[0], 'Name'.padEnd(20) + '    Amount');
assert.equal(out[3], 'Total'.padEnd(20) + '     13.50');
const text = readFileSync('src/report.mjs', 'utf8');
assert.ok(text.includes('\r\n'), 'CRLF lost');
assert.ok(!/[^\r]\n/.test(text), 'mixed line endings');
assert.ok(!/^ +\S/m.test(text), 'tabs replaced by spaces');
assert.ok(/^\t\S/m.test(text), 'tabs lost');
