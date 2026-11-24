// Walks the main screens of the app and reports UI defects it can measure:
// console errors, clipped text without an ellipsis, untranslated keys, "undefined"/"NaN"
// on screen, buttons without a name, broken images, popups outside the window and
// text below WCAG contrast. Saves one screenshot per screen.
// node scripts/ui-audit.mjs <out-dir> [theme...]   (themes: dark light)
import { _electron as electron } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const out = resolve(process.argv[2] ?? join(tmpdir(), 'zs-audit'));
const themes = process.argv.slice(3).length ? process.argv.slice(3) : ['dark', 'light'];
mkdirSync(out, { recursive: true });

// A small project so every screen has something to show.
const proj = mkdtempSync(join(tmpdir(), 'zs-audit-proj-'));
const files = {
  'package.json': JSON.stringify(
    { name: 'demo', scripts: { test: 'vitest run', dev: 'vite' } },
    null,
    2,
  ),
  'README.md': '# Demo\n\nUn proyecto de prueba con **Markdown**.\n\n- uno\n- dos\n',
  'src/index.ts': 'export function sum(a: number, b: number): number {\n  return a + b;\n}\n',
  'src/app.tsx': 'export const App = () => <div>Hola</div>;\n',
  'src/util.test.ts':
    "import { sum } from './index';\ntest('sum', () => expect(sum(1, 2)).toBe(3));\n",
  // Files for the newer viewers: Godot scene, OpenSCAD, mesh and G-code.
  'project.godot': '[application]\nconfig/name="Demo"\nrun/main_scene="res://main.tscn"\n',
  'main.tscn':
    '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n' +
    '[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n\n' +
    '[node name="Player" type="CharacterBody2D" parent="."]\nposition = Vector2(120, 80)\n\n' +
    '[node name="Sky" type="ColorRect" parent="."]\ncolor = Color(0.2, 0.4, 0.9, 1)\n',
  'main.gd': 'extends Node2D\n\nfunc _ready() -> void:\n\tprint($Player.position)\n',
  'caja.scad':
    'ancho = 40; // [10:1:120]\nalto = 20; // [5:1:60]\nhueca = true;\n\n' +
    'difference() {\n  cube([ancho, ancho, alto]);\n  if (hueca) translate([2, 2, 2]) cube([ancho - 4, ancho - 4, alto]);\n}\n',
  'pieza.stl': (() => {
    const v = [
      [0, 0, 0],
      [20, 0, 0],
      [20, 20, 0],
      [0, 20, 0],
      [0, 0, 20],
      [20, 0, 20],
      [20, 20, 20],
      [0, 20, 20],
    ];
    const f = [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ];
    const t = f.map(
      (x) =>
        ' facet normal 0 0 0\n  outer loop\n' +
        x.map((i) => `   vertex ${v[i].join(' ')}\n`).join('') +
        '  endloop\n endfacet\n',
    );
    return `solid cubo\n${t.join('')}endsolid cubo\n`;
  })(),
  'pieza.gcode': (() => {
    const l = [';FLAVOR:Marlin', 'M104 S210', 'M140 S60', 'G28', 'G92 E0'];
    let e = 0;
    for (let z = 1; z <= 20; z++) {
      l.push(
        `;LAYER_CHANGE`,
        `;Z:${(z * 0.2).toFixed(1)}`,
        `G1 Z${(z * 0.2).toFixed(1)} F600`,
        ';TYPE:Perimeter',
      );
      for (const [x, y] of [
        [100, 100],
        [120, 100],
        [120, 120],
        [100, 120],
        [100, 100],
      ])
        l.push(`G1 X${x} Y${y} E${(e += 0.8).toFixed(3)} F1800`);
    }
    return l.join('\n') + '\n';
  })(),
};
for (const [p, c] of Object.entries(files)) {
  mkdirSync(join(proj, p, '..'), { recursive: true });
  writeFileSync(join(proj, p), c);
}
// A small real PNG (a gradient with a circle) for the image viewer/editor.
{
  const w = 160;
  const h = 120;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const inC = (x - 80) ** 2 + (y - 60) ** 2 < 900;
      raw[o] = inC ? 230 : 40 + x;
      raw[o + 1] = inC ? 120 : 60 + y;
      raw[o + 2] = inC ? 40 : 160;
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    join(proj, 'foto.png'),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
const git = (...a) => execFileSync('git', a, { cwd: proj, stdio: 'ignore' });
git('init', '-q');
git('-c', 'user.email=a@b.c', '-c', 'user.name=audit', 'add', '.');
git('-c', 'user.email=a@b.c', '-c', 'user.name=audit', 'commit', '-qm', 'init');
writeFileSync(join(proj, 'src/index.ts'), files['src/index.ts'] + '\nexport const two = 2;\n');

const home = mkdtempSync(join(tmpdir(), 'zs-audit-home-'));
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj, `--user-data-dir=${join(home, 'ud')}`],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.setViewportSize?.({ width: 1440, height: 900 }).catch(() => {});
let screen = 'start';
const logs = [];
win.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    logs.push({ screen, type: m.type(), text: m.text().slice(0, 300) });
});
win.on('pageerror', (e) =>
  logs.push({ screen, type: 'pageerror', text: String(e.stack ?? e).slice(0, 500) }),
);

await win.waitForSelector('.status-bar', { timeout: 30000 });
await win.waitForTimeout(2500);
await win.keyboard.press('Escape');

const cmd = (command) =>
  app.evaluate(
    ({ BrowserWindow }, command) =>
      BrowserWindow.getAllWindows()[0].webContents.send('omni:event', { type: 'command', command }),
    command,
  );

/** Everything measured in the page. */
const inspect = () =>
  win.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };
    const path = (el) => {
      const parts = [];
      for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
        const c = [...e.classList].slice(0, 2).join('.');
        parts.unshift(e.tagName.toLowerCase() + (c ? '.' + c : ''));
      }
      return parts.join(' > ');
    };
    const ownText = (el) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .trim();
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (
          s.backgroundImage !== 'none' &&
          !s.backgroundImage.startsWith('linear-gradient(transparent')
        )
          return null;
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 1) break;
        }
      }
      let base = { r: 255, g: 255, b: 255 };
      if (layers.length && layers[layers.length - 1].a >= 1) base = layers.pop();
      else return null;
      for (const c of layers.reverse())
        base = {
          r: c.r * c.a + base.r * (1 - c.a),
          g: c.g * c.a + base.g * (1 - c.a),
          b: c.b * c.a + base.b * (1 - c.a),
        };
      return base;
    };
    const all = [...document.querySelectorAll('body *')].filter(
      (el) => !el.closest('.monaco-editor, .xterm, canvas, svg, iframe, webview') && vis(el),
    );
    const W = innerWidth;
    const H = innerHeight;
    const found = {
      clipped: [],
      badText: [],
      unnamed: [],
      titleOnly: [],
      images: [],
      outside: [],
      contrast: [],
      small: [],
    };
    for (const el of all) {
      const text = ownText(el);
      const s = getComputedStyle(el);
      if (text) {
        if (
          /\b(undefined|NaN|\[object Object\]|null)\b/.test(text) ||
          /^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)*\.[a-z]*[A-Z][a-zA-Z]*$/.test(text) ||
          /(^|[^$])\{\{?\w+\}?\}/.test(text)
        )
          found.badText.push({ at: path(el), text: text.slice(0, 80) });
        const hidden = s.overflow !== 'visible' || s.overflowX !== 'visible';
        if (
          hidden &&
          el.scrollWidth > el.clientWidth + 2 &&
          s.textOverflow !== 'ellipsis' &&
          s.whiteSpace !== 'normal' &&
          !['auto', 'scroll'].includes(s.overflowX)
        )
          found.clipped.push({
            at: path(el),
            text: text.slice(0, 60),
            w: el.clientWidth,
            need: el.scrollWidth,
          });
        const fg = parse(s.color);
        const bg = bgOf(el);
        if (fg && bg && !el.closest('[disabled], [aria-disabled="true"], .disabled')) {
          const f = {
            r: fg.r * fg.a + bg.r * (1 - fg.a),
            g: fg.g * fg.a + bg.g * (1 - fg.a),
            b: fg.b * fg.a + bg.b * (1 - fg.a),
          };
          const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x);
          const ratio = (a + 0.05) / (b + 0.05);
          const size = parseFloat(s.fontSize);
          const big = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
          if (ratio < (big ? 3 : 4.5))
            found.contrast.push({
              at: path(el),
              text: text.slice(0, 40),
              ratio: Math.round(ratio * 100) / 100,
              size,
            });
        }
        if (parseFloat(s.fontSize) < 10.5)
          found.small.push({ at: path(el), text: text.slice(0, 40), size: s.fontSize });
      }
      if (
        el.matches(
          'button, [role="button"], a[href], input:not([type=hidden]), select, textarea, [role="tab"], [role="menuitem"]',
        )
      ) {
        const name =
          el.getAttribute('aria-label') ||
          (el.getAttribute('aria-labelledby') &&
            document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) ||
          el.textContent.trim() ||
          (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
          el.closest('label')?.textContent.trim() ||
          el.getAttribute('placeholder');
        if (!name)
          (el.getAttribute('title') ? found.titleOnly : found.unnamed).push({
            at: path(el),
            title: el.getAttribute('title'),
          });
      }
      if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0)
        found.images.push({ at: path(el), src: el.getAttribute('src')?.slice(0, 80) });
      if (
        ['fixed', 'absolute'].includes(s.position) &&
        s.zIndex !== 'auto' &&
        Number(s.zIndex) >= 10
      ) {
        const r = el.getBoundingClientRect();
        if (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1)
          found.outside.push({
            at: path(el),
            rect: [r.left, r.top, r.right, r.bottom].map(Math.round),
          });
      }
    }
    const dedupe = (arr) => {
      const seen = new Map();
      for (const x of arr) {
        const k = x.at + '|' + (x.text ?? x.title ?? '');
        if (!seen.has(k)) seen.set(k, x);
      }
      return [...seen.values()];
    };
    for (const k of Object.keys(found)) found[k] = dedupe(found[k]);
    return {
      theme: document.documentElement.dataset.theme,
      lang: document.documentElement.lang,
      ...found,
    };
  });

const results = [];
const visit = async (name, act, wait = 900) => {
  screen = name;
  try {
    await act();
  } catch (e) {
    logs.push({ screen, type: 'script', text: String(e).slice(0, 300) });
  }
  await win.waitForTimeout(wait);
  await win.screenshot({ path: join(out, `${name}.png`) });
  const r = await inspect();
  results.push({ screen: name, ...r });
  const n = (k) => r[k].length;
  console.log(
    `${name.padEnd(28)} clip ${n('clipped')} txt ${n('badText')} unnamed ${n('unnamed')} title ${n('titleOnly')} img ${n('images')} out ${n('outside')} contrast ${n('contrast')} small ${n('small')}`,
  );
};
const esc = async () => {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
};

for (const theme of themes) {
  await win.evaluate((t) => {
    localStorage.setItem('omni.theme', t);
  }, theme);
  const now = await win.evaluate(() => document.documentElement.dataset.theme);
  if (now !== theme) await cmd('view.toggleTheme');
  await win.waitForTimeout(600);
  const p = (s) => `${theme}-${s}`;
  await visit(p('start'), async () => {});
  // view.explorer toggles the side bar: only send it when the Explorer is not already showing.
  await visit(p('explorer'), async () => {
    if (!(await win.locator('.explorer .tree-row').count())) await cmd('view.explorer');
  });
  const row = (name) =>
    win
      .locator('.explorer .tree-row', { has: win.locator(`.tree-label:text-is("${name}")`) })
      .first();
  await visit(
    p('file-ts'),
    async () => {
      if (!(await row('index.ts').count())) await row('src').click({ timeout: 5000 });
      await win.waitForTimeout(300);
      await row('index.ts').click({ timeout: 5000 });
    },
    1500,
  );
  await visit(p('file-md'), () => row('README.md').click({ timeout: 5000 }), 1200);
  await visit(p('search'), () => cmd('view.search'));
  await visit(p('git'), () => cmd('view.git'), 1500);
  await visit(p('run'), () => cmd('view.run'));
  await visit(p('debug'), () => cmd('view.debug'));
  await visit(p('problems'), () => cmd('view.problems'));
  await visit(p('terminal'), () => cmd('view.terminal'), 1500);
  await visit(p('chat'), () => cmd('view.chat'), 1200);
  await visit(p('chat-list'), () => cmd('chat.list'));
  await esc();
  await visit(p('palette'), () => cmd('palette'), 600);
  await esc();
  await visit(p('quickopen'), () => cmd('quickOpen'), 600);
  await esc();
  await visit(p('settings'), () => cmd('app.settings'), 1200);
  await esc();
  await visit(p('shortcuts'), () => cmd('help.shortcuts'));
  await esc();
  await visit(p('licenses'), () => cmd('help.licenses'), 1200);
  await esc();
  await visit(p('usage'), () => cmd('ai.usage'), 1200);
  await esc();
  await visit(p('providers'), () => cmd('ai.providers'), 1200);
  await esc();
  await visit(p('tests'), () => cmd('tests.open'), 1200);
  await esc();
  await visit(p('tasks'), () => cmd('tasks.run'), 900);
  await esc();
  await visit(p('vercel'), () => cmd('view.vercel'));
  await visit(p('supabase'), () => cmd('view.supabase'));
  await visit(p('gcloud'), () => cmd('view.gcloud'));
  await visit(p('mail'), () => cmd('view.mail'));
  await visit(p('watch'), () => cmd('view.watch'));
  await visit(p('design'), () => cmd('view.design'), 1500);
  await visit(p('playground'), () => cmd('view.playground'), 1200);
  await visit(p('compare'), () => cmd('view.playgroundCompare'), 1200);
  await visit(p('build'), () => cmd('view.build'), 1200);
  await visit(p('browser'), () => cmd('view.browser'), 1500);
  // Side panels added with the phases plan.
  for (const panel of ['graphics', 'docker', 'hardware', 'mobile', 'games', 'cad'])
    await visit(p(`panel-${panel}`), () => cmd(`${panel}.open`), 1500);
  if (!(await win.locator('.explorer .tree-row').count())) await cmd('view.explorer');
  await win.waitForTimeout(600);
  // Newer file viewers: Godot scene, OpenSCAD with its 3D view, mesh, G-code and image.
  for (const [name, wait] of [
    ['main.tscn', 1500],
    ['main.gd', 1500],
    ['caja.scad', 5000],
    ['pieza.stl', 2500],
    ['pieza.gcode', 2500],
    ['foto.png', 1500],
  ])
    await visit(
      p(`file-${name.replace('.', '-')}`),
      () => row(name).click({ timeout: 5000 }),
      wait,
    );
  await visit(p('security'), () => cmd('security.center'), 1200);
  await esc();
  await visit(p('scanner'), () => cmd('security.scanner'), 1200);
  await esc();
  await visit(p('whatsnew'), () => cmd('app.whatsNew'), 900);
  await esc();
  await visit(p('review'), () => cmd('ai.review'), 1200);
  await esc();
  await visit(p('video'), () => cmd('video.toggle'), 2000);
  // Every tab of the Video Studio side panel (media, easy, audio, text, ..., ai, 3d).
  const tabs = win.locator('.vs-tabs [role="tab"]');
  const nTabs = await tabs.count();
  for (let i = 0; i < nTabs; i++) {
    await visit(p(`video-tab${i}`), () => tabs.nth(i).click({ timeout: 5000 }), 900);
  }
  // The full 3D studio, opened from the 3D tab.
  await visit(
    p('studio3d'),
    () => win.locator('.s3-panel .s3-btn.s3-wide').click({ timeout: 5000 }),
    2500,
  );
  await esc();
  await win.waitForTimeout(400);
  await cmd('video.toggle');
  await win.waitForTimeout(600);
  await esc();
}

await app.close();
writeFileSync(join(out, 'report.json'), JSON.stringify({ results, logs }, null, 2));
console.log(`\n${logs.length} console entries`);
for (const l of logs)
  console.log(`[${l.screen}] ${l.type}: ${l.text.replace(/\s+/g, ' ').slice(0, 220)}`);
console.log('report:', join(out, 'report.json'));
