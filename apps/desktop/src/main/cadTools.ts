import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { ToolDefinition } from '@omni/shared';
import type { ComputerShot } from './computerTools.js';
import type { SystemPreview } from './system.js';
import type { CadService } from './cad.js';
import type { BlenderModelService } from './blenderModel.js';
import type { SlicerService } from './slicer.js';
import {
  describeStatus,
  printerFileName,
  type PrinterAction,
  type PrinterStore,
} from './printers.js';
import { describeGcode, gcodeTris, parseGcode } from '../shared/gcode.js';
import {
  INFILL_PATTERNS,
  MATERIALS,
  PRINTER_PRESETS,
  SLICEABLE,
  SUPPORT_MODES,
  bedOf,
  describeSlice,
  validateSlice,
} from '../shared/slicer.js';
import {
  CAD_FORMATS,
  CAD_TEMPLATES,
  parseScadParams,
  type CadFormat,
  type ScadLog,
} from '../shared/cad.js';
import {
  BLENDER_EXPORTS,
  BLENDER_IMPORTS,
  BLENDER_MODIFIERS,
  BLENDER_OP_NAMES,
  BLENDER_PRIMITIVES,
  UV_METHODS,
  describeBlenderOps,
  describeBlenderReport,
  exportsOf,
  validateBlenderOps,
  type BlenderOp,
} from '../shared/blenderOps.js';
import {
  analyzeMesh,
  checkPrint,
  describeMesh,
  parseObj,
  parseOff,
  parseStl,
  type Tris,
} from '../shared/mesh3d.js';
import { encodePng, rasterViews } from '../shared/meshRaster.js';

/**
 * Fase 7 (plan de funciones): 3D modelling for the agent. CAD with OpenSCAD (code -> model):
 * looking at a model is free (OpenSCAD cannot run programs; it only reads project files);
 * writing files asks. Blender: inspecting a file is free (Blender opens it with scripts
 * disabled); editing runs validated ops through a fixed runner and asks.
 */

export const CAD_TOOLS: ToolDefinition[] = [
  {
    name: 'cad_info',
    description:
      'CAD with OpenSCAD: which engine is available (installed OpenSCAD or the built-in one), the starter templates, the .scad files of the project, and the Customizer parameters (name, value, range, options) of one file when "path" is given.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '.scad file, relative to the open folder' },
      },
    },
  },
  {
    name: 'cad_render',
    description:
      'Render an OpenSCAD model and SEE it: returns a picture (isometric, front, right and top views), the size, whether it is printable (watertight, fits a 220×220×250 mm bed), and the errors / warnings / echo() lines with their line numbers. Give "path" (a .scad of the project) and/or "code" (OpenSCAD source; with a path it replaces the saved text, so relative includes still work). "params" overrides Customizer parameters by name. Units are mm, Z is up. Use it after every change to a .scad.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        code: { type: 'string', description: 'OpenSCAD source (at most 200000 characters)' },
        params: {
          type: 'object',
          description: 'Customizer values, e.g. {"ancho": 80, "con_tapa": false}',
        },
        color: { type: 'string', description: 'Picture colour "#rrggbb"' },
      },
    },
  },
  {
    name: 'cad_export',
    description:
      'Export an OpenSCAD model of the project to a file for 3D printing or other programs: stl (default), 3mf, obj, off or amf. "out" (relative path) defaults to the .scad name with the new extension in the same folder. Returns the printability check. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '.scad file of the project' },
        params: { type: 'object' },
        format: { type: 'string', enum: [...CAD_FORMATS] },
        out: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'cad_new',
    description: `Create a new .scad file from a starter template with Customizer parameters: ${CAD_TEMPLATES.map((t) => `${t.id} (${t.en})`).join(', ')}. Then edit it with your file tools and check it with cad_render. The user approves it.`,
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: CAD_TEMPLATES.map((t) => t.id) },
        path: { type: 'string', description: 'New .scad file, relative to the open folder' },
      },
      required: ['template', 'path'],
    },
  },
  {
    name: 'mesh_check',
    description:
      'Check a mesh file (.stl, .obj, .off) for 3D printing and SEE it: size, triangles, pieces, holes (open edges), non-manifold and flipped edges, volume and grams of PLA, whether it fits the bed; plus a picture of 4 views. "units" "m" for files from Blender exported without scale. "bed" [x,y,z] mm (default 220×220×250).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        units: { type: 'string', enum: ['mm', 'm'] },
        bed: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      },
      required: ['path'],
    },
  },
  {
    name: 'blender_inspect',
    description:
      'Open a .blend (or a .glb/.gltf/.fbx/.obj/.stl/.ply) in Blender without a window and report every object (type, location, rotation, scale, size in metres, vertices / faces / triangles, modifiers, materials, UV maps) with a rendered preview picture. Blender opens it with scripts disabled. Call it before blender_model.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative to the open folder' },
        preview: { type: 'boolean', description: 'Render a picture (default true)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'blender_model',
    description:
      'Model in Blender without writing Python: apply "ops" in order to a .blend of the project (created empty when it does not exist), then save it and return the report and a preview picture. If one op fails nothing is saved. Units are metres, Z is up, rotations in degrees, colours "#rrggbb". Ops: ' +
      `{op:"add", type:${BLENDER_PRIMITIVES.join('|')}, name, size (m, default 1), segments, text, extrude, location, rotation, scale}; ` +
      '{op:"transform", object, location, rotation, scale}; {op:"delete", object}; {op:"duplicate", object, name, location…}; {op:"rename", object, name}; ' +
      `{op:"modifier", object, type:${BLENDER_MODIFIERS.join('|')}, name, settings} — settings: bevel {width, segments, angle, limit:none|angle|weight}, subsurf {levels, render_levels}, mirror {axis:"X"|"XY"…, bisect, clip, object}, array {count, offset:[x,y,z] relative, constant:[x,y,z] m, merge}, solidify {thickness, offset, even}, boolean {operation:difference|union|intersect, object (the cutter, hidden after), solver:exact|float|manifold}, decimate {ratio}, remesh {voxel_size, smooth}, smooth {factor, iterations}, weld {distance}, wireframe {thickness}, screw {angle, steps, offset, axis}, displace {strength, mid_level}; ` +
      '{op:"modifier_remove", object, name}; {op:"apply", object, modifiers?:[names]} (bakes them into the mesh; text/curves become meshes); ' +
      '{op:"material", object, name, color, metallic 0-1, roughness 0-1, alpha 0-1, emission, emission_strength, texture (image path of the project), slot}; ' +
      `{op:"uv", object, method:${UV_METHODS.join('|')}, angle, margin}; {op:"shade", object, smooth, angle}; {op:"origin", object, to:geometry|bottom|world}; {op:"join", objects:[…], name}; ` +
      `{op:"import", path (${BLENDER_IMPORTS.join('/')}), scale}; {op:"export", path (${BLENDER_EXPORTS.join('/')}), objects?, scale, apply_modifiers (default true)}. ` +
      'For 3D printing export .stl with scale 1000 when the model is in metres (Blender) so the slicer reads mm; exported .stl files are checked for printing. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '.blend file, relative to the open folder' },
        ops: {
          type: 'array',
          minItems: 1,
          maxItems: 60,
          items: {
            type: 'object',
            properties: { op: { type: 'string', enum: [...BLENDER_OP_NAMES] } },
            required: ['op'],
          },
        },
        preview: { type: 'boolean', description: 'Render a picture (default true)' },
      },
      required: ['path', 'ops'],
    },
  },
  {
    name: 'slice_model',
    description:
      'Slice a model of the project to G-code for a 3D printer with the installed PrusaSlicer / SuperSlicer: .stl, .3mf, .obj, .amf, .step, or a .scad (rendered first, with "params"). Returns the layers, print time, filament (m and grams), the printed size and a picture of the toolpaths (4 views). "out" defaults to the model name with .gcode. When the user loaded their own PrusaSlicer profile, it is used for the printer and only these choices change. Printers: ' +
      PRINTER_PRESETS.map((p) => `${p.id} (${p.en})`).join(', ') +
      '. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Model of the project' },
        out: { type: 'string', description: '.gcode file, relative to the open folder' },
        printer: { type: 'string', enum: PRINTER_PRESETS.map((p) => p.id) },
        material: { type: 'string', enum: MATERIALS.map((m) => m.id) },
        layer_height: { type: 'number', description: 'mm, 0.05-0.32 (default 0.2)' },
        infill: { type: 'number', description: '% 0-100 (default 15)' },
        pattern: { type: 'string', enum: [...INFILL_PATTERNS] },
        walls: { type: 'number', description: 'Perimeters 1-10 (default 2)' },
        supports: { type: 'string', enum: [...SUPPORT_MODES] },
        brim: { type: 'number', description: 'Brim width mm (0 = none)' },
        nozzle_temp: { type: 'number' },
        bed_temp: { type: 'number' },
        params: { type: 'object', description: 'Customizer values when path is a .scad' },
      },
      required: ['path'],
    },
  },
  {
    name: 'gcode_info',
    description:
      'Read a .gcode file of the project: slicer, layers and layer height, print time, filament, temperatures, printed area (and whether it fits a bed [x,y,z] mm), plus a picture of the toolpaths.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        bed: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        picture: { type: 'boolean', description: 'Default true' },
      },
      required: ['path'],
    },
  },
  {
    name: 'printer',
    description:
      'The 3D printers the user added in Zinarix (OctoPrint or Klipper/Moonraker on the network). action "list" (default) shows them with their status; "status" one printer (state, file, progress, time left, temperatures); "send" uploads a .gcode of the project ("start" true prints it right away); "pause", "resume", "cancel" the current print. Reading is free; sending and controlling are approved by the user every time (a real machine heats up and moves).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'status', 'send', 'pause', 'resume', 'cancel'] },
        printer: { type: 'string', description: 'Printer name or id (from list)' },
        path: { type: 'string', description: '.gcode of the project (send)' },
        start: { type: 'boolean', description: 'Start printing after the upload (send)' },
      },
    },
  },
];

export const CAD_TOOL_NAMES = new Set(CAD_TOOLS.map((t) => t.name));

export const CAD_PROMPT_PART =
  '- cad_info, cad_render, cad_export, cad_new and mesh_check: CAD with OpenSCAD (code -> 3D model, in mm) and 3D printing. To make a printable part, write a .scad (start from cad_new templates, keep sizes as Customizer parameters at the top: `ancho = 60; // [20:1:200]`), check it with cad_render (you SEE it), fix what is wrong, then cad_export to STL/3MF. mesh_check reviews any STL/OBJ before printing. slice_model makes the G-code (it shows time, filament and a picture of the toolpaths), gcode_info reads one, and printer sends it to an OctoPrint / Klipper printer the user added (check its status first; never start a print the user did not ask for).\n- blender_inspect and blender_model: model in Blender without Python (primitives, modifiers, booleans, materials, UV unwrap, import/export GLB/FBX/OBJ/STL/USD). Inspect first; prefer blender_model over blender_script.';

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A path of the open folder (relative, or absolute inside it). */
export function projectFile(root: string | undefined, p: unknown, exts?: RegExp): string {
  const v = s(p);
  if (!root) throw new Error('Open a folder first.');
  if (!v) throw new Error('"path" is required.');
  const abs = isAbsolute(v) ? resolve(v) : resolve(root, v);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`"${v}" is outside the open folder.`);
  if (exts && !exts.test(abs)) throw new Error(`"${v}" has the wrong type.`);
  return abs;
}

const rel = (root: string | undefined, p: string) =>
  root ? relative(root, p).split(sep).join('/') : p;

/** Picture of 4 views for the agent. */
export function meshShot(t: Tris, color?: string, size = 520): ComputerShot {
  const v = rasterViews(t, size, color);
  const png = encodePng(v.rgba, v.width, v.height, (b) => deflateSync(b, { level: 6 }));
  return {
    mediaType: 'image/png',
    data: Buffer.from(png).toString('base64'),
    width: v.width,
    height: v.height,
  };
}

export function meshOf(data: Buffer, ext: string): Tris {
  const e = ext.toLowerCase().replace('.', '');
  if (e === 'stl') return parseStl(data);
  if (e === 'obj') return parseObj(data.toString('utf8'));
  if (e === 'off') return parseOff(data.toString('utf8'));
  throw new Error(`.${e} cannot be read here; use blender_inspect for it.`);
}

function logText(log: ScadLog, root: string | undefined): string {
  const lines = log.messages
    .filter((m) => m.severity !== 'trace')
    .slice(0, 40)
    .map(
      (m) =>
        `${m.severity.toUpperCase()}${m.line ? ` line ${m.line}` : ''}${m.file ? ` (${rel(root, m.file)})` : ''}: ${m.message}`,
    );
  return lines.join('\n');
}

const BLEND = /\.blend$/i;
const OPENABLE = /\.(blend|glb|gltf|fbx|obj|stl|ply)$/i;

export function cadPreview(
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
): SystemPreview | { error: string } | null {
  try {
    switch (name) {
      case 'cad_info':
      case 'cad_render':
      case 'mesh_check':
      case 'blender_inspect':
      case 'gcode_info':
        return null;
      case 'slice_model': {
        const src = projectFile(root, a.path, MODEL_IN);
        const st = validateSlice(sliceArgs(a));
        const out = gcodeOut(root, a, src);
        return {
          risk: 'medium',
          action: `rebanar ${rel(root, src)} → ${rel(root, out)}`,
          warning: `${describeSlice(st)}. ${existsSync(out) ? `Se reemplaza ${rel(root, out)}.` : 'Se crea un archivo nuevo en el proyecto.'}`,
          path: out,
          allowKey: 'slice_model',
        };
      }
      case 'printer': {
        const act = s(a.action) || 'list';
        if (act === 'list' || act === 'status') return null;
        if (act === 'send') {
          const p = projectFile(root, a.path, GCODE);
          if (!existsSync(p)) return { error: `${s(a.path)} does not exist.` };
          return {
            risk: a.start === true ? 'high' : 'medium',
            action: `${a.start === true ? 'enviar e IMPRIMIR' : 'enviar'} ${rel(root, p)} a la impresora "${s(a.printer) || '?'}"`,
            warning:
              a.start === true
                ? 'La impresora empieza a calentar y a moverse. Revisa que la cama esté libre y limpia.'
                : 'El archivo se sube a la impresora; no empieza a imprimir.',
            path: p,
          };
        }
        if (act === 'pause' || act === 'resume' || act === 'cancel')
          return {
            risk: 'high',
            action: `${act === 'pause' ? 'pausar' : act === 'resume' ? 'reanudar' : 'CANCELAR'} la impresión en "${s(a.printer) || '?'}"`,
            warning:
              act === 'cancel'
                ? 'La pieza a medio imprimir se pierde.'
                : act === 'resume'
                  ? 'La impresora vuelve a moverse.'
                  : 'La impresora se detiene donde va.',
          };
        return { error: `Unknown action "${act}".` };
      }
      case 'cad_export': {
        const src = projectFile(root, a.path, /\.scad$/i);
        const fmt = (CAD_FORMATS as readonly string[]).includes(s(a.format)) ? s(a.format) : 'stl';
        const out = a.out ? projectFile(root, a.out) : src.replace(/\.scad$/i, `.${fmt}`);
        return {
          risk: 'medium',
          action: `exportar ${rel(root, src)} a ${rel(root, out)}`,
          warning: existsSync(out)
            ? `Se reemplaza ${rel(root, out)}.`
            : 'Se crea un archivo nuevo en el proyecto.',
          path: out,
          allowKey: 'cad_export',
        };
      }
      case 'cad_new': {
        const p = projectFile(root, a.path, /\.scad$/i);
        if (!CAD_TEMPLATES.some((t) => t.id === s(a.template)))
          return { error: 'Unknown template.' };
        if (existsSync(p)) return { error: `${s(a.path)} already exists; pick another name.` };
        return {
          risk: 'medium',
          action: `crear ${rel(root, p)} con la plantilla "${s(a.template)}"`,
          warning: 'Se crea un archivo nuevo en el proyecto.',
          path: p,
          allowKey: 'cad_new',
        };
      }
      case 'blender_model': {
        const p = projectFile(root, a.path, BLEND);
        const ops = validateBlenderOps(a.ops, (q, why) =>
          projectFile(
            root,
            q,
            why === 'texture' ? /\.(png|jpe?g|webp|tga|exr|hdr|bmp|tiff?)$/i : undefined,
          ),
        );
        const outs = exportsOf(ops).map((o) => rel(root, o));
        return {
          risk: 'medium',
          action: `Blender: ${existsSync(p) ? 'editar' : 'crear'} ${rel(root, p)} (${ops.length} ${ops.length === 1 ? 'operación' : 'operaciones'})`,
          warning: `${describeBlenderOps(ops)}.${outs.length ? ` Escribe ${outs.join(', ')}.` : ''}${existsSync(p) ? ' Blender guarda la versión anterior como .blend1.' : ''}`,
          path: p,
          allowKey: `blender_model:${rel(root, p)}`,
        };
      }
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  return null;
}

async function scadFiles(
  root: string,
  dir = root,
  out: string[] = [],
  depth = 0,
): Promise<string[]> {
  if (depth > 6 || out.length >= 200) return out;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await scadFiles(root, p, out, depth + 1);
    else if (/\.scad$/i.test(e.name)) out.push(rel(root, p));
  }
  return out;
}

const MODEL_IN = /\.(stl|3mf|obj|amf|step|stp|scad)$/i;
const GCODE = /\.(gcode|gco|g|bgcode)$/i;

/** Where the G-code goes: "out", or the model's name with .gcode. */
function gcodeOut(root: string | undefined, a: Record<string, unknown>, src: string): string {
  return a.out ? projectFile(root, a.out, /\.gcode$/i) : src.replace(/\.[^./\\]+$/, '.gcode');
}

/** The tool's snake_case arguments -> SliceSettings fields. */
function sliceArgs(a: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const map: [string, string][] = [
    ['printer', 'printer'],
    ['material', 'material'],
    ['layer_height', 'layerHeight'],
    ['infill', 'infill'],
    ['pattern', 'pattern'],
    ['walls', 'walls'],
    ['supports', 'supports'],
    ['brim', 'brim'],
    ['nozzle_temp', 'nozzleTemp'],
    ['bed_temp', 'bedTemp'],
  ];
  for (const [k, v] of map) if (a[k] !== undefined && a[k] !== null && a[k] !== '') o[v] = a[k];
  return o;
}

/** Picture of the toolpaths of a G-code. */
export function gcodeShot(text: string, size = 520): ComputerShot | undefined {
  const p = parseGcode(text, { maxSegments: 400_000 });
  if (!p.extrude.length) return undefined;
  const v = rasterViews(gcodeTris(p), size, '#e8a33d', true);
  const png = encodePng(v.rgba, v.width, v.height, (b) => deflateSync(b, { level: 6 }));
  return {
    mediaType: 'image/png',
    data: Buffer.from(png).toString('base64'),
    width: v.width,
    height: v.height,
  };
}

export interface PrintDeps {
  slicer?: SlicerService;
  printers?: PrinterStore;
}

async function runPrintTool(
  cad: CadService | undefined,
  deps: PrintDeps,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
  signal: AbortSignal,
): Promise<CadToolResult> {
  if (name === 'gcode_info') {
    const p = projectFile(root, a.path, GCODE);
    if (!existsSync(p))
      return { ok: false, content: `${s(a.path)} does not exist.`, summary: 'no existe' };
    if (statSync(p).size > 400 * 1024 * 1024)
      return { ok: false, content: 'The file is larger than 400 MB.', summary: 'muy grande' };
    const text = await readFile(p, 'utf8');
    const st = parseGcode(text, { maxSegments: 1 }).stats;
    const bed =
      Array.isArray(a.bed) &&
      a.bed.length === 3 &&
      a.bed.every((n) => typeof n === 'number' && n > 0)
        ? (a.bed as [number, number, number])
        : undefined;
    const img = a.picture === false ? undefined : gcodeShot(text);
    return {
      ok: true,
      content: describeGcode({ ...st, truncated: false }, bed),
      summary: `${st.layers} capas`,
      ...(img ? { image: img } : {}),
    };
  }
  if (name === 'slice_model') {
    if (!deps.slicer)
      return { ok: false, content: 'Slicing is not available.', summary: 'sin rebanador' };
    const src = projectFile(root, a.path, MODEL_IN);
    if (!existsSync(src))
      return { ok: false, content: `${s(a.path)} does not exist.`, summary: 'no existe' };
    const settings = validateSlice(sliceArgs(a));
    const out = gcodeOut(root, a, src);
    let model = src;
    let tmp: string | undefined;
    try {
      if (/\.scad$/i.test(src)) {
        if (!cad)
          return {
            ok: false,
            content: 'CAD (OpenSCAD) is not available to render the .scad.',
            summary: 'sin CAD',
          };
        const params =
          a.params && typeof a.params === 'object' && !Array.isArray(a.params)
            ? (a.params as Record<string, unknown>)
            : {};
        const r = await cad.render(
          { file: src, values: params, format: 'stl', root, timeoutMs: 10 * 60_000 },
          signal,
        );
        tmp = await mkdtemp(join(tmpdir(), 'zinarix-slice-model-'));
        model = join(tmp, basename(src).replace(/\.scad$/i, '.stl'));
        await writeFile(model, r.data);
      } else if (!SLICEABLE.test(src))
        return { ok: false, content: 'That file type cannot be sliced.', summary: 'tipo' };
      const r = await deps.slicer.slice({ model, out, settings }, signal);
      const img = gcodeShot(await readFile(out, 'utf8'));
      return {
        ok: true,
        content: [
          `Sliced ${rel(root, src)} with ${r.slicer} in ${(r.ms / 1000).toFixed(1)} s → ${rel(root, out)}.`,
          `Settings: ${describeSlice(settings, 'en')}.`,
          describeGcode(r.stats, bedOf(settings)),
          ...(r.warnings.length
            ? [`Slicer warnings:\n${r.warnings.map((w) => `- ${w}`).join('\n')}`]
            : []),
          ...(img
            ? ['Picture: the toolpaths (isometric left; front, right and top on the right).']
            : []),
        ].join('\n\n'),
        summary: rel(root, out),
        changed: out,
        ...(img ? { image: img } : {}),
      };
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
  // printer
  if (!deps.printers)
    return { ok: false, content: 'Printers are not available.', summary: 'sin impresoras' };
  const printers = deps.printers;
  const act = s(a.action) || 'list';
  const all = printers.list();
  if (act === 'list') {
    if (!all.length)
      return {
        ok: true,
        content:
          'No printers yet. The user adds them in the CAD 3D panel → Printers (OctoPrint or Klipper/Moonraker address and API key).',
        summary: 'sin impresoras',
      };
    const lines = await Promise.all(
      all.map(
        async (p) =>
          `- ${describeStatus(p.name, await printers.client(p.id).status(), 'en')} [${p.kind}, id ${p.id}]`,
      ),
    );
    return { ok: true, content: lines.join('\n'), summary: `${all.length} impresoras` };
  }
  const who = s(a.printer) || (all.length === 1 ? all[0]!.id : '');
  if (!who)
    return {
      ok: false,
      content: 'Say which printer ("printer": name or id from action list).',
      summary: 'falta impresora',
    };
  const cfg = printers.get(who);
  const client = printers.client(cfg.id);
  if (act === 'status') {
    const st = await client.status();
    return { ok: st.online, content: describeStatus(cfg.name, st, 'en'), summary: st.state };
  }
  if (act === 'send') {
    const p = projectFile(root, a.path, GCODE);
    if (!existsSync(p))
      return { ok: false, content: `${s(a.path)} does not exist.`, summary: 'no existe' };
    const before = await client.status();
    if (!before.online)
      return {
        ok: false,
        content: describeStatus(cfg.name, before, 'en'),
        summary: 'sin conexión',
      };
    if (a.start === true && (before.printing || before.paused))
      return {
        ok: false,
        content: `${cfg.name} is busy (${before.state}${before.file ? `, ${before.file}` : ''}). Wait or cancel that print first.`,
        summary: 'ocupada',
      };
    const fname = printerFileName(p);
    await client.upload(fname, await readFile(p), a.start === true);
    return {
      ok: true,
      content: `Uploaded ${fname} to ${cfg.name}${a.start === true ? ' and started the print' : ''}.`,
      summary: a.start === true ? 'imprimiendo' : 'subido',
    };
  }
  if (act === 'pause' || act === 'resume' || act === 'cancel') {
    await client.control(act as PrinterAction);
    const st = await client.status();
    return {
      ok: true,
      content: `Done (${act}). ${describeStatus(cfg.name, st, 'en')}`,
      summary: act,
    };
  }
  return { ok: false, content: `Unknown action "${act}".`, summary: 'acción' };
}

export interface CadToolResult {
  ok: boolean;
  content: string;
  summary: string;
  image?: ComputerShot;
  changed?: string;
}

export async function runCadTool(
  cad: CadService | undefined,
  blender: BlenderModelService | undefined,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
  signal: AbortSignal,
  print: PrintDeps = {},
): Promise<CadToolResult> {
  try {
    if (name === 'slice_model' || name === 'gcode_info' || name === 'printer')
      return await runPrintTool(cad, print, name, a, root, signal);
    const params =
      a.params && typeof a.params === 'object' && !Array.isArray(a.params)
        ? (a.params as Record<string, unknown>)
        : {};
    if (name === 'blender_inspect' || name === 'blender_model') {
      if (!blender)
        return { ok: false, content: 'Blender is not available.', summary: 'sin Blender' };
      const isEdit = name === 'blender_model';
      const p = projectFile(root, a.path, isEdit ? BLEND : OPENABLE);
      if (!isEdit && !existsSync(p))
        return { ok: false, content: `${s(a.path)} does not exist.`, summary: 'no existe' };
      const ops: BlenderOp[] = isEdit
        ? validateBlenderOps(a.ops, (q, why) =>
            projectFile(
              root,
              q,
              why === 'texture' ? /\.(png|jpe?g|webp|tga|exr|hdr|bmp|tiff?)$/i : undefined,
            ),
          )
        : [];
      const exists = existsSync(p);
      if (isEdit) await mkdir(dirname(p), { recursive: true });
      const r = await blender.run(
        {
          ...(exists ? { input: p } : { fresh: true }),
          ops,
          ...(isEdit ? { save: p } : {}),
          preview: a.preview !== false,
          previewSize: 640,
        },
        signal,
      );
      const notes: string[] = [];
      for (const out of r.report.exported) {
        if (!/\.stl$/i.test(out)) continue;
        try {
          const m = analyzeMesh(parseStl(await readFile(out)));
          notes.push(`Print check of ${rel(root, out)}:\n${describeMesh(m, checkPrint(m))}`);
        } catch {
          // not readable: skip
        }
      }
      return {
        ok: true,
        content: [
          describeBlenderReport({
            ...r.report,
            exported: r.report.exported.map((x) => rel(root, x)),
            ...(r.report.saved ? { saved: rel(root, r.report.saved) } : {}),
          }),
          ...notes,
          `(${(r.ms / 1000).toFixed(1)} s)`,
        ].join('\n\n'),
        summary: isEdit ? `${ops.length} operaciones` : `${r.report.objects.length} objetos`,
        ...(r.preview
          ? {
              image: {
                mediaType: 'image/png' as const,
                data: r.preview.toString('base64'),
                width: 640,
                height: 640,
              },
            }
          : {}),
        ...(isEdit ? { changed: r.report.exported[0] ?? p } : {}),
      };
    }
    if (name === 'mesh_check') {
      const p = projectFile(root, a.path, /\.(stl|obj|off)$/i);
      if (!existsSync(p))
        return { ok: false, content: `${s(a.path)} does not exist.`, summary: 'no existe' };
      if (statSync(p).size > 300 * 1024 * 1024)
        return { ok: false, content: 'The file is larger than 300 MB.', summary: 'muy grande' };
      const t = meshOf(await readFile(p), extname(p));
      const m = analyzeMesh(t);
      const bed =
        Array.isArray(a.bed) &&
        a.bed.length === 3 &&
        a.bed.every((n) => typeof n === 'number' && n > 0)
          ? (a.bed as [number, number, number])
          : undefined;
      const c = checkPrint(m, { units: a.units === 'm' ? 'm' : 'mm', ...(bed ? { bed } : {}) });
      return {
        ok: true,
        content: describeMesh(m, c),
        summary: c.ok ? 'imprimible' : `${c.errors.length} problemas`,
        image: meshShot(t),
      };
    }
    if (!cad) return { ok: false, content: 'CAD (OpenSCAD) is not available.', summary: 'sin CAD' };
    if (name === 'cad_info') {
      const e = await cad.engines();
      const lines = [
        e.native
          ? `Engine: installed OpenSCAD ${e.native.version}${e.native.manifold ? ' (Manifold backend: fast)' : ''}.`
          : e.builtin
            ? 'Engine: the built-in OpenSCAD (WebAssembly). Installing OpenSCAD (openscad.org) makes big models faster.'
            : 'No OpenSCAD engine is available.',
        `Templates (cad_new): ${CAD_TEMPLATES.map((t) => `${t.id} = ${t.en}`).join('; ')}.`,
      ];
      if (root) {
        const files = await scadFiles(root);
        lines.push(
          files.length
            ? `.scad files:\n${files.map((f) => `- ${f}`).join('\n')}`
            : 'No .scad files in the project yet.',
        );
      }
      if (a.path) {
        const p = projectFile(root, a.path, /\.scad$/i);
        const ps = parseScadParams(await readFile(p, 'utf8'));
        lines.push(
          ps.length
            ? `Parameters of ${s(a.path)}:\n${ps
                .map(
                  (x) =>
                    `- ${x.name} = ${JSON.stringify(x.value)}${x.min !== undefined ? ` [${x.min}..${x.max}${x.step ? ` step ${x.step}` : ''}]` : ''}${x.options ? ` options ${x.options.map((o) => JSON.stringify(o.value)).join('|')}` : ''}${x.description ? ` — ${x.description}` : ''}${x.group ? ` (${x.group})` : ''}`,
                )
                .join('\n')}`
            : `${s(a.path)} has no Customizer parameters (top-level "name = value;" lines before the first module).`,
        );
      }
      return {
        ok: true,
        content: lines.join('\n\n'),
        summary: e.native ? `OpenSCAD ${e.native.version}` : 'OpenSCAD incluido',
      };
    }
    if (name === 'cad_new') {
      const p = projectFile(root, a.path, /\.scad$/i);
      const t = CAD_TEMPLATES.find((x) => x.id === s(a.template));
      if (!t) return { ok: false, content: 'Unknown template.', summary: 'sin plantilla' };
      if (existsSync(p))
        return { ok: false, content: `${s(a.path)} already exists.`, summary: 'ya existe' };
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, t.code, 'utf8');
      const ps = parseScadParams(t.code);
      return {
        ok: true,
        content: `Created ${rel(root, p)} (${t.en}). Parameters: ${ps.map((x) => `${x.name}=${JSON.stringify(x.value)}`).join(', ')}. Check it with cad_render.`,
        summary: basename(p),
        changed: p,
      };
    }
    if (name === 'cad_render') {
      const code = s(a.code) ? String(a.code) : undefined;
      if (code && code.length > 200_000)
        return {
          ok: false,
          content: 'The code is longer than 200000 characters.',
          summary: 'muy largo',
        };
      const file = a.path ? projectFile(root, a.path, /\.scad$/i) : undefined;
      if (!file && !code)
        return { ok: false, content: 'Give "path" or "code".', summary: 'sin modelo' };
      if (file && !code && !existsSync(file))
        return { ok: false, content: `${s(a.path)} does not exist.`, summary: 'no existe' };
      try {
        const r = await cad.render(
          {
            ...(file ? { file } : {}),
            ...(code ? { code } : {}),
            values: params,
            root,
            timeoutMs: 180_000,
          },
          signal,
        );
        const t = parseStl(r.data);
        const m = analyzeMesh(t);
        const c = checkPrint(m);
        const msgs = logText(r.log, root);
        return {
          ok: true,
          content: [
            `Rendered with ${r.engine === 'native' ? 'the installed OpenSCAD' : 'the built-in OpenSCAD'} in ${(r.ms / 1000).toFixed(1)} s. Size in mm (x × y × z).`,
            describeMesh(m, c),
            ...(r.params.length
              ? [
                  `Parameters: ${r.params.map((x) => `${x.name}=${JSON.stringify(x.name in params ? params[x.name] : x.value)}`).join(', ')}`,
                ]
              : []),
            ...(msgs ? [msgs] : []),
            'Picture: isometric (left), front, right and top (right column). Red faces are inside-out or open.',
          ].join('\n\n'),
          summary: c.ok
            ? `${m.bounds.size.map((v) => v.toFixed(0)).join('×')} mm`
            : `${c.errors.length} problemas`,
          image: meshShot(t, s(a.color) || undefined),
        };
      } catch (e) {
        const log = (e as { log?: ScadLog }).log;
        return {
          ok: false,
          content: `OpenSCAD could not build the model: ${(e as Error).message}${log ? `\n\n${logText(log, root)}` : ''}`,
          summary: 'error',
        };
      }
    }
    if (name === 'cad_export') {
      const src = projectFile(root, a.path, /\.scad$/i);
      if (!existsSync(src))
        return { ok: false, content: `${s(a.path)} does not exist.`, summary: 'no existe' };
      const fmt = (
        (CAD_FORMATS as readonly string[]).includes(s(a.format)) ? s(a.format) : 'stl'
      ) as CadFormat;
      const out = a.out ? projectFile(root, a.out) : src.replace(/\.scad$/i, `.${fmt}`);
      if (extname(out).toLowerCase() !== `.${fmt}`)
        return { ok: false, content: `"out" must end in .${fmt}.`, summary: 'extensión' };
      const r = await cad.render(
        { file: src, values: params, format: fmt, root, timeoutMs: 10 * 60_000 },
        signal,
      );
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, r.data);
      let check = '';
      if (fmt === 'stl' || fmt === 'off' || fmt === 'obj') {
        const m = analyzeMesh(meshOf(r.data, fmt));
        check = describeMesh(m, checkPrint(m));
      }
      return {
        ok: true,
        content: [
          `Exported ${rel(root, out)} (${(r.data.length / 1024).toFixed(0)} KB).`,
          check,
          logText(r.log, root),
        ]
          .filter(Boolean)
          .join('\n\n'),
        summary: basename(out),
        changed: out,
      };
    }
    return { ok: false, content: `Unknown tool ${name}.`, summary: 'desconocida' };
  } catch (e) {
    return { ok: false, content: (e as Error).message, summary: 'falló' };
  }
}
