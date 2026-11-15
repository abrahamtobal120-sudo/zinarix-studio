/**
 * Turns a Video Studio project into an FFmpeg command (argument list + filter graph). Pure:
 * the main process runs it with spawn (never a shell), the tests check it directly.
 *
 * Each clip is its own input, already trimmed with -ss/-t (fast and frame-accurate on modern
 * FFmpeg). Video is scaled to fit the canvas, shifted to its timeline time and overlaid on a
 * black base, bottom track first; audio is delayed to its time and mixed.
 *
 * Phase 2: colour effects, titles (pictures the renderer draws, passed in `textImages`),
 * in/out animations and transitions (the outgoing clip runs on under the incoming one), and
 * the track mixer (volume, pan, solo).
 */
import type { Clip, Ease, ExportOptions, KeyProp, MediaItem, Track, VideoProject } from './video.js';
import {
  MAX_KEYS,
  SPEED_MAX,
  SPEED_MIN,
  clipEnd,
  compositeOrder,
  leadOf,
  mediaOf,
  sourceAt,
  speedOf,
  tailOf,
  trackAudible,
  trackPan,
  trackVolume,
  transformOf,
  transitionWindow,
} from './video.js';
import type { LookExpr } from './videoFx.js';
import { animLengths, combineExpr, ffmpegEffects, windowExpr } from './videoFx.js';

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
  /** Seconds into the source at the piece's first frame (may lie outside the media). */
  srcIn: number;
  /** The part actually read from the file: -ss / -t. */
  readIn: number;
  readLen: number;
  /** Frames repeated before / after it (transitions running past the media), piece seconds. */
  padStart: number;
  padEnd: number;
  /** Seconds on the timeline (the source part is dur × speed). */
  dur: number;
  speed: number;
  /** Fades in the piece's own time (0 = its first frame); d = 0 means none. */
  fadeIn: { st: number; d: number };
  fadeOut: { st: number; d: number };
  /** Seconds into the exported file. */
  offset: number;
  /** Timeline time of the piece's first frame. */
  at: number;
}

/**
 * The part of a clip inside [start, end), or null. `lead` / `tail` extend it before its start
 * and after its end (transitions).
 */
function piece(
  p: VideoProject,
  c: Clip,
  start: number,
  end: number,
  media: MediaItem | undefined,
  lead = 0,
  tail = 0,
): Piece | null {
  if (!media || media.missing) return null;
  const a = Math.max(c.start - lead, start);
  const b = Math.min(clipEnd(c) + tail, end);
  if (b - a < 1e-3) return null;
  const still = media.kind === 'image';
  const speed = still ? 1 : clamp(speedOf(c), SPEED_MIN, SPEED_MAX);
  const dur = b - a;
  const srcIn = sourceAt(c, a);
  let readIn = srcIn;
  let readLen = dur * speed;
  let padStart = 0;
  let padEnd = 0;
  if (!still) {
    const srcOut = srcIn + dur * speed;
    const mediaEnd = media.duration > 0 ? media.duration : srcOut;
    readIn = Math.max(0, srcIn);
    let readOut = Math.min(srcOut, mediaEnd);
    // Always read a few frames, even when the whole piece lies past the media.
    if (readOut - readIn < 0.1) {
      readIn = Math.max(0, Math.min(readIn, mediaEnd - 0.1));
      readOut = Math.max(readIn + 0.04, Math.min(mediaEnd, readIn + 0.1));
    }
    readLen = readOut - readIn;
    padStart = Math.max(0, (readIn - srcIn) / speed);
    padEnd = Math.max(0, dur - padStart - readLen / speed);
  }
  // Fades sit on the clip's own ends. When the export range cuts into one, the rest of it
  // still plays (from the cut point).
  const fi = clamp(c.fadeIn ?? 0, 0, 1e6);
  const fo = clamp(c.fadeOut ?? 0, 0, 1e6);
  const fiSt = c.start - a;
  const fiLeft = fi + Math.min(0, fiSt);
  const foSt = clipEnd(c) - fo - a;
  return {
    clip: c,
    media,
    srcIn,
    readIn,
    readLen,
    padStart,
    padEnd,
    dur,
    speed,
    offset: a - start,
    at: a,
    fadeIn: fi > 1e-3 && fiLeft > 1e-3 ? { st: Math.max(0, fiSt), d: fiLeft } : { st: 0, d: 0 },
    fadeOut:
      fo > 1e-3 && foSt < dur
        ? foSt >= 0
          ? { st: foSt, d: fo }
          : { st: 0, d: fo + foSt }
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

/**
 * The animation and transition looks of a piece over a time variable (its own seconds), or {}
 * when it has none. Only known kinds and numbers reach the expressions.
 */
function looksOf(p: VideoProject, pc: Piece, T: string): LookExpr {
  const c = pc.clip;
  const parts: LookExpr[] = [];
  const len = clipEnd(c) - c.start;
  const { inD, outD } = animLengths(c.anim, len);
  if (inD > 1e-6) parts.push(windowExpr(c.anim!.in, T, c.start - pc.at, inD, true));
  if (outD > 1e-6) parts.push(windowExpr(c.anim!.out, T, clipEnd(c) - outD - pc.at, outD, false));
  const w = transitionWindow(p, c);
  if (w) parts.push(windowExpr(c.transition!.kind, T, w.from - pc.at, w.d, true));
  return combineExpr(parts);
}

/** Largest size the looks can reach (scale once to it, then shrink per frame). */
function maxLookScale(c: Clip): number {
  const kinds = [c.anim?.in, c.anim?.out, c.transition?.kind];
  if (kinds.includes('zoom')) return 1.4;
  if (kinds.includes('zoomIn')) return 1.25;
  return 1;
}

/** Video filters of one clip: size, flips, effects, timing, opacity, rotation, size, fades. */
function videoChain(p: VideoProject, pc: Piece, W: number, H: number, fps: number): string {
  const tr = transformOf(pc.clip);
  const kScale = pieceKeys(pc, 'scale');
  const kRot = pieceKeys(pc, 'rotation');
  const kOp = pieceKeys(pc, 'opacity');
  const lookT = looksOf(p, pc, 'T');
  const lookt = looksOf(p, pc, 't');
  const base = kScale ? Math.max(...kScale.map((k) => k.v)) : clamp(tr.scale, ...RANGE.scale);
  // Animated size: scale once to the largest size, then shrink per frame (never upscale twice).
  const scale = base * (lookt.scale ? maxLookScale(pc.clip) : 1);
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
  f.push(...ffmpegEffects(pc.clip.effects, H / 1080));
  // Timing first: from here on t / T count the piece's own seconds from 0.
  f.push(`setpts=(PTS-STARTPTS)/${num(pc.speed)}`);
  if (pc.padStart > 1e-3 || pc.padEnd > 1e-3)
    f.push(
      `tpad=start_duration=${num(pc.padStart)}:start_mode=clone:stop_duration=${num(pc.padEnd + 0.1)}:stop_mode=clone`,
    );
  const op = clamp(tr.opacity, ...RANGE.opacity);
  if (kOp || lookT.alpha || lookT.reveal) {
    const a: string[] = ['alpha(X,Y)'];
    if (kOp) a.push(`clip(${keyExpr(kOp, 'T')},0,1)`);
    else if (op < 1) a.push(num(op));
    if (lookT.alpha) a.push(lookT.alpha);
    if (lookT.reveal) a.push(`lte(X,W*${lookT.reveal})`);
    f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${a.join('*')}'`);
  } else if (op < 1) f.push(`colorchannelmixer=aa=${num(op)}`);
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
  if (kScale || lookt.scale) {
    const parts = [kScale ? `(${keyExpr(kScale, 't')})` : num(base), lookt.scale].filter(Boolean);
    const s = `(${parts.join('*')})/${num(scale)}`;
    f.push(`scale=w='max(2,trunc(iw*${s}/2)*2)':h='max(2,trunc(ih*${s}/2)*2)':eval=frame`);
  }
  if (pc.fadeIn.d) f.push(`fade=t=in:st=${num(pc.fadeIn.st)}:d=${num(pc.fadeIn.d)}:alpha=1`);
  if (pc.fadeOut.d) f.push(`fade=t=out:st=${num(pc.fadeOut.st)}:d=${num(pc.fadeOut.d)}:alpha=1`);
  f.push(`setpts=PTS+${num(pc.offset)}/TB`);
  return f.join(',');
}

/** Overlay position: centred, then shifted by the transform and the looks (canvas shares). */
function overlayXY(p: VideoProject, pc: Piece): string {
  const tr = transformOf(pc.clip);
  // The overlay sees the export's time: the piece's own time is t minus its offset.
  const T = `(t-${num(pc.offset)})`;
  const look = looksOf(p, pc, T);
  const axis = (prop: 'x' | 'y', size: string, inner: string, extra: string | undefined) => {
    const keys = pieceKeys(pc, prop);
    const v = keys ? `(${keyExpr(keys, T)})` : num(clamp(tr[prop], ...RANGE[prop]));
    if (!keys && !extra) return `(${size}-${inner})/2+${v}*${size}`;
    return `'(${size}-${inner})/2+${v}*${size}${extra ? `+${extra}*${size}` : ''}'`;
  };
  return `x=${axis('x', 'W', 'w', look.dx)}:y=${axis('y', 'H', 'h', look.dy)}`;
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
  return ['-ss', num(pc.readIn), '-t', num(pc.readLen), '-i', pc.media.path];
}

/** A title drawn by the renderer as a canvas-size transparent PNG. */
function textMedia(c: Clip, path: string, W: number, H: number): MediaItem {
  return {
    id: `text-${c.id}`,
    path,
    name: 'text.png',
    kind: 'image',
    duration: 0,
    width: W,
    height: H,
    fps: 0,
    hasVideo: true,
    hasAudio: false,
    size: 0,
  };
}

/** Pan as a balance: the far side gets quieter, the near one keeps its level. */
function panFilter(pan: number): string[] {
  const v = clamp(pan, -1, 1);
  if (Math.abs(v) < 1e-3) return [];
  const l = num(Math.min(1, 1 - v));
  const r = num(Math.min(1, 1 + v));
  return [`pan=stereo|c0=${l}*c0|c1=${r}*c1`];
}

export function buildRender(
  p: VideoProject,
  o: ExportOptions,
  outPath: string,
  encoder: string[] = x264(o),
  /** Clip id → PNG of each title, drawn at the export size. */
  textImages: Record<string, string> = {},
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

  const addAudio = (input: number, pc: Piece, track: Track) => {
    const ms = Math.round(pc.offset * 1000);
    const label = `a${audio.length}`;
    const vol = clamp(pc.clip.volume, 0, 2) * clamp(trackVolume(track), 0, 2);
    const f = [
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ...atempo(pc.speed),
      `volume=${num(vol)}`,
      ...panFilter(trackPan(track)),
      ...(pc.fadeIn.d ? [`afade=t=in:st=${num(pc.fadeIn.st)}:d=${num(pc.fadeIn.d)}`] : []),
      ...(pc.fadeOut.d ? [`afade=t=out:st=${num(pc.fadeOut.st)}:d=${num(pc.fadeOut.d)}`] : []),
      `adelay=${ms}:all=1`,
    ];
    graph.push(`[${input}:a]${f.join(',')}[${label}]`);
    audio.push(label);
  };

  // Video tracks, bottom (V1) to top; their clips bring their own sound unless muted.
  for (const track of compositeOrder(p)) {
    const heard = trackAudible(p, track) && trackVolume(track) > 0;
    for (const c of p.clips
      .filter((x) => x.trackId === track.id)
      .sort((a, b) => a.start - b.start)) {
      const textPath = c.text ? textImages[c.id] : undefined;
      const media = c.text
        ? textPath
          ? textMedia(c, textPath, W, H)
          : undefined
        : mediaOf(p, c.mediaId);
      // Sound: only the clip itself. Picture: plus what transitions add on either side.
      const pcA = piece(p, c, o.start, o.end, media);
      const pcV = piece(p, c, o.start, o.end, media, leadOf(p, c), tailOf(p, c));
      if (!pcV || !media) continue;
      const wantVideo = !track.hidden && media.hasVideo;
      const wantAudio =
        !!pcA && heard && media.hasAudio && c.volume > 0 && media.kind === 'video';
      if (!wantVideo && !wantAudio) continue;
      if (wantVideo) {
        inputs.push(...inputArgs(pcV));
        const i = n++;
        clips++;
        const v = `v${i}`;
        const next = `base${++layer}`;
        graph.push(`[${i}:v]${videoChain(p, pcV, W, H, fps)}[${v}]`);
        graph.push(
          `[${base}][${v}]overlay=${overlayXY(p, pcV)}:eof_action=pass:enable='between(t,${num(pcV.offset)},${num(pcV.offset + pcV.dur)})'[${next}]`,
        );
        base = next;
      }
      if (wantAudio) {
        // Its own input when the picture reads a longer stretch (or is not drawn at all).
        const same = wantVideo && pcV.readIn === pcA.readIn && pcV.readLen === pcA.readLen;
        let i = n - 1;
        if (!same) {
          inputs.push(...inputArgs(pcA));
          i = n++;
          if (!wantVideo) clips++;
        }
        addAudio(i, pcA, track);
      }
    }
  }

  // Audio tracks.
  for (const track of p.tracks.filter((t) => t.kind === 'audio')) {
    if (!trackAudible(p, track) || trackVolume(track) <= 0) continue;
    for (const c of p.clips.filter((x) => x.trackId === track.id)) {
      const pc = piece(p, c, o.start, o.end, mediaOf(p, c.mediaId));
      if (!pc || !pc.media.hasAudio || pc.clip.volume <= 0) continue;
      inputs.push(...inputArgs(pc));
      const i = n++;
      clips++;
      addAudio(i, pc, track);
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
