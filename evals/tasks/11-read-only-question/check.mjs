import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

assert.ok(existsSync('__answer__.txt'), 'no answer');
const answer = readFileSync('__answer__.txt', 'utf8');
assert.ok(answer.includes('recordEvent'), 'function name');
assert.ok(/src[\\/]infra[\\/]journal\.mjs/.test(answer), 'file path');
