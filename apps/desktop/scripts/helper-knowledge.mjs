// Builds the knowledge of "Ayuda de Zinarix" (the help assistant): the hand-written user guide
// (knowledge/guia-zinarix.md), the app docs (.md/es, .md/en, README.md) and a reference that is
// generated from the code itself (menus of main.ts, commands of commands.ts, panels of
// Chrome.tsx and options of Settings.tsx, with their Spanish labels from i18n.ts), cut into
// small chunks. Written to dist/helper/knowledge.json, which ships inside the app (dist/**).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(appDir, '..', '..');

/** Internal documents that do not help a user (security findings, a prompt for an agent). */
const SKIP = new Set(['auditoria-seguridad-2026-10-08.md', 'prompt-auditoria-seguridad.md']);

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** The Spanish UI strings: `key: 'value'` entries of the `es` object of i18n.ts. */
export function spanishStrings(src) {
  // The Spanish object comes first; the English one starts at `const en`.
  const end = src.search(/\n(?:export )?const en\b/);
  const es = end > 0 ? src.slice(0, end) : src;
  const out = {};
  const re = /^ {2}(\w+):\s*(?:\n\s*)?(['"])((?:\\.|(?!\2)[^\\])*)\2/gm;
  for (const m of es.matchAll(re)) out[m[1]] = m[3].replace(/\\(['"\\])/g, '$1').replace(/\\n/g, ' ');
  return out;
}

const shortcut = (s) => s?.replace(/\$\{mod\}/g, 'Ctrl').replace(/CmdOrCtrl/g, 'Ctrl');

/** Labels of an expression like t('key'), `${t('a')} / ${t('b')}`, 'Literal' or t('cmdToggle', { what: t('x')… }). */
function label(expr, es) {
  const str = (k, lower) => {
    const v = es[k] ?? '';
    return lower ? v.toLowerCase() : v;
  };
  const toggle = /\bt\('cmdToggle',\s*\{\s*what:\s*t\('(\w+)'\)/.exec(expr);
  if (toggle) return `Alternar ${str(toggle[1], true)}`;
  // A template literal: each ${t('key')} (maybe .toLowerCase()) becomes its text.
  const tpl = /^`([^`]*)`/.exec(expr.trim());
  if (tpl)
    return tpl[1]
      .replace(/\$\{t[a-z]?\('(\w+)'\)(\.toLowerCase\(\))?\}/g, (_, k, l) => str(k, !!l))
      .replace(/\$\{[^}]*\}/g, '')
      .trim();
  const key = /\bt[a-z]?\('(\w+)'\)/.exec(expr);
  if (key) return str(key[1]);
  return /^'([^']+)'/.exec(expr.trim())?.[1] ?? '';
}

/** Menu bar of main.ts (buildMenu): "Archivo > Abrir carpeta… (Ctrl+O)". */
function menus(mainTs) {
  const start = mainTs.indexOf('function buildMenu');
  const body = mainTs.slice(start, mainTs.indexOf('Menu.buildFromTemplate', start));
  const lines = [];
  let top = '';
  const re = /label:\s*'([^']+)',?\s*(?:accelerator:\s*'([^']+)'[^\n]*)?\s*(submenu)?/g;
  for (const m of body.matchAll(re)) {
    if (m[3]) {
      top = m[1];
      lines.push(`\nMenú ${top}:`);
    } else if (top && !lines.some((l) => l.includes(`${top} > ${m[1]}`)))
      lines.push(`- ${top} > ${m[1]}${m[2] ? ` (${shortcut(m[2])})` : ''}`);
  }
  return lines.join('\n').trim();
}

/** Commands of the Command Palette (commands.ts) with their shortcuts. */
function commandList(commandsTs, es) {
  const lines = [];
  const body = commandsTs.slice(commandsTs.indexOf('function baseCommands'));
  for (const block of body.split(/\n\s{4}\{\n/).slice(1)) {
    const lab = /label:\s*([^\n]+)/.exec(block)?.[1];
    if (!lab) continue;
    const text = label(lab, es).replace(/…$/, '…');
    const keys = shortcut(/keys:\s*`([^`]+)`|keys:\s*'([^']+)'/.exec(block)?.slice(1).find(Boolean));
    const alt = shortcut(/altKeys:\s*'([^']+)'/.exec(block)?.[1]);
    if (text) lines.push(`- ${text}${keys ? ` (${keys}${alt ? ` o ${alt}` : ''})` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Buttons of the activity bar (Chrome.tsx): the `items` it defines (view('git', t('gitTitle')…)
 * or tool('chat', t('chat')…)), in the order the bar shows them, plus the "Más" panel rows.
 * Best effort: when the bar is written differently the section just lists less.
 */
function activityBar(chromeTsx, es) {
  const titles = {};
  for (const m of chromeTsx.matchAll(/^\s+(\w+): (?:view|tool)\(\s*'[^']+',\s*([^,]+?),/gm)) {
    const raw = m[2].trim();
    titles[m[1]] = raw.startsWith('tv(')
      ? 'Zinarix Video Studio'
      : /t[a-z]?\('/.test(raw) || raw.startsWith("'")
        ? label(raw.replace(/^t[a-z]\(/, 't('), es)
        : '';
  }
  const start = chromeTsx.indexOf('<nav className="activity-bar"');
  const nav = start < 0 ? '' : chromeTsx.slice(start, chromeTsx.indexOf('</nav>', start));
  const bar = [...nav.matchAll(/items\.(\w+)/g)]
    .map((m) => m[1])
    .filter((k) => k !== 'maximize' && titles[k]);
  const lines = [...new Set(bar)].map((k) => `- ${titles[k]}`);
  const rows = [...chromeTsx.matchAll(/row\(items\.(\w+),\s*t\('(\w+)'\)\)/g)];
  if (rows.length) {
    lines.push(
      `\nEl botón «${titles.more ?? 'Más'}» de la barra abre un panel con más integraciones y herramientas:`,
    );
    for (const m of rows) if (titles[m[1]]) lines.push(`- ${titles[m[1]]}: ${es[m[2]] ?? ''}`);
  }
  return lines.join('\n');
}

/** Sections and switches of the Settings screen (Settings.tsx). */
function settingsList(settingsTsx, es) {
  const sections = [...settingsTsx.matchAll(/nav\('(\w+)',\s*([^,]+),/g)].map((m) => label(m[2], es));
  const toggles = [];
  for (const m of settingsTsx.matchAll(/<Toggle\s+label=\{([^}]+)\}(?:\s+hint=\{([^}]+)\})?/g)) {
    const l = label(m[1], es);
    const h = m[2] ? label(m[2], es) : '';
    if (l) toggles.push(`- ${l}${h ? `: ${h}` : ''}`);
  }
  return `Secciones de Ajustes: ${sections.join(', ')}.\n\nOpciones que se pueden activar o desactivar:\n${toggles.join('\n')}`;
}

/** Cleans Markdown for a small model: no images, HTML, link targets or badges. */
function clean(md) {
  return md
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits Markdown by headings, then long sections by paragraphs (~maxLen characters). */
export function chunkMarkdown(md, source, maxLen = 1100) {
  const lines = clean(md).split('\n');
  const docTitle = /^#\s+(.+)/.exec(lines.find((l) => /^#\s/.test(l)) ?? '')?.[1] ?? source;
  const sections = [];
  let cur = { title: docTitle, body: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{1,4})\s+(.+)/.exec(line);
    if (h) {
      if (cur.body.join('').trim()) sections.push(cur);
      cur = { title: h[1].length === 1 ? h[2] : `${docTitle} › ${h[2]}`, body: [] };
    } else cur.body.push(line);
  }
  if (cur.body.join('').trim()) sections.push(cur);
  const chunks = [];
  for (const s of sections) {
    let buf = '';
    const flush = () => {
      if (buf.trim()) chunks.push({ source, title: s.title, text: buf.trim() });
      buf = '';
    };
    for (const para of s.body.join('\n').split(/\n\s*\n/)) {
      // A very long paragraph (a list without blank lines) is cut at its lines.
      const pieces = para.length > maxLen ? para.split('\n') : [para];
      const sep = pieces.length > 1 ? '\n' : '\n\n';
      for (const piece of pieces) {
        if (buf && buf.length + piece.length > maxLen) flush();
        buf += (buf ? sep : '') + piece.slice(0, maxLen * 2);
      }
    }
    flush();
  }
  return chunks;
}

export function buildKnowledge() {
  const src = (p) => read(join(appDir, 'src', p));
  // The strings kept apart (video, debugger, language servers), then the main ones.
  const es = {};
  for (const f of ['components/video/strings.ts', 'i18nDebug.ts', 'i18nLsp.ts', 'i18n.ts']) {
    const p = join(appDir, 'src', 'renderer', f);
    if (existsSync(p)) Object.assign(es, spanishStrings(read(p)));
  }
  const generated = [
    '# Referencia de Zinarix Studio (generada del código)',
    '## Menús de la barra superior',
    menus(src('main/main.ts')),
    '## Comandos y atajos (Paleta de comandos, Ctrl+Shift+P)',
    'Todos estos comandos se encuentran en la Paleta de comandos (Ctrl+Shift+P) escribiendo su nombre.',
    commandList(src('renderer/commands.ts'), es),
    '## Iconos de la barra de actividad (columna de la izquierda)',
    activityBar(src('renderer/components/Chrome.tsx'), es),
    '## Opciones de Ajustes (Archivo > Ajustes…, Ctrl+,)',
    settingsList(src('renderer/components/Settings.tsx'), es),
  ].join('\n\n');

  // [path, source, weight, text]: the user guide ranks first, developer docs last (they talk
  // about the code, not about using the app).
  const docs = [
    [join(appDir, 'knowledge', 'guia-zinarix.md'), 'Guía de usuario', 1.6],
    [null, 'Referencia generada', 1.3, generated],
    [join(repo, 'README.md'), 'README', 1],
  ];
  for (const [dir, weight] of [['es', 0.55], ['en', 0.45]]) {
    const d = join(repo, '.md', dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort())
      if (f.endsWith('.md') && !SKIP.has(f))
        docs.push([join(d, f), relative(repo, join(d, f)).replace(/\\/g, '/'), weight]);
  }
  const chunks = [];
  for (const [path, source, weight, text] of docs) {
    if (path && !existsSync(path)) continue;
    // Command lists are long: smaller pieces so retrieval picks the right lines.
    for (const c of chunkMarkdown(text ?? read(path), source, text ? 700 : 1100))
      chunks.push({ ...c, weight });
  }
  return { version: 1, chunks };
}

export function writeKnowledge(out = join(appDir, 'dist', 'helper', 'knowledge.json')) {
  const k = buildKnowledge();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(k));
  return k.chunks.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`helper knowledge: ${writeKnowledge()} chunks\n`);
}
