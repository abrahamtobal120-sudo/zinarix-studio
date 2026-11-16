/**
 * Fase 13B: the agent edits Video Studio, the pure part.
 *
 * The project lives in the renderer. Main sends each video_* call there; the renderer runs it
 * with these functions (the same pure editing functions the buttons use) and commits the result
 * as one undoable step. Nothing here touches pixels or audio: only the timeline data.
 *
 * Word numbers are the transcript's indexes (what video_transcript prints), so the model picks
 * stretches by what is said, not by guessing seconds.
 */
import type { Clip, MediaItem, VideoProject } from './video.js';
import {
  FORMAT_PRESETS,
  IDENTITY,
  MIN_CLIP,
  clipEnd,
  isText,
  mediaOf,
  moveClips,
  prevAdjacent,
  projectDuration,
  setTransition,
  removeClips,
  sizeFor,
  splitAt,
  trackOf,
  trimClip,
  uid,
  addTextClip,
} from './video.js';
import type { Range } from './videoAi.js';
import {
  CAPTION_STYLES,
  captionTrack,
  cutMediaRanges,
  fillerIndexes,
  mergeRanges,
  placeCaptions,
  projectCues,
  wordCuts,
} from './videoAi.js';
import {
  TEXT_MAX,
  TEXT_PRESETS,
  TRANSITION_DEFAULT,
  TRANSITION_KINDS,
  TRANSITION_MAX,
  TRANSITION_MIN,
  type Transition,
  type TransitionKind,
} from './videoFx.js';
import {
  CHANNEL_END,
  CHANNEL_RANGE,
  TRANSITION_CHANNELS,
  normalizeTransitionDef,
  type TransitionDef,
} from './videoTransitions.js';

/** Tools that only read (no approval). */
export const VIDEO_READ_TOOLS = ['video_state', 'video_transcript', 'video_transitions'] as const;
/** Edits that are undone with Ctrl+Z: approved once, "always" allowed in the conversation. */
export const VIDEO_EDIT_TOOLS = [
  'video_add_media',
  'video_keep_ranges',
  'video_cut_words',
  'video_remove_fillers',
  'video_remove_silences',
  'video_split_scenes',
  'video_split',
  'video_trim',
  'video_move',
  'video_delete',
  'video_add_title',
  'video_captions',
  'video_set_format',
  'video_add_transition',
] as const;
/** Upload audio to a provider or write a file: approved every time. */
export const VIDEO_ASK_TOOLS = [
  'video_transcribe',
  'video_export',
  'video_share_transition',
] as const;

export type VideoToolName =
  | (typeof VIDEO_READ_TOOLS)[number]
  | (typeof VIDEO_EDIT_TOOLS)[number]
  | (typeof VIDEO_ASK_TOOLS)[number];

export const VIDEO_TOOL_LIST: readonly VideoToolName[] = [
  ...VIDEO_READ_TOOLS,
  ...VIDEO_EDIT_TOOLS,
  ...VIDEO_ASK_TOOLS,
];
export const isVideoTool = (n: string): n is VideoToolName =>
  (VIDEO_TOOL_LIST as readonly string[]).includes(n);

/** What the renderer answers for a call (dry: only `summary`, nothing committed). */
export type VideoAgentResult =
  { ok: true; content: string; summary: string } | { ok: false; content: string; summary: string };

export type Args = Record<string, unknown>;

/** A pure edit: the next project, the undo label, and what to tell the model / the user. */
export type VideoEdit =
  { project: VideoProject; label: string; content: string } | { error: string };

/** Words per video_transcript page. */
export const TRANSCRIPT_PAGE = 600;
/** Silence around kept or cut words (seconds), so cuts do not clip the sounds. */
const PAD = 0.05;

const round = (t: number) => Math.round(t * 1000) / 1000;
const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
const num = (a: Args, k: string) =>
  typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : undefined;

/** "1:05.3" (or "1:02:03.0" past an hour). */
export function fmtTime(t: number): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// ---------------- reading ----------------

/** The timeline as text: format, tracks, clips (ids, media, trims) and which media have words. */
export function describeState(p: VideoProject, playhead = 0): string {
  const lines = [
    `Project "${p.name}": ${p.width}x${p.height} @ ${p.fps} fps, duration ${fmtTime(projectDuration(p))} (${round(projectDuration(p))} s), playhead ${round(playhead)} s.`,
    '',
    'Media:',
  ];
  if (!p.media.length) lines.push('- (none: add files with video_add_media)');
  for (const m of p.media) {
    const tr = p.transcripts?.[m.id];
    lines.push(
      `- ${m.id} "${m.name}" ${m.kind}, ${round(m.duration)} s${m.hasAudio ? ', audio' : ''}${m.missing ? ', FILE MISSING' : ''}; transcript: ${tr ? `${tr.words.length} words (${tr.engine}${tr.lang ? `, ${tr.lang}` : ''})` : 'no'}`,
    );
  }
  lines.push('', 'Tracks (top to bottom) and clips (timeline seconds):');
  for (const t of p.tracks) {
    const flags = [
      t.role === 'captions' && 'captions',
      t.locked && 'locked',
      t.muted && 'muted',
      t.hidden && 'hidden',
    ].filter(Boolean);
    lines.push(`- ${t.id} ${t.name} (${t.kind}${flags.length ? `, ${flags.join(', ')}` : ''})`);
    const clips = p.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
    // A long caption track would drown the rest: summarise it.
    if (t.role === 'captions' && clips.length > 6) {
      lines.push(`  ${clips.length} caption titles from ${round(clips[0]!.start)} s`);
      continue;
    }
    for (const c of clips.slice(0, 200)) {
      const what = c.text
        ? `title "${c.text.content.slice(0, 60).replace(/\n/g, ' ')}"`
        : `"${mediaOf(p, c.mediaId)?.name ?? c.mediaId}" source ${round(c.in)}–${round(c.out)}`;
      lines.push(
        `  ${c.id} ${round(c.start)}–${round(clipEnd(c))} ${what}${(c.speed ?? 1) !== 1 ? ` x${c.speed}` : ''}`,
      );
    }
    if (clips.length > 200) lines.push(`  … ${clips.length - 200} more`);
  }
  return lines.join('\n');
}

/** Picks a media item: by id or name, else the first one on the timeline with sound. */
export function pickMedia(
  p: VideoProject,
  ref: string,
  need: 'audio' | 'transcript' | 'any' = 'any',
): MediaItem | { error: string } {
  if (ref) {
    const m =
      p.media.find((x) => x.id === ref) ??
      p.media.find((x) => x.name === ref) ??
      p.media.find((x) => x.name.toLowerCase().includes(ref.toLowerCase()));
    if (!m) return { error: `No media "${ref}". Call video_state to see the media ids.` };
    return m;
  }
  const ok = (m: MediaItem | undefined): m is MediaItem =>
    !!m &&
    !m.missing &&
    (need === 'transcript'
      ? !!p.transcripts?.[m.id]
      : need === 'audio'
        ? m.hasAudio && m.kind !== 'image'
        : true);
  const placed = [...p.clips]
    .filter((c) => !isText(c))
    .sort((a, b) => a.start - b.start)
    .map((c) => mediaOf(p, c.mediaId));
  const m = placed.find(ok) ?? p.media.find(ok);
  if (!m)
    return {
      error:
        need === 'transcript'
          ? 'No media has a transcript yet. Call video_transcribe first.'
          : 'There is no media with sound on the timeline. Add one with video_add_media.',
    };
  return m;
}

/** One page of a transcript, one word per entry: "[12] hola 3.42". Cut words are marked. */
export function transcriptPage(p: VideoProject, mediaRef: string, page = 1): string {
  const m = pickMedia(p, mediaRef, 'transcript');
  if ('error' in m) return m.error;
  const tr = p.transcripts?.[m.id];
  if (!tr) return `"${m.name}" has no transcript. Call video_transcribe first.`;
  const pages = Math.max(1, Math.ceil(tr.words.length / TRANSCRIPT_PAGE));
  const pg = Math.min(Math.max(1, Math.round(page)), pages);
  const used = p.clips
    .filter((c) => c.mediaId === m.id && !isText(c))
    .map((c) => [c.in, c.out] as Range);
  const from = (pg - 1) * TRANSCRIPT_PAGE;
  const words = tr.words.slice(from, from + TRANSCRIPT_PAGE).map((w, i) => {
    const mid = (w.s + w.e) / 2;
    const cut = !used.some((r) => mid >= r[0] && mid < r[1]);
    return `[${from + i}] ${w.w} ${w.s.toFixed(2)}${cut ? ' (cut)' : ''}`;
  });
  return [
    `Transcript of ${m.id} "${m.name}" (${tr.words.length} words, ${round(m.duration)} s), page ${pg} of ${pages}. Format: [word number] word start-second. "(cut)" = not on the timeline any more.`,
    words.join('\n'),
    pg < pages ? `More: video_transcript with page ${pg + 1}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------- word ranges ----------------

/** [[a,b],…] of word numbers (inclusive), checked against the transcript. */
export function wordRanges(raw: unknown, count: number): [number, number][] | { error: string } {
  if (!Array.isArray(raw) || !raw.length)
    return { error: 'Give "ranges" as [[first word, last word], …] (word numbers).' };
  const out: [number, number][] = [];
  for (const r of raw) {
    const pair = Array.isArray(r) ? r : typeof r === 'number' ? [r, r] : null;
    const a = Number(pair?.[0]);
    const b = Number(pair?.[1] ?? pair?.[0]);
    if (!Number.isInteger(a) || !Number.isInteger(b))
      return { error: `Range ${JSON.stringify(r)} is not [first, last] word numbers.` };
    if (a < 0 || b >= count || a > b)
      return { error: `Range [${a}, ${b}] is outside the transcript (words 0–${count - 1}).` };
    out.push([a, b]);
  }
  return out;
}

/**
 * Keeps only some stretches of a media item's words, in the order given: the short / highlight
 * tool. Every clip of that media is replaced by one clip per stretch, back to back from where
 * the first one started (on its track, with its look); later clips on that track follow.
 */
export function keepRanges(p: VideoProject, mediaRef: string, raw: unknown): VideoEdit {
  const m = pickMedia(p, mediaRef, 'transcript');
  if ('error' in m) return m;
  const words = p.transcripts?.[m.id]?.words;
  if (!words?.length) return { error: `"${m.name}" has no transcript. Call video_transcribe.` };
  const ranges = wordRanges(raw, words.length);
  if ('error' in ranges) return ranges;
  const mine = p.clips
    .filter((c) => c.mediaId === m.id && !isText(c))
    .sort((a, b) => a.start - b.start);
  const base = mine[0];
  if (!base) return { error: `"${m.name}" is not on the timeline. Add it with video_add_media.` };
  const track = trackOf(p, base.trackId);
  if (!track || track.locked) return { error: `Track ${track?.name ?? ''} is locked.` };
  const t0 = base.start;
  const oldEnd = Math.max(...mine.filter((c) => c.trackId === base.trackId).map(clipEnd));
  const others = p.clips.filter(
    (c) =>
      c.trackId === base.trackId &&
      c.mediaId !== m.id &&
      c.start < oldEnd - 1e-6 &&
      clipEnd(c) > t0 + 1e-6,
  );
  if (others.length)
    return {
      error: `Other clips sit between the clips of "${m.name}" on ${track.name}; use video_cut_words instead.`,
    };
  // Word ranges that continue each other ([0,4] then [5,9]) are one stretch.
  const joined: [number, number][] = [];
  for (const [a, b] of ranges) {
    const last = joined[joined.length - 1];
    if (last && a === last[1] + 1) last[1] = b;
    else joined.push([a, b]);
  }
  // Source stretches, joined when one runs straight into the next.
  const src: [number, number][] = [];
  for (const [a, b] of joined) {
    const s = round(Math.max(words[a - 1]?.e ?? 0, words[a]!.s - PAD, 0));
    const e = round(
      Math.min(words[b + 1]?.s ?? m.duration, words[b]!.e + PAD, m.duration || Infinity),
    );
    if (e - s < MIN_CLIP) continue;
    const last = src[src.length - 1];
    if (last && Math.abs(last[1] - s) < 1e-3) last[1] = e;
    else src.push([s, e]);
  }
  if (!src.length) return { error: 'The ranges are empty.' };
  const sp = base.speed ?? 1;
  const pieces: Clip[] = [];
  let at = t0;
  src.forEach(([s, e], i) => {
    const c: Clip = {
      ...base,
      id: i === 0 ? base.id : uid('c'),
      start: round(at),
      in: s,
      out: e,
    };
    delete c.fadeIn;
    delete c.fadeOut;
    delete c.transition;
    delete c.anim;
    if (i === 0 && base.fadeIn) c.fadeIn = base.fadeIn;
    if (i === src.length - 1) {
      const last = mine[mine.length - 1]!;
      if (last.fadeOut) c.fadeOut = last.fadeOut;
    }
    pieces.push(c);
    at += (e - s) / sp;
  });
  const newEnd = at;
  const delta = newEnd - oldEnd;
  const ids = new Set(mine.map((c) => c.id));
  const clips: Clip[] = [];
  for (const c of p.clips) {
    if (ids.has(c.id)) continue;
    if (c.trackId === base.trackId && c.start >= oldEnd - 1e-6)
      clips.push({ ...c, start: round(Math.max(0, c.start + delta)) });
    else clips.push(c);
  }
  const project = { ...p, clips: [...clips, ...pieces] };
  const caps = captionTrack(project)
    ? ' The caption track still has the old times: run video_captions again.'
    : '';
  return {
    project,
    label: 'IA: dejar fragmentos',
    content: `Kept ${src.length} stretch(es) of "${m.name}" (${round(newEnd - t0)} s, was ${round(oldEnd - t0)} s). Timeline now ${round(projectDuration(project))} s.${caps}`,
  };
}

/** Cuts words (by number) out of every clip of a media item, closing the gaps. */
export function cutWords(p: VideoProject, mediaRef: string, raw: unknown): VideoEdit {
  const m = pickMedia(p, mediaRef, 'transcript');
  if ('error' in m) return m;
  const words = p.transcripts?.[m.id]?.words ?? [];
  const ranges = wordRanges(raw, words.length);
  if ('error' in ranges) return ranges;
  const idx = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
  return applyCuts(p, m, wordCuts(words, idx), 'IA: cortar palabras');
}

export function removeFillers(p: VideoProject, mediaRef: string): VideoEdit {
  const m = pickMedia(p, mediaRef, 'transcript');
  if ('error' in m) return m;
  const words = p.transcripts?.[m.id]?.words ?? [];
  const idx = fillerIndexes(words);
  if (!idx.length) return { error: 'No filler words ("eh", "um"…) found.' };
  return applyCuts(p, m, wordCuts(words, idx), 'IA: quitar muletillas');
}

/** Cuts source ranges (seconds of the file) from a media item: silences, words. */
export function applyCuts(
  p: VideoProject,
  m: MediaItem,
  cuts: readonly Range[],
  label: string,
): VideoEdit {
  if (!cuts.length) return { error: 'Nothing to cut.' };
  if (p.clips.some((c) => c.mediaId === m.id && trackOf(p, c.trackId)?.locked))
    return { error: `A track with "${m.name}" is locked.` };
  const r = cutMediaRanges(p, m.id, mergeRanges(cuts));
  if (r.removed <= 0) return { error: 'Those parts are already off the timeline.' };
  return {
    project: r.project,
    label,
    content: `Cut ${round(r.removed)} s from "${m.name}" in ${cuts.length} place(s). Timeline now ${round(projectDuration(r.project))} s.`,
  };
}

// ---------------- clips ----------------

function clipOf(p: VideoProject, a: Args): Clip | { error: string } {
  const id = str(a, 'clip');
  const c = p.clips.find((x) => x.id === id);
  if (!c) return { error: `No clip "${id}". Call video_state to see the clip ids.` };
  if (trackOf(p, c.trackId)?.locked) return { error: `Clip ${id} is on a locked track.` };
  return c;
}

export function splitClip(p: VideoProject, a: Args): VideoEdit {
  const c = clipOf(p, a);
  if ('error' in c) return c;
  const at = num(a, 'at');
  if (at === undefined || at <= c.start + MIN_CLIP || at >= clipEnd(c) - MIN_CLIP)
    return {
      error: `"at" must be a timeline second inside the clip (${round(c.start)}–${round(clipEnd(c))}).`,
    };
  const r = splitAt(p, at, new Set([c.id]));
  if (!r.created.length) return { error: 'The clip could not be split there.' };
  return {
    project: r.project,
    label: 'IA: dividir',
    content: `Split ${c.id} at ${round(at)} s; the right part is ${r.created[0]}.`,
  };
}

export function trim(p: VideoProject, a: Args): VideoEdit {
  const c = clipOf(p, a);
  if ('error' in c) return c;
  const s = num(a, 'start');
  const e = num(a, 'end');
  if (s === undefined && e === undefined)
    return { error: 'Give "start" and/or "end": the new edges, in timeline seconds.' };
  let project = p;
  if (s !== undefined) project = trimClip(project, c.id, 'left', s);
  if (e !== undefined) project = trimClip(project, c.id, 'right', e);
  const n = project.clips.find((x) => x.id === c.id)!;
  return {
    project,
    label: 'IA: recortar',
    content: `Clip ${c.id} now ${round(n.start)}–${round(clipEnd(n))} (source ${round(n.in)}–${round(n.out)}).`,
  };
}

export function move(p: VideoProject, a: Args): VideoEdit {
  const c = clipOf(p, a);
  if ('error' in c) return c;
  const start = num(a, 'start') ?? c.start;
  let shift = 0;
  const to = str(a, 'track');
  if (to) {
    const from = trackOf(p, c.trackId)!;
    const same = p.tracks.filter((t) => t.kind === from.kind);
    const target = same.find((t) => t.id === to || t.name === to);
    if (!target) return { error: `No ${from.kind} track "${to}".` };
    shift = same.indexOf(target) - same.indexOf(from);
  }
  const project = moveClips(p, new Set([c.id]), start - c.start, shift);
  if (!project) return { error: 'It would overlap another clip there (or the track is locked).' };
  return { project, label: 'IA: mover', content: `Moved ${c.id} to ${round(start)} s.` };
}

export function del(p: VideoProject, a: Args): VideoEdit {
  const ids = Array.isArray(a.clips) ? a.clips.map(String) : str(a, 'clip') ? [str(a, 'clip')] : [];
  const found = ids.filter((id) => p.clips.some((c) => c.id === id));
  if (!found.length) return { error: 'Give "clips": the ids to delete (see video_state).' };
  const project = removeClips(p, new Set(found), a.ripple !== false);
  if (project === p) return { error: 'Those clips are on locked tracks.' };
  return {
    project,
    label: 'IA: borrar',
    content: `Deleted ${found.length} clip(s)${a.ripple !== false ? ', gaps closed' : ''}. Timeline now ${round(projectDuration(project))} s.`,
  };
}

const POSITIONS: Record<string, number> = { top: -0.35, center: 0, bottom: 0.35 };

export function addTitle(p: VideoProject, a: Args, playhead: number): VideoEdit {
  const text = str(a, 'text').slice(0, TEXT_MAX);
  if (!text) return { error: 'Give the "text" of the title.' };
  const preset = TEXT_PRESETS.find((x) => x.id === str(a, 'style')) ?? TEXT_PRESETS[0]!;
  const color = /^#[0-9a-f]{6}$/i.test(str(a, 'color')) ? str(a, 'color') : undefined;
  const pos = POSITIONS[str(a, 'position')];
  const dur = Math.min(600, Math.max(0.2, num(a, 'duration') ?? 4));
  const r = addTextClip(
    p,
    { ...preset.spec, content: text, ...(color ? { color } : {}) },
    Math.max(0, num(a, 'start') ?? playhead),
    { dur, y: pos ?? preset.y, anim: preset.anim },
  );
  return {
    project: r.project,
    label: 'IA: título',
    content: `Added title ${r.clip.id} "${text.slice(0, 60)}" at ${round(r.clip.start)}–${round(clipEnd(r.clip))} s.`,
  };
}

export function captions(p: VideoProject, a: Args): VideoEdit {
  const style = CAPTION_STYLES.find((s) => s.id === str(a, 'style'))?.id ?? 'classic';
  const cues = projectCues(p, style);
  if (!cues.length)
    return { error: 'No transcribed words are on the timeline. Call video_transcribe first.' };
  const r = placeCaptions(p, cues, style);
  if (!r.count) return { error: 'The caption track is locked.' };
  return {
    project: r.project,
    label: 'IA: subtítulos',
    content: `Placed ${r.count} caption lines (style ${style}) on the "Subtítulos" track.`,
  };
}

/**
 * Changes the canvas aspect (same short side). Media clips without a size of their own are
 * zoomed to fill it, centred (a 16:9 shot becomes a centre crop in 9:16), until 13D reframes.
 */
export function setFormat(p: VideoProject, a: Args): VideoEdit {
  const preset = FORMAT_PRESETS.find((f) => f.id === str(a, 'aspect'));
  if (!preset)
    return { error: `"aspect" must be one of ${FORMAT_PRESETS.map((f) => f.id).join(', ')}.` };
  const size = sizeFor(preset.width, preset.height, Math.min(p.width, p.height));
  if (size.width === p.width && size.height === p.height)
    return { error: `The project is already ${preset.id}.` };
  const fill = a.fill !== false;
  const clips = p.clips.map((c) => {
    const m = mediaOf(p, c.mediaId);
    if (!fill || isText(c) || !m?.width || !m.height || c.keyframes?.scale?.length) return c;
    const t = { ...IDENTITY, ...c.transform };
    if (t.scale !== 1) return c; // sized by hand: leave it
    const fit = Math.min(size.width / m.width, size.height / m.height);
    const cover = Math.max(size.width / m.width, size.height / m.height);
    return { ...c, transform: { ...t, scale: round(cover / fit) } };
  });
  return {
    project: { ...p, ...size, clips },
    label: 'IA: formato',
    content: `Format ${preset.id}: ${size.width}x${size.height}${fill ? ', shots zoomed to fill (centre crop)' : ''}.`,
  };
}

/** The pure edits, by tool name (the renderer adds the ones that need FFmpeg or files). */
export function pureEdit(
  p: VideoProject,
  name: string,
  a: Args,
  playhead: number,
): VideoEdit | null {
  switch (name) {
    case 'video_keep_ranges':
      return keepRanges(p, str(a, 'media'), a.ranges);
    case 'video_cut_words':
      return cutWords(p, str(a, 'media'), a.ranges);
    case 'video_remove_fillers':
      return removeFillers(p, str(a, 'media'));
    case 'video_split':
      return splitClip(p, a);
    case 'video_trim':
      return trim(p, a);
    case 'video_move':
      return move(p, a);
    case 'video_delete':
      return del(p, a);
    case 'video_add_title':
      return addTitle(p, a, playhead);
    case 'video_captions':
      return captions(p, a);
    case 'video_set_format':
      return setFormat(p, a);
    default:
      return null;
  }
}

/**
 * What an edit changes, for the approval card (Spanish, like the rest of the cards):
 * "duración 10:02.0 → 0:46.0 · 4 cortes · pista Subtítulos con 18 frases".
 */
export function describeChange(before: VideoProject, after: VideoProject): string {
  const parts: string[] = [];
  const d0 = projectDuration(before);
  const d1 = projectDuration(after);
  if (Math.abs(d0 - d1) > 0.01) parts.push(`duración ${fmtTime(d0)} → ${fmtTime(d1)}`);
  const media = (p: VideoProject) => p.clips.filter((c) => !isText(c));
  const m0 = media(before).length;
  const m1 = media(after).length;
  if (m0 !== m1) parts.push(`clips ${m0} → ${m1}`);
  const capT = captionTrack(after)?.id;
  const titles = (p: VideoProject) => p.clips.filter((c) => isText(c) && c.trackId !== capT).length;
  const t = titles(after) - titles(before);
  if (t > 0) parts.push(`${t} título(s) nuevo(s)`);
  if (capT) {
    const n = after.clips.filter((c) => c.trackId === capT).length;
    const was = before.clips.filter((c) => c.trackId === captionTrack(before)?.id).length;
    if (n !== was || !captionTrack(before)) parts.push(`pista Subtítulos con ${n} frases`);
  }
  if (before.width !== after.width || before.height !== after.height)
    parts.push(`formato ${before.width}x${before.height} → ${after.width}x${after.height}`);
  const moved = after.clips.filter((c) => {
    const o = before.clips.find((x) => x.id === c.id);
    return (
      o && (o.start !== c.start || o.in !== c.in || o.out !== c.out || o.trackId !== c.trackId)
    );
  }).length;
  const trs = (q: VideoProject) =>
    new Map(q.clips.filter((c) => c.transition).map((c) => [c.id, JSON.stringify(c.transition)]));
  const t0 = trs(before);
  const t1 = trs(after);
  const trChanged = [...new Set([...t0.keys(), ...t1.keys()])].filter(
    (id) => t0.get(id) !== t1.get(id),
  ).length;
  if (trChanged) parts.push(`${trChanged} transición(es)`);
  if (moved && !parts.length) parts.push(`${moved} clip(s) movidos o recortados`);
  return parts.length ? parts.join(' · ') : 'sin cambios visibles en la línea de tiempo';
}

// ---------------- transitions ----------------

/** What video_transitions prints: built-in kinds and the saved / shared custom ones. */
export function describeTransitions(defs: readonly TransitionDef[]): string {
  const lines = [
    `Built-in kinds: ${TRANSITION_KINDS.join(', ')}.`,
    defs.length
      ? `Custom transitions (use with transition_id):\n${defs
          .map(
            (d) =>
              `- ${d.id}: ${d.name}${d.description ? ` — ${d.description}` : ''} [${Object.keys(d.channels).join(', ')}]`,
          )
          .join('\n')}`
      : 'No custom transitions saved yet: invent one with video_add_transition "custom".',
    `Channels for a custom one (keys {t: 0…1, v}): ${TRANSITION_CHANNELS.map((c) => `${c} ${CHANNEL_RANGE[c][0]}…${CHANNEL_RANGE[c][1]} (ends at ${CHANNEL_END[c]})`).join('; ')}.`,
  ];
  return lines.join('\n');
}

/** The clips a transition goes on: the ones given, or every video clip that follows another. */
function transitionTargets(p: VideoProject, a: Args): Clip[] | { error: string } {
  const visual = (c: Clip) => trackOf(p, c.trackId)?.kind === 'video';
  if (Array.isArray(a.clips) && a.clips.length) {
    const ids = a.clips.map(String);
    const found = p.clips.filter((c) => ids.includes(c.id));
    const bad = ids.filter((id) => !found.some((c) => c.id === id));
    if (bad.length) return { error: `Unknown clip id(s): ${bad.join(', ')} (see video_state).` };
    const notVisual = found.filter((c) => !visual(c));
    if (notVisual.length)
      return {
        error: `Transitions go on video-track clips; ${notVisual.map((c) => c.id).join(', ')} is not one.`,
      };
    return found;
  }
  const cuts = p.clips.filter((c) => visual(c) && !isText(c) && prevAdjacent(p, c));
  if (!cuts.length)
    return { error: 'No two clips touch on a video track. Give "clips" to reveal a clip instead.' };
  return cuts;
}

/**
 * video_add_transition: a built-in kind, a saved one (transition_id) or a new custom one the
 * model describes (custom). `library` is what the user has (saved + shared). Returns the edit
 * and, for a new one, the normalized definition so the caller keeps it in the library.
 */
export function addTransition(
  p: VideoProject,
  a: Args,
  library: readonly TransitionDef[],
):
  | (Exclude<VideoEdit, { error: string }> & { def?: TransitionDef; isNew?: boolean })
  | { error: string } {
  const d0 = num(a, 'duration') ?? TRANSITION_DEFAULT;
  const d = Math.min(TRANSITION_MAX, Math.max(TRANSITION_MIN, d0));
  let tr: Transition | null = null;
  let def: TransitionDef | undefined;
  let isNew = false;
  if (a.remove === true) tr = null;
  else if (a.custom !== undefined) {
    const n = normalizeTransitionDef(a.custom);
    if ('error' in n) return { error: n.error };
    const same = library.find((x) => x.id === n.id);
    // Same id as one the user has but different curves: keep both.
    if (same && JSON.stringify(same) !== JSON.stringify(n)) {
      let i = 2;
      while (library.some((x) => x.id === `${n.id}-${i}`)) i++;
      n.id = `${n.id.slice(0, 36)}-${i}`;
    }
    def = n;
    isNew = !same || JSON.stringify(same) !== JSON.stringify(n);
    tr = { kind: 'custom', d, def };
  } else if (str(a, 'transition_id')) {
    const id = str(a, 'transition_id');
    def = library.find((x) => x.id === id);
    if (!def)
      return { error: `No saved transition "${id}". See video_transitions, or pass "custom".` };
    tr = { kind: 'custom', d, def };
  } else {
    const kind = str(a, 'kind') || 'dissolve';
    if (!(TRANSITION_KINDS as readonly string[]).includes(kind))
      return {
        error: `Unknown kind "${kind}". Built-in: ${TRANSITION_KINDS.join(', ')}; or use "custom" / "transition_id".`,
      };
    tr = { kind: kind as TransitionKind, d };
  }
  const targets = transitionTargets(p, a);
  if ('error' in targets) return targets;
  let project = p;
  for (const c of targets) project = setTransition(project, c.id, tr ?? undefined);
  if (project === p) return { error: 'Nothing changed (the clips are on locked tracks?).' };
  const what = tr ? (def ? `"${def.name}" (${def.id})` : tr.kind) : 'no transition';
  return {
    project,
    label: 'IA: transición',
    content: `${what} on ${targets.length} clip(s): ${targets.map((c) => c.id).join(', ')}${tr ? `, ${round(d)} s each` : ''}.${isNew ? ` Saved to the user's library as "${def!.id}"; video_share_transition proposes it to the Zinarix Studio repository.` : ''}`,
    ...(def ? { def } : {}),
    ...(isNew ? { isNew } : {}),
  };
}
