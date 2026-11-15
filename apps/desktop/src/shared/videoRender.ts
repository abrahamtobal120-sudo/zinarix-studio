/**
 * Turns a Video Studio project into an FFmpeg command (argument list + filter graph). Pure:
 * the main process runs it with spawn (never a shell), the tests check it directly.
 *
 * Each clip is its own input, already trimmed with -ss/-t (fast and frame-accurate on modern
 * FFmpeg). Video is scaled to fit the canvas, shifted to its timeline time and overlaid on a
 * black base, bottom track first; audio is delayed to its time and mixed.
 */
import type { Clip, ExportOptions, MediaItem, VideoProject } from './video.js';
import {
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

/** Video filters of one clip: size, flips, rotation, opacity, fades and timing. */
function videoChain(pc: Piece, W: number, H: number, fps: number): string {
  const tr = transformOf(pc.clip);
  const scale = clamp(tr.scale, 0.01, 20);
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
  const deg = clamp(tr.rotation, -3600, 3600) % 360;
  if (Math.abs(deg) > 1e-3) {
    const rad = num((deg * Math.PI) / 180);
    f.push(`rotate=a=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=none`);
  }
  const op = clamp(tr.opacity, 0, 1);
  if (op < 1) f.push(`colorchannelmixer=aa=${num(op)}`);
  // Timing first (so the fades below count in the piece's own seconds from 0).
  f.push(`setpts=(PTS-STARTPTS)/${num(pc.speed)}`);
  if (pc.fadeIn.d) f.push(`fade=t=in:st=${num(pc.fadeIn.st)}:d=${num(pc.fadeIn.d)}:alpha=1`);
  if (pc.fadeOut.d) f.push(`fade=t=out:st=${num(pc.fadeOut.st)}:d=${num(pc.fadeOut.d)}:alpha=1`);
  f.push(`setpts=PTS+${num(pc.offset)}/TB`);
  return f.join(',');
}

/** Overlay position: centred, then shifted by the transform (fractions of the canvas). */
function overlayXY(pc: Piece): string {
  const tr = transformOf(pc.clip);
  const dx = clamp(tr.x, -10, 10);
  const dy = clamp(tr.y, -10, 10);
  return `x=(W-w)/2+${num(dx)}*W:y=(H-h)/2+${num(dy)}*H`;
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
