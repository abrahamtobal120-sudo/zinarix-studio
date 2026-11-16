import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

interface Pkg {
  name: string;
  version: string;
  license: string;
  verdict: 'allowed' | 'denied' | 'unknown';
  texts: string[];
  homepage: string;
}
interface NoticesModule {
  packageOfPath(file: string): { name: string; dir: string } | null;
  packageDirs(files: string[]): string[];
  licenseOf(pkg: object): string;
  licenseFromText(text: string): string;
  verdict(expr: string): 'allowed' | 'denied' | 'unknown';
  collect(dirs: string[]): Pkg[];
  problems(pkgs: Pkg[]): string[];
  runtimeDirs(names: string[], from?: string): string[];
  bundledExtras(): { name: string; text: string }[];
  renderMarkdown(pkgs: Pkg[], extras: object[], version: string): string;
  renderJson(
    pkgs: Pkg[],
    extras: object[],
    version: string,
  ): { packages: { name: string; text: number }[]; texts: string[] };
}

let n: NoticesModule;
beforeAll(async () => {
  const url = pathToFileURL(fileURLToPath(new URL('../scripts/notices.mjs', import.meta.url)));
  n = (await import(url.href)) as NoticesModule;
});

/** A fake node_modules package on disk. */
function fakePkg(base: string, pkg: object, files: Record<string, string> = {}): string {
  const name = (pkg as { name: string }).name;
  const dir = join(base, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  return dir;
}

describe('third-party notices (Fase 20)', () => {
  it('finds the package of a bundled file, with pnpm paths, scopes and Vite ids', () => {
    expect(
      n.packageOfPath('/r/node_modules/.pnpm/react@19.3.0/node_modules/react/index.js'),
    ).toEqual({ name: 'react', dir: '/r/node_modules/.pnpm/react@19.3.0/node_modules/react' });
    expect(n.packageOfPath('C:\\r\\node_modules\\@xterm\\xterm\\lib\\xterm.mjs')?.name).toBe(
      '@xterm/xterm',
    );
    expect(n.packageOfPath('\0/r/node_modules/zod/v4/index.js?commonjs-proxy')?.name).toBe('zod');
    // Our own code and workspace packages are not third party.
    expect(n.packageOfPath('/r/apps/desktop/src/main/main.ts')).toBeNull();
    expect(n.packageOfPath('/r/node_modules/@omni/core/src/index.ts')).toBeNull();
    expect(n.packageOfPath('/r/node_modules/.vite/deps/x.js')).toBeNull();
  });

  it('lists each package once', () => {
    expect(
      n.packageDirs([
        '/r/node_modules/react/index.js',
        '/r/node_modules/react/cjs/react.js',
        '/r/src/x.ts',
      ]),
    ).toEqual(['/r/node_modules/react']);
  });

  it('reads every shape of the license field', () => {
    expect(n.licenseOf({ license: 'MIT' })).toBe('MIT');
    expect(n.licenseOf({ license: { type: 'ISC' } })).toBe('ISC');
    expect(n.licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      'MIT OR Apache-2.0',
    );
    expect(n.licenseOf({})).toBe('');
    expect(n.licenseFromText('MIT License\n\nPermission is hereby granted, free of charge')).toBe(
      'MIT',
    );
    expect(n.licenseFromText('GNU LESSER GENERAL PUBLIC LICENSE Version 3')).toBe('LGPL-3.0');
  });

  it('allows permissive licenses and blocks copyleft or unknown ones', () => {
    for (const ok of ['MIT', 'Apache-2.0', '(MIT OR GPL-3.0)', 'BSD-3-Clause AND MIT', 'MPL-2.0'])
      expect(n.verdict(ok), ok).toBe('allowed');
    expect(n.verdict('(MIT OR EUPL-1.1+)')).toBe('allowed');
    for (const bad of ['GPL-3.0-or-later', 'AGPL-3.0', 'LGPL-2.1', 'MIT AND GPL-2.0', 'SSPL-1.0'])
      expect(n.verdict(bad), bad).toBe('denied');
    for (const odd of ['', 'UNLICENSED', 'SEE LICENSE IN LICENSE.md', 'Proprietary'])
      expect(n.verdict(odd), odd).toBe('unknown');
  });

  it('fails the build on a GPL package and explains what to do', () => {
    const base = mkdtempSync(join(tmpdir(), 'notices-'));
    const ok = fakePkg(
      base,
      { name: 'good', version: '1.0.0', license: 'MIT' },
      {
        LICENSE: 'MIT License\nCopyright (c) Good',
      },
    );
    const gpl = fakePkg(base, { name: 'copyleft', version: '2.0.0', license: 'GPL-3.0' });
    const silent = fakePkg(
      base,
      { name: 'silent', version: '0.1.0' },
      {
        'LICENSE.txt': 'Permission is hereby granted, free of charge, to any person',
      },
    );
    const pkgs = n.collect([ok, gpl, silent, ok]);
    expect(pkgs.map((p) => `${p.name}:${p.license}`)).toEqual([
      'copyleft:GPL-3.0',
      'good:MIT',
      'silent:MIT', // from its LICENSE file
    ]);
    const bad = n.problems(pkgs);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/copyleft@2\.0\.0: GPL-3\.0 is copyleft/);
  });

  it('follows the runtime dependencies of unbundled native modules', () => {
    const base = mkdtempSync(join(tmpdir(), 'notices-'));
    fakePkg(base, { name: 'native', version: '1.0.0', license: 'MIT', dependencies: { dep: '1' } });
    fakePkg(base, { name: 'dep', version: '1.0.0', license: 'ISC' });
    writeFileSync(join(base, 'package.json'), '{}');
    const names = n.collect(n.runtimeDirs(['native', 'missing-optional'], base)).map((p) => p.name);
    expect(names).toEqual(['dep', 'native']);
  });

  it('every font, icon set and program has its notice text', () => {
    const extras = n.bundledExtras();
    expect(extras.map((e) => e.name)).toEqual(
      expect.arrayContaining(['Inter', 'Lobe Icons (provider logos)', 'FFmpeg / FFprobe']),
    );
    for (const e of extras) expect(e.text.length, e.name).toBeGreaterThan(40);
    expect(extras.find((e) => e.name === 'Inter')?.text).toMatch(/SIL Open Font License/);
  });

  it('writes each license text once, with the packages that share it', () => {
    const base = mkdtempSync(join(tmpdir(), 'notices-'));
    const same = 'MIT License\nCopyright (c) Same Author';
    const a = fakePkg(base, { name: 'a', version: '1.0.0', license: 'MIT' }, { LICENSE: same });
    const b = fakePkg(base, { name: 'b', version: '1.0.0', license: 'MIT' }, { LICENSE: same });
    const pkgs = n.collect([a, b]);
    const md = n.renderMarkdown(pkgs, [], '9.9.9');
    expect(md).toContain('# Third-party notices — Zinarix Studio 9.9.9');
    expect(md).toContain('| a | 1.0.0 | MIT |');
    expect(md).toContain('### a@1.0.0, b@1.0.0');
    expect(md.split('Copyright (c) Same Author')).toHaveLength(2);
    const json = n.renderJson(pkgs, [], '9.9.9');
    expect(json.texts).toEqual([same]);
    expect(json.packages.map((p) => p.text)).toEqual([0, 0]);
  });
});
