import { describe, expect, it } from 'vitest';
import {
  OTIO_MAX_ITEMS,
  fileUrlToPath,
  otioToProject,
  pathToFileUrl,
  projectToOtio,
} from '../src/shared/otio.js';
import type { Clip, MediaItem, VideoProject } from '../src/shared/video.js';
import { clipEnd, newProject, validProject } from '../src/shared/video.js';

const FPS = 30;
const frame = 1 / FPS;

function media(id: string, path: string, kind: MediaItem['kind'], duration: number): MediaItem {
  return {
    id,
    path,
    name: path.split(/[\\/]/).pop()!,
    kind,
    duration,
    width: 1920,
    height: 1080,
    fps: FPS,
    hasVideo: kind !== 'audio',
    hasAudio: kind !== 'image',
    size: 1000,
  };
}

/** 2 video tracks + 1 audio track, gaps, a 2x clip and markers. */
function sample(): VideoProject {
  const p = newProject({ name: 'Prueba', fps: FPS });
  const [v2, v1, a1] = p.tracks;
  const tracks = [v2!, v1!, a1!];
  const m = [
    media('m1', 'C:\\Videos\\toma uno.mp4', 'video', 20),
    media('m2', 'C:\\Videos\\b-roll.mov', 'video', 30),
    media('m3', 'C:\\Audio\\música.wav', 'audio', 60),
  ];
  const c = (x: Partial<Clip> & Pick<Clip, 'id' | 'mediaId' | 'trackId'>): Clip => ({
    start: 0,
    in: 0,
    out: 1,
    volume: 1,
    ...x,
  });
  const clips: Clip[] = [
    c({ id: 'a', mediaId: 'm1', trackId: v1!.id, start: 0, in: 2, out: 6 }),
    // gap 4..5, then a 2x clip lasting 3 s
    c({ id: 'b', mediaId: 'm2', trackId: v1!.id, start: 5, in: 1, out: 7, speed: 2 }),
    c({ id: 'c', mediaId: 'm2', trackId: v2!.id, start: 1.5, in: 10, out: 12.5 }),
    c({ id: 'd', mediaId: 'm3', trackId: a1!.id, start: 0.5, in: 0, out: 9, volume: 0.5 }),
  ];
  return {
    ...p,
    tracks,
    media: m,
    clips,
    markers: [
      { id: 'k1', time: 1, name: 'Inicio', color: '#e5484d' },
      { id: 'k2', time: 6.5, name: 'Corte', color: '#3e63dd' },
    ],
  };
}

describe('projectToOtio / otioToProject', () => {
  it('round trips cuts, tracks, speed and markers', () => {
    const p = sample();
    const { json, skipped } = projectToOtio(p);
    expect(skipped).toEqual([]);
    const tl = JSON.parse(json);
    expect(tl.OTIO_SCHEMA).toBe('Timeline.1');
    // OTIO stacks go bottom-up: V1 first.
    expect(tl.tracks.children.map((t: { name: string }) => t.name)).toEqual(['V1', 'V2', 'A1']);
    expect(
      tl.tracks.children[0].children.map((x: { OTIO_SCHEMA: string }) => x.OTIO_SCHEMA),
    ).toEqual(['Clip.2', 'Gap.1', 'Clip.2']);
    const warp = tl.tracks.children[0].children[2].effects[0];
    expect(warp).toMatchObject({ OTIO_SCHEMA: 'LinearTimeWarp.1', time_scalar: 2 });

    const { project: q, warnings } = otioToProject(json);
    expect(warnings).toEqual([]);
    expect(validProject(q)).toBe(true);
    expect(q.fps).toBe(FPS);
    expect(q.tracks.map((t) => `${t.kind}:${t.name}`)).toEqual([
      'video:V2',
      'video:V1',
      'audio:A1',
    ]);
    expect(q.media).toHaveLength(3);
    expect(q.media.map((m) => m.path).sort()).toEqual(p.media.map((m) => m.path).sort());

    for (const orig of p.clips) {
      const track = p.tracks.find((t) => t.id === orig.trackId)!;
      const qTrack = q.tracks.find((t) => t.name === track.name)!;
      const origPath = p.media.find((m) => m.id === orig.mediaId)!.path;
      const got = q.clips.find(
        (c) =>
          c.trackId === qTrack.id &&
          q.media.find((m) => m.id === c.mediaId)!.path === origPath &&
          Math.abs(c.start - orig.start) <= frame,
      );
      expect(got, orig.id).toBeDefined();
      expect(Math.abs(got!.in - orig.in)).toBeLessThanOrEqual(frame);
      expect(Math.abs(got!.out - orig.out)).toBeLessThanOrEqual(frame);
      expect(Math.abs(clipEnd(got!) - clipEnd(orig))).toBeLessThanOrEqual(frame);
      expect(got!.speed ?? 1).toBe(orig.speed ?? 1);
      expect(got!.volume).toBe(orig.volume);
    }
    expect(q.markers.map((m) => [m.name, m.time, m.color])).toEqual([
      ['Inicio', 1, '#e5484d'],
      ['Corte', 6.5, '#3e63dd'],
    ]);
    expect(q.media.find((m) => m.path.endsWith('.wav'))).toMatchObject({
      kind: 'audio',
      duration: 60,
      hasVideo: false,
      hasAudio: true,
    });
  });

  it('notes what is not exported, titles become gaps', () => {
    const p = sample();
    const v2 = p.tracks[0]!;
    p.clips.push({
      id: 't',
      mediaId: '',
      trackId: v2.id,
      start: 6,
      in: 0,
      out: 3,
      volume: 0,
      text: { text: 'Hola' } as unknown as Clip['text'],
    });
    p.clips[0]!.color = {} as Clip['color'];
    p.clips[1]!.transform = {
      x: 0.1,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
      flipH: false,
      flipV: false,
    };
    const { json, skipped } = projectToOtio(p);
    expect(skipped.some((s) => s.startsWith('Títulos') && s.includes('1 clip'))).toBe(true);
    expect(skipped.some((s) => s.startsWith('Corrección de color'))).toBe(true);
    expect(skipped.some((s) => s.startsWith('Transformaciones'))).toBe(true);
    expect(skipped.every((s) => s.includes('no se exportan') || s.includes('OTIO'))).toBe(true);
    const tl = JSON.parse(json);
    const v2Otio = tl.tracks.children[1];
    expect(v2Otio.children.at(-1).OTIO_SCHEMA).toBe('Gap.1');
  });
});

describe('paths and file URLs', () => {
  it('Windows paths', () => {
    expect(pathToFileUrl('C:\\x\\a.mp4')).toBe('file:///C:/x/a.mp4');
    expect(pathToFileUrl('C:\\Mis videos\\toma #1.mp4')).toBe(
      'file:///C:/Mis%20videos/toma%20%231.mp4',
    );
    expect(fileUrlToPath('file:///C:/Mis%20videos/toma%20%231.mp4')).toBe(
      'C:\\Mis videos\\toma #1.mp4',
    );
    expect(fileUrlToPath('file:///c:/x/a.mp4')).toBe('C:\\x\\a.mp4');
    expect(fileUrlToPath(pathToFileUrl('\\\\server\\share\\a b.mov'))).toBe(
      '\\\\server\\share\\a b.mov',
    );
  });

  it('POSIX paths', () => {
    expect(pathToFileUrl('/home/a.mp4')).toBe('file:///home/a.mp4');
    expect(pathToFileUrl('/home/me/año 1.mp4')).toBe('file:///home/me/a%C3%B1o%201.mp4');
    expect(fileUrlToPath('file:///home/me/a%C3%B1o%201.mp4')).toBe('/home/me/año 1.mp4');
    expect(fileUrlToPath('file://localhost/home/a.mp4')).toBe('/home/a.mp4');
  });
});

describe('otioToProject refuses bad input', () => {
  it('garbage', () => {
    expect(() => otioToProject('not json {')).toThrow(/OTIO/);
    expect(() => otioToProject('null')).toThrow(/OTIO/);
    expect(() => otioToProject('[1,2]')).toThrow(/OTIO/);
    expect(() => otioToProject(JSON.stringify({ OTIO_SCHEMA: 'Clip.2' }))).toThrow(/OTIO/);
    expect(() => otioToProject(JSON.stringify({ OTIO_SCHEMA: 'Timeline.1' }))).toThrow();
  });

  it('huge', () => {
    const gaps = Array.from({ length: OTIO_MAX_ITEMS + 1 }, () => ({ OTIO_SCHEMA: 'Gap.1' }));
    const tl = {
      OTIO_SCHEMA: 'Timeline.1',
      tracks: { OTIO_SCHEMA: 'Stack.1', children: [{ OTIO_SCHEMA: 'Track.1', children: gaps }] },
    };
    expect(() => otioToProject(JSON.stringify(tl))).toThrow(/demasiados/);
    const many = {
      OTIO_SCHEMA: 'Timeline.1',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: Array.from({ length: 201 }, () => ({ OTIO_SCHEMA: 'Track.1', children: [] })),
      },
    };
    expect(() => otioToProject(JSON.stringify(many))).toThrow(/demasiadas/);
  });

  it('broken numbers are ignored, not propagated', () => {
    const tl = {
      OTIO_SCHEMA: 'Timeline.1',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            kind: 'Video',
            children: [
              {
                OTIO_SCHEMA: 'Clip.2',
                source_range: {
                  start_time: { value: 'x', rate: 24 },
                  duration: { value: 10, rate: 0 },
                },
                media_references: {
                  DEFAULT_MEDIA: {
                    OTIO_SCHEMA: 'ExternalReference.1',
                    target_url: 'file:///a.mp4',
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const { project, warnings } = otioToProject(JSON.stringify(tl));
    expect(validProject(project)).toBe(true);
    expect(project.clips).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('legacy and foreign files', () => {
  it('imports Clip.1 with media_reference, available_range offset and transitions', () => {
    const rt = (value: number) => ({ OTIO_SCHEMA: 'RationalTime.1', value, rate: 24 });
    const range = (s: number, d: number) => ({
      OTIO_SCHEMA: 'TimeRange.1',
      start_time: rt(s),
      duration: rt(d),
    });
    const tl = {
      OTIO_SCHEMA: 'Timeline.1',
      name: 'Vieja',
      global_start_time: null,
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            kind: 'Video',
            children: [
              { OTIO_SCHEMA: 'Gap.1', source_range: range(0, 24) },
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'a',
                // Media starts at timecode 01:00:00:00 (86400 frames at 24).
                source_range: range(86400 + 48, 72),
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'file:///D:/clips/a%20b.mov',
                  available_range: range(86400, 240),
                },
              },
              { OTIO_SCHEMA: 'Transition.1', in_offset: rt(6), out_offset: rt(6) },
              {
                OTIO_SCHEMA: 'Clip.1',
                source_range: range(0, 24),
                media_reference: { OTIO_SCHEMA: 'MissingReference.1' },
              },
              {
                OTIO_SCHEMA: 'Clip.1',
                source_range: range(0, 24),
                effects: [{ OTIO_SCHEMA: 'LinearTimeWarp.1', time_scalar: 10 }],
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'file:///D:/clips/a%20b.mov',
                },
              },
            ],
          },
        ],
      },
    };
    const { project, warnings } = otioToProject(JSON.stringify(tl), { name: 'X' });
    expect(validProject(project)).toBe(true);
    expect(project.name).toBe('X');
    expect(project.fps).toBe(24);
    expect(project.media).toHaveLength(1);
    expect(project.media[0]).toMatchObject({
      path: 'D:\\clips\\a b.mov',
      kind: 'video',
      duration: 10,
    });
    expect(project.clips).toHaveLength(2);
    const [a, b] = [...project.clips].sort((x, y) => x.start - y.start);
    expect(a).toMatchObject({ start: 1, in: 2, out: 5 });
    // after the missing-reference gap (1 s)
    expect(b!.start).toBeCloseTo(5);
    expect(b!.speed).toBe(4);
    expect(warnings.some((w) => w.startsWith('Transiciones'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('Clips sin archivo'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('Velocidades'))).toBe(true);
    // an audio track is added so the editor has one of each kind
    expect(project.tracks.map((t) => t.kind)).toEqual(['video', 'audio']);
  });
});
