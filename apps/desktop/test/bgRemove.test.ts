import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BG_MODELS,
  applyMask,
  contentBox,
  fillBackdrop,
  maskCoverage,
  maskFromOutput,
  modelInput,
  parseHex,
  resizeMask,
} from '../src/shared/bgRemove.js';
import { applyEdit, cleanEdit, describeEdit, type Rgba } from '../src/shared/imageEdit.js';
import { BgRemoveService, bgViaProcess, type BgRunner } from '../src/main/bgRemove.js';
import { runBgModel } from '../src/main/bgWorker.js';
import { ImageService, cutoutName, imagePreview, runImageTool } from '../src/main/imageTools.js';
import { findFfmpeg } from '../src/main/video.js';
import { TOOLS } from '../src/main/agent.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const ortDir = join(appRoot, 'node_modules/onnxruntime-web/dist');
// The fast model: next to the built worker, or in the build's cache.
const modelDir = [join(appRoot, 'dist/bgremove'), join(appRoot, 'node_modules/.cache/zinarix-models')].find((d) =>
  existsSync(join(d, BG_MODELS.fast.file)),
);
const ffmpeg = findFfmpeg(appRoot).ffmpeg;
const root = mkdtempSync(join(tmpdir(), 'zinarix-bg-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A dark red disc on a pale, slightly noisy backdrop: an obvious subject. */
function photo(w = 360, h = 240): Rgba {
  const d = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (h * 0.3) ** 2;
      const n = rnd() * 12;
      d[p] = inside ? 170 + n : 200 + n;
      d[p + 1] = inside ? 20 + n : 215 + n;
      d[p + 2] = inside ? 30 + n : 230 + n;
      d[p + 3] = 255;
    }
  return { width: w, height: h, data: d };
}

const inProcess: BgRunner = (req) => runBgModel(req, ortDir);

describe('background removal: pure parts', () => {
  it('prepares the model input as normalised planes', () => {
    const t = modelInput(photo(), BG_MODELS.fast);
    expect(t.length).toBe(3 * 320 * 320);
    // Centre (red disc) vs corner (pale): red plane higher in the centre relative to green.
    const S = 320;
    const c = (S / 2) * S + S / 2;
    expect(t[c]! - t[S * S + c]!).toBeGreaterThan(2);
    expect(Math.abs(t[0]! - t[S * S]!)).toBeLessThan(0.5);
  });

  it('turns the output into a mask of the picture size', () => {
    const out = new Float32Array(4 * 4);
    out[5] = out[6] = out[9] = out[10] = 0.9; // the middle 2 × 2
    const m = maskFromOutput(out, 4, 8, 8);
    expect(m.length).toBe(64);
    expect(m[3 * 8 + 3]).toBeGreaterThan(200);
    expect(m[0]).toBe(0);
    expect(resizeMask(m, 8, 8, 4, 4).length).toBe(16);
  });

  it('applies the mask, a backdrop colour and finds the subject box', () => {
    const img: Rgba = { width: 4, height: 2, data: new Uint8ClampedArray(32).fill(100) };
    const mask = new Uint8Array([0, 255, 255, 0, 0, 0, 128, 0]);
    const cut = applyMask(img, mask);
    expect([cut.data[3], cut.data[7], cut.data[27]]).toEqual([0, 100, 50]);
    expect(contentBox(cut)).toEqual({ x: 1, y: 0, w: 2, h: 2 });
    const filled = fillBackdrop(cut, '#ff0000');
    expect([...filled.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(parseHex('#0f0')).toEqual([0, 255, 0]);
    expect(parseHex('verde')).toBeNull();
    expect(maskCoverage(new Uint8Array([255, 0]))).toBe(0.5);
    expect(() => applyMask(img, new Uint8Array(3))).toThrow();
  });

  it('is part of an edit, so undo / redo work in the editor', () => {
    const e = cleanEdit({ cutout: true, backdrop: '#FFF', brightness: 10 }, 4, 2);
    expect(e).toMatchObject({ cutout: true, backdrop: '#ffffff' });
    expect(describeEdit(e)).toContain('quitar fondo (fondo #ffffff)');
    expect(cleanEdit({ backdrop: '#fff' }, 4, 2).backdrop).toBeUndefined();
    const img: Rgba = { width: 2, height: 1, data: new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255]) };
    const cut = applyEdit(img, { cutout: true }, 1, new Uint8Array([255, 0]));
    expect([cut.data[3], cut.data[7]]).toEqual([255, 0]);
    expect(applyEdit(img, { cutout: true }, 1, null).data[7]).toBe(255);
  });

  it('names the copy and asks before writing', () => {
    expect(cutoutName('fotos/gato.jpg')).toBe('fotos/gato-sin-fondo.png');
    expect(TOOLS.some((t) => t.name === 'image_remove_bg')).toBe(true);
    writeFileSync(join(root, 'a.png'), 'x');
    const p = imagePreview('image_remove_bg', { path: 'a.png' }, root);
    expect(p && 'action' in p && p.action).toContain('a-sin-fondo.png');
    expect(p && 'risk' in p && p.risk).toBe('medium');
    const jpg = imagePreview('image_remove_bg', { path: 'a.png', out: 'b.jpg' }, root);
    expect(jpg && 'error' in jpg && jpg.error).toMatch(/JPEG/);
    const outside = imagePreview('image_remove_bg', { path: '../a.png' }, root);
    expect(outside && 'error' in outside).toBe(true);
  });

  it('reports which models are ready and refuses a missing one', async () => {
    const empty = mkdtempSync(join(root, 'models-'));
    const s = new BgRemoveService(null, empty, inProcess);
    expect(s.status().every((m) => !m.ready)).toBe(true);
    await expect(s.infer('precise', new Float32Array(3 * 1024 * 1024))).rejects.toThrow(/descargado/);
    const none = new BgRemoveService(null, empty, null);
    expect(none.available).toBe(false);
  });
});

describe.skipIf(!modelDir)('background removal with the real model (ONNX Runtime Web)', () => {
  it('finds the disc and leaves the backdrop out', async () => {
    const s = new BgRemoveService(modelDir!, join(root, 'm'), inProcess);
    expect(s.status().find((m) => m.id === 'fast')?.ready).toBe(true);
    const img = photo();
    const mask = await s.mask(img, 'fast');
    expect(mask.length).toBe(img.width * img.height);
    const at = (x: number, y: number) => mask[y * img.width + x]!;
    expect(at(180, 120)).toBeGreaterThan(200);
    expect(at(5, 5)).toBeLessThan(40);
    expect(at(354, 234)).toBeLessThan(40);
    const share = maskCoverage(mask);
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.45);
  }, 60_000);

  const worker = join(appRoot, 'dist/bgremove/bgWorker.mjs');
  it.skipIf(!existsSync(worker))('runs as its own process (as in the app)', async () => {
    const s = new BgRemoveService(join(appRoot, 'dist/bgremove'), join(root, 'm'), bgViaProcess(process.execPath, worker));
    const mask = await s.mask(photo(), 'fast');
    expect(mask[120 * 360 + 180]).toBeGreaterThan(200);
  }, 60_000);

  it.skipIf(!ffmpeg)('the agent tool saves a transparent PNG and shows a preview', async () => {
    const images = new ImageService(() => ffmpeg);
    images.bg = new BgRemoveService(modelDir!, join(root, 'm'), inProcess);
    await images.encode(photo(), join(root, 'disco.png'));
    const r = await runImageTool(images, 'image_remove_bg', { path: 'disco.png', trim: true }, root);
    expect(r.ok, r.content).toBe(true);
    expect(r.image?.mediaType).toBe('image/png');
    expect(r.changed).toBe(join(root, 'disco-sin-fondo.png'));
    const back = await images.decode(join(root, 'disco-sin-fondo.png'));
    // Trimmed to the disc (≈ 144 px) with a small margin.
    expect(back.width).toBeLessThan(220);
    expect(back.data[3]).toBeLessThan(60);
    const mid = ((back.height >> 1) * back.width + (back.width >> 1)) * 4;
    expect(back.data[mid + 3]).toBeGreaterThan(200);
    // A solid colour behind, as JPEG.
    const j = await runImageTool(images, 'image_remove_bg', { path: 'disco.png', out: 'disco.jpg', background: '#00ff00' }, root);
    expect(j.ok, j.content).toBe(true);
    const jb = await images.decode(join(root, 'disco.jpg'));
    expect(jb.data[1]).toBeGreaterThan(200);
    expect(jb.data[0]).toBeLessThan(60);
    // The precise model is not downloaded here: a clear message, no file.
    const p = await runImageTool(images, 'image_remove_bg', { path: 'disco.png', model: 'precise', out: 'p.png' }, root);
    expect(p.ok).toBe(false);
    expect(p.content).toMatch(/not downloaded/);
  }, 60_000);
});
