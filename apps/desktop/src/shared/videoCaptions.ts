/**
 * Fase 13C: captions II and the cut previews, the pure part.
 *
 * - Karaoke: each cue is drawn once per word, with that word in another colour. The pieces are
 *   ordinary title clips back to back, so the export keeps them in the same `concat` list of
 *   pictures as the other captions (preview and export match by construction).
 * - Safe place for vertical (9:16) projects: above the platforms' buttons and description.
 * - `.ass` (Advanced SubStation Alpha) with the style, and karaoke as one line per word.
 * - Translation with the connected chat model: the prompt and the strict parse of the answer
 *   (the cue times never change; a broken answer is refused, not half-used).
 * - Transcript fixes (the word changes, its time stays) and the timeline ranges a pending cut
 *   would remove (the hatched zones of the preview).
 * - FFmpeg scene scores (`metadata=print`), so the scene threshold can move without re-reading.
 *
 * No Electron, no I/O.
 */
import type { Clip, Transcript, VideoProject } from './video.js';
import { IDENTITY, MIN_CLIP, isText, speedOf } from './video.js';
import type { Cue, Range } from './videoAi.js';
import {
  CAPTION_STYLES,
  captionStyle,
  captionTrack,
  isFiller,
  mergeRanges,
  placeCaptions,
  projectCues,
  timelineWords,
} from './videoAi.js';
import type { TextSpec } from './videoFx.js';

const round = (t: number): number => Math.round(t * 1000) / 1000;

// ---------------- karaoke ----------------

export interface KaraokeCue extends Cue {
  /** Timeline time where each word of `text` (split on spaces) starts. */
  at: number[];
}

/** Colour of the word being said, per style (a contrast with the style's own colour). */
export const KARAOKE_COLOR: Record<string, string> = {
  classic: '#ffd400',
  yellow: '#ffffff',
  bold: '#ffd400',
  minimal: '#7cf29c',
};

/** The project's cues with the start of every word (the same cues projectCues gives). */
export function karaokeCues(p: VideoProject, styleId: string): KaraokeCue[] {
  const cues = projectCues(p, styleId);
  const words = timelineWords(p).filter((w) => !isFiller(w.w));
  let k = 0;
  return cues.map((q) => {
    const tokens = q.text.split(' ').filter(Boolean);
    while (k < words.length && words[k]!.t0 < q.start - 1e-6) k++;
    const inside: number[] = [];
    for (let j = k; j < words.length && words[j]!.t0 < q.end - 1e-6; j++) inside.push(words[j]!.t0);
    let at: number[];
    if (inside.length === tokens.length) at = inside;
    else {
      // Retyped or merged words: spread them evenly over the cue.
      const d = (q.end - q.start) / Math.max(1, tokens.length);
      at = tokens.map((_, i) => round(q.start + i * d));
    }
    k += inside.length;
    return { ...q, at };
  });
}

/** One cue → its pieces: [start, end, highlighted word]. Pieces shorter than a frame merge. */
export function karaokePieces(q: KaraokeCue): { start: number; end: number; word: number }[] {
  const n = q.at.length;
  if (!n) return [{ start: q.start, end: q.end, word: 0 }];
  // Boundaries: the cue's start, each next word's start (never going back), the cue's end.
  const b = [q.start];
  for (let i = 1; i < n; i++) b.push(Math.max(b[i - 1]!, Math.min(q.end, q.at[i]!)));
  b.push(q.end);
  const out: { start: number; end: number; word: number }[] = [];
  for (let i = 0; i < n; i++) {
    const s = b[i]!;
    const e = b[i + 1]!;
    const last = out[out.length - 1];
    // Too short to be seen: the word before keeps the screen a little longer.
    if (e - s < MIN_CLIP && last) last.end = round(e);
    else out.push({ start: round(s), end: round(e), word: i });
  }
  // A first piece too short gives its time to the next one.
  if (out.length > 1 && out[0]!.end - out[0]!.start < MIN_CLIP) {
    out[1]!.start = out[0]!.start;
    out.shift();
  }
  return out;
}

// ---------------- safe place for vertical videos ----------------

/**
 * Share of a 9:16 frame covered by the platforms (TikTok, Reels, Shorts): the description and
 * buttons at the bottom, the action column on the right. Captions stay above the bottom band.
 */
export const SOCIAL_SAFE = { bottom: 0.2, top: 0.1, right: 0.12 } as const;

/** Centre height (share from the middle, + = lower) that keeps a caption above the band. */
export function safeCaptionY(y: number, spec: Pick<TextSpec, 'size' | 'bg'>, lines = 1): number {
  const half = (spec.size * 1.22 * lines) / 2 + (spec.bg ? spec.size * 0.35 : 0) + 0.01;
  const max = 0.5 - SOCIAL_SAFE.bottom - half;
  const min = -0.5 + SOCIAL_SAFE.top + half;
  return round(Math.min(max, Math.max(min, y)));
}

export interface CaptionOptions {
  karaoke?: boolean;
}

/**
 * Captions II: like videoAi's placeCaptions (same track, same replacement), plus karaoke pieces
 * and the safe place in vertical projects.
 */
export function placeCaptions2(
  p: VideoProject,
  styleId: string,
  opts: CaptionOptions = {},
  given?: readonly Cue[],
): { project: VideoProject; count: number; cues: number } {
  const st = captionStyle(styleId);
  const tall = p.height > p.width;
  const plain = given ?? projectCues(p, styleId);
  if (!opts.karaoke || given) {
    const r = placeCaptions(p, plain, styleId);
    return { ...withSafeY(r.project, tall, st.spec), count: r.count, cues: r.count };
  }
  const cues = karaokeCues(p, styleId);
  // Lay the cues out as plain captions first (the track, its place), then split each one.
  const base = placeCaptions(p, cues, styleId);
  const track = captionTrack(base.project);
  if (!track || !base.count) return { project: base.project, count: 0, cues: 0 };
  const color = KARAOKE_COLOR[st.id] ?? '#ffd400';
  const ours = base.project.clips.filter((c) => c.trackId === track.id);
  const pieces: Clip[] = [];
  for (const c of ours) {
    const q = cues.find((x) => Math.abs(x.start - c.start) < 1e-3 && x.text === c.text!.content);
    if (!q) {
      pieces.push(c);
      continue;
    }
    for (const [i, pc] of karaokePieces(q).entries())
      pieces.push({
        ...c,
        id: i === 0 ? c.id : `${c.id}k${i}`,
        start: pc.start,
        in: 0,
        out: round(pc.end - pc.start),
        text: { ...c.text!, hl: { word: pc.word, color } },
      });
  }
  const project = {
    ...base.project,
    clips: [...base.project.clips.filter((c) => c.trackId !== track.id), ...pieces],
  };
  return { ...withSafeY(project, tall, st.spec), count: pieces.length, cues: ours.length };
}

function withSafeY(
  p: VideoProject,
  tall: boolean,
  spec: Pick<TextSpec, 'size' | 'bg'>,
): { project: VideoProject } {
  const track = captionTrack(p);
  if (!tall || !track) return { project: p };
  return {
    project: {
      ...p,
      clips: p.clips.map((c) =>
        c.trackId === track.id && c.text
          ? {
              ...c,
              transform: {
                ...IDENTITY,
                ...c.transform,
                y: safeCaptionY(c.transform?.y ?? 0, spec, c.text.content.split('\n').length),
              },
            }
          : c,
      ),
    },
  };
}

/** The caption style a track was made with (by its first title), and whether it is karaoke. */
export function trackCaptionStyle(p: VideoProject): { style: string; karaoke: boolean } | null {
  const t = captionTrack(p);
  if (!t) return null;
  const first = p.clips.find((c) => c.trackId === t.id && c.text);
  if (!first) return null;
  const s = first.text!;
  const st =
    CAPTION_STYLES.find(
      (x) => x.spec.font === s.font && x.spec.color === s.color && x.spec.size === s.size,
    ) ?? CAPTION_STYLES[0]!;
  return { style: st.id, karaoke: p.clips.some((c) => c.trackId === t.id && !!c.text?.hl) };
}

/** Cues of the caption track, karaoke pieces folded back into one cue each. */
export function trackCues(p: VideoProject): Cue[] {
  const t = captionTrack(p);
  if (!t) return [];
  const clips = p.clips
    .filter((c) => c.trackId === t.id && c.text)
    .sort((a, b) => a.start - b.start);
  const out: Cue[] = [];
  for (const c of clips) {
    const end = round(c.start + (c.out - c.in));
    const last = out[out.length - 1];
    if (
      c.text!.hl &&
      c.text!.hl.word > 0 &&
      last &&
      last.text === c.text!.content &&
      Math.abs(last.end - c.start) < 1e-3
    )
      last.end = end;
    else out.push({ start: round(c.start), end, text: c.text!.content });
  }
  return out;
}

// ---------------- .ass ----------------

const ASS_FONT: Record<string, string> = {
  sans: 'Arial',
  serif: 'Georgia',
  mono: 'Consolas',
  display: 'Impact',
  hand: 'Comic Sans MS',
};

/** #rrggbb → ASS &HAABBGGRR (alpha 00 = opaque). */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const [r, g, b] = m ? [m[1]!, m[2]!, m[3]!] : ['ff', 'ff', 'ff'];
  const a = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs % 100)}`;
}

/** Text safe inside a Dialogue line: no override braces, line breaks as \N. */
const assText = (t: string) =>
  t.replace(/[{}]/g, '').replace(/\\/g, '⧵').replace(/\r?\n/g, '\\N').trim();

/**
 * An .ass file for cues (or karaoke cues), styled like the captions on screen: font, size,
 * colours, outline / box, shadow, and the same centre height (\an5\pos).
 */
export function toAss(
  cues: readonly (Cue | KaraokeCue)[],
  styleId: string,
  W: number,
  H: number,
  karaoke = false,
): string {
  const st = captionStyle(styleId);
  const s = st.spec;
  const size = Math.round(s.size * H);
  const box = !!s.bg;
  const outline = box
    ? Math.round(size * 0.3)
    : s.stroke
      ? Math.round(s.stroke.width * size * 0.5 * 10) / 10
      : 0;
  const tall = H > W;
  const y = tall ? safeCaptionY(st.yTall, s) : st.y;
  const px = Math.round(W / 2);
  const py = Math.round(H / 2 + y * H);
  const hl = KARAOKE_COLOR[st.id] ?? '#ffd400';
  const style = [
    'Default',
    ASS_FONT[s.font] ?? 'Arial',
    size,
    assColor(s.color),
    assColor(hl),
    assColor(box ? s.bg! : (s.stroke?.color ?? '#000000')),
    assColor('#000000', s.shadow ? 96 : 255),
    s.bold ? -1 : 0,
    s.italic ? -1 : 0,
    0,
    0,
    100,
    100,
    0,
    0,
    box ? 3 : 1,
    outline,
    s.shadow ? 2 : 0,
    5,
    20,
    20,
    20,
    1,
  ].join(',');
  const lines: string[] = [];
  const pos = `{\\an5\\pos(${px},${py})}`;
  for (const q of cues) {
    const text = assText(q.text);
    if (!text) continue;
    const at = (q as KaraokeCue).at;
    if (karaoke && at?.length) {
      const words = text.split(' ');
      for (const pc of karaokePieces(q as KaraokeCue)) {
        const body = words
          .map((w, i) => (i === pc.word ? `{\\c${assColor(hl)}}${w}{\\c${assColor(s.color)}}` : w))
          .join(' ');
        lines.push(
          `Dialogue: 0,${assTime(pc.start)},${assTime(pc.end)},Default,,0,0,0,,${pos}${body}`,
        );
      }
    } else
      lines.push(`Dialogue: 0,${assTime(q.start)},${assTime(q.end)},Default,,0,0,0,,${pos}${text}`);
  }
  return [
    '[Script Info]',
    '; Zinarix Studio',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${style}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines,
    '',
  ].join('\n');
}

// ---------------- translation ----------------

/** Cues per request: small enough for any model's answer, big enough to keep context. */
export const TRANSLATE_BATCH = 40;

export function translationMessages(
  texts: readonly string[],
  target: string,
): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You translate video subtitles. Answer ONLY with a JSON array of strings: one translation per input line, same order, same count. Keep each line short (it is on screen for a few seconds), keep names, numbers and emojis, never merge or split lines, never add notes.',
    },
    {
      role: 'user',
      content: `Target language: ${target}\nLines (JSON):\n${JSON.stringify(texts)}`,
    },
  ];
}

/** The model's answer → exactly `n` strings, or null (then nothing is replaced). */
export function parseTranslation(answer: string, n: number): string[] | null {
  const a = answer.indexOf('[');
  const b = answer.lastIndexOf(']');
  if (a < 0 || b < a) return null;
  try {
    const arr = JSON.parse(answer.slice(a, b + 1)) as unknown;
    if (!Array.isArray(arr) || arr.length !== n) return null;
    if (!arr.every((x) => typeof x === 'string')) return null;
    return (arr as string[]).map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 400));
  } catch {
    return null;
  }
}

/** Translated cues: the same times, the new text (empty answers keep the original line). */
export function withTexts(cues: readonly Cue[], texts: readonly string[]): Cue[] {
  return cues.map((q, i) => ({ ...q, text: texts[i]?.trim() || q.text }));
}

// ---------------- transcript fixes ----------------

/** Retypes one word of a media's transcript; the time stays. Empty text is refused. */
export function editWord(
  p: VideoProject,
  mediaId: string,
  index: number,
  text: string,
): VideoProject | null {
  const t = p.transcripts?.[mediaId];
  const w = t?.words[index];
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!t || !w || !clean || clean === w.w) return null;
  const words = t.words.slice();
  words[index] = { ...w, w: clean };
  const next: Transcript = { ...t, words };
  return { ...p, transcripts: { ...p.transcripts, [mediaId]: next } };
}

/** Redoes the caption track (same style, same karaoke) after the words changed. */
export function redoCaptions(p: VideoProject): VideoProject {
  const st = trackCaptionStyle(p);
  if (!st) return p;
  const r = placeCaptions2(p, st.style, { karaoke: st.karaoke });
  return r.count ? r.project : p;
}

// ---------------- cut previews ----------------

/**
 * Where source cuts of a media land on the timeline (what goes, before it goes): each clip of
 * the media maps its part of every cut to timeline time. Used for the hatched zones.
 */
export function timelineCutZones(
  p: VideoProject,
  mediaId: string,
  cuts: readonly Range[],
): Range[] {
  const out: Range[] = [];
  for (const c of p.clips) {
    if (c.mediaId !== mediaId || isText(c)) continue;
    const sp = speedOf(c);
    for (const r of cuts) {
      const a = Math.max(r[0], c.in);
      const b = Math.min(r[1], c.out);
      if (b - a > 1e-6)
        out.push([round(c.start + (a - c.in) / sp), round(c.start + (b - c.in) / sp)]);
    }
  }
  return mergeRanges(out);
}

/** Seconds a set of source cuts removes from what the timeline still uses of the media. */
export function cutTotal(p: VideoProject, mediaId: string, cuts: readonly Range[]): number {
  return round(timelineCutZones(p, mediaId, cuts).reduce((n, r) => n + (r[1] - r[0]), 0));
}

/** Word indexes inside source cuts (to mark them in the transcript). */
export function wordsInCuts(
  words: readonly { s: number; e: number }[],
  cuts: readonly Range[],
): Set<number> {
  const set = new Set<number>();
  words.forEach((w, i) => {
    const mid = (w.s + w.e) / 2;
    if (cuts.some((r) => mid >= r[0] && mid < r[1])) set.add(i);
  });
  return set;
}

// ---------------- scene scores ----------------

/** `select='gt(scene,T)',metadata=print` log → [time, score] of frames over T. */
export function parseSceneScores(log: string): [number, number][] {
  const out: [number, number][] = [];
  let t: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const pt = /pts_time:\s*([\d.]+)/.exec(line);
    if (pt) {
      t = Number(pt[1]);
      continue;
    }
    const sc = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (sc && t !== null) {
      if (t > 0 && Number.isFinite(t)) out.push([round(t), Number(sc[1])]);
      t = null;
    }
  }
  return out;
}

/** Scene starts over a threshold, at least `gap` seconds apart (the strongest one wins). */
export function scenesOver(
  scores: readonly [number, number][],
  threshold: number,
  gap = 0.5,
): number[] {
  const hits = scores.filter((s) => s[1] > threshold).sort((a, b) => b[1] - a[1]);
  const kept: number[] = [];
  for (const [t] of hits) if (kept.every((k) => Math.abs(k - t) >= gap)) kept.push(t);
  return kept.sort((a, b) => a - b);
}
