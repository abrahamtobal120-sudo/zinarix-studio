import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Transcriber } from '../src/main/transcribe.js';
import { VideoService, findFfmpeg } from '../src/main/video.js';
import type { MediaItem, Transcript, VideoProject } from '../src/shared/video.js';
import {
  clipDur,
  clipEnd,
  defaultExport,
  insertMedia,
  newProject,
  validProject,
} from '../src/shared/video.js';
import {
  cuesOfTrack,
  cutClipRanges,
  cutMediaRanges,
  fillerIndexes,
  groupCues,
  isFiller,
  mergeRanges,
  parseScenes,
  parseSilences,
  parseVerboseJson,
  parseWhisperCpp,
  placeCaptions,
  projectCues,
  setTranscript,
  silenceCuts,
  splitClipAtSource,
  timelineWords,
  toSrt,
  toVtt,
  wordCuts,
} from '../src/shared/videoAi.js';
import { buildRender } from '../src/shared/videoRender.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);
const dir = mkdtempSync(join(tmpdir(), 'zvsai-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const media = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: 'm1',
  path: '/x/a.mp4',
  name: 'a.mp4',
  kind: 'video',
  duration: 20,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 1,
  ...over,
});

const words = (list: [number, number, string][]) => list.map(([s, e, w]) => ({ s, e, w }));

/** "hola eh a todos. esto es una prueba" with an "eh" at 1.0–1.3. */
const T: Transcript = {
  engine: 'test',
  lang: 'es',
  at: 0,
  words: words([
    [0.2, 0.6, 'Hola'],
    [1.0, 1.3, 'eh,'],
    [1.5, 1.8, 'a'],
    [1.85, 2.3, 'todos.'],
    [4.0, 4.4, 'Esto'],
    [4.45, 4.6, 'es'],
    [4.65, 4.8, 'una'],
    [4.85, 5.4, 'prueba'],
  ]),
};

function project(): VideoProject {
  let p: VideoProject = { ...newProject({ name: 't' }), media: [media()] };
  p = insertMedia(p, p.media[0]!, { start: 0 }).project;
  return setTranscript(p, 'm1', T);
}

describe('parsers', () => {
  it('whisper.cpp tokens become words with times', () => {
    const r = parseWhisperCpp({
      result: { language: 'es' },
      transcription: [
        {
          offsets: { from: 0, to: 2000 },
          text: ' Hola mundo',
          tokens: [
            { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
            { text: ' Ho', offsets: { from: 100, to: 300 }, p: 0.9 },
            { text: 'la', offsets: { from: 300, to: 500 }, p: 0.8 },
            { text: ' mundo', offsets: { from: 600, to: 1100 }, p: 0.95 },
            { text: '[_TT_55]', offsets: { from: 2000, to: 2000 } },
          ],
        },
      ],
    });
    expect(r.lang).toBe('es');
    expect(r.words).toEqual([
      { s: 0.1, e: 0.5, w: 'Hola', p: 0.8 },
      { s: 0.6, e: 1.1, w: 'mundo', p: 0.95 },
    ]);
  });

  it('whisper.cpp segments without tokens are spread over their time', () => {
    const r = parseWhisperCpp({
      transcription: [{ offsets: { from: 1000, to: 2000 }, text: ' uno dos' }],
    });
    expect(r.words.map((w) => w.w)).toEqual(['uno', 'dos']);
    expect(r.words[0]!.s).toBe(1);
    expect(r.words[1]!.e).toBeCloseTo(2, 3);
  });

  it('OpenAI verbose_json words, language name to code', () => {
    const r = parseVerboseJson({
      language: 'spanish',
      words: [
        { word: 'Hola', start: 0.1, end: 0.4 },
        { word: 'mundo', start: 0.5, end: 0.5 },
      ],
    });
    expect(r.lang).toBe('es');
    expect(r.words[0]).toEqual({ s: 0.1, e: 0.4, w: 'Hola' });
    // A zero-length word gets a minimal length.
    expect(r.words[1]!.e).toBeGreaterThan(r.words[1]!.s);
  });

  it('silencedetect and showinfo logs', () => {
    const log = `[silencedetect @ 0x1] silence_start: 1.002
[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.498
[silencedetect @ 0x1] silence_start: 8.2`;
    expect(parseSilences(log, 10)).toEqual([
      [1.002, 2.5],
      [8.2, 10],
    ]);
    const scenes = `[Parsed_showinfo_2 @ 0x1] n:   0 pts:  90000 pts_time:3.0 duration:3000
[Parsed_showinfo_2 @ 0x1] n:   1 pts: 180000 pts_time:6.04 duration:3000
[other] pts_time:9`;
    expect(parseScenes(scenes)).toEqual([3, 6.04]);
  });
});

describe('text-based editing', () => {
  it('finds fillers but not real words', () => {
    expect(['eh,', 'Ehm', 'mmm', 'um', 'uh…', 'ahh'].every(isFiller)).toBe(true);
    expect(['este', 'pues', 'a', 'me', 'una', 'humo'].some(isFiller)).toBe(false);
    expect(fillerIndexes(T.words)).toEqual([1]);
  });

  it('word cuts take the gap around the word, never the neighbours', () => {
    const cuts = wordCuts(T.words, [1], 0.04);
    expect(cuts).toEqual([[0.96, 1.34]]);
    // Two words in a row are one cut.
    expect(wordCuts(T.words, [2, 3])).toEqual([[1.46, 2.34]]);
    expect(
      mergeRanges([
        [3, 4],
        [1, 2],
        [1.5, 2.5],
      ]),
    ).toEqual([
      [1, 2.5],
      [3, 4],
    ]);
  });

  it('cutting ranges splits the clip, ripples and keeps outer fades', () => {
    let p = project();
    const id = p.clips[0]!.id;
    p = { ...p, clips: p.clips.map((c) => ({ ...c, fadeIn: 0.5, fadeOut: 0.5 })) };
    // A second clip right after, on the same track, must move left.
    p = insertMedia(p, p.media[0]!, { trackId: p.clips[0]!.trackId, start: 20 }).project;
    const r = cutClipRanges(p, id, [
      [1, 1.3],
      [2.3, 4],
    ]);
    expect(r.removed).toBeCloseTo(2, 6);
    const own = r.project.clips.filter((c) => c.start < 18).sort((a, b) => a.start - b.start);
    expect(own.map((c) => [c.in, c.out])).toEqual([
      [0, 1],
      [1.3, 2.3],
      [4, 20],
    ]);
    expect(own[0]!.id).toBe(id);
    expect(own[0]!.fadeIn).toBe(0.5);
    expect(own[0]!.fadeOut).toBeUndefined();
    expect(own[2]!.fadeOut).toBe(0.5);
    // Back to back.
    for (let i = 1; i < own.length; i++) expect(own[i]!.start).toBeCloseTo(clipEnd(own[i - 1]!), 6);
    const later = r.project.clips.find((c) => c.start >= 17)!;
    expect(later.start).toBeCloseTo(18, 6);
  });

  it('cuts apply to every clip of the media; captions follow the cut', () => {
    let p = project();
    const before = timelineWords(p).find((w) => w.w === 'Esto')!.t0;
    p = cutMediaRanges(p, 'm1', wordCuts(T.words, fillerIndexes(T.words))).project;
    p = cutMediaRanges(p, 'm1', [[2.5, 3.8]]).project;
    const tw = timelineWords(p);
    expect(tw.map((w) => w.w)).not.toContain('eh,');
    expect(tw.find((w) => w.w === 'Esto')!.t0).toBeCloseTo(before - 0.38 - 1.3, 3);
  });

  it('silence cuts keep some air', () => {
    expect(
      silenceCuts(
        [
          [1, 1.3],
          [2, 4],
        ],
        0.6,
        0.15,
      ),
    ).toEqual([[2.15, 3.85]]);
  });

  it('scene split at source times', () => {
    const p = project();
    const r = splitClipAtSource(p, p.clips[0]!.id, [5, 12, 25]);
    expect(r.cuts).toBe(2);
    expect(r.project.clips.map((c) => clipDur(c)).sort((a, b) => a - b)).toEqual([5, 7, 8]);
  });
});

describe('captions', () => {
  it('groups words into cues and skips fillers', () => {
    const cues = groupCues(timelineWords(project()));
    expect(cues.map((c) => c.text)).toEqual(['Hola a todos.', 'Esto es una prueba']);
    expect(cues[0]!.start).toBe(0.2);
    // Held a little after the last word.
    expect(cues[0]!.end).toBeCloseTo(2.5, 3);
    const short = groupCues(timelineWords(project()), { maxChars: 8 });
    expect(short.every((c) => c.text.length <= 12)).toBe(true);
  });

  it('SRT and WebVTT', () => {
    const cues = [
      { start: 0.2, end: 2.5, text: 'Hola' },
      { start: 3661.5, end: 3662, text: 'Fin' },
    ];
    expect(toSrt(cues)).toBe(
      '1\n00:00:00,200 --> 00:00:02,500\nHola\n\n2\n01:01:01,500 --> 01:01:02,000\nFin\n',
    );
    expect(toVtt(cues).startsWith('WEBVTT\n\n00:00:00.200 --> 00:00:02.500\nHola\n')).toBe(true);
  });

  it('places editable titles on a captions track and replaces them when redone', () => {
    let p = project();
    const cues = projectCues(p, 'yellow');
    let r = placeCaptions(p, cues, 'yellow');
    expect(r.count).toBe(2);
    p = r.project;
    const track = p.tracks.find((t) => t.role === 'captions')!;
    expect(track.name).toBe('Subtítulos');
    expect(p.tracks[0]!.id).toBe(track.id);
    expect(cuesOfTrack(p).map((c) => c.text)).toEqual(cues.map((c) => c.text));
    expect(validProject(p)).toBe(true);
    r = placeCaptions(p, projectCues(p, 'bold'), 'bold');
    expect(r.project.tracks.filter((t) => t.role === 'captions')).toHaveLength(1);
    expect(cuesOfTrack(r.project)[0]!.text).toBe('HOLA A TODOS.');
  });

  it('a run of captions is one concat input in the export graph', () => {
    let p = project();
    const cues = Array.from({ length: 40 }, (_, i) => ({
      start: i * 0.5,
      end: i * 0.5 + 0.4,
      text: `c${i}`,
    }));
    p = placeCaptions(p, cues, 'classic').project;
    const texts = Object.fromEntries(
      p.clips.filter((c) => c.text).map((c) => [c.id, `C:\\tmp\\${c.id}.png`]),
    );
    const plan = buildRender(p, defaultExport(p), 'out.mp4', undefined, texts);
    const lists = Object.values(plan.files ?? {});
    expect(lists).toHaveLength(1);
    expect(plan.inputs.filter((a) => a === '-i')).toHaveLength(2);
    expect(lists[0]!.split('\n').filter((l) => l.startsWith('file '))).toHaveLength(41);
    expect(lists[0]).toContain("file 'C:/tmp/");
  });

  it('rejects broken transcripts in a project file', () => {
    const p = project();
    expect(validProject(p)).toBe(true);
    const bad = {
      ...p,
      transcripts: { m1: { engine: 'x', at: 0, words: [{ s: 'a', e: 1, w: 'x' }] } },
    };
    expect(validProject(bad)).toBe(false);
  });
});

describe.skipIf(!tools.ffmpeg || !tools.ffprobe)('analysis and export (FFmpeg)', () => {
  const run = (args: string[]) => {
    const r = spawnSync(tools.ffmpeg!, ['-hide_banner', '-v', 'error', '-y', ...args]);
    expect(r.status, r.stderr?.toString()).toBe(0);
  };
  const core = { connectedProviders: async () => [] } as never;
  const stt = new Transcriber(core, dir, () => tools.ffmpeg);

  it('finds the silence between two tones', async () => {
    const wav = join(dir, 'speech.wav');
    run([
      ...['-f', 'lavfi', '-i', 'sine=frequency=300:duration=1'],
      ...['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.5'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=500:duration=1'],
      ...[
        '-filter_complex',
        '[0:a]aformat=sample_rates=44100:channel_layouts=mono[a];[2:a]aformat=sample_rates=44100:channel_layouts=mono[c];[a][1:a][c]concat=n=3:v=0:a=1',
      ],
      wav,
    ]);
    const s = await stt.silences(wav, 3.5, -35, 0.6);
    expect(s).toHaveLength(1);
    expect(s[0]![0]).toBeCloseTo(1, 1);
    expect(s[0]![1]).toBeCloseTo(2.5, 1);
    const cuts = silenceCuts(s);
    expect(cuts[0]![1] - cuts[0]![0]).toBeCloseTo(1.2, 1);
  }, 60_000);

  it('finds scene changes', async () => {
    const mp4 = join(dir, 'scenes.mp4');
    run([
      ...['-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=25:d=2'],
      ...['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=25:d=2'],
      ...['-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=25:d=2'],
      ...['-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0'],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
      mp4,
    ]);
    const s = await stt.scenes(mp4, 6, 0.3);
    expect(s).toHaveLength(2);
    expect(s[0]).toBeCloseTo(2, 1);
    expect(s[1]).toBeCloseTo(4, 1);
  }, 60_000);

  it('exports 40 captions through one concat input: shown on time, hidden in the gaps', async () => {
    const svc = new VideoService(appRoot, dir, () => undefined);
    const black = join(dir, 'black.mp4');
    run([
      ...['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=10'],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
      black,
    ]);
    // A canvas-size picture with a white box in the middle (what the renderer would draw).
    const png = join(dir, 'cue.png');
    run([
      ...['-f', 'lavfi', '-i', 'color=c=black@0.0:s=160x90,format=rgba'],
      ...['-vf', 'drawbox=x=60:y=35:w=40:h=20:color=white@1:t=fill:replace=1', '-frames:v', '1'],
      png,
    ]);
    const { url: _u, ...mb } = await svc.probe(black);
    let p: VideoProject = {
      ...newProject({ width: 160, height: 90, fps: 25, name: 'cap' }),
      media: [mb],
    };
    p = insertMedia(p, mb, { start: 0 }).project;
    // Cues of 0.15 s every 0.25 s; the caption track sits centred (y = 0) for the check.
    const cues = Array.from({ length: 40 }, (_, i) => ({
      start: i * 0.25,
      end: i * 0.25 + 0.15,
      text: `c${i}`,
    }));
    p = placeCaptions(p, cues, 'classic').project;
    p = { ...p, clips: p.clips.map((c) => (c.text ? { ...c, transform: undefined } : c)) };
    const bytes = readFileSync(png);
    const texts = Object.fromEntries(p.clips.filter((c) => c.text).map((c) => [c.id, bytes]));
    const out = join(dir, 'cap.mp4');
    const job = svc.enqueue(
      p,
      { ...defaultExport(p), width: 160, height: 90, preset: 'veryfast' },
      out,
      texts,
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
    const centre = (t: number) => {
      const r = spawnSync(tools.ffmpeg!, [
        ...['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1'],
        ...['-vf', 'crop=4:4:78:43,format=gray', '-f', 'rawvideo', '-'],
      ]);
      const b = r.stdout as Buffer;
      return b.reduce((n, v) => n + v, 0) / Math.max(1, b.length);
    };
    // Inside cues (at 0.08 s past each start) the box shows; in the gaps (0.2 s) it does not.
    for (const i of [0, 7, 21, 39]) {
      expect(centre(i * 0.25 + 0.08), `cue ${i}`).toBeGreaterThan(200);
      expect(centre(i * 0.25 + 0.21), `gap ${i}`).toBeLessThan(40);
    }
  }, 120_000);
});
