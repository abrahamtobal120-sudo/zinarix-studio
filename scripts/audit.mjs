#!/usr/bin/env node
// Dependency audit for everything that ships inside the app.
//
// `pnpm audit --prod` is not enough here: the desktop app bundles its runtime libraries
// (electron, nodemailer, imapflow, monaco-editor, react, zod…) with esbuild/Vite, so they are
// devDependencies of apps/desktop and --prod skips them. This audits the whole lockfile and
// splits the findings:
//
// - shipped: at least one dependency path does not go through a build-only tool. A high or
//   critical advisory here fails the run (exit 1).
// - build-only: every path goes through a tool that never ends up in an installer (the
//   packager, the bundlers, the test runner, linters, Electron's binary downloader). These
//   are printed as warnings, so a DoS in a download helper does not block every PR.
//
// Usage: node scripts/audit.mjs [--level=high|critical|moderate|low]
import { spawnSync } from 'node:child_process';

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const level = (process.argv.find((a) => a.startsWith('--level=')) ?? '--level=high').slice(8);
if (!LEVELS.includes(level)) {
  console.error(`unknown level ${level} (use one of ${LEVELS.join(', ')})`);
  process.exit(2);
}

// Packages that only run on the developer's or CI's machine. A path through any of them is
// build-only. Keep it short and explicit: anything not listed counts as shipped.
const BUILD_ONLY = new Set([
  'electron-builder', // packager (app-builder-lib, dmg-builder, node-gyp, @electron/rebuild)
  '@electron/get', // downloads the Electron binary at install time
  'vite',
  '@vitejs/plugin-react',
  'esbuild',
  'vitest',
  '@vitest/coverage-v8',
  'ink-testing-library',
  'eslint',
  'eslint-plugin-react-hooks',
  'typescript-eslint',
  'typescript',
  'prettier',
  'turbo',
]);

// A fixed command line (no user input): a shell finds pnpm's .cmd shim on Windows too.
const res = spawnSync('pnpm audit --json', {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  shell: true,
});
let report;
try {
  report = JSON.parse(res.stdout);
} catch {
  console.error('pnpm audit did not return JSON:\n' + (res.stdout || res.stderr || res.error));
  process.exit(2);
}
if (report.error) {
  console.error(`pnpm audit failed: ${report.error.code ?? ''} ${report.error.summary ?? ''}`);
  process.exit(2);
}

const min = LEVELS.indexOf(level);
const buildOnly = (path) => path.split('>').some((name) => BUILD_ONLY.has(name));
const shipped = [];
const tooling = [];
for (const a of Object.values(report.advisories ?? {})) {
  if (LEVELS.indexOf(a.severity) < min) continue;
  const paths = (a.findings ?? []).flatMap((f) => f.paths ?? []);
  const live = paths.filter((p) => !buildOnly(p));
  const line = `${a.severity.padEnd(8)} ${a.module_name} ${a.vulnerable_versions} -> ${a.patched_versions}  ${a.github_advisory_id ?? a.url}\n         ${a.title}\n         via ${(live.length ? live : paths).slice(0, 3).join(', ')}`;
  (live.length ? shipped : tooling).push(line);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `pnpm audit (all dependencies): ${LEVELS.slice(1)
    .map((l) => `${counts[l] ?? 0} ${l}`)
    .join(', ')}`,
);
if (tooling.length) {
  console.log(`\nBuild-only (${level}+, warning, not shipped):`);
  for (const l of tooling) console.log(`  ${l}`);
}
if (shipped.length) {
  console.log(`\nShipped in the app (${level}+):`);
  for (const l of shipped) console.log(`  ${l}`);
  console.error(`\n${shipped.length} ${level}+ advisories affect code that ships in the app.`);
  process.exit(1);
}
console.log(`\nNo ${level}+ advisories in shipped dependencies.`);
