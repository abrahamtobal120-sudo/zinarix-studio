import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { VideoService, findFfmpeg, prepareLuts } from '../src/main/video.js';
import type { Clip, MediaItem, VideoProject } from '../src/shared/video.js';
import {
  clipEnd,
  defaultExport,
  insertMedia,
  newProject,
  setGrade,
  setKey,
  validProject,
} from '../src/shared/video.js';
import {
  applyLut,
  channelCurves,
  cleanGrade,
  curveAt,
  ffmpegGrade,
  gradePixels,
  gradeTables,
  lutKey,
  mixLut,
  parseCube,
  serializeCube,
} from '../src/shared/videoColor.js';
import { rippleTrim, rollEdit, slideClip, slipClip } from '../src/shared/videoEdit.js';
import { buildRender, loudnormFilter, parseLoudnorm } from '../src/shared/videoRender.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);
const dir = mkdtempSync(join(tmpdir(), 'zvspro-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const media = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: 'm1',
  path: '/x/a.mp4',
  name: 'a.mp4',
  kind: 'video',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 1,
  ...over,
});

/** A .cube from a function of (r, g, b). */
function cube(size: number, f: (r: number, g: number, b: number) => number[], extra = ''): string {
  const lines = [`TITLE "test"`, `LUT_3D_SIZE ${size}`, extra];
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        lines.push(f(r / (size - 1), g / (size - 1), b / (size - 1)).join(' '));
  return lines.join('\n');
}
const warm = (r: number, g: number, b: number) => [
  Math.min(1, r * 1.1 + 0.03),
  g * 0.98,
  b * 0.8,
];

// ---------------- grade ----------------

describe('colour grade', () => {
  it('a neutral grade changes nothing and is dropped', () => {
    expect(cleanGrade({ lift: { m: 0 }, temperature: 0 })).toBeUndefined();
    const [r, g, b] = gradeTables(undefined);
    for (let i = 0; i < 256; i++) expect([r[i], g[i], b[i]]).toEqual([i, i, i]);
    expect(ffmpegGrade({})).toEqual([]);
  });

  it('lift raises the blacks, gain the whites, gamma the middle', () => {
    const [lift] = channelCurves({ lift: { m: 0.5 } });
    expect(curveAt(lift, 0)).toBeGreaterThan(0.15);
    expect(curveAt(lift, 1)).toBeCloseTo(1, 6);
    const [gain] = channelCurves({ gain: { m: -0.5 } });
    expect(curveAt(gain, 0)).toBe(0);
    expect(curveAt(gain, 1)).toBeCloseTo(0.5, 6);
    const [gam] = channelCurves({ gamma: { m: 0.5 } });
    expect(curveAt(gam, 0.5)).toBeGreaterThan(0.55);
    expect(curveAt(gam, 0)).toBe(0);
    expect(curveAt(gam, 1)).toBeCloseTo(1, 6);
  });

  it('temperature warms red and cools blue; a channel push only moves its channel', () => {
    const [r, g, b] = channelCurves({ temperature: 1 });
    expect(r.gain).toBeGreaterThan(1);
    expect(g.gain).toBe(1);
    expect(b.gain).toBeLessThan(1);
    const [, g2, b2] = channelCurves({ gain: { b: 0.2 } });
    expect(g2.gain).toBe(1);
    expect(b2.gain).toBeCloseTo(1.2, 6);
  });

  it('every curve stays monotonic and inside 0…255', () => {
    for (const grade of [
      { lift: { m: -1 }, gamma: { m: 1 }, gain: { m: 1 } },
      { lift: { m: 1, r: 1 }, gamma: { m: -1 }, gain: { m: -1 } },
      { temperature: -1, tint: 1 },
    ])
      for (const t of gradeTables(grade))
        for (let i = 1; i < 256; i++) expect(t[i]!).toBeGreaterThanOrEqual(t[i - 1]!);
  });

  it('values out of range are clamped, junk is refused by the project check', () => {
    expect(cleanGrade({ lift: { m: 9 }, temperature: -5 })).toEqual({
      lift: { m: 1 },
      temperature: -1,
    });
    let p = newProject({ name: 'g' });
    p = { ...p, media: [media()] };
    p = insertMedia(p, p.media[0]!, { trackId: p.tracks[0]!.id, start: 0 }).project;
    const id = p.clips[0]!.id;
    p = setGrade(p, new Set([id]), { gain: { m: 0.2 }, lut: 'C:/l.cube', lutMix: 0.5 });
    expect(p.clips[0]!.color).toEqual({ gain: { m: 0.2 }, lut: 'C:/l.cube', lutMix: 0.5 });
    expect(validProject(p)).toBe(true);
    const bad = { ...p, clips: [{ ...p.clips[0]!, color: { lift: { m: 'x' } } }] };
    expect(validProject(bad)).toBe(false);
    p = setGrade(p, new Set([id]), undefined);
    expect(p.clips[0]!.color).toBeUndefined();
  });

  it('the export filter is numbers only and names the LUT by its file', () => {
    const f = ffmpegGrade({ gain: { m: 0.2 }, lut: 'C:/evil\':x.cube' }, 'lut0.cube');
    expect(f[0]).toMatch(/^lutrgb=r='[^']+':g='[^']+':b='[^']+'$/);
    expect(f[1]).toBe('lut3d=file=lut0.cube:interp=trilinear');
    // A bad file name is never put in the graph.
    expect(ffmpegGrade({ lut: 'C:/a.cube' }, "a';b")).toEqual([]);
    expect(lutKey({ lut: 'C:/a.cube', lutMix: 0.5 })).toBe('0.5|C:/a.cube');
  });
});

// ---------------- LUTs ----------------

describe('.cube LUTs', () => {
  it('parses an identity LUT, which returns the input', () => {
    const l = parseCube(cube(17, (r, g, b) => [r, g, b]));
    expect(l.size).toBe(17);
    expect(l.title).toBe('test');
    for (const c of [
      [0, 0, 0],
      [0.3, 0.6, 0.9],
      [1, 1, 1],
      [0.123, 0.987, 0.5],
    ] as const) {
      const o = applyLut(l, ...c);
      for (let i = 0; i < 3; i++) expect(o[i]).toBeCloseTo(c[i], 5);
    }
  });

  it('honours DOMAIN_MIN / DOMAIN_MAX and survives a round trip', () => {
    const l = parseCube(
      cube(2, (r, g, b) => [r, g, b], 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2'),
    );
    // Input 1 is half way through a 0…2 domain: the 2-point identity gives 0.5.
    expect(applyLut(l, 1, 1, 1)[0]).toBeCloseTo(0.5, 6);
    const again = parseCube(serializeCube(l));
    expect(again.domainMax).toEqual([2, 2, 2]);
    expect(Array.from(again.data)).toEqual(Array.from(l.data));
  });

  it('refuses what is not a 3D LUT', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0')).toThrow(/3D/);
    expect(() => parseCube('hello')).toThrow();
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/faltan/);
    expect(() => parseCube('LUT_3D_SIZE 99')).toThrow(/Tamaño/);
    expect(() => parseCube(cube(2, () => [0, 0, 0]) + '\n1 1 1')).toThrow(/más datos/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 x\n')).toThrow();
  });

  it('a mixed LUT equals blending its result with the input', () => {
    const l = parseCube(cube(9, warm));
    const half = mixLut(l, 0.5);
    for (const c of [
      [0.2, 0.4, 0.6],
      [0.9, 0.1, 0.33],
    ] as const) {
      const full = applyLut(l, ...c);
      const mixed = applyLut(half, ...c);
      for (let i = 0; i < 3; i++) expect(mixed[i]).toBeCloseTo((c[i] + full[i]!) / 2, 5);
    }
    expect(mixLut(l, 1)).toBe(l);
  });

  it('the CPU path applies the grade first, then the LUT', () => {
    const px = new Uint8ClampedArray([10, 128, 250, 255]);
    const lut = parseCube(cube(5, (r, g, b) => [1 - r, 1 - g, 1 - b]));
    gradePixels(px, gradeTables({ gain: { m: -0.5 } }), lut);
    // gain ×0.5 then inverted.
    expect(Array.from(px)).toEqual([250, 191, 130, 255]);
  });
});

// ---------------- trim tools ----------------

/** Three 2 s clips touching each other on V1, each from second 3 of a 10 s file. */
function strip(): { p: VideoProject; ids: string[] } {
  let p: VideoProject = { ...newProject({ name: 't' }), media: [media()] };
  const v1 = p.tracks.find((t) => t.name === 'V1')!.id;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = insertMedia(p, p.media[0]!, { trackId: v1, start: i * 2 });
    p = r.project;
    const id = r.project.clips.at(-1)!.id;
    p = { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, in: 3, out: 5 } : c)) };
    ids.push(id);
  }
  return { p, ids };
}
const get = (p: VideoProject, id: string): Clip => p.clips.find((c) => c.id === id)!;

describe('trim tools', () => {
  it('ripple trim of the end moves what comes after', () => {
    const { p, ids } = strip();
    const q = rippleTrim(p, ids[0]!, 'right', 1.5);
    expect(get(q, ids[0]!).out).toBeCloseTo(4.5, 6);
    expect(get(q, ids[1]!).start).toBeCloseTo(1.5, 6);
    expect(get(q, ids[2]!).start).toBeCloseTo(3.5, 6);
    // Longer: limited by the media (10 s), and the rest follows.
    const r = rippleTrim(p, ids[0]!, 'right', 50);
    expect(get(r, ids[0]!).out).toBe(10);
    expect(get(r, ids[1]!).start).toBeCloseTo(7, 6);
  });

  it('ripple trim of the start keeps the clip in place and closes the gap', () => {
    const { p, ids } = strip();
    const q = rippleTrim(p, ids[1]!, 'left', 2.5);
    expect(get(q, ids[1]!).start).toBe(2);
    expect(get(q, ids[1]!).in).toBeCloseTo(3.5, 6);
    expect(clipEnd(get(q, ids[1]!))).toBeCloseTo(3.5, 6);
    expect(get(q, ids[2]!).start).toBeCloseTo(3.5, 6);
    expect(get(q, ids[0]!)).toEqual(get(p, ids[0]!));
    // Back past the media start: stops at 0.
    const r = rippleTrim(p, ids[1]!, 'left', -10);
    expect(get(r, ids[1]!).in).toBe(0);
    expect(get(r, ids[2]!).start).toBeCloseTo(7, 6);
  });

  it('roll moves the cut and keeps the total length', () => {
    const { p, ids } = strip();
    const q = rollEdit(p, ids[0]!, 2.5);
    expect(get(q, ids[0]!).out).toBeCloseTo(5.5, 6);
    expect(get(q, ids[1]!).start).toBeCloseTo(2.5, 6);
    expect(get(q, ids[1]!).in).toBeCloseTo(3.5, 6);
    expect(clipEnd(get(q, ids[1]!))).toBeCloseTo(4, 6);
    expect(get(q, ids[2]!)).toEqual(get(p, ids[2]!));
    // Never swallows the next clip whole.
    const r = rollEdit(p, ids[0]!, 9);
    expect(clipEnd(get(r, ids[1]!)) - get(r, ids[1]!).start).toBeGreaterThan(0);
    // No touching neighbour: nothing happens.
    expect(rollEdit(p, ids[2]!, 7)).toBe(p);
  });

  it('slip shows another part of the source, clamped to the media', () => {
    const { p, ids } = strip();
    const q = slipClip(p, ids[1]!, 1);
    expect(get(q, ids[1]!)).toMatchObject({ start: 2, in: 4, out: 6 });
    const r = slipClip(p, ids[1]!, -10);
    expect(get(r, ids[1]!)).toMatchObject({ in: 0, out: 2 });
    const s = slipClip(p, ids[1]!, 99);
    expect(get(s, ids[1]!)).toMatchObject({ in: 8, out: 10 });
  });

  it('slide moves a clip between its neighbours, which give and take the room', () => {
    const { p, ids } = strip();
    const q = slideClip(p, ids[1]!, 0.5);
    expect(get(q, ids[1]!)).toMatchObject({ start: 2.5, in: 3, out: 5 });
    expect(get(q, ids[0]!).out).toBeCloseTo(5.5, 6);
    expect(get(q, ids[2]!).start).toBeCloseTo(4.5, 6);
    expect(get(q, ids[2]!).in).toBeCloseTo(3.5, 6);
    expect(clipEnd(get(q, ids[2]!))).toBeCloseTo(6, 6);
    // The next clip keeps at least a sliver.
    const r = slideClip(p, ids[1]!, 5);
    expect(clipEnd(get(r, ids[2]!)) - get(r, ids[2]!).start).toBeGreaterThan(0);
    expect(get(r, ids[1]!).start).toBeLessThan(4);
  });

  it('locked tracks are left alone', () => {
    const { p, ids } = strip();
    const locked = { ...p, tracks: p.tracks.map((t) => ({ ...t, locked: true })) };
    expect(rippleTrim(locked, ids[0]!, 'right', 1)).toBe(locked);
    expect(rollEdit(locked, ids[0]!, 2.5)).toBe(locked);
    expect(slipClip(locked, ids[0]!, 1)).toBe(locked);
    expect(slideClip(locked, ids[1]!, 0.5)).toBe(locked);
  });
});

// ---------------- loudness ----------------

describe('loudness', () => {
  it('first pass measures, second applies a linear gain', () => {
    expect(loudnormFilter(-14)).toBe('loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json');
    const f = loudnormFilter(-14, {
      input_i: -30.2,
      input_tp: -12,
      input_lra: 15.4,
      input_thresh: -40.5,
      target_offset: 0.3,
    });
    expect(f).toContain('measured_I=-30.2');
    expect(f).toContain('linear=true');
    // A wide range is kept (LRA raised) so loudnorm does not compress.
    expect(f).toContain('LRA=17');
  });

  it('reads the JSON loudnorm prints, and refuses silence', () => {
    const log = `[Parsed_loudnorm_3 @ 0x1]\n{\n\t"input_i" : "-27.31",\n\t"input_tp" : "-9.90",\n\t"input_lra" : "1.20",\n\t"input_thresh" : "-37.42",\n\t"output_i" : "-14.1",\n\t"target_offset" : "0.10"\n}\n`;
    expect(parseLoudnorm(log)).toEqual({
      input_i: -27.31,
      input_tp: -9.9,
      input_lra: 1.2,
      input_thresh: -37.42,
      target_offset: 0.1,
    });
    expect(parseLoudnorm(log.replace('-27.31', '-inf'))).toBeNull();
    expect(parseLoudnorm('nothing')).toBeNull();
  });

  it('the measuring pass is audio only and writes nothing', () => {
    let p: VideoProject = { ...newProject({ name: 'l' }), media: [media()] };
    p = insertMedia(p, p.media[0]!, { trackId: p.tracks[0]!.id, start: 0 }).project;
    const o = { ...defaultExport(p), loudness: -14 };
    const m = buildRender(p, o, 'out.mp4', undefined, {}, { measure: true });
    expect(m.filter).not.toContain('[vout]');
    expect(m.filter).toContain('print_format=json');
    expect(m.output).toEqual(['-map', '[aout]', '-f', 'null', '-']);
    const plain = buildRender(p, { ...o, loudness: null }, 'out.mp4');
    expect(plain.filter).not.toContain('loudnorm');
  });
});

// ---------------- FFmpeg ----------------

const sh = (args: string[]) => {
  const r = spawnSync(tools.ffmpeg!, ['-hide_banner', '-v', 'error', '-y', ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(r.status, r.stderr?.toString()).toBe(0);
  return r.stdout as Buffer;
};

async function exportJob(svc: VideoService, p: VideoProject, o: object, out: string) {
  const job = svc.enqueue(p, { ...defaultExport(p), ...o }, out);
  await new Promise<void>((resolve) => {
    const tick = setInterval(() => {
      const j = svc.list().find((x) => x.id === job.id)!;
      if (j.state !== 'queued' && j.state !== 'running') {
        clearInterval(tick);
        resolve();
      }
    }, 100);
  });
  return svc.list().find((x) => x.id === job.id)!;
}

describe.skipIf(!tools.ffmpeg || !tools.ffprobe)('Fase 12 with FFmpeg', () => {
  it('the exported grade + LUT matches the preview maths (PSNR ≥ 30 dB)', async () => {
    const src = join(dir, 'grad.mp4');
    // Smooth colours (gradients) so chroma subsampling barely matters; lossless encode.
    sh([
      ...['-f', 'lavfi', '-i', 'gradients=s=160x90:c0=0x203080:c1=0xe0a040:speed=0:n=2'],
      ...['-t', '1', '-r', '30', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', src],
    ]);
    const lutPath = join(dir, 'warm.cube');
    writeFileSync(lutPath, cube(17, warm));
    const svc = new VideoService(appRoot, dir, () => undefined);
    const { url: _u, ...m } = await svc.probe(src);
    let p: VideoProject = {
      ...newProject({ width: 160, height: 90, fps: 30, name: 'grade' }),
      media: [{ ...m, hasAudio: false }],
    };
    p = insertMedia(p, p.media[0]!, { trackId: p.tracks.find((t) => t.name === 'V1')!.id, start: 0 })
      .project;
    const grade = { lift: { m: 0.1 }, gamma: { r: 0.2 }, gain: { b: -0.2 }, temperature: 0.3 };
    p = setGrade(p, new Set([p.clips[0]!.id]), { ...grade, lut: lutPath, lutMix: 0.7 });
    const out = join(dir, 'grade.mp4');
    const job = await exportJob(svc, p, { width: 160, height: 90, crf: 0, preset: 'veryfast' }, out);
    expect(job.state, job.error).toBe('done');
    const frame = (file: string) =>
      sh(['-ss', '0.5', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    const before = new Uint8ClampedArray(frame(src));
    const after = new Uint8ClampedArray(frame(out));
    expect(after.length).toBe(160 * 90 * 4);
    gradePixels(before, gradeTables(grade), mixLut(parseCube(cube(17, warm)), 0.7));
    let se = 0;
    let n = 0;
    for (let i = 0; i < before.length; i += 4)
      for (let c = 0; c < 3; c++) {
        se += (before[i + c]! - after[i + c]!) ** 2;
        n++;
      }
    const psnr = 10 * Math.log10((255 * 255) / Math.max(1e-9, se / n));
    expect(psnr).toBeGreaterThan(30);
  }, 120_000);

  it('acceptance: scale keyframes + LUT + audio normalised to −14 LUFS (±1)', async () => {
    const src = join(dir, 'clip.mp4');
    // A quiet tone (about −30 LUFS) with a picture.
    sh([
      ...['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000,volume=0.05'],
      ...['-t', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', src],
    ]);
    const lutPath = join(dir, 'warm2.cube');
    writeFileSync(lutPath, cube(9, warm));
    const svc = new VideoService(appRoot, dir, () => undefined);
    const { url: _u, ...m } = await svc.probe(src);
    let p: VideoProject = {
      ...newProject({ width: 320, height: 180, fps: 30, name: 'acc' }),
      media: [m],
    };
    p = insertMedia(p, p.media[0]!, { trackId: p.tracks.find((t) => t.name === 'V1')!.id, start: 0 })
      .project;
    const id = p.clips[0]!.id;
    p = setKey(p, id, 'scale', 0, 1);
    p = setKey(p, id, 'scale', 5, 1.5);
    p = setGrade(p, new Set([id]), { lut: lutPath });
    expect(Object.keys(await prepareLuts(p, dir))).toEqual([`1|${lutPath}`]);
    const out = join(dir, 'acc.mp4');
    const job = await exportJob(svc, p, { width: 320, height: 180, preset: 'veryfast', loudness: -14 }, out);
    expect(job.state, job.error).toBe('done');
    const r = spawnSync(tools.ffmpeg!, [
      ...['-hide_banner', '-nostats', '-i', out, '-af', 'ebur128', '-f', 'null', '-'],
    ]);
    const log = r.stderr.toString();
    const summary = log.slice(log.lastIndexOf('Summary:'));
    const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
    expect(Math.abs(I - -14)).toBeLessThanOrEqual(1);
    const probe = spawnSync(tools.ffprobe!, [
      ...['-v', 'error', '-show_entries', 'stream=codec_type,sample_rate', '-of', 'csv=p=0', out],
    ]).stdout.toString();
    expect(probe).toContain('48000');
  }, 180_000);
});
