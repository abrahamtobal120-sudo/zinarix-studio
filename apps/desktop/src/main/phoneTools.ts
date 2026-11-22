/**
 * The phone page's file browser, terminal and git views (see phonePage.ts, which inlines
 * these). Kept apart so the chat page stays readable. The script uses the page's helpers
 * ($, el, icon, post, act, openM, closeM, L, token, unpair) and builds everything with
 * textContent: names, file contents and terminal output are never parsed as HTML.
 *
 * Written with String.raw: backslashes reach the page as typed. No backticks and no
 * "dollar + brace" in here (they would end or interpolate the template).
 */

export const TOOLS_TEXT = {
  es: {
    files: 'Archivos',
    terminal: 'Terminal',
    gitTitle: 'Git',
    tools: 'Computadora',
    loading: 'Cargando…',
    newFile: 'Nuevo archivo',
    newFolder: 'Nueva carpeta',
    namePrompt: 'Nombre (puede llevar carpetas: src/nuevo.ts):',
    renamePrompt: 'Nuevo nombre o ruta:',
    rename: 'Renombrar',
    trash: 'A la papelera',
    trashConfirm: '¿Mandar a la papelera de la computadora?',
    openPc: 'Abrir en la PC',
    openedPc: 'Abierto en la computadora',
    download: 'Descargar',
    askAi: 'Preguntar a la IA',
    askAbout: 'Sobre el archivo ',
    copyPath: 'Copiar ruta',
    edit: 'Editar',
    saveFile: 'Guardar',
    savedFile: 'Guardado ✓',
    unsaved: 'Hay cambios sin guardar. ¿Salir sin guardar?',
    binaryFile: 'Este archivo no es de texto.',
    bigFile: 'Este archivo es muy grande para verlo aquí. Puedes descargarlo.',
    emptyDir: 'Carpeta vacía',
    searchFiles: 'Buscar archivos por nombre…',
    noResults: 'Sin resultados',
    root: 'Proyecto',
    up: 'Subir',
    wrap: 'Ajustar líneas',
    lines: 'líneas',
    newTerm: 'Nueva',
    termPc: 'PC',
    termPhone: 'Celular',
    termEnded: 'La terminal terminó.',
    termClose: 'Cerrar',
    termCloseConfirm: '¿Cerrar esta terminal? Se detiene lo que esté ejecutando.',
    termCmd: 'Escribe un comando…',
    termNone: 'No hay terminales abiertas. Abre una nueva.',
    termNote: 'Lo que escribes se ejecuta en tu computadora.',
    termPcNote: 'Es la terminal de la computadora: lo que escribas también aparece allí.',
    termRun: 'Ejecutar',
    changes: 'Cambios',
    noChanges: 'Sin cambios: todo está guardado en git.',
    commitMsg: 'Mensaje del commit…',
    commitAll: 'Commit de todo',
    committed: 'Commit hecho ✓',
    aiCommit: 'Que la IA haga el commit',
    aiCommitPrompt:
      'Revisa los cambios de git del proyecto y haz un commit con un buen mensaje (no hagas push).',
    history: 'Historial',
    notRepo: 'Esta carpeta no es un repositorio git.',
    staged: 'preparado',
    untracked: 'nuevo',
    diffEmpty: 'Sin diferencias para mostrar.',
    fetchB: 'Fetch',
    pullB: 'Pull',
    pushB: 'Push',
    done: 'Listo',
  },
  en: {
    files: 'Files',
    terminal: 'Terminal',
    gitTitle: 'Git',
    tools: 'Computer',
    loading: 'Loading…',
    newFile: 'New file',
    newFolder: 'New folder',
    namePrompt: 'Name (may include folders: src/new.ts):',
    renamePrompt: 'New name or path:',
    rename: 'Rename',
    trash: 'Move to bin',
    trashConfirm: 'Move it to the recycle bin of the computer?',
    openPc: 'Open on PC',
    openedPc: 'Opened on the computer',
    download: 'Download',
    askAi: 'Ask the AI',
    askAbout: 'About the file ',
    copyPath: 'Copy path',
    edit: 'Edit',
    saveFile: 'Save',
    savedFile: 'Saved ✓',
    unsaved: 'There are unsaved changes. Leave without saving?',
    binaryFile: 'This file is not text.',
    bigFile: 'This file is too big to view here. You can download it.',
    emptyDir: 'Empty folder',
    searchFiles: 'Search files by name…',
    noResults: 'No results',
    root: 'Project',
    up: 'Up',
    wrap: 'Wrap lines',
    lines: 'lines',
    newTerm: 'New',
    termPc: 'PC',
    termPhone: 'Phone',
    termEnded: 'The terminal ended.',
    termClose: 'Close',
    termCloseConfirm: 'Close this terminal? Whatever runs in it stops.',
    termCmd: 'Type a command…',
    termNone: 'No terminals open. Open a new one.',
    termNote: 'What you type runs on your computer.',
    termPcNote: 'This is the computer’s terminal: what you type shows there too.',
    termRun: 'Run',
    changes: 'Changes',
    noChanges: 'No changes: everything is committed.',
    commitMsg: 'Commit message…',
    commitAll: 'Commit everything',
    committed: 'Committed ✓',
    aiCommit: 'Let the AI commit',
    aiCommitPrompt:
      'Review the git changes of the project and commit them with a good message (do not push).',
    history: 'History',
    notRepo: 'This folder is not a git repository.',
    staged: 'staged',
    untracked: 'new',
    diffEmpty: 'No differences to show.',
    fetchB: 'Fetch',
    pullB: 'Pull',
    pushB: 'Push',
    done: 'Done',
  },
} as const;

export const TOOLS_ICONS = String.raw`
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
`;

export const TOOLS_CSS = String.raw`
/* Drawer: the computer's tools */
.dtools{display:flex;flex-direction:column;margin:0 8px}
.dtools button{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;text-align:left;font-size:14px;background:transparent;color:var(--fg)}
.dtools button:active{background:var(--hover)}
.dtools svg{color:var(--fg-dim)}
/* Files */
.fbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.fbar button{padding:7px 10px;font-size:13px}
.crumbs{display:flex;gap:2px;align-items:center;overflow-x:auto;scrollbar-width:none;font-size:13px;color:var(--fg-dim);white-space:nowrap}
.crumbs::-webkit-scrollbar{display:none}
.crumbs button{background:transparent;padding:4px 6px;color:var(--fg);flex:none}
.crumbs button:last-child{color:var(--strong);font-weight:600}
.fsearch{width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-2);outline:0}
.flist{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg-2)}
.fitem{display:flex;align-items:center;gap:10px;padding:10px 6px 10px 12px;border-bottom:1px solid var(--border);min-height:48px}
.fitem:last-child{border-bottom:0}
.fitem .fmain{flex:1;min-width:0;display:flex;flex-direction:column;background:transparent;padding:0;text-align:left;border:0;border-radius:0}
.fitem .fname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--strong);font-size:14px}
.fitem .fmeta{font-size:11.5px;color:var(--fg-dim)}
.fitem svg{color:var(--fg-dim)}
.fitem.dir svg{color:var(--brand)}
.fitem .icon{width:36px;height:36px}
.facts{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px 40px;border-bottom:1px solid var(--border)}
.facts button{padding:6px 10px;font-size:12.5px;background:var(--bg-3)}
.fview{margin:0;flex:1;min-height:200px;white-space:pre;overflow:auto;font:12.5px/1.55 ui-monospace,"JetBrains Mono",Menlo,monospace;background:var(--code);border:1px solid var(--border);border-radius:8px;padding:10px;counter-reset:ln}
.fview.wrap{white-space:pre-wrap;word-break:break-word}
.fedit{flex:1;min-height:55vh;width:100%;resize:none;font:13px/1.55 ui-monospace,"JetBrains Mono",Menlo,monospace;background:var(--code);color:var(--fg);border:1px solid var(--brand);border-radius:8px;padding:10px;outline:0;white-space:pre;overflow:auto;tab-size:2}
.fimg{max-width:100%;border-radius:8px;border:1px solid var(--border);background:repeating-conic-gradient(#8884 0 25%,transparent 0 50%) 0 0/16px 16px}
.okmsg{color:var(--ok);font-size:13px}
.errmsg{color:var(--danger);font-size:13px;white-space:pre-wrap}

/* Terminal */
#msheet.term .sbody{padding:0;gap:0;overflow:hidden}
.tbar{display:flex;gap:6px;padding:8px 10px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--border);flex:none}
.tbar::-webkit-scrollbar{display:none}
.tscreen{flex:1;min-height:0;margin:0;overflow:auto;background:#0d0e11;color:#d4d7de;font:var(--tfs,12px)/1.35 ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;padding:8px;white-space:pre;border:0;border-radius:0}
.tscreen.wrap{white-space:pre-wrap;word-break:break-all}
.tscreen .bo{font-weight:700}
.tscreen .cur{background:#d4d7de;color:#0d0e11}
.tscreen .iv{background:#d4d7de;color:#0d0e11}
.f0{color:#3b3f48}.f1{color:#f1595b}.f2{color:#83d6a0}.f3{color:#e0b341}.f4{color:#6c9cff}.f5{color:#c678dd}.f6{color:#56c2d6}.f7{color:#d4d7de}
.f8{color:#7a808c}.f9{color:#ff7b7d}.f10{color:#a5f0bf}.f11{color:#f5d36b}.f12{color:#93b7ff}.f13{color:#e09cf0}.f14{color:#8ee3f0}.f15{color:#fff}
.b0{background:#3b3f48}.b1{background:#a5282a}.b2{background:#2d7a49}.b3{background:#8a6d00}.b4{background:#2d4f9e}.b5{background:#7d3b8c}.b6{background:#1f7b8a}.b7{background:#9aa0aa}
.b8{background:#555}.b9{background:#c94446}.b10{background:#3d9a5e}.b11{background:#a8891a}.b12{background:#4a6fd0}.b13{background:#9c53ad}.b14{background:#2d9aab}.b15{background:#ccc}
.tkeys{display:flex;gap:6px;padding:6px 8px;overflow-x:auto;scrollbar-width:none;background:var(--bg-2);border-top:1px solid var(--border);flex:none}
.tkeys::-webkit-scrollbar{display:none}
.tkeys button{flex:none;padding:7px 11px;font:12.5px ui-monospace,Menlo,monospace;background:var(--bg-3)}
.tin{display:flex;gap:6px;padding:8px;padding-bottom:max(8px,env(safe-area-inset-bottom));background:var(--bg-2);flex:none}
.tin input{flex:1;min-width:0;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);outline:0;font:14px ui-monospace,Menlo,monospace}
.tnote{font-size:11.5px;color:var(--fg-dim);padding:4px 10px;background:var(--bg-2);flex:none}
.thist{display:flex;gap:6px;padding:0 8px 6px;overflow-x:auto;scrollbar-width:none;background:var(--bg-2);flex:none}
.thist::-webkit-scrollbar{display:none}
.thist button{flex:none;padding:4px 10px;font:12px ui-monospace,Menlo,monospace;border-radius:999px;background:var(--bg-3);max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Git */
.gcard{border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--bg-2);display:flex;flex-direction:column;gap:8px}
.gcard textarea{width:100%;min-height:70px;resize:vertical;padding:9px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);outline:0}
.grow{display:flex;gap:6px;flex-wrap:wrap}
.grow button{flex:1;padding:9px 6px;font-size:13.5px}
.gfile{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);background:transparent;border-radius:0;text-align:left;width:100%}
.gfile:last-child{border-bottom:0}
.gcode{font:600 12px ui-monospace,Menlo,monospace;width:26px;flex:none;color:var(--warn)}
.gcode.a{color:var(--ok)}.gcode.d{color:var(--danger)}
.gpath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-size:13.5px}
.diff{margin:0;white-space:pre;overflow:auto;font:12px/1.5 ui-monospace,Menlo,monospace;background:var(--code);border:1px solid var(--border);border-radius:8px;padding:8px 0}
.diff span{display:block;padding:0 10px;min-width:max-content}
.diff .add{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
.diff .del{background:color-mix(in srgb,var(--danger) 16%,transparent);color:var(--danger)}
.diff .hunk{color:var(--brand)}
.commit{display:flex;flex-direction:column;padding:8px 12px;border-bottom:1px solid var(--border)}
.commit:last-child{border-bottom:0}
.commit b{font-weight:500;color:var(--strong);font-size:13.5px}
.commit small{color:var(--fg-dim);font-size:11.5px}
`;

export const TOOLS_JS = String.raw`
// ---------------- Computer tools: files, terminal, git ----------------
async function apiGet(path) {
  const r = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) { unpair(); throw new Error(L.noComputer); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || L.noComputer);
  return d;
}
async function apiPost(path, data) {
  const r = await post(path, data);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || L.noComputer);
  return d;
}
const enc = encodeURIComponent;
function baseName(p) { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
function dirName(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function joinPath(a, b) { return a ? a + '/' + b : b; }
function bytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function when(ms) { return ms ? new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''; }
function msg(box, text, bad) {
  const m = el('div', bad ? 'errmsg' : 'okmsg', text);
  box.append(m);
  if (!bad) setTimeout(() => m.remove(), 2500);
  return m;
}
function btn(text, cls, onclick) { const b = el('button', cls || '', text); b.onclick = onclick; return b; }

/** What the computer lets the phone use (the drawer hides the rest). */
let caps = { files: true, terminal: true, git: true };
function loadCaps() {
  apiGet('/api/caps').then((c) => {
    caps = c;
    $('files2').classList.toggle('hide', !c.files);
    $('term2').classList.toggle('hide', !c.terminal);
    $('git2').classList.toggle('hide', !c.git);
    $('config2').classList.toggle('hide', c.config === false);
  }).catch(() => undefined);
}

// ---- Files ----
let fdir = '';
let fdirty = false;
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' };
async function rawBlob(path) {
  const r = await fetch('/api/files/raw?path=' + enc(path), { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || L.noComputer);
  const ext = (path.split('.').pop() || '').toLowerCase();
  return new Blob([await r.arrayBuffer()], { type: MIME[ext] || 'application/octet-stream' });
}
async function download(path) {
  const b = await rawBlob(path);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = baseName(path);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
function askAbout(path) {
  closeM();
  const t = $('text');
  t.value = L.askAbout + path + ': ' + t.value;
  grow();
  saveDraft();
  t.focus();
}
function crumbs(dir, onPick) {
  const c = el('div', 'crumbs');
  c.append(btn(L.root, '', () => onPick('')));
  let acc = '';
  for (const part of dir ? dir.split('/') : []) {
    acc = joinPath(acc, part);
    const to = acc;
    c.append('/', btn(part, '', () => onPick(to)));
  }
  return c;
}
function fileActions(e, box, refresh) {
  const row = el('div', 'facts');
  if (!e.dir) {
    row.append(btn(L.openPc, '', async () => { await act({ kind: 'openFile', path: e.path }); msg(row, L.openedPc); }));
    row.append(btn(L.download, '', () => download(e.path).catch((x) => msg(row, x.message, true))));
    row.append(btn(L.askAi, '', () => askAbout(e.path)));
  }
  row.append(btn(L.rename, '', async () => {
    const to = prompt(L.renamePrompt, e.path);
    if (!to || to === e.path) return;
    try { await apiPost('/api/files/rename', { from: e.path, to: to.replace(/^\/+/, '') }); refresh(); } catch (x) { msg(row, x.message, true); }
  }));
  const cp = btn(L.copyPath, '', () => { copyText(e.path, cp); setTimeout(() => { cp.textContent = L.copyPath; }, 1500); });
  row.append(cp);
  row.append(btn(L.trash, 'danger', async () => {
    if (!confirm(L.trashConfirm + '\n\n' + e.path)) return;
    try { await apiPost('/api/files/trash', { path: e.path }); refresh(); } catch (x) { msg(row, x.message, true); }
  }));
  return row;
}
function fileRow(e, refresh) {
  const wrap = document.createDocumentFragment();
  const r = el('div', 'fitem' + (e.dir ? ' dir' : ''));
  const main = el('button', 'fmain');
  main.append(el('span', 'fname', e.name));
  const meta = e.dir ? '' : [bytes(e.size), when(e.mtime)].filter(Boolean).join(' · ');
  if (meta || e.sub) main.append(el('span', 'fmeta', e.sub || meta));
  main.onclick = () => (e.dir ? openFiles(e.path) : viewFile(e.path));
  const more = el('button', 'icon');
  more.setAttribute('aria-label', '…');
  more.append(icon('dots'));
  let acts = null;
  more.onclick = () => {
    if (acts) { acts.remove(); acts = null; return; }
    acts = fileActions(e, r, refresh);
    r.after(acts);
  };
  r.append(icon(e.dir ? 'folder' : 'file'), main, more);
  wrap.append(r);
  return wrap;
}
async function openFiles(dir) {
  if (dir == null) dir = fdir;
  fdir = dir;
  mview = 'files';
  const box = openM(L.files);
  const top = el('div', 'fbar');
  const nav = crumbs(dir, (d) => openFiles(d));
  nav.style.flex = '1';
  top.append(nav);
  box.append(top);
  const search = el('input', 'fsearch');
  search.type = 'search';
  search.placeholder = L.searchFiles;
  box.append(search);
  const bar = el('div', 'fbar');
  if (dir) bar.append(btn('↑ ' + L.up, '', () => openFiles(dirName(dir))));
  const make = (isDir) => async () => {
    const name = prompt(L.namePrompt, '');
    if (!name || !name.trim()) return;
    const path = joinPath(dir, name.trim().replace(/^\/+/, ''));
    try {
      await apiPost('/api/files/create', { path, dir: isDir });
      if (isDir) openFiles(path); else viewFile(path, true);
    } catch (x) { msg(box, x.message, true); }
  };
  bar.append(btn('+ ' + L.newFile, '', make(false)), btn('+ ' + L.newFolder, '', make(true)));
  box.append(bar);
  const list = el('div', 'flist');
  const status = el('p', 'hint', L.loading);
  box.append(status, list);
  const refresh = () => openFiles(dir);
  try {
    const d = await apiGet('/api/files/list?path=' + enc(dir));
    if (mview !== 'files' || fdir !== dir) return;
    $('mtitle').textContent = L.files + ' · ' + d.name;
    status.remove();
    if (!d.entries.length) list.replaceWith(el('p', 'hint', L.emptyDir));
    for (const e of d.entries) list.append(fileRow(e, refresh));
  } catch (x) { status.className = 'errmsg'; status.textContent = x.message; list.remove(); }
  let timer = 0;
  search.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = search.value.trim();
      if (!q) return refresh();
      try {
        const d = await apiGet('/api/files/find?q=' + enc(q));
        if (mview !== 'files') return;
        list.textContent = '';
        if (!list.isConnected) box.append(list);
        if (!d.paths.length) list.append(el('div', 'fitem', L.noResults));
        for (const p of d.paths) list.append(fileRow({ name: baseName(p), path: p, dir: false, sub: dirName(p) || '/' }, refresh));
      } catch (x) { msg(box, x.message, true); }
    }, 300);
  };
}
async function viewFile(path, editNow) {
  mview = 'file';
  fdirty = false;
  const box = openM(baseName(path));
  const bar = el('div', 'fbar');
  const back = btn('← ' + L.files, '', () => { if (!fdirty || confirm(L.unsaved)) openFiles(dirName(path)); });
  bar.append(back);
  box.append(el('div', 'hint', path), bar);
  const status = el('p', 'hint', L.loading);
  box.append(status);
  bar.append(btn(L.openPc, '', async () => { await act({ kind: 'openFile', path }); msg(bar, L.openedPc); }));
  bar.append(btn(L.askAi, '', () => askAbout(path)));
  bar.append(btn(L.download, '', () => download(path).catch((x) => msg(box, x.message, true))));
  try {
    if (IMG.test(path)) {
      const b = await rawBlob(path);
      if (mview !== 'file') return;
      const img = el('img', 'fimg');
      img.src = URL.createObjectURL(b);
      img.alt = baseName(path);
      status.textContent = bytes(b.size);
      box.append(img);
      return;
    }
    const d = await apiGet('/api/files/read?path=' + enc(path));
    if (mview !== 'file') return;
    if (d.binary || d.tooLarge) { status.textContent = (d.binary ? L.binaryFile : L.bigFile) + ' (' + bytes(d.size) + ')'; return; }
    const n = d.content ? d.content.split('\n').length : 0;
    status.textContent = bytes(d.size) + ' · ' + n + ' ' + L.lines;
    const view = el('pre', 'fview', d.content);
    const wrapOn = localStorage.getItem('zx.fwrap') === '1';
    view.classList.toggle('wrap', wrapOn);
    const wrapB = btn(L.wrap, wrapOn ? 'primary' : '', () => {
      const on = !view.classList.contains('wrap');
      view.classList.toggle('wrap', on);
      wrapB.className = on ? 'primary' : '';
      localStorage.setItem('zx.fwrap', on ? '1' : '0');
    });
    let editor = null;
    let saved = d.content;
    const save = btn(L.saveFile, 'primary hide', async () => {
      save.disabled = true;
      try {
        await apiPost('/api/files/write', { path, content: editor.value });
        saved = editor.value;
        fdirty = false;
        view.textContent = saved;
        msg(bar, L.savedFile);
      } catch (x) { msg(box, x.message, true); }
      finally { save.disabled = false; }
    });
    const edit = btn(L.edit, '', () => {
      if (editor) return;
      editor = el('textarea', 'fedit');
      editor.value = saved;
      editor.spellcheck = false;
      editor.setAttribute('autocapitalize', 'off');
      editor.setAttribute('autocorrect', 'off');
      editor.oninput = () => { fdirty = editor.value !== saved; };
      // Tab inserts two spaces instead of leaving the box.
      editor.onkeydown = (e) => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
        fdirty = true;
      };
      view.replaceWith(editor);
      edit.classList.add('hide');
      wrapB.classList.add('hide');
      save.classList.remove('hide');
      editor.focus();
    });
    bar.prepend(back, save, edit, wrapB);
    box.append(view);
    if (editNow) edit.click();
  } catch (x) { status.className = 'errmsg'; status.textContent = x.message; }
}

// ---- Terminal: a small screen emulator (enough for shells, git, npm, ConPTY repaints) ----
function Emu(cols, rows) {
  this.cols = cols; this.rows = rows;
  this.lines = [[]]; this.base = 0; this.x = 0; this.y = 0;
  this.st = 0; this.p = ''; this.fg = null; this.bg = null; this.bo = false; this.iv = false;
  this.cls = ''; this.saved = null; this.alt = null; this.title = '';
}
Emu.prototype.style = function () {
  const c = [];
  if (this.fg != null) c.push('f' + this.fg);
  if (this.bg != null) c.push('b' + this.bg);
  if (this.bo) c.push('bo');
  if (this.iv) c.push('iv');
  this.cls = c.join(' ');
};
Emu.prototype.line = function (y) {
  const i = this.base + (y == null ? this.y : y);
  while (this.lines.length <= i) this.lines.push([]);
  return this.lines[i];
};
Emu.prototype.lf = function () {
  this.y++;
  if (this.y >= this.rows) { this.y = this.rows - 1; this.base++; }
  this.line();
  if (this.lines.length > 4000) {
    const cut = this.lines.length - 4000;
    this.lines.splice(0, cut);
    this.base = Math.max(0, this.base - cut);
  }
};
Emu.prototype.put = function (ch) {
  if (this.x >= this.cols) { this.x = 0; this.lf(); }
  const l = this.line();
  while (l.length < this.x) l.push([' ', '']);
  l[this.x] = [ch, this.cls];
  this.x++;
};
Emu.prototype.blank = function (l, from, to) {
  for (let i = from; i < Math.min(to, l.length); i++) l[i] = [' ', ''];
};
Emu.prototype.sgr = function (a) {
  if (!a.length) a = [0];
  for (let i = 0; i < a.length; i++) {
    const n = isNaN(a[i]) ? 0 : a[i];
    if (n === 0) { this.fg = this.bg = null; this.bo = this.iv = false; }
    else if (n === 1) this.bo = true;
    else if (n === 22) this.bo = false;
    else if (n === 7) this.iv = true;
    else if (n === 27) this.iv = false;
    else if (n >= 30 && n <= 37) this.fg = n - 30;
    else if (n >= 90 && n <= 97) this.fg = n - 82;
    else if (n === 39) this.fg = null;
    else if (n >= 40 && n <= 47) this.bg = n - 40;
    else if (n >= 100 && n <= 107) this.bg = n - 92;
    else if (n === 49) this.bg = null;
    else if (n === 38 || n === 48) {
      let v = null;
      if (a[i + 1] === 5) { v = a[i + 2] < 16 ? a[i + 2] : null; i += 2; }
      else if (a[i + 1] === 2) { i += 4; }
      if (n === 38) this.fg = v; else this.bg = v;
    }
  }
  this.style();
};
const BQ = String.fromCharCode(96);
Emu.prototype.csi = function (f, p) {
  const priv = p[0] === '?';
  const a = (priv ? p.slice(1) : p).split(';').map((s) => parseInt(s, 10));
  const n = a[0] || 1;
  const z = a[0] || 0;
  const R = this.rows - 1, C = this.cols - 1;
  switch (f) {
    case 'A': this.y = Math.max(0, this.y - n); break;
    case 'B': this.y = Math.min(R, this.y + n); break;
    case 'C': this.x = Math.min(C, this.x + n); break;
    case 'D': this.x = Math.max(0, Math.min(this.x, this.cols) - n); break;
    case 'E': this.x = 0; this.y = Math.min(R, this.y + n); break;
    case 'F': this.x = 0; this.y = Math.max(0, this.y - n); break;
    case 'G': case BQ: this.x = Math.min(C, n - 1); break;
    case 'd': this.y = Math.min(R, n - 1); break;
    case 'H': case 'f': this.y = Math.min(R, (a[0] || 1) - 1); this.x = Math.min(C, (a[1] || 1) - 1); break;
    case 'J': {
      if (z === 3) { this.lines.splice(0, this.base); this.base = 0; break; }
      const from = z === 0 ? this.y + 1 : 0, to = z === 1 ? this.y : this.rows;
      for (let y = from; y < to; y++) { const i = this.base + y; if (i < this.lines.length) this.lines[i] = []; }
      const l = this.line();
      if (z === 0) l.length = Math.min(l.length, this.x);
      else if (z === 1) this.blank(l, 0, this.x + 1);
      else l.length = 0;
      break;
    }
    case 'K': {
      const l = this.line();
      if (z === 0) l.length = Math.min(l.length, this.x);
      else if (z === 1) this.blank(l, 0, this.x + 1);
      else l.length = 0;
      break;
    }
    case 'X': this.blank(this.line(), this.x, this.x + n); break;
    case 'P': this.line().splice(this.x, n); break;
    case '@': { const l = this.line(); if (l.length > this.x) l.splice(this.x, 0, ...Array.from({ length: n }, () => [' ', ''])); break; }
    case 'L': case 'M': {
      this.line(R);
      const at = this.base + this.y, end = this.base + this.rows;
      for (let k = 0; k < n; k++) {
        if (f === 'L') { this.lines.splice(at, 0, []); this.lines.splice(end, 1); }
        else { this.lines.splice(at, 1); this.lines.splice(end - 1, 0, []); }
      }
      break;
    }
    case 'S': for (let k = 0; k < n; k++) { this.base++; this.line(R); } break;
    case 'm': this.sgr(a); break;
    case 's': this.saved = [this.x, this.y]; break;
    case 'u': if (this.saved) { this.x = this.saved[0]; this.y = this.saved[1]; } break;
    case 'h': case 'l':
      if (priv && a.some((m) => m === 1049 || m === 1047 || m === 47)) {
        if (f === 'h' && !this.alt) { this.alt = [this.lines, this.base, this.x, this.y]; this.lines = [[]]; this.base = 0; this.x = 0; this.y = 0; }
        else if (f === 'l' && this.alt) { [this.lines, this.base, this.x, this.y] = this.alt; this.alt = null; }
      }
      break;
  }
};
Emu.prototype.write = function (s) {
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (this.st === 0) {
      if (c === 27) this.st = 1;
      else if (c === 13) this.x = 0;
      else if (c === 10 || c === 11 || c === 12) this.lf();
      else if (c === 8) this.x = Math.max(0, Math.min(this.x, this.cols) - 1);
      else if (c === 9) this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
      else if (c === 7 || c < 32 || c === 127) { /* bell and other controls */ }
      else this.put(ch);
    } else if (this.st === 1) {
      if (ch === '[') { this.st = 2; this.p = ''; }
      else if (ch === ']') { this.st = 3; this.p = ''; }
      else if (ch === '(' || ch === ')' || ch === '#' || ch === '%') this.st = 5;
      else if (ch === '7') { this.saved = [this.x, this.y]; this.st = 0; }
      else if (ch === '8') { if (this.saved) { this.x = this.saved[0]; this.y = this.saved[1]; } this.st = 0; }
      else if (ch === 'M') { if (this.y > 0) this.y--; this.st = 0; }
      else if (ch === 'c') { this.lines = [[]]; this.base = 0; this.x = this.y = 0; this.st = 0; }
      else this.st = 0;
    } else if (this.st === 2) {
      if (c >= 0x40 && c <= 0x7e) { this.csi(ch, this.p); this.st = 0; }
      else if (this.p.length < 64) this.p += ch;
      else this.st = 0;
    } else if (this.st === 3) {
      if (c === 7) { this.osc(); this.st = 0; }
      else if (c === 27) this.st = 4;
      else if (this.p.length < 512) this.p += ch;
    } else if (this.st === 4) { this.osc(); this.st = 0; }
    else this.st = 0;
  }
};
Emu.prototype.osc = function () {
  const m = /^[02];(.*)$/.exec(this.p);
  if (m) this.title = m[1].slice(0, 120);
};
/** The screen as text nodes and spans (one span per run of the same colors). */
Emu.prototype.paint = function (pre, alive) {
  const f = document.createDocumentFragment();
  const cy = this.base + this.y;
  let last = this.lines.length - 1;
  while (last > cy && !this.lines[last].length) last--;
  const first = Math.max(0, last - 1500);
  for (let i = first; i <= last; i++) {
    const l = this.lines[i];
    let run = '', cls = null;
    const flush = () => {
      if (!run) return;
      if (cls) f.append(el('span', cls, run)); else f.append(run);
      run = '';
    };
    const n = i === cy && alive ? Math.max(l.length, this.x + 1) : l.length;
    for (let x = 0; x < n; x++) {
      const cell = l[x] || [' ', ''];
      const k = i === cy && x === this.x && alive ? 'cur' : cell[1];
      if (k !== cls) { flush(); cls = k; }
      run += cell[0];
    }
    flush();
    if (i < last) f.append('\n');
  }
  pre.textContent = '';
  pre.append(f);
};

let tgen = 0;
let tcur = null;
function termHist() { try { return JSON.parse(localStorage.getItem('zx.thist') || '[]'); } catch { return []; } }
function termSize() {
  const fs = parseFloat(localStorage.getItem('zx.tfs') || '12');
  const cw = fs * 0.61, lh = fs * 1.35;
  return {
    cols: Math.max(30, Math.min(200, Math.floor((window.innerWidth - 18) / cw))),
    rows: Math.max(10, Math.min(80, Math.floor((window.innerHeight - 230) / lh))),
  };
}
async function openTerm(id) {
  mview = 'term';
  // openM ends the reading of the terminal shown before (tgen changes).
  const box = openM(L.terminal);
  const gen = tgen;
  $('msheet').classList.add('term');
  const bar = el('div', 'tbar');
  const screen = el('pre', 'tscreen');
  const fs = localStorage.getItem('zx.tfs') || '12';
  screen.style.setProperty('--tfs', fs + 'px');
  if (localStorage.getItem('zx.twrap') === '1') screen.classList.add('wrap');
  const note = el('div', 'tnote', L.termNote);
  const keys = el('div', 'tkeys');
  const hist = el('div', 'thist');
  const inrow = el('div', 'tin');
  const input = el('input');
  input.type = 'text';
  input.placeholder = L.termCmd;
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('enterkeyhint', 'send');
  const run = el('button', 'primary', L.termRun);
  inrow.append(input, run);
  box.append(bar, screen, note, keys, hist, inrow);
  let terms = [];
  try { terms = (await apiGet('/api/terms')).terms; }
  catch (x) { screen.textContent = x.message; return; }
  if (gen !== tgen) return;
  const pick = terms.find((t) => t.id === id) || terms.find((t) => tcur && t.id === tcur.id) || terms[terms.length - 1];
  for (const t of terms) {
    const c = el('button', 'chip' + (pick && t.id === pick.id ? ' on' : ''), t.name + ' · ' + (t.phone ? L.termPhone : L.termPc));
    c.onclick = () => openTerm(t.id);
    bar.append(c);
  }
  const add = el('button', 'chip', '+ ' + L.newTerm);
  add.onclick = async () => {
    try { const t = await apiPost('/api/term/new', termSize()); openTerm(t.id); }
    catch (x) { screen.textContent = x.message; }
  };
  bar.append(add);
  tcur = pick || null;
  if (!pick) { screen.textContent = L.termNone; for (const e of [keys, hist, inrow]) e.classList.add('hide'); return; }
  if (!pick.phone) note.textContent = L.termPcNote;
  const send = (data) => apiPost('/api/term/write', { id: pick.id, data }).catch((x) => { note.textContent = x.message; });
  const KEYS = [
    ['Ctrl+C', '\x03'], ['Tab', '\t'], ['Esc', '\x1b'], ['↑', '\x1b[A'], ['↓', '\x1b[B'],
    ['←', '\x1b[D'], ['→', '\x1b[C'], ['Enter', '\r'], ['Ctrl+D', '\x04'], ['Ctrl+L', '\x0c'],
    ['Ctrl+Z', '\x1a'], ['y', 'y\r'], ['n', 'n\r'], ['q', 'q'],
  ];
  for (const [label, data] of KEYS) keys.append(btn(label, '', () => send(data)));
  const zoom = (d) => {
    const v = Math.max(8, Math.min(20, parseFloat(localStorage.getItem('zx.tfs') || '12') + d));
    localStorage.setItem('zx.tfs', String(v));
    screen.style.setProperty('--tfs', v + 'px');
  };
  keys.append(btn('A−', '', () => zoom(-1)), btn('A+', '', () => zoom(1)));
  keys.append(btn('↵ ' + L.wrap, '', () => {
    const on = screen.classList.toggle('wrap');
    localStorage.setItem('zx.twrap', on ? '1' : '0');
  }));
  if (pick.phone) {
    keys.append(btn(L.termClose, 'danger', async () => {
      if (!confirm(L.termCloseConfirm)) return;
      await apiPost('/api/term/kill', { id: pick.id }).catch(() => undefined);
      tcur = null;
      openTerm();
    }));
  }
  const drawHist = () => {
    hist.textContent = '';
    for (const c of termHist()) hist.append(btn(c, '', () => { input.value = c; input.focus(); }));
    hist.classList.toggle('hide', !hist.children.length);
  };
  drawHist();
  const submit = () => {
    const v = input.value;
    send(v + '\r');
    if (v.trim()) {
      const h = termHist().filter((x) => x !== v);
      h.unshift(v);
      localStorage.setItem('zx.thist', JSON.stringify(h.slice(0, 25)));
      drawHist();
    }
    input.value = '';
  };
  run.onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } };
  // Phone shells follow the screen of the phone.
  if (pick.phone) {
    const s = termSize();
    if (s.cols !== pick.cols || s.rows !== pick.rows) apiPost('/api/term/resize', { id: pick.id, cols: s.cols, rows: s.rows }).catch(() => undefined);
  }
  const emu = new Emu(pick.cols, pick.rows);
  let since = 0, frame = 0, alive = pick.alive;
  const paint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const atEnd = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 40;
      emu.paint(screen, alive);
      if (atEnd) screen.scrollTop = screen.scrollHeight;
      if (emu.title) $('mtitle').textContent = L.terminal + ' · ' + emu.title;
    });
  };
  while (gen === tgen && token) {
    try {
      const d = await apiGet('/api/term/read?id=' + pick.id + '&since=' + since);
      if (gen !== tgen) return;
      emu.cols = d.cols;
      emu.rows = d.rows;
      if (d.data) emu.write(d.data);
      since = d.next;
      alive = d.alive;
      paint();
      if (!d.alive) { note.textContent = L.termEnded; inrow.classList.add('hide'); return; }
    } catch (x) {
      if (gen !== tgen) return;
      note.textContent = x.message;
      if (/existe|exists/.test(x.message)) return;
      await new Promise((ok) => setTimeout(ok, 2500));
    }
  }
}

// ---- Git ----
function gitCode(f) {
  if (f.untracked) return ['U', 'a'];
  const c = (f.index !== ' ' && f.index !== '?' ? f.index : f.work) || 'M';
  return [c, c === 'A' ? 'a' : c === 'D' ? 'd' : ''];
}
async function openGit() {
  mview = 'git';
  const box = openM(L.gitTitle);
  const status = el('p', 'hint', L.loading);
  box.append(status);
  let st;
  try { st = await apiGet('/api/git/status'); }
  catch (x) { status.className = 'errmsg'; status.textContent = x.message; return; }
  if (mview !== 'git') return;
  if (!st.isRepo) { status.textContent = L.notRepo; return; }
  status.remove();
  const head = el('div', 'gcard');
  const br = [st.branch || '?', st.upstream ? '→ ' + st.upstream : '', st.ahead ? '↑' + st.ahead : '', st.behind ? '↓' + st.behind : ''].filter(Boolean).join('  ');
  head.append(el('b', '', br));
  const out = el('div', 'hint');
  const sync = el('div', 'grow');
  const all = [];
  for (const [op, label] of [['fetch', L.fetchB], ['pull', L.pullB], ['push', L.pushB]]) {
    const b = btn(label, op === 'push' ? 'primary' : '', async () => {
      for (const x of all) x.disabled = true;
      out.className = 'hint';
      out.textContent = L.loading;
      try {
        const d = await apiPost('/api/git/sync', { op });
        await openGit();
        const o = document.querySelector('.gout');
        if (o) o.textContent = (d.output || '').trim() || L.done;
      } catch (x) { out.className = 'errmsg'; out.textContent = x.message; }
      finally { for (const x of all) x.disabled = false; }
    });
    all.push(b);
    sync.append(b);
  }
  out.classList.add('gout');
  head.append(sync, out);
  box.append(head);

  box.append(el('div', 'stitle', L.changes + ' (' + st.files.length + ')'));
  if (!st.files.length) box.append(el('p', 'hint', L.noChanges));
  else {
    const cm = el('div', 'gcard');
    const ta = el('textarea');
    ta.placeholder = L.commitMsg;
    ta.value = localStorage.getItem('zx.cmsg') || '';
    ta.oninput = () => localStorage.setItem('zx.cmsg', ta.value);
    const row = el('div', 'grow');
    const res = el('div', 'hint');
    const doCommit = btn(L.commitAll, 'primary', async () => {
      if (!ta.value.trim()) return void ta.focus();
      doCommit.disabled = true;
      try {
        await apiPost('/api/git/commit', { message: ta.value });
        localStorage.removeItem('zx.cmsg');
        openGit().then(() => { const o = document.querySelector('.gout'); if (o) o.textContent = L.committed; });
      } catch (x) { res.className = 'errmsg'; res.textContent = x.message; }
      finally { doCommit.disabled = false; }
    });
    const ai = btn(L.aiCommit, '', () => { closeM(); act({ kind: 'send', text: L.aiCommitPrompt }); });
    row.append(doCommit, ai);
    cm.append(ta, row, res);
    box.append(cm);
    const list = el('div', 'flist');
    for (const f of st.files.slice(0, 500)) {
      const [code, k] = gitCode(f);
      const b = el('button', 'gfile');
      b.append(el('span', 'gcode ' + k, code), el('span', 'gpath', f.path));
      if (f.index !== ' ' && f.index !== '?' && !f.untracked) b.append(el('small', 'hint', L.staged));
      b.onclick = () => openDiff(f.path);
      list.append(b);
    }
    box.append(list);
  }
  box.append(el('div', 'stitle', L.history));
  const hl = el('div', 'flist');
  box.append(hl);
  apiGet('/api/git/log').then((d) => {
    for (const c of d.commits) {
      const r = el('div', 'commit');
      r.append(el('b', '', c.subject), el('small', '', c.short + ' · ' + c.author + ' · ' + c.date + (c.refs ? ' · ' + c.refs : '')));
      hl.append(r);
    }
    if (!d.commits.length) hl.remove();
  }).catch(() => hl.remove());
}
async function openDiff(path) {
  mview = 'diff';
  const box = openM(baseName(path));
  const bar = el('div', 'fbar');
  bar.append(btn('← ' + L.gitTitle, '', openGit));
  if (caps.files) bar.append(btn(L.files, '', () => viewFile(path)), btn(L.openPc, '', async () => { await act({ kind: 'openFile', path }); msg(bar, L.openedPc); }));
  box.append(el('div', 'hint', path), bar);
  try {
    const d = await apiGet('/api/git/diff?path=' + enc(path));
    if (mview !== 'diff') return;
    if (!d.diff.trim()) return void box.append(el('p', 'hint', L.diffEmpty));
    const pre = el('pre', 'diff');
    for (const line of d.diff.split('\n')) {
      if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) continue;
      const k = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : line.startsWith('@@') ? 'hunk' : '';
      pre.append(el('span', k, line || ' '));
    }
    box.append(pre);
  } catch (x) { box.append(el('p', 'errmsg', x.message)); }
}
`;
