import { describe, expect, it } from 'vitest';
import {
  EditError,
  SRC_ATTR,
  annotate,
  isTextNode,
  parseHtml,
  sanitizeInline,
  setStyle,
  setText,
  stripMarkers,
} from '../src/main/design/htmlSource.js';
import { applyOp, opLabel } from '../src/main/design/ops.js';
import { detectProfile, htmlPages, pageName } from '../src/main/design/projectProfile.js';
import { DesignSession, type DesignFiles } from '../src/main/design/session.js';

const PAGE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Mi café</title>
  <style>h1 { color: red } /* <div> no es un elemento */</style>
  <script>if (a < b && c > d) document.write("<p>")</script>
</head>
<body>
  <!-- <section> comentado -->
  <header class="top"><h1>Bienvenidos</h1><nav><a href="/menu">Menú</a></nav></header>
  <section id="hero" data-x='a > b'>
    <p>Café <b>rico</b> y pan</p>
    <img src="foto.jpg" alt="Foto"/>
    <button type="button">Comprar</button>
  </section>
  <ul><li>Uno<li>Dos</ul>
</body>
</html>
`;

const nodes = parseHtml(PAGE);
const idx = (tag: string, n = 0) => nodes.filter((x) => x.tag === tag)[n]!.index;

describe('HTML source map', () => {
  it('numbers elements in order, skipping comments and raw text', () => {
    const tags = nodes.map((n) => n.tag);
    expect(tags).toEqual([
      'html', 'head', 'meta', 'title', 'style', 'script', 'body', 'header', 'h1', 'nav', 'a',
      'section', 'p', 'b', 'img', 'button', 'ul', 'li', 'li',
    ]);
  });

  it('knows parents, quoted ">" and implied ends', () => {
    expect(nodes[idx('h1')]!.parent).toBe(idx('header'));
    expect(nodes[idx('section')]!.attrs.find((a) => a.name === 'data-x')?.value).toBe('a > b');
    const [li1, li2] = [nodes[idx('li', 0)]!, nodes[idx('li', 1)]!];
    expect(PAGE.slice(li1.content![0], li1.content![1])).toBe('Uno');
    expect(PAGE.slice(li2.content![0], li2.content![1])).toBe('Dos');
    expect(li2.parent).toBe(idx('ul'));
  });

  it('annotates only the served copy, and stripping gives the file back', () => {
    const served = annotate(PAGE, 'index.html');
    expect(served).toContain(`<h1 ${SRC_ATTR}="index.html#${idx('h1')}">`);
    expect(served).toContain(`<img src="foto.jpg" alt="Foto" ${SRC_ATTR}="index.html#${idx('img')}"/>`);
    expect(stripMarkers(served)).toBe(PAGE);
    // The served page has the same elements, in the same order.
    expect(parseHtml(served).map((n) => n.tag)).toEqual(nodes.map((n) => n.tag));
  });

  it('tells which elements hold only text', () => {
    expect(isTextNode(PAGE, idx('h1'))).toBe(true);
    expect(isTextNode(PAGE, idx('p'))).toBe(true); // inline <b> is fine
    expect(isTextNode(PAGE, idx('section'))).toBe(false);
    expect(isTextNode(PAGE, idx('img'))).toBe(false);
  });
});

describe('edits', () => {
  it('setText rewrites only the content of that element', () => {
    const out = setText(PAGE, idx('h1'), 'Hola <i>mundo</i>');
    expect(out).toBe(PAGE.replace('<h1>Bienvenidos</h1>', '<h1>Hola <i>mundo</i></h1>'));
  });

  it('setText cleans what comes back from the preview', () => {
    expect(sanitizeInline(`a<script>x()</script><b onclick="x()" ${SRC_ATTR}="i#3">b</b><div>c</div>`)).toBe(
      'a<b>b</b>c',
    );
    expect(sanitizeInline('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeInline('<strong>sin cerrar')).toBe('<strong>sin cerrar</strong>');
  });

  it('setText refuses containers', () => {
    expect(() => setText(PAGE, idx('section'), 'x')).toThrow(EditError);
  });

  it('setStyle creates, updates and removes the style attribute', () => {
    const a = setStyle(PAGE, idx('button'), { color: '#ff0000', 'font-size': '20px' });
    expect(a).toContain('<button type="button" style="color: #ff0000; font-size: 20px">');
    const b = setStyle(a, idx('button'), { color: '#00ff00' });
    expect(b).toContain('style="color: #00ff00; font-size: 20px"');
    const c = setStyle(b, idx('button'), { color: null, 'font-size': null });
    expect(c).toBe(PAGE);
  });

  it('setStyle on a self-closed element keeps it self-closed', () => {
    const out = setStyle(PAGE, idx('img'), { 'border-radius': '8px' });
    expect(out).toContain('<img src="foto.jpg" alt="Foto" style="border-radius: 8px" />');
  });

  it('setStyle refuses values that could load or break out', () => {
    expect(() => setStyle(PAGE, idx('h1'), { background: 'url(http://x/y.png)' })).toThrow(EditError);
    expect(() => setStyle(PAGE, idx('h1'), { color: 'red" onclick="x' })).toThrow(EditError);
    expect(() => setStyle(PAGE, idx('h1'), { position: 'fixed' })).toThrow(EditError);
  });
});

describe('operations', () => {
  it('applies a style change and never writes markers', () => {
    const out = applyOp(PAGE, { kind: 'setStyle', src: `index.html#${idx('h1')}`, styles: { color: '#123456' } });
    expect(out).toContain('<h1 style="color: #123456">Bienvenidos</h1>');
    expect(out).not.toContain(SRC_ATTR);
  });

  it('a text edit may change its own inline formatting but nothing else', () => {
    const src = `index.html#${idx('p')}`;
    const out = applyOp(PAGE, { kind: 'setText', src, html: 'Café y pan' });
    expect(out).toContain('<p>Café y pan</p>');
    expect(parseHtml(out).length).toBe(nodes.length - 1);
  });

  it('labels changes in plain words', () => {
    expect(opLabel({ kind: 'setStyle', src: 'a#1', styles: { 'background-color': '#fff' } })).toBe(
      'Cambió color de fondo',
    );
    expect(opLabel({ kind: 'setStyle', src: 'a#1', styles: { padding: null } })).toBe(
      'Restableció espacio por dentro',
    );
    expect(opLabel({ kind: 'setText', src: 'a#1', html: 'x' })).toBe('Escribió en el texto');
  });

  it('refuses addresses that are not a numbered element', () => {
    expect(() => applyOp(PAGE, { kind: 'setText', src: 'rt:3', html: 'x' })).toThrow(EditError);
    expect(() => applyOp(PAGE, { kind: 'setText', src: 'index.html#999', html: 'x' })).toThrow(EditError);
  });
});

describe('project profile', () => {
  it('lists the pages of a plain site, home first, with friendly names', () => {
    const pages = htmlPages(['contacto.html', 'index.html', 'blog/index.html', 'node_modules/x/a.html', 'dist/index.html', 'acerca-de.html']);
    expect(pages.map((p) => p.file)).toEqual(['index.html', 'acerca-de.html', 'contacto.html', 'blog/index.html']);
    expect(pages.map((p) => p.path)).toEqual(['/', '/acerca-de', '/contacto', '/blog/']);
    expect(pageName('acerca-de.html')).toBe('Acerca de');
    expect(pageName('blog/index.html')).toBe('Blog');
  });

  it('plain HTML is editable; frameworks are recognised but not yet', () => {
    expect(detectProfile(['index.html'], null)).toMatchObject({ kind: 'html', editable: true });
    const react = detectProfile(['index.html', 'src/App.tsx'], JSON.stringify({ devDependencies: { vite: '1', react: '1' } }));
    expect(react).toMatchObject({ kind: 'vite', label: 'React con Vite', editable: false });
    expect(detectProfile(['README.md'], null)).toMatchObject({ kind: 'unknown', editable: false });
  });
});

/** A project in memory. */
function fakeFiles(init: Record<string, string>): DesignFiles & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    readFile: async (rel) => {
      if (!(rel in data)) throw new Error('ENOENT');
      return { content: data[rel]!, binary: false, tooLarge: false };
    },
    writeFile: async (rel, content) => {
      data[rel] = content;
    },
    listFiles: async () => Object.keys(data).sort(),
  };
}

describe('design session', () => {
  it('serves numbered pages with the editor script, files stay clean', async () => {
    const files = fakeFiles({ 'index.html': PAGE });
    const s = new DesignSession(files, 'zxp://w1');
    const view = await s.open();
    expect(view).toMatchObject({ kind: 'html', editable: true, base: 'zxp://w1' });
    const html = await s.serve('index.html');
    expect(html).toContain(SRC_ATTR);
    expect(html).toMatch(/<script src="\/__zx__\/editor\.js"><\/script><\/body>/);
    expect(files.data['index.html']).toBe(PAGE);
  });

  it('writes each change, undoes and redoes it', async () => {
    const files = fakeFiles({ 'index.html': PAGE });
    const s = new DesignSession(files, 'zxp://w1');
    await s.open();
    const src = `index.html#${idx('h1')}`;
    const r1 = await s.apply({ kind: 'setStyle', src, styles: { color: '#ff0000' } });
    expect(r1).toMatchObject({ reload: false, file: 'index.html' });
    expect(r1.history.steps).toEqual(['Cambió color del texto']);
    const r2 = await s.apply({ kind: 'setText', src, html: 'Hola' });
    expect(files.data['index.html']).toContain('<h1 style="color: #ff0000">Hola</h1>');
    expect(r2.history.steps).toEqual(['Escribió en el texto', 'Cambió color del texto']);
    await s.undo();
    await s.undo();
    expect(files.data['index.html']).toBe(PAGE);
    const r3 = await s.redo();
    expect(r3?.history).toMatchObject({ canUndo: true, canRedo: true });
    expect(files.data['index.html']).toContain('<h1 style="color: #ff0000">Bienvenidos</h1>');
    // A new change drops what could be redone.
    const r4 = await s.apply({ kind: 'setStyle', src, styles: { 'font-size': '30px' } });
    expect(r4.history.canRedo).toBe(false);
  });

  it('a text edit that adds formatting asks the preview to reload', async () => {
    const files = fakeFiles({ 'index.html': PAGE });
    const s = new DesignSession(files, 'zxp://w1');
    await s.open();
    const r = await s.apply({ kind: 'setText', src: `index.html#${idx('h1')}`, html: '<b>Hola</b>' });
    expect(r.reload).toBe(true);
  });

  it('notices outside changes and refuses to undo over them', async () => {
    const files = fakeFiles({ 'index.html': PAGE });
    const s = new DesignSession(files, 'zxp://w1');
    await s.open();
    await s.serve('index.html');
    expect(await s.stale('index.html')).toBe(false);
    await s.apply({ kind: 'setStyle', src: `index.html#${idx('h1')}`, styles: { color: '#ff0000' } });
    expect(await s.stale('index.html')).toBe(false); // its own write is not "outside"
    files.data['index.html'] = files.data['index.html']!.replace('Bienvenidos', 'Editado a mano');
    expect(await s.stale('index.html')).toBe(true);
    await expect(s.undo()).rejects.toThrow(EditError);
    expect(files.data['index.html']).toContain('Editado a mano');
    expect(s.history().canUndo).toBe(false);
  });

  it('only edits pages of the project, and not framework projects yet', async () => {
    const s = new DesignSession(fakeFiles({ 'index.html': PAGE, 'notes.txt': 'x' }), 'zxp://w1');
    await s.open();
    await expect(s.apply({ kind: 'setText', src: 'notes.txt#0', html: 'x' })).rejects.toThrow(EditError);
    const r = new DesignSession(
      fakeFiles({ 'index.html': PAGE, 'package.json': JSON.stringify({ dependencies: { next: '1' } }) }),
      'zxp://w1',
    );
    expect((await r.open()).editable).toBe(false);
    await expect(r.apply({ kind: 'setText', src: `index.html#${idx('h1')}`, html: 'x' })).rejects.toThrow(EditError);
  });

  it('two quick edits are written one after the other', async () => {
    const files = fakeFiles({ 'index.html': PAGE });
    const s = new DesignSession(files, 'zxp://w1');
    await s.open();
    const src = `index.html#${idx('button')}`;
    await Promise.all([
      s.apply({ kind: 'setStyle', src, styles: { color: '#111111' } }),
      s.apply({ kind: 'setStyle', src, styles: { 'font-size': '18px' } }),
    ]);
    expect(files.data['index.html']).toContain('style="color: #111111; font-size: 18px"');
    expect(s.history().steps).toHaveLength(2);
  });
});

describe('framework projects (live and built preview)', () => {
  it('tells a bundler entry page from a real page', async () => {
    const { isBundlerEntry } = await import('../src/main/design/projectProfile.js');
    expect(isBundlerEntry('<div id="root"></div><script type="module" src="/src/main.tsx"></script>')).toBe(true);
    expect(isBundlerEntry('<script src="./main.jsx" type="module"></script>')).toBe(true);
    expect(isBundlerEntry(PAGE)).toBe(false);
    expect(isBundlerEntry('<script type="module" src="app.js"></script>')).toBe(false);
  });

  it('finds the web apps of a monorepo and skips build and release folders', () => {
    const files = [
      'package.json',
      'apps/web/package.json',
      'apps/web/index.html',
      'apps/web/dist/index.html',
      'apps/desktop/package.json',
      'apps/desktop/release/win-unpacked/LICENSES.chromium.html',
    ];
    const p = detectProfile(files, JSON.stringify({ devDependencies: { turbo: '1' } }), {
      nested: {
        'apps/web': JSON.stringify({ dependencies: { react: '1' }, devDependencies: { vite: '1' } }),
        'apps/desktop': JSON.stringify({ devDependencies: { electron: '1', vite: '1' } }),
      },
      entries: new Set(['apps/web/index.html']),
    });
    expect(p).toMatchObject({ kind: 'vite', label: 'React con Vite', editable: false, pages: [] });
    expect(p.apps).toEqual([
      { dir: 'apps/web', kind: 'vite', label: 'React con Vite', devUrl: 'http://localhost:5173', built: 'apps/web/dist' },
    ]);
    const electron = detectProfile(['package.json'], JSON.stringify({ devDependencies: { electron: '1' } }));
    expect(electron).toMatchObject({ kind: 'desktop', apps: [] });
  });

  it('accepts only addresses of this computer, in plain words otherwise', async () => {
    const { localOrigin } = await import('../src/main/design/live.js');
    expect(localOrigin('localhost:5173')).toBe('http://localhost:5173');
    expect(localOrigin(' http://127.0.0.1:3000/app ')).toBe('http://127.0.0.1:3000');
    expect(localOrigin('0.0.0.0:4321')).toBe('http://localhost:4321');
    expect(() => localOrigin('https://example.com')).toThrow(/esta computadora/);
    expect(() => localOrigin('file:///C:/x')).toThrow(EditError);
    expect(() => localOrigin('')).toThrow(EditError);
  });

  it('shows a framework project only after choosing how, and never writes from it', async () => {
    const files = fakeFiles({
      'package.json': JSON.stringify({ devDependencies: { vite: '1' } }),
      'index.html': '<div id="app"></div><script type="module" src="/src/main.ts"></script>',
      'dist/index.html': '<!doctype html><body><h1>Hola</h1></body>',
    });
    const s = new DesignSession(files, 'zxp://w1');
    const v = await s.open();
    expect(v).toMatchObject({ mode: 'none', base: null, kind: 'vite', app: { dir: '', built: 'dist' } });
    await expect(s.showBuilt('')).resolves.toMatchObject({ mode: 'built', base: 'zxp://w1', pages: [{ file: 'index.html' }] });
    await expect(s.apply({ kind: 'setText', src: 'index.html#1', html: 'x' })).rejects.toThrow(EditError);
    await expect(s.showLive('', 'https://example.com')).rejects.toThrow(EditError);
    expect(s.hide()).toMatchObject({ mode: 'none' });
  });
});
