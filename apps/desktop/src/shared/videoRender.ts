/**
 * Turns a Video Studio project into an FFmpeg command (argument list + filter graph). Pure:
 * the main process runs it with spawn (never a shell), the tests check it directly.
 *
 * Each clip is its own input, already trimmed with -ss/-t (fast and frame-accurate on modern
 * FFmpeg). Video is scaled to fit the canvas, shifted to its timeline time and overlaid on a
 * black base, bottom track first; audio is delayed to its time and mixed.
 */
import type { Clip, Ease, ExportOptions, KeyProp, MediaItem, VideoProject } from './video.js';
import {
  MAX_KEYS,
  SPEED_MAX,
  SPEED_MIN,
  clipEnd,
  compositeOrder,
  mediaOf,
  sourceAt,
  speedOf,
  transformOf,
} from './video.js';

export interface RenderPlan {
  /** FFmpeg arguments before the filter (inputs) — the runner adds the filter and the output. */
  inputs: string[];
  filter: string;
  /** Arguments after the filter, ending with the output path. */
  output: string[];
  duration: number;
  /** How many clips made it in (0 = only black + silence). */
  clips: number;
}

/** Numbers only ever reach the graph through here (a bad project file cannot inject filters). */
const num = (n: number) => {
  const x = Number(n);
  return (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0).toString();
};
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(Number(n)) ? Number(n) : lo));
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

interface Piece {
  clip: Clip;
  media: MediaItem;
  /** Seconds into the source. */
  srcIn: number;
  /** Seconds on the timeline (the source part is dur × speed). */
  dur: number;
  speed: number;
  /** Fades in the piece's own time (0 = its first frame); d = 0 means none. */
  fadeIn: { st: number; d: number };
  fadeOut: { st: number; d: number };
  /** Seconds into the exported file. */
  offset: number;
}

/** The part of a clip inside [start, end), or null. */
function piece(p: VideoProject, c: Clip, start: number, end: number): Piece | null {
  const media = mediaOf(p, c.mediaId);
  if (!media || media.missing) return null;
  const a = Math.max(c.start, start);
  const b = Math.min(clipEnd(c), end);
  if (b - a < 1e-3) return null;
  const speed = media.kind === 'image' ? 1 : clamp(speedOf(c), SPEED_MIN, SPEED_MAX);
  const dur = b - a;
  // When the export range cuts into a fade, the rest of it still plays (from the cut point).
  const fi = clamp(c.fadeIn ?? 0, 0, 1e6) - (a - c.start);
  const foStart = clipEnd(c) - clamp(c.fadeOut ?? 0, 0, 1e6) - a;
  const fo = clamp(c.fadeOut ?? 0, 0, 1e6);
  return {
    clip: c,
    media,
    srcIn: sourceAt(c, a),
    dur,
    speed,
    offset: a - start,
    fadeIn: fi > 1e-3 ? { st: 0, d: fi } : { st: 0, d: 0 },
    fadeOut:
      fo > 1e-3 && foStart < dur
        ? foStart >= 0
          ? { st: foStart, d: fo }
          : { st: 0, d: fo + foStart }
        : { st: 0, d: 0 },
  };
}

/** atempo takes 0.5–2 per stage on older FFmpeg builds: chain stages for other speeds. */
function atempo(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2 + 1e-9) {
    out.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5 - 1e-9) {
    out.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${num(s)}`);
  return out;
}

/** Allowed range of each animatable value (the same clamps as the static transform). */
const RANGE: Record<KeyProp, [number, number]> = {
  x: [-10, 10],
  y: [-10, 10],
  scale: [0.01, 20],
  rotation: [-3600, 3600],
  opacity: [0, 1],
};

interface PKey {
  /** Seconds into the piece (its own timeline time from 0). */
  t: number;
  v: number;
  ease?: Ease;
}

/** A property's keys in the piece's own seconds, values clamped; null when not animated. */
function pieceKeys(pc: Piece, prop: KeyProp): PKey[] | null {
  const keys = pc.clip.keyframes?.[prop];
  if (!Array.isArray(keys)) return null;
  const [lo, hi] = RANGE[prop];
  const out = keys
    .filter((k) => k && Number.isFinite(k.t) && Number.isFinite(k.v))
    .slice(0, MAX_KEYS)
    .map((k) => ({
      t: (k.t - pc.srcIn) / pc.speed,
      v: clamp(k.v, lo, hi),
      ease: k.ease === 'ease' || k.ease === 'hold' ? k.ease : undefined,
    }))
    .sort((a, b) => a.t - b.t);
  return out.length ? out : null;
}

/**
 * FFmpeg expression of animated keys over the time variable `T` (e.g. "t" or "(t-2)"): the
 * same curve as interpKeys. Only numbers from num() go in.
 */
export function keyExpr(keys: PKey[], T: string, map: (v: number) => number = (v) => v): string {
  const n = (x: number) => `(${num(x)})`;
  const last = keys[keys.length - 1]!;
  let e = n(map(last.v));
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const d = b.t - a.t;
    let seg: string;
    if (a.ease === 'hold' || d < 1e-6) seg = n(map(a.v));
    else {
      const p = `((${T}-${n(a.t)})/${n(d)})`;
      const k = a.ease === 'ease' ? `(${p}*${p}*(3-2*${p}))` : p;
      seg = `${n(map(a.v))}+${n(map(b.v) - map(a.v))}*${k}`;
    }
    e = `if(lt(${T},${n(b.t)}),${seg},${e})`;
  }
  return `if(lt(${T},${n(keys[0]!.t)}),${n(map(keys[0]!.v))},${e})`;
}

const RAD = Math.PI / 180;

/** Video filters of one clip: size, flips, timing, opacity, rotation, animated size, fades. */
function videoChain(pc: Piece, W: number, H: number, fps: number): string {
  const tr = transformOf(pc.clip);
  const kScale = pieceKeys(pc, 'scale');
  const kRot = pieceKeys(pc, 'rotation');
  const kOp = pieceKeys(pc, 'opacity');
  // Animated size: scale once to the largest key, then shrink per frame (never upscale twice).
  const scale = kScale ? Math.max(...kScale.map((k) => k.v)) : clamp(tr.scale, ...RANGE.scale);
  const f: string[] = [];
  if (pc.media.width > 0 && pc.media.height > 0) {
    const k = Math.min(W / pc.media.width, H / pc.media.height) * scale;
    f.push(`scale=${even(pc.media.width * k)}:${even(pc.media.height * k)}`);
  } else
    f.push(
      `scale=${even(W * scale)}:${even(H * scale)}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    );
  f.push('setsar=1');
  if (tr.flipH === true) f.push('hflip');
  if (tr.flipV === true) f.push('vflip');
  f.push(`fps=${fps}`, 'format=rgba');
  // Timing first: from here on t / T count the piece's own seconds from 0.
  f.push(`setpts=(PTS-STARTPTS)/${num(pc.speed)}`);
  if (kOp)
    f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${keyExpr(kOp, 'T')},0,1)'`);
  else {
    const op = clamp(tr.opacity, ...RANGE.opacity);
    if (op < 1) f.push(`colorchannelmixer=aa=${num(op)}`);
  }
  // c=black@0: a transparent fill (c=none leaves leftovers of earlier frames in the corners).
  if (kRot)
    f.push(`rotate=a='${keyExpr(kRot, 't', (v) => v * RAD)}':ow='hypot(iw,ih)':oh=ow:c=black@0`);
  else {
    const deg = clamp(tr.rotation, ...RANGE.rotation) % 360;
    if (Math.abs(deg) > 1e-3) {
      const rad = num(deg * RAD);
      f.push(`rotate=a=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=black@0`);
    }
  }
  if (kScale) {
    const s = `(${keyExpr(kScale, 't')})/${num(scale)}`;
    f.push(`scale=w='max(2,trunc(iw*${s}/2)*2)':h='max(2,trunc(ih*${s}/2)*2)':eval=frame`);
  }
  if (pc.fadeIn.d) f.push(`fade=t=in:st=${num(pc.fadeIn.st)}:d=${num(pc.fadeIn.d)}:alpha=1`);
  if (pc.fadeOut.d) f.push(`fade=t=out:st=${num(pc.fadeOut.st)}:d=${num(pc.fadeOut.d)}:alpha=1`);
  f.push(`setpts=PTS+${num(pc.offset)}/TB`);
  return f.join(',');
}

/** Overlay position: centred, then shifted by the transform (fractions of the canvas). */
function overlayXY(pc: Piece): string {
  const tr = transformOf(pc.clip);
  // The overlay sees the export's time: the piece's own time is t minus its offset.
  const T = `(t-${num(pc.offset)})`;
  const axis = (prop: 'x' | 'y', size: string, inner: string) => {
    const keys = pieceKeys(pc, prop);
    const v = keys ? `'(${size}-${inner})/2+(${keyExpr(keys, T)})*${size}'` : null;
    return v ?? `(${size}-${inner})/2+${num(clamp(tr[prop], ...RANGE[prop]))}*${size}`;
  };
  return `x=${axis('x', 'W', 'w')}:y=${axis('y', 'H', 'h')}`;
}

function inputArgs(pc: Piece): string[] {
  if (pc.media.kind === 'image') {
    const gif = pc.media.path.toLowerCase().endsWith('.gif');
    return [
      ...(gif ? ['-ignore_loop', '0'] : ['-loop', '1']),
      '-t',
      num(pc.dur),
      '-i',
      pc.media.path,
    ];
  }
  return ['-ss', num(pc.srcIn), '-t', num(pc.dur * pc.speed), '-i', pc.media.path];
}

export function buildRender(
  p: VideoProject,
  o: ExportOptions,
  outPath: string,
  encoder: string[] = x264(o),
): RenderPlan {
  const D = Math.max(0.04, o.end - o.start);
  const W = o.width;
  const H = o.height;
  const fps = o.fps;
  const inputs: string[] = [];
  const graph: string[] = [];
  const audio: string[] = [];
  let n = 0;
  let clips = 0;

  graph.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${num(D)},format=yuv420p[base0]`);
  let base = 'base0';
  let layer = 0;

  const addAudio = (input: number, pc: Piece) => {
    const ms = Math.round(pc.offset * 1000);
    const label = `a${audio.length}`;
    const f = [
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ...atempo(pc.speed),
      `volume=${num(clamp(pc.clip.volume, 0, 2))}`,
      ...(pc.fadeIn.d ? [`afade=t=in:st=${num(pc.fadeIn.st)}:d=${num(pc.fadeIn.d)}`] : []),
      ...(pc.fadeOut.d ? [`afade=t=out:st=${num(pc.fadeOut.st)}:d=${num(pc.fadeOut.d)}`] : []),
      `adelay=${ms}:all=1`,
    ];
    graph.push(`[${input}:a]${f.join(',')}[${label}]`);
    audio.push(label);
  };

  // Video tracks, bottom (V1) to top; their clips bring their own sound unless muted.
  for (const track of compositeOrder(p)) {
    for (const c of p.clips
      .filter((x) => x.trackId === track.id)
      .sort((a, b) => a.start - b.start)) {
      const pc = piece(p, c, o.start, o.end);
      if (!pc) continue;
      const wantVideo = !track.hidden && pc.media.hasVideo;
      const wantAudio =
        !track.muted && pc.media.hasAudio && pc.clip.volume > 0 && pc.media.kind === 'video';
      if (!wantVideo && !wantAudio) continue;
      inputs.push(...inputArgs(pc));
      const i = n++;
      clips++;
      if (wantVideo) {
        const v = `v${i}`;
        const next = `base${++layer}`;
        graph.push(`[${i}:v]${videoChain(pc, W, H, fps)}[${v}]`);
        graph.push(
          `[${base}][${v}]overlay=${overlayXY(pc)}:eof_action=pass:enable='between(t,${num(pc.offset)},${num(pc.offset + pc.dur)})'[${next}]`,
        );
        base = next;
      }
      if (wantAudio) addAudio(i, pc);
    }
  }

  // Audio tracks.
  for (const track of p.tracks.filter((t) => t.kind === 'audio' && !t.muted)) {
    for (const c of p.clips.filter((x) => x.trackId === track.id)) {
      const pc = piece(p, c, o.start, o.end);
      if (!pc || !pc.media.hasAudio || pc.clip.volume <= 0) continue;
      inputs.push(...inputArgs(pc));
      const i = n++;
      clips++;
      addAudio(i, pc);
    }
  }

  graph.push(`[${base}]format=yuv420p[vout]`);
  if (!audio.length) graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${num(D)}[aout]`);
  else if (audio.length === 1) graph.push(`[${audio[0]}]apad,atrim=0:${num(D)}[aout]`);
  else
    graph.push(
      `${audio.map((a) => `[${a}]`).join('')}amix=inputs=${audio.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=0:${num(D)}[aout]`,
    );

  const output = [
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    ...encoder,
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    `${o.audioKbps}k`,
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-t',
    num(D),
    outPath,
  ];
  return { inputs, filter: graph.join(';\n'), output, duration: D, clips };
}

/** Software H.264 (the hardware encoders come with the render queue). */
export function x264(o: Pick<ExportOptions, 'crf' | 'preset'>): string[] {
  return ['-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-pix_fmt', 'yuv420p'];
}
