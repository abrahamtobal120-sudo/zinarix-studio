#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: cli.mjs <file>');
  process.exit(1);
}
const text = readFileSync(file, 'utf8');
const words = text.split(/\s+/).filter(Boolean).length;
console.log('words: ' + words);
