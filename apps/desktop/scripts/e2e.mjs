// End-to-end check of the built app (E4 of README-ESTUDIO.md) and startup timing.
//
//   node scripts/e2e.mjs                 open the app on a sample project, open a file, check
//                                        that nothing crashed; exit code 1 on any failure
//   node scripts/e2e.mjs --runs 5        also launch it 5 times and print the median startup
//   node scripts/e2e.mjs --shots <dir>   save screenshots there (always saved on failure)
//
// Run `pnpm --filter @omni/desktop build` first. Each launch uses its own empty data folder
// (OMNI_HOME), so it never touches the user's Zinarix nor its single-instance lock.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronPath = require('electron');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const runs = Number(flag('--runs') ?? 0);
const shotsDir = flag('--shots') ?? join(tmpdir(), 'zinarix-e2e-shots');
const READY = '.activity-bar';

if (!existsSync(join(appDir, 'dist/main/main.js')) || !existsSync(join(appDir, 'dist/renderer'))) {
  console.error('The app is not built: run `pnpm --filter @omni/desktop build` first.');
  process.exit(2);
}

function sampleProject() {
  const dir = mkdtempSync(join(tmpdir(), 'zinarix-e2e-project-'));
  writeFileSync(join(dir, 'hola.txt'), 'Hola Zinarix\n');
  writeFileSync(join(dir, 'suma.js'), 'export const suma = (a, b) => a + b;\n');
  return dir;
}

async function launch(project) {
  const home = mkdtempSync(join(tmpdir(), 'zinarix-e2e-home-'));
  const started = Date.now();
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.', project],
    cwd: appDir,
    env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
  });
  const problems = [];
  const mainErr = [];
  app.process().stderr.on('data', (d) => mainErr.push(String(d)));
  const win = await app.firstWindow();
  const windowMs = Date.now() - started;
  win.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  win.on('crash', () => problems.push('the window crashed'));
  await win.waitForSelector(READY, { state: 'visible', timeout: 60_000 });
  const readyMs = Date.now() - started;
  return { app, win, home, problems, mainErr, windowMs, readyMs };
}

/**
 * Closes the window the way a user does (the app then checks unsaved files and quits) and
 * waits for the process to end. Returns false when it had to be killed.
 */
async function close(run) {
  const child = run.app.process();
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  run.app
    .evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.close();
    })
    .catch(() => {});
  const quit = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 15_000)),
  ]);
  if (!quit) child.kill();
  try {
    rmSync(run.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // A helper process may still hold a file for a moment: the folder is in the temp dir.
  }
  return quit;
}

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

async function smoke(project) {
  const run = await launch(project);
  const { win, problems } = run;
  const fail = (msg) => problems.push(msg);
  try {
    // The first run opens the welcome questionnaire over the workbench: skip it.
    // It appears a moment after the workbench, so wait for it before deciding it is not there.
    const welcome = win.locator('.onboarding-backdrop');
    if (
      await welcome.waitFor({ state: 'visible', timeout: 8_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await win
        .getByRole('button', { name: /^(Saltar|Skip)$/ })
        .first()
        .click();
      await welcome.waitFor({ state: 'detached', timeout: 10_000 });
    }
    const row = win.locator('.tree-row', { hasText: 'hola.txt' }).first();
    await row
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => fail('the explorer does not list hola.txt'));
    if (!problems.length) {
      await row.click();
      await win
        .locator('.monaco-editor', { hasText: 'Hola Zinarix' })
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => fail('the editor did not show the file'));
    }
    if (await win.locator('.error-boundary').count()) fail('a panel shows its error boundary');
    const log = join(run.home, 'electron/logs/main.log');
    if (!existsSync(log)) fail('logs/main.log was not written');
    else if (/uncaughtException|unhandledRejection/.test(readFileSync(log, 'utf8')))
      fail('the main process logged an unhandled error');
    if (problems.length || flag('--shots')) {
      mkdirSync(shotsDir, { recursive: true });
      await win.screenshot({ path: join(shotsDir, 'e2e.png') }).catch(() => {});
    }
  } finally {
    if (!(await close(run))) fail('the app did not quit within 15 s and was killed');
  }
  if (problems.length && run.mainErr.length)
    console.error(`main process stderr:\n${run.mainErr.join('').slice(-2000)}`);
  return { problems, windowMs: run.windowMs, readyMs: run.readyMs };
}

const project = sampleProject();
let exit = 0;
try {
  const first = await smoke(project);
  for (const p of first.problems) console.error(`✗ ${p}`);
  if (first.problems.length) {
    console.error(`screenshot: ${join(shotsDir, 'e2e.png')}`);
    exit = 1;
  } else {
    console.log(
      `✓ app opens, lists the project and shows a file (window ${first.windowMs} ms, usable ${first.readyMs} ms)`,
    );
  }
  if (runs > 0 && !exit) {
    const windowMs = [];
    const readyMs = [];
    for (let i = 0; i < runs; i++) {
      const run = await launch(project);
      windowMs.push(run.windowMs);
      readyMs.push(run.readyMs);
      await close(run);
    }
    console.log(
      JSON.stringify({
        runs,
        windowMs: {
          median: median(windowMs),
          min: Math.min(...windowMs),
          max: Math.max(...windowMs),
        },
        readyMs: { median: median(readyMs), min: Math.min(...readyMs), max: Math.max(...readyMs) },
      }),
    );
  }
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  exit = 1;
} finally {
  rmSync(project, { recursive: true, force: true });
}
process.exit(exit);
