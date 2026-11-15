/**
 * Zinarix Video Studio: the project model (pure and serializable) and the timeline edits.
 * Used by the renderer (editing, preview) and by the main process (export with FFmpeg).
 * Every edit returns a new project; nothing here touches the DOM, Electron or the disk.
 * Times are in seconds.
 */

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
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  locked: boolean;
  hidden: boolean;
}

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

export const clipEnd = (c: Clip): number => c.start + (c.out - c.in);
export const clipDur = (c: Clip): number => c.out - c.in;

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
  at?: { trackId?: string; start?: number },
): { project: VideoProject; clip: Clip | null } {
  if (media.missing) return { project: p, clip: null };
  const kind = trackKindFor(media);
  const dur = media.kind === 'image' ? IMAGE_DEFAULT : media.duration;
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
    const cut = c.in + (time - c.start);
    const right: Clip = { ...c, id: uid('c'), start: time, in: cut };
    clips.push({ ...c, out: cut }, right);
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
  const unlimited = m?.kind === 'image';
  const siblings = trackClips(p, c.trackId).filter((x) => x.id !== id);
  let next: Clip;
  if (edge === 'left') {
    const prevEnd = siblings
      .filter((x) => clipEnd(x) <= c.start + 1e-6)
      .reduce((mx, x) => Math.max(mx, clipEnd(x)), 0);
    const minStart = Math.max(prevEnd, unlimited ? 0 : c.start - c.in);
    const start = Math.min(Math.max(to, minStart), clipEnd(c) - MIN_CLIP);
    next = { ...c, start, in: c.in + (start - c.start) };
    if (unlimited && next.in < 0) next = { ...next, out: next.out - next.in, in: 0 };
  } else {
    const nextStart = siblings
      .filter((x) => x.start >= clipEnd(c) - 1e-6)
      .reduce((mn, x) => Math.min(mn, x.start), Infinity);
    const maxEnd = Math.min(
      nextStart,
      unlimited ? Infinity : c.start + ((m?.duration ?? c.out) - c.in),
    );
    const end = Math.max(Math.min(to, maxEnd), c.start + MIN_CLIP);
    next = { ...c, out: c.in + (end - c.start) };
  }
  return { ...p, clips: p.clips.map((x) => (x.id === id ? next : x)) };
}

export function updateClip(
  p: VideoProject,
  id: string,
  patch: Partial<Omit<Clip, 'id'>>,
): VideoProject {
  return { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
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
    .filter((c) => trackOf(p, c.trackId) && mediaOf(p, c.mediaId))
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
        Number.isFinite(c.out),
    ) &&
    p.media.every((m) => typeof m.id === 'string' && typeof m.path === 'string')
  );
}

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
}

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
