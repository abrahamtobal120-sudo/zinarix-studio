import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { VideoService, findFfmpeg } from '../src/main/video.js';
import type { MediaItem, VideoProject } from '../src/shared/video.js';
import {
  addTextClip,
  defaultExport,
  insertMedia,
  leadOf,
  newProject,
  setAnim,
  setEffect,
  setEffects,
  setTrackMix,
  setTransition,
  splitAt,
  tailOf,
  trackAudible,
  transitionWindow,
  updateText,
  validProject,
  visualAt,
  visualClipsAt,
} from '../src/shared/video.js';
import {
  LOOKS,
  TEXT_PRESETS,
  animAt,
  cleanEffects,
  cssFilter,
  ffmpegEffects,
} from '../src/shared/videoFx.js';
import { buildRender } from '../src/shared/videoRender.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);
const dir = mkdtempSync(join(tmpdir(), 'zvsfx-'));
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

/** Two 5 s clips back to back on V1 (cut at 5 s). */
function twoClips(): { p: VideoProject; a: string; b: string } {
  const p0 = { ...newProject(), media: [media()] };
  const { project } = splitAt(insertMedia(p0, p0.media[0]!).project, 5);
  const [a, b] = [...project.clips].sort((x, y) => x.start - y.start);
  return { p: project, a: a!.id, b: b!.id };
}

describe('video effects', () => {
  it('cleans values, matches the canvas filter and emits numbers only', () => {
    expect(cleanEffects({ brightness: 0, blur: 0 })).toBeUndefined();
    expect(cleanEffects({ contrast: 9 })).toEqual({ contrast: 1 });
    expect(cssFilter({ brightness: 0.2, grayscale: 1 })).toBe('brightness(1.2) grayscale(1)');
    const f = ffmpegEffects({ brightness: 0.2, contrast: 0.5, grayscale: 1, blur: 4 }, 2);
    expect(f[0]).toBe('colorchannelmixer=rr=1.2:gg=1.2:bb=1.2');
    expect(f[1]).toContain('lutrgb=');
    expect(f[2]).toMatch(/^colorchannelmixer=rr=0\.2126/);
    expect(f[3]).toBe('gblur=sigma=8');
    expect(ffmpegEffects({ hue: 'x;evil' as unknown as number })).toEqual([]);
    for (const l of LOOKS) expect(cssFilter(l.fx)).toBeTypeOf('string');
  });

  it('applies to selected clips and is saved in a valid project', () => {
    const { p, a, b } = twoClips();
    let q = setEffects(p, new Set([a, b]), LOOKS.find((l) => l.id === 'bw')!.fx);
    q = setEffect(q, a, 'blur', 3);
    expect(q.clips.find((c) => c.id === a)!.effects).toEqual({ grayscale: 1, blur: 3 });
    expect(validProject(q)).toBe(true);
    const bad = { ...q, clips: q.clips.map((c) => ({ ...c, effects: { evil: 1 } })) };
    expect(validProject(bad)).toBe(false);
    expect(buildRender(q, defaultExport(q), '/o.mp4').filter).toContain('gblur=sigma=');
  });
});

describe('video titles and animations', () => {
  it('adds a title above V1 and edits it', () => {
    const { p } = twoClips();
    const pr = TEXT_PRESETS[0]!;
    const { project, clip } = addTextClip(p, pr.spec, 1, { anim: pr.anim });
    const v1 = project.tracks.filter((t) => t.kind === 'video').at(-1)!;
    expect(clip.trackId).not.toBe(v1.id);
    expect(clip.mediaId).toBe('');
    const q = updateText(project, clip.id, { content: 'Hola', color: '#ff0000' });
    expect(q.clips.find((c) => c.id === clip.id)!.text!.content).toBe('Hola');
    expect(validProject(q)).toBe(true);
    const bad = updateText(q, clip.id, { color: 'red;evil' });
    expect(validProject(bad)).toBe(false);
  });

  it('animates in and out within the clip', () => {
    expect(animAt({ in: 'fade', inD: 1 }, 0, 4).alpha).toBe(0);
    expect(animAt({ in: 'fade', inD: 1 }, 0.5, 4).alpha).toBeCloseTo(0.5, 6);
    expect(animAt({ in: 'fade', inD: 1 }, 2, 4).alpha).toBe(1);
    expect(animAt({ out: 'slideUp', outD: 1 }, 4, 4).dy).toBeCloseTo(0.08, 6);
    expect(animAt({ in: 'pop', inD: 3, out: 'fade', outD: 3 }, 2, 2).alpha).toBeCloseTo(0, 6);
    const { p, a } = twoClips();
    const q = setAnim(p, a, { in: 'fade', inD: 1 });
    expect(setAnim(q, a, { in: 'none' }).clips.find((c) => c.id === a)!.anim).toBeUndefined();
    // Split: the in animation stays on the left half.
    const { project } = splitAt(q, 2);
    const right = project.clips.find((c) => c.start === 2)!;
    expect(right.anim?.in).toBeUndefined();
  });

  it('puts titles in the export as pictures and their animation in the graph', () => {
    const { p } = twoClips();
    const { project, clip } = addTextClip(p, TEXT_PRESETS[0]!.spec, 0, {
      anim: { in: 'zoom', out: 'slideLeft' },
    });
    const without = buildRender(project, defaultExport(project), '/o.mp4');
    const plan = buildRender(project, defaultExport(project), '/o.mp4', undefined, {
      [clip.id]: '/tmp/t.png',
    });
    expect(plan.clips).toBe(without.clips + 1);
    expect(plan.inputs).toContain('/tmp/t.png');
    expect(plan.filter).toContain(':eval=frame');
    expect(plan.filter).toMatch(/x='\(W-w\)\/2\+0\*W\+/);
  });
});

describe('video transitions', () => {
  it('centres on the cut, overlaps both clips and is bounded', () => {
    const { p, a, b } = twoClips();
    const q = setTransition(p, b, { kind: 'dissolve', d: 1 });
    const cb = q.clips.find((c) => c.id === b)!;
    const ca = q.clips.find((c) => c.id === a)!;
    expect(transitionWindow(q, cb)).toMatchObject({ from: 4.5, d: 1 });
    expect(leadOf(q, cb)).toBeCloseTo(0.5, 6);
    expect(tailOf(q, ca)).toBeCloseTo(0.5, 6);
    expect(visualClipsAt(q, cb.trackId, 4.75).map((c) => c.id)).toEqual([a, b]);
    expect(visualAt(q, cb, 4.5)!.alpha).toBeCloseTo(0, 6);
    expect(visualAt(q, cb, 5.5)!.alpha).toBeCloseTo(1, 6);
    expect(
      setTransition(p, b, { kind: 'wipe', d: 99 }).clips.find((c) => c.id === b)!.transition!.d,
    ).toBeLessThanOrEqual(4);
    // Without a clip before it, a reveal over its first seconds.
    const r = setTransition(p, a, { kind: 'slide', d: 1 });
    expect(
      transitionWindow(
        r,
        r.clips.find((c) => c.id === a)!,
      ),
    ).toEqual({ from: 0, d: 1 });
  });

  it('reads past the cut in the export and keeps the sound on the clip', () => {
    const { p, b } = twoClips();
    const q = setTransition(p, b, { kind: 'wipe', d: 1 });
    const plan = buildRender(q, defaultExport(q), '/o.mp4');
    // Outgoing clip: 5.5 s of picture; incoming: from 4.5 s of source.
    expect(plan.inputs.join(' ')).toContain('-ss 0 -t 5.5');
    expect(plan.inputs.join(' ')).toContain('-ss 4.5 -t 5.5');
    expect(plan.filter).toContain('lte(X,W*');
    expect(plan.filter).not.toContain('tpad');
    expect(plan.filter.match(/adelay=/g)).toHaveLength(2);
  });

  it('repeats the first frame when the incoming clip has no source before it', () => {
    const p0 = { ...newProject(), media: [media()] };
    const one = insertMedia(p0, p0.media[0]!).project;
    const two = insertMedia(one, one.media[0]!); // 0–10 and 10–20, both from source 0
    const q = setTransition(two.project, two.clip!.id, { kind: 'dissolve', d: 1 });
    const f = buildRender(q, defaultExport(q), '/o.mp4').filter;
    expect(f).toContain('tpad=start_duration=0.5:start_mode=clone');
    expect(f).toMatch(/stop_duration=0\.6:stop_mode=clone/); // the first clip ends with the media
  });
});

describe('video mixer', () => {
  it('track volume, pan and solo reach the export', () => {
    const p0 = {
      ...newProject(),
      media: [media(), media({ id: 'm2', kind: 'audio', hasVideo: false })],
    };
    let p = insertMedia(p0, p0.media[0]!).project;
    p = insertMedia(p, p.media[1]!).project;
    const a1 = p.tracks.find((t) => t.kind === 'audio')!;
    const v1 = p.tracks.filter((t) => t.kind === 'video').at(-1)!;
    p = setTrackMix(p, a1.id, { volume: 0.5, pan: -1 });
    let f = buildRender(p, defaultExport(p), '/o.mp4').filter;
    expect(f).toContain('volume=0.5,pan=stereo|c0=1*c0|c1=0*c1');
    expect(
      setTrackMix(p, a1.id, { volume: 1, pan: 0 }).tracks.find((t) => t.id === a1.id),
    ).not.toHaveProperty('volume');
    p = setTrackMix(p, a1.id, { solo: true });
    expect(
      trackAudible(
        p,
        p.tracks.find((t) => t.id === v1.id),
      ),
    ).toBe(false);
    f = buildRender(p, defaultExport(p), '/o.mp4').filter;
    expect(f.match(/adelay=/g)).toHaveLength(1);
    expect(validProject(p)).toBe(true);
    expect(validProject({ ...p, tracks: p.tracks.map((t) => ({ ...t, pan: 5 })) })).toBe(false);
  });
});

describe.skipIf(!tools.ffmpeg || !tools.ffprobe)('video phase 2 (FFmpeg)', () => {
  it('renders effects, a transition, a title and the mix with real FFmpeg', async () => {
    const red = join(dir, 'red.mp4');
    const blue = join(dir, 'blue.mp4');
    const png = join(dir, 'title.png');
    for (const [c, out] of [
      ['red', red],
      ['blue', blue],
    ] as const) {
      const g = spawnSync(tools.ffmpeg!, [
        ...['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi'],
        ...['-i', `color=c=${c}:size=320x180:rate=30:duration=3`],
        ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3'],
        ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-shortest', out],
      ]);
      expect(g.status, g.stderr?.toString()).toBe(0);
    }
    // A stand-in for the renderer's title: a white bar on a transparent frame.
    const g = spawnSync(tools.ffmpeg!, [
      ...['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi'],
      ...[
        '-i',
        "color=c=white:size=320x180,format=rgba,geq=r=255:g=255:b=255:a='255*between(X,100,220)*between(Y,80,100)'",
      ],
      ...['-frames:v', '1', png],
    ]);
    expect(g.status, g.stderr?.toString()).toBe(0);
    const svc = new VideoService(appRoot, dir, () => undefined);
    const { url: _a, ...mr } = await svc.probe(red);
    const { url: _b, ...mb } = await svc.probe(blue);
    let p: VideoProject = {
      ...newProject({ width: 320, height: 180, fps: 30, name: 'fx' }),
      media: [mr, mb],
    };
    p = insertMedia(p, mr).project;
    const ins = insertMedia(p, mb);
    p = ins.project;
    p = setTransition(p, ins.clip!.id, { kind: 'dissolve', d: 1 });
    const first = p.clips.find((c) => c.mediaId === mr.id)!;
    p = setEffects(p, new Set([first.id]), { grayscale: 1 });
    const t = addTextClip(p, TEXT_PRESETS[0]!.spec, 4, { dur: 2, anim: { in: 'fade', inD: 0.5 } });
    p = setTrackMix(t.project, t.project.tracks.at(-1)!.id, { pan: 0.5 });
    const out = join(dir, 'fx-out.mp4');
    const job = svc.enqueue(
      p,
      { ...defaultExport(p), width: 320, height: 180, preset: 'veryfast' },
      out,
      { [t.clip.id]: (await import('node:fs')).readFileSync(png) },
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
    const rgb = (time: number, x: number, y: number) => {
      const r = spawnSync(
        tools.ffmpeg!,
        [
          ...['-v', 'error', '-ss', String(time), '-i', out, '-frames:v', '1'],
          ...['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        ],
        { maxBuffer: 1 << 24 },
      );
      const i = (y * 320 + x) * 3;
      return [r.stdout[i]!, r.stdout[i + 1]!, r.stdout[i + 2]!] as const;
    };
    const [r0, g0, b0] = rgb(1, 20, 20); // red in black and white: grey
    expect(Math.abs(r0 - g0)).toBeLessThan(20);
    expect(Math.abs(r0 - b0)).toBeLessThan(20);
    const [r1, , b1] = rgb(3, 20, 20); // halfway through the dissolve: grey and blue mixed
    expect(b1).toBeGreaterThan(r1);
    expect(b1).toBeLessThan(230);
    const [, , b2] = rgb(4.2, 20, 20); // after it: blue
    expect(b2).toBeGreaterThan(200);
    const bar = rgb(5, 160, 90); // the title over the blue clip
    expect(Math.min(...bar)).toBeGreaterThan(200);
  }, 120_000);
});
