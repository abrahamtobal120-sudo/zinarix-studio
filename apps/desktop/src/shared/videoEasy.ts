/**
 * Video Studio, easy editing (phase 11): Ken Burns on photos, music ducking under voices,
 * themes (a transition, a look and a title style that go together) and "Magic video", which
 * lays out a first cut from a few photos and clips.
 *
 * Pure like video.ts: every function returns a new project. Ken Burns is plain keyframes and
 * ducking is a gain envelope, so the preview and the FFmpeg export follow the same numbers.
 */
import type { Clip, Keyframe, Keyframes, MediaItem, Track, VideoProject } from './video.js';
import {
  IDENTITY,
  addTextClip,
  addTrack,
  clipDur,
  clipEnd,
  compositeOrder,
  mediaOf,
  prevAdjacent,
  setTransition,
  speedOf,
  trackAudible,
  trackOf,
  uid,
} from './video.js';
import type { ClipAnim, Effects, TextSpec, Transition } from './videoFx.js';
import {
  LOOKS,
  TEXT_PRESETS,
  cleanEffects,
  validAnim,
  validEffects,
  validText,
  validTransition,
} from './videoFx.js';

// ---------------- Ken Burns ----------------

export type KenBurnsKind = 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight' | 'panUp' | 'panDown';
export const KEN_BURNS_KINDS: readonly KenBurnsKind[] = [
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
  'panUp',
  'panDown',
];
/** How much the picture grows over the clip, and the most a pan moves (share of the canvas). */
const KB_ZOOM = 1.18;
const KB_PAN_SCALE = 1.15;
const KB_PAN_MAX = 0.06;

/**
 * Scale (relative to "fit") at which the media covers the whole canvas, and the size of the
 * picture at scale s as a share of the canvas.
 */
function coverOf(p: VideoProject, m: MediaItem | undefined) {
  const w = m?.width ?? 0;
  const h = m?.height ?? 0;
  if (!(w > 0 && h > 0)) return { cover: 1, size: (s: number) => ({ w: s, h: s }) };
  const fit = Math.min(p.width / w, p.height / h);
  const cover = Math.max(p.width / w, p.height / h) / fit;
  return {
    cover,
    size: (s: number) => ({ w: (w * fit * s) / p.width, h: (h * fit * s) / p.height }),
  };
}

/** Start and end values of a Ken Burns move for a clip (the picture always fills the frame). */
export function kenBurnsMove(
  p: VideoProject,
  c: Clip,
  kind: KenBurnsKind,
): { scale: [number, number]; x: [number, number]; y: [number, number] } {
  const { cover, size } = coverOf(p, mediaOf(p, c.mediaId));
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  if (kind === 'zoomIn' || kind === 'zoomOut') {
    const a = r3(cover);
    const b = r3(cover * KB_ZOOM);
    return { scale: kind === 'zoomIn' ? [a, b] : [b, a], x: [0, 0], y: [0, 0] };
  }
  const s = r3(cover * KB_PAN_SCALE);
  const pic = size(s);
  const ax = r3(Math.min(KB_PAN_MAX, Math.max(0, (pic.w - 1) / 2)));
  const ay = r3(Math.min(KB_PAN_MAX, Math.max(0, (pic.h - 1) / 2)));
  const move: Record<string, { x: [number, number]; y: [number, number] }> = {
    panLeft: { x: [ax, -ax], y: [0, 0] },
    panRight: { x: [-ax, ax], y: [0, 0] },
    panUp: { x: [0, 0], y: [ay, -ay] },
    panDown: { x: [0, 0], y: [-ay, ay] },
  };
  return { scale: [s, s], ...move[kind]! };
}

/**
 * Slow zoom or pan over a clip (meant for photos, works on any visual clip): keys for scale,
 * x and y at the clip's first and last source frame. Replaces any keys on those three.
 */
export function kenBurns(p: VideoProject, id: string, kind: KenBurnsKind = 'zoomIn'): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c || c.text || trackOf(p, c.trackId)?.kind !== 'video' || trackOf(p, c.trackId)?.locked)
    return p;
  if (!KEN_BURNS_KINDS.includes(kind)) return p;
  const mv = kenBurnsMove(p, c, kind);
  const keys = (pair: [number, number]): Keyframe[] => [
    { t: c.in, v: pair[0] },
    { t: c.out, v: pair[1] },
  ];
  const kf: Keyframes = { ...c.keyframes, scale: keys(mv.scale) };
  if (mv.x[0] !== mv.x[1]) kf.x = keys(mv.x);
  else delete kf.x;
  if (mv.y[0] !== mv.y[1]) kf.y = keys(mv.y);
  else delete kf.y;
  const tr = { ...IDENTITY, ...c.transform, x: 0, y: 0, scale: 1 };
  const same = (Object.keys(IDENTITY) as (keyof typeof IDENTITY)[]).every(
    (k) => tr[k] === IDENTITY[k],
  );
  const next: Clip = { ...c, keyframes: kf, transform: same ? undefined : tr };
  return { ...p, clips: p.clips.map((x) => (x.id === id ? next : x)) };
}

/** Whether a clip carries a Ken Burns move (keys on scale at both ends and nothing else). */
export function hasKenBurns(c: Clip): boolean {
  const s = c.keyframes?.scale;
  return !!s && s.length === 2 && s[0]!.t === c.in && s[1]!.t === c.out;
}

// ---------------- ducking ----------------

/** Seconds the music takes to go down before a voice and back up after it. */
export const DUCK_RAMP = 0.3;
export const DUCK_DEFAULT = 0.25;
/** Bounds the export expression (windows closer than two ramps are merged first). */
const DUCK_MAX_WINDOWS = 200;

/** Turns ducking on (level 0–1) or off (undefined) for a track. */
export function setTrackDuck(
  p: VideoProject,
  trackId: string,
  level: number | undefined,
): VideoProject {
  const t = trackOf(p, trackId);
  if (!t) return p;
  const next: Track = { ...t };
  if (level === undefined || !Number.isFinite(level)) delete next.duck;
  else next.duck = Math.round(Math.min(1, Math.max(0, level)) * 1000) / 1000;
  return { ...p, tracks: p.tracks.map((x) => (x.id === trackId ? next : x)) };
}

/**
 * When a ducked track has to go down: the time spans of every audible sound on the other,
 * non-ducked tracks (voice-overs, clips with their own sound), merged and sorted.
 */
export function duckWindows(p: VideoProject, trackId: string): { from: number; to: number }[] {
  const me = trackOf(p, trackId);
  if (!me || me.duck === undefined) return [];
  const spans: { from: number; to: number }[] = [];
  for (const c of p.clips) {
    if (c.trackId === trackId || c.text || !(c.volume > 0)) continue;
    const t = trackOf(p, c.trackId);
    if (!t || t.duck !== undefined || !trackAudible(p, t) || (t.volume ?? 1) <= 0) continue;
    const m = mediaOf(p, c.mediaId);
    if (!m || m.missing || !m.hasAudio || m.kind === 'image') continue;
    const voice = me.duckSound ? m.analysis?.voice : undefined;
    if (!voice) {
      spans.push({ from: c.start, to: clipEnd(c) });
      continue;
    }
    // Fase 11B: only where the clip really has sound (seconds of the file → timeline).
    const sp = speedOf(c);
    for (const [a, b] of voice) {
      const s0 = Math.max(a, c.in);
      const s1 = Math.min(b, c.out);
      if (!(s1 - s0 > 1e-3) || !Number.isFinite(s0) || !Number.isFinite(s1)) continue;
      spans.push({ from: c.start + (s0 - c.in) / sp, to: c.start + (s1 - c.in) / sp });
    }
  }
  spans.sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.from - last.to < DUCK_RAMP * 2) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out.slice(0, DUCK_MAX_WINDOWS);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Gain (0–1) the ducking puts on a track at timeline time t (1 = untouched). */
export function duckGainAt(p: VideoProject, track: Track | undefined, t: number): number {
  if (!track || track.duck === undefined) return 1;
  let k = 0;
  for (const w of duckWindows(p, track.id))
    k = Math.max(
      k,
      clamp01((t - w.from + DUCK_RAMP) / DUCK_RAMP) * clamp01((w.to + DUCK_RAMP - t) / DUCK_RAMP),
    );
  return 1 - (1 - clamp01(track.duck)) * k;
}

/** Ducking guided by the detected sound on (true) or along whole clips (false) for a track. */
export function setTrackDuckSound(p: VideoProject, trackId: string, on: boolean): VideoProject {
  const t = trackOf(p, trackId);
  if (!t) return p;
  const next: Track = { ...t };
  if (on) next.duckSound = true;
  else delete next.duckSound;
  return { ...p, tracks: p.tracks.map((x) => (x.id === trackId ? next : x)) };
}

/**
 * Points (time, gain) of a track's ducking curve between `from` and `to`, for drawing it on the
 * timeline: the corners of every ramp, so a straight line between them is the exact curve.
 */
export function duckCurve(
  p: VideoProject,
  trackId: string,
  from: number,
  to: number,
): { t: number; g: number }[] {
  const track = trackOf(p, trackId);
  if (!track || track.duck === undefined || !(to > from)) return [];
  const ts = new Set<number>([from, to]);
  for (const w of duckWindows(p, trackId))
    for (const x of [w.from - DUCK_RAMP, w.from, w.to, w.to + DUCK_RAMP])
      if (x > from && x < to) ts.add(x);
  return [...ts].sort((a, b) => a - b).map((t) => ({ t, g: duckGainAt(p, track, t) }));
}

/**
 * The same envelope as an FFmpeg `volume` expression, over the filter's time `t` plus an
 * offset (the timeline time of t = 0). Windows never overlap after merging, so the ramps add.
 */
export function duckExpr(p: VideoProject, track: Track, offset: number): string | null {
  const ws = duckWindows(p, track.id);
  if (track.duck === undefined || !ws.length) return null;
  const n = (x: number) => (Math.round(x * 1e6) / 1e6).toString();
  const T = offset ? `(t+${n(offset)})` : 't';
  const r = n(DUCK_RAMP);
  const parts = ws.map(
    (w) => `clip((${T}-${n(w.from)}+${r})/${r},0,1)*clip((${n(w.to)}+${r}-${T})/${r},0,1)`,
  );
  return `1-${n(1 - clamp01(track.duck))}*(${parts.join('+')})`;
}

// ---------------- themes ----------------

export interface VideoTheme {
  id: string;
  /** Between every two clips. */
  transition: Transition;
  /** LOOKS id put on every media clip. */
  look: string;
  /** Title style (on top of the "title" preset). */
  title: Partial<TextSpec>;
  titleAnim: ClipAnim;
  /** Ken Burns on photos. */
  kenBurns: boolean;
  /** Music level under voices. */
  duck: number;
  /** Fase 11D (themes as files): the name shown, and the file format version. */
  name?: string;
  version?: number;
  /** Effects of its own instead of a LOOKS id. */
  fx?: Effects;
  /** Music the theme brings (absolute path; used when the Magic video has none). */
  music?: string;
  /** A .cube LUT put on every media clip (Fase 12 colour grade). */
  lut?: string;
}

export const VIDEO_THEMES: VideoTheme[] = [
  {
    id: 'clean',
    transition: { kind: 'dissolve', d: 0.8 },
    look: 'none',
    title: { font: 'sans', color: '#ffffff', bold: true, shadow: true },
    titleAnim: { in: 'fade', out: 'fade' },
    kenBurns: true,
    duck: 0.25,
  },
  {
    id: 'cinema',
    transition: { kind: 'dissolve', d: 1.2 },
    look: 'cinema',
    title: { font: 'serif', color: '#f5f0e6', bold: false, italic: false, shadow: true },
    titleAnim: { in: 'zoom', out: 'fade', inD: 1.2, outD: 1 },
    kenBurns: true,
    duck: 0.2,
  },
  {
    id: 'energy',
    transition: { kind: 'zoomIn', d: 0.4 },
    look: 'vivid',
    title: { font: 'display', color: '#ffffff', bold: true, bg: '#e5484d', shadow: false },
    titleAnim: { in: 'pop', out: 'slideUp', inD: 0.4, outD: 0.4 },
    kenBurns: true,
    duck: 0.3,
  },
  {
    id: 'retro',
    transition: { kind: 'wipe', d: 0.7 },
    look: 'faded',
    title: { font: 'hand', color: '#ffe8b0', bold: true, shadow: true },
    titleAnim: { in: 'slideUp', out: 'fade' },
    kenBurns: true,
    duck: 0.25,
  },
  {
    id: 'news',
    transition: { kind: 'slide', d: 0.5 },
    look: 'none',
    title: { font: 'sans', color: '#ffffff', bold: true, bg: '#1f6feb', shadow: false },
    titleAnim: { in: 'slideRight', out: 'slideLeft', inD: 0.4, outD: 0.4 },
    kenBurns: false,
    duck: 0.2,
  },
];

export const themeOf = (id: string | undefined, extra: readonly VideoTheme[] = []): VideoTheme =>
  extra.find((t) => t.id === id) ?? VIDEO_THEMES.find((t) => t.id === id) ?? VIDEO_THEMES[0]!;

/** The title style of a theme, ready for addTextClip. */
export function themeTitle(theme: VideoTheme, content: string): TextSpec {
  const base = TEXT_PRESETS.find((x) => x.id === 'title')!.spec;
  const spec: TextSpec = { ...base, ...theme.title, content };
  for (const k of Object.keys(spec) as (keyof TextSpec)[])
    if (spec[k] === undefined) delete spec[k];
  return spec;
}

const kbCycle: KenBurnsKind[] = ['zoomIn', 'panRight', 'zoomOut', 'panLeft'];

/**
 * Puts a theme on clips (default: every clip on the video tracks): the look on media clips,
 * the transition where a clip touches the one before it, the title style on titles, and Ken
 * Burns on photos that have no animation yet.
 */
export function applyTheme(
  p: VideoProject,
  themeId: string,
  ids?: string[],
  /** Themes loaded from files (they win over the built-in ones with the same id). */
  extra: readonly VideoTheme[] = [],
): VideoProject {
  const theme = themeOf(themeId, extra);
  const fx = cleanEffects(theme.fx ?? LOOKS.find((l) => l.id === theme.look)?.fx);
  const pick = new Set(ids ?? p.clips.map((c) => c.id));
  let next = p;
  let photo = 0;
  const targets = p.clips
    .filter((c) => pick.has(c.id) && trackOf(p, c.trackId)?.kind === 'video')
    .filter((c) => !trackOf(p, c.trackId)?.locked)
    .sort((a, b) => a.start - b.start);
  for (const c0 of targets) {
    let c = next.clips.find((x) => x.id === c0.id)!;
    if (c.text) {
      const text = { ...c.text, ...theme.title };
      for (const k of Object.keys(text) as (keyof TextSpec)[])
        if (text[k] === undefined) delete text[k];
      c = { ...c, text, anim: { ...theme.titleAnim } };
    } else {
      c = { ...c, effects: fx };
      if (!fx) delete c.effects;
      if (theme.lut && mediaOf(next, c.mediaId)?.kind !== 'audio')
        c = { ...c, color: { ...c.color, lut: theme.lut } };
    }
    next = { ...next, clips: next.clips.map((x) => (x.id === c.id ? c : x)) };
    if (!c.text && prevAdjacent(next, c)) next = setTransition(next, c.id, theme.transition);
    const m = mediaOf(next, c.mediaId);
    if (theme.kenBurns && m?.kind === 'image' && !c.keyframes)
      next = kenBurns(next, c.id, kbCycle[photo++ % kbCycle.length]);
  }
  return next;
}

// ---------------- magic video ----------------

export interface MagicOptions {
  /** Photos and clips in the order they should play; an audio item becomes the music. */
  mediaIds: string[];
  /** Music (otherwise the first audio item of mediaIds, if any). */
  musicId?: string;
  themeId?: string;
  /** Opening title (none when empty). */
  title?: string;
  /** Target length in seconds (default 30). */
  duration?: number;
}
export const MAGIC_DEFAULT = 30;
export const MAGIC_MIN_SHOT = 1.5;
export const MAGIC_MAX_SHOT = 10;

/**
 * A first cut: the photos and clips one after the other on the bottom video track (after
 * whatever is already there), each with an even share of the target length (clips use their
 * middle part, never more than they have), with the theme's transitions, look and Ken Burns,
 * a fade from and to black, the title on top, and the music under it all, faded out at the
 * end and ducked whenever a clip has its own sound.
 */
export function magicVideo(
  p: VideoProject,
  opts: MagicOptions,
): { project: VideoProject; clipIds: string[]; duration: number } | null {
  const theme = themeOf(opts.themeId);
  const items = opts.mediaIds
    .map((id) => mediaOf(p, id))
    .filter((m): m is MediaItem => !!m && !m.missing);
  const visuals = items.filter((m) => m.kind === 'image' || (m.kind === 'video' && m.duration > 0));
  if (!visuals.length) return null;
  const music =
    (opts.musicId ? mediaOf(p, opts.musicId) : undefined) ?? items.find((m) => m.kind === 'audio');

  const target = Math.min(600, Math.max(5, opts.duration ?? MAGIC_DEFAULT));
  const share = Math.min(MAGIC_MAX_SHOT, Math.max(MAGIC_MIN_SHOT, target / visuals.length));
  // Clips shorter than their share give the rest to the photos.
  const shortClips = visuals.filter((m) => m.kind === 'video' && m.duration < share);
  const spare = shortClips.reduce((s, m) => s + (share - m.duration), 0);
  const photos = visuals.filter((m) => m.kind === 'image').length;
  const photoLen = Math.min(MAGIC_MAX_SHOT, share + (photos ? spare / photos : 0));

  let project = p;
  let track = compositeOrder(project).find((t) => !t.locked);
  if (!track) {
    project = addTrack(project, 'video');
    track = compositeOrder(project)[0]!;
  }
  const at = project.clips
    .filter((c) => c.trackId === track!.id)
    .reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const placed: Clip[] = [];
  let t = at;
  for (const m of visuals) {
    const len = m.kind === 'image' ? photoLen : Math.min(m.duration, share);
    const inPt = m.kind === 'image' ? 0 : Math.max(0, (m.duration - len) / 2);
    const c: Clip = {
      id: uid('c'),
      mediaId: m.id,
      trackId: track.id,
      start: r3(t),
      in: r3(inPt),
      out: r3(inPt + len),
      volume: 1,
    };
    placed.push(c);
    t += clipDur(c);
  }
  const end = t;
  const first = placed[0]!;
  const last = placed[placed.length - 1]!;
  first.fadeIn = Math.min(0.8, clipDur(first) / 3);
  last.fadeOut = Math.min(1.2, clipDur(last) / 3);
  project = { ...project, clips: [...project.clips, ...placed] };
  const ids = placed.map((c) => c.id);
  project = applyTheme(project, theme.id, ids);

  if (opts.title?.trim()) {
    const dur = Math.min(4, Math.max(2, clipDur(first)));
    const r = addTextClip(project, themeTitle(theme, opts.title.trim().slice(0, 200)), at, {
      dur,
      anim: theme.titleAnim,
    });
    project = r.project;
    ids.push(r.clip.id);
  }

  if (music && music.duration > 0) {
    const len = Math.min(music.duration, end - at);
    let aTrack = project.tracks.find(
      (x) =>
        x.kind === 'audio' &&
        !x.locked &&
        !project.clips.some((c) => c.trackId === x.id && c.start < at + len && clipEnd(c) > at),
    );
    if (!aTrack) {
      project = addTrack(project, 'audio');
      aTrack = project.tracks[project.tracks.length - 1]!;
    }
    const mc: Clip = {
      id: uid('c'),
      mediaId: music.id,
      trackId: aTrack.id,
      start: r3(at),
      in: 0,
      out: r3(len),
      volume: 0.8,
      fadeIn: Math.min(0.5, len / 4),
      fadeOut: Math.min(2, len / 4),
    };
    project = { ...project, clips: [...project.clips, mc] };
    ids.push(mc.id);
    if (visuals.some((m) => m.kind === 'video' && m.hasAudio))
      project = setTrackDuck(project, aTrack.id, theme.duck);
  }
  return { project, clipIds: ids, duration: end - at };
}

// ---------------- themes as files (Fase 11D) ----------------

/** Format version of a theme file (.zinarix/video-themes/*.json). 1 = the 11A shape. */
export const THEME_VERSION = 2;
export const THEME_MAX_BYTES = 64 * 1024;

const THEME_KEYS = [
  'id',
  'name',
  'version',
  'transition',
  'look',
  'fx',
  'title',
  'titleAnim',
  'kenBurns',
  'duck',
  'music',
  'lut',
] as const;
const TITLE_KEYS = ['font', 'size', 'color', 'bold', 'italic', 'align', 'stroke', 'shadow', 'bg'] as const;

/** A theme id from any name: lower-case letters, digits and dashes. */
export const themeSlug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tema';

/**
 * Reads a theme file (parsed JSON): fields it does not know are dropped, missing or wrong ones
 * take the "clean" theme's value, an old version is migrated. Null when it is not a theme at all
 * (not an object, or no name / id).
 */
export function parseThemeFile(x: unknown): VideoTheme | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const rawName = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : '';
  const rawId = typeof o.id === 'string' ? o.id : rawName;
  if (!rawId.trim()) return null;
  const def = VIDEO_THEMES[0]!;
  const version = typeof o.version === 'number' && Number.isFinite(o.version) ? o.version : 1;
  // v1 (11A, in code) had no name: the id was the name.
  const name = rawName || rawId.trim().slice(0, 60);
  const transition = validTransition(o.transition) && o.transition ? (o.transition as Transition) : def.transition;
  const look = typeof o.look === 'string' && LOOKS.some((l) => l.id === o.look) ? o.look : 'none';
  const fx = o.fx !== undefined && validEffects(o.fx) ? cleanEffects(o.fx as Effects) : undefined;
  const title: Partial<TextSpec> = {};
  if (o.title && typeof o.title === 'object' && !Array.isArray(o.title)) {
    const t = o.title as Record<string, unknown>;
    const probe = { ...TEXT_PRESETS.find((p) => p.id === 'title')!.spec } as TextSpec;
    for (const k of TITLE_KEYS) {
      if (t[k] === undefined) continue;
      const trial = { ...probe, [k]: t[k] } as TextSpec;
      if (validText(trial)) (title as Record<string, unknown>)[k] = t[k];
    }
  }
  const titleAnim = validAnim(o.titleAnim) && o.titleAnim ? { ...(o.titleAnim as ClipAnim) } : { ...def.titleAnim };
  const duck =
    typeof o.duck === 'number' && Number.isFinite(o.duck) ? Math.min(1, Math.max(0, o.duck)) : def.duck;
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 1024 && v.trim() ? v : undefined);
  const theme: VideoTheme = {
    id: themeSlug(rawId),
    name,
    version: THEME_VERSION,
    transition,
    look,
    title: Object.keys(title).length ? title : { ...def.title },
    titleAnim,
    kenBurns: typeof o.kenBurns === 'boolean' ? o.kenBurns : def.kenBurns,
    duck,
  };
  if (fx) theme.fx = fx;
  const music = str(o.music);
  const lut = str(o.lut);
  if (music) theme.music = music;
  if (lut && lut.toLowerCase().endsWith('.cube')) theme.lut = lut;
  if (version > THEME_VERSION) theme.version = THEME_VERSION;
  return theme;
}

/** What a theme file holds (known fields only, in a fixed order). */
export function themeToFile(t: VideoTheme): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const full = { ...t, version: THEME_VERSION, name: t.name ?? t.id };
  for (const k of THEME_KEYS) if (full[k] !== undefined) out[k] = full[k];
  return out;
}

/**
 * "Save current theme": the style of the project as it is now, taken from the selected clips
 * (or all of them): the first transition, the media clips' effects, the first title's style and
 * animation, whether photos carry Ken Burns, and the ducking level of a ducked track.
 */
export function themeFromProject(p: VideoProject, name: string, ids?: readonly string[]): VideoTheme {
  const pick = new Set(ids?.length ? ids : p.clips.map((c) => c.id));
  const clips = p.clips.filter((c) => pick.has(c.id)).sort((a, b) => a.start - b.start);
  const def = VIDEO_THEMES[0]!;
  const media = clips.filter((c) => !c.text && mediaOf(p, c.mediaId)?.kind !== 'audio');
  const tr = media.find((c) => c.transition)?.transition;
  const fx = cleanEffects(media.find((c) => c.effects)?.effects);
  const look = fx ? (LOOKS.find((l) => JSON.stringify(cleanEffects(l.fx)) === JSON.stringify(fx))?.id ?? 'none') : 'none';
  const t = clips.find((c) => c.text);
  const title: Partial<TextSpec> = {};
  if (t?.text) for (const k of TITLE_KEYS) if (t.text[k] !== undefined) (title as Record<string, unknown>)[k] = t.text[k];
  const photos = media.filter((c) => mediaOf(p, c.mediaId)?.kind === 'image');
  const ducked = p.tracks.find((x) => x.duck !== undefined);
  const lut = media.find((c) => c.color?.lut)?.color?.lut;
  const theme: VideoTheme = {
    id: themeSlug(name),
    name: name.trim().slice(0, 60) || 'Tema',
    version: THEME_VERSION,
    transition: tr ? { ...tr } : def.transition,
    look,
    title: Object.keys(title).length ? title : { ...def.title },
    titleAnim: t?.anim ? { ...t.anim } : { ...def.titleAnim },
    kenBurns: photos.length ? photos.some(hasKenBurns) : def.kenBurns,
    duck: ducked?.duck ?? def.duck,
  };
  if (fx && look === 'none') theme.fx = fx;
  if (lut) theme.lut = lut;
  return theme;
}
