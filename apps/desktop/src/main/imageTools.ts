import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ToolDefinition } from '@omni/shared';
import {
  EDITABLE_EXT,
  MAX_SIDE,
  applyEdit,
  cleanEdit,
  describeEdit,
  editedName,
  flattenOnWhite,
  formatOf,
  autoEdit,
  isIdentity,
  outputSize,
  resizeImage,
  type ImageFormat,
  type Rgba,
} from '../shared/imageEdit.js';
import {
  BG_MODELS,
  applyMask,
  contentBox,
  fillBackdrop,
  isBgModelId,
  maskCoverage,
  parseHex,
} from '../shared/bgRemove.js';
import type { BgRemoveService } from './bgRemove.js';
import type { ComputerShot } from './computerTools.js';
import type { SystemPreview } from './system.js';

/**
 * Fase 1A (plan de funciones): the agent edits pictures of the project with the same pure
 * functions as the image editor (shared/imageEdit.ts). FFmpeg (bundled for Video Studio)
 * decodes the file to raw RGBA and encodes the result, so PNG, JPEG, WebP and BMP all work
 * without a native image library. Reading is free; writing a file is approved with a summary.
 */

/** Pictures bigger than this on disk are refused (the decode would need gigabytes). */
const MAX_FILE = 200 * 1024 * 1024;

export class ImageService {
  /** Fase 1B: background removal on this PC (set by main.ts). */
  bg?: BgRemoveService;

  constructor(private readonly ffmpegPath: () => string | null) {}

  /** RGBA → PNG bytes (for the small pictures the agent gets back). */
  async png(img: Rgba, signal?: AbortSignal): Promise<Buffer> {
    const { out } = await runFfmpeg(
      this.ffmpeg(),
      [
        '-hide_banner',
        '-v',
        'error',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${img.width}x${img.height}`,
        '-i',
        'pipe:0',
        '-frames:v',
        '1',
        '-c:v',
        'png',
        '-f',
        'image2pipe',
        'pipe:1',
      ],
      Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength),
      signal,
    );
    return out;
  }

  private ffmpeg(): string {
    const f = this.ffmpegPath();
    if (!f) throw new Error('FFmpeg is not available, and the image tools need it.');
    return f;
  }

  /** Decodes the first frame of a picture to RGBA. */
  async decode(abs: string, signal?: AbortSignal): Promise<Rgba> {
    const st = await stat(abs);
    if (!st.isFile()) throw new Error('Not a file.');
    if (st.size > MAX_FILE) throw new Error('The picture is too large to edit.');
    const { out, err } = await runFfmpeg(
      this.ffmpeg(),
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        abs,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        'pipe:1',
      ],
      null,
      signal,
    );
    const size = parseSize(err);
    if (!size) throw new Error('FFmpeg did not report the size of the picture.');
    if (size.w > MAX_SIDE || size.h > MAX_SIDE)
      throw new Error(`The picture is larger than ${MAX_SIDE} px on a side.`);
    if (out.length !== size.w * size.h * 4) throw new Error('The picture could not be decoded.');
    return {
      width: size.w,
      height: size.h,
      data: new Uint8ClampedArray(out.buffer, out.byteOffset, out.length),
    };
  }

  /** Encodes RGBA to a file (format from the extension, quality 1–100 for JPEG / WebP). */
  async encode(img: Rgba, abs: string, quality = 92, signal?: AbortSignal): Promise<void> {
    const format = formatOf(abs);
    if (!format) throw new Error('Only .png, .jpg and .webp can be written.');
    const src = format === 'jpg' ? flattenOnWhite(img) : img;
    const q = Math.max(1, Math.min(100, Math.round(quality)));
    const codec: Record<ImageFormat, string[]> = {
      png: ['-c:v', 'png', '-pix_fmt', 'rgba'],
      // -q:v 2 (best) … 31 (worst).
      jpg: [
        '-c:v',
        'mjpeg',
        '-pix_fmt',
        'yuvj444p',
        '-q:v',
        String(Math.round(2 + ((100 - q) / 100) * 29)),
      ],
      webp: ['-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(q)],
    };
    await mkdir(dirname(abs), { recursive: true });
    await runFfmpeg(
      this.ffmpeg(),
      [
        '-hide_banner',
        '-v',
        'error',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${src.width}x${src.height}`,
        '-i',
        'pipe:0',
        '-frames:v',
        '1',
        ...codec[format],
        '-update',
        '1',
        '-y',
        abs,
      ],
      Buffer.from(src.data.buffer, src.data.byteOffset, src.data.byteLength),
      signal,
    );
  }
}

/** "Stream #0:0: Video: png, rgba(pc), 640x480, 25 fps" → 640 × 480. */
export function parseSize(stderr: string): { w: number; h: number } | null {
  for (const line of stderr.split('\n')) {
    if (!/Stream #\d+:\d+.*Video:/.test(line)) continue;
    const m = /[,\s](\d{1,5})x(\d{1,5})[\s,[]/.exec(`${line} `);
    if (m) return { w: Number(m[1]), h: Number(m[2]) };
  }
  return null;
}

function runFfmpeg(
  bin: string,
  args: string[],
  input: Buffer | null,
  signal?: AbortSignal,
): Promise<{ out: Buffer; err: string }> {
  return new Promise((done, fail) => {
    const p = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 120_000);
    const abort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-16_000)));
    p.stdin.on('error', () => {}); // FFmpeg may close stdin early on a bad file
    p.on('error', (e) => (clearTimeout(timer), fail(e)));
    p.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return fail(new Error('Canceled.'));
      if (code === 0) done({ out: Buffer.concat(out), err });
      else fail(new Error(err.trim().split('\n').slice(-3).join('\n') || `ffmpeg exit ${code}`));
    });
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

// ------------------------------------------------------------------- agent tools

const n = (description: string, minimum: number, maximum: number) => ({
  type: 'number',
  minimum,
  maximum,
  description,
});

export const IMAGE_TOOLS: ToolDefinition[] = [
  {
    name: 'image_info',
    description:
      'Size (width × height in pixels), format and file size of a picture of the project (png, jpg, webp, bmp). Call it before image_edit to pick crop coordinates.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path of the picture in the project' } },
      required: ['path'],
    },
  },
  {
    name: 'image_edit',
    description:
      'Edit a picture of the project and save the result: rotate, flip, straighten, crop, resize, exposure, brightness, contrast, highlights, shadows, temperature, hue, saturation, vibrance, black & white, sepia, blur, sharpen, vignette. Applied in that order to the original. auto=true measures the picture and fixes light and colour by itself (other values given are added on top). By default saves a copy next to it ("name-editada.ext"); "out" picks the path (.png, .jpg or .webp) and may be the same file to replace it. The user approves each call.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Picture to edit (png, jpg, webp or bmp)' },
        out: { type: 'string', description: 'Where to save (optional, .png / .jpg / .webp)' },
        rotate: { type: 'integer', enum: [0, 90, 180, 270], description: 'Clockwise degrees' },
        flipH: { type: 'boolean', description: 'Mirror left ↔ right' },
        flipV: { type: 'boolean', description: 'Mirror top ↔ bottom' },
        straighten: n(
          'Small turn to level a horizon, degrees -45…45 (clockwise +); zooms in so no corner is empty, size unchanged',
          -45,
          45,
        ),
        auto: {
          type: 'boolean',
          description: 'Automatic fix of contrast, brightness, colour cast and vibrance',
        },
        crop: {
          type: 'object',
          description: 'Box to keep, in pixels of the rotated picture: x, y (top-left), w, h',
          properties: {
            x: { type: 'integer', minimum: 0 },
            y: { type: 'integer', minimum: 0 },
            w: { type: 'integer', minimum: 1 },
            h: { type: 'integer', minimum: 1 },
          },
          required: ['x', 'y', 'w', 'h'],
        },
        width: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SIDE,
          description: 'Final width in pixels (keeps the proportion when height is left out)',
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SIDE,
          description: 'Final height in pixels (keeps the proportion when width is left out)',
        },
        exposure: n('Stops, -3…3', -3, 3),
        brightness: n('-100…100', -100, 100),
        contrast: n('-100…100', -100, 100),
        highlights: n(
          'Only the bright parts: − recovers a burnt sky, + brightens, -100…100',
          -100,
          100,
        ),
        shadows: n('Only the dark parts: + lifts them, − deepens them, -100…100', -100, 100),
        hue: n('Turn all colours, degrees -180…180', -180, 180),
        vibrance: n('Saturation that spares strong colours and skin, -100…100', -100, 100),
        saturation: n('-100 (grey)…100', -100, 100),
        temperature: n('Cool (−) or warm (+), -100…100', -100, 100),
        grayscale: n('Black & white, 0…100 %', 0, 100),
        sepia: n('0…100 %', 0, 100),
        blur: n('Radius in pixels, 0…50', 0, 50),
        sharpen: n('0…100', 0, 100),
        vignette: n('Darker (+) or lighter (−) corners, -100…100', -100, 100),
        quality: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'JPEG / WebP quality (default 92)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'image_remove_bg',
    description:
      'Remove the background of a picture of the project ON THIS PC (free, nothing is uploaded): keeps the main subject (person, animal, product, object) and makes the rest transparent. Saves a PNG next to it ("name-sin-fondo.png") unless "out" says otherwise. model "fast" (default, ~1 s) or "precise" (finer hair and edges, ~3 s; needs a one-time 179 MB download the user starts in the image editor). background "#rrggbb" puts a solid colour behind instead of transparency (then .jpg is allowed). trim=true crops to the subject. You get back a small preview over a checkerboard to check the cut. The user approves each call.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Picture (png, jpg, webp or bmp)' },
        out: { type: 'string', description: 'Where to save (optional; .png keeps transparency)' },
        model: { type: 'string', enum: ['fast', 'precise'], description: 'Default fast' },
        background: {
          type: 'string',
          description: 'Optional solid colour behind the subject, "#rrggbb"',
        },
        trim: { type: 'boolean', description: 'Crop to the subject (with a small margin)' },
      },
      required: ['path'],
    },
  },
];

export const IMAGE_TOOL_NAMES = new Set(IMAGE_TOOLS.map((t) => t.name));

export const IMAGE_PROMPT_PART =
  '- image_info and image_edit: look at and edit pictures of the project (crop, rotate, straighten, resize, light, colour, filters, vignette, auto fix). image_edit saves a copy unless "out" says otherwise; tell the user the path. image_remove_bg cuts out the subject on this PC (transparent PNG or a solid colour behind); look at the preview it returns. For pictures that do not exist yet use generate_image.';

/** A path of the project (relative or absolute), refused when it leaves the project. */
export function projectPath(root: string, p: unknown): string {
  if (typeof p !== 'string' || !p.trim()) throw new Error('"path" is required.');
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('The picture must be inside the open project.');
  return abs;
}

/** Where image_edit writes (and whether it replaces a file). */
function target(
  root: string,
  a: Record<string, unknown>,
): { src: string; out: string; replaces: boolean } {
  const src = projectPath(root, a.path);
  const ext = src.split('.').pop()?.toLowerCase() ?? '';
  if (!EDITABLE_EXT.has(ext))
    throw new Error('Only png, jpg, webp and bmp pictures can be edited.');
  const out =
    typeof a.out === 'string' && a.out.trim()
      ? projectPath(root, a.out)
      : editedName(src, formatOf(src) ?? 'png');
  if (!formatOf(out)) throw new Error('"out" must end in .png, .jpg or .webp.');
  return { src, out, replaces: existsSync(out) };
}

/** "fotos/gato.jpg" → "fotos/gato-sin-fondo.png". */
export function cutoutName(path: string, ext = 'png'): string {
  return path.replace(/(\.[^./\\]+)?$/, `-sin-fondo.${ext}`);
}

function cutoutTarget(
  root: string,
  a: Record<string, unknown>,
): { src: string; out: string; replaces: boolean } {
  const src = projectPath(root, a.path);
  const ext = src.split('.').pop()?.toLowerCase() ?? '';
  if (!EDITABLE_EXT.has(ext))
    throw new Error('Only png, jpg, webp and bmp pictures can be cut out.');
  if (a.background !== undefined && !parseHex(a.background))
    throw new Error('"background" must be a colour like "#ffffff".');
  if (a.model !== undefined && !isBgModelId(a.model))
    throw new Error('"model" must be "fast" or "precise".');
  const out =
    typeof a.out === 'string' && a.out.trim() ? projectPath(root, a.out) : cutoutName(src);
  const f = formatOf(out);
  if (!f) throw new Error('"out" must end in .png, .jpg or .webp.');
  if (f === 'jpg' && !parseHex(a.background))
    throw new Error('JPEG has no transparency: save as .png, or give a "background" colour.');
  return { src, out, replaces: existsSync(out) };
}

/** The edit asked for, for a picture of w × h (width / height alone keep the proportion). */
export function editFromArgs(a: Record<string, unknown>, w: number, h: number) {
  const base = cleanEdit({ ...a, resize: undefined }, w, h);
  const size = outputSize(w, h, base);
  const W = typeof a.width === 'number' && a.width > 0 ? a.width : undefined;
  const H = typeof a.height === 'number' && a.height > 0 ? a.height : undefined;
  if (!W && !H) return base;
  const rw = W ?? Math.round((size.w * H!) / size.h);
  const rh = H ?? Math.round((size.h * W!) / size.w);
  return cleanEdit({ ...a, resize: { w: rw, h: rh } }, w, h);
}

const rel = (root: string, p: string) => relative(root, p).replace(/\\/g, '/');

/** Approval card of image_edit (null for image_info: reading needs no approval). */
export function imagePreview(
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
): SystemPreview | { error: string } | null {
  if (name === 'image_remove_bg') {
    if (!root) return { error: 'No folder is open in the editor.' };
    try {
      const t = cutoutTarget(root, a);
      const model = a.model === 'precise' ? 'preciso' : 'rápido';
      const colour = parseHex(a.background)
        ? `fondo ${String(a.background)}`
        : 'fondo transparente';
      return {
        risk: t.replaces ? 'high' : 'medium',
        action: `quitar el fondo de ${rel(root, t.src)} → ${rel(root, t.out)}`,
        warning: t.replaces
          ? `Se reemplaza ${rel(root, t.out)} (no se puede deshacer desde el chat).`
          : 'Se hace en esta PC (la foto no se sube) y se guarda una copia nueva; el original no cambia.',
        command: `modelo ${model}, ${colour}${a.trim === true ? ', recortar al sujeto' : ''}`,
        path: rel(root, t.out),
        ...(t.replaces ? {} : { allowKey: 'image_edit:new' }),
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }
  if (name !== 'image_edit') return null;
  if (!root) return { error: 'No folder is open in the editor.' };
  try {
    const t = target(root, a);
    // The real size is only known after decoding; the card shows what was asked.
    const e = cleanEdit({ ...a, resize: undefined }, MAX_SIDE, MAX_SIDE);
    const size =
      typeof a.width === 'number' || typeof a.height === 'number'
        ? `, tamaño ${a.width ?? 'auto'}×${a.height ?? 'auto'}`
        : '';
    return {
      risk: t.replaces ? 'high' : 'medium',
      action: `editar ${rel(root, t.src)} → ${rel(root, t.out)}`,
      warning: t.replaces
        ? `Se reemplaza ${rel(root, t.out)} (no se puede deshacer desde el chat).`
        : 'Se guarda una copia nueva; el original no cambia.',
      command:
        (a.auto === true ? `ajuste automático${isIdentity(e) ? '' : ', '}` : '') +
        (a.auto === true && isIdentity(e) ? '' : describeEdit(e)) +
        size,
      path: rel(root, t.out),
      // A new file only adds; replacing one is asked every time.
      ...(t.replaces ? {} : { allowKey: 'image_edit:new' }),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function runImageTool(
  images: ImageService,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  content: string;
  summary: string;
  image?: ComputerShot;
  changed?: string;
}> {
  if (!root)
    return { ok: false, content: 'No folder is open in the editor.', summary: 'sin carpeta' };
  try {
    if (name === 'image_remove_bg') return await removeBackground(images, a, root, signal);
    if (name === 'image_info') {
      const abs = projectPath(root, a.path);
      const st = await stat(abs);
      const img = await images.decode(abs, signal);
      let opaque = true;
      for (let i = 3; i < img.data.length; i += 4)
        if (img.data[i]! < 255) {
          opaque = false;
          break;
        }
      return {
        ok: true,
        content: `${rel(root, abs)}: ${img.width} × ${img.height} px, ${(st.size / 1024).toFixed(1)} KB, ${opaque ? 'no transparency' : 'has transparency'}.`,
        summary: `${img.width}×${img.height}`,
      };
    }
    if (name === 'image_edit') {
      const t = target(root, a);
      const img = await images.decode(t.src, signal);
      let edit = editFromArgs(a, img.width, img.height);
      if (a.auto === true) {
        // The automatic values, with what the call also asked added on top.
        const fix = autoEdit(img);
        const sum: Record<string, unknown> = { ...fix, ...edit };
        for (const [k, v] of Object.entries(fix))
          if (typeof v === 'number' && typeof edit[k as keyof typeof edit] === 'number')
            sum[k] = v + (edit[k as keyof typeof edit] as number);
        edit = cleanEdit(sum, img.width, img.height);
      }
      if (isIdentity(edit) && t.out === t.src)
        return {
          ok: false,
          content: 'Nothing to change: give at least one edit.',
          summary: 'sin cambios',
        };
      const res = applyEdit(img, edit);
      const quality = typeof a.quality === 'number' ? a.quality : 92;
      await images.encode(res, t.out, quality, signal);
      return {
        ok: true,
        content: `Saved ${rel(root, t.out)} (${res.width} × ${res.height} px): ${describeEdit(edit)}.`,
        summary: `${rel(root, t.out)} · ${res.width}×${res.height}`,
      };
    }
    return { ok: false, content: `Unknown image tool ${name}`, summary: 'desconocida' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, content: `Image tool failed: ${msg}`, summary: 'falló' };
  }
}

/** A checkerboard behind transparent pixels, so a preview shows what was cut. */
function overChecker(img: Rgba): Rgba {
  const d = new Uint8ClampedArray(img.data);
  for (let y = 0, p = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++, p += 4) {
      const a = d[p + 3]! / 255;
      const c = ((x >> 3) + (y >> 3)) % 2 ? 204 : 255;
      d[p] = d[p]! * a + c * (1 - a);
      d[p + 1] = d[p + 1]! * a + c * (1 - a);
      d[p + 2] = d[p + 2]! * a + c * (1 - a);
      d[p + 3] = 255;
    }
  return { width: img.width, height: img.height, data: d };
}

/** The part of a picture inside a box (copied). */
function cropBox(img: Rgba, b: { x: number; y: number; w: number; h: number }): Rgba {
  const d = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) {
    const from = ((b.y + y) * img.width + b.x) * 4;
    d.set(img.data.subarray(from, from + b.w * 4), y * b.w * 4);
  }
  return { width: b.w, height: b.h, data: d };
}

async function removeBackground(
  images: ImageService,
  a: Record<string, unknown>,
  root: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  content: string;
  summary: string;
  image?: ComputerShot;
  changed?: string;
}> {
  const bg = images.bg;
  if (!bg?.available)
    return {
      ok: false,
      content: 'Background removal is not available in this installation.',
      summary: 'no disponible',
    };
  const t = cutoutTarget(root, a);
  const model = a.model === 'precise' ? 'precise' : 'fast';
  if (!bg.modelPath(model))
    return {
      ok: false,
      content:
        model === 'precise'
          ? `The precise model is not downloaded (${Math.round(BG_MODELS.precise.bytes / 1e6)} MB). Use model "fast", or ask the user to download it once from the image editor ("Quitar fondo" → "Preciso").`
          : 'The fast background model is missing in this installation.',
      summary: 'falta el modelo',
    };
  const img = await images.decode(t.src, signal);
  const t0 = Date.now();
  const mask = await bg.mask(img, model, signal);
  const share = maskCoverage(mask);
  if (share < 0.002)
    return {
      ok: false,
      content: 'No clear subject was found in the picture: nothing was saved.',
      summary: 'sin sujeto',
    };
  let out = applyMask(img, mask);
  if (a.trim === true) {
    const box = contentBox(out, Math.round(Math.max(out.width, out.height) * 0.02));
    if (box) out = cropBox(out, box);
  }
  const colour = parseHex(a.background) ? String(a.background) : null;
  if (colour) out = fillBackdrop(out, colour);
  await images.encode(out, t.out, 92, signal);
  const k = Math.min(1, 512 / Math.max(out.width, out.height));
  const small = k < 1 ? resizeImage(out, out.width * k, out.height * k) : out;
  const png = await images.png(colour ? small : overChecker(small), signal);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  return {
    ok: true,
    content: `Saved ${rel(root, t.out)} (${out.width} × ${out.height} px, ${colour ? `background ${colour}` : 'transparent background'}). The subject covers ${Math.round(share * 100)} % of the original picture. Model ${model}, ${secs} s. The preview shows the result${colour ? '' : ' over a checkerboard (= transparent)'}.`,
    summary: `${rel(root, t.out)} · ${out.width}×${out.height}`,
    changed: t.out,
    image: {
      mediaType: 'image/png',
      data: png.toString('base64'),
      width: small.width,
      height: small.height,
    },
  };
}
