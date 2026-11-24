#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => a !== '--json');
if (!file) {
  console.error('usage: cli.mjs [--json] <file>');
  process.exit(1);
}
let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error('error: cannot read ' + file);
  process.exit(2);
}
const words = text.split(/\s+/).filter(Boolean).length;
const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
if (json) console.log(JSON.stringify({ file, words, lines }));
else console.log('words: ' + words);
