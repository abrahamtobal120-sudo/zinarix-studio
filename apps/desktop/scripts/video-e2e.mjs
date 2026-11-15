// End-to-end check of Video Studio in the real Electron app: pnpm build, then
// `node scripts/video-e2e.mjs [screenshot folder]` from apps/desktop (DBG=1 prints the timeline).
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? join(tmpdir(), 'zvs-shots');
mkdirSync(out, { recursive: true });
const exe = process.platform === 'win32' ? '.exe' : '';
const ff = join(process.cwd(), `node_modules/ffmpeg-static/ffmpeg${exe}`);
const ffprobe = join(
  process.cwd(),
  `node_modules/ffprobe-static/bin/${process.platform}/${process.arch}/ffprobe${exe}`,
);
const ws = mkdtempSync(join(tmpdir(), 'zvs-ws-'));
execFileSync(ff, [
  '-hide_banner',
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=1280x720:rate=30:duration=8',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=330:duration=8',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-shortest',
  join(ws, 'sample.mp4'),
]);
execFileSync(ff, [
  '-hide_banner',
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=220:duration=6',
  '-c:a',
  'libmp3lame',
  join(ws, 'music.mp3'),
]);

const app = await electron.launch({
  executablePath: join(
    process.cwd(),
    'node_modules/electron/dist',
    process.platform === 'win32'
      ? 'electron.exe'
      : process.platform === 'darwin'
        ? 'Electron.app/Contents/MacOS/Electron'
        : 'electron',
  ),
  args: ['.', ws],
  env: {
    ...process.env,
    OMNI_HOME: mkdtempSync(join(tmpdir(), 'omni-e2e-')),
    OMNI_NO_KEYCHAIN: '1',
  },
});
const logs = [];
app.process().stderr.on('data', (d) => logs.push('MAIN: ' + d));
const win = await app.firstWindow();
win.on(
  'console',
  (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`${m.type()}: ${m.text()}`),
);
win.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await win.setViewportSize?.({ width: 1440, height: 900 });
await win.waitForTimeout(2500);
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) });
const check = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
const clips = () =>
  win.$$eval('.vs-clip', (els) =>
    els
      .map(
        (e) =>
          `${e.style.left}/${e.style.width} ${e.title} ${e.className.includes('selected') ? '*' : ''}`,
      )
      .join(' | '),
  );
const dbg = async (label) =>
  process.env.DBG &&
  console.log('  ', label, await clips(), await win.locator('.vs-timecode b').textContent());

// Mock the save dialogs in main.
const exportPath = join(ws, 'export.mp4');
const projPath = join(ws, 'demo.zvproj');
await app.evaluate(
  ({ dialog }, paths) => {
    dialog.showSaveDialog = async (_w, o) => ({
      canceled: false,
      filePath: (o ?? _w).title?.includes('proyecto') ? paths.proj : paths.exp,
    });
  },
  { exp: exportPath, proj: projPath },
);

// A fresh profile may greet with the onboarding: close it.
if (await win.locator('.onboarding-backdrop').count()) await win.keyboard.press('Escape');
await win.evaluate(() => document.querySelector('.onboarding-backdrop')?.remove());

// 1. Explorer double-click on a video opens the studio with the clip on the timeline.
await win.locator('.tree-row', { hasText: 'sample.mp4' }).first().dblclick();
await win.waitForSelector('.vs-root.vs-in', { timeout: 8000 });
await win.waitForSelector('.vs-clip', { timeout: 15000 });
check('explorer opens studio with clip', (await win.locator('.vs-clip').count()) === 1);
await win.waitForTimeout(2500);
await shot('1-opened');

// 2. Playback draws real frames.
await win.keyboard.press('Space');
await win.waitForTimeout(1500);
await win.keyboard.press('Space');
await win.waitForTimeout(600);
const ph = await win.locator('.vs-timecode b').textContent();
check('playhead advanced', ph !== '00:00:00:00', ph);
const lit = await win.evaluate(() => {
  const c = document.querySelector('.vs-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4 * 97) sum += d[i] + d[i + 1] + d[i + 2];
  return sum;
});
check('viewer shows a frame (not black)', lit > 1000, String(lit));
await shot('2-playing');

// 3. Split at 2 s, delete the left part with ripple.
await win.evaluate(() => document.activeElement?.blur());
await win.keyboard.press('Home');
for (let i = 0; i < 60; i++) await win.keyboard.press('ArrowRight');
check('arrows step frames', (await win.locator('.vs-timecode b').textContent()) === '00:00:02:00');
// Nothing selected: S splits every clip under the playhead.
await win.evaluate(() =>
  document.querySelector('.vs-lane')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
);
await win.keyboard.press('Home');
for (let i = 0; i < 60; i++) await win.keyboard.press('ArrowRight');
await dbg('before split');
await win.keyboard.press('s');
await win.waitForTimeout(300);
await dbg('after split');
check('split makes 2 clips', (await win.locator('.vs-clip').count()) === 2);
await win
  .locator('.vs-clip')
  .first()
  .click({ position: { x: 20, y: 30 } });
await dbg('after select');
await win.keyboard.press('Shift+Delete');
await win.waitForTimeout(100);
await dbg('after ripple');
await win.waitForTimeout(300);
const left = await win
  .locator('.vs-clip')
  .first()
  .evaluate((e) => e.style.left);
check(
  'ripple delete leaves 1 clip at 0',
  (await win.locator('.vs-clip').count()) === 1 && left === '0px',
  left,
);

// 4. Undo / redo.
await win.keyboard.press('Control+z');
await win.waitForTimeout(200);
check('undo brings it back', (await win.locator('.vs-clip').count()) === 2);
await win.keyboard.press('Control+Shift+z');
await win.waitForTimeout(200);
check('redo removes it again', (await win.locator('.vs-clip').count()) === 1);

// 5. Marker, in/out.
await win.keyboard.press('m');
check('marker added', (await win.locator('.vs-marker').count()) === 1);
await shot('3-edited');

// 6. Export (dialog mocked) and wait for the job.
await win.keyboard.press('Control+e');
await win.waitForSelector('.vs-dialog', { timeout: 3000 });
await shot('4-export-dialog');
await win.locator('.vs-presets button', { hasText: 'Web' }).click();
await win.locator('.vs-dialog .primary').click();
await win.waitForSelector('.vs-job', { timeout: 5000 });
await win.waitForTimeout(800);
await shot('5-rendering');
await win.waitForSelector('.vs-job-done', { timeout: 60000 }).catch(() => undefined);
const ok = existsSync(exportPath);
let dur = '';
if (ok)
  dur = execFileSync(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    exportPath,
  ])
    .toString()
    .trim();
check(
  'export produced MP4',
  ok && Math.abs(Number(dur) - 6) < 0.2,
  `${dur}s ${ok ? statSync(exportPath).size : 0} bytes`,
);
await shot('6-exported');

// 7. Save with Ctrl+S (goes through the app menu → studio).
await win.keyboard.press('Control+s');
await win.waitForTimeout(1200);
if (process.env.DBG)
  console.log('   toast after ctrl+s:', await win.locator('.toast').allTextContents());
check('project saved', existsSync(projPath));

// 8. Esc closes the studio; Ctrl+Shift+V reopens.
await win.keyboard.press('Escape');
await win.waitForTimeout(400);
check('esc closes studio', !(await win.locator('.vs-root.vs-in').count()));
await shot('7-closed');
await win.keyboard.press('Control+Shift+V');
await win.waitForTimeout(500);
check('ctrl+shift+v reopens', (await win.locator('.vs-root.vs-in').count()) === 1);
await shot('8-reopened');

console.log(logs.filter((l) => !/Autofill|DevTools|Electron Security/.test(l)).join('\n'));
await app.close();
