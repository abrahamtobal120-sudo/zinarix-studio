/**
 * OpenTimelineIO (.otio JSON) interchange for the video project: cuts, tracks, markers and speed.
 * Colour, effects, transforms, titles and transitions stay in Zinarix (they have no OTIO form).
 * Pure: no Node, DOM or Electron. Times in the project are seconds; OTIO uses RationalTime.
 */
import type { Clip, MediaItem, Marker, Track, VideoProject } from './video.js';
import {
  SPEED_MAX,
  SPEED_MIN,
  clipDur,
  compositeOrder,
  mediaKindOf,
  mediaOf,
  uid,
  validProject,
} from './video.js';

// ---------------- limits ----------------

/** Hostile-file guards: anything larger is refused before it is walked. */
export const OTIO_MAX_CHARS = 64 * 1024 * 1024;
export const OTIO_MAX_TRACKS = 200;
export const OTIO_MAX_ITEMS = 20_000;
export const OTIO_MAX_MARKERS = 5_000;
/** Times past this (seconds) are treated as broken. */
const MAX_TIME = 7 * 24 * 3600;

// ---------------- small helpers ----------------

type Json = Record<string, unknown>;

const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
const schemaOf = (x: unknown): string =>
  isObj(x) && typeof x.OTIO_SCHEMA === 'string' ? x.OTIO_SCHEMA : '';
const isSchema = (x: unknown, name: string): boolean => schemaOf(x).split('.')[0] === name;
const str = (x: unknown, max = 500): string => (typeof x === 'string' ? x.slice(0, max) : '');

const validFps = (n: number): boolean => Number.isFinite(n) && n > 0 && n <= 1000;

// ---------------- paths and URLs ----------------

const encSeg = (s: string): string => encodeURIComponent(s);

/** Native path → file URL (`C:\a b.mp4` → `file:///C:/a%20b.mp4`, `/home/a.mp4` → `file:///home/a.mp4`). */
export function pathToFileUrl(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return path;
  // UNC: \\server\share\x → file://server/share/x
  const unc = /^[\\/]{2}([^\\/]+)[\\/](.*)$/.exec(path);
  if (unc) return `file://${unc[1]}/${unc[2]!.split(/[\\/]/).map(encSeg).join('/')}`;
  const drive = /^([a-z]):[\\/]?(.*)$/i.exec(path);
  if (drive)
    return `file:///${drive[1]!.toUpperCase()}:/${drive[2]!.split(/[\\/]/).map(encSeg).join('/')}`;
  if (path.startsWith('/')) return `file://${path.split('/').map(encSeg).join('/')}`;
  // Relative: a relative URL reference.
  return path.split(/[\\/]/).map(encSeg).join('/');
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** File URL → native path (Windows drive URLs give `C:\...`). Other URLs come back untouched. */
export function fileUrlToPath(url: string): string {
  const m = /^file:(.*)$/i.exec(url);
  if (!m) return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[a-z]:[\\/]/i.test(url) ? url : decode(url);
  let rest = m[1]!;
  let host = '';
  if (rest.startsWith('//')) {
    rest = rest.slice(2);
    const slash = rest.indexOf('/');
    host = slash < 0 ? rest : rest.slice(0, slash);
    rest = slash < 0 ? '/' : rest.slice(slash);
    if (host.toLowerCase() === 'localhost') host = '';
  }
  const path = decode(rest.split(/[?#]/)[0]!);
  if (host) return `\\\\${host}${path.replace(/\//g, '\\')}`;
  const drive = /^\/?([a-z]):(\/.*)?$/i.exec(path);
  if (drive) return `${drive[1]!.toUpperCase()}:${(drive[2] ?? '\\').replace(/\//g, '\\')}`;
  return path;
}

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

// ---------------- marker colours ----------------

/** OTIO MarkerColor names and the colour each comes back as. */
const OTIO_COLORS: Record<string, string> = {
  PINK: '#ff70a6',
  RED: '#e5484d',
  ORANGE: '#f76b15',
  YELLOW: '#e5b33a',
  GREEN: '#30a46c',
  CYAN: '#00a2c7',
  BLUE: '#3e63dd',
  PURPLE: '#8e4ec6',
  MAGENTA: '#d6409f',
  BLACK: '#000000',
  WHITE: '#ffffff',
};

function rgb(hex: string): [number, number, number] | null {
  let h = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!h) return null;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Closest OTIO colour name of a CSS hex colour. */
export function otioColorOf(hex: string): string {
  const c = rgb(hex);
  if (!c) return 'YELLOW';
  let best = 'YELLOW';
  let dist = Infinity;
  for (const [name, h] of Object.entries(OTIO_COLORS)) {
    const o = rgb(h)!;
    const d = (o[0] - c[0]) ** 2 + (o[1] - c[1]) ** 2 + (o[2] - c[2]) ** 2;
    if (d < dist) {
      dist = d;
      best = name;
    }
  }
  return best;
}

// ---------------- export ----------------

/** Project → OTIO JSON, plus Spanish notes on what does not travel. */
export function projectToOtio(p: VideoProject): { json: string; skipped: string[] } {
  const fps = validFps(p.fps) ? p.fps : 30;
  const frames = (s: number): number => (Number.isFinite(s) ? Math.round(s * fps) : 0);
  const rt = (f: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate: fps, value: f });
  const range = (startF: number, durF: number) => ({
    OTIO_SCHEMA: 'TimeRange.1',
    duration: rt(durF),
    start_time: rt(startF),
  });

  const count = {
    color: 0,
    effects: 0,
    transform: 0,
    anim: 0,
    titles: 0,
    compound: 0,
    transitions: 0,
    missing: 0,
    overlap: 0,
  };
  for (const c of p.clips) {
    if (c.color) count.color++;
    if (c.effects && Object.keys(c.effects).length) count.effects++;
    if (c.transform || c.keyframes) count.transform++;
    if (c.anim || c.fadeIn || c.fadeOut) count.anim++;
    if (c.transition) count.transitions++;
  }

  const gap = (durF: number) => ({
    OTIO_SCHEMA: 'Gap.1',
    name: '',
    source_range: range(0, durF),
    effects: [],
    markers: [],
    enabled: true,
    metadata: {},
  });

  const exportTrack = (t: Track) => {
    const clips = p.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
    const children: unknown[] = [];
    let cursor = 0;
    for (const c of clips) {
      let startF = frames(c.start);
      const endF = frames(c.start + clipDur(c));
      if (startF < cursor) {
        count.overlap++;
        startF = cursor;
      }
      const durF = endF - startF;
      if (durF <= 0) continue;
      if (startF > cursor) children.push(gap(startF - cursor));
      cursor = endF;
      const m = mediaOf(p, c.mediaId);
      const compound = (c as Clip & { compound?: unknown }).compound !== undefined;
      if (c.text || compound || !m) {
        if (c.text) count.titles++;
        else if (compound) count.compound++;
        else count.missing++;
        children.push(gap(durF));
        continue;
      }
      children.push(exportClip(c, m, startF, durF));
    }
    return {
      OTIO_SCHEMA: 'Track.1',
      name: t.name,
      kind: t.kind === 'audio' ? 'Audio' : 'Video',
      children,
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      metadata: {
        zinarix: {
          id: t.id,
          muted: t.muted,
          ...(t.volume !== undefined ? { volume: t.volume } : {}),
        },
      },
    };
  };

  const exportClip = (c: Clip, m: MediaItem, _startF: number, durF: number) => {
    const sp = c.speed ?? 1;
    const mediaDurF = frames(m.duration);
    return {
      OTIO_SCHEMA: 'Clip.2',
      name: m.name || baseName(m.path),
      source_range: range(frames(c.in), durF),
      effects:
        sp !== 1
          ? [
              {
                OTIO_SCHEMA: 'LinearTimeWarp.1',
                name: '',
                effect_name: 'LinearTimeWarp',
                time_scalar: sp,
                metadata: {},
              },
            ]
          : [],
      markers: [],
      enabled: true,
      media_references: {
        DEFAULT_MEDIA: {
          OTIO_SCHEMA: 'ExternalReference.1',
          name: m.name || baseName(m.path),
          target_url: pathToFileUrl(m.path),
          available_range: mediaDurF > 0 ? range(0, mediaDurF) : null,
          available_image_bounds: null,
          metadata: {},
        },
      },
      active_media_reference_key: 'DEFAULT_MEDIA',
      metadata: {
        zinarix: {
          clipId: c.id,
          trackId: c.trackId,
          volume: c.volume,
          note: 'El color, los efectos y las transformaciones no se exportan.',
        },
      },
    };
  };

  // OTIO stacks go bottom to top: V1 first, then the audio tracks.
  const tracks = [
    ...compositeOrder(p).map(exportTrack),
    ...p.tracks.filter((t) => t.kind === 'audio').map(exportTrack),
  ];

  const markers = p.markers.map((mk) => ({
    OTIO_SCHEMA: 'Marker.2',
    name: mk.name,
    color: otioColorOf(mk.color),
    marked_range: range(frames(mk.time), 0),
    comment: '',
    metadata: { zinarix: { id: mk.id, color: mk.color } },
  }));

  const timeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: p.name,
    global_start_time: rt(0),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: tracks,
      source_range: null,
      effects: [],
      markers,
      enabled: true,
      metadata: {},
    },
    metadata: { zinarix: { width: p.width, height: p.height, fps } },
  };

  const skipped: string[] = [];
  const note = (n: number, what: string) => {
    if (n > 0) skipped.push(`${what}: ${n} ${n === 1 ? 'clip' : 'clips'} (no se exportan)`);
  };
  note(count.color, 'Corrección de color');
  note(count.effects, 'Efectos');
  note(count.transform, 'Transformaciones y fotogramas clave');
  note(count.anim, 'Animaciones y fundidos');
  note(count.titles, 'Títulos (quedan como huecos)');
  note(count.compound, 'Clips compuestos (quedan como huecos)');
  note(count.transitions, 'Transiciones');
  note(count.missing, 'Clips sin medio (quedan como huecos)');
  if (count.overlap)
    skipped.push(
      `Clips solapados recortados: ${count.overlap} (OTIO no admite solapes en una pista)`,
    );

  return { json: JSON.stringify(timeline, null, 2), skipped };
}

// ---------------- import ----------------

interface Rt {
  value: number;
  rate: number;
}

function readRt(x: unknown): Rt | null {
  if (!isObj(x)) return null;
  const value = fin(x.value);
  const rate = fin(x.rate);
  if (!Number.isFinite(value) || !(rate > 0)) return null;
  return { value, rate };
}
const secs = (r: Rt | null): number => (r ? r.value / r.rate : NaN);

function readRange(x: unknown): { start: number; dur: number; rates: number[] } | null {
  if (!isObj(x)) return null;
  const s = readRt(x.start_time);
  const d = readRt(x.duration);
  if (!s || !d) return null;
  const start = secs(s);
  const dur = secs(d);
  if (!Number.isFinite(start) || !Number.isFinite(dur)) return null;
  if (Math.abs(start) > MAX_TIME || dur < 0 || dur > MAX_TIME) return null;
  return { start, dur, rates: [s.rate, d.rate] };
}

const zmeta = (x: unknown): Json => {
  if (!isObj(x) || !isObj(x.metadata)) return {};
  const z = x.metadata.zinarix;
  return isObj(z) ? z : {};
};

/** The external reference a clip plays (Clip.2 media_references or Clip.1 media_reference). */
function mediaRefOf(clip: Json): Json | null {
  if (isObj(clip.media_references)) {
    const key =
      typeof clip.active_media_reference_key === 'string'
        ? clip.active_media_reference_key
        : 'DEFAULT_MEDIA';
    const ref = clip.media_references[key];
    return isObj(ref) ? ref : null;
  }
  return isObj(clip.media_reference) ? clip.media_reference : null;
}

/** OTIO JSON → project. Throws a short Spanish Error when the file is not a usable timeline. */
export function otioToProject(
  text: string,
  opts: { name?: string; fps?: number } = {},
): { project: VideoProject; warnings: string[] } {
  if (typeof text !== 'string' || text.length > OTIO_MAX_CHARS)
    throw new Error('El archivo OTIO es demasiado grande.');
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un OTIO válido (JSON ilegible).');
  }
  if (!isSchema(root, 'Timeline') || !isObj(root))
    throw new Error('El archivo OTIO no contiene una línea de tiempo.');
  const stack = root.tracks;
  if (!isSchema(stack, 'Stack') || !isObj(stack) || !Array.isArray(stack.children))
    throw new Error('La línea de tiempo OTIO no tiene pistas.');
  const otioTracks = stack.children as unknown[];
  if (otioTracks.length > OTIO_MAX_TRACKS)
    throw new Error(`El archivo OTIO tiene demasiadas pistas (máximo ${OTIO_MAX_TRACKS}).`);
  let items = 0;
  for (const t of otioTracks) if (isObj(t) && Array.isArray(t.children)) items += t.children.length;
  if (items > OTIO_MAX_ITEMS)
    throw new Error(`El archivo OTIO tiene demasiados elementos (máximo ${OTIO_MAX_ITEMS}).`);

  const warn = new Map<string, number>();
  const w = (msg: string) => warn.set(msg, (warn.get(msg) ?? 0) + 1);

  // Pass 1: the most common rate, for the project fps.
  const rates = new Map<number, number>();
  const tally = (r: number) => {
    if (validFps(r)) rates.set(r, (rates.get(r) ?? 0) + 1);
  };
  for (const t of otioTracks) {
    if (!isObj(t) || !Array.isArray(t.children)) continue;
    for (const ch of t.children as unknown[])
      if (isObj(ch)) readRange(ch.source_range)?.rates.forEach(tally);
  }
  let fps = fin(opts.fps);
  if (!validFps(fps)) {
    fps = 30;
    let most = 0;
    for (const [r, n] of rates)
      if (n > most) {
        most = n;
        fps = r;
      }
  }

  const tm = zmeta(root);
  const width = fin(tm.width) > 0 && fin(tm.width) <= 16384 ? Math.round(fin(tm.width)) : 1920;
  const height = fin(tm.height) > 0 && fin(tm.height) <= 16384 ? Math.round(fin(tm.height)) : 1080;

  const media = new Map<string, MediaItem>();
  const mediaEnd = new Map<string, number>();
  const clips: Clip[] = [];
  const markers: Marker[] = [];
  const videoTracks: Track[] = [];
  const audioTracks: Track[] = [];

  const addMarker = (mk: unknown, time: number) => {
    if (markers.length >= OTIO_MAX_MARKERS) return w('Marcadores de más ignorados');
    if (!isObj(mk) || !Number.isFinite(time) || time < 0 || time > MAX_TIME) return;
    const z = zmeta(mk);
    const hex = typeof z.color === 'string' && rgb(z.color) ? z.color : undefined;
    const name = typeof mk.color === 'string' ? mk.color.toUpperCase() : '';
    markers.push({
      id: uid('m'),
      time,
      name: str(mk.name, 200),
      color: hex ?? OTIO_COLORS[name] ?? OTIO_COLORS.YELLOW!,
    });
  };
  const markerTime = (mk: unknown): number =>
    isObj(mk) ? (readRange(mk.marked_range)?.start ?? NaN) : NaN;

  const mediaFor = (ref: Json): MediaItem | null => {
    const url = str(ref.target_url, 4096);
    if (!url) return null;
    let m = media.get(url);
    if (!m) {
      const path = fileUrlToPath(url);
      const kind = mediaKindOf(path) ?? 'video';
      const avail = readRange(ref.available_range);
      m = {
        id: uid('m'),
        path,
        name: baseName(path),
        kind,
        duration: avail && avail.dur > 0 ? avail.dur : 0,
        width: 0,
        height: 0,
        fps: 0,
        hasVideo: kind !== 'audio',
        hasAudio: kind !== 'image',
        size: 0,
      };
      media.set(url, m);
    }
    return m;
  };

  for (const [ti, t] of otioTracks.entries()) {
    if (!isSchema(t, 'Track') || !isObj(t)) {
      w('Elementos de la pila que no son pistas ignorados');
      continue;
    }
    const kind = t.kind === 'Audio' ? 'audio' : 'video';
    const z = zmeta(t);
    const vol = fin(z.volume);
    const track: Track = {
      id: uid('t'),
      kind,
      name: str(t.name, 100) || `${kind === 'video' ? 'V' : 'A'}${ti + 1}`,
      muted: z.muted === true,
      locked: false,
      hidden: false,
      ...(vol >= 0 && vol <= 2 && vol !== 1 ? { volume: vol } : {}),
    };
    (kind === 'video' ? videoTracks : audioTracks).push(track);
    if (Array.isArray(t.markers))
      for (const mk of (t.markers as unknown[]).slice(0, OTIO_MAX_MARKERS))
        addMarker(mk, markerTime(mk));

    let cursor = 0;
    for (const ch of (Array.isArray(t.children) ? t.children : []) as unknown[]) {
      if (!isObj(ch)) continue;
      const schema = schemaOf(ch).split('.')[0];
      if (schema === 'Transition') {
        w('Transiciones ignoradas');
        continue;
      }
      const sr = readRange(ch.source_range);
      if (schema === 'Gap') {
        if (sr) cursor += sr.dur;
        else w('Huecos sin duración ignorados');
        continue;
      }
      if (schema !== 'Clip') {
        // Nested stacks, unknown items: keep their time as a gap.
        w(
          schema === 'Stack'
            ? 'Pilas anidadas importadas como huecos'
            : 'Elementos desconocidos importados como huecos',
        );
        if (sr) cursor += sr.dur;
        continue;
      }
      const ref = mediaRefOf(ch);
      const avail = ref ? readRange(ref.available_range) : null;
      const range = sr ?? avail;
      if (!range || !(range.dur > 0)) {
        w('Clips sin duración ignorados');
        continue;
      }
      const start = cursor;
      cursor += range.dur;
      if (cursor > MAX_TIME) {
        w('Clips fuera de rango ignorados');
        continue;
      }
      if (!ref || !isSchema(ref, 'ExternalReference')) {
        w('Clips sin archivo externo importados como huecos');
        continue;
      }
      const m = mediaFor(ref);
      if (!m) {
        w('Clips sin archivo externo importados como huecos');
        continue;
      }
      let speed = 1;
      if (Array.isArray(ch.effects))
        for (const fx of ch.effects as unknown[]) {
          const s = schemaOf(fx).split('.')[0];
          if (s === 'LinearTimeWarp' && isObj(fx)) {
            const ts = fin(fx.time_scalar);
            if (!(ts > 0)) w('Congelados y reproducción inversa importados a velocidad normal');
            else {
              const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, ts));
              if (clamped !== ts) w(`Velocidades limitadas a ${SPEED_MIN}×–${SPEED_MAX}×`);
              speed = clamped;
            }
          } else if (s === 'FreezeFrame')
            w('Congelados y reproducción inversa importados a velocidad normal');
          else w('Efectos ignorados');
        }
      // Source times are in media time: make them relative to the start of the media.
      const inPt = Math.max(0, range.start - (avail ? avail.start : 0));
      const outPt = inPt + range.dur * speed;
      mediaEnd.set(m.id, Math.max(mediaEnd.get(m.id) ?? 0, outPt));
      const cv = fin(zmeta(ch).volume);
      const clip: Clip = {
        id: uid('c'),
        mediaId: m.id,
        trackId: track.id,
        start,
        in: inPt,
        out: outPt,
        volume: cv >= 0 && cv <= 2 ? cv : 1,
        ...(speed !== 1 ? { speed } : {}),
      };
      clips.push(clip);
      if (Array.isArray(ch.markers))
        for (const mk of (ch.markers as unknown[]).slice(0, OTIO_MAX_MARKERS)) {
          const mt = markerTime(mk);
          addMarker(mk, start + (mt - range.start) / speed);
        }
    }
  }
  if (Array.isArray(stack.markers))
    for (const mk of (stack.markers as unknown[]).slice(0, OTIO_MAX_MARKERS))
      addMarker(mk, markerTime(mk));

  for (const m of media.values()) if (!(m.duration > 0)) m.duration = mediaEnd.get(m.id) ?? 0;

  // Display order: video top-first (OTIO lists them bottom-first), then audio.
  if (!videoTracks.length) videoTracks.push(emptyTrack('video', 'V1'));
  if (!audioTracks.length) audioTracks.push(emptyTrack('audio', 'A1'));
  const project: VideoProject = {
    version: 1,
    name: (opts.name ?? str(root.name, 200)) || 'OTIO importado',
    width,
    height,
    fps,
    tracks: [...videoTracks.reverse(), ...audioTracks],
    clips,
    media: [...media.values()],
    markers: markers.sort((a, b) => a.time - b.time),
    inPoint: null,
    outPoint: null,
  };
  if (!validProject(project)) throw new Error('El archivo OTIO no produjo un proyecto válido.');
  const warnings = [...warn].map(([msg, n]) => (n > 1 ? `${msg} (${n})` : msg));
  return { project, warnings };
}

function emptyTrack(kind: Track['kind'], name: string): Track {
  return { id: uid('t'), kind, name, muted: false, locked: false, hidden: false };
}
