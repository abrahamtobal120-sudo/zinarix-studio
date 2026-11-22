import { describe, expect, it } from 'vitest';
import type { MediaItem, VideoProject } from '../src/shared/video.js';
import {
  OVERLAY_SCALE,
  canDetachAudio,
  compositeOrder,
  defaultExport,
  detachAudio,
  insertMedia,
  newProject,
  overlayMedia,
  trackOf,
  validProject,
} from '../src/shared/video.js';
import { pureEdit } from '../src/shared/videoAgent.js';
import { buildRender } from '../src/shared/videoRender.js';

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: 'm1',
  path: '/x/clip.mp4',
  name: 'clip.mp4',
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
const video = item({});
const logo = item({
  id: 'm2',
  path: '/x/logo.png',
  name: 'logo.png',
  kind: 'image',
  duration: 0,
  fps: 0,
  hasAudio: false,
  width: 512,
  height: 512,
});
const song = item({
  id: 'm3',
  path: '/x/song.mp3',
  name: 'song.mp3',
  kind: 'audio',
  hasVideo: false,
  width: 0,
  height: 0,
});

function withVideo(): { p: VideoProject; id: string } {
  let p: VideoProject = { ...newProject({ name: 't' }), media: [video, logo, song] };
  const r = insertMedia(p, video, { start: 2 });
  p = r.project;
  return { p, id: r.clip!.id };
}

describe('detachAudio', () => {
  it('moves the sound of a video clip to an audio track and silences the video', () => {
    const { p: p0, id } = withVideo();
    const p = {
      ...p0,
      clips: p0.clips.map((c) =>
        c.id === id ? { ...c, in: 1, out: 7, speed: 2, volume: 0.8, fadeIn: 0.5 } : c,
      ),
    };
    expect(canDetachAudio(p, p.clips[0])).toBe(true);
    const r = detachAudio(p, [id]);
    expect(r.created).toHaveLength(1);
    const v = r.project.clips.find((c) => c.id === id)!;
    const a = r.project.clips.find((c) => c.id === r.created[0])!;
    expect(v.volume).toBe(0);
    expect(trackOf(r.project, a.trackId)?.kind).toBe('audio');
    expect(a).toMatchObject({
      mediaId: 'm1',
      start: 2,
      in: 1,
      out: 7,
      speed: 2,
      volume: 0.8,
      fadeIn: 0.5,
    });
    expect(validProject(JSON.parse(JSON.stringify(r.project)))).toBe(true);
    // Done once: the silent video clip has nothing left to detach.
    expect(canDetachAudio(r.project, v)).toBe(false);
    expect(detachAudio(r.project, [id]).created).toHaveLength(0);
  });

  it('makes a new audio track when the existing ones are busy', () => {
    const { p: p0, id } = withVideo();
    let p = p0;
    for (const t of p0.tracks.filter((x) => x.kind === 'audio'))
      p = insertMedia(p, song, { trackId: t.id, start: 0 }).project;
    const audioTracks = p.tracks.filter((t) => t.kind === 'audio').length;
    const r = detachAudio(p, [id]);
    expect(r.project.tracks.filter((t) => t.kind === 'audio')).toHaveLength(audioTracks + 1);
  });

  it('skips pictures, silent videos and locked tracks', () => {
    const { p, id } = withVideo();
    const silent = {
      ...p,
      media: p.media.map((m) => (m.id === 'm1' ? { ...m, hasAudio: false } : m)),
    };
    expect(detachAudio(silent, [id]).created).toHaveLength(0);
    const tr = p.clips[0]!.trackId;
    const locked = {
      ...p,
      tracks: p.tracks.map((t) => (t.id === tr ? { ...t, locked: true } : t)),
    };
    expect(detachAudio(locked, [id]).created).toHaveLength(0);
  });

  it('exports the sound once: from the audio clip, not the silent video', () => {
    const { p, id } = withVideo();
    const r = detachAudio(p, [id]);
    const plan = buildRender(r.project, defaultExport(r.project), '/out.mp4');
    const sound = plan.filter.split(';').filter((f) => /^\s*\[\d+:a\]/.test(f));
    expect(sound).toHaveLength(1);
  });

  it('is a video tool for the AI', () => {
    const { p } = withVideo();
    const e = pureEdit(p, 'video_detach_audio', {}, 0);
    expect(e && 'project' in e).toBe(true);
    if (e && 'project' in e) expect(e.project.clips).toHaveLength(2);
    const none = pureEdit(p, 'video_detach_audio', { clips: ['nope'] }, 0);
    expect(none && 'error' in none).toBe(true);
  });
});

describe('overlayMedia', () => {
  it('puts a picture on a track above the video at the playhead, smaller', () => {
    const { p } = withVideo();
    const r = overlayMedia(p, logo, 4);
    const c = r.clip!;
    expect(c.start).toBe(4);
    expect(c.transform?.scale).toBe(OVERLAY_SCALE);
    const order = compositeOrder(r.project).map((t) => t.id);
    expect(order.indexOf(c.trackId)).toBeGreaterThan(order.indexOf(p.clips[0]!.trackId));
    // As long as the video it covers (5 s at most).
    expect(c.out - c.in).toBeCloseTo(5);
    // Another one at the same time stacks above the first.
    const r2 = overlayMedia(r.project, logo, 4);
    const order2 = compositeOrder(r2.project).map((t) => t.id);
    expect(order2.indexOf(r2.clip!.trackId)).toBeGreaterThan(order2.indexOf(c.trackId));
  });

  it('stops a picture where the video under it ends', () => {
    const { p } = withVideo(); // the video plays 2 … 12 s
    expect(overlayMedia(p, logo, 10).clip!.out).toBeCloseTo(2);
  });

  it('falls back to a normal insert with an empty timeline or audio', () => {
    const p: VideoProject = { ...newProject({ name: 't' }), media: [logo, song] };
    expect(overlayMedia(p, logo, 0).clip!.transform).toBeUndefined();
    const { p: q } = withVideo();
    const a = overlayMedia(q, song, 3).clip!;
    expect(trackOf(q, a.trackId) ?? { kind: 'audio' }).toMatchObject({ kind: 'audio' });
  });

  it('is exported as an overlay on top of the video', () => {
    const { p } = withVideo();
    const r = overlayMedia(p, logo, 4);
    const plan = buildRender(r.project, defaultExport(r.project), '/out.mp4');
    expect((plan.filter.match(/overlay=/g) ?? []).length).toBe(2);
  });
});
