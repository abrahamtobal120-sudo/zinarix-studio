// Opens every panel and lists icons that overflow their box or overlap a sibling (text, badge, icon).
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', new URL('../../..', import.meta.url).pathname],
  env: {
    ...process.env,
    OMNI_HOME: mkdtempSync(join(tmpdir(), 'omni-icons-')),
    OMNI_NO_KEYCHAIN: '1',
  },
});
const win = await app.firstWindow();
await win.waitForTimeout(2500);
const cmd = (c) =>
  app.evaluate(
    ({ BrowserWindow }, c) =>
      BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
        type: 'command',
        command: c,
      }),
    c,
  );
const detect = () => {
  const out = [];
  const name = (e) =>
    `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className)
      .trim()
      .replace(/\s+/g, '.')}`;
  for (const svg of document.querySelectorAll('svg')) {
    const r = svg.getBoundingClientRect();
    if (!r.width || !svg.parentElement) continue;
    const p = svg.parentElement;
    const pr = p.getBoundingClientRect();
    if (
      r.left < pr.left - 1 ||
      r.right > pr.right + 1 ||
      r.top < pr.top - 1 ||
      r.bottom > pr.bottom + 1
    )
      out.push(
        `CLIP ${name(p)} > ${name(svg)} ${r.width}x${r.height} in ${pr.width.toFixed(0)}x${pr.height.toFixed(0)}`,
      );
    for (const sib of p.children) {
      if (sib === svg) continue;
      const s = sib.getBoundingClientRect();
      if (!s.width) continue;
      const ox = Math.min(r.right, s.right) - Math.max(r.left, s.left);
      const oy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
      if (ox > 1 && oy > 1)
        out.push(
          `OVER ${name(p)} : ${name(svg)} vs ${name(sib)} ${ox.toFixed(0)}x${oy.toFixed(0)} "${sib.textContent.slice(0, 20)}"`,
        );
    }
  }
  return [...new Set(out)];
};
for (const v of [
  'view.explorer',
  'view.search',
  'view.git',
  'view.run',
  'view.vercel',
  'view.supabase',
  'view.terminal',
  'view.browser',
  'security.center',
  'palette',
  'ai.pickModel',
]) {
  await cmd(v);
  await win.waitForTimeout(1000);
  console.log('## ' + v + '\n' + (await win.evaluate(detect)).join('\n'));
  await win.keyboard.press('Escape');
}
await app.close();
