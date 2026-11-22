import { existsSync, statSync } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';
import type { ToolDefinition } from '@omni/shared';
import type { ComputerShot } from './computerTools.js';
import type { SystemPreview } from './system.js';
import type { SketchupService } from './sketchup.js';
import { pluginsDir } from './sketchup.js';
import { projectFile } from './cadTools.js';
import {
  SKETCHUP_EXPORTS,
  SKETCHUP_OP_NAMES,
  SKETCHUP_UNITS,
  SKETCHUP_VIEWS,
  describeSketchupOps,
  describeSketchupReport,
  parseSkp,
  sketchupWrites,
  validateSketchupOps,
  type SketchupOp,
  type SketchupUnits,
} from '../shared/sketchup.js';
import { analyzeMesh, checkPrint, describeMesh, parseStl } from '../shared/mesh3d.js';

/**
 * SketchUp for the agent. Reading a .skp (version + the preview picture stored in it) needs
 * no SketchUp. Modelling runs validated ops through the fixed Ruby runner of the Zinarix
 * extension inside the user's SketchUp, and asks first; so does installing the extension.
 */

export const SKETCHUP_TOOLS: ToolDefinition[] = [
  {
    name: 'sketchup_status',
    description:
      'SketchUp: whether it is installed (which versions), whether the Zinarix extension is installed in it, whether SketchUp is open and connected right now (and which model it has open), plus the .skp files of the project.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'sketchup_inspect',
    description:
      'Read a SketchUp .skp of the project without SketchUp: the SketchUp version that saved it, the file size, and the preview picture stored in the file (you SEE it). Works even when SketchUp is not installed.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '.skp file, relative to the open folder' } },
      required: ['path'],
    },
  },
  {
    name: 'sketchup_model',
    description:
      'Model in the user\'s SketchUp without writing Ruby: apply "ops" in order to a .skp of the project (opened in SketchUp; created when it does not exist; without "path", the model open in SketchUp now), save it, and return the report (groups / components with sizes, materials, tags) and a picture of the view. If one op fails, the changes are undone. SketchUp must be installed with the Zinarix extension (sketchup_status; sketchup_install_extension); Zinarix starts SketchUp when it is closed. ' +
      `Lengths are in "units" (${SKETCHUP_UNITS.join('|')}, default mm; any op can override with its own "units"), Z is up, angles in degrees, colours "#rrggbb". Every shape becomes a named group; refer to groups / components by "target" name. Ops: ` +
      '{op:"add_box", name, x, y, z (corner), w (X), d (Y), h (Z)}; {op:"add_rect", name, x, y, z, w, d} (flat face); {op:"add_face", name, points:[[x,y,z]…]}; {op:"pushpull", target, distance} (largest face of the group); ' +
      '{op:"add_cylinder", name, x, y, z (base centre), radius, h, segments}; {op:"move", target, to:[x,y,z] (new min corner) | by:[dx,dy,dz]}; {op:"rotate", target, angle, axis:x|y|z, about:[x,y,z]}; {op:"scale", target, factor (number or [sx,sy,sz]), about}; ' +
      '{op:"group", targets:[names], name}; {op:"delete", target}; {op:"material", target, name, color, alpha 0-1, texture (image of the project)}; {op:"tag", target, tag}; ' +
      '{op:"add_component", path (.skp of the project), name, x, y, z}; {op:"add_text", text, x, y, z}; {op:"add_dimension", from:[x,y,z], to:[x,y,z], offset:[x,y,z]}; ' +
      `{op:"view", preset:${SKETCHUP_VIEWS.join('|')}, perspective, zoom_extents (default true)}; {op:"save", path?}; {op:"export", path (${SKETCHUP_EXPORTS.join('/')}; png/jpg take width, height)}; {op:"open", path}. ` +
      'Export .stl/.obj/.dae to preview the model in Zinarix or to 3D print it (STL is checked for printing). The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '.skp file, relative to the open folder (absent = the model open in SketchUp)' },
        units: { type: 'string', enum: [...SKETCHUP_UNITS] },
        ops: {
          type: 'array',
          maxItems: 100,
          items: { type: 'object', properties: { op: { type: 'string', enum: [...SKETCHUP_OP_NAMES] } }, required: ['op'] },
        },
        save: { type: 'boolean', description: 'Save the .skp after the ops (default true when "path" is given)' },
        picture: { type: 'boolean', description: 'Return a picture of the view (default true)' },
      },
      required: ['ops'],
    },
  },
  {
    name: 'sketchup_screenshot',
    description:
      'Picture of what the open SketchUp shows (view.write_image). "view" first moves the camera to a standard view (iso, top, front…) and zooms to the whole model. Needs SketchUp open with the Zinarix extension.',
    parameters: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: [...SKETCHUP_VIEWS] },
        width: { type: 'number', description: 'Pixels (default 1024)' },
        height: { type: 'number', description: 'Pixels (default 640)' },
      },
    },
  },
  {
    name: 'sketchup_install_extension',
    description:
      'Install the Zinarix extension in SketchUp (copies zinarix_sketchup.rb to its Plugins folder). SketchUp loads it the next time it starts; after that sketchup_model and sketchup_screenshot work. "version" picks one SketchUp year when several are installed. The user approves it.',
    parameters: {
      type: 'object',
      properties: { version: { type: 'number', description: 'SketchUp year, e.g. 2024 (default: the newest installed)' } },
    },
  },
];

export const SKETCHUP_TOOL_NAMES = new Set(SKETCHUP_TOOLS.map((t) => t.name));
/** Tools that only read (safe to run side by side). */
export const SKETCHUP_READ_ONLY = ['sketchup_status', 'sketchup_inspect'];

export const SKETCHUP_PROMPT_PART =
  '- sketchup_status, sketchup_inspect, sketchup_model, sketchup_screenshot and sketchup_install_extension: SketchUp (.skp; architecture, furniture, interiors). When the user talks about SketchUp or a .skp, call sketchup_status first. sketchup_inspect reads any .skp (version + its preview picture) even without SketchUp. To build or change a model use sketchup_model with ops (boxes, faces, push/pull, cylinders, move/rotate/scale, groups, materials, tags, components, text, dimensions, views, save, export) in mm by default; name every shape so later ops can target it, and look at the returned picture to check it. It needs SketchUp installed with the Zinarix extension: if sketchup_status says the extension is missing, offer sketchup_install_extension (then SketchUp must be restarted). Without SketchUp, say so, and work with files exported from SketchUp instead (.stl/.obj with mesh_check, .dae/.obj/.fbx with blender_inspect). Never invent Ruby: only these ops exist.';

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const rel = (root: string | undefined, p: string) => (root ? relative(root, p).split(sep).join('/') : p);
const SKP = /\.skp$/i;
const TEXTURE = /\.(png|jpe?g|bmp|tiff?|tga)$/i;

function units(a: Record<string, unknown>): SketchupUnits {
  return (SKETCHUP_UNITS as readonly string[]).includes(s(a.units)) ? (s(a.units) as SketchupUnits) : 'mm';
}

function opsOf(a: Record<string, unknown>, root: string | undefined): SketchupOp[] {
  return validateSketchupOps(a.ops ?? [], (q, why) => projectFile(root, q, why === 'texture' ? TEXTURE : undefined));
}

export function sketchupPreview(
  svc: SketchupService | undefined,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
): SystemPreview | { error: string } | null {
  try {
    switch (name) {
      case 'sketchup_status':
      case 'sketchup_inspect':
      case 'sketchup_screenshot':
        return null;
      case 'sketchup_model': {
        const p = a.path ? projectFile(root, a.path, SKP) : undefined;
        const ops = opsOf(a, root);
        const writes = sketchupWrites(ops).map((o) => rel(root, o));
        const what = p ? `${existsSync(p) ? 'editar' : 'crear'} ${rel(root, p)}` : 'editar el modelo abierto';
        return {
          risk: 'medium',
          action: `SketchUp: ${what} (${ops.length} ${ops.length === 1 ? 'operación' : 'operaciones'})`,
          warning: `${describeSketchupOps(ops)}.${writes.length ? ` Escribe ${writes.join(', ')}.` : ''}${p && a.save !== false ? ' Se guarda el .skp.' : ''} Se ejecuta en tu SketchUp (se puede deshacer con Ctrl+Z en SketchUp).`,
          ...(p ? { path: p } : {}),
          allowKey: `sketchup_model:${p ? rel(root, p) : '(abierto)'}`,
        };
      }
      case 'sketchup_install_extension': {
        const year = typeof a.version === 'number' ? Math.round(a.version) : (svc?.active()?.year ?? null);
        if (!year) return { error: 'SketchUp is not installed (no version found). The user can install it from sketchup.com.' };
        const dir = pluginsDir(year);
        return {
          risk: 'medium',
          action: `instalar la extensión de Zinarix en SketchUp ${year}`,
          warning: `Se copian zinarix_sketchup.rb y su carpeta a ${dir}. SketchUp la carga al abrirse y solo ejecuta las operaciones que Zinarix valida (no código libre).`,
          path: dir,
          allowKey: 'sketchup_install_extension',
        };
      }
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  return null;
}

export interface SketchupToolResult {
  ok: boolean;
  content: string;
  summary: string;
  image?: ComputerShot;
  changed?: string;
}

const pngShot = (png: Buffer | Uint8Array, width: number, height: number): ComputerShot => ({
  mediaType: 'image/png',
  data: Buffer.from(png).toString('base64'),
  width,
  height,
});

/** Width × height from a PNG's IHDR. */
function pngSize(b: Buffer): [number, number] {
  return b.length > 24 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0];
}

/** Reads at most "max" bytes of a .skp (the thumbnail sits near the start; big files stay out of memory). */
export async function readSkpHead(p: string, max = 64 * 1024 * 1024): Promise<Buffer> {
  const size = statSync(p).size;
  if (size <= max) return readFile(p);
  const fh = await open(p, 'r');
  try {
    const b = Buffer.alloc(max);
    await fh.read(b, 0, max, 0);
    return b;
  } finally {
    await fh.close();
  }
}

export async function runSketchupTool(
  svc: SketchupService | undefined,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
  signal: AbortSignal,
  listFiles?: () => Promise<string[]>,
): Promise<SketchupToolResult> {
  try {
    if (name === 'sketchup_inspect') {
      const p = projectFile(root, a.path, SKP);
      if (!existsSync(p)) return { ok: false, content: `${s(a.path)} does not exist.`, summary: 'no existe' };
      const info = parseSkp(await readSkpHead(p));
      const size = statSync(p).size;
      const st = svc?.status();
      const lines = [
        `${rel(root, p)}: saved with ${info.label}${info.version ? ` (version ${info.version})` : ''}, ${(size / 1024 / 1024).toFixed(2)} MB.`,
        info.thumbnail ? `Picture: the preview SketchUp stored in the file (${info.thumbnail.width}×${info.thumbnail.height}).` : 'The file has no preview picture.',
      ];
      if (st?.active?.year && info.year && info.year > st.active.year)
        lines.push(`Warning: the installed SketchUp ${st.active.year} is older than the file (${info.year}); it may not open it.`);
      if (!st?.active) lines.push('SketchUp is not installed: the geometry cannot be read or changed here (export .dae/.obj/.stl from SketchUp to work with it).');
      return {
        ok: true,
        content: lines.join('\n'),
        summary: info.label,
        ...(info.thumbnail ? { image: pngShot(info.thumbnail.png, info.thumbnail.width, info.thumbnail.height) } : {}),
      };
    }
    if (!svc) return { ok: false, content: 'SketchUp support is not available.', summary: 'no disponible' };
    if (name === 'sketchup_status') {
      const st = svc.status();
      const files = listFiles ? (await listFiles().catch(() => [] as string[])).filter((f) => SKP.test(f)).slice(0, 100) : [];
      const lines = [
        st.installs.length
          ? `SketchUp installed: ${st.installs.map((x) => `${x.year ?? '?'} (${x.exe})`).join('; ')}. Using ${st.active?.year ?? '?'}.`
          : 'SketchUp is NOT installed (sketchup.com). .skp files can still be inspected (version + preview picture), and models exported from SketchUp (.stl/.obj/.dae) can be checked with mesh_check / blender_inspect.',
        st.extension.installed
          ? st.extension.outdated
            ? 'The Zinarix extension is installed but OUTDATED: run sketchup_install_extension and restart SketchUp.'
            : 'The Zinarix extension is installed.'
          : st.active
            ? 'The Zinarix extension is NOT installed: sketchup_install_extension installs it (then SketchUp must be restarted).'
            : '',
        st.connected
          ? `SketchUp ${st.running?.version ?? ''} is open and connected${st.running?.model ? `, model ${st.running.model}` : ', with an unsaved model'}.`
          : 'SketchUp is not open with the extension right now (sketchup_model starts it).',
        files.length ? `.skp files of the project:\n${files.map((f) => `- ${f}`).join('\n')}` : root ? 'No .skp files in the project.' : '',
      ].filter(Boolean);
      return { ok: true, content: lines.join('\n'), summary: st.connected ? 'conectado' : st.active ? `SketchUp ${st.active.year ?? ''}`.trim() : 'sin SketchUp' };
    }
    if (name === 'sketchup_install_extension') {
      const year = typeof a.version === 'number' ? Math.round(a.version) : undefined;
      const path = await svc.installExtension(year);
      return {
        ok: true,
        content: `Installed the Zinarix extension at ${path}. ${svc.alive() ? 'SketchUp is open: it must be closed and opened again to load the extension.' : 'It loads the next time SketchUp starts.'}`,
        summary: 'extensión instalada',
      };
    }
    if (name === 'sketchup_screenshot') {
      const preset = (SKETCHUP_VIEWS as readonly string[]).includes(s(a.view)) ? s(a.view) : '';
      const width = Math.round(Math.min(4096, Math.max(64, typeof a.width === 'number' ? a.width : 1024)));
      const height = Math.round(Math.min(4096, Math.max(64, typeof a.height === 'number' ? a.height : 640)));
      const r = await svc.run(
        { units: 'mm', ops: preset ? [{ op: 'view', preset, zoom_extents: true }] : [], save: false, shot: { path: '', width, height } },
        { signal, launch: false, timeoutMs: 60_000 },
      );
      if (!r.ok) return { ok: false, content: `SketchUp: ${r.error ?? 'failed'}`, summary: 'falló' };
      if (!r.shot) return { ok: false, content: 'SketchUp did not write the picture.', summary: 'sin imagen' };
      const [w, h] = pngSize(r.shot);
      return {
        ok: true,
        content: `Picture of SketchUp's view${preset ? ` (${preset})` : ''}. ${r.report ? describeSketchupReport(r.report) : ''}`,
        summary: 'captura',
        image: pngShot(r.shot, w || width, h || height),
      };
    }
    if (name === 'sketchup_model') {
      const p = a.path ? projectFile(root, a.path, SKP) : undefined;
      const ops = opsOf(a, root);
      if (p) await mkdir(dirname(p), { recursive: true });
      for (const w of sketchupWrites(ops)) await mkdir(dirname(w), { recursive: true });
      const picture = a.picture !== false;
      const r = await svc.run(
        {
          ...(p ? { path: p } : {}),
          units: units(a),
          ops,
          save: p ? a.save !== false : a.save === true,
          ...(picture ? { shot: { path: '', width: 1024, height: 640 } } : {}),
        },
        { signal, launch: true },
      );
      if (!r.ok || !r.report) return { ok: false, content: `SketchUp: ${r.error ?? 'failed'} (nothing was changed).`, summary: 'falló' };
      const notes: string[] = [];
      for (const out of r.report.exported) {
        if (!/\.stl$/i.test(out) || !existsSync(out)) continue;
        try {
          const m = analyzeMesh(parseStl(await readFile(out)));
          notes.push(`Print check of ${rel(root, out)} (units as exported):\n${describeMesh(m, checkPrint(m))}`);
        } catch {
          // not readable: skip
        }
      }
      const report = {
        ...r.report,
        model: r.report.model ? rel(root, r.report.model) : '',
        exported: r.report.exported.map((x) => rel(root, x)),
        ...(r.report.saved ? { saved: rel(root, r.report.saved) } : {}),
      };
      const [w, h] = r.shot ? pngSize(r.shot) : [0, 0];
      return {
        ok: true,
        content: [describeSketchupReport(report), ...notes, ...(r.shot ? ['Picture: SketchUp\'s view after the ops.'] : [])].join('\n\n'),
        summary: `${ops.length} operaciones`,
        ...(r.shot ? { image: pngShot(r.shot, w || 1024, h || 640) } : {}),
        ...(r.report.exported[0] || r.report.saved ? { changed: r.report.exported[0] ?? r.report.saved } : {}),
      };
    }
    return { ok: false, content: `Unknown tool ${name}.`, summary: 'desconocida' };
  } catch (e) {
    return { ok: false, content: (e as Error).message, summary: 'falló' };
  }
}
