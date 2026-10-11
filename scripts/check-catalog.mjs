#!/usr/bin/env node
// Validates catalog/providers.json against the Zod schema and prints a status summary.
// Also fails on envVars that are not credentials (they belong in envParams) and reports
// cloud models without a price (budgets cannot track them).
import { readFileSync } from 'node:fs';
import { Catalog } from '../packages/shared/dist/index.js';

const raw = JSON.parse(readFileSync(new URL('../catalog/providers.json', import.meta.url), 'utf8'));
const res = Catalog.safeParse(raw);
if (!res.success) {
  for (const i of res.error.issues) console.error(`${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}

// Keep in sync with NON_CREDENTIAL_ENV in packages/core/src/vault.ts.
const NON_CREDENTIAL_ENV =
  /(?:_|^)(?:ENDPOINT|BASE_URL|URL|HOST|ACCOUNT_ID|PROJECT_ID|PROJECT|REGION|LOCATION|DEPLOYMENT|RESOURCE|WORKSPACE(?:_ID|_HOST)?|ORG(?:ANIZATION)?(?:_ID)?|API_VERSION)$/;
const errors = [];
for (const p of res.data.providers) {
  for (const name of p.envVars)
    if (NON_CREDENTIAL_ENV.test(name))
      errors.push(
        `${p.id}: envVars has "${name}", which is not a credential; move it to envParams`,
      );
  for (const name of p.envParams ?? [])
    if (p.envVars.includes(name))
      errors.push(`${p.id}: "${name}" is in both envVars and envParams`);
}
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}

const by = (s) => res.data.providers.filter((p) => p.status === s).map((p) => p.id);
console.log(`OK: ${res.data.providers.length} providers (generated ${res.data.generatedAt})`);
console.log(`active: ${by('active').length}`);
console.log(`unverified: ${by('unverified').join(', ') || '-'}`);
console.log(`deprecated: ${by('deprecated').join(', ') || '-'}`);

// Warning only: many providers publish prices only through their live models endpoint.
const unpriced = res.data.providers
  .filter((p) => p.category !== 'local' && p.status !== 'deprecated')
  .map((p) => [p.id, p.fallbackModels.filter((m) => m.inputPrice == null || m.outputPrice == null)])
  .filter(([, models]) => models.length);
if (unpriced.length) {
  const total = unpriced.reduce((n, [, models]) => n + models.length, 0);
  console.warn(
    `warning: ${total} cloud models without a catalog price (a hardStop budget refuses them unless the live models list or config "prices" has one): ${unpriced.map(([id, m]) => `${id} (${m.length})`).join(', ')}`,
  );
}
