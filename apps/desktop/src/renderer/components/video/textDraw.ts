/**
 * Draws a title (shared/videoFx.ts TextSpec) on a transparent canvas the size of the frame,
 * centred. The preview composites that canvas like a picture, and the export sends the same
 * drawing as a PNG, so both look the same.
 */
import type { TextFont, TextSpec } from '../../../shared/videoFx';

export const FONT_FAMILY: Record<TextFont, string> = {
  sans: 'Inter, "Segoe UI", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
  display: 'Impact, "Arial Black", "Segoe UI Black", sans-serif',
  hand: '"Segoe Print", "Comic Sans MS", cursive',
};

export function drawText(
  ctx: CanvasRenderingContext2D,
  spec: TextSpec,
  W: number,
  H: number,
): void {
  const px = Math.max(4, spec.size * H);
  ctx.font = `${spec.italic ? 'italic ' : ''}${spec.bold ? '700' : '400'} ${px}px ${FONT_FAMILY[spec.font]}`;
  ctx.textBaseline = 'middle';
  const lines = (spec.content || ' ').split('\n');
  const lh = px * 1.22;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const boxW = Math.max(...widths);
  const boxH = lh * lines.length;
  const pad = spec.bg ? px * 0.35 : 0;
  const left = W / 2 - boxW / 2;
  const top = H / 2 - boxH / 2;
  if (spec.bg) {
    ctx.fillStyle = spec.bg;
    const r = px * 0.18;
    ctx.beginPath();
    ctx.roundRect(left - pad, top - pad * 0.6, boxW + pad * 2, boxH + pad * 1.2, r);
    ctx.fill();
  }
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    const w = widths[i]!;
    const x =
      spec.align === 'left' ? left : spec.align === 'right' ? left + boxW - w : W / 2 - w / 2;
    const y = top + lh * (i + 0.5);
    ctx.save();
    if (spec.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = px * 0.12;
      ctx.shadowOffsetY = px * 0.05;
    }
    if (spec.stroke && spec.stroke.width > 0) {
      ctx.strokeStyle = spec.stroke.color;
      ctx.lineWidth = spec.stroke.width * px;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = spec.color;
    ctx.fillText(line, x, y);
    ctx.restore();
  });
}

/** A canvas of W×H with the title (cached by content and size: titles rarely change). */
const cache = new Map<string, HTMLCanvasElement>();
export function textCanvas(spec: TextSpec, W: number, H: number): HTMLCanvasElement {
  const key = `${W}x${H}|${JSON.stringify(spec)}`;
  let cv = cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (ctx) drawText(ctx, spec, W, H);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    cache.set(key, cv);
  }
  return cv;
}

/** PNG data URLs of every title of a project, at the export size. */
export function textPngs(
  clips: { id: string; text?: TextSpec }[],
  W: number,
  H: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of clips) if (c.text) out[c.id] = textCanvas(c.text, W, H).toDataURL('image/png');
  return out;
}
