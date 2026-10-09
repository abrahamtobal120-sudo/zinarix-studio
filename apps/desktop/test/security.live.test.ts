/* eslint-disable no-console */
// Live checks against real services: OMNI_LIVE_TESTS=1 pnpm vitest run apps/desktop/test/security.live.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditDependencies, checkSite, checkSystem } from '../src/main/security.js';
import { Workspace } from '../src/main/workspace.js';

describe.skipIf(!process.env.OMNI_LIVE_TESTS)('security (live)', () => {
  it('finds known vulnerabilities in old dependencies (osv.dev)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zs-osv-'));
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({ packages: { '': {}, 'node_modules/lodash': { version: '4.17.15' } } }),
    );
    const text = await auditDependencies(new Workspace(dir), new AbortController().signal);
    console.log(text.slice(0, 1500));
    expect(text).toMatch(/lodash@4\.17\.15/);
  }, 60_000);

  it('reviews this computer', async () => {
    const text = await checkSystem();
    console.log(text.slice(0, 3000));
    expect(text).toMatch(/Resumen:/);
  }, 60_000);

  it('reviews a website', async () => {
    const text = await checkSite('https://zinarix-studio.vercel.app', new AbortController().signal);
    console.log(text);
    expect(text).toMatch(/Certificado: válido/);
  }, 60_000);
});
