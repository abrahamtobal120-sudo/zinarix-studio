/**
 * Fase 11B: where the preview draws one layer, as plain numbers. player.ts paints with these on
 * its canvas and the parity test (test/videoParity.test.ts) paints with the very same numbers in
 * software, so the test checks the player's own maths against the FFmpeg export.
 */
import type { Clip } from './video.js';
import { fadeAt, transformAt } from './video.js';
import type { Look } from './videoFx.js';
import { typewriterAt } from './videoTypewriter.js';

export interface LayerPlacement {
  /** 0–1, already including the transform, the fades and the looks. */
  alpha: number;
  /** Centre of the drawn picture, in frame pixels. */
  cx: number;
  cy: number;
  /** Drawn size in frame pixels. */
  dw: number;
  dh: number;
  /** Degrees. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** 0–1: share of the picture shown from its left edge (wipes, typewriter). */
  reveal: number;
}

/**
 * The placement of a clip's picture (w×h source pixels) on a W×H frame at time t, with its
 * look (visualAt) or null when nothing is drawn. `stops`: typewriter letter ends of a title.
 */
export function layerPlacement(
  c: Clip,
  t: number,
  look: Look,
  W: number,
  H: number,
  w: number,
  h: number,
  stops?: readonly number[],
): LayerPlacement | null {
  if (!w || !h) return null;
  const tr = transformAt(c, t);
  const tw = stops ? typewriterAt(c, t, stops) : null;
  const reveal = tw === null ? look.reveal : Math.min(look.reveal, tw);
  const alpha = tr.opacity * fadeAt(c, t) * look.alpha;
  if (alpha <= 0 || reveal <= 0) return null;
  const k = Math.min(W / w, H / h) * tr.scale * look.scale;
  return {
    alpha: Math.min(1, alpha),
    cx: W / 2 + (tr.x + look.dx) * W,
    cy: H / 2 + (tr.y + look.dy) * H,
    dw: w * k,
    dh: h * k,
    rotation: tr.rotation,
    flipH: !!tr.flipH,
    flipV: !!tr.flipV,
    reveal,
  };
}
