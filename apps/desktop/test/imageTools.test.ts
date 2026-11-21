import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findFfmpeg } from '../src/main/video.js';
import {
  IMAGE_TOOL_NAMES,
  ImageService,
  editFromArgs,
  imagePreview,
  parseSize,
  projectPath,
  runImageTool,
} from '../src/main/imageTools.js';
import { TOOLS } from '../src/main/agent.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const ffmpeg = findFfmpeg(appRoot).ffmpeg;
const root = mkdtempSync(join(tmpdir(), 'zinarix-img-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('image tools (no FFmpeg needed)', () => {
  it('are offered to the agent', () => {
    for (const n of IMAGE_TOOL_NAMES) expect(TOOLS.some((t) => t.name === n)).toBe(true);
  });

  it('reads the size FFmpeg reports', () => {
    expect(parseSize('  Stream #0:0: Video: png, rgba(pc, gbr/unknown/unknown), 640x480, 25 tbr')).toEqual({ w: 640, h: 480 });
    expect(parseSize('  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc), 1920x1080 [SAR 1:1 DAR 16:9]')).toEqual({ w: 1920, h: 1080 });
    expect(parseSize('nothing')).toBeNull();
  });

  it('stays inside the project', () => {
    expect(() => projectPath(root, '../fuera.png')).toThrow();
    expect(() => projectPath(root, join(tmpdir(), 'otro.png'))).toThrow();
    expect(projectPath(root, 'a/b.png')).toBe(join(root, 'a', 'b.png'));
  });

  it('keeps the proportion when only one side is given', () => {
    expect(editFromArgs({ width: 50 }, 200, 100).resize).toEqual({ w: 50, h: 25 });
    expect(editFromArgs({ height: 50, rotate: 90 }, 200, 100).resize).toEqual({ w: 25, h: 50 });
  });

  it('asks before writing, every time when it replaces a file', () => {
    const p = imagePreview('image_edit', { path: 'foto.png', brightness: 10 }, root);
    expect(p && !('error' in p) && p.action).toContain('foto-editada.png');
    expect(p && !('error' in p) && p.allowKey).toBe('image_edit:new');
    expect(imagePreview('image_info', { path: 'foto.png' }, root)).toBeNull();
    expect(imagePreview('image_edit', { path: 'x.gif' }, root)).toEqual({ error: expect.any(String) });
  });
});

describe.skipIf(!ffmpeg)('image tools with FFmpeg', () => {
  const svc = new ImageService(() => ffmpeg);

  it('writes and reads back png, jpg and webp', async () => {
    const data = new Uint8ClampedArray(40 * 20 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([200, 50, 10, i < data.length / 2 ? 255 : 128], i);
    const img = { width: 40, height: 20, data };
    for (const ext of ['png', 'jpg', 'webp']) {
      const p = join(root, `base.${ext}`);
      await svc.encode(img, p);
      const back = await svc.decode(p);
      expect([back.width, back.height]).toEqual([40, 20]);
      expect(Math.abs(back.data[0]! - 200)).toBeLessThan(12);
    }
    // PNG keeps the alpha exactly.
    expect((await svc.decode(join(root, 'base.png'))).data[data.length - 1]).toBe(128);
  });

  it('edits a picture through the agent tool', async () => {
    const info = await runImageTool(svc, 'image_info', { path: 'base.png' }, root);
    expect(info.content).toContain('40 × 20 px');
    expect(info.content).toContain('has transparency');
    const r = await runImageTool(
      svc,
      'image_edit',
      { path: 'base.png', rotate: 90, crop: { x: 0, y: 0, w: 20, h: 30 }, width: 10, grayscale: 100, out: 'sal/gris.webp' },
      root,
    );
    expect(r.ok, r.content).toBe(true);
    expect(existsSync(join(root, 'sal', 'gris.webp'))).toBe(true);
    const out = await svc.decode(join(root, 'sal', 'gris.webp'));
    expect([out.width, out.height]).toEqual([10, 15]);
    expect(Math.abs(out.data[0]! - out.data[2]!)).toBeLessThan(8);
    const bad = await runImageTool(svc, 'image_edit', { path: 'nope.png', blur: 2 }, root);
    expect(bad.ok).toBe(false);
  });
});

describe.skipIf(!ffmpeg)('image tools with FFmpeg (auto and new adjustments)', () => {
  const svc = new ImageService(() => ffmpeg);

  it('applies the automatic fix, straighten and vignette', async () => {
    // A dull, bluish picture: Auto should add contrast and warm it up.
    const data = new Uint8ClampedArray(60 * 40 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const v = 90 + ((i / 4) % 60);
      data.set([v - 15, v, v + 25, 255], i);
    }
    await svc.encode({ width: 60, height: 40, data }, join(root, 'gris.png'));
    const r = await runImageTool(
      svc,
      'image_edit',
      { path: 'gris.png', auto: true, straighten: 3, vignette: 30, out: 'auto.png' },
      root,
    );
    expect(r.ok, r.content).toBe(true);
    expect(r.content).toMatch(/contraste \+\d+/);
    expect(r.content).toMatch(/temperatura \+\d+/);
    expect(r.content).toContain('enderezar +3°');
    const out = await svc.decode(join(root, 'auto.png'));
    expect([out.width, out.height]).toEqual([60, 40]);
  });
});
