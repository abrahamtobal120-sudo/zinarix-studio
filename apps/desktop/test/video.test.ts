import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { VideoService, findFfmpeg, fromStored, parseProbe, toStored } from '../src/main/video.js';
import type { VideoJob } from '../src/main/video.js';
import {
  addMarker,
  clipEnd,
  defaultExport,
  fits,
  insertMedia,
  moveClips,
  newProject,
  projectDuration,
  removeClips,
  setClipSpeed,
  setFades,
  setTransform,
  snap,
  snapPoints,
  splitAt,
  timecode,
  trimClip,
  validProject,
} from '../src/shared/video.js';
import type { MediaItem, VideoProject } from '../src/shared/video.js';
import { buildRender } from '../src/shared/videoRender.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);
const dir = mkdtempSync(join(tmpdir(), 'zvs-'));
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

function withClip(): { p: VideoProject; id: string } {
  const p0 = { ...newProject(), media: [media()] };
  const { project, clip } = insertMedia(p0, p0.media[0]!);
  return { p: project, id: clip!.id };
}

describe('video model', () => {
  it('places media on V1 and appends after the last clip', () => {
    const { p } = withClip();
    const v1 = p.tracks.find((t) => t.name === 'V1')!;
    expect(p.clips[0]!.trackId).toBe(v1.id);
    const second = insertMedia(p, p.media[0]!);
    expect(second.clip!.start).toBe(10);
    expect(projectDuration(second.project)).toBe(20);
  });

  it('splits at the playhead, keeping source times continuous', () => {
    const { p } = withClip();
    const { project, created } = splitAt(p, 4);
    expect(created).toHaveLength(1);
    const [a, b] = [...project.clips].sort((x, y) => x.start - y.start);
    expect([a!.in, a!.out, b!.start, b!.in, b!.out]).toEqual([0, 4, 4, 4, 10]);
  });

  it('ripple delete closes the gap; plain delete leaves it', () => {
    const { p } = withClip();
    const { project } = splitAt(p, 4);
    const left = project.clips.find((c) => c.start === 0)!;
    expect(projectDuration(removeClips(project, new Set([left.id]), true))).toBe(6);
    expect(projectDuration(removeClips(project, new Set([left.id]), false))).toBe(10);
  });

  it('refuses moves that overlap and allows free ones', () => {
    const { p } = withClip();
    const { project } = splitAt(p, 4);
    const left = project.clips.find((c) => c.start === 0)!;
    expect(moveClips(project, new Set([left.id]), 2)).toBeNull();
    const moved = moveClips(
      removeClips(project, new Set([project.clips.find((c) => c.start === 4)!.id])),
      new Set([left.id]),
      3,
    )!;
    expect(moved.clips[0]!.start).toBe(3);
    // V1 → V2 (one track up in display order is index -1).
    expect(moveClips(project, new Set([left.id]), 0, -1)).not.toBeNull();
  });

  it('trims within the media and the neighbours', () => {
    const { p, id } = withClip();
    expect(clipEnd(trimClip(p, id, 'right', 50).clips[0]!)).toBe(10);
    const t = trimClip(p, id, 'left', 2).clips[0]!;
    expect([t.start, t.in, t.out]).toEqual([2, 2, 10]);
    expect(trimClip(p, id, 'left', -5).clips[0]!.start).toBe(0);
    expect(fits(p, p.clips[0]!.trackId, 10, 12)).toBe(true);
  });

  it('snaps to edges and markers', () => {
    const { p } = withClip();
    const m = addMarker(p, 7.5);
    expect(snap(7.45, snapPoints(m, 0), 0.1)).toBe(7.5);
    expect(snap(5, snapPoints(m, 0), 0.1)).toBeNull();
    expect(timecode(83.5, 30)).toBe('00:01:23:15');
  });

  it('stores media paths relative to the project and validates files', () => {
    const p = { ...newProject(), media: [media({ path: join(dir, 'clips', 'a.mp4') })] };
    const stored = toStored(p, dir) as VideoProject;
    expect(stored.media[0]!.path).toBe('clips/a.mp4');
    expect(validProject(stored)).toBe(true);
    expect(validProject({ version: 2 })).toBe(false);
    const back = fromStored(stored, dir);
    expect(back.media[0]!.path).toBe(join(dir, 'clips', 'a.mp4'));
    expect(back.media[0]!.missing).toBe(true);
  });

  it('reads ffprobe output (audio-only, cover art ignored)', () => {
    const m = parseProbe(
      '/a/song.mp3',
      {
        format: { duration: '12.5' },
        streams: [
          { codec_type: 'audio' },
          { codec_type: 'video', width: 500, height: 500, disposition: { attached_pic: 1 } },
        ],
      },
      10,
    );
    expect([m.kind, m.hasVideo, m.hasAudio, m.duration]).toEqual(['audio', false, true, 12.5]);
  });

  it('builds a filter graph with one overlay per visible clip and a mix', () => {
    const { p } = withClip();
    const { project } = splitAt(p, 4);
    const plan = buildRender(project, { ...defaultExport(project), start: 0, end: 8 }, 'out.mp4');
    expect(plan.clips).toBe(2);
    expect(plan.filter.match(/overlay=/g)).toHaveLength(2);
    expect(plan.filter).toMatch(/amix=inputs=2/);
    expect(plan.inputs.filter((a) => a === '-i')).toHaveLength(2);
    expect(plan.output.at(-1)).toBe('out.mp4');
  });
});

describe('clip speed, transform and fades', () => {
  it('speed changes the timeline length and keeps split/trim on the source', () => {
    const { p, id } = withClip();
    const fast = setClipSpeed(p, id, 2);
    const c = fast.clips[0]!;
    expect(clipEnd(c)).toBeCloseTo(5, 6);
    // Splitting at 2 s on the timeline cuts the source at 4 s.
    const { project } = splitAt(fast, 2);
    const [l, r] = [...project.clips].sort((a, b) => a.start - b.start);
    expect(l!.out).toBeCloseTo(4, 6);
    expect(r!.in).toBeCloseTo(4, 6);
    expect(clipEnd(r!)).toBeCloseTo(5, 6);
    // Trimming the right edge out to 8 s stops at the end of the media (10 s of source = 5 s).
    expect(clipEnd(trimClip(fast, id, 'right', 8).clips[0]!)).toBeCloseTo(5, 6);
  });

  it('slowing down never runs into the next clip', () => {
    const { p, id } = withClip();
    const two = insertMedia(p, p.media[0]!).project; // second clip at 10 s
    const slow = setClipSpeed(two, id, 0.5);
    const c = slow.clips.find((x) => x.id === id)!;
    expect(clipEnd(c)).toBeCloseTo(10, 6);
    expect(c.out).toBeCloseTo(5, 6);
    expect(setClipSpeed(p, id, 1).clips[0]!.speed).toBeUndefined();
  });

  it('keeps fades inside the clip and drops an identity transform', () => {
    const { p, id } = withClip();
    const f = setFades(setFades(p, id, { fadeIn: 7 }), id, { fadeOut: 7 });
    const c = f.clips[0]!;
    expect((c.fadeIn ?? 0) + (c.fadeOut ?? 0)).toBeLessThanOrEqual(10 + 1e-6);
    const moved = setTransform(p, id, { x: 0.25, rotation: 90 });
    expect(moved.clips[0]!.transform?.x).toBe(0.25);
    expect(setTransform(moved, id, { x: 0, rotation: 0 }).clips[0]!.transform).toBeUndefined();
  });

  it('puts speed, transform and fades in the graph, numbers only', () => {
    const { p, id } = withClip();
    let q = setClipSpeed(p, id, 2);
    q = setTransform(q, id, { scale: 0.5, rotation: 45, opacity: 0.5, flipH: true, x: 0.1 });
    q = setFades(q, id, { fadeIn: 1, fadeOut: 1 });
    // A hostile file must not inject filters through a field.
    q = {
      ...q,
      clips: q.clips.map((c) => ({
        ...c,
        transform: { ...c.transform!, y: '0;[0:v]evil' as unknown as number },
      })),
    };
    const plan = buildRender(q, defaultExport(q), '/out.mp4');
    expect(plan.inputs).toContain('10'); // 5 s on the timeline = 10 s of source
    expect(plan.filter).toContain('setpts=(PTS-STARTPTS)/2');
    expect(plan.filter).toContain('atempo=2');
    expect(plan.filter).toContain('hflip');
    expect(plan.filter).toContain('rotate=a=');
    expect(plan.filter).toContain('colorchannelmixer=aa=0.5');
    expect(plan.filter).toContain('fade=t=out:st=4:d=1:alpha=1');
    expect(plan.filter).toContain('afade=t=in:st=0:d=1');
    expect(plan.filter).not.toContain('evil');
  });
});

describe.skipIf(!tools.ffmpeg || !tools.ffprobe)('video smoke (FFmpeg)', () => {
  it('imports a video, cuts it and exports a 5 s MP4', async () => {
    const src = join(dir, 'source.mp4');
    const gen = spawnSync(tools.ffmpeg!, [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=8',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=8',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      src,
    ]);
    expect(gen.status, gen.stderr?.toString()).toBe(0);

    const jobs: VideoJob[] = [];
    const svc = new VideoService(appRoot, dir, (j) => jobs.push(j));
    const probed = await svc.probe(src);
    expect(probed.kind).toBe('video');
    expect(probed.duration).toBeGreaterThan(7.5);
    expect(probed.url).toMatch(/^zmedia:\/\/media\//);

    // Thumbnails and waveform for the timeline.
    expect(await svc.thumbnails(src, probed.duration, 8)).toMatch(/^zmedia:/);
    const wave = await svc.waveform(src);
    expect(wave.peaks.length).toBeGreaterThan(300);

    // The protocol serves byte ranges of allowed files only.
    const ranged = await svc.serve(new Request(probed.url, { headers: { range: 'bytes=0-99' } }));
    expect(ranged.status).toBe(206);
    expect((await ranged.arrayBuffer()).byteLength).toBe(100);
    expect((await svc.serve(new Request('zmedia://media/nope.mp4'))).status).toBe(403);

    // Edit: drop it on the timeline, cut out 2–3 s with ripple delete → 7 s; export 0–5 s.
    const { url: _u, ...item } = probed;
    let p: VideoProject = {
      ...newProject({ width: 640, height: 360, fps: 30, name: 'smoke' }),
      media: [item],
    };
    p = insertMedia(p, item).project;
    p = splitAt(p, 2).project;
    p = splitAt(p, 3).project;
    const middle = p.clips.find((c) => Math.abs(c.start - 2) < 1e-6)!;
    p = removeClips(p, new Set([middle.id]), true);
    expect(projectDuration(p)).toBeCloseTo(probed.duration - 1, 2);

    const out = join(dir, 'smoke.mp4');
    const job = svc.enqueue(
      p,
      { ...defaultExport(p), width: 640, height: 360, start: 0, end: 5, preset: 'veryfast' },
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
    expect(existsSync(out)).toBe(true);
    expect(jobs.some((j) => j.progress > 0 && j.progress < 1) || final.progress === 1).toBe(true);

    const check = await svc.probe(out);
    expect(check.duration).toBeGreaterThan(4.8);
    expect(check.duration).toBeLessThan(5.2);
    expect([check.width, check.height, check.hasAudio]).toEqual([640, 360, true]);
  }, 120_000);

  it('renders transform, speed and fades with real FFmpeg', async () => {
    const src = join(dir, 'fx.mp4');
    const gen = spawnSync(tools.ffmpeg!, [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=30:duration=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=6',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      src,
    ]);
    expect(gen.status, gen.stderr?.toString()).toBe(0);
    const svc = new VideoService(appRoot, dir, () => undefined);
    const { url: _u, ...item } = await svc.probe(src);
    let p: VideoProject = {
      ...newProject({ width: 320, height: 180, fps: 30, name: 'fx' }),
      media: [item],
    };
    const ins = insertMedia(p, item);
    p = setClipSpeed(ins.project, ins.clip!.id, 2); // 6 s of source → 3 s
    p = setTransform(p, ins.clip!.id, {
      scale: 0.6,
      rotation: 30,
      opacity: 0.8,
      flipH: true,
      x: 0.1,
    });
    p = setFades(p, ins.clip!.id, { fadeIn: 0.5, fadeOut: 0.5 });
    const out = join(dir, 'fx-out.mp4');
    const job = svc.enqueue(
      p,
      { ...defaultExport(p), width: 320, height: 180, preset: 'veryfast' },
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
    expect(check.duration).toBeGreaterThan(2.8);
    expect(check.duration).toBeLessThan(3.2);
    expect(check.hasAudio).toBe(true);
  }, 120_000);
});
