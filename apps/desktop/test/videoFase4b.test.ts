// Fase 4 (mejora): mixer level meters and the auto zoom of screen recordings.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

let cursor = { x: 100, y: 100 };
vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: async () => [{ id: 'screen:1:0', display_id: '7', name: 'Pantalla' }],
  },
  screen: {
    getAllDisplays: () => [{ id: 7, bounds: { x: 0, y: 0, width: 1000, height: 500 } }],
    getCursorScreenPoint: () => cursor,
  },
}));

import { Recorder } from '../src/main/recorder.js';
import type { Clip, MediaItem, VideoProject } from '../src/shared/video.js';
import {
  insertMedia,
  interpKeys,
  newProject,
  setTrackMix,
  transformAt,
  updateTrack,
  validProject,
} from '../src/shared/video.js';
import { meterFall, meterFrac, mixLevels, toDb, wavePeak } from '../src/shared/videoMeter.js';
import type { CursorTrack } from '../src/shared/videoZoom.js';
import {
  autoZoomKeys,
  cursorFile,
  findRests,
  parseCursorTrack,
  withAutoZoom,
  withoutZoom,
} from '../src/shared/videoZoom.js';
import { VIDEO_TOOLS } from '../src/main/videoTools.js';

const media = (over: Partial<MediaItem> = {}): MediaItem =>
  ({
    id: 'm1',
    name: 'a.mp4',
    path: 'C:/a.mp4',
    kind: 'video',
    duration: 20,
    width: 1920,
    height: 1080,
    hasAudio: true,
    hasVideo: true,
    ...over,
  }) as MediaItem;

function project(...items: MediaItem[]): VideoProject {
  let p = newProject({ name: 't' });
  p = { ...p, media: items };
  for (const m of items) {
    const track = p.tracks.find((t) => t.kind === (m.kind === 'audio' ? 'audio' : 'video'))!;
    p = insertMedia(p, m, { trackId: track.id, start: 0 }).project;
  }
  return p;
}

// ---------------- meters ----------------

describe('mixer level meters', () => {
  const wave = { pps: 10, peaks: Array.from({ length: 200 }, (_, i) => (i < 100 ? 255 : 64)) };

  it('reads the waveform peak around a source second', () => {
    expect(wavePeak(wave, 1, 0.05)).toBe(1);
    expect(wavePeak(wave, 15, 0.05)).toBeCloseTo(64 / 255, 6);
    expect(wavePeak(undefined, 1, 0.05)).toBe(0);
    expect(wavePeak(wave, 99, 0.05)).toBe(0);
  });

  it('follows clip and track volume, mute, solo and pan', () => {
    let p = project(media());
    const clip = p.clips[0]!;
    const tr = clip.trackId;
    let lv = mixLevels(p, { m1: wave }, 1);
    expect(lv.tracks[tr]!.l).toBeCloseTo(1, 6);
    expect(lv.master.l).toBeCloseTo(1, 6);
    p = setTrackMix(p, tr, { volume: 0.5 });
    lv = mixLevels(p, { m1: wave }, 1);
    expect(toDb(lv.tracks[tr]!.l)).toBeCloseTo(-6.02, 1);
    p = setTrackMix(p, tr, { pan: 1 });
    lv = mixLevels(p, { m1: wave }, 1);
    expect(lv.tracks[tr]!.l).toBe(0);
    expect(lv.tracks[tr]!.r).toBeCloseTo(0.5, 6);
    p = updateTrack(p, tr, { muted: true });
    expect(mixLevels(p, { m1: wave }, 1).master.r).toBe(0);
    // Outside the clip, and media without sound, are silent.
    expect(mixLevels(project(media()), { m1: wave }, 30).master.l).toBe(0);
    expect(mixLevels(project(media({ hasAudio: false })), { m1: wave }, 1).master.l).toBe(0);
  });

  it('two loud tracks add up as uncorrelated sound; meters fall slowly', () => {
    const p = project(
      media(),
      media({ id: 'm2', kind: 'audio', hasVideo: false, path: 'C:/b.wav' }),
    );
    const lv = mixLevels(p, { m1: wave, m2: wave }, 1);
    expect(lv.master.l).toBeCloseTo(Math.SQRT2, 6);
    expect(meterFrac(1)).toBeCloseTo(60 / 66, 6);
    expect(meterFrac(0)).toBe(0);
    expect(meterFrac(10)).toBe(1);
    // Jumps up at once; falls 24 dB/s.
    expect(meterFall(0.1, 0.9, 0.1)).toBe(0.9);
    expect(toDb(meterFall(1, 0, 0.5))).toBeCloseTo(-12, 6);
    expect(meterFall(0.01, 0, 2)).toBe(0);
  });
});

// ---------------- auto zoom ----------------

/** Cursor that moves, rests at (0.8, 0.2) from 2 to 5 s, moves, rests at (0.3, 0.7) from 5.6 to 8 s. */
function track(): CursorTrack {
  const s: [number, number, number][] = [];
  for (let t = 0; t < 2000; t += 33) s.push([t, 0.1 + (t / 2000) * 0.7, 0.5 - (t / 2000) * 0.3]);
  s.push([2000, 0.8, 0.2], [3000, 0.8, 0.2], [4000, 0.8, 0.2], [5000, 0.8, 0.2]);
  for (let t = 5033; t < 5600; t += 33)
    s.push([t, 0.8 - ((t - 5000) / 600) * 0.5, 0.2 + ((t - 5000) / 600) * 0.5]);
  s.push([5600, 0.3, 0.7], [6600, 0.3, 0.7], [7600, 0.3, 0.7], [8000, 0.3, 0.7]);
  for (let t = 8033; t < 10000; t += 33) s.push([t, 0.3 + ((t - 8000) / 2000) * 0.5, 0.7]);
  return { v: 1, w: 1920, h: 1080, samples: s };
}

describe('auto zoom', () => {
  it('finds where the cursor rests', () => {
    const r = findRests(track());
    expect(r).toHaveLength(2);
    expect(r[0]!.x).toBeCloseTo(0.8, 2);
    expect(r[0]!.t0).toBeCloseTo(2, 1);
    expect(r[0]!.t1).toBeGreaterThan(4.9);
    expect(r[1]!.y).toBeCloseTo(0.7, 2);
    // Shorter than minRest: nothing.
    expect(findRests(track(), { minRest: 5 })).toHaveLength(0);
  });

  it('zooms in towards the rest, pans to the next one and zooms out', () => {
    const p = project(media());
    const c = p.clips[0]!;
    const k = autoZoomKeys(p, c, track(), { scale: 2 })!;
    expect(k.rests).toBe(2);
    // One chain (the second rest comes 0.6 s after the first): one zoom in and one out.
    expect(k.scale.map((x) => x.v)).toEqual([1, 2, 2, 1]);
    const at = (t: number) => ({
      s: interpKeys(k.scale, t),
      x: interpKeys(k.x, t),
      y: interpKeys(k.y, t),
    });
    expect(at(0.5).s).toBe(1);
    expect(at(0.5).x).toBe(0);
    const first = at(3);
    expect(first.s).toBe(2);
    // The point (0.8, 0.2) is brought towards the centre: picture moves left and down.
    expect(first.x).toBeLessThan(0);
    expect(first.y).toBeGreaterThan(0);
    // Never further than the edges allow.
    expect(Math.abs(first.x)).toBeLessThanOrEqual(0.5 + 1e-9);
    const second = at(7);
    expect(second.x).toBeGreaterThan(0);
    expect(second.y).toBeLessThan(0);
    expect(at(9.8)).toEqual({ s: 1, x: 0, y: 0 });
    // Keys sorted and the project still valid.
    for (const list of [k.scale, k.x, k.y])
      for (let i = 1; i < list.length; i++) expect(list[i]!.t).toBeGreaterThan(list[i - 1]!.t);
    const z = { ...p, clips: [withAutoZoom(c, k)] };
    expect(validProject(z)).toBe(true);
    expect(transformAt(z.clips[0]!, 3).scale).toBe(2);
    const back = withoutZoom(z.clips[0]!);
    expect(back.keyframes).toBeUndefined();
  });

  it('far apart rests are two zooms; a clip that skips the rests gets none', () => {
    const p = project(media());
    const c = p.clips[0]!;
    const k = autoZoomKeys(p, c, track(), { join: 0.1 })!;
    // The second zoom starts right where the first one ended (one shared key at 1×).
    expect(k.scale.map((x) => x.v)).toEqual([1, 1.8, 1.8, 1, 1.8, 1.8, 1]);
    const late: Clip = { ...c, in: 9, out: 10 };
    expect(autoZoomKeys(p, late, track())).toBeNull();
  });

  it('reads only well-formed cursor files', () => {
    expect(parseCursorTrack(JSON.stringify(track()))!.samples.length).toBe(track().samples.length);
    expect(parseCursorTrack('nope')).toBeNull();
    expect(parseCursorTrack(JSON.stringify({ v: 2, w: 1, h: 1, samples: [] }))).toBeNull();
    expect(
      parseCursorTrack(
        JSON.stringify({
          v: 1,
          w: 1,
          h: 1,
          samples: [
            [2, 0, 0],
            [1, 0, 0],
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseCursorTrack(JSON.stringify({ v: 1, w: 1, h: 1, samples: [[1, 'x', 0]] })),
    ).toBeNull();
    expect(cursorFile('C:/r.webm')).toBe('C:/r.webm.cursor.json');
    expect(VIDEO_TOOLS.some((t) => t.name === 'video_auto_zoom')).toBe(true);
  });
});

describe('Recorder saves the cursor path of a screen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zs-cursor-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('samples the mouse on the picked screen, stops while paused, writes it next to the file', async () => {
    const rec = new Recorder(() => null);
    let handler: ((req: unknown, cb: (x: unknown) => void) => void) | null = null;
    rec.install({ setDisplayMediaRequestHandler: (fn: typeof handler) => (handler = fn) } as never);
    rec.select('screen:1:0', false);
    const answered = await new Promise<unknown>((r) => handler!({}, r));
    expect(answered).toHaveProperty('video');
    const r = rec.start(dir, 'g');
    expect(rec.trackCursor(r.id)).toBe(true);
    await rec.write(r.id, new Uint8Array([1, 2, 3]));
    cursor = { x: 500, y: 250 };
    await new Promise((res) => setTimeout(res, 150));
    rec.pauseCursor(r.id, true);
    cursor = { x: 900, y: 50 };
    await new Promise((res) => setTimeout(res, 150));
    rec.pauseCursor(r.id, false);
    await new Promise((res) => setTimeout(res, 100));
    const path = await rec.finish(r.id);
    const file = cursorFile(path);
    expect(existsSync(file)).toBe(true);
    const t = parseCursorTrack(readFileSync(file, 'utf8'))!;
    expect(t.w).toBe(1000);
    expect(t.samples.some(([, x, y]) => x === 0.5 && y === 0.5)).toBe(true);
    // The pause took ~150 ms out of the clock: the last sample is well under 400 ms.
    expect(t.samples[t.samples.length - 1]![0]).toBeLessThan(330);
    expect(t.samples.at(-1)!.slice(1)).toEqual([0.9, 0.1]);
  });

  it('a window has no cursor path', async () => {
    const rec = new Recorder(() => null);
    const r = rec.start(dir, 'w');
    expect(rec.trackCursor(r.id)).toBe(false);
    await rec.abort(r.id);
  });
});
