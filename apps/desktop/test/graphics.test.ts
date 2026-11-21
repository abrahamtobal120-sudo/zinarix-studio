// @vitest-environment jsdom
// Fase 3 (plan de funciones): design templates, geometry, snapping and the design tools.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PALETTES,
  TEMPLATES,
  alignDeltas,
  apply,
  boxToBox,
  buildTemplate,
  distributeDeltas,
  invert,
  matString,
  mul,
  penPath,
  resizeBox,
  rotate,
  shapePath,
  slugify,
  snapMove,
  svgSize,
  toHexColor,
  uniqueName,
  xmlEscape,
} from '../src/shared/graphics.js';
import {
  GRAPHICS_READ_ONLY,
  GRAPHICS_TOOL_NAMES,
  exportSize,
  graphicsPreview,
  runGraphicsTool,
} from '../src/main/graphicsTools.js';
import { TOOLS } from '../src/main/agent.js';
import { sanitizeSvg, setTextLines } from '../src/renderer/components/vector/vectorSession.js';

const root = mkdtempSync(join(tmpdir(), 'zinarix-gfx-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('templates', () => {
  it('every template and palette builds a well-formed, editable SVG', () => {
    for (const t of TEMPLATES)
      for (const p of PALETTES) {
        const svg = buildTemplate({ template: t.id, palette: p.id });
        const d = parse(svg);
        expect(d.querySelector('parsererror'), `${t.id}/${p.id}`).toBeNull();
        expect(d.documentElement.getAttribute('viewBox')).toBe(`0 0 ${t.width} ${t.height}`);
        expect(svgSize(svg)).toEqual({ width: t.width, height: t.height });
        // Parts are named for the layers list; texts stay real text.
        for (const el of d.documentElement.children)
          if (el.localName !== 'defs') expect(el.getAttribute('data-name'), `${t.id} ${el.localName}`).toBeTruthy();
        if (t.id !== 'blank') expect(d.querySelectorAll('text').length).toBeGreaterThan(0);
      }
  });

  it('puts the user texts in, escaped, with line breaks as tspans', () => {
    const svg = buildTemplate({ template: 'instagram-post', title: 'Café <&> "Luna"\nAbierto', subtitle: 'Hoy' });
    const d = parse(svg);
    expect(d.querySelector('parsererror')).toBeNull();
    const title = d.querySelector('[data-name="Título"]')!;
    expect([...title.querySelectorAll('tspan')].map((s) => s.textContent)).toEqual(['Café <&> "Luna"', 'Abierto']);
    expect(svg).toContain('Café &lt;&amp;&gt; &quot;Luna&quot;');
    expect(d.querySelector('[data-name="Subtítulo"]')!.textContent).toBe('Hoy');
  });

  it('custom size is clamped; English texts; unknown template is refused', () => {
    expect(svgSize(buildTemplate({ template: 'blank', width: 5, height: 99999 }))).toEqual({ width: 16, height: 10000 });
    expect(buildTemplate({ template: 'logo', lang: 'en' })).toContain('My Brand');
    expect(() => buildTemplate({ template: 'nope' })).toThrow(/Unknown template/);
  });

  it('svgSize reads width/height, units and the viewBox', () => {
    expect(svgSize('<svg width="10mm" height="20mm" viewBox="0 0 1 2"/>').width).toBe(38);
    expect(svgSize('<svg viewBox="0 0 640 480"></svg>')).toEqual({ width: 640, height: 480 });
    expect(svgSize('<svg width="200" viewBox="0 0 100 50"/>')).toEqual({ width: 200, height: 100 });
    expect(svgSize('<svg width="100%" height="100%"/>')).toEqual({ width: 300, height: 150 });
    expect(() => svgSize('<html/>')).toThrow();
  });

  it('names', () => {
    expect(slugify('Post de Instagram ¡Ya!')).toBe('post-de-instagram-ya');
    expect(slugify('***')).toBe('diseno');
    const taken = new Set(['logo.svg', 'logo-2.svg']);
    expect(uniqueName('logo', 'svg', (n) => taken.has(n))).toBe('logo-3.svg');
    expect(xmlEscape(`a'b`)).toBe('a&apos;b');
  });
});

describe('geometry', () => {
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

  it('matrices multiply, invert and print', () => {
    const m = mul(rotate(30, 5, 5), [2, 0, 0, 3, 10, 20]);
    close(mul(m, invert(m)), [1, 0, 0, 1, 0, 0]);
    const p = apply(rotate(90, 0, 0), { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
    expect(matString([1, 0, 0, 1, 0, 0])).toBe('');
    expect(matString([1, 0, 0, 1, 4.5, -2])).toBe('translate(4.5 -2)');
    expect(matString([0, 1, -1, 0, 0, 0])).toBe('matrix(0 1 -1 0 0 0)');
  });

  it('box to box', () => {
    const t = boxToBox({ x: 10, y: 10, w: 100, h: 50 }, { x: 0, y: 0, w: 50, h: 100 });
    expect(apply(t, { x: 110, y: 60 })).toEqual({ x: 50, y: 100 });
  });

  it('resize from handles keeps the opposite side, the ratio and the center', () => {
    const b = { x: 0, y: 0, w: 100, h: 50 };
    expect(resizeBox(b, 'se', { x: 200, y: 80 }, false, false)).toEqual({ x: 0, y: 0, w: 200, h: 80 });
    expect(resizeBox(b, 'nw', { x: 50, y: 25 }, false, false)).toEqual({ x: 50, y: 25, w: 50, h: 25 });
    expect(resizeBox(b, 'e', { x: 300, y: 999 }, true, false)).toEqual({ x: 0, y: -50, w: 300, h: 150 });
    const r = resizeBox(b, 'se', { x: 300, y: 60 }, true, false);
    expect(r.w / r.h).toBeCloseTo(2);
    expect(resizeBox(b, 'e', { x: 150, y: 0 }, false, true)).toEqual({ x: -50, y: 0, w: 200, h: 50 });
    // Dragged past the other side: flipped into place, never a negative size.
    expect(resizeBox(b, 'e', { x: -40, y: 0 }, false, false)).toEqual({ x: -40, y: 0, w: 40, h: 50 });
  });

  it('align and distribute', () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 20, w: 20, h: 10 },
    ];
    const page = { x: 0, y: 0, w: 100, h: 100 };
    expect(alignDeltas(boxes, 'right', page)).toEqual([
      { x: 90, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(alignDeltas(boxes, 'vcenter', page).map((d) => d.y)).toEqual([45, 25]);
    const three = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 15, y: 0, w: 10, h: 10 },
      { x: 90, y: 0, w: 10, h: 10 },
    ];
    expect(distributeDeltas(three, 'x').map((d) => d.x)).toEqual([0, 30, 0]);
  });

  it('snapping catches edges and centers within the tolerance', () => {
    const b = { x: 0, y: 0, w: 20, h: 20 };
    const s = snapMove(b, 38, 3, [50], [0], 4);
    // Its center (10 + 38 = 48) snaps to 50; its top (3) snaps to 0.
    expect(s.dx).toBe(40);
    expect(s.dy).toBe(0);
    expect(s.guides).toEqual([
      { axis: 'x', at: 50 },
      { axis: 'y', at: 0 },
    ]);
    expect(snapMove(b, 20, 20, [50], [0], 4)).toEqual({ dx: 20, dy: 20, guides: [] });
  });

  it('pen paths: corners are lines, handles make curves, closing joins the start', () => {
    expect(penPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true)).toBe('M 0 0 L 10 0 L 10 10 Z');
    expect(penPath([{ x: 0, y: 0, hx: 5, hy: -5 }, { x: 10, y: 0 }], false)).toBe('M 0 0 C 5 -5 10 0 10 0');
    const d = parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${shapePath('heart', { x: 0, y: 0, w: 10, h: 10 })}"/></svg>`);
    expect(d.querySelector('parsererror')).toBeNull();
    for (const k of ['star', 'triangle', 'hexagon', 'arrow', 'speech'] as const) expect(shapePath(k, { x: 0, y: 0, w: 10, h: 10 })).toMatch(/^M .* Z$/);
  });

  it('colors for the color picker', () => {
    expect(toHexColor('#ABC')).toBe('#aabbcc');
    expect(toHexColor('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(toHexColor('white')).toBe('#ffffff');
    expect(toHexColor('url(#g)')).toBeNull();
  });
});

describe('design editor DOM helpers', () => {
  it('removes scripts, handlers and javascript: links', () => {
    const d = parse(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="x()"><script>alert(1)</script>' +
        '<a xlink:href="javascript:alert(1)"><rect onclick="y()" width="5" height="5"/></a><image href="javascript:z()"/></svg>',
    );
    expect(sanitizeSvg(d.documentElement)).toBe(5);
    const out = new XMLSerializer().serializeToString(d);
    expect(out).not.toMatch(/script|onload|onclick|javascript/);
    expect(out).toContain('<rect');
  });

  it('writes text lines as tspans under each other', () => {
    const d = parse('<svg xmlns="http://www.w3.org/2000/svg"><text x="40 50" y="9">old</text></svg>');
    const t = d.querySelector('text') as unknown as SVGTextElement;
    setTextLines(t, 'uno\ndos');
    expect([...t.querySelectorAll('tspan')].map((s) => [s.getAttribute('x'), s.getAttribute('dy'), s.textContent])).toEqual([
      ['40', '0', 'uno'],
      ['40', '1.15em', 'dos'],
    ]);
    setTextLines(t, 'solo');
    expect(t.querySelectorAll('tspan').length).toBe(0);
    expect(t.textContent).toBe('solo');
  });
});

describe('design tools of the agent', () => {
  const fakePng = Buffer.from('89504e470d0a1a0a', 'hex');
  const calls: { w: number; h: number; mime: string; bg?: string | null }[] = [];
  const raster = async (_svg: string, o: { width: number; height: number; mime: string; background?: string | null }) => {
    calls.push({ w: o.width, h: o.height, mime: o.mime, bg: o.background });
    return fakePng;
  };

  it('are registered; templates and render need no approval', () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of GRAPHICS_TOOL_NAMES) expect(names).toContain(n);
    expect([...GRAPHICS_READ_ONLY].sort()).toEqual(['design_templates', 'svg_render']);
    expect(graphicsPreview('svg_render', { path: 'a.svg' }, root)).toBeNull();
  });

  it('design_new writes a template into disenos/ with a free name and opens it', async () => {
    const card = graphicsPreview('design_new', { template: 'logo' }, root);
    expect(card && 'action' in card && card.allowKey).toBe('design_new:new');
    const a = await runGraphicsTool(raster, 'design_new', { template: 'logo', palette: 'forest', title: 'Luna' }, root);
    const b = await runGraphicsTool(raster, 'design_new', { template: 'logo' }, root);
    expect(a.ok && b.ok).toBe(true);
    expect([a.changed, b.changed]).toEqual(['disenos/logo.svg', 'disenos/logo-2.svg']);
    expect(a.open).toBe('disenos/logo.svg');
    expect(readFileSync(join(root, 'disenos/logo.svg'), 'utf8')).toContain('Luna');
  });

  it('design_new refuses to replace a file unless asked (and then asks as high risk)', async () => {
    writeFileSync(join(root, 'mine.svg'), '<svg/>');
    expect(graphicsPreview('design_new', { template: 'blank', path: 'mine.svg' }, root)).toEqual({
      error: expect.stringMatching(/already exists/),
    });
    const card = graphicsPreview('design_new', { template: 'blank', path: 'mine.svg', overwrite: true }, root);
    expect(card && 'risk' in card && card.risk).toBe('high');
    expect(card && 'allowKey' in card).toBe(false);
    expect(graphicsPreview('design_new', { template: 'blank', path: '../out.svg' }, root)).toEqual({
      error: expect.stringMatching(/inside the open project/),
    });
    expect(graphicsPreview('design_new', { template: 'blank', path: 'x.png' }, root)).toEqual({ error: expect.stringMatching(/\.svg/) });
  });

  it('svg_render gives the model the picture, fitted to 1024 px, with notes', async () => {
    writeFileSync(join(root, 'big.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="2000"><script/><image href="https://x/y.png"/></svg>');
    calls.length = 0;
    const r = await runGraphicsTool(raster, 'svg_render', { path: 'big.svg' }, root);
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ w: 1024, h: 512, mime: 'image/png' });
    expect(r.image).toMatchObject({ mediaType: 'image/png', width: 1024, height: 512 });
    expect(r.content).toMatch(/scripts/);
    expect(r.content).toMatch(/internet/);
    expect(r.content).toMatch(/no viewBox/);
    const missing = await runGraphicsTool(raster, 'svg_render', { path: 'nope.svg' }, root);
    expect(missing.ok).toBe(false);
  });

  it('svg_export writes PNG / JPG next to the SVG at the asked size', async () => {
    writeFileSync(join(root, 'card.svg'), buildTemplate({ template: 'business-card' }));
    const card = graphicsPreview('svg_export', { path: 'card.svg', scale: 2 }, root);
    expect(card && 'path' in card && card.path).toBe('card.png');
    calls.length = 0;
    const r = await runGraphicsTool(raster, 'svg_export', { path: 'card.svg', scale: 2 }, root);
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ w: 2100, h: 1200, mime: 'image/png' });
    expect(existsSync(join(root, 'card.png'))).toBe(true);
    // Now it would replace the file: high risk, no "always".
    const again = graphicsPreview('svg_export', { path: 'card.svg' }, root);
    expect(again && 'risk' in again && again.risk).toBe('high');
    calls.length = 0;
    await runGraphicsTool(raster, 'svg_export', { path: 'card.svg', out: 'web/card.jpg', width: 525 }, root);
    expect(calls[0]).toMatchObject({ w: 525, h: 300, mime: 'image/jpeg' });
    expect(existsSync(join(root, 'web/card.jpg'))).toBe(true);
    expect(graphicsPreview('svg_export', { path: 'card.svg', out: 'card.gif' }, root)).toEqual({ error: expect.stringMatching(/png or \.jpg/) });
  });

  it('export size keeps the proportion and the 8192 px limit', () => {
    expect(exportSize({ width: 1000, height: 500 }, { width: 300 })).toEqual({ width: 300, height: 150 });
    expect(exportSize({ width: 5000, height: 2500 }, { scale: 4 })).toEqual({ width: 8192, height: 4096 });
  });

  it('without a raster or a folder the tools say so', async () => {
    expect((await runGraphicsTool(null, 'svg_render', { path: 'card.svg' }, root)).ok).toBe(false);
    expect((await runGraphicsTool(raster, 'design_new', { template: 'logo' }, undefined)).content).toMatch(/No folder/);
    expect((await runGraphicsTool(null, 'design_templates', {}, undefined)).content).toMatch(/instagram-post/);
  });
});
