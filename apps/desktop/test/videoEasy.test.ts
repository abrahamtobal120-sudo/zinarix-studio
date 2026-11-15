import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { VideoService, findFfmpeg } from '../src/main/video.js';
import type { MediaItem, VideoProject } from '../src/shared/video.js';
import {
  clipDur,
  defaultExport,
  insertMedia,
  newProject,
  transformAt,
  validProject,
} from '../src/shared/video.js';
import {
  DUCK_RAMP,
  VIDEO_THEMES,
  applyTheme,
  duckExpr,
  duckGainAt,
  duckWindows,
  hasKenBurns,
  kenBurns,
  magicVideo,
  setTrackDuck,
} from '../src/shared/videoEasy.js';
import { buildRender } from '../src/shared/videoRender.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);
const dir = mkdtempSync(join(tmpdir(), 'zvseasy-'));
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
const photo = (id: string, width = 1080, height = 1080) =>
  media({
    id,
    path: `/x/${id}.jpg`,
    name: `${id}.jpg`,
    kind: 'image',
    duration: 0,
    width,
    height,
    hasAudio: false,
  });
const song = media({
  id: 'song',
  path: '/x/s.mp3',
  name: 's.mp3',
  kind: 'audio',
  duration: 120,
  hasVideo: false,
  width: 0,
  height: 0,
});

describe('Ken Burns', () => {
  it('fills the frame and moves from start to end', () => {
    const p0 = { ...newProject(), media: [photo('p1')] };
    const { project, clip } = insertMedia(p0, p0.media[0]!);
    const p = kenBurns(project, clip!.id, 'zoomIn');
    const c = p.clips[0]!;
    expect(hasKenBurns(c)).toBe(true);
    // A square photo in 16:9 covers at 16/9 times "fit".
    expect(transformAt(c, c.start).scale).toBeCloseTo(1920 / 1080, 2);
    expect(transformAt(c, c.start + clipDur(c)).scale).toBeCloseTo((1920 / 1080) * 1.18, 2);
    expect(validProject(p)).toBe(true);
  });

  it('pans only as far as the picture still covers the canvas', () => {
    const p0 = { ...newProject(), media: [photo('wide', 1920, 1080)] };
    const { project, clip } = insertMedia(p0, p0.media[0]!);
    const c = kenBurns(project, clip!.id, 'panLeft').clips[0]!;
    const a = transformAt(c, c.start).x;
    const b = transformAt(c, c.start + clipDur(c)).x;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(-a);
    // At scale 1.15 the picture is 1.15 canvases wide: at most 0.075 each side.
    expect(a).toBeLessThanOrEqual(0.075);
  });

  it('ignores titles and audio', () => {
    const p0 = { ...newProject(), media: [song] };
    const { project, clip } = insertMedia(p0, song);
    expect(kenBurns(project, clip!.id)).toBe(project);
  });
});

describe('ducking', () => {
  function withVoice(): { p: VideoProject; music: string } {
    const voice = media({ id: 'v', path: '/x/v.wav', kind: 'audio', duration: 2, hasVideo: false });
    let p: VideoProject = { ...newProject(), media: [song, voice] };
    const a1 = p.tracks.find((t) => t.name === 'A1')!.id;
    const a2 = p.tracks.find((t) => t.name === 'A2')!.id;
    p = insertMedia(p, song, { trackId: a2, start: 0 }).project;
    p = insertMedia(p, voice, { trackId: a1, start: 3 }).project;
    return { p: setTrackDuck(p, a2, 0.2), music: a2 };
  }

  it('finds the voice spans and shapes the gain with ramps', () => {
    const { p, music } = withVoice();
    const track = p.tracks.find((t) => t.id === music)!;
    expect(duckWindows(p, music)).toEqual([{ from: 3, to: 5 }]);
    expect(duckGainAt(p, track, 1)).toBe(1);
    expect(duckGainAt(p, track, 4)).toBeCloseTo(0.2);
    expect(duckGainAt(p, track, 3 - DUCK_RAMP / 2)).toBeCloseTo(0.6);
    expect(duckGainAt(p, track, 6)).toBe(1);
    // A track that does not duck is never touched.
    const other = p.tracks.find((t) => t.name === 'A1')!;
    expect(duckGainAt(p, other, 4)).toBe(1);
    expect(validProject(p)).toBe(true);
    expect(validProject({ ...p, tracks: p.tracks.map((t) => ({ ...t, duck: 3 })) })).toBe(false);
  });

  it('puts the same envelope in the export', () => {
    const { p, music } = withVoice();
    const e = duckExpr(
      p,
      p.tracks.find((t) => t.id === music)!,
      0,
    )!;
    expect(e).toBe('1-0.8*(clip((t-3+0.3)/0.3,0,1)*clip((5+0.3-t)/0.3,0,1))');
    expect(buildRender(p, defaultExport(p), '/o.mp4').filter).toContain(`volume='${e}':eval=frame`);
    // Off again: no envelope.
    const off = setTrackDuck(p, music, undefined);
    expect(buildRender(off, defaultExport(off), '/o.mp4').filter).not.toContain('eval=frame');
  });

  it('merges voices that are close together', () => {
    const voice = media({ id: 'v', path: '/x/v.wav', kind: 'audio', duration: 1, hasVideo: false });
    let p: VideoProject = { ...newProject(), media: [song, voice] };
    const a1 = p.tracks.find((t) => t.name === 'A1')!.id;
    const a2 = p.tracks.find((t) => t.name === 'A2')!.id;
    p = insertMedia(p, song, { trackId: a2, start: 0 }).project;
    p = insertMedia(p, voice, { trackId: a1, start: 2 }).project;
    p = insertMedia(p, voice, { trackId: a1, start: 3.2 }).project;
    p = insertMedia(p, voice, { trackId: a1, start: 8 }).project;
    p = setTrackDuck(p, a2, 0.3);
    expect(duckWindows(p, a2)).toEqual([
      { from: 2, to: 4.2 },
      { from: 8, to: 9 },
    ]);
  });
});

describe('themes and magic video', () => {
  const lib = [photo('p1'), photo('p2'), photo('p3'), photo('p4'), photo('p5'), photo('p6')];
  const clipA = media({ id: 'c1', duration: 8 });
  const clipB = media({ id: 'c2', path: '/x/b.mp4', duration: 2 });

  it('builds a 30 s cut from 6 photos and 2 clips with title, transitions and ducked music', () => {
    const p0: VideoProject = { ...newProject(), media: [...lib, clipA, clipB, song] };
    const r = magicVideo(p0, {
      mediaIds: ['p1', 'c1', 'p2', 'p3', 'c2', 'p4', 'p5', 'p6', 'song'],
      themeId: 'cinema',
      title: 'Vacaciones',
      duration: 30,
    })!;
    expect(r).not.toBeNull();
    expect(r.duration).toBeCloseTo(30, 1);
    const p = r.project;
    expect(validProject(p)).toBe(true);
    const v1 = p.tracks.find((t) => t.name === 'V1')!.id;
    const shots = p.clips.filter((c) => c.trackId === v1).sort((a, b) => a.start - b.start);
    expect(shots).toHaveLength(8);
    // Back to back, no gaps.
    for (let i = 1; i < shots.length; i++)
      expect(shots[i]!.start).toBeCloseTo(shots[i - 1]!.start + clipDur(shots[i - 1]!), 2);
    // The short clip keeps its own length; the long one plays its middle.
    expect(clipDur(shots.find((c) => c.mediaId === 'c2')!)).toBeCloseTo(2);
    const a = shots.find((c) => c.mediaId === 'c1')!;
    expect(a.in).toBeGreaterThan(0);
    expect(shots.slice(1).every((c) => c.transition?.kind === 'dissolve')).toBe(true);
    expect(shots.filter((c) => c.mediaId.startsWith('p')).every(hasKenBurns)).toBe(true);
    expect(shots[0]!.fadeIn).toBeGreaterThan(0);
    expect(shots.at(-1)!.fadeOut).toBeGreaterThan(0);
    expect(p.clips.find((c) => c.text)?.text?.content).toBe('Vacaciones');
    const music = p.clips.find((c) => c.mediaId === 'song')!;
    expect(clipDur(music)).toBeCloseTo(30, 1);
    expect(p.tracks.find((t) => t.id === music.trackId)!.duck).toBe(0.2);
    // The clips with sound duck the music in the export.
    expect(buildRender(p, defaultExport(p), '/o.mp4').filter).toContain(':eval=frame');
  });

  it('needs at least one photo or clip, and appends after what is there', () => {
    const p0: VideoProject = { ...newProject(), media: [song, ...lib] };
    expect(magicVideo(p0, { mediaIds: ['song'] })).toBeNull();
    const first = magicVideo(p0, { mediaIds: ['p1', 'p2'], duration: 10 })!;
    const second = magicVideo(first.project, { mediaIds: ['p3'], duration: 5 })!;
    const p3 = second.project.clips.find((c) => c.mediaId === 'p3')!;
    expect(p3.start).toBeCloseTo(10);
  });

  it('every theme restyles clips and titles without breaking the project', () => {
    const p0: VideoProject = { ...newProject(), media: [...lib, clipA] };
    const base = magicVideo(p0, { mediaIds: ['p1', 'c1', 'p2'], title: 'Hola' })!.project;
    for (const th of VIDEO_THEMES) {
      const p = applyTheme(base, th.id);
      expect(validProject(p)).toBe(true);
      expect(p.clips.find((c) => c.text)?.text?.font).toBe(th.title.font);
      const moved = p.clips.filter((c) => c.transition);
      expect(moved.every((c) => c.transition!.kind === th.transition.kind)).toBe(true);
    }
  });
});

describe.skipIf(!tools.ffmpeg || !tools.ffprobe)('ducking (FFmpeg)', () => {
  it('the music really drops while the voice plays', async () => {
    const tone = join(dir, 'tone.wav');
    const quiet = join(dir, 'quiet.wav');
    for (const [src, out] of [
      ['sine=frequency=440:duration=6', tone],
      ['anullsrc=r=48000:cl=stereo', quiet],
    ] as const) {
      const g = spawnSync(tools.ffmpeg!, [
        ...['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-t', '6', out],
      ]);
      expect(g.status, g.stderr?.toString()).toBe(0);
    }
    const svc = new VideoService(appRoot, dir, () => undefined);
    const { url: _a, ...mt } = await svc.probe(tone);
    const { url: _b, ...mq } = await svc.probe(quiet);
    let p: VideoProject = {
      ...newProject({ width: 160, height: 90, fps: 30, name: 'duck' }),
      media: [mt, { ...mq, duration: 2 }],
    };
    const a1 = p.tracks.find((t) => t.name === 'A1')!.id;
    const a2 = p.tracks.find((t) => t.name === 'A2')!.id;
    p = insertMedia(p, mt, { trackId: a2, start: 0 }).project;
    // A silent "voice" from 2 s to 4 s: whatever is heard is the music.
    p = insertMedia(p, p.media[1]!, { trackId: a1, start: 2 }).project;
    p = setTrackDuck(p, a2, 0.1);
    const out = join(dir, 'duck.mp4');
    const job = svc.enqueue(
      p,
      { ...defaultExport(p), width: 160, height: 90, preset: 'veryfast' },
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
    const level = (from: number) => {
      const r = spawnSync(tools.ffmpeg!, [
        ...['-v', 'info', '-ss', String(from), '-t', '0.8', '-i', out],
        ...['-af', 'volumedetect', '-vn', '-f', 'null', '-'],
      ]);
      const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr.toString());
      return Number(m?.[1]);
    };
    const before = level(0.6);
    const during = level(2.6);
    const after = level(4.8);
    // 0.1 = −20 dB.
    expect(before - during).toBeGreaterThan(17);
    expect(before - during).toBeLessThan(23);
    expect(Math.abs(before - after)).toBeLessThan(1.5);
  }, 120_000);
});
