#!/usr/bin/env node
// Validates catalog/providers.json against the Zod schema and prints a status summary.
import { readFileSync } from 'node:fs';
import { Catalog } from '../packages/shared/dist/index.js';

const raw = JSON.parse(readFileSync(new URL('../catalog/providers.json', import.meta.url), 'utf8'));
const res = Catalog.safeParse(raw);
if (!res.success) {
  for (const i of res.error.issues) console.error(`${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
const by = (s) => res.data.providers.filter((p) => p.status === s).map((p) => p.id);
console.log(`OK: ${res.data.providers.length} providers (generated ${res.data.generatedAt})`);
console.log(`active: ${by('active').length}`);
console.log(`unverified: ${by('unverified').join(', ') || '-'}`);
console.log(`deprecated: ${by('deprecated').join(', ') || '-'}`);
