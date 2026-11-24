import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ToolDefinition } from '@omni/shared';
import {
  MAX_DESIGN_SIDE,
  PALETTES,
  TEMPLATES,
  buildTemplate,
  slugify,
  svgSize,
  uniqueName,
} from '../shared/graphics.js';
import type { ComputerShot } from './computerTools.js';
import type { Raster } from './svgRaster.js';
import type { SystemPreview } from './system.js';

/**
 * Fase 3 (plan de funciones): designs, logos and graphics as editable SVG files. The model
 * writes the SVG (write_file) or starts from a template (design_new), looks at the result
 * with svg_render (it gets the picture back) and exports PNG / JPEG with svg_export. The
 * user edits the same files in the design editor (shapes, text, layers).
 */

const MAX_SVG = 20 * 1024 * 1024;
/** Longest side of the picture the model gets back from svg_render. */
const VIEW_SIDE = 1024;
const DESIGN_DIR = 'disenos';

export const GRAPHICS_TOOLS: ToolDefinition[] = [
  {
    name: 'design_templates',
    description:
      'List the design templates (Instagram post and story, YouTube thumbnail, business card, logo, poster, slide, cover banner, blank) with their size in px, and the colour palettes. Use the ids with design_new.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'design_new',
    description:
      'Create a new editable design (SVG) of the project from a template, with your texts and a palette, and open it for the user in the design editor. Default path: disenos/<template>.svg (a free name). Then refine it with write_file / edit_file and check it with svg_render.',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: TEMPLATES.map((t) => t.id) },
        palette: { type: 'string', enum: PALETTES.map((p) => p.id) },
        title: { type: 'string', description: 'Main text ("\\n" breaks the line)' },
        subtitle: { type: 'string', description: 'Second text' },
        width: {
          type: 'integer',
          minimum: 16,
          maximum: MAX_DESIGN_SIDE,
          description: 'Only to change the template size',
        },
        height: { type: 'integer', minimum: 16, maximum: MAX_DESIGN_SIDE },
        path: { type: 'string', description: 'Where to save it (.svg, inside the project)' },
        overwrite: {
          type: 'boolean',
          description: 'Replace the file if it exists (asked to the user)',
        },
      },
      required: ['template'],
    },
  },
  {
    name: 'svg_render',
    description:
      'Draw an SVG file of the project and look at it (you get the picture back, up to 1024 px on its longest side), with its size, or the XML error when it does not open. Use it after writing or changing a logo or design to check how it looks.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        width: {
          type: 'integer',
          minimum: 16,
          maximum: VIEW_SIDE,
          description: 'Width of the picture you get (default: fit 1024)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'svg_export',
    description:
      'Export an SVG of the project as PNG or JPEG (e.g. a logo for a website, a post ready to upload). Default: <name>.png next to it, at the natural size × scale.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        out: { type: 'string', description: 'Output file (.png / .jpg) inside the project' },
        scale: { type: 'number', minimum: 0.1, maximum: 8, description: 'Size × this (default 1)' },
        width: {
          type: 'integer',
          minimum: 1,
          maximum: 8192,
          description: 'Exact width (the height keeps the proportion)',
        },
        background: {
          type: 'string',
          description: 'Background color like "#ffffff" (PNG is transparent by default)',
        },
      },
      required: ['path'],
    },
  },
];

export const GRAPHICS_TOOL_NAMES = new Set(GRAPHICS_TOOLS.map((t) => t.name));
/** Need no approval. */
export const GRAPHICS_READ_ONLY = new Set(['design_templates', 'svg_render']);

export const GRAPHICS_PROMPT_PART =
  '- Logos, designs and graphics are SVG files the user edits in the design editor (shapes, text, layers). For a logo, post, thumbnail, card or poster: start from a template with design_new or write the SVG yourself with write_file — keep it editable: width/height and viewBox, real <text> (not outlined paths), parts in <g data-name="…"> with readable names, gradients in <defs>, no scripts, no external images or fonts (system fonts like Segoe UI, Arial, Georgia, Impact). Always check it with svg_render and fix what looks wrong; svg_export makes a PNG / JPEG.';

function projectFile(root: string, p: unknown, what = '"path"'): string {
  if (typeof p !== 'string' || !p.trim()) throw new Error(`${what} is required.`);
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const r = relative(root, abs);
  if (!r || r.startsWith('..') || isAbsolute(r))
    throw new Error('The file must be inside the open project.');
  return abs;
}

const rel = (root: string, p: string): string => relative(root, p).replace(/\\/g, '/');

/** Where design_new writes. */
function newTarget(root: string, a: Record<string, unknown>): { out: string; replaces: boolean } {
  if (typeof a.path === 'string' && a.path.trim()) {
    const out = projectFile(root, a.path);
    if (!/\.svg$/i.test(out)) throw new Error('"path" must end in .svg.');
    const replaces = existsSync(out);
    if (replaces && a.overwrite !== true)
      throw new Error(
        `${rel(root, out)} already exists. Pick another path or pass overwrite: true.`,
      );
    return { out, replaces };
  }
  const dir = resolve(root, DESIGN_DIR);
  const name = uniqueName(slugify(String(a.template ?? 'diseno')), 'svg', (n) =>
    existsSync(resolve(dir, n)),
  );
  return { out: resolve(dir, name), replaces: false };
}

function exportTarget(
  root: string,
  a: Record<string, unknown>,
): { src: string; out: string; mime: 'image/png' | 'image/jpeg'; replaces: boolean } {
  const src = projectFile(root, a.path);
  if (!/\.svg$/i.test(src)) throw new Error('Only .svg files can be exported.');
  const out =
    typeof a.out === 'string' && a.out.trim()
      ? projectFile(root, a.out, '"out"')
      : src.replace(/\.svg$/i, '.png');
  const mime = /\.png$/i.test(out) ? 'image/png' : /\.jpe?g$/i.test(out) ? 'image/jpeg' : null;
  if (!mime) throw new Error('"out" must end in .png or .jpg.');
  return { src, out, mime, replaces: existsSync(out) };
}

/** Output size of svg_export. */
export function exportSize(
  natural: { width: number; height: number },
  a: Record<string, unknown>,
): { width: number; height: number } {
  let w = natural.width;
  let h = natural.height;
  if (typeof a.width === 'number' && a.width > 0) {
    h = (h * a.width) / w;
    w = a.width;
  } else if (typeof a.scale === 'number' && a.scale > 0) {
    w *= a.scale;
    h *= a.scale;
  }
  const big = Math.max(w, h);
  if (big > 8192) {
    w = (w * 8192) / big;
    h = (h * 8192) / big;
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/** Approval card (null = runs without asking). */
export function graphicsPreview(
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
): SystemPreview | { error: string } | null {
  if (GRAPHICS_READ_ONLY.has(name)) return null;
  if (!root) return { error: 'No folder is open in the editor.' };
  try {
    if (name === 'design_new') {
      const t = newTarget(root, a);
      buildTemplate({
        template: String(a.template ?? ''),
        palette: a.palette as string | undefined,
      });
      return {
        risk: t.replaces ? 'high' : 'medium',
        action: `crear diseño ${rel(root, t.out)}`,
        warning: t.replaces ? `Se reemplaza ${rel(root, t.out)}.` : 'Se crea un archivo nuevo.',
        command: `plantilla ${String(a.template)}${a.palette ? `, colores ${String(a.palette)}` : ''}`,
        path: rel(root, t.out),
        ...(t.replaces ? {} : { allowKey: 'design_new:new' }),
      };
    }
    if (name === 'svg_export') {
      const t = exportTarget(root, a);
      return {
        risk: t.replaces ? 'high' : 'medium',
        action: `exportar ${rel(root, t.src)} → ${rel(root, t.out)}`,
        warning: t.replaces ? `Se reemplaza ${rel(root, t.out)}.` : 'Se crea una imagen nueva.',
        command:
          typeof a.width === 'number'
            ? `ancho ${a.width} px`
            : `escala ×${typeof a.scale === 'number' ? a.scale : 1}`,
        path: rel(root, t.out),
        ...(t.replaces ? {} : { allowKey: 'svg_export:new' }),
      };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  return null;
}

export interface GraphicsResult {
  ok: boolean;
  content: string;
  summary: string;
  image?: ComputerShot;
  /** A file written (the window reloads / opens it). */
  changed?: string;
  /** Open this design in the editor. */
  open?: string;
}

async function readSvg(abs: string): Promise<string> {
  const st = await stat(abs);
  if (!st.isFile()) throw new Error('Not a file.');
  if (st.size > MAX_SVG) throw new Error('The SVG is too large (max 20 MB).');
  return readFile(abs, 'utf8');
}

export async function runGraphicsTool(
  raster: Raster | null,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
): Promise<GraphicsResult> {
  try {
    if (name === 'design_templates') {
      const lines = TEMPLATES.map((t) => `- ${t.id}: ${t.name.en} (${t.width} × ${t.height} px)`);
      const pals = PALETTES.map(
        (p) => `- ${p.id}: ${p.name.en} (${p.bg1}, ${p.bg2}, accent ${p.accent})`,
      );
      return {
        ok: true,
        content: `Templates:\n${lines.join('\n')}\n\nPalettes:\n${pals.join('\n')}`,
        summary: `${TEMPLATES.length} plantillas`,
      };
    }
    if (!root)
      return { ok: false, content: 'No folder is open in the editor.', summary: 'sin carpeta' };
    if (name === 'design_new') {
      const t = newTarget(root, a);
      const svg = buildTemplate({
        template: String(a.template ?? ''),
        palette: typeof a.palette === 'string' ? a.palette : undefined,
        title: typeof a.title === 'string' ? a.title : undefined,
        subtitle: typeof a.subtitle === 'string' ? a.subtitle : undefined,
        width: typeof a.width === 'number' ? a.width : undefined,
        height: typeof a.height === 'number' ? a.height : undefined,
      });
      await mkdir(dirname(t.out), { recursive: true });
      await writeFile(t.out, svg, 'utf8');
      const r = rel(root, t.out);
      const size = svgSize(svg);
      return {
        ok: true,
        content: `Created ${r} (${size.width} × ${size.height} px) and opened it in the design editor. Its parts are named with data-name ("Fondo", "Título"…). Check it with svg_render.`,
        summary: `diseño ${r}`,
        changed: r,
        open: r,
      };
    }
    if (!raster)
      return {
        ok: false,
        content: 'Drawing SVG files is not available here.',
        summary: 'no disponible',
      };
    if (name === 'svg_render') {
      const abs = projectFile(root, a.path);
      const svg = await readSvg(abs);
      const nat = svgSize(svg);
      const fit = Math.min(1, VIEW_SIDE / Math.max(nat.width, nat.height));
      const want =
        typeof a.width === 'number' && a.width > 0 ? Math.min(VIEW_SIDE, a.width) / nat.width : fit;
      const s = Math.min(fit, want);
      const w = Math.max(1, Math.round(nat.width * s));
      const h = Math.max(1, Math.round(nat.height * s));
      const png = await raster(svg, { width: w, height: h, mime: 'image/png' });
      const notes: string[] = [];
      if (/<script\b/i.test(svg) || /\son[a-z]+\s*=/i.test(svg))
        notes.push('It has scripts or event handlers: the design editor removes them.');
      if (/(?:href|xlink:href)\s*=\s*["']https?:/i.test(svg))
        notes.push('It links images from the internet: they are not drawn.');
      if (!/viewBox\s*=/i.test(svg)) notes.push('It has no viewBox: add one so it scales well.');
      return {
        ok: true,
        content: `${rel(root, abs)}: ${nat.width} × ${nat.height} px (picture attached at ${w} × ${h}).${notes.length ? `\n${notes.join('\n')}` : ''}`,
        summary: `vista de ${rel(root, abs)}`,
        image: { mediaType: 'image/png', data: png.toString('base64'), width: w, height: h },
      };
    }
    if (name === 'svg_export') {
      const t = exportTarget(root, a);
      const svg = await readSvg(t.src);
      const size = exportSize(svgSize(svg), a);
      const bg =
        typeof a.background === 'string' && /^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(a.background)
          ? a.background
          : null;
      const buf = await raster(svg, { ...size, mime: t.mime, background: bg });
      await mkdir(dirname(t.out), { recursive: true });
      await writeFile(t.out, buf);
      const r = rel(root, t.out);
      return {
        ok: true,
        content: `Exported ${r} (${size.width} × ${size.height} px).`,
        summary: `exportado ${r}`,
        changed: r,
      };
    }
    return { ok: false, content: `Unknown tool ${name}.`, summary: 'desconocida' };
  } catch (e) {
    return { ok: false, content: (e as Error).message, summary: 'error' };
  }
}
