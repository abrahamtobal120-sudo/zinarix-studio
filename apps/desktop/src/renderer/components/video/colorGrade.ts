/**
 * Fase 12, preview side of the colour grade: the LUT files (read once through IPC, parsed and
 * cached) and the CPU pass that grades a layer before it is composited. Same maths as the
 * export (shared/videoColor.ts): 8-bit tables for the wheels, trilinear LUT, strength mixed in.
 */
import type { ColorGrade, Lut3D } from '../../../shared/videoColor';
import { cleanGrade, gradeHasCurves, gradePixels, gradeTables, lutKey, mixLut, parseCube } from '../../../shared/videoColor';
import { api } from '../../store';

type Entry = { state: 'loading' } | { state: 'ready'; lut: Lut3D } | { state: 'error'; error: string };
const files = new Map<string, Entry>();
/** lutKey → the LUT at that strength. */
const mixed = new Map<string, Lut3D>();
const listeners = new Set<() => void>();

/** Called when a LUT finishes loading (the player repaints, the panel refreshes). */
export function onLutLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Starts loading a LUT file if needed; resolves to an error message or null. */
export async function loadLut(path: string): Promise<string | null> {
  const have = files.get(path);
  if (have?.state === 'ready') return null;
  if (have?.state === 'error') return have.error;
  if (!have) {
    files.set(path, { state: 'loading' });
    try {
      const lut = parseCube(await api().video.readLut(path));
      files.set(path, { state: 'ready', lut });
    } catch (e) {
      files.set(path, { state: 'error', error: (e as Error).message });
    }
    for (const fn of listeners) fn();
  }
  const now = files.get(path);
  return now?.state === 'error' ? now.error : null;
}

/** Forgets a LUT (e.g. the user picked the file again after fixing it). */
export function reloadLut(path: string): void {
  files.delete(path);
  for (const k of [...mixed.keys()]) if (k.endsWith(`|${path}`)) mixed.delete(k);
}

export function lutState(path: string): Entry | undefined {
  return files.get(path);
}

/** The LUT a grade needs at its strength: null when none, 'wait' while it loads or failed. */
function lutFor(g: ColorGrade): Lut3D | null | 'wait' {
  if (!g.lut) return null;
  const key = lutKey(g)!;
  const hit = mixed.get(key);
  if (hit) return hit;
  const f = files.get(g.lut);
  if (!f) {
    void loadLut(g.lut);
    return 'wait';
  }
  if (f.state !== 'ready') return 'wait';
  const m = mixLut(f.lut, g.lutMix ?? 1);
  mixed.set(key, m);
  return m;
}

/** Tables are cheap but not free: keep the last few grades. */
const tableCache = new Map<string, ReturnType<typeof gradeTables>>();
function tablesFor(g: ColorGrade) {
  if (!gradeHasCurves(g)) return null;
  const key = JSON.stringify({ ...g, lut: undefined, lutMix: undefined });
  let t = tableCache.get(key);
  if (!t) {
    t = gradeTables(g);
    if (tableCache.size > 64) tableCache.clear();
    tableCache.set(key, t);
  }
  return t;
}

/** Whether a clip's look depends on a LUT that is still loading (part of the redraw key). */
export function gradePending(g: ColorGrade | undefined): boolean {
  const e = cleanGrade(g);
  return !!e?.lut && lutFor(e) === 'wait' && files.get(e.lut)?.state !== 'error';
}

let work: HTMLCanvasElement | null = null;

/**
 * The layer graded on a scratch canvas of w × h pixels (the size it is drawn at, capped while
 * playing), or null when the clip has no grade or the pixels cannot be read.
 */
export function gradedLayer(
  src: CanvasImageSource,
  g: ColorGrade | undefined,
  w: number,
  h: number,
): HTMLCanvasElement | null {
  const e = cleanGrade(g);
  if (!e) return null;
  const tables = tablesFor(e);
  const lut = lutFor(e);
  if (!tables && (lut === null || lut === 'wait')) return null;
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  work ??= document.createElement('canvas');
  if (work.width !== W || work.height !== H) {
    work.width = W;
    work.height = H;
  }
  const ctx = work.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(src, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    gradePixels(img.data, tables, lut === 'wait' ? null : lut);
    ctx.putImageData(img, 0, 0);
    return work;
  } catch {
    // A picture the canvas may not read (should not happen with zmedia://): show it ungraded.
    return null;
  }
}
