/**
 * Zinarix Video Studio: the project model (pure and serializable) and the timeline edits.
 * Used by the renderer (editing, preview) and by the main process (export with FFmpeg).
 * Every edit returns a new project; nothing here touches the DOM, Electron or the disk.
 * Times are in seconds.
 */
import type { ClipAnim, Effects, Look, TextSpec, Transition } from './videoFx.js';
import type { ColorGrade } from './videoColor.js';
import { cleanGrade, validGrade } from './videoColor.js';
import type { MediaAnalysis } from './videoAnalysis.js';
import { validAnalysis } from './videoAnalysis.js';
import type { ChromaKey } from './videoOneClick.js';
import { validChroma } from './videoOneClick.js';
import type { Compressor, Eq4 } from './videoAudioFx.js';
import type { ExtraKeyProp, KeyedEffect } from './videoKeys.js';
import {
  BEZIER_DEFAULT,
  EXTRA_KEY_PROPS,
  KEYED_EFFECTS,
  KEY_RANGE,
  bezierLinear,
  bezierTable,
} from './videoKeys.js';
import {
  LOOK_NONE,
  TEXT_DEFAULT_DUR,
  TRANSITION_MAX,
  TRANSITION_MIN,
  animAt,
  cleanEffects,
  combine,
  transitionLook,
  validAnim,
  validEffects,
  validText,
  validTransition,
} from './videoFx.js';

export type MediaKind = 'video' | 'audio' | 'image';
export type TrackKind = 'video' | 'audio';

export interface MediaItem {
  id: string;
  /** Absolute path on disk (the .zvproj file stores it relative to the project). */
  path: string;
  name: string;
  kind: MediaKind;
  /** Seconds; images get IMAGE_DEFAULT when placed. */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Bytes, for the library. */
  size: number;
  /** File not found when the project was opened (relink it). */
  missing?: boolean;
  /**
   * Fase 14: the picture has an alpha channel. "vp9" (WebM) needs FFmpeg's libvpx decoder,
   * the built-in one drops the alpha; "native" (PNG, ProRes 4444, QuickTime RLE) decodes as is.
   */
  alpha?: 'vp9' | 'native';
  /** Fase 11C: what the analysis found (sound, scenes, still / blurry parts, beats). */
  analysis?: MediaAnalysis;
}

export interface Clip {
  id: string;
  mediaId: string;
  trackId: string;
  /** Where it starts on the timeline. */
  start: number;
  /** Source in/out points (seconds into the media). */
  in: number;
  out: number;
  /** 0–2 (1 = original). */
  volume: number;
  /** Playback speed (1 = original): the clip lasts (out - in) / speed on the timeline. */
  speed?: number;
  /** Position, size and look on the canvas (missing = centred, fitted, untouched). */
  transform?: Transform;
  /** Fade from/to black (video) and silence (audio), in timeline seconds. */
  fadeIn?: number;
  fadeOut?: number;
  /** Animated transform values. A property with keys ignores its static transform value. */
  keyframes?: Keyframes;
  /** Colour and blur effects (videoFx.ts). */
  effects?: Effects;
  /** Fase 12: colour grade (wheels, temperature, LUT), applied before the effects. */
  color?: ColorGrade;
  /** Entry / exit animation. */
  anim?: ClipAnim;
  /** Transition from the clip right before it on the track (or a reveal when there is none). */
  transition?: Transition;
  /** A title: the clip draws this text instead of a media file (mediaId is ''). */
  text?: TextSpec;
  /** Fase 11D: green screen (colorkey) and stabilisation (deshake, export). */
  chroma?: ChromaKey;
  stabilize?: boolean;
  /** Fase 12D: stereo balance of the clip, −1 (left) … 1 (right), on top of the track's. */
  pan?: number;
  /** Fase 12B: a second grade (B) and how much of it shows, 0 = only A (color) … 1 = only B. */
  colorB?: ColorGrade;
  gradeMix?: number;
  /** Fase 12D: the clip's own 4-band EQ (videoAudioFx.ts), before the track's. */
  eq?: Eq4;
  /** Fase 12E: a compound clip draws this sub-timeline instead of a media file (mediaId ''). */
  compound?: Compound;
  /** Fase 4B: this clip is one step of a speed ramp (videoRamp.ts); the steps share `group`. */
  ramp?: RampTag;
}

/** Fase 4B: which ramp a step belongs to and what the clip was before the ramp. */
export interface RampTag {
  group: string;
  /** Preset id, or 'custom'. */
  preset: string;
  /** The clip's speed before the ramp (restored when the ramp is removed). */
  base?: number;
}

/** A ramp tag as loaded from a file. */
export function validRampTag(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object') return false;
  const r = x as RampTag;
  return (
    typeof r.group === 'string' &&
    r.group.length <= 64 &&
    typeof r.preset === 'string' &&
    r.preset.length <= 64 &&
    (r.base === undefined || (Number.isFinite(r.base) && r.base > 0 && r.base <= 16))
  );
}

/** Fase 12E: a sub-timeline inside a clip (its media live in the project's media list). */
export interface Compound {
  name: string;
  tracks: Track[];
  clips: Clip[];
  /** Seconds (the end of its last clip when it was made). */
  duration: number;
}
/** Compounds inside compounds, at most this deep. */
export const COMPOUND_MAX_DEPTH = 4;

export const isText = (c: Clip): boolean => !!c.text;

/** Transform properties that can be animated (the flips are on/off, not animated). */
export type KeyProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';
export const KEY_PROPS: readonly KeyProp[] = ['x', 'y', 'scale', 'rotation', 'opacity'];
/** How a key moves to the next one: straight, smooth start and end, or a jump at the next key. */
export type Ease = 'linear' | 'ease' | 'in' | 'out' | 'back' | 'hold' | 'bezier';
export const EASES: readonly Ease[] = ['linear', 'ease', 'in', 'out', 'back', 'hold', 'bezier'];
/** Fase 12B: transform properties plus volume, pan, effects and the A/B grade mix. */
export type AnyKeyProp = KeyProp | ExtraKeyProp;
export const ANY_KEY_PROPS: readonly AnyKeyProp[] = [
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  ...EXTRA_KEY_PROPS,
];
export { BEZIER_DEFAULT, KEY_RANGE };
export type { ExtraKeyProp };

/** Overshoot of 'back' (the classic 1.70158). */
export const BACK_S = 1.70158;

/**
 * The eased progress (0→1, 'back' overshoots past 1) of a segment at progress k (0…1).
 * 'in', 'out' and 'back' are easeInCubic, easeOutCubic and easeOutBack as in Motion Canvas
 * (MIT, © 2022 motion-canvas, vendor/motion-canvas/packages/core/src/tweening/timingFunctions.ts).
 * All are polynomials so the export (videoRender's easeExpr) draws the exact same curve.
 */
export function easeCurve(e: Ease | undefined, k: number): number {
  switch (e) {
    case 'ease':
      return k * k * (3 - 2 * k);
    case 'in':
      return k * k * k;
    case 'out':
      return 1 - (1 - k) ** 3;
    case 'back':
      return 1 + (BACK_S + 1) * (k - 1) ** 3 + BACK_S * (k - 1) ** 2;
    default:
      return k;
  }
}

export interface Keyframe {
  /**
   * Seconds into the source media (not the timeline): keys stay on the same picture when the
   * clip is moved, trimmed, split or sped up.
   */
  t: number;
  v: number;
  /** Towards the next key (default linear). */
  ease?: Ease;
  /** 'bezier': the two control points, as in CSS cubic-bezier (x within 0…1). */
  cx1?: number;
  cy1?: number;
  cx2?: number;
  cy2?: number;
}
export type Keyframes = Partial<Record<AnyKeyProp, Keyframe[]>>;
/** Per property: plenty for hand animation, and it bounds the export expressions. */
export const MAX_KEYS = 100;

export interface Transform {
  /** Offset of the centre, as a fraction of the canvas width / height (0 = centred). */
  x: number;
  y: number;
  /** Size relative to "fit inside the canvas" (1 = fitted). */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0–1. */
  opacity: number;
  flipH: boolean;
  flipV: boolean;
}

export const IDENTITY: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  flipH: false,
  flipV: false,
};
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

export const speedOf = (c: Clip): number => c.speed ?? 1;
export const transformOf = (c: Clip): Transform => ({ ...IDENTITY, ...c.transform });

/** Seconds into the source at timeline time t. */
export const sourceAt = (c: Clip, t: number): number => c.in + (t - c.start) * speedOf(c);

/** 0–1 fade factor at timeline time t (1 = fully visible / audible). */
export function fadeAt(c: Clip, t: number): number {
  const into = t - c.start;
  const left = clipEnd(c) - t;
  let k = 1;
  if (c.fadeIn && c.fadeIn > 0) k = Math.min(k, into / c.fadeIn);
  if (c.fadeOut && c.fadeOut > 0) k = Math.min(k, left / c.fadeOut);
  return Math.max(0, Math.min(1, k));
}

/** Timeline time of a key of a clip. */
export const keyTimeline = (c: Clip, k: Keyframe): number => c.start + (k.t - c.in) / speedOf(c);

/** Value of sorted keys at source time `src` (held before the first and after the last). */
export function interpKeys(keys: readonly Keyframe[], src: number): number {
  const first = keys[0]!;
  if (keys.length === 1 || src <= first.t) return first.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (src >= b.t) continue;
    if (a.ease === 'hold' || b.t - a.t < 1e-9) return a.v;
    const x = (src - a.t) / (b.t - a.t);
    // Bezier: the same straight pieces the export draws (videoKeys.expandBezier).
    const k = a.ease === 'bezier' ? bezierLinear(bezierTable(a), x) : easeCurve(a.ease, x);
    return a.v + (b.v - a.v) * k;
  }
  return keys[keys.length - 1]!.v;
}

export const isAnimated = (c: Clip, prop: AnyKeyProp): boolean => !!c.keyframes?.[prop]?.length;
export const hasKeyframes = (c: Clip): boolean => ANY_KEY_PROPS.some((k) => isAnimated(c, k));

/** The value a non-transform property has when it is not animated. */
function staticExtra(c: Clip, prop: ExtraKeyProp): number {
  switch (prop) {
    case 'volume':
      return c.volume;
    case 'pan':
      return c.pan ?? 0;
    case 'gradeMix':
      return c.gradeMix ?? 0;
    default:
      return c.effects?.[prop] ?? 0;
  }
}

/** Any animatable property of a clip at timeline time t (keys evaluated, clamped to its range). */
export function propAt(c: Clip, prop: AnyKeyProp, t: number): number {
  if ((KEY_PROPS as readonly string[]).includes(prop)) return transformAt(c, t)[prop as KeyProp];
  const keys = c.keyframes?.[prop];
  const v = keys?.length ? interpKeys(keys, sourceAt(c, t)) : staticExtra(c, prop as ExtraKeyProp);
  const [lo, hi] = KEY_RANGE[prop]!;
  return Math.min(hi, Math.max(lo, v));
}

/** The clip's effects at timeline time t (animated ones evaluated). */
export function effectsAt(c: Clip, t: number): Effects | undefined {
  if (!KEYED_EFFECTS.some((k) => isAnimated(c, k))) return c.effects;
  const fx: Effects = { ...c.effects };
  for (const k of KEYED_EFFECTS) if (isAnimated(c, k)) fx[k] = propAt(c, k, t);
  return fx;
}
export const volumeAt = (c: Clip, t: number): number => propAt(c, 'volume', t);
export const panAt = (c: Clip, t: number): number => propAt(c, 'pan', t);
/** How much of grade B shows at t (0 when the clip has no B). */
export const gradeMixAt = (c: Clip, t: number): number => (c.colorB ? propAt(c, 'gradeMix', t) : 0);

/** The clip's transform at timeline time t, with its animated properties evaluated. */
export function transformAt(c: Clip, t: number): Transform {
  const tr = transformOf(c);
  if (!c.keyframes) return tr;
  const src = sourceAt(c, t);
  for (const prop of KEY_PROPS) {
    const keys = c.keyframes[prop];
    if (keys?.length) tr[prop] = interpKeys(keys, src);
  }
  // 'back' overshoots: keep opacity and scale where the export keeps them.
  tr.opacity = Math.max(0, Math.min(1, tr.opacity));
  tr.scale = Math.max(0.01, tr.scale);
  return tr;
}

/** Timeline times of all the clip's keys inside the clip, sorted, without duplicates. */
export function keyTimes(c: Clip): number[] {
  const out: number[] = [];
  for (const prop of ANY_KEY_PROPS)
    for (const k of c.keyframes?.[prop] ?? []) {
      const t = keyTimeline(c, k);
      if (t >= c.start - 1e-6 && t <= clipEnd(c) + 1e-6) out.push(t);
    }
  out.sort((a, b) => a - b);
  return out.filter((t, i) => i === 0 || t - out[i - 1]! > 1e-6);
}

/** The key of a property at timeline time t (within half a frame), if any. */
export function keyAt(c: Clip, prop: AnyKeyProp, t: number, fps: number): Keyframe | undefined {
  const src = sourceAt(c, t);
  const tol = (0.5 / fps) * speedOf(c);
  return c.keyframes?.[prop]?.find((k) => Math.abs(k.t - src) < tol);
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  locked: boolean;
  hidden: boolean;
  /** Mixer: 0–2 (missing = 1), −1 (left) … 1 (right); only soloed tracks are heard. */
  volume?: number;
  pan?: number;
  solo?: boolean;
  /** Ducking: 0–1, the level this track drops to while a voice plays elsewhere (missing = off). */
  duck?: number;
  /** Fase 13: the track automatic captions go to (its titles are replaced when they are redone). */
  role?: 'captions';
  /** Fase 11B: duck only where the other clips really have sound (their analysis), not all along. */
  duckSound?: boolean;
  /** Fase 12D: 4-band EQ and compressor of the track (videoAudioFx.ts). */
  eq?: Eq4;
  comp?: Compressor;
}

/** Fase 13: a transcribed word, in seconds of the media file. */
export interface TranscriptWord {
  s: number;
  e: number;
  w: string;
  /** Engine confidence 0–1, when it gives one. */
  p?: number;
}

export interface Transcript {
  /** 'whisper.cpp', 'openai/whisper-1'… */
  engine: string;
  lang?: string;
  words: TranscriptWord[];
  /** When it was made (ms since 1970). */
  at: number;
}
export const TRANSCRIPT_MAX_WORDS = 100_000;

export interface Marker {
  id: string;
  time: number;
  name: string;
  color: string;
}

export interface VideoProject {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Display order, top to bottom: video tracks (V3, V2, V1) then audio tracks (A1, A2…). */
  tracks: Track[];
  clips: Clip[];
  media: MediaItem[];
  markers: Marker[];
  inPoint: number | null;
  outPoint: number | null;
  /** Fase 13: transcripts by media id. */
  transcripts?: Record<string, Transcript>;
}

export const IMAGE_DEFAULT = 5;
export const MIN_CLIP = 1 / 30;
export const MEDIA_EXTENSIONS = {
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'],
  audio: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'],
} as const;
export const PROJECT_EXT = 'zvproj';

export function mediaKindOf(path: string): MediaKind | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  for (const k of ['video', 'audio', 'image'] as const)
    if ((MEDIA_EXTENSIONS[k] as readonly string[]).includes(ext)) return k;
  return null;
}

export interface FormatPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

/** Aspect templates at 1080p; the resolution picker scales them. */
export const FORMAT_PRESETS: FormatPreset[] = [
  { id: '16:9', label: '16:9 · YouTube', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16 · TikTok / Reels / Shorts', width: 1080, height: 1920 },
  { id: '1:1', label: '1:1 · Instagram', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5 · Instagram', width: 1080, height: 1350 },
  { id: '21:9', label: '21:9 · Cine', width: 2560, height: 1080 },
];
export const FPS_CHOICES = [24, 25, 30, 50, 60];
/** Short side in pixels. */
export const RESOLUTIONS = [
  { id: '720p', short: 720 },
  { id: '1080p', short: 1080 },
  { id: '1440p', short: 1440 },
  { id: '4K', short: 2160 },
];

/** Scales an aspect so its short side is `short` (even numbers, as encoders need). */
export function sizeFor(
  aspectW: number,
  aspectH: number,
  short: number,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return aspectW >= aspectH
    ? { width: even((aspectW / aspectH) * short), height: even(short) }
    : { width: even(short), height: even((aspectH / aspectW) * short) };
}

let seq = 0;
export function uid(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newProject(
  opts: Partial<Pick<VideoProject, 'name' | 'width' | 'height' | 'fps'>> = {},
): VideoProject {
  const track = (kind: TrackKind, name: string): Track => ({
    id: uid('t'),
    kind,
    name,
    muted: false,
    locked: false,
    hidden: false,
  });
  return {
    version: 1,
    name: opts.name ?? 'Proyecto sin título',
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    fps: opts.fps ?? 30,
    tracks: [
      track('video', 'V2'),
      track('video', 'V1'),
      track('audio', 'A1'),
      track('audio', 'A2'),
    ],
    clips: [],
    media: [],
    markers: [],
    inPoint: null,
    outPoint: null,
  };
}

/** Length on the timeline (the source part divided by the speed). */
export const clipDur = (c: Clip): number => (c.out - c.in) / speedOf(c);
export const clipEnd = (c: Clip): number => c.start + clipDur(c);

export function projectDuration(p: VideoProject): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** Video tracks bottom-up (V1 first): the order they are composited in. */
export function compositeOrder(p: VideoProject): Track[] {
  return p.tracks.filter((t) => t.kind === 'video').reverse();
}

export function trackOf(p: VideoProject, id: string): Track | undefined {
  return p.tracks.find((t) => t.id === id);
}
export function mediaOf(p: VideoProject, id: string): MediaItem | undefined {
  return p.media.find((m) => m.id === id);
}

/** Clips of a track sorted by start. */
export function trackClips(p: VideoProject, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

/** Whether [start, end) is free on a track (ignoring some clips, e.g. the ones being moved). */
export function fits(
  p: VideoProject,
  trackId: string,
  start: number,
  end: number,
  ignore: ReadonlySet<string> = new Set(),
): boolean {
  if (start < -1e-6) return false;
  const eps = 1e-6;
  return !p.clips.some(
    (c) =>
      c.trackId === trackId && !ignore.has(c.id) && start < clipEnd(c) - eps && end > c.start + eps,
  );
}

/** Which kind of track a media item goes on. */
export function trackKindFor(m: MediaItem): TrackKind {
  return m.kind === 'audio' ? 'audio' : 'video';
}

/** Adds a new track of a kind (video tracks go on top, audio tracks at the bottom). */
export function addTrack(p: VideoProject, kind: TrackKind): VideoProject {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const t: Track = {
    id: uid('t'),
    kind,
    name: `${kind === 'video' ? 'V' : 'A'}${n}`,
    muted: false,
    locked: false,
    hidden: false,
  };
  return { ...p, tracks: kind === 'video' ? [t, ...p.tracks] : [...p.tracks, t] };
}

export function removeTrack(p: VideoProject, trackId: string): VideoProject {
  const t = trackOf(p, trackId);
  if (!t || p.tracks.filter((x) => x.kind === t.kind).length <= 1) return p;
  return {
    ...p,
    tracks: p.tracks.filter((x) => x.id !== trackId),
    clips: p.clips.filter((c) => c.trackId !== trackId),
  };
}

export function updateTrack(
  p: VideoProject,
  trackId: string,
  patch: Partial<Omit<Track, 'id' | 'kind'>>,
): VideoProject {
  return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) };
}

/**
 * Places a media item on a track at `start` (or at the end of the track). When the spot is taken
 * it goes on the first free track of the same kind, creating one if needed.
 */
export function insertMedia(
  p: VideoProject,
  media: MediaItem,
  at?: { trackId?: string; start?: number; duration?: number },
): { project: VideoProject; clip: Clip | null } {
  if (media.missing) return { project: p, clip: null };
  const kind = trackKindFor(media);
  // Fase 10B: an asked length (a picture held longer, a voice trimmed); video and audio never
  // run past the end of their file.
  const asked = at?.duration !== undefined && at.duration > 0 ? at.duration : undefined;
  const dur =
    media.kind === 'image'
      ? (asked ?? IMAGE_DEFAULT)
      : asked !== undefined
        ? Math.min(asked, media.duration)
        : media.duration;
  if (!(dur > 0)) return { project: p, clip: null };
  let project = p;
  const candidates = [
    ...(at?.trackId ? project.tracks.filter((t) => t.id === at.trackId && t.kind === kind) : []),
    ...compositeOrderOrAudio(project, kind).filter((t) => t.id !== at?.trackId),
  ].filter((t) => !t.locked);
  const startFor = (t: Track) =>
    at?.start ?? trackClips(project, t.id).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  let track = candidates.find((t) => fits(project, t.id, startFor(t), startFor(t) + dur));
  if (!track) {
    project = addTrack(project, kind);
    track = kind === 'video' ? project.tracks[0]! : project.tracks[project.tracks.length - 1]!;
  }
  const clip: Clip = {
    id: uid('c'),
    mediaId: media.id,
    trackId: track.id,
    start: Math.max(0, startFor(track)),
    in: 0,
    out: dur,
    volume: 1,
  };
  return { project: { ...project, clips: [...project.clips, clip] }, clip };
}

function compositeOrderOrAudio(p: VideoProject, kind: TrackKind): Track[] {
  return kind === 'video' ? compositeOrder(p) : p.tracks.filter((t) => t.kind === 'audio');
}

/**
 * Splits clips at `time`. With ids, only those; otherwise every clip under the playhead on an
 * unlocked track. Returns the ids of the right-hand halves too.
 */
export function splitAt(
  p: VideoProject,
  time: number,
  ids?: ReadonlySet<string>,
): { project: VideoProject; created: string[] } {
  const created: string[] = [];
  const clips: Clip[] = [];
  for (const c of p.clips) {
    const t = trackOf(p, c.trackId);
    const hit = time > c.start + MIN_CLIP && time < clipEnd(c) - MIN_CLIP;
    if (!hit || t?.locked || (ids && ids.size && !ids.has(c.id))) {
      clips.push(c);
      continue;
    }
    const cut = sourceAt(c, time);
    // The fades stay at the outer ends: the left half keeps the fade in, the right the fade out.
    // So do the animations; the transition stays on the left half (it joins the previous clip).
    const right: Clip = {
      ...c,
      id: uid('c'),
      start: time,
      in: cut,
      fadeIn: undefined,
      transition: undefined,
      anim: c.anim && { out: c.anim.out, outD: c.anim.outD },
    };
    const left: Clip = {
      ...c,
      out: cut,
      fadeOut: undefined,
      anim: c.anim && { in: c.anim.in, inD: c.anim.inD },
    };
    clips.push(left, right);
    created.push(right.id);
  }
  return { project: created.length ? { ...p, clips } : p, created };
}

/**
 * Deletes clips. Ripple closes the gap each one leaves on its own track (later clips on that
 * track move left by its length when nothing blocks them).
 */
export function removeClips(
  p: VideoProject,
  ids: ReadonlySet<string>,
  ripple = false,
): VideoProject {
  const gone = p.clips.filter((c) => ids.has(c.id) && !trackOf(p, c.trackId)?.locked);
  if (!gone.length) return p;
  const goneIds = new Set(gone.map((c) => c.id));
  let clips = p.clips.filter((c) => !goneIds.has(c.id));
  if (ripple) {
    // Latest first, so the shifts of earlier gaps add up correctly.
    for (const g of [...gone].sort((a, b) => b.start - a.start)) {
      const len = clipDur(g);
      clips = clips.map((c) =>
        c.trackId === g.trackId && c.start >= clipEnd(g) - 1e-6
          ? { ...c, start: Math.max(0, c.start - len) }
          : c,
      );
    }
  }
  return { ...p, clips };
}

/**
 * Moves clips by `delta` seconds and `trackShift` tracks (of the same kind). Refused (returns
 * null) when any clip would overlap another, leave its kind of track or start before 0.
 */
export function moveClips(
  p: VideoProject,
  ids: ReadonlySet<string>,
  delta: number,
  trackShift = 0,
): VideoProject | null {
  const moving = p.clips.filter((c) => ids.has(c.id));
  if (!moving.length) return p;
  const next = new Map<string, Clip>();
  for (const c of moving) {
    const tr = trackOf(p, c.trackId);
    if (!tr || tr.locked) return null;
    const same = p.tracks.filter((t) => t.kind === tr.kind);
    const target = same[same.indexOf(tr) + trackShift];
    if (!target || target.locked) return null;
    next.set(c.id, { ...c, start: c.start + delta, trackId: target.id });
  }
  const moved = { ...p, clips: p.clips.map((c) => next.get(c.id) ?? c) };
  for (const c of next.values())
    if (!fits(moved, c.trackId, c.start, clipEnd(c), new Set([c.id]))) return null;
  // Moved clips must not overlap each other either.
  const list = [...next.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (a.trackId === b.trackId && a.start < clipEnd(b) - 1e-6 && clipEnd(a) > b.start + 1e-6)
        return null;
    }
  return moved;
}

/**
 * Trims a clip's left or right edge to timeline time `to`, within the media and the free room
 * next to it. Images and still media have no source limit.
 */
export function trimClip(
  p: VideoProject,
  id: string,
  edge: 'left' | 'right',
  to: number,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c || trackOf(p, c.trackId)?.locked) return p;
  const m = mediaOf(p, c.mediaId);
  const unlimited = m?.kind === 'image' || isText(c);
  const sp = speedOf(c);
  const siblings = trackClips(p, c.trackId).filter((x) => x.id !== id);
  let next: Clip;
  if (edge === 'left') {
    const prevEnd = siblings
      .filter((x) => clipEnd(x) <= c.start + 1e-6)
      .reduce((mx, x) => Math.max(mx, clipEnd(x)), 0);
    const minStart = Math.max(prevEnd, unlimited ? 0 : c.start - c.in / sp);
    const start = Math.min(Math.max(to, minStart), clipEnd(c) - MIN_CLIP);
    next = { ...c, start, in: sourceAt(c, start) };
    if (unlimited && next.in < 0)
      next = { ...shiftKeys(next, -next.in), out: next.out - next.in, in: 0 };
  } else {
    const nextStart = siblings
      .filter((x) => x.start >= clipEnd(c) - 1e-6)
      .reduce((mn, x) => Math.min(mn, x.start), Infinity);
    const maxEnd = Math.min(
      nextStart,
      unlimited ? Infinity : c.start + ((m?.duration ?? c.out) - c.in) / sp,
    );
    const end = Math.max(Math.min(to, maxEnd), c.start + MIN_CLIP);
    next = { ...c, out: sourceAt(c, end) };
  }
  return { ...p, clips: p.clips.map((x) => (x.id === id ? next : x)) };
}

/** Moves every key by `d` source seconds (when a clip's source timing is renumbered). */
function shiftKeys(c: Clip, d: number): Clip {
  if (!c.keyframes) return c;
  const kf: Keyframes = {};
  for (const prop of ANY_KEY_PROPS) {
    const keys = c.keyframes[prop];
    if (keys) kf[prop] = keys.map((k) => ({ ...k, t: k.t + d }));
  }
  return { ...c, keyframes: kf };
}

export function updateClip(
  p: VideoProject,
  id: string,
  patch: Partial<Omit<Clip, 'id'>>,
): VideoProject {
  return { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/**
 * Changes a clip's speed keeping its start and its source in-point. Slower clips get longer:
 * when the next clip on the track is in the way, the source out-point is cut so it still fits.
 */
export function setClipSpeed(p: VideoProject, id: string, speed: number): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c || trackOf(p, c.trackId)?.locked || !Number.isFinite(speed)) return p;
  const sp = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  const nextStart = trackClips(p, c.trackId)
    .filter((x) => x.id !== id && x.start >= c.start + 1e-6)
    .reduce((mn, x) => Math.min(mn, x.start), Infinity);
  const room = nextStart - c.start;
  const out = (c.out - c.in) / sp > room + 1e-6 ? c.in + room * sp : c.out;
  if (out - c.in < MIN_CLIP) return p;
  return updateClip(p, id, { speed: sp === 1 ? undefined : sp, out });
}

/** Sets transform fields (a transform equal to the identity is dropped from the file). */
export function setTransform(p: VideoProject, id: string, patch: Partial<Transform>): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const t = { ...transformOf(c), ...patch };
  const same = (Object.keys(IDENTITY) as (keyof Transform)[]).every((k) => t[k] === IDENTITY[k]);
  return updateClip(p, id, { transform: same ? undefined : t });
}

function withKeys(c: Clip, prop: AnyKeyProp, keys: Keyframe[]): Clip {
  const kf: Keyframes = { ...c.keyframes };
  if (keys.length) kf[prop] = keys;
  else delete kf[prop];
  return { ...c, keyframes: ANY_KEY_PROPS.some((k) => kf[k]?.length) ? kf : undefined };
}

function staticValue(c: Clip, prop: AnyKeyProp, v: number): Clip {
  if (!(KEY_PROPS as readonly string[]).includes(prop)) {
    const [lo, hi] = KEY_RANGE[prop]!;
    const x = Math.min(hi, Math.max(lo, v));
    if (prop === 'volume') return { ...c, volume: x };
    if (prop === 'pan') return withOptional(c, 'pan', Math.abs(x) < 1e-4 ? undefined : x);
    if (prop === 'gradeMix') return withOptional(c, 'gradeMix', x < 1e-4 ? undefined : x);
    const effects = cleanEffects({ ...c.effects, [prop as KeyedEffect]: x });
    const next = { ...c, effects };
    if (!effects) delete next.effects;
    return next;
  }
  const t = { ...transformOf(c), [prop]: v };
  const same = (Object.keys(IDENTITY) as (keyof Transform)[]).every((k) => t[k] === IDENTITY[k]);
  return { ...c, transform: same ? undefined : t };
}

function withOptional<K extends 'pan' | 'gradeMix'>(c: Clip, k: K, v: number | undefined): Clip {
  const next = { ...c };
  if (v === undefined) delete next[k];
  else next[k] = v;
  return next;
}

const replaceClip = (p: VideoProject, c: Clip): VideoProject => ({
  ...p,
  clips: p.clips.map((x) => (x.id === c.id ? c : x)),
});

/**
 * Adds a key (or changes the one already there) for a property at timeline time t. Without a
 * value it takes the current one, so adding a key changes nothing until it is edited.
 */
export function setKey(
  p: VideoProject,
  id: string,
  prop: AnyKeyProp,
  t: number,
  v?: number,
  ease?: Ease,
  bezier?: [number, number, number, number],
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c || trackOf(p, c.trackId)?.locked) return p;
  const at = Math.min(Math.max(t, c.start), clipEnd(c));
  const value = v ?? propAt(c, prop, at);
  if (!Number.isFinite(value)) return p;
  const old = keyAt(c, prop, at, p.fps);
  const keys = (c.keyframes?.[prop] ?? []).filter((k) => k !== old);
  if (!old && keys.length >= MAX_KEYS) return p;
  const key: Keyframe = { t: old?.t ?? sourceAt(c, at), v: value };
  const e = ease ?? old?.ease;
  if (e && e !== 'linear') key.ease = e;
  if (e === 'bezier') {
    const prev: [number, number, number, number] | null =
      old?.ease === 'bezier' && old.cx1 !== undefined
        ? [old.cx1, old.cy1 ?? 0, old.cx2 ?? 1, old.cy2 ?? 1]
        : null;
    const [cx1, cy1, cx2, cy2] = bezier ?? prev ?? BEZIER_DEFAULT;
    Object.assign(key, { cx1, cy1, cx2, cy2 });
  }
  keys.push(key);
  keys.sort((a, b) => a.t - b.t);
  return replaceClip(p, withKeys(c, prop, keys));
}

/** Removes a property's key at timeline time t (the last one leaves its value as the static one). */
export function removeKey(p: VideoProject, id: string, prop: AnyKeyProp, t: number): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  const old = c && keyAt(c, prop, t, p.fps);
  if (!c || !old || trackOf(p, c.trackId)?.locked) return p;
  const keys = (c.keyframes?.[prop] ?? []).filter((k) => k !== old);
  const next = withKeys(c, prop, keys);
  return replaceClip(p, keys.length ? next : staticValue(next, prop, old.v));
}

/** Stops animating a property: it keeps the value it has at timeline time t. */
export function clearKeys(p: VideoProject, id: string, prop: AnyKeyProp, t: number): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c || !isAnimated(c, prop) || trackOf(p, c.trackId)?.locked) return p;
  return replaceClip(p, staticValue(withKeys(c, prop, []), prop, propAt(c, prop, t)));
}

/**
 * Fase 12B: what a control of any animatable property calls. Animated: a key at timeline time
 * t; otherwise its static value changes.
 */
export function editPropAt(
  p: VideoProject,
  id: string,
  prop: AnyKeyProp,
  v: number,
  t: number,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c || !Number.isFinite(v) || trackOf(p, c.trackId)?.locked) return p;
  if (isAnimated(c, prop)) return setKey(p, id, prop, t, v);
  if ((KEY_PROPS as readonly string[]).includes(prop))
    return setTransform(p, id, { [prop]: v } as Partial<Transform>);
  return replaceClip(p, staticValue(c, prop, v));
}

/**
 * Moves one key to another timeline time (dragged on the key lane), within the clip; refused
 * (unchanged) when another key of the property already sits there.
 */
export function moveKey(
  p: VideoProject,
  id: string,
  prop: AnyKeyProp,
  from: number,
  to: number,
  v?: number,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  const old = c && keyAt(c, prop, from, p.fps);
  if (!c || !old || trackOf(p, c.trackId)?.locked) return p;
  const at = Math.min(Math.max(to, c.start), clipEnd(c));
  const src = sourceAt(c, at);
  const rest = (c.keyframes?.[prop] ?? []).filter((k) => k !== old);
  if (rest.some((k) => Math.abs(k.t - src) < (0.5 / p.fps) * speedOf(c))) return p;
  const [lo, hi] = KEY_RANGE[prop]!;
  const moved: Keyframe = {
    ...old,
    t: src,
    v: v === undefined || !Number.isFinite(v) ? old.v : Math.min(hi, Math.max(lo, v)),
  };
  return replaceClip(
    p,
    withKeys(
      c,
      prop,
      [...rest, moved].sort((a, b) => a.t - b.t),
    ),
  );
}

/** Copies a property's keys (times relative to the first key, in source seconds). */
export function copyKeys(c: Clip, prop: AnyKeyProp): Keyframe[] {
  const keys = c.keyframes?.[prop] ?? [];
  const t0 = keys[0]?.t ?? 0;
  return keys.map((k) => ({ ...k, t: k.t - t0 }));
}

/**
 * Pastes copied keys onto a clip so the first lands at timeline time `at` (they replace the
 * property's keys; the ones past the clip's end are dropped).
 */
export function pasteKeys(
  p: VideoProject,
  id: string,
  prop: AnyKeyProp,
  keys: readonly Keyframe[],
  at: number,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c || !keys.length || trackOf(p, c.trackId)?.locked) return p;
  const base = sourceAt(c, Math.min(Math.max(at, c.start), clipEnd(c)));
  const [lo, hi] = KEY_RANGE[prop]!;
  const end = sourceAt(c, clipEnd(c)) + 1e-6;
  const next = keys
    .filter((k) => Number.isFinite(k.t) && Number.isFinite(k.v))
    .map((k) => ({ ...k, t: base + k.t, v: Math.min(hi, Math.max(lo, k.v)) }))
    .filter((k) => k.t <= end)
    .slice(0, MAX_KEYS)
    .sort((a, b) => a.t - b.t);
  return next.length ? replaceClip(p, withKeys(c, prop, next)) : p;
}

/**
 * What the Inspector controls call: animated properties get a key at timeline time t, the rest
 * change their static value.
 */
export function editTransformAt(
  p: VideoProject,
  id: string,
  patch: Partial<Transform>,
  t: number,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  let next = p;
  const rest: Partial<Transform> = {};
  for (const k of Object.keys(patch) as (keyof Transform)[]) {
    const v = patch[k];
    if (v === undefined) continue;
    if (k !== 'flipH' && k !== 'flipV' && isAnimated(c, k))
      next = setKey(next, id, k, t, v as number);
    else Object.assign(rest, { [k]: v });
  }
  return Object.keys(rest).length ? setTransform(next, id, rest) : next;
}

/** Back to the untouched picture: no transform and no keys. */
export function resetTransform(p: VideoProject, id: string): VideoProject {
  return updateClip(p, id, { transform: undefined, keyframes: undefined });
}

/** Sets fade lengths, kept within the clip (both together at most its length). */
export function setFades(
  p: VideoProject,
  id: string,
  fades: { fadeIn?: number; fadeOut?: number },
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const len = clipDur(c);
  let fin = Math.max(0, fades.fadeIn ?? c.fadeIn ?? 0);
  let fout = Math.max(0, fades.fadeOut ?? c.fadeOut ?? 0);
  if ('fadeIn' in fades) fin = Math.min(fin, len - fout);
  else fout = Math.min(fout, len - fin);
  return updateClip(p, id, {
    fadeIn: fin > 1e-3 ? fin : undefined,
    fadeOut: fout > 1e-3 ? fout : undefined,
  });
}

/** Copies clips (with new ids) so the earliest starts at `at`, on the same tracks when free. */
export function pasteClips(
  p: VideoProject,
  copied: Clip[],
  at: number,
): { project: VideoProject; ids: string[] } {
  if (!copied.length) return { project: p, ids: [] };
  const first = Math.min(...copied.map((c) => c.start));
  const fresh = copied
    .filter((c) => trackOf(p, c.trackId) && (isText(c) || mediaOf(p, c.mediaId)))
    .map((c) => ({ ...c, id: uid('c'), start: at + (c.start - first) }));
  let project = { ...p, clips: [...p.clips, ...fresh] };
  for (const c of fresh) {
    if (fits(project, c.trackId, c.start, clipEnd(c), new Set([c.id]))) continue;
    // Taken: drop it in a new track of that kind.
    const kind = trackOf(project, c.trackId)!.kind;
    project = addTrack(project, kind);
    const t = kind === 'video' ? project.tracks[0]! : project.tracks[project.tracks.length - 1]!;
    project = updateClip(project, c.id, { trackId: t.id });
  }
  return { project, ids: fresh.map((c) => c.id) };
}

/** Edit points the playhead, a dragged clip or a trim can snap to. */
export function snapPoints(
  p: VideoProject,
  playhead: number,
  ignore: ReadonlySet<string> = new Set(),
): number[] {
  const pts = [0, playhead];
  for (const c of p.clips) if (!ignore.has(c.id)) pts.push(c.start, clipEnd(c));
  for (const m of p.markers) pts.push(m.time);
  if (p.inPoint != null) pts.push(p.inPoint);
  if (p.outPoint != null) pts.push(p.outPoint);
  return pts;
}

/** The closest point within `threshold`, or null. */
export function snap(value: number, points: number[], threshold: number): number | null {
  let best: number | null = null;
  let dist = threshold;
  for (const pt of points) {
    const d = Math.abs(pt - value);
    if (d <= dist) {
      dist = d;
      best = pt;
    }
  }
  return best;
}

export function addMarker(
  p: VideoProject,
  time: number,
  name = '',
  color = '#e5b33a',
): VideoProject {
  return {
    ...p,
    markers: [...p.markers, { id: uid('m'), time, name, color }].sort((a, b) => a.time - b.time),
  };
}

/** Clip of a track under time t (half-open: a clip ending at t is not under it). */
export function clipAt(p: VideoProject, trackId: string, t: number): Clip | undefined {
  return p.clips.find((c) => c.trackId === trackId && t >= c.start && t < clipEnd(c));
}

/** Frame-accurate timecode HH:MM:SS:FF. */
export function timecode(t: number, fps: number): string {
  const total = Math.max(0, Math.round(t * fps));
  const f = total % fps;
  const s = Math.floor(total / fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

/** Snaps a time to the project's frame grid. */
export function toFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

function validKeyframes(kf: unknown): boolean {
  if (kf === undefined) return true;
  if (!kf || typeof kf !== 'object' || Array.isArray(kf)) return false;
  return Object.entries(kf).every(
    ([prop, keys]: [string, unknown]) =>
      (ANY_KEY_PROPS as readonly string[]).includes(prop) &&
      (keys === undefined ||
        (Array.isArray(keys) &&
          keys.length <= MAX_KEYS &&
          keys.every(
            (k: Keyframe, i: number) =>
              !!k &&
              Number.isFinite(k.t) &&
              Number.isFinite(k.v) &&
              (k.ease === undefined || EASES.includes(k.ease)) &&
              [k.cx1, k.cy1, k.cx2, k.cy2].every((n) => n === undefined || Number.isFinite(n)) &&
              // Sorted by time: the evaluation and the export rely on it.
              (i === 0 || k.t >= (keys[i - 1] as Keyframe).t),
          ))),
  );
}

/** Checks a parsed .zvproj enough to load it safely (wrong files are refused, not half-loaded). */
export function validProject(x: unknown): x is VideoProject {
  if (!x || typeof x !== 'object') return false;
  const p = x as VideoProject;
  return (
    p.version === 1 &&
    typeof p.name === 'string' &&
    Number.isFinite(p.width) &&
    Number.isFinite(p.height) &&
    Number.isFinite(p.fps) &&
    Array.isArray(p.tracks) &&
    Array.isArray(p.clips) &&
    Array.isArray(p.media) &&
    p.clips.every(
      (c) =>
        typeof c.id === 'string' &&
        Number.isFinite(c.start) &&
        Number.isFinite(c.in) &&
        Number.isFinite(c.out) &&
        (c.speed === undefined ||
          (Number.isFinite(c.speed) && c.speed >= SPEED_MIN && c.speed <= SPEED_MAX)) &&
        validKeyframes(c.keyframes) &&
        validEffects(c.effects) &&
        validAnim(c.anim) &&
        validTransition(c.transition) &&
        validText(c.text) &&
        validGrade(c.color) &&
        validChroma(c.chroma) &&
        (c.stabilize === undefined || typeof c.stabilize === 'boolean') &&
        validClipExtras(c, 0),
    ) &&
    p.tracks.every(
      (t) =>
        typeof t.id === 'string' &&
        (t.kind === 'video' || t.kind === 'audio') &&
        (t.volume === undefined || (Number.isFinite(t.volume) && t.volume >= 0 && t.volume <= 2)) &&
        (t.pan === undefined || (Number.isFinite(t.pan) && t.pan >= -1 && t.pan <= 1)) &&
        (t.duck === undefined || (Number.isFinite(t.duck) && t.duck >= 0 && t.duck <= 1)) &&
        (t.duckSound === undefined || typeof t.duckSound === 'boolean') &&
        (t.eq === undefined || validEqShape(t.eq)) &&
        (t.comp === undefined || validCompShape(t.comp)),
    ) &&
    p.media.every(
      (m) => typeof m.id === 'string' && typeof m.path === 'string' && validAnalysis(m.analysis),
    ) &&
    validTranscripts(p.transcripts)
  );
}

const finiteIn = (v: unknown, lo: number, hi: number) =>
  v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi);

/** Fase 12: per-clip pan, grade B, EQ and compound sub-timelines (at most 4 deep). */
function validClipExtras(c: Clip, depth: number): boolean {
  if (!finiteIn(c.pan, -1, 1) || !finiteIn(c.gradeMix, 0, 1) || !validGrade(c.colorB)) return false;
  if (c.eq !== undefined && !validEqShape(c.eq)) return false;
  if (!validRampTag(c.ramp)) return false;
  if (c.compound === undefined) return true;
  const k = c.compound;
  if (depth + 1 > COMPOUND_MAX_DEPTH || !k || typeof k !== 'object') return false;
  return (
    typeof k.name === 'string' &&
    k.name.length <= 512 &&
    Number.isFinite(k.duration) &&
    Array.isArray(k.tracks) &&
    k.tracks.length <= 200 &&
    k.tracks.every(
      (t) => !!t && typeof t.id === 'string' && (t.kind === 'video' || t.kind === 'audio'),
    ) &&
    Array.isArray(k.clips) &&
    k.clips.length <= 20_000 &&
    k.clips.every(
      (x) =>
        !!x &&
        typeof x.id === 'string' &&
        typeof x.trackId === 'string' &&
        Number.isFinite(x.start) &&
        Number.isFinite(x.in) &&
        Number.isFinite(x.out) &&
        (x.speed === undefined ||
          (Number.isFinite(x.speed) && x.speed >= SPEED_MIN && x.speed <= SPEED_MAX)) &&
        validKeyframes(x.keyframes) &&
        validEffects(x.effects) &&
        validAnim(x.anim) &&
        validTransition(x.transition) &&
        validText(x.text) &&
        validGrade(x.color) &&
        validClipExtras(x, depth + 1),
    )
  );
}

/** A compressor as loaded from a file: its five numbers, finite. */
function validCompShape(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const c = x as Record<string, unknown>;
  return ['threshold', 'ratio', 'attack', 'release', 'makeup'].every(
    (k) => typeof c[k] === 'number' && Number.isFinite(c[k]),
  );
}

/** An EQ as loaded from a file: an object of finite numbers within ±24 dB. */
export function validEqShape(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  return Object.entries(x as Record<string, unknown>).every(
    ([k, v]) => ['low', 'lowMid', 'highMid', 'high'].includes(k) && finiteIn(v, -24, 24),
  );
}

function validTranscripts(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  return Object.values(x as Record<string, Transcript>).every(
    (t) =>
      !!t &&
      typeof t.engine === 'string' &&
      Array.isArray(t.words) &&
      t.words.length <= TRANSCRIPT_MAX_WORDS &&
      t.words.every(
        (w) =>
          !!w &&
          typeof w.w === 'string' &&
          w.w.length <= 200 &&
          Number.isFinite(w.s) &&
          Number.isFinite(w.e),
      ),
  );
}

// ---------------- phase 2: effects, titles, animations, transitions, mixer ----------------

const editable = (p: VideoProject, c: Clip | undefined): c is Clip =>
  !!c && !trackOf(p, c.trackId)?.locked;

/** Sets (or clears, with undefined) the effects of some clips. */
export function setEffects(
  p: VideoProject,
  ids: ReadonlySet<string>,
  fx: Effects | undefined,
): VideoProject {
  const clean = cleanEffects(fx);
  let hit = false;
  const clips = p.clips.map((c) => {
    if (!ids.has(c.id) || !editable(p, c)) return c;
    hit = true;
    return { ...c, effects: clean };
  });
  return hit ? { ...p, clips } : p;
}

/** Sets (or clears, with undefined) the colour grade of some clips. */
export function setGrade(
  p: VideoProject,
  ids: ReadonlySet<string>,
  grade: ColorGrade | undefined,
): VideoProject {
  const clean = cleanGrade(grade);
  let hit = false;
  const clips = p.clips.map((c) => {
    if (!ids.has(c.id) || !editable(p, c) || isText(c)) return c;
    hit = true;
    const next = { ...c, color: clean };
    if (!clean) delete next.color;
    return next;
  });
  return hit ? { ...p, clips } : p;
}

/** Changes one effect value of a clip (the others stay). */
export function setEffect(
  p: VideoProject,
  id: string,
  key: keyof Effects,
  v: number,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!editable(p, c)) return p;
  return setEffects(p, new Set([id]), { ...c.effects, [key]: v });
}

export function setAnim(p: VideoProject, id: string, patch: Partial<ClipAnim>): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!editable(p, c)) return p;
  const a: ClipAnim = { ...c.anim, ...patch };
  for (const k of Object.keys(a) as (keyof ClipAnim)[]) if (a[k] === undefined) delete a[k];
  const none = (!a.in || a.in === 'none') && (!a.out || a.out === 'none');
  return replaceClip(p, { ...c, anim: none ? undefined : a });
}

/** The clip right before c on its track, touching it (within half a frame). */
export function prevAdjacent(p: VideoProject, c: Clip): Clip | undefined {
  const tol = 0.5 / p.fps;
  return p.clips.find(
    (x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(clipEnd(x) - c.start) < tol,
  );
}
export function nextAdjacent(p: VideoProject, c: Clip): Clip | undefined {
  const tol = 0.5 / p.fps;
  return p.clips.find(
    (x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(x.start - clipEnd(c)) < tol,
  );
}

/** A transition never lasts longer than the clips it joins. */
function transitionLength(p: VideoProject, c: Clip, d: number, prev: Clip | undefined): number {
  let max = Math.min(TRANSITION_MAX, clipDur(c));
  if (prev) max = Math.min(TRANSITION_MAX, clipDur(prev) * 2, clipDur(c) * 2);
  return Math.max(0, Math.min(Number.isFinite(d) ? d : 0, max));
}

/**
 * Where a clip's transition plays on the timeline. Between two clips it is centred on the cut
 * (the outgoing clip runs on for d/2, the incoming one starts d/2 early); with nothing right
 * before it, it is a reveal over its first d seconds.
 */
export function transitionWindow(
  p: VideoProject,
  c: Clip,
): { from: number; d: number; prev?: Clip } | null {
  const tr = c.transition;
  if (!tr || trackOf(p, c.trackId)?.kind !== 'video') return null;
  const prev = prevAdjacent(p, c);
  const d = transitionLength(p, c, tr.d, prev);
  if (d < 1e-3) return null;
  return prev ? { from: c.start - d / 2, d, prev } : { from: c.start, d };
}

/** Seconds a clip is drawn before its start / after its end because of transitions. */
export function leadOf(p: VideoProject, c: Clip): number {
  const w = transitionWindow(p, c);
  return w?.prev ? w.d / 2 : 0;
}
export function tailOf(p: VideoProject, c: Clip): number {
  const next = nextAdjacent(p, c);
  const w = next && transitionWindow(p, next);
  return w && w.prev?.id === c.id ? w.d / 2 : 0;
}

export function setTransition(
  p: VideoProject,
  id: string,
  tr: Transition | undefined,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!editable(p, c)) return p;
  if (!tr) return replaceClip(p, { ...c, transition: undefined });
  const d = Math.max(TRANSITION_MIN, transitionLength(p, c, tr.d, prevAdjacent(p, c)));
  const next: Transition = { kind: tr.kind, d: Math.round(d * 1000) / 1000 };
  if (tr.kind === 'custom') {
    if (!tr.def) return p;
    next.def = tr.def;
  }
  return replaceClip(p, { ...c, transition: next });
}

/**
 * How a visual clip looks at timeline time t: its in/out animation and the transition into
 * it. Null when it is not drawn at t.
 */
export function visualAt(p: VideoProject, c: Clip, t: number): Look | null {
  const lead = leadOf(p, c);
  const tail = tailOf(p, c);
  if (t < c.start - lead - 1e-9 || t >= clipEnd(c) + tail) return null;
  const len = clipDur(c);
  const into = Math.min(Math.max(t - c.start, 0), len);
  let look = animAt(c.anim, into, len);
  const w = transitionWindow(p, c);
  if (w && t < w.from + w.d)
    look = combine(look, transitionLook(c.transition!.kind, (t - w.from) / w.d, c.transition!.def));
  return look;
}

/** Visual clips of a track drawn at t, bottom first (an incoming clip over the outgoing one). */
export function visualClipsAt(p: VideoProject, trackId: string, t: number): Clip[] {
  return p.clips
    .filter((c) => c.trackId === trackId && visualAt(p, c, t))
    .sort((a, b) => a.start - b.start);
}

export { LOOK_NONE };

/** Adds a title at `at`: on a free video track above V1, else on a new track on top. */
export function addTextClip(
  p: VideoProject,
  spec: TextSpec,
  at: number,
  opts: { dur?: number; y?: number; anim?: ClipAnim } = {},
): { project: VideoProject; clip: Clip } {
  const dur = opts.dur ?? TEXT_DEFAULT_DUR;
  const start = Math.max(0, at);
  let project = p;
  const bottom = compositeOrder(project)[0]?.id;
  let track = project.tracks.find(
    (t) =>
      t.kind === 'video' && t.id !== bottom && !t.locked && fits(project, t.id, start, start + dur),
  );
  if (!track) {
    project = addTrack(project, 'video');
    track = project.tracks[0]!;
  }
  const anim =
    opts.anim && (opts.anim.in ?? 'none') + (opts.anim.out ?? 'none') !== 'nonenone'
      ? { ...opts.anim }
      : undefined;
  const clip: Clip = {
    id: uid('c'),
    mediaId: '',
    trackId: track.id,
    start,
    in: 0,
    out: dur,
    volume: 0,
    text: { ...spec },
    ...(opts.y ? { transform: { ...IDENTITY, y: opts.y } } : {}),
    ...(anim ? { anim } : {}),
  };
  return { project: { ...project, clips: [...project.clips, clip] }, clip };
}

export function updateText(p: VideoProject, id: string, patch: Partial<TextSpec>): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!editable(p, c) || !c.text) return p;
  const text: TextSpec = { ...c.text, ...patch };
  for (const k of Object.keys(text) as (keyof TextSpec)[])
    if (text[k] === undefined) delete text[k];
  return replaceClip(p, { ...c, text });
}

/** Mixer: track volume, pan and solo (neutral values are dropped from the file). */
export function setTrackMix(
  p: VideoProject,
  trackId: string,
  patch: { volume?: number; pan?: number; solo?: boolean },
): VideoProject {
  const t = trackOf(p, trackId);
  if (!t) return p;
  const next: Track = { ...t };
  if (patch.volume !== undefined && Number.isFinite(patch.volume)) {
    const v = Math.min(2, Math.max(0, patch.volume));
    if (Math.abs(v - 1) < 1e-3) delete next.volume;
    else next.volume = v;
  }
  if (patch.pan !== undefined && Number.isFinite(patch.pan)) {
    const v = Math.min(1, Math.max(-1, patch.pan));
    if (Math.abs(v) < 1e-3) delete next.pan;
    else next.pan = v;
  }
  if (patch.solo !== undefined) {
    if (patch.solo) next.solo = true;
    else delete next.solo;
  }
  return { ...p, tracks: p.tracks.map((x) => (x.id === trackId ? next : x)) };
}

/** Whether a track is heard: not muted, and soloed when any track is. */
export function trackAudible(p: VideoProject, t: Track | undefined): boolean {
  if (!t || t.muted) return false;
  return !p.tracks.some((x) => x.solo) || !!t.solo;
}
export const trackVolume = (t: Track | undefined): number => t?.volume ?? 1;
export const trackPan = (t: Track | undefined): number => t?.pan ?? 0;

// ---------------- export ----------------

export interface ExportPreset {
  id: string;
  label: string;
  /** Short side; null keeps the project size. */
  short: number | null;
  crf: number;
  preset: 'veryfast' | 'fast' | 'medium' | 'slow';
  audioKbps: number;
  /** Changes the aspect (e.g. TikTok is always 9:16): null keeps the project's. */
  aspect?: [number, number];
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'yt1080', label: 'YouTube 1080p', short: 1080, crf: 20, preset: 'medium', audioKbps: 192 },
  { id: 'yt4k', label: 'YouTube 4K', short: 2160, crf: 20, preset: 'medium', audioKbps: 256 },
  {
    id: 'vertical',
    label: 'TikTok / Reels / Shorts',
    short: 1080,
    crf: 21,
    preset: 'medium',
    audioKbps: 192,
    aspect: [9, 16],
  },
  {
    id: 'square',
    label: 'Instagram (1:1)',
    short: 1080,
    crf: 21,
    preset: 'medium',
    audioKbps: 192,
    aspect: [1, 1],
  },
  { id: 'web', label: 'Web ligero (720p)', short: 720, crf: 26, preset: 'fast', audioKbps: 128 },
  { id: 'max', label: 'Máxima calidad', short: null, crf: 16, preset: 'slow', audioKbps: 320 },
];

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  /** x264 constant quality: 0 (lossless) – 51. */
  crf: number;
  preset: ExportPreset['preset'];
  audioKbps: number;
  /** Timeline range to render. */
  start: number;
  end: number;
  /** Fase 12: normalise the mix to this integrated loudness (LUFS), measured in a first pass. */
  loudness?: number | null;
}

/** Loudness targets offered at export (LUFS): streaming platforms, broadcast, podcasts. */
export const LOUDNESS_TARGETS = [-14, -16, -23] as const;
export const LOUDNESS_MIN = -40;
export const LOUDNESS_MAX = -5;

export function defaultExport(
  p: VideoProject,
  preset: ExportPreset = EXPORT_PRESETS[0]!,
): ExportOptions {
  const [aw, ah] = preset.aspect ?? [p.width, p.height];
  const short = preset.short ?? Math.min(p.width, p.height);
  const size =
    preset.aspect || preset.short ? sizeFor(aw, ah, short) : { width: p.width, height: p.height };
  return {
    ...size,
    fps: p.fps,
    crf: preset.crf,
    preset: preset.preset,
    audioKbps: preset.audioKbps,
    start: p.inPoint ?? 0,
    end: p.outPoint ?? projectDuration(p),
  };
}

/** Rough final size in bytes (CRF has no fixed bitrate: a typical rate per pixel and quality). */
export function estimateSize(o: ExportOptions): number {
  const secs = Math.max(0, o.end - o.start);
  const bitsPerPixel = 0.07 * Math.pow(2, (23 - o.crf) / 6);
  const videoBps = o.width * o.height * o.fps * bitsPerPixel;
  return Math.round(((videoBps + o.audioKbps * 1000) * secs) / 8);
}

// ---------------- detach audio / overlays ----------------

/** A video clip whose own sound can go to an audio track (detachAudio). */
export function canDetachAudio(p: VideoProject, c: Clip | undefined): c is Clip {
  if (!c || isText(c) || c.compound || c.volume <= 0) return false;
  const tr = trackOf(p, c.trackId);
  const m = mediaOf(p, c.mediaId);
  return !!tr && tr.kind === 'video' && !tr.locked && !!m && m.kind === 'video' && m.hasAudio;
}

/**
 * "Separar audio": the sound of each video clip goes to its own clip on an audio track (same
 * time, source stretch, speed, volume and fades) and the video clip goes silent, so the two can
 * be cut, moved and mixed apart. Clips without sound, titles and locked tracks are skipped.
 */
export function detachAudio(
  p: VideoProject,
  ids: Iterable<string>,
): { project: VideoProject; created: string[] } {
  let project = p;
  const created: string[] = [];
  for (const id of ids) {
    const c = project.clips.find((x) => x.id === id);
    if (!canDetachAudio(project, c)) continue;
    const end = clipEnd(c);
    let track = project.tracks.find(
      (t) => t.kind === 'audio' && !t.locked && fits(project, t.id, c.start, end),
    );
    if (!track) {
      project = addTrack(project, 'audio');
      track = project.tracks[project.tracks.length - 1]!;
    }
    const a: Clip = {
      id: uid('c'),
      mediaId: c.mediaId,
      trackId: track.id,
      start: c.start,
      in: c.in,
      out: c.out,
      volume: c.volume,
      ...(c.speed !== undefined && c.speed !== 1 ? { speed: c.speed } : {}),
      ...(c.fadeIn ? { fadeIn: c.fadeIn } : {}),
      ...(c.fadeOut ? { fadeOut: c.fadeOut } : {}),
      ...(c.pan !== undefined ? { pan: c.pan } : {}),
      ...(c.eq ? { eq: c.eq } : {}),
    };
    project = {
      ...project,
      clips: [
        ...project.clips.map((x) =>
          x.id === id ? { ...x, volume: 0, pan: undefined, eq: undefined } : x,
        ),
        a,
      ],
    };
    created.push(a.id);
  }
  return { project, created };
}

/** Size of a picture put on top of the video (share of "fitted to the frame"). */
export const OVERLAY_SCALE = 0.45;

/**
 * "Poner encima": a picture or video goes on top of whatever plays at `at`, on a video track
 * above every clip visible there (a new one on top when none is free), smaller and centred so
 * it can be dragged into place in the viewer. Audio files and an empty timeline fall back to a
 * normal insert.
 */
export function overlayMedia(
  p: VideoProject,
  media: MediaItem,
  at: number,
): { project: VideoProject; clip: Clip | null } {
  if (media.missing) return { project: p, clip: null };
  const start = Math.max(0, at);
  const order = compositeOrder(p); // bottom (V1) → top
  const busy = order.map((t) =>
    p.clips.some((c) => c.trackId === t.id && c.start <= start + 1e-6 && clipEnd(c) > start + 1e-6),
  );
  const highest = busy.lastIndexOf(true);
  if (media.kind === 'audio' || highest < 0) return insertMedia(p, media, { start });
  // Pictures last as long as the clip they cover (5 s at most); videos their whole length.
  const under = p.clips
    .filter(
      (c) => c.trackId === order[highest]!.id && c.start <= start + 1e-6 && clipEnd(c) > start,
    )
    .map((c) => clipEnd(c) - start)[0];
  const dur =
    media.kind === 'image'
      ? Math.max(MIN_CLIP * 15, Math.min(IMAGE_DEFAULT, under ?? IMAGE_DEFAULT))
      : media.duration;
  if (!(dur > 0)) return { project: p, clip: null };
  let project = p;
  let track = order
    .slice(highest + 1)
    .find((t) => !t.locked && fits(project, t.id, start, start + dur));
  if (!track) {
    project = addTrack(project, 'video');
    track = project.tracks[0]!;
  }
  const clip: Clip = {
    id: uid('c'),
    mediaId: media.id,
    trackId: track.id,
    start,
    in: 0,
    out: dur,
    volume: 1,
    transform: { ...IDENTITY, scale: OVERLAY_SCALE },
  };
  return { project: { ...project, clips: [...project.clips, clip] }, clip };
}
