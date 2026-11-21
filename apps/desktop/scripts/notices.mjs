// Third-party notices (Fase 20): which open-source packages ship inside Zinarix Studio, under
// which license, with their full license texts — and a gate that fails the build when a
// package with a copyleft (GPL, AGPL, LGPL…) or unknown license gets into the bundle.
//
// The list comes from what the bundlers actually put in the app, not from package.json:
// - build.mjs passes the esbuild metafiles of main/preload (writeMainPackages),
// - the Vite plugin (noticesPlugin, in vite.config.ts) adds every module of the renderer,
// - plus the `dependencies` of package.json (and theirs): electron-builder copies them into
//   the installer unbundled (the native modules node-pty and keyring, for example).
// Build tools (electron-builder, Vite, vitest…) never appear because they never get bundled.
//
// Output: dist/THIRD_PARTY_NOTICES.md (copied next to the installed app by electron-builder)
// and dist/renderer/third-party-notices.json (Ayuda → Acerca de → Licencias).
//
// CLI: node scripts/notices.mjs --check   re-checks the last build (dist/notices/*.json).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Licenses accepted for npm packages in the bundle (they only ask for this notice). Zinarix is
 * GPL-3.0-or-later, but the bundle stays free of copyleft npm packages on purpose: anything
 * GPL goes in as reviewed source or as a separate program (like FFmpeg or Blender).
 */
export const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'OFL-1.1',
  'Zlib',
  'BlueOak-1.0.0',
  'Python-2.0',
  'WTFPL',
  // File-level copyleft: fine while the files ship unmodified and this notice points to them.
  'MPL-2.0',
]);

/** Copyleft or non-commercial npm packages: never inside the bundle without a review. */
const DENIED = /^(A?GPL|LGPL|SSPL|EUPL|OSL|CPAL|BUSL|CC-BY-NC|CC-BY-SA|Commons-Clause)/i;

/**
 * Packages whose package.json has no usable SPDX license, reviewed by hand.
 * name -> { license, reason }. Keep the reason: it is the audit trail.
 */
export const REVIEWED = {};

/** The `dependencies` of the desktop app: electron-builder ships them as they are. */
const shippedDeps = () =>
  Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {});

/** Our own workspace packages (GPL-3.0-or-later, part of Zinarix): never listed as third party. */
const OWN = /^@omni\//;

const norm = (p) => p.replace(/\\/g, '/');

/**
 * The package a bundled file belongs to: the folder after its last `node_modules/`
 * (pnpm: node_modules/.pnpm/x@1/node_modules/<name>/…). Null for our own sources.
 * Accepts Vite/Rollup module ids too (`\0` prefixes and `?query` suffixes).
 */
export function packageOfPath(file) {
  const p = norm(String(file).replace(/^\0+/, '').replace(/\?.*$/, ''));
  const i = p.lastIndexOf('/node_modules/');
  if (i < 0) return null;
  const rest = p.slice(i + '/node_modules/'.length).split('/');
  const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1] ?? ''}` : rest[0];
  if (!name || name.startsWith('.') || name.endsWith('/') || OWN.test(name)) return null;
  return { name, dir: `${p.slice(0, i)}/node_modules/${name}` };
}

/** Unique package folders of a list of bundled files. */
export function packageDirs(files) {
  const dirs = new Set();
  for (const f of files) {
    const pkg = packageOfPath(f);
    if (pkg) dirs.add(pkg.dir);
  }
  return [...dirs];
}

/** The license of a package.json, as an SPDX expression ('' when it says nothing usable). */
export function licenseOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === 'string') return l.trim();
  if (Array.isArray(l))
    return l
      .map((x) => (typeof x === 'string' ? x : x?.type))
      .filter(Boolean)
      .join(' OR ');
  if (l && typeof l === 'object' && typeof l.type === 'string') return l.type.trim();
  return '';
}

/** Best guess from the text of a LICENSE file, for packages whose package.json is silent. */
export function licenseFromText(text) {
  const s = text.slice(0, 2000);
  if (/GNU (AFFERO |LESSER )?GENERAL PUBLIC LICENSE/i.test(s)) {
    if (/AFFERO/i.test(s)) return 'AGPL-3.0';
    if (/LESSER/i.test(s)) return 'LGPL-3.0';
    return 'GPL-3.0';
  }
  if (/Permission is hereby granted, free of charge/i.test(s)) return 'MIT';
  if (/Apache License,?\s+Version 2\.0/i.test(s)) return 'Apache-2.0';
  if (/Permission to use, copy, modify, and\/or distribute/i.test(s)) return 'ISC';
  if (/Redistribution and use in source and binary forms/i.test(s))
    return /neither the name|endorse or promote/i.test(s) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  return '';
}

const atom = (id) =>
  id
    .replace(/\s+WITH\s+.*$/i, '')
    .replace(/\+$/, '')
    .trim();

/**
 * Whether an SPDX expression may ship in the bundle: 'allowed', 'denied' (copyleft) or
 * 'unknown' (needs a human). `A OR B` is allowed when one side is; `A AND B` needs both.
 */
export function verdict(expr) {
  const e = (expr ?? '').replace(/[()]/g, ' ').trim();
  if (!e || /^(UNLICENSED|SEE LICENSE)/i.test(e)) return 'unknown';
  const alts = e.split(/\s+OR\s+/i).map((alt) =>
    alt.split(/\s+AND\s+/i).map((id) => {
      const a = atom(id);
      if (ALLOWED.has(a)) return 'allowed';
      if (DENIED.test(a)) return 'denied';
      return 'unknown';
    }),
  );
  const each = alts.map((parts) =>
    parts.includes('denied') ? 'denied' : parts.includes('unknown') ? 'unknown' : 'allowed',
  );
  if (each.includes('allowed')) return 'allowed';
  return each.includes('unknown') ? 'unknown' : 'denied';
}

const LICENSE_FILE = /^(LICEN[SC]E|COPYING|NOTICE)(\.|-|$)/i;

/** Reads a package folder: name, version, license, source and its license/notice texts. */
export function describe(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort();
  const texts = files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).filter(Boolean);
  let license = licenseOf(pkg);
  let source = 'package.json';
  if (REVIEWED[pkg.name]) {
    license = REVIEWED[pkg.name].license;
    source = 'reviewed';
  } else if (!license && texts[0]) {
    license = licenseFromText(texts[0]);
    source = 'license file';
  }
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return {
    name: pkg.name,
    version: pkg.version ?? '',
    license: license || 'UNKNOWN',
    licenseSource: source,
    verdict: verdict(license),
    homepage: cleanUrl(pkg.homepage || repo || `https://www.npmjs.com/package/${pkg.name}`),
    texts,
  };
}

function cleanUrl(u) {
  return String(u)
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/^github:/, 'https://github.com/');
}

/** Folders of `names` and of everything they depend on at runtime (for unbundled modules). */
export function runtimeDirs(names, from = root) {
  const out = new Set();
  // Node's lookup (base/node_modules/<name>, then each parent), by hand: `exports` in a
  // package.json can hide `<name>/package.json` from require.resolve.
  const find = (name, base) => {
    for (let d = realpathSync(base); ; d = dirname(d)) {
      const dir = join(d, 'node_modules', name);
      if (existsSync(join(dir, 'package.json'))) return norm(realpathSync(dir));
      if (dirname(d) === d) return null;
    }
  };
  const visit = (name, base) => {
    const dir = find(name, base);
    if (!dir) return; // an optional dependency for another platform
    if (out.has(dir)) return;
    out.add(dir);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const d of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }))
      visit(d, dir);
  };
  for (const n of names) visit(n, from);
  return [...out];
}

/** Packages (described, sorted, one per name@version) of a set of folders. */
export function collect(dirs) {
  const byId = new Map();
  for (const dir of new Set(dirs.map(norm))) {
    if (!existsSync(join(dir, 'package.json'))) continue;
    const d = describe(dir);
    if (OWN.test(d.name)) continue;
    byId.set(`${d.name}@${d.version}`, d);
  }
  return [...byId.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

/** Why the build must stop: copyleft or unreviewed licenses inside the bundle. */
export function problems(pkgs) {
  return pkgs
    .filter((p) => p.verdict !== 'allowed')
    .map((p) =>
      p.verdict === 'denied'
        ? `${p.name}@${p.version}: ${p.license} is copyleft and cannot be bundled. Remove it, replace it, or run it as a separate program (like FFmpeg).`
        : `${p.name}@${p.version}: license "${p.license}" is not recognized. Check it and add it to REVIEWED in scripts/notices.mjs with the reason.`,
    );
}

const MIT_TEXT = (copyright) => `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** Fonts, icons and programs that ship as files, not as npm modules. */
export function bundledExtras() {
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim() : '');
  return [
    {
      name: 'Inter',
      kind: 'font',
      license: 'OFL-1.1',
      homepage: 'https://github.com/rsms/inter',
      text: read(join(root, 'src/renderer/assets/Inter-LICENSE.txt')),
    },
    {
      name: 'Droid Sans Bold (3D text, Fase 14)',
      kind: 'font',
      license: 'Apache-2.0',
      homepage: 'https://github.com/mrdoob/three.js/tree/dev/examples/fonts/droid',
      // Shipped as a three.js typeface JSON (three/examples/fonts/droid); its NOTICE travels with it.
      text: read(join(root, 'node_modules/three/examples/fonts/droid/NOTICE')),
    },
    {
      name: 'Lobe Icons (provider logos)',
      kind: 'icons',
      license: 'MIT',
      homepage: 'https://github.com/lobehub/lobe-icons',
      // Copied into the repo by scripts/sync-provider-logos.mjs; the npm package
      // (@lobehub/icons-static-svg, "license": "MIT", author LobeHub) has no LICENSE file.
      text: MIT_TEXT('Copyright (c) LobeHub <i@lobehub.com>'),
    },
    {
      name: 'FFmpeg / FFprobe',
      kind: 'program',
      license: 'GPL-3.0-or-later',
      homepage: 'https://ffmpeg.org',
      text: 'Separate programs, not linked into Zinarix. License, notice and the source code of each build: resources/ffmpeg/FFMPEG-NOTICE.txt, FFMPEG-SOURCE.txt and COPYING.GPLv3.txt next to the app.',
    },
    {
      name: 'OpenSCAD (WebAssembly)',
      kind: 'program',
      license: 'GPL-2.0-or-later',
      homepage: 'https://openscad.org',
      text: 'A separate program, not linked into Zinarix: the built-in CAD engine (Fase 7), run as its own process when OpenSCAD is not installed. License, notice and source code: resources/openscad/OPENSCAD-NOTICE.txt, OPENSCAD-SOURCE.txt and COPYING.GPLv2.txt next to the app.',
    },
    {
      name: 'Phaser 4 (web game template)',
      kind: 'library',
      license: 'MIT',
      homepage: 'https://phaser.io',
      // Copied into dist/vendor by build.mjs and into the user's project by the "web-phaser" template.
      text: read(join(root, 'node_modules/phaser/LICENSE.md')),
    },
    {
      name: 'ONNX Runtime Web + U²-Net / IS-Net models (background removal)',
      kind: 'program',
      license: 'MIT (ONNX Runtime) + Apache-2.0 (models)',
      homepage: 'https://onnxruntime.ai',
      text: 'A separate program, not linked into Zinarix: removes the background of pictures on this computer (Fase 1B), run as its own process. Licenses and model credits: resources/bgremove/MODELS-NOTICE.txt next to the app.',
    },
    {
      name: 'Electron / Chromium',
      kind: 'program',
      license: 'MIT (Electron) + Chromium licenses',
      homepage: 'https://www.electronjs.org',
      text: 'The runtime of the app. Its licenses ship next to the executable: LICENSE.electron.txt and LICENSES.chromium.html.',
    },
  ];
}

/** THIRD_PARTY_NOTICES.md: summary table, then each license text once. */
export function renderMarkdown(pkgs, extras, version) {
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  const out = [
    `# Third-party notices — Zinarix Studio ${version}`,
    '',
    'Zinarix Studio is licensed under the GNU GPL version 3 or later (LICENSE). It includes the',
    'open-source software',
    'listed below, under the license of each one. This file is generated at build time from',
    'what is actually bundled in the app (scripts/notices.mjs).',
    '',
    '## Fonts, icons and programs',
    '',
    '| Component | License | Source |',
    '|---|---|---|',
    ...extras.map((e) => `| ${cell(e.name)} | ${cell(e.license)} | ${e.homepage} |`),
    '',
    `## npm packages (${pkgs.length})`,
    '',
    '| Package | Version | License | Source |',
    '|---|---|---|---|',
    ...pkgs.map((p) => `| ${cell(p.name)} | ${p.version} | ${cell(p.license)} | ${p.homepage} |`),
    '',
    '## License texts',
    '',
  ];
  for (const e of extras) {
    if (!e.text) continue;
    out.push(`### ${e.name}`, '', '```text', e.text, '```', '');
  }
  // Identical texts (same copyright line too) are printed once, under every package that uses it.
  const groups = new Map();
  for (const p of pkgs) {
    const text =
      p.texts.join('\n\n') || `${p.license} (no license file in the package; see ${p.homepage})`;
    const g = groups.get(text) ?? [];
    g.push(`${p.name}@${p.version}`);
    groups.set(text, g);
  }
  for (const [text, names] of groups) {
    out.push(`### ${names.join(', ')}`, '', '```text', text.replace(/```/g, "'''"), '```', '');
  }
  return out.join('\n');
}

/** The data Ayuda → Licencias shows: each text once, packages point to it by index. */
export function renderJson(pkgs, extras, version) {
  const texts = [];
  const index = new Map();
  const ref = (t) => {
    if (!t) return -1;
    if (!index.has(t)) {
      index.set(t, texts.length);
      texts.push(t);
    }
    return index.get(t);
  };
  return {
    version,
    extras: extras.map((e) => ({ ...e, text: ref(e.text) })),
    packages: pkgs.map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license,
      homepage: p.homepage,
      text: ref(p.texts.join('\n\n')),
    })),
    texts,
  };
}

const noticesDir = join(root, 'dist/notices');
const appVersion = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/** build.mjs: the packages esbuild put in main/preload (from its metafiles). */
export function writeMainPackages(metafiles) {
  const files = metafiles.flatMap((m) => Object.keys(m?.inputs ?? {}).map((f) => resolve(root, f)));
  mkdirSync(noticesDir, { recursive: true });
  const dirs = [...packageDirs(files), ...runtimeDirs(shippedDeps())];
  writeFileSync(join(noticesDir, 'main.json'), JSON.stringify(dirs, null, 1));
}

/** Merges main + renderer, checks the licenses and writes the notices. Throws on a problem. */
export function finish(rendererDirs) {
  mkdirSync(noticesDir, { recursive: true });
  writeFileSync(join(noticesDir, 'renderer.json'), JSON.stringify(rendererDirs, null, 1));
  const mainFile = join(noticesDir, 'main.json');
  const mainDirs = existsSync(mainFile) ? JSON.parse(readFileSync(mainFile, 'utf8')) : [];
  const pkgs = collect([...mainDirs, ...rendererDirs]);
  const bad = problems(pkgs);
  if (bad.length)
    throw new Error(`Third-party licenses (scripts/notices.mjs):\n  ${bad.join('\n  ')}`);
  const extras = bundledExtras();
  const version = appVersion();
  writeFileSync(join(root, 'dist/THIRD_PARTY_NOTICES.md'), renderMarkdown(pkgs, extras, version));
  return { json: JSON.stringify(renderJson(pkgs, extras, version)), count: pkgs.length };
}

/** Vite plugin: collects the renderer's modules and emits third-party-notices.json. */
export function noticesPlugin() {
  return {
    name: 'zinarix-notices',
    apply: 'build',
    generateBundle() {
      const { json, count } = finish(packageDirs([...this.getModuleIds()]));
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.json', source: json });
      process.stdout.write(`third-party notices: ${count} packages, licenses OK\n`);
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const read = (f) =>
    existsSync(join(noticesDir, f)) ? JSON.parse(readFileSync(join(noticesDir, f), 'utf8')) : null;
  const main = read('main.json');
  const renderer = read('renderer.json');
  if (!main || !renderer) {
    console.error('No build to check: run `pnpm --filter @omni/desktop build` first.');
    process.exit(2);
  }
  const pkgs = collect([...main, ...renderer]);
  const bad = problems(pkgs);
  for (const p of pkgs) console.log(`${p.verdict.padEnd(8)} ${p.name}@${p.version}  ${p.license}`);
  if (bad.length) {
    console.error(`\n${bad.join('\n')}`);
    process.exit(1);
  }
  console.log(`\n${pkgs.length} packages, licenses OK.`);
}
