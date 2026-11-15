/**
 * Fase 13 (13A): AI inside the video editor, the pure part.
 *
 * - Transcripts: words with source times (seconds of the media file), parsed from whisper.cpp
 *   JSON or an OpenAI-compatible `verbose_json` answer (OpenAI, Groq).
 * - Text-based editing: deleting words, fillers or silences cuts those source ranges out of
 *   every clip of the media and closes the gaps (ripple on the clip's track).
 * - Scene detection: FFmpeg's scene score (`select='gt(scene,T)',showinfo`) split points.
 * - Captions: words mapped to timeline time, grouped into cues, written as SRT / WebVTT or
 *   placed on a "Subtítulos" track as ordinary title clips (editable, same preview / export).
 *
 * No Electron, no I/O: main/transcribe.ts runs FFmpeg and the engines, the renderer edits.
 */
import type { Clip, Transcript, TranscriptWord, VideoProject } from './video.js';
import {
  IDENTITY,
  MIN_CLIP,
  addTrack,
  clipEnd,
  isText,
  mediaOf,
  speedOf,
  splitAt,
  trackOf,
  uid,
} from './video.js';
import type { TextSpec } from './videoFx.js';

export type Range = readonly [number, number];

// ---------------- parsers ----------------

/** Spreads a segment's time over its words, by length (engines without word times). */
export function spreadWords(text: string, s: number, e: number): TranscriptWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || !(e > s)) return [];
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  const out: TranscriptWord[] = [];
  let t = s;
  for (const w of words) {
    const d = ((e - s) * (w.length + 1)) / total;
    out.push({ s: round(t), e: round(t + d), w });
    t += d;
  }
  return out;
}

const round = (t: number): number => Math.round(t * 1000) / 1000;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Drops empty words, sorts and makes every word end after it starts. */
function tidy(words: TranscriptWord[]): TranscriptWord[] {
  return words
    .map((w) => ({ ...w, w: w.w.trim() }))
    .filter((w) => w.w && finite(w.s) && finite(w.e) && w.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map((w) => (w.e > w.s ? w : { ...w, e: round(w.s + 0.05) }));
}

interface WhisperCppJson {
  result?: { language?: string };
  transcription?: {
    offsets?: { from?: number; to?: number };
    text?: string;
    tokens?: { text?: string; offsets?: { from?: number; to?: number }; p?: number }[];
  }[];
}

/**
 * whisper.cpp `-oj` / `-ojf` output. With tokens (`-ojf`), tokens are joined into words (a
 * token that does not start with a space continues the word before); special tokens like
 * `[_BEG_]` are skipped. Without tokens, each segment's text is spread over its time.
 */
export function parseWhisperCpp(json: unknown): { lang?: string; words: TranscriptWord[] } {
  const j = (json ?? {}) as WhisperCppJson;
  const words: TranscriptWord[] = [];
  for (const seg of j.transcription ?? []) {
    const toks = (seg.tokens ?? []).filter(
      (t) => typeof t.text === 'string' && !/^\s*\[.*\]\s*$/.test(t.text) && t.offsets,
    );
    if (toks.length) {
      let cur: TranscriptWord | null = null;
      for (const t of toks) {
        const text = t.text!;
        const s = (t.offsets!.from ?? 0) / 1000;
        const e = (t.offsets!.to ?? 0) / 1000;
        if (!cur || /^\s/.test(text)) {
          if (cur) words.push(cur);
          cur = { s, e, w: text.trim() };
          if (finite(t.p)) cur.p = round(t.p);
        } else {
          cur.w += text;
          cur.e = Math.max(cur.e, e);
          if (finite(t.p) && cur.p !== undefined) cur.p = round(Math.min(cur.p, t.p));
        }
      }
      if (cur) words.push(cur);
    } else if (seg.text && seg.offsets) {
      words.push(
        ...spreadWords(seg.text, (seg.offsets.from ?? 0) / 1000, (seg.offsets.to ?? 0) / 1000),
      );
    }
  }
  const lang = j.result?.language;
  return { ...(lang ? { lang } : {}), words: tidy(words) };
}

interface VerboseJson {
  language?: string;
  text?: string;
  words?: { word?: string; start?: number; end?: number }[];
  segments?: { start?: number; end?: number; text?: string }[];
}

/** OpenAI-compatible `verbose_json` (with `timestamp_granularities[]=word` when supported). */
export function parseVerboseJson(json: unknown): { lang?: string; words: TranscriptWord[] } {
  const j = (json ?? {}) as VerboseJson;
  let words: TranscriptWord[] = [];
  if (j.words?.length)
    words = j.words
      .filter((w) => typeof w.word === 'string' && finite(w.start) && finite(w.end))
      .map((w) => ({ s: round(w.start!), e: round(w.end!), w: w.word! }));
  else
    for (const seg of j.segments ?? [])
      if (seg.text && finite(seg.start) && finite(seg.end))
        words.push(...spreadWords(seg.text, seg.start, seg.end));
  const lang = j.language ? languageCode(j.language) : undefined;
  return { ...(lang ? { lang } : {}), words: tidy(words) };
}

/** OpenAI answers "spanish"; whisper.cpp "es". Both end up as the short code when known. */
function languageCode(l: string): string {
  const k = l.trim().toLowerCase();
  const names: Record<string, string> = {
    spanish: 'es',
    english: 'en',
    portuguese: 'pt',
    french: 'fr',
    german: 'de',
    italian: 'it',
  };
  return names[k] ?? k;
}

/** `silencedetect` log → silent ranges (an open one ends at `duration`). */
export function parseSilences(log: string, duration: number): Range[] {
  const out: [number, number][] = [];
  let open: number | null = null;
  for (const m of log.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const t = Number(m[2]);
    if (!Number.isFinite(t)) continue;
    if (m[1] === 'start') open = Math.max(0, t);
    else if (open !== null) {
      if (t > open) out.push([round(open), round(t)]);
      open = null;
    }
  }
  if (open !== null && duration > open) out.push([round(open), round(duration)]);
  return out;
}

/** `select='gt(scene,T)',showinfo` log → times of the first frame of each new scene. */
export function parseScenes(log: string): number[] {
  const set = new Set<number>();
  for (const line of log.split(/\r?\n/)) {
    if (!line.includes('Parsed_showinfo')) continue;
    const m = /\bpts_time:\s*([\d.]+)/.exec(line);
    if (m) {
      const t = round(Number(m[1]));
      if (t > 0) set.add(t);
    }
  }
  return [...set].sort((a, b) => a - b);
}

// ---------------- what to cut ----------------

/** Filler sounds (Spanish and English); real words like "este" or "pues" are left alone. */
const FILLER = /^(e+h+|e+m+|eh+m+|m+|h+m+|m+h+|u+m+|u+h+|a+h+|e+r+m*|o+h+)$/;

const bare = (w: string): string =>
  w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

export const isFiller = (w: string): boolean => {
  const b = bare(w);
  return b.length > 0 && FILLER.test(b);
};

export function fillerIndexes(words: readonly TranscriptWord[]): number[] {
  return words.flatMap((w, i) => (isFiller(w.w) ? [i] : []));
}

/** Sorted, merged ranges (touching within `join` seconds become one). */
export function mergeRanges(ranges: readonly Range[], join = 0): Range[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0])
    .map((r) => [r[0], r[1]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + join) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

/**
 * Source ranges to cut for some words: each run of consecutive chosen words goes, with the
 * gap around it up to `pad` seconds (never into the neighbouring words).
 */
export function wordCuts(
  words: readonly TranscriptWord[],
  chosen: Iterable<number>,
  pad = 0.04,
): Range[] {
  const set = new Set([...chosen].filter((i) => i >= 0 && i < words.length));
  const idx = [...set].sort((a, b) => a - b);
  const cuts: Range[] = [];
  for (let k = 0; k < idx.length; ) {
    const a = idx[k]!;
    let b = a;
    while (k + 1 < idx.length && idx[k + 1] === b + 1) b = idx[++k]!;
    k++;
    const prev = words[a - 1];
    const next = words[b + 1];
    const s = Math.max(prev ? prev.e : 0, words[a]!.s - pad);
    const e = next ? Math.min(next.s, words[b]!.e + pad) : words[b]!.e + pad;
    if (e > s) cuts.push([round(s), round(e)]);
  }
  return mergeRanges(cuts);
}

export const SILENCE_DEFAULTS = { noiseDb: -35, minDur: 0.6, keep: 0.15 } as const;

/** Silences longer than `minDur` become cuts, keeping `keep` seconds of air on each side. */
export function silenceCuts(
  silences: readonly Range[],
  minDur: number = SILENCE_DEFAULTS.minDur,
  keep: number = SILENCE_DEFAULTS.keep,
): Range[] {
  return mergeRanges(
    silences
      .filter((r) => r[1] - r[0] >= minDur)
      .map((r) => [round(r[0] + keep), round(r[1] - keep)] as Range)
      .filter((r) => r[1] - r[0] > 0.05),
  );
}

// ---------------- cutting the timeline ----------------

/**
 * Cuts source ranges out of one clip: the kept stretches stay back to back from the clip's
 * start, later clips on its track move left by what went (ripple). Fades, the transition and
 * the in-animation stay on the first piece, the fade out and out-animation on the last one.
 * Keyframes are in source time, so each piece keeps its part of the animation.
 */
export function cutClipRanges(
  p: VideoProject,
  clipId: string,
  cuts: readonly Range[],
): { project: VideoProject; removed: number } {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c || isText(c) || trackOf(p, c.trackId)?.locked) return { project: p, removed: 0 };
  const sp = speedOf(c);
  const inside = mergeRanges(cuts)
    .map((r) => [Math.max(r[0], c.in), Math.min(r[1], c.out)] as Range)
    .filter((r) => r[1] - r[0] > 1e-6);
  if (!inside.length) return { project: p, removed: 0 };
  const kept: Range[] = [];
  let t = c.in;
  for (const r of inside) {
    if (r[0] - t >= MIN_CLIP * sp) kept.push([t, r[0]]);
    t = Math.max(t, r[1]);
  }
  if (c.out - t >= MIN_CLIP * sp) kept.push([t, c.out]);
  const keptLen = kept.reduce((n, r) => n + (r[1] - r[0]), 0);
  const removed = (c.out - c.in - keptLen) / sp;
  if (removed <= 1e-6) return { project: p, removed: 0 };
  const end = clipEnd(c);
  const pieces: Clip[] = [];
  let at = c.start;
  kept.forEach((r, i) => {
    const first = i === 0;
    const last = i === kept.length - 1;
    const anim = c.anim && {
      ...(first ? { in: c.anim.in, inD: c.anim.inD } : {}),
      ...(last ? { out: c.anim.out, outD: c.anim.outD } : {}),
    };
    const piece: Clip = {
      ...c,
      id: first ? c.id : uid('c'),
      start: round(at),
      in: round(r[0]),
      out: round(r[1]),
      fadeIn: first ? c.fadeIn : undefined,
      fadeOut: last ? c.fadeOut : undefined,
      transition: first ? c.transition : undefined,
      anim: anim && Object.keys(anim).length ? anim : undefined,
    };
    for (const k of ['fadeIn', 'fadeOut', 'transition', 'anim'] as const)
      if (piece[k] === undefined) delete piece[k];
    pieces.push(piece);
    at += (r[1] - r[0]) / sp;
  });
  const clips: Clip[] = [];
  for (const x of p.clips) {
    if (x.id === c.id) clips.push(...pieces);
    else if (x.trackId === c.trackId && x.start >= end - 1e-6)
      clips.push({ ...x, start: round(Math.max(0, x.start - removed)) });
    else clips.push(x);
  }
  return { project: { ...p, clips }, removed };
}

/** Cuts source ranges from every clip of a media item (latest first, so ripples add up). */
export function cutMediaRanges(
  p: VideoProject,
  mediaId: string,
  cuts: readonly Range[],
): { project: VideoProject; removed: number } {
  let project = p;
  let removed = 0;
  const ids = p.clips
    .filter((c) => c.mediaId === mediaId && !isText(c))
    .sort((a, b) => b.start - a.start)
    .map((c) => c.id);
  for (const id of ids) {
    const r = cutClipRanges(project, id, cuts);
    project = r.project;
    removed = Math.max(removed, r.removed);
  }
  return { project, removed };
}

/** Splits a clip at source times (scene changes); returns how many cuts were made. */
export function splitClipAtSource(
  p: VideoProject,
  clipId: string,
  times: readonly number[],
): { project: VideoProject; cuts: number } {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c || isText(c)) return { project: p, cuts: 0 };
  const sp = speedOf(c);
  const at = times
    .filter((s) => s > c.in + MIN_CLIP && s < c.out - MIN_CLIP)
    .map((s) => c.start + (s - c.in) / sp)
    .sort((a, b) => b - a);
  let project = p;
  let cuts = 0;
  const only = new Set([c.id]);
  for (const t of at) {
    const r = splitAt(project, t, only);
    if (r.created.length) cuts++;
    project = r.project;
  }
  return { project, cuts };
}

// ---------------- captions ----------------

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface TimedWord {
  t0: number;
  t1: number;
  w: string;
}

/**
 * The words heard on the timeline, in timeline time: every clip whose media has a transcript
 * contributes the words inside its trim (hidden / muted tracks too: captions follow the cut,
 * not the mix). The same word from two clips of one media at the same time counts once.
 */
export function timelineWords(p: VideoProject): TimedWord[] {
  const all: TimedWord[] = [];
  for (const c of p.clips) {
    if (isText(c)) continue;
    const tr = p.transcripts?.[c.mediaId];
    if (!tr || !mediaOf(p, c.mediaId)) continue;
    const sp = speedOf(c);
    for (const w of tr.words) {
      const mid = (w.s + w.e) / 2;
      if (mid < c.in || mid >= c.out) continue;
      all.push({
        t0: round(c.start + (Math.max(w.s, c.in) - c.in) / sp),
        t1: round(c.start + (Math.min(w.e, c.out) - c.in) / sp),
        w: w.w,
      });
    }
  }
  all.sort((a, b) => a.t0 - b.t0);
  return all.filter(
    (w, i) => !all.slice(Math.max(0, i - 3), i).some((x) => x.w === w.w && Math.abs(x.t0 - w.t0) < 0.05),
  );
}

export interface CueOptions {
  /** Characters per cue (one or two short lines). */
  maxChars: number;
  maxDur: number;
  /** A pause longer than this starts a new cue. */
  maxGap: number;
  minDur: number;
  upper?: boolean;
}

export const CUE_DEFAULTS: CueOptions = { maxChars: 32, maxDur: 3.5, maxGap: 0.8, minDur: 0.7 };

/** Groups words into cues: by length, duration, pauses and the end of sentences. */
export function groupCues(words: readonly TimedWord[], opts: Partial<CueOptions> = {}): Cue[] {
  const o = { ...CUE_DEFAULTS, ...opts };
  const cues: Cue[] = [];
  let cur: { start: number; end: number; words: string[] } | null = null;
  const flush = () => {
    if (cur) cues.push({ start: cur.start, end: cur.end, text: cur.words.join(' ') });
    cur = null;
  };
  for (const w of words) {
    // A filler is not shown, but it is sound: the pause around it does not split the cue.
    if (isFiller(w.w)) {
      if (cur) cur.end = Math.max(cur.end, w.t1);
      continue;
    }
    const text = o.upper ? w.w.toLocaleUpperCase() : w.w;
    if (cur) {
      const c: { start: number; end: number; words: string[] } = cur;
      const len = c.words.join(' ').length;
      const prev = c.words[c.words.length - 1]!;
      const brk =
        w.t0 - c.end > o.maxGap ||
        len + 1 + text.length > o.maxChars ||
        w.t1 - c.start > o.maxDur ||
        /[.?!…]["»”']?$/.test(prev) ||
        (/[,;:]$/.test(prev) && len > o.maxChars * 0.6);
      if (brk) flush();
    }
    if (!cur) cur = { start: w.t0, end: w.t1, words: [text] };
    else {
      cur.words.push(text);
      cur.end = Math.max(cur.end, w.t1);
    }
  }
  flush();
  // Hold each cue a little longer (it reads better), never over the next one.
  return cues.map((q, i) => {
    const next = cues[i + 1]?.start ?? Infinity;
    const end = Math.min(next, Math.max(q.end + 0.2, q.start + o.minDur));
    return { ...q, start: round(q.start), end: round(Math.max(end, q.start + 0.05)) };
  });
}

function stamp(t: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** Cue text without the line breaks that would end an SRT block early. */
const oneBlock = (t: string): string => t.replace(/\r?\n\s*\r?\n/g, '\n').trim();

export function toSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (q, i) => `${i + 1}\n${stamp(q.start, ',')} --> ${stamp(q.end, ',')}\n${oneBlock(q.text)}\n`,
    )
    .join('\n');
}

export function toVtt(cues: readonly Cue[]): string {
  return `WEBVTT\n\n${cues
    .map((q) => `${stamp(q.start, '.')} --> ${stamp(q.end, '.')}\n${oneBlock(q.text)}\n`)
    .join('\n')}`;
}

/** Cues of a project's caption track (what was placed and maybe edited by hand). */
export function cuesOfTrack(p: VideoProject): Cue[] {
  const t = captionTrack(p);
  if (!t) return [];
  return p.clips
    .filter((c) => c.trackId === t.id && c.text)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ start: round(c.start), end: round(clipEnd(c)), text: c.text!.content }));
}

export type CaptionStyleId = 'classic' | 'yellow' | 'bold' | 'minimal';

export interface CaptionStyle {
  id: CaptionStyleId;
  spec: Omit<TextSpec, 'content'>;
  /** Centre height (fraction of the canvas from the middle, + = lower). */
  y: number;
  /** Same y for vertical (9:16) projects, where the platform UI covers the bottom. */
  yTall: number;
  upper?: boolean;
  maxChars?: number;
}

export const CAPTION_STYLES: readonly CaptionStyle[] = [
  {
    id: 'classic',
    spec: {
      font: 'sans',
      size: 0.05,
      color: '#ffffff',
      bold: false,
      italic: false,
      align: 'center',
      bg: '#101010',
    },
    y: 0.4,
    yTall: 0.28,
  },
  {
    id: 'yellow',
    spec: {
      font: 'sans',
      size: 0.055,
      color: '#ffd400',
      bold: true,
      italic: false,
      align: 'center',
      stroke: { color: '#000000', width: 0.12 },
    },
    y: 0.4,
    yTall: 0.28,
  },
  {
    id: 'bold',
    spec: {
      font: 'display',
      size: 0.075,
      color: '#ffffff',
      bold: true,
      italic: false,
      align: 'center',
      stroke: { color: '#000000', width: 0.14 },
      shadow: true,
    },
    y: 0.3,
    yTall: 0.18,
    upper: true,
    maxChars: 18,
  },
  {
    id: 'minimal',
    spec: {
      font: 'sans',
      size: 0.045,
      color: '#ffffff',
      bold: false,
      italic: false,
      align: 'center',
      shadow: true,
    },
    y: 0.42,
    yTall: 0.3,
  },
];

export const captionStyle = (id: string): CaptionStyle =>
  CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0]!;

export const captionTrack = (p: VideoProject) => p.tracks.find((t) => t.role === 'captions');

/** Cues for the project with a style's line length and case. */
export function projectCues(p: VideoProject, styleId: string): Cue[] {
  const st = captionStyle(styleId);
  return groupCues(timelineWords(p), {
    ...(st.maxChars ? { maxChars: st.maxChars } : {}),
    ...(st.upper ? { upper: true } : {}),
  });
}

/**
 * Puts cues on the caption track (made on top the first time) as title clips, replacing the
 * captions it had. Each cue is an ordinary title: it can be moved, trimmed and retyped.
 */
export function placeCaptions(
  p: VideoProject,
  cues: readonly Cue[],
  styleId: string,
): { project: VideoProject; count: number } {
  const st = captionStyle(styleId);
  let project = p;
  let track = captionTrack(project);
  if (track?.locked) return { project: p, count: 0 };
  if (!track) {
    project = addTrack(project, 'video');
    const t = { ...project.tracks[0]!, name: 'Subtítulos', role: 'captions' as const };
    project = { ...project, tracks: [t, ...project.tracks.slice(1)] };
    track = t;
  }
  const tid = track.id;
  const tall = p.height > p.width;
  const y = tall ? st.yTall : st.y;
  const clips: Clip[] = cues
    .filter((q) => q.text.trim() && q.end - q.start >= MIN_CLIP)
    .map((q) => ({
      id: uid('c'),
      mediaId: '',
      trackId: tid,
      start: q.start,
      in: 0,
      out: round(q.end - q.start),
      volume: 0,
      text: { ...st.spec, content: q.text.slice(0, 2000) },
      transform: { ...IDENTITY, y },
    }));
  return {
    project: {
      ...project,
      clips: [...project.clips.filter((c) => c.trackId !== tid), ...clips],
    },
    count: clips.length,
  };
}

/** Sets (or drops) a media item's transcript. */
export function setTranscript(
  p: VideoProject,
  mediaId: string,
  t: Transcript | null,
): VideoProject {
  const transcripts = { ...p.transcripts };
  if (t) transcripts[mediaId] = t;
  else delete transcripts[mediaId];
  const next = { ...p, transcripts };
  if (!Object.keys(transcripts).length) delete next.transcripts;
  return next;
}

/** Words of a transcript inside the source ranges a project still uses (for the editor view). */
export function usedSourceRanges(p: VideoProject, mediaId: string): Range[] {
  return mergeRanges(
    p.clips.filter((c) => c.mediaId === mediaId && !isText(c)).map((c) => [c.in, c.out] as Range),
    1e-3,
  );
}
