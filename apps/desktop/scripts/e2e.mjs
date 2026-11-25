// End-to-end check of the built app (E4 of README-ESTUDIO.md) and startup timing.
//
//   node scripts/e2e.mjs                 open the app on a sample project, open a file, check
//                                        that nothing crashed; exit code 1 on any failure
//   node scripts/e2e.mjs --runs 5        also launch it 5 times and print the median startup
//   node scripts/e2e.mjs --shots <dir>   save screenshots there (always saved on failure)
//
// Run `pnpm --filter @omni/desktop build` first. Each launch uses its own empty data folder
// (OMNI_HOME), so it never touches the user's Zinarix nor its single-instance lock.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

// C4: the text of revisar.txt and what the (faked) model answers for it: one changed line,
// one added line and one removed line, so the review in the editor has three blocks.
const REVIEW_BEFORE = 'uno\ndos\ntres\ncuatro\ncinco';
const REVIEW_ANSWER = 'uno\nDOS\ntres\nnuevo\ncuatro';
/** After rejecting the first block, accepting the second and rejecting the rest. */
const REVIEW_AFTER = 'uno\ndos\ntres\nnuevo\ncuatro\ncinco';

/** Run the application-menu item with this accelerator (synthetic keys do not reach the menu). */
function menuKey(run, accelerator) {
  return run.app.evaluate(({ Menu, BrowserWindow }, wanted) => {
    const find = (items) => {
      for (const item of items) {
        if (item.accelerator === wanted) return item;
        const inner = item.submenu && find(item.submenu.items);
        if (inner) return inner;
      }
      return null;
    };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item) throw new Error(`no menu item with ${wanted}`);
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined);
  }, accelerator);
}

/** C4: Ctrl+K on a file, with the model replaced by a fixed answer; the review is real. */
async function reviewInEditor(run, project, fail) {
  const { win } = run;
  await run.app.evaluate(({ ipcMain }, answer) => {
    ipcMain.removeHandler('ai:edit');
    ipcMain.handle('ai:edit', (e, requestId) => {
      const send = (event) => e.sender.send('omni:event', { type: 'chat', requestId, event });
      setTimeout(() => {
        send({ type: 'text', delta: answer });
        send({ type: 'cost', usd: 0, inputTokens: 0, outputTokens: 0 });
      }, 50);
    });
  }, REVIEW_ANSWER);
  await win.locator('.tree-row', { hasText: 'revisar.txt' }).first().click();
  const editor = win.locator('.monaco-editor', { hasText: 'cuatro' }).first();
  await editor.waitFor({ state: 'visible', timeout: 20_000 });
  await editor.locator('.view-line').first().click();
  await win.keyboard.press('Control+A');
  await menuKey(run, 'CmdOrCtrl+K');
  const ask = win.locator('.ai-edit input');
  await ask.waitFor({ state: 'visible', timeout: 10_000 });
  await ask.fill('prueba');
  await ask.press('Enter');
  const bar = win.locator('.zx-rv-bar');
  await bar.waitFor({ state: 'visible', timeout: 10_000 });
  const blocks = () => win.locator('.zx-rv-actions').count();
  if ((await blocks()) !== 3) return fail(`the AI review shows ${await blocks()} blocks, not 3`);
  if ((await win.locator('.zx-rv-zone .zx-rv-old').count()) !== 2)
    fail('the AI review does not show the two replaced lines');
  if (flag('--shots')) {
    mkdirSync(shotsDir, { recursive: true });
    await win.screenshot({ path: join(shotsDir, 'e2e-review.png') }).catch(() => {});
  }
  // Mouse on the first block, keyboard on the second, "reject all" for what is left.
  await win.locator('.zx-rv-actions .zx-rv-no').first().click();
  if ((await blocks()) !== 2) return fail('rejecting a block with the mouse did not close it');
  await win.keyboard.press('Alt+Y');
  if ((await blocks()) !== 1) return fail('Alt+Y did not accept the block under the cursor');
  await bar.locator('.zx-rv-no').click();
  await bar.waitFor({ state: 'detached', timeout: 5_000 });
  await menuKey(run, 'CmdOrCtrl+S');
  const file = join(project, 'revisar.txt');
  const deadline = Date.now() + 5_000;
  while (readFileSync(file, 'utf8') === REVIEW_BEFORE && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 100));
  const got = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (got !== REVIEW_AFTER) fail(`after the AI review the file is ${JSON.stringify(got)}`);
}

/** B1: the same file in two editors side by side; the side one edits and saves it. */
async function splitEditor(run, project, fail) {
  const { win } = run;
  await win.getByRole('button', { name: /^(Dividir el editor|Split editor)/ }).click();
  const side = win.locator('.editor-side');
  await side.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 10_000 });
  const box = await side.boundingBox();
  const main = await win.locator('.editor-split > .editor-host').boundingBox();
  if (!box || !main || box.width < 200 || main.width < 200 || box.height < 100)
    return fail(`the split editors have no room: ${JSON.stringify({ box, main })}`);
  await side.locator('.view-line').first().click();
  await win.keyboard.press('Control+Home');
  await win.keyboard.type('LADO ');
  // One document, two views: the main editor shows what was typed in the side one.
  await win
    .locator('.editor-split > .editor-host .view-line', { hasText: 'LADO' })
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('text typed in the side editor did not reach the main one'));
  if (flag('--shots')) {
    mkdirSync(shotsDir, { recursive: true });
    await win.screenshot({ path: join(shotsDir, 'e2e-split.png') }).catch(() => {});
  }
  // Another file in the main group: the side group keeps its own, and save acts on it.
  await win.locator('.tree-row', { hasText: 'hola.txt' }).first().click();
  await win
    .locator('.editor-split > .editor-host .view-line', { hasText: 'Hola Zinarix' })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('the main group did not change file while split'));
  if (!(await side.locator('.view-line', { hasText: 'LADO' }).count()))
    fail('the side group lost its file when the main one changed');
  await side.locator('.view-line').first().click();
  await menuKey(run, 'CmdOrCtrl+S');
  const file = join(project, 'revisar.txt');
  const deadline = Date.now() + 5_000;
  while (!readFileSync(file, 'utf8').startsWith('LADO ') && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 100));
  if (!readFileSync(file, 'utf8').startsWith('LADO '))
    fail('saving from the side editor did not write its file');
  // The divider drags: the main group goes to about 30 % of the row.
  const row = await win.locator('.editor-split').boundingBox();
  const handle = await side.locator('.editor-split-handle').boundingBox();
  if (!row || !handle) return fail('the split editor has no divider');
  const mainWidth = async () =>
    (await win.locator('.editor-split > .editor-host').boundingBox())?.width ?? 0;
  await win.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await win.mouse.down();
  await win.mouse.move(row.x + row.width * 0.4, row.y + row.height / 2, { steps: 4 });
  await win.mouse.move(row.x + row.width * 0.3, row.y + row.height / 2, { steps: 4 });
  await win.mouse.up();
  const dragged = await mainWidth();
  if (Math.abs(dragged - row.width * 0.3) > 24)
    fail(`dragging the divider gave ${Math.round(dragged)} px of ${Math.round(row.width)}`);
  // After a reload (like reopening Zinarix) the side group is back, with its file and width.
  await win.reload();
  await side.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 20_000 });
  await side
    .locator('.view-line', { hasText: 'LADO' })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('the side group did not come back with its file after a reload'));
  const again = await mainWidth();
  if (Math.abs(again - dragged) > 4)
    fail(`the divider moved after a reload: ${Math.round(dragged)} → ${Math.round(again)} px`);
  await side.locator('.editor-split-handle').dblclick();
  const half = await mainWidth();
  if (Math.abs(half - row.width / 2) > 24)
    fail(`double click on the divider gave ${Math.round(half)} px of ${Math.round(row.width)}`);
  await side.locator('.view-line').first().click();
  // Ctrl+W there closes the side file only; it was the last one, so the group goes away.
  await menuKey(run, 'CmdOrCtrl+W');
  await side
    .waitFor({ state: 'detached', timeout: 5_000 })
    .catch(() => fail('the side group did not close'));
  if ((await win.locator('.tabs .tab').count()) < 2) fail('closing the side file closed main tabs');
}

const GIT_BASE = [
  'export class Caja {',
  '  abrir(): string {',
  "    return 'abierta';",
  '  }',
  '  peso = 1;',
  "  color = 'rojo';",
  '  tapa = true;',
  '}',
  '',
].join('\n');
// Line 3 changed, line 6 added, the "tapa" line removed.
const GIT_NOW = [
  'export class Caja {',
  '  abrir(): string {',
  "    return 'ABIERTA';",
  '  }',
  '  peso = 1;',
  '  alto = 2;',
  "  color = 'rojo';",
  '}',
  '',
].join('\n');
let hasGit = false;

/**
 * B7: the outline under the explorer lists the symbols of the file, follows the cursor, goes to
 * a symbol on click, filters and collapses. Leaves the cursor on the changed line again.
 */
async function outline(win, editor, fail) {
  const toggle = win.locator('.outline .outline-toggle');
  if (!(await toggle.count())) return fail('the explorer has no outline section');
  if (await win.locator('.outline .outline-row').count())
    fail('the outline is open before anyone asked for it');
  await toggle.click();
  const rows = win.locator('.outline .outline-row');
  await rows
    .filter({ hasText: 'abrir' })
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => fail('the outline does not list the symbols of the file'));
  const names = async () => (await rows.locator('.tree-label').allTextContents()).join(',');
  if ((await names()) !== 'Caja,abrir,peso,alto,color')
    fail(`the outline lists "${await names()}", not the symbols of the file in order`);
  const current = win.locator('.outline .outline-row.selected .tree-label');
  if ((await current.textContent().catch(() => '')) !== 'abrir')
    fail('the outline does not mark the symbol around the cursor');
  // A click goes there: the cursor lands on the field and the outline follows.
  await rows.filter({ hasText: 'color' }).click();
  await win
    .locator('.outline .outline-row.selected', { hasText: 'color' })
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('a click on an outline row did not move the cursor to that symbol'));
  await win
    .locator('.breadcrumbs .crumb-symbols', { hasText: 'color' })
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('the editor cursor is not on the symbol clicked in the outline'));
  // Filter: the match and its parent only.
  const filter = win.locator('.outline .outline-filter');
  await filter.fill('PES');
  await win.waitForTimeout(150);
  if ((await names()) !== 'Caja,peso') fail(`the outline filter "PES" shows "${await names()}"`);
  await filter.fill('');
  // Collapse all: only the class is left; again: everything is back.
  const action = win.locator('.outline .outline-action');
  await action.click();
  await win.waitForTimeout(150);
  if ((await names()) !== 'Caja') fail(`"collapse all" left "${await names()}" in the outline`);
  await action.click();
  await win.waitForTimeout(150);
  if ((await rows.count()) !== 5) fail('"expand all" did not bring the outline rows back');
  if (flag('--shots')) {
    mkdirSync(shotsDir, { recursive: true });
    await win.screenshot({ path: join(shotsDir, 'e2e-outline.png') }).catch(() => {});
  }
  await toggle.click();
  if (await rows.count()) fail('the outline did not close');
  await editor.locator('.view-line', { hasText: 'ABIERTA' }).first().click();
}

/** B7: git marks beside the line numbers, the symbols in the breadcrumbs, and reverting a change. */
async function gitMarks(run, project, fail) {
  const { win } = run;
  await win.locator('.tree-row', { hasText: 'marcas.ts' }).first().click();
  const editor = win.locator('.editor-split > .editor-host');
  await editor
    .locator('.view-line', { hasText: 'ABIERTA' })
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  if (hasGit) {
    for (const cls of ['zx-git-mod', 'zx-git-add', 'zx-git-del'])
      await editor
        .locator(`.${cls}`)
        .first()
        .waitFor({ state: 'attached', timeout: 10_000 })
        .catch(() => fail(`the editor shows no ${cls} mark for the change since git`));
  }
  // The cursor inside the method: the breadcrumbs name the class and the method.
  await editor.locator('.view-line', { hasText: 'ABIERTA' }).first().click();
  const crumbs = win.locator('.breadcrumbs .crumb-symbols');
  await crumbs
    .filter({ hasText: 'abrir' })
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => fail('the breadcrumbs do not show the symbol around the cursor'));
  if (!(await crumbs.filter({ hasText: 'Caja' }).count()))
    fail('the breadcrumbs do not show the class around the method');
  await outline(win, editor, fail);
  if (flag('--shots')) {
    mkdirSync(shotsDir, { recursive: true });
    await win.screenshot({ path: join(shotsDir, 'e2e-git-marks.png') }).catch(() => {});
  }
  if (hasGit) {
    // Revert the changed line from the editor's own command list (F1).
    await win.keyboard.press('F1');
    await win.keyboard.type('git');
    const item = win
      .locator('.quick-input-list .monaco-list-row', {
        hasText: /Deshacer este cambio|Revert this change/,
      })
      .first();
    await item.waitFor({ state: 'visible', timeout: 5_000 });
    await item.click();
    await editor
      .locator('.view-line', { hasText: "'abierta'" })
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => fail('reverting a change did not bring the git version of the line back'));
    await editor
      .locator('.zx-git-mod')
      .first()
      .waitFor({ state: 'detached', timeout: 5_000 })
      .catch(() => fail('the modified mark stayed after reverting the change'));
    // Save it: the file on disk has the git version of that line again (and nothing is left
    // unsaved, which would make the app ask before quitting).
    await menuKey(run, 'CmdOrCtrl+S');
    const file = join(project, 'marcas.ts');
    const deadline = Date.now() + 5_000;
    while (!readFileSync(file, 'utf8').includes("'abierta'") && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    if (!readFileSync(file, 'utf8').includes("'abierta'"))
      fail('the reverted change was not saved to disk');
  }
  // The symbols list of the file opens from the breadcrumbs.
  await crumbs.click();
  await win
    .locator('.palette, [role="dialog"]')
    .filter({ hasText: 'abrir' })
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('the breadcrumbs did not open the symbols of the file'));
  await win.keyboard.press('Escape');
}

/** How many files the big folder of the sample project has (C5: the tree is windowed). */
const MANY = 3000;

/**
 * C5: a folder with thousands of files mounts only the rows on screen, scrolling shows the
 * rest, and the keyboard still reaches rows that were not in the DOM.
 */
/** B5: the search box of Settings finds a setting of another section and scrolls to its row. */
async function settingsSearch(run, fail) {
  const { win } = run;
  await menuKey(run, 'CmdOrCtrl+,').catch(() => win.keyboard.press('Control+,'));
  const box = win.locator('.settings-search');
  await box.waitFor({ state: 'visible', timeout: 10_000 });
  // Typed without the accent and in lower case; the row lives in "Editor", not the open section.
  await box.fill('ajuste de linea');
  const first = win.locator('.settings-hits button').first();
  await first
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('the settings search found nothing'));
  if (!/Ajuste de l|Word wrap/.test((await first.textContent().catch(() => '')) ?? ''))
    fail('the settings search did not rank the word wrap setting first');
  await box.press('Enter');
  await win
    .locator('.settings-toggle.settings-hit')
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('the settings search did not reveal the row of the setting'));
  await box.fill('zzzz-nada');
  if (await win.locator('.settings-hits button').count())
    fail('the settings search matched a word no setting has');
  if (flag('--shots')) {
    await box.fill('guardar');
    mkdirSync(shotsDir, { recursive: true });
    await win.screenshot({ path: join(shotsDir, 'e2e-settings.png') }).catch(() => {});
  }
  await win.locator('.settings .modal-x').click();
  await win.locator('.settings').waitFor({ state: 'detached', timeout: 5_000 });
}

async function bigFolder(win, fail) {
  const rows = () => win.locator('.tree-row').count();
  const focusedPath = () => win.evaluate(() => document.activeElement?.getAttribute('data-path'));
  const folder = win.locator('.tree-row[data-path="muchos"]');
  await folder.click();
  await win
    .locator('.tree-row[data-path="muchos/f0000.txt"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => fail('the big folder did not open'));
  const mounted = await rows();
  if (mounted > 200) fail(`the explorer mounted ${mounted} rows of a ${MANY}-file folder`);
  const height = await win.evaluate(() => document.querySelector('.tree')?.scrollHeight ?? 0);
  if (height < MANY * 24) fail(`the tree is ${height}px tall: its scrollbar does not cover it`);
  // Scrolled to the end of the folder: its last file is mounted, and the first one is gone.
  await win.evaluate((n) => {
    const tree = document.querySelector('.tree');
    if (tree) tree.scrollTop = (n - 3) * 24;
  }, MANY);
  await win
    .locator(`.tree-row[data-path="muchos/f${MANY - 1}.txt"]`)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('scrolling the explorer did not show the last file of the folder'));
  if ((await rows()) > 200) fail('the explorer kept the rows it scrolled past');
  // Keyboard: Home goes back to the first row (not mounted now), End to the very last one.
  await win.locator(`.tree-row[data-path="muchos/f${MANY - 1}.txt"]`).focus();
  await win.keyboard.press('Home');
  await win
    .waitForFunction(() => document.activeElement?.getAttribute('data-path') === 'muchos', {
      timeout: 5_000,
    })
    .catch(async () => fail(`Home focused ${await focusedPath()} instead of the first row`));
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('ArrowDown');
  if ((await focusedPath()) !== 'muchos/f0001.txt')
    fail(`arrow keys focused ${await focusedPath()} instead of muchos/f0001.txt`);
  await win.keyboard.press('End');
  await win
    .waitForFunction(
      () => {
        const el = document.activeElement;
        const tree = document.querySelector('.tree');
        if (!el?.classList.contains('tree-row') || !tree) return false;
        const r = el.getBoundingClientRect();
        const box = tree.getBoundingClientRect();
        return !el.nextElementSibling && r.top >= box.top && r.bottom <= box.bottom + 1;
      },
      { timeout: 5_000 },
    )
    .catch(async () => fail(`End did not focus the last row in view (${await focusedPath()})`));
  // Closed again: the rest of the test works on a short tree.
  await win.keyboard.press('Home');
  await win.waitForFunction(() => document.activeElement?.getAttribute('data-path') === 'muchos');
  await win.keyboard.press('ArrowLeft');
  await win
    .locator('.tree-row[data-path="muchos/f0000.txt"]')
    .waitFor({ state: 'detached', timeout: 5_000 })
    .catch(() => fail('the big folder did not close'));
}

function sampleProject() {
  const dir = mkdtempSync(join(tmpdir(), 'zinarix-e2e-project-'));
  mkdirSync(join(dir, 'muchos'));
  for (let i = 0; i < MANY; i++)
    writeFileSync(join(dir, 'muchos', `f${String(i).padStart(4, '0')}.txt`), '');
  writeFileSync(join(dir, 'hola.txt'), 'Hola Zinarix\n');
  writeFileSync(join(dir, 'suma.js'), 'export const suma = (a, b) => a + b;\n');
  writeFileSync(join(dir, 'revisar.txt'), REVIEW_BEFORE);
  writeFileSync(join(dir, 'fragmento.txt'), '');
  // B7: one file committed to git and then changed on disk (a changed, an added and a
  // removed line), so the editor has git marks to show. Without git the check is skipped.
  writeFileSync(join(dir, 'marcas.ts'), GIT_BASE);
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('add', 'marcas.ts');
    git(
      '-c',
      'user.name=e2e',
      '-c',
      'user.email=e2e@example.invalid',
      'commit',
      '-q',
      '-m',
      'base',
    );
    writeFileSync(join(dir, 'marcas.ts'), GIT_NOW);
    hasGit = true;
  } catch {
    hasGit = false;
  }
  // One triangle: enough for the 3D model viewer (a chunk loaded on demand, with three.js).
  writeFileSync(
    join(dir, 'pieza.stl'),
    'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t\n',
  );
  return dir;
}

/** Messages of the long conversation saved before the app starts (C5: the chat is windowed). */
const LONG_CHAT = 300;

/** Writes a long conversation into the history of a data folder the app has not opened yet. */
async function seedLongChat(home) {
  const { History, openDb } = await import('@omni/core');
  const db = openDb(join(home, 'omni.db'));
  const history = new History(db);
  const conv = history.create('Chat largo de prueba');
  for (let i = 0; i < LONG_CHAT; i++)
    history.append(conv.id, {
      role: i % 2 ? 'assistant' : 'user',
      content: `mensaje ${i}

Un párrafo para que cada turno ocupe algo de alto en la lista.`,
    });
  db.close();
}

/**
 * C5: a long conversation mounts its last turns only, and scrolling up brings the earlier ones
 * back without moving what is on screen.
 */
async function longChat(win, fail) {
  const chat = win.locator('.chat-session:visible');
  await win
    .locator(
      '.chat-tabs-bar button[title="Historial de chats"], .chat-tabs-bar button[title="Chat history"]',
    )
    .first()
    .click();
  // The history opens on the chats of this folder; the seeded one belongs to none.
  await win
    .getByRole('button', { name: /^(Todos|All)$/ })
    .first()
    .click();
  await win.locator('.ch-item', { hasText: 'Chat largo de prueba' }).first().click();
  const last = chat.locator('.turn', { hasText: `mensaje ${LONG_CHAT - 1}` }).first();
  await last
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => fail('the long conversation did not open at its last message'));
  const turns = () => chat.locator('.chat-scroll .turn').count();
  const mounted = await turns();
  if (mounted === 0 || mounted > 100)
    fail(`the chat mounted ${mounted} turns of a ${LONG_CHAT}-message conversation`);
  if (!(await chat.locator('.chat-earlier').count())) fail('no way to show the earlier messages');
  // Scrolled to the top: more turns mount, and the turn that was first stays where it was.
  const anchor = `mensaje ${LONG_CHAT - mounted}`;
  const topOf = () =>
    chat
      .locator('.turn', { hasText: new RegExp(`${anchor}\\b`) })
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().top));
  await chat.locator('.chat-scroll').evaluate((el) => (el.scrollTop = 0));
  await win
    .waitForFunction(
      (n) => document.querySelectorAll('.chat-session .chat-scroll .turn').length > n,
      mounted,
      { timeout: 10_000 },
    )
    .catch(() => fail('scrolling up did not bring earlier messages back'));
  const before = await topOf();
  await win.waitForTimeout(300);
  const after = await topOf();
  const box = await chat.locator('.chat-scroll').boundingBox();
  if (before !== after) fail(`the chat kept moving after loading earlier messages`);
  if (box && (after < box.y - 600 || after > box.y + box.height))
    fail(`loading earlier messages moved the text being read (${after}px, list at ${box.y}px)`);
}

/** C3: the message box after its split: the "/" and "@" lists and the "+" menu still work. */
async function composer(win, fail) {
  const chat = win.locator('.chat-session:visible');
  const box = chat.locator('.chat-input textarea');
  const options = chat.locator('.chat-suggest [role="option"]');
  await box.fill('/');
  await options
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('typing "/" did not list the commands'));
  if ((await options.count()) < 3) fail(`"/" listed ${await options.count()} commands`);
  await options.first().dispatchEvent('mousedown');
  const slash = await box.inputValue();
  if (!slash.startsWith('/') || slash.length < 3 || !slash.endsWith(' '))
    fail(`picking a "/" command left "${slash}" in the box`);
  await box.fill('mira @g');
  const git = chat.locator('.chat-suggest [role="option"]', { hasText: '@git' }).first();
  await git
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('typing "@g" did not offer @git'));
  await git.dispatchEvent('mousedown');
  if ((await box.inputValue()) !== 'mira @git ')
    fail(`picking @git left "${await box.inputValue()}" in the box`);
  await box.fill('');
  await chat.locator('.add-menu-btn').click();
  const menu = chat.locator('.add-menu');
  await menu
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => fail('the "+" menu did not open'));
  if ((await menu.locator('[role="menuitem"]').count()) < 5)
    fail(`the "+" menu has ${await menu.locator('[role="menuitem"]').count()} items`);
  // "Include the open file" is a toggle: the menu stays open and the check mark follows.
  const toggle = menu.locator('[role="menuitemcheckbox"]').last();
  const was = await toggle.getAttribute('aria-checked');
  await toggle.click();
  if ((await toggle.getAttribute('aria-checked')) === was)
    fail('the "include file" toggle of the "+" menu did not change');
  await toggle.click();
  if (!(await menu.locator('select').count())) fail('the "+" menu lost its reasoning select');
  await win.keyboard.press('Escape');
  await menu
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => fail('Escape did not close the "+" menu'));
}

/**
 * C3: "/" commands and one answer streamed into the chat, after both left Chat.tsx. The model
 * is replaced by fixed events; what the chat draws from them is real.
 */
async function chatStream(run, fail) {
  const { win } = run;
  await run.app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('ai:chat');
    ipcMain.handle('ai:chat', (e, requestId) => {
      const send = (event) => e.sender.send('omni:event', { type: 'chat', requestId, event });
      setTimeout(() => {
        send({ type: 'start', provider: 'prueba', model: 'fijo' });
        send({ type: 'text', delta: 'Leo el ' });
        send({ type: 'text', delta: 'archivo.' });
        send({ type: 'tool_call', id: 't1', name: 'read_file', args: { path: 'uno.txt' } });
        send({ type: 'tool_result', id: 't1', ok: true, summary: '5 líneas' });
        send({ type: 'text', delta: 'Respuesta zq-final.' });
        send({ type: 'cost', usd: 0, inputTokens: 12, outputTokens: 34, latencyMs: 500 });
      }, 50);
    });
  });
  const chat = win.locator('.chat-session:visible');
  const box = chat.locator('.chat-input textarea');
  const pill = chat.locator('.mode-pill');
  const slash = async (cmd, mode) => {
    await box.fill(cmd);
    await box.press('Escape');
    await box.press('Enter');
    await chat
      .locator(`.mode-pill.mode-${mode}`)
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(async () =>
        fail(`"${cmd}" left the chat in "${await pill.getAttribute('class')}", not ${mode}`),
      );
    if ((await box.inputValue()) !== '') fail(`"${cmd}" stayed in the box`);
  };
  await slash('/plan', 'plan');
  await slash('/chat', 'ask');
  await box.fill('pregunta zq-e2e');
  await box.press('Enter');
  const answer = chat.locator('.chat-scroll .turn.assistant').last();
  await answer
    .locator('.turn-meta')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('the streamed answer never finished (no tokens line)'));
  const text = (await answer.innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (!text.includes('Leo el archivo.') || !text.includes('Respuesta zq-final.'))
    fail(`the streamed answer reads "${text.slice(0, 200)}"`);
  if (!text.includes('12→34')) fail(`the tokens line is missing in "${text.slice(-120)}"`);
  if ((await answer.locator('.tool-card.ok').count()) !== 1)
    fail(`the answer shows ${await answer.locator('.tool-card').count()} tool cards, not 1 done`);
  const asked = await chat.locator('.turn.user', { hasText: 'pregunta zq-e2e' }).count();
  if (asked !== 1) fail(`the message sent shows ${asked} times in the chat`);
  const answers = await chat.locator('.turn.assistant', { hasText: 'zq-final' }).count();
  if (answers !== 1) fail(`the answer shows ${answers} times in the chat`);
  if ((await box.inputValue()) !== '') fail('the box kept the message after sending it');
}

/** B6: an installed extension (as the store leaves it on disk) with a theme and a snippet. */
const EXT_BG = '#fdf6e3';
function seedExtension(home) {
  const dir = join(home, 'electron/extensions/demo.tema-1.0.0');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'zinarix-meta.json'),
    JSON.stringify({
      id: 'demo.tema',
      displayName: 'Tema de prueba',
      publisher: 'demo',
      version: '1.0.0',
      description: 'Un tema claro y un fragmento.',
      enabled: true,
      installedAt: 1,
    }),
  );
  writeFileSync(
    join(dir, 'zinarix-contributions.json'),
    JSON.stringify({
      themes: [
        {
          label: 'Arena clara',
          base: 'vs',
          theme: {
            colors: { 'editor.background': EXT_BG, 'editor.foreground': '#586e75' },
            tokenColors: [{ scope: 'comment', settings: { foreground: '#93a1a1' } }],
          },
        },
      ],
      languages: [],
      snippets: [
        {
          language: 'plaintext',
          snippets: { Saludo: { prefix: 'zsaludo', body: 'hola desde el fragmento' } },
        },
      ],
      unsupported: ['code'],
    }),
  );
}

/**
 * B6: a theme of an installed extension shows in Settings and in the Extensions panel, changes
 * the colors of the app, and goes away when the extension is disabled; its snippet completes.
 */
async function extensionsPanel(run, project, fail) {
  const { win } = run;
  const bg = () =>
    win.evaluate(() => document.documentElement.style.getPropertyValue('--bg').trim());
  const mode = () => win.evaluate(() => document.documentElement.dataset.theme);
  const before = await mode();
  await menuKey(run, 'CmdOrCtrl+,').catch(() => win.keyboard.press('Control+,'));
  await win.locator('.settings-search').waitFor({ state: 'visible', timeout: 10_000 });
  const appearance = win.locator('.settings nav button', { hasText: /Apariencia|Appearance/ });
  if (await appearance.count()) await appearance.first().click();
  const card = win.locator('.theme-card', { hasText: 'Arena clara' });
  await card
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('Settings does not list the theme of the installed extension'));
  if (!(await card.count())) return;
  await card.click();
  if ((await bg()) !== EXT_BG) fail(`the extension theme did not set --bg (got "${await bg()}")`);
  if ((await mode()) !== 'light') fail('a light extension theme did not switch the app to light');
  if (flag('--shots')) {
    mkdirSync(shotsDir, { recursive: true });
    await win.screenshot({ path: join(shotsDir, 'e2e-ext-settings.png') }).catch(() => {});
  }
  await win.getByRole('button', { name: /Más temas|More themes/ }).click();
  const panel = win.locator('.ext-panel');
  await panel
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => fail('the Extensions panel (lazy chunk) did not open'));
  const ext = panel.locator('[data-ext="demo.tema"]');
  await ext
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('the Extensions panel does not list the installed extension'));
  const use = ext.locator('.ext-themes button');
  if ((await use.getAttribute('aria-pressed').catch(() => null)) !== 'true')
    fail('the panel does not mark the theme in use');
  if (flag('--shots'))
    await win.screenshot({ path: join(shotsDir, 'e2e-ext-panel.png') }).catch(() => {});
  // The same button leaves the theme; then use it again from the panel.
  await use.click();
  if ((await bg()) === EXT_BG || (await mode()) !== before)
    fail('leaving the extension theme did not bring the built-in theme back');
  await use.click();
  if ((await bg()) !== EXT_BG) fail('"Usar" in the panel did not apply the theme');
  // Disabling the extension takes its theme away.
  await ext.getByRole('button', { name: /^(Desactivar|Disable)$/ }).click();
  await ext
    .getByRole('button', { name: /^(Activar|Enable)$/ })
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('the extension was not disabled'));
  if ((await bg()) === EXT_BG) fail('a disabled extension kept its theme on');
  if (await ext.locator('.ext-themes button').count())
    fail('a disabled extension still offers its themes');
  await ext.getByRole('button', { name: /^(Activar|Enable)$/ }).click();
  await ext
    .locator('.ext-themes button')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('the extension was not enabled again'));
  // Its snippet completes in a text file.
  await win.locator('.activity-bar button').first().click();
  await win.locator('.tree-row', { hasText: 'fragmento.txt' }).first().click();
  const editor = win.locator('.monaco-editor').first();
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await editor.click();
  await win.keyboard.type('zsalu');
  await win.keyboard.press('Control+Space');
  await win
    .locator('.suggest-widget .monaco-list-row', { hasText: 'zsaludo' })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => fail('the snippet of the extension is not suggested'));
  await win.keyboard.press('Enter');
  await menuKey(run, 'CmdOrCtrl+S');
  const deadline = Date.now() + 8_000;
  let text = '';
  while (Date.now() < deadline) {
    text = readFileSync(join(project, 'fragmento.txt'), 'utf8');
    if (text.includes('hola desde el fragmento')) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!text.includes('hola desde el fragmento'))
    fail(`the snippet was not inserted (file: ${JSON.stringify(text)})`);
}

async function launch(project, seed) {
  const home = mkdtempSync(join(tmpdir(), 'zinarix-e2e-home-'));
  if (seed) await seed(home);
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
  const run = await launch(project, async (home) => {
    await seedLongChat(home);
    seedExtension(home);
  });
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
    if (!problems.length) {
      // B3: a file changed by another program (git checkout, a formatter) reaches its open tab.
      writeFileSync(join(project, 'hola.txt'), 'Cambiado en disco\n');
      await win
        .locator('.monaco-editor', { hasText: 'Cambiado en disco' })
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => fail('the open tab did not follow a change on disk'));
      writeFileSync(join(project, 'hola.txt'), 'Hola Zinarix\n');
    }
    if (!problems.length)
      await reviewInEditor(run, project, fail).catch((e) =>
        fail(`the AI review in the editor failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length)
      await splitEditor(run, project, fail).catch((e) =>
        fail(`the split editor failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length)
      await gitMarks(run, project, fail).catch((e) =>
        fail(`the git marks test failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length)
      await bigFolder(win, fail).catch((e) =>
        fail(`the big folder test failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length)
      await longChat(win, fail).catch((e) =>
        fail(`the long chat test failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length)
      await composer(win, fail).catch((e) =>
        fail(`the message box test failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length)
      await chatStream(run, fail).catch((e) =>
        fail(`the chat stream test failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length)
      await settingsSearch(run, fail).catch((e) =>
        fail(`the settings search failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length)
      await extensionsPanel(run, project, fail).catch((e) =>
        fail(`the extensions test failed: ${String(e).slice(0, 300)}`),
      );
    if (!problems.length) {
      // C2: viewers and studios are separate chunks loaded the first time they are shown.
      await win.locator('.tree-row', { hasText: 'pieza.stl' }).first().click();
      await win
        .locator('.cad-model canvas')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => fail('the 3D model viewer (lazy chunk) did not load'));
      await win.keyboard.press('Control+Shift+V');
      await win
        .locator('.vs-root.vs-in')
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => fail('Video Studio (lazy chunk) did not load'));
      if (flag('--shots')) {
        mkdirSync(shotsDir, { recursive: true });
        await win.screenshot({ path: join(shotsDir, 'e2e-video.png') }).catch(() => {});
      }
      await win.keyboard.press('Control+Shift+V');
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

/** C2: the script the window starts with. Studios and viewers must stay in their own chunks. */
const ENTRY_BUDGET = 1_800_000;
function entryBytes() {
  const assets = join(appDir, 'dist/renderer/assets');
  const entry = readdirSync(assets).filter((n) => /^index-.*\.js$/.test(n));
  return Math.max(0, ...entry.map((n) => statSync(join(assets, n)).size));
}

const project = sampleProject();
let exit = 0;
const entry = entryBytes();
if (entry > ENTRY_BUDGET) {
  console.error(
    `✗ the start-up script is ${entry} bytes (budget ${ENTRY_BUDGET}): something heavy is imported statically again`,
  );
  exit = 1;
} else console.log(`✓ start-up script: ${(entry / 1e6).toFixed(2)} MB`);
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
