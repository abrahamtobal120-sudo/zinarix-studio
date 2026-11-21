import type { BgModelId } from '../../../shared/bgRemove';
import type { ImageEdit, ImageFormat } from '../../../shared/imageEdit';

/** Messages between the image editor and its worker (all pixel work runs off the UI thread). */
export type ImageRequest =
  /** The decoded file; the worker keeps the full picture and makes the preview copy. */
  | { kind: 'init'; id: number; bitmap: ImageBitmap; previewSide: number; maxSide: number }
  /** The preview with an edit (or untouched, to compare), plus its histogram. */
  | { kind: 'render'; id: number; edit: ImageEdit; original: boolean }
  /** The "Auto" fix measured on the preview. */
  | { kind: 'auto'; id: number }
  /** The full-size picture with the edit, encoded. */
  | { kind: 'save'; id: number; edit: ImageEdit; format: ImageFormat; quality: number }
  /** Fase 1B: the background model's input, made from the original picture. */
  | { kind: 'cutoutInput'; id: number; model: BgModelId }
  /** Fase 1B: the model's output; the worker keeps it as the mask (full size and preview). */
  | { kind: 'setMask'; id: number; output: Float32Array; side: number };

export type ImageResponse =
  | { kind: 'init'; id: number; width: number; height: number; scale: number }
  | {
      kind: 'render';
      id: number;
      width: number;
      height: number;
      data: ArrayBuffer;
      /** r, g, b, luminance: 256 counts each. */
      hist: ArrayBuffer;
    }
  | { kind: 'auto'; id: number; edit: ImageEdit }
  | { kind: 'save'; id: number; bytes: ArrayBuffer; width: number; height: number }
  | { kind: 'cutoutInput'; id: number; input: Float32Array }
  | { kind: 'setMask'; id: number; coverage: number }
  | { kind: 'error'; id: number; message: string; code?: 'tooBig' };
