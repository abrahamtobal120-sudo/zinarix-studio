/**
 * Fase 4 of PLAN-FASES-FUNCIONES: speed ramps (pure), proxies (FFmpeg) and the recording files
 * (the main-process writer and the remux; the capture itself needs a screen and is tried in
 * the real app).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ desktopCapturer: { getSources: async () => [] } }));

import { VideoService, findFfmpeg } from '../src/main/video.js';
import {
  ProxyMaker,
  parseProgress,
  proxyArgs,
  proxyFile,
  proxyScale,
} from '../src/main/videoProxy.js';
import { Recorder, freeName, recordingName, remux } from '../src/main/recorder.js';
import type { MediaItem, VideoProject } from '../src/shared/video.js';
import {
  clipDur,
  clipEnd,
  insertMedia,
  newProject,
  projectDuration,
  validProject,
} from '../src/shared/video.js';
import {
  RAMP_PRESETS,
  applyRamp,
  cleanPoints,
  planDuration,
  rampInfo,
  rampPlan,
  rampSpeedAt,
  rampSteps,
  removeRamp,
} from '../src/shared/videoRamp.js';
import { speedRamp } from '../src/shared/videoAgent.js';
import { buildRender } from '../src/shared/videoRender.js';
import { defaultExport } from '../src/shared/video.js';
import { VIDEO_TOOLS } from '../src/main/videoTools.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);
const dir = mkdtempSync(join(tmpdir(), 'zvs4-'));
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

/** A 4 s clip at 0 and a second clip right after it on the same track. */
function twoClips(): { p: VideoProject; a: string; b: string } {
  let p: VideoProject = {
    ...newProject(),
    media: [media(), media({ id: 'm2', path: '/x/b.mp4', name: 'b.mp4' })],
  };
  const r1 = insertMedia(p, p.media[0]!, { start: 0 });
  p = r1.project;
  const a = r1.clip!.id;
  p = { ...p, clips: p.clips.map((c) => (c.id === a ? { ...c, out: 4 } : c)) };
  const r2 = insertMedia(p, p.media[1]!, { trackId: r1.clip!.trackId, start: 4 });
  return { p: r2.project, a, b: r2.clip!.id };
}

describe('speed ramps (pure)', () => {
  it('follows the curve smoothly between points', () => {
    const pts = cleanPoints(RAMP_PRESETS.hero);
    expect(rampSpeedAt(pts, 0)).toBe(1);
    expect(rampSpeedAt(pts, 0.5)).toBeCloseTo(0.3);
    expect(rampSpeedAt(pts, 1)).toBe(1);
    const mid = rampSpeedAt(pts, 0.19);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(1);
    // Clamped to what the player and the export can do.
    expect(cleanPoints([{ u: 2, s: 99 }])).toEqual([{ u: 1, s: 4 }]);
    expect(() => cleanPoints([])).toThrow();
  });

  it('plans steps that cover the source exactly and fit at their speed', () => {
    const plan = rampPlan(2, 6, RAMP_PRESETS.bullet);
    expect(plan.length).toBe(16);
    expect(plan[0]!.in).toBe(2);
    expect(plan[plan.length - 1]!.out).toBe(6);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.in).toBeCloseTo(plan[i - 1]!.out, 9);
    expect(plan[0]!.speed).toBeGreaterThan(2);
    expect(Math.min(...plan.map((s) => s.speed))).toBeCloseTo(0.3, 1);
    // Very short sources get fewer steps (each one lasts at least a frame).
    expect(rampSteps(0.2, RAMP_PRESETS.bullet)).toBeLessThanOrEqual(3);
    expect(rampSteps(0.01, RAMP_PRESETS.bullet)).toBeLessThan(2);
    expect(rampSteps(100, RAMP_PRESETS.hero)).toBe(40);
  });

  it('turns a clip into ramp steps and pushes the next clip', () => {
    const { p, a, b } = twoClips();
    const r = applyRamp(p, a, 'hero');
    expect(r.ids[0]).toBe(a);
    expect(r.ids.length).toBeGreaterThan(5);
    const steps = r.ids.map((id) => r.project.clips.find((c) => c.id === id)!);
    // Back to back, same source, one group.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.start).toBeCloseTo(clipEnd(steps[i - 1]!), 9);
      expect(steps[i]!.in).toBeCloseTo(steps[i - 1]!.out, 9);
    }
    expect(new Set(steps.map((s) => s.ramp?.group)).size).toBe(1);
    expect(steps[0]!.in).toBe(0);
    expect(steps[steps.length - 1]!.out).toBe(4);
    // Slow motion in the middle: longer than 4 s, and the next clip moved by the same amount.
    expect(r.duration).toBeGreaterThan(5);
    expect(r.duration).toBeCloseTo(planDuration(rampPlan(0, 4, RAMP_PRESETS.hero)), 6);
    const next = r.project.clips.find((c) => c.id === b)!;
    expect(next.start).toBeCloseTo(4 + r.delta, 6);
    expect(validProject(JSON.parse(JSON.stringify(r.project)))).toBe(true);
    const info = rampInfo(r.project, r.ids[3]!)!;
    expect(info).toMatchObject({ preset: 'hero', steps: r.ids.length });
    expect(info.min).toBeLessThan(0.5);
  });

  it('keeps fades and transitions at the outer ends', () => {
    const { p, a } = twoClips();
    const q = {
      ...p,
      clips: p.clips.map((c) => (c.id === a ? { ...c, fadeIn: 0.5, fadeOut: 0.4 } : c)),
    };
    const r = applyRamp(q, a, 'montage');
    const steps = r.ids.map((id) => r.project.clips.find((c) => c.id === id)!);
    expect(steps[0]!.fadeIn).toBe(0.5);
    expect(steps.slice(1).every((s) => s.fadeIn === undefined)).toBe(true);
    expect(steps[steps.length - 1]!.fadeOut).toBe(0.4);
    expect(steps.slice(0, -1).every((s) => s.fadeOut === undefined)).toBe(true);
  });

  it('removing the ramp gives back the original clip and timing', () => {
    const { p, a, b } = twoClips();
    const r = applyRamp(p, a, 'bullet');
    const back = removeRamp(r.project, r.ids[4]!);
    const one = back.project.clips.find((c) => c.id === back.id)!;
    expect(back.id).toBe(a);
    expect(one).toMatchObject({ start: 0, in: 0, out: 4 });
    expect(one.ramp).toBeUndefined();
    expect(one.speed).toBeUndefined();
    expect(back.project.clips.length).toBe(p.clips.length);
    expect(back.project.clips.find((c) => c.id === b)!.start).toBeCloseTo(4, 6);
    expect(projectDuration(back.project)).toBeCloseTo(projectDuration(p), 6);
  });

  it('re-ramping replaces the old ramp; a custom curve works too', () => {
    const { p, a } = twoClips();
    const r1 = applyRamp(p, a, 'hero');
    const r2 = applyRamp(r1.project, r1.ids[2]!, [
      { u: 0, s: 2 },
      { u: 1, s: 2 },
    ]);
    expect(r2.project.clips.filter((c) => c.ramp).every((c) => c.ramp!.preset === 'custom')).toBe(
      true,
    );
    // Constant 2× → half as long.
    expect(r2.duration).toBeCloseTo(2, 6);
    const back = removeRamp(r2.project, r2.ids[0]!);
    expect(clipDur(back.project.clips.find((c) => c.id === back.id)!)).toBeCloseTo(4, 6);
  });

  it('refuses titles, images and locked tracks; without ripple it must fit', () => {
    const { p, a } = twoClips();
    expect(() => applyRamp(p, a, 'hero', { ripple: false })).toThrow(/cabe/);
    // Speeding up always fits.
    expect(applyRamp(p, a, 'montage', { ripple: false }).delta).toBeLessThan(0);
    const locked = { ...p, tracks: p.tracks.map((t) => ({ ...t, locked: true })) };
    expect(() => applyRamp(locked, a, 'hero')).toThrow(/bloqueada/);
    const img = { ...p, media: p.media.map((m) => ({ ...m, kind: 'image' as const })) };
    expect(() => applyRamp(img, a, 'hero')).toThrow();
  });

  it('the export plans every step with its own speed', () => {
    const { p, a } = twoClips();
    const r = applyRamp(p, a, 'hero');
    const plan = buildRender(r.project, defaultExport(r.project), '/out.mp4');
    expect(plan.filter).toMatch(/setpts=\(PTS-STARTPTS\)\/0\.3/);
    expect(plan.filter).toMatch(/atempo/);
  });

  it('the AI tool puts, describes and removes a ramp', () => {
    const { p, a } = twoClips();
    const e = speedRamp(p, { clip: a, preset: 'slowEnd' });
    expect('error' in e).toBe(false);
    if ('error' in e) return;
    expect(e.content).toMatch(/slowEnd/);
    const custom = speedRamp(p, {
      clip: a,
      points: [
        { at: 0, speed: 0.5 },
        { at: 1, speed: 3 },
      ],
    });
    expect('error' in custom).toBe(false);
    const off = speedRamp(e.project, { clip: a, remove: true });
    expect('error' in off).toBe(false);
    expect(speedRamp(p, { clip: a })).toHaveProperty('error');
    expect(speedRamp(p, { clip: 'nope', preset: 'hero' })).toHaveProperty('error');
    expect(VIDEO_TOOLS.some((t) => t.name === 'video_speed_ramp')).toBe(true);
    expect(VIDEO_TOOLS.some((t) => t.name === 'video_proxies')).toBe(true);
  });
});

describe('proxies (no FFmpeg needed)', () => {
  it('scales the short side and keeps the source timing', () => {
    expect(proxyScale(3840, 2160, 540)).toBe('scale=-2:540:flags=bilinear');
    expect(proxyScale(2160, 3840, 540)).toBe('scale=540:-2:flags=bilinear');
    const args = proxyArgs('/in.mov', '/out.mp4', {
      width: 3840,
      height: 2160,
      target: 540,
      hasAudio: false,
    });
    expect(args).toContain('-an');
    expect(args).not.toContain('-r');
    expect(args.slice(-1)[0]).toBe('/out.mp4');
    expect(parseProgress('frame=10\nout_time_us=2500000\nprogress=continue\n', 10)).toBeCloseTo(
      0.25,
    );
    expect(parseProgress('frame=10\n', 10)).toBeNull();
  });

  it('names a proxy after the file and its height', () => {
    const a = proxyFile('/c', '/v/a.mp4', 540);
    expect(a).not.toBe(proxyFile('/c', '/v/a.mp4', 720));
    expect(a).not.toBe(proxyFile('/c', '/v/b.mp4', 540));
    expect(a.endsWith('.proxy540.mp4')).toBe(true);
  });
});

describe('recording files (no screen needed)', () => {
  it('names recordings by date and never overwrites', () => {
    expect(recordingName(new Date(2026, 10, 20, 9, 5, 7))).toBe('grabacion-2026-11-20_09-05-07');
    expect(recordingName(new Date(2026, 0, 2, 3, 4, 5), '-camara')).toMatch(/-camara$/);
    const rdir = join(dir, 'names');
    const rec = new Recorder(() => null);
    const a = rec.start(rdir, 'x');
    const b = rec.start(rdir, 'x');
    expect(a.path).not.toBe(b.path);
    void rec.abort(a.id);
    void rec.abort(b.id);
    expect(freeName(rdir, 'y', 'webm')).toBe(join(rdir, 'y.webm'));
  });

  it('writes the chunks in order, and an empty recording is an error', async () => {
    const rec = new Recorder(() => null);
    const r = rec.start(join(dir, 'raw'), 'chunks');
    await Promise.all([
      rec.write(r.id, new Uint8Array([1, 2, 3])),
      rec.write(r.id, new Uint8Array([4, 5])),
      rec.write(r.id, new Uint8Array([6])),
    ]);
    const path = await rec.finish(r.id);
    expect([...readFileSync(path)]).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(rec.write(r.id, new Uint8Array([7]))).rejects.toThrow();
    const e = rec.start(join(dir, 'raw'), 'empty');
    await expect(rec.finish(e.id)).rejects.toThrow(/vacía/);
    // Discarding leaves nothing behind.
    const d = rec.start(join(dir, 'raw'), 'discard');
    await rec.write(d.id, new Uint8Array([1]));
    await rec.abort(d.id);
    expect(existsSync(d.path)).toBe(false);
    expect(existsSync(`${d.path}.part`)).toBe(false);
  });
});

describe.skipIf(!tools.ffmpeg || !tools.ffprobe)('Fase 4 with FFmpeg', () => {
  const gen = (out: string, size: string, dur: number, extra: string[] = []) => {
    const r = spawnSync(
      tools.ffmpeg!,
      [
        '-hide_banner',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${size}:rate=30:duration=${dur}`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:duration=${dur}`,
        ...extra,
        '-shortest',
        '-y',
        out,
      ],
      { encoding: 'utf8' },
    );
    expect(r.status, r.stderr).toBe(0);
  };

  it('makes a 540p proxy with the same length, reports progress and reuses it', async () => {
    const src = join(dir, 'big.mp4');
    gen(src, '1920x1080', 3, ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac']);
    const svc = new VideoService(appRoot, join(dir, 'data'), () => undefined);
    const maker = new ProxyMaker(
      () => svc.cacheDir,
      () => tools.ffmpeg!,
    );
    const seen: number[] = [];
    const out = await maker.make(
      { path: src, duration: 3, width: 1920, height: 1080, hasAudio: true },
      (v) => seen.push(v),
    );
    expect(existsSync(out)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    const probe = await svc.probe(out);
    expect(probe.height).toBe(540);
    expect(probe.width).toBe(960);
    expect(probe.hasAudio).toBe(true);
    expect(Math.abs(probe.duration - 3)).toBeLessThan(0.15);
    expect(statSync(out).size).toBeLessThan(statSync(src).size * 2);
    // Second time: the cached file, no encode.
    expect(maker.existing(src)).toBe(out);
    expect(
      await maker.make(
        { path: src, duration: 3, width: 1920, height: 1080, hasAudio: true },
        () => undefined,
      ),
    ).toBe(out);
  }, 120_000);

  it('a canceled proxy leaves nothing in the cache', async () => {
    const src = join(dir, 'long.mp4');
    gen(src, '1920x1080', 20, ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac']);
    const svc = new VideoService(appRoot, join(dir, 'data2'), () => undefined);
    const maker = new ProxyMaker(
      () => svc.cacheDir,
      () => tools.ffmpeg!,
    );
    const job = maker.make(
      { path: src, duration: 20, width: 1920, height: 1080, hasAudio: true },
      () => undefined,
    );
    await new Promise((r) => setTimeout(r, 300));
    maker.cancel(src);
    await expect(job).rejects.toThrow();
    expect(maker.existing(src)).toBeNull();
  }, 120_000);

  it('exports a clip with a speed ramp (every step, with sound) to the planned length', async () => {
    const src = join(dir, 'ramp-src.mp4');
    gen(src, '640x360', 4, [
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
    ]);
    const svc = new VideoService(appRoot, join(dir, 'data4'), () => undefined);
    const { url: _u, ...item } = await svc.probe(src);
    let p: VideoProject = {
      ...newProject({ width: 640, height: 360, fps: 30, name: 'ramp' }),
      media: [item],
    };
    const ins = insertMedia(p, item);
    p = ins.project;
    const r = applyRamp(p, ins.clip!.id, 'bullet');
    expect(r.ids.length).toBeGreaterThan(10);
    const out = join(dir, 'ramp.mp4');
    const job = svc.enqueue(
      r.project,
      { ...defaultExport(r.project), width: 640, height: 360, preset: 'veryfast' },
      out,
    );
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        const j = svc.list().find((x) => x.id === job.id)!;
        if (j.state !== 'queued' && j.state !== 'running') {
          clearInterval(tick);
          resolve();
        }
      }, 100);
    });
    const final = svc.list().find((x) => x.id === job.id)!;
    expect(final.state, final.error).toBe('done');
    const check = await svc.probe(out);
    expect(check.hasAudio).toBe(true);
    expect(Math.abs(check.duration - r.duration)).toBeLessThan(0.2);
  }, 180_000);

  it('remuxes a recorded WebM so it gets a duration', async () => {
    const raw = join(dir, 'rec.webm.part');
    gen(raw, '640x360', 2, [
      '-c:v',
      'libvpx',
      '-deadline',
      'realtime',
      '-c:a',
      'libopus',
      '-f',
      'webm',
    ]);
    const out = join(dir, 'rec.webm');
    expect(await remux(tools.ffmpeg!, raw, out)).toBe(true);
    const svc = new VideoService(appRoot, join(dir, 'data3'), () => undefined);
    const probe = await svc.probe(out);
    expect(probe.hasVideo && probe.hasAudio).toBe(true);
    expect(Math.abs(probe.duration - 2)).toBeLessThan(0.2);
    // Garbage in: it reports failure instead of throwing.
    const junk = join(dir, 'junk.part');
    const rec = new Recorder(() => tools.ffmpeg!);
    const r = rec.start(dir, 'junk');
    await rec.write(r.id, new Uint8Array([1, 2, 3, 4]));
    // Remux fails on junk; finish keeps the raw bytes instead of losing them.
    const kept = await rec.finish(r.id);
    expect(readFileSync(kept).length).toBe(4);
    expect(existsSync(junk)).toBe(false);
  }, 120_000);
});
