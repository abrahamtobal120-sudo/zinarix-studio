// Fase 4 (mejora): RGB curves of the colour grade. The preview tables and the export's lutrgb
// expression must give the very same 8-bit values (checked against a real FFmpeg).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findFfmpeg } from '../src/main/video.js';
import type { ColorGrade } from '../src/shared/videoColor.js';
import {
  CURVE_PRESETS,
  cleanCurve,
  cleanGrade,
  curveSegments,
  ffmpegGrade,
  gradeHasCurves,
  gradeTables,
  splineAt,
  validGrade,
} from '../src/shared/videoColor.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);

describe('RGB curves', () => {
  it('a straight curve is dropped; ends are added and points sorted', () => {
    expect(
      cleanCurve([
        [0, 0],
        [0.5, 0.5],
        [1, 1],
      ]),
    ).toBeUndefined();
    expect(
      cleanGrade({
        curves: {
          m: [
            [0, 0],
            [1, 1],
          ],
        },
      }),
    ).toBeUndefined();
    expect(
      cleanCurve([
        [0.7, 0.8],
        [0.3, 0.2],
      ]),
    ).toEqual([
      [0, 0.2],
      [0.3, 0.2],
      [0.7, 0.8],
      [1, 0.8],
    ]);
    // Out of range, too close together, junk.
    expect(
      cleanCurve([
        [-1, 2],
        [0.005, 0.5],
        [0.5, 'x'],
        [1, 1],
      ]),
    ).toEqual([
      [0, 1],
      [1, 1],
    ]);
    const many = Array.from({ length: 30 }, (_, i) => [i / 29, (i / 29) ** 2]);
    expect(cleanCurve(many)!.length).toBeLessThanOrEqual(12);
  });

  it('the spline goes through its points and never overshoots', () => {
    const pts = cleanCurve([
      [0, 0],
      [0.25, 0.1],
      [0.5, 0.9],
      [0.75, 0.92],
      [1, 1],
    ])!;
    const segs = curveSegments(pts);
    for (const [x, y] of pts) expect(splineAt(segs, x)).toBeCloseTo(y, 5);
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const v = splineAt(segs, i / 1000);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9); // monotone points → monotone curve
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('an S curve adds contrast; a channel curve only moves its channel', () => {
    const s = CURVE_PRESETS.find((p) => p.id === 'sStrong')!.pts;
    const [r, g, b] = gradeTables({ curves: { m: s } });
    expect(r[50]!).toBeLessThan(50);
    expect(r[200]!).toBeGreaterThan(200);
    expect(Array.from(g)).toEqual(Array.from(r));
    const [r2, g2, b2] = gradeTables({
      curves: {
        b: [
          [0, 0],
          [0.5, 0.7],
          [1, 1],
        ],
      },
    });
    expect(b2[128]!).toBeGreaterThan(160);
    expect(r2[128]).toBe(128);
    expect(g2[128]).toBe(128);
    expect(b[0]).toBe(0);
  });

  it('curves count as a grade, are checked when loading and kept by cleanGrade', () => {
    const g: ColorGrade = {
      curves: {
        m: [
          [0, 0.1],
          [1, 1],
        ],
      },
    };
    expect(gradeHasCurves(g)).toBe(true);
    expect(validGrade(g)).toBe(true);
    expect(validGrade({ curves: { m: [[0, 'x']] } })).toBe(false);
    expect(validGrade({ curves: [] })).toBe(false);
    expect(cleanGrade(g)).toEqual({
      curves: {
        m: [
          [0, 0.1],
          [1, 1],
        ],
      },
    });
    // Without curves the export expression is exactly the old one.
    expect(ffmpegGrade({ gain: { m: 0.2 } })[0]).not.toContain('ld(0)');
    expect(ffmpegGrade(g)[0]).toMatch(/^lutrgb=r='[^']+':g='[^']+':b='[^']+'$/);
  });
});

describe.skipIf(!tools.ffmpeg)('RGB curves with FFmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zs-curves-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Runs the grade's filter on a 256-pixel ramp and returns FFmpeg's r, g, b per input value. */
  function render(g: ColorGrade): [number[], number[], number[]] {
    const px = Buffer.alloc(256 * 3);
    for (let i = 0; i < 256; i++) px.fill(i, i * 3, i * 3 + 3);
    writeFileSync(join(dir, 'in.raw'), px);
    writeFileSync(join(dir, 'graph.txt'), `[0:v]${ffmpegGrade(g).join(',')}[o]`);
    const r = spawnSync(
      tools.ffmpeg!,
      [
        '-v',
        'error',
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-s',
        '256x1',
        '-i',
        'in.raw',
        '-filter_complex_script',
        'graph.txt',
        '-map',
        '[o]',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'out.raw',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(r.stderr).toBe('');
    const out = readFileSync(join(dir, 'out.raw'));
    const ch = (c: number) => Array.from({ length: 256 }, (_, i) => out[i * 3 + c]!);
    return [ch(0), ch(1), ch(2)];
  }

  it.each([
    ['S curve', { curves: { m: CURVE_PRESETS[1]!.pts } }],
    [
      'faded blacks + blue channel',
      {
        curves: {
          m: CURVE_PRESETS[2]!.pts,
          b: [
            [0, 0.05],
            [0.4, 0.55],
            [1, 0.9],
          ],
        },
      },
    ],
    [
      'wheels + curves',
      {
        lift: { m: 0.1 },
        gamma: { r: 0.2 },
        temperature: 0.3,
        curves: {
          m: [
            [0, 0],
            [0.3, 0.2],
            [0.6, 0.75],
            [1, 1],
          ],
          g: [
            [0, 0],
            [0.5, 0.45],
            [1, 1],
          ],
        },
      },
    ],
  ] as [string, ColorGrade][])('preview = export: %s', (_, g) => {
    const want = gradeTables(g).map((t) => Array.from(t));
    const got = render(g);
    for (let c = 0; c < 3; c++) expect(got[c]).toEqual(want[c]);
  });
});

describe('video_color (AI tool)', async () => {
  const { colorGrade } = await import('../src/shared/videoAgent.js');
  const { insertMedia, newProject, validProject } = await import('../src/shared/video.js');
  const { VIDEO_TOOLS } = await import('../src/main/videoTools.js');
  const mk = () => {
    let p = newProject({ name: 'c' });
    const m = {
      id: 'm1',
      name: 'a.mp4',
      path: 'C:/a.mp4',
      kind: 'video',
      duration: 10,
      width: 1920,
      height: 1080,
      hasAudio: true,
    } as never;
    p = { ...p, media: [m] };
    return insertMedia(p, m, { trackId: p.tracks[0]!.id, start: 0 }).project;
  };

  it('applies a style, wheels, a curve preset and own curves, and keeps the rest', () => {
    const p = mk();
    const id = p.clips[0]!.id;
    const a = colorGrade(p, { preset: 'warm', curve: 'sSoft' });
    if (!('project' in a)) throw new Error(a.error);
    const g1 = a.project.clips[0]!.color!;
    expect(g1.temperature).toBeGreaterThan(0);
    expect(g1.curves?.m).toBeDefined();
    const b = colorGrade(a.project, {
      clips: [id],
      gain: { r: 0.1 },
      curves: {
        b: [
          [0, 0.05],
          [1, 1],
        ],
      },
    });
    if (!('project' in b)) throw new Error(b.error);
    const g2 = b.project.clips[0]!.color!;
    expect(g2.temperature).toBe(g1.temperature);
    expect(g2.gain?.r).toBe(0.1);
    expect(g2.curves?.b).toEqual([
      [0, 0.05],
      [1, 1],
    ]);
    expect(g2.curves?.m).toEqual(g1.curves?.m);
    expect(validProject(b.project)).toBe(true);
    const c = colorGrade(b.project, { curves: { m: [] } });
    if (!('project' in c)) throw new Error(c.error);
    expect(c.project.clips[0]!.color!.curves?.m).toBeUndefined();
    const off = colorGrade(c.project, { reset: true });
    if (!('project' in off)) throw new Error(off.error);
    expect(off.project.clips[0]!.color).toBeUndefined();
  });

  it('refuses unknown clips and presets; the tool is declared', () => {
    const p = mk();
    expect(colorGrade(p, { clips: ['nope'] })).toHaveProperty('error');
    expect(colorGrade(p, { preset: 'x' })).toHaveProperty('error');
    expect(colorGrade(p, { curve: 'x' })).toHaveProperty('error');
    expect(VIDEO_TOOLS.some((t) => t.name === 'video_color')).toBe(true);
  });
});
