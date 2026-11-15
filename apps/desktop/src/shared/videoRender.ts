/**
 * Turns a Video Studio project into an FFmpeg command (argument list + filter graph). Pure:
 * the main process runs it with spawn (never a shell), the tests check it directly.
 *
 * Each clip is its own input, already trimmed with -ss/-t (fast and frame-accurate on modern
 * FFmpeg). Video is scaled to fit the canvas, shifted to its timeline time and overlaid on a
 * black base, bottom track first; audio is delayed to its time and mixed.
 */
import type { Clip, ExportOptions, MediaItem, VideoProject } from './video.js';
import { clipEnd, compositeOrder, mediaOf } from './video.js';

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

const num = (n: number) => (Math.round(n * 1e6) / 1e6).toString();

interface Piece {
  clip: Clip;
  media: MediaItem;
  /** Seconds into the source. */
  srcIn: number;
  dur: number;
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
  return { clip: c, media, srcIn: c.in + (a - c.start), dur: b - a, offset: a - start };
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
  return ['-ss', num(pc.srcIn), '-t', num(pc.dur), '-i', pc.media.path];
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
    graph.push(
      `[${input}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${num(pc.clip.volume)},adelay=${ms}:all=1[${label}]`,
    );
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
        graph.push(
          `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1,fps=${fps},format=yuva420p,setpts=PTS-STARTPTS+${num(pc.offset)}/TB[${v}]`,
        );
        graph.push(
          `[${base}][${v}]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass:enable='between(t,${num(pc.offset)},${num(pc.offset + pc.dur)})'[${next}]`,
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
