/**
 * Fase 7: structured Blender edits for the agent (blender_model). The agent does not write
 * Python here: it sends a list of ops that this file validates (names, numbers, enums, every
 * setting of every modifier) and a FIXED runner script (BLENDER_RUNNER_PY, below) applies them
 * inside Blender, reading them as JSON. So what the user approves is exactly what happens.
 * Blender units: metres, Z up. Rotations in degrees.
 */

export const BLENDER_PRIMITIVES = [
  'cube',
  'uv_sphere',
  'ico_sphere',
  'cylinder',
  'cone',
  'torus',
  'plane',
  'circle',
  'monkey',
  'text',
] as const;

/** Modifier -> the settings it takes and their kind. */
const MOD_SETTINGS = {
  bevel: { width: 'num', segments: 'int', angle: 'deg', limit: ['NONE', 'ANGLE', 'WEIGHT'] },
  subsurf: { levels: 'int', render_levels: 'int' },
  mirror: { axis: ['X', 'Y', 'Z', 'XY', 'XZ', 'YZ', 'XYZ'], bisect: 'bool', clip: 'bool', object: 'obj' },
  array: { count: 'int', offset: 'vec3', constant: 'vec3', merge: 'bool' },
  solidify: { thickness: 'num', offset: 'num', even: 'bool' },
  boolean: { operation: ['DIFFERENCE', 'UNION', 'INTERSECT'], object: 'obj', solver: ['EXACT', 'FLOAT', 'MANIFOLD'], hide_cutter: 'bool' },
  decimate: { ratio: 'num' },
  remesh: { voxel_size: 'num', smooth: 'bool' },
  smooth: { factor: 'num', iterations: 'int' },
  weld: { distance: 'num' },
  triangulate: {},
  wireframe: { thickness: 'num' },
  screw: { angle: 'deg', steps: 'int', offset: 'num', axis: ['X', 'Y', 'Z'] },
  displace: { strength: 'num', mid_level: 'num' },
  weighted_normal: {},
  skin: {},
} as const satisfies Record<string, Record<string, string | readonly string[]>>;

export type BlenderModifier = keyof typeof MOD_SETTINGS;
export const BLENDER_MODIFIERS = Object.keys(MOD_SETTINGS) as BlenderModifier[];
export const BLENDER_EXPORTS = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'usd'] as const;
export const BLENDER_IMPORTS = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply'] as const;
export const UV_METHODS = ['smart', 'cube', 'cylinder', 'sphere', 'lightmap', 'reset'] as const;
export const BLENDER_OP_NAMES = [
  'add',
  'transform',
  'delete',
  'duplicate',
  'rename',
  'modifier',
  'modifier_remove',
  'apply',
  'material',
  'uv',
  'shade',
  'origin',
  'join',
  'import',
  'export',
] as const;

export type BlenderOp = { op: (typeof BLENDER_OP_NAMES)[number] } & Record<string, unknown>;

/** Asks the caller to turn a path the agent gave into an absolute one it allows. */
export type PathResolver = (path: string, purpose: 'export' | 'import' | 'texture') => string;

const MAX_OPS = 60;
const OBJ_NAME = /^[^\u0000-\u001f"\\]{1,63}$/;

function err(i: number, op: string, msg: string): never {
  throw new Error(`op #${i + 1} (${op}): ${msg}`);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function vec3(v: unknown, i: number, op: string, what: string, lim = 1e6): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum) || v.some((x) => Math.abs(x) > lim))
    err(i, op, `"${what}" must be [x, y, z] numbers`);
  return v as [number, number, number];
}

function name(v: unknown, i: number, op: string, what = 'object'): string {
  if (typeof v !== 'string' || !OBJ_NAME.test(v)) err(i, op, `"${what}" must be an object name (1–63 characters)`);
  return v;
}

function num(v: unknown, i: number, op: string, what: string, min: number, max: number): number {
  if (!isNum(v) || v < min || v > max) err(i, op, `"${what}" must be a number from ${min} to ${max}`);
  return v;
}

function color(v: unknown, i: number, op: string, what: string): [number, number, number, number] {
  if (typeof v === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
    if (!m) err(i, op, `"${what}" must be "#rrggbb"`);
    const n = parseInt(m[1]!, 16);
    // sRGB -> linear, what Blender's colour sockets hold.
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), 1];
  }
  err(i, op, `"${what}" must be "#rrggbb"`);
}

/**
 * Checks and normalises the ops (the runner trusts its input). Paths go through `resolve`,
 * which returns absolute paths or throws. Returns plain JSON for the runner.
 */
export function validateBlenderOps(raw: unknown, resolve: PathResolver): BlenderOp[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('"ops" must be a non-empty array.');
  if (raw.length > MAX_OPS) throw new Error(`At most ${MAX_OPS} ops per call.`);
  return raw.map((r, i): BlenderOp => {
    if (!r || typeof r !== 'object') err(i, '?', 'must be an object');
    const a = r as Record<string, unknown>;
    const op = String(a.op ?? '');
    if (!(BLENDER_OP_NAMES as readonly string[]).includes(op)) err(i, op || '?', `unknown op; use ${BLENDER_OP_NAMES.join(', ')}`);
    const out: Record<string, unknown> = { op };
    const tf = () => {
      if (a.location !== undefined) out.location = vec3(a.location, i, op, 'location');
      if (a.rotation !== undefined) out.rotation = vec3(a.rotation, i, op, 'rotation', 36000);
      if (a.scale !== undefined) out.scale = vec3(a.scale, i, op, 'scale', 1e4);
    };
    switch (op) {
      case 'add': {
        const t = String(a.type ?? '');
        if (!(BLENDER_PRIMITIVES as readonly string[]).includes(t)) err(i, op, `"type" must be ${BLENDER_PRIMITIVES.join('|')}`);
        out.type = t;
        if (a.name !== undefined) out.name = name(a.name, i, op, 'name');
        if (a.size !== undefined) out.size = num(a.size, i, op, 'size', 1e-6, 1e5);
        if (a.segments !== undefined) out.segments = Math.round(num(a.segments, i, op, 'segments', 3, 256));
        if (t === 'text') {
          if (typeof a.text !== 'string' || !a.text || a.text.length > 200) err(i, op, '"text" (1–200 characters) is required');
          out.text = a.text;
          if (a.extrude !== undefined) out.extrude = num(a.extrude, i, op, 'extrude', 0, 1e3);
        }
        tf();
        break;
      }
      case 'transform':
        out.object = name(a.object, i, op);
        tf();
        if (!('location' in out || 'rotation' in out || 'scale' in out)) err(i, op, 'give location, rotation and/or scale');
        break;
      case 'delete':
        out.object = name(a.object, i, op);
        break;
      case 'duplicate':
        out.object = name(a.object, i, op);
        if (a.name !== undefined) out.name = name(a.name, i, op, 'name');
        tf();
        break;
      case 'rename':
        out.object = name(a.object, i, op);
        out.name = name(a.name, i, op, 'name');
        break;
      case 'modifier': {
        out.object = name(a.object, i, op);
        const type = String(a.type ?? '') as BlenderModifier;
        if (!(type in MOD_SETTINGS)) err(i, op, `"type" must be ${BLENDER_MODIFIERS.join('|')}`);
        out.type = type;
        if (a.name !== undefined) out.name = name(a.name, i, op, 'name');
        const spec = MOD_SETTINGS[type] as Record<string, string | readonly string[]>;
        const set: Record<string, unknown> = {};
        const given = (a.settings ?? {}) as Record<string, unknown>;
        if (typeof given !== 'object' || Array.isArray(given)) err(i, op, '"settings" must be an object');
        for (const [k, v] of Object.entries(given)) {
          const kind = spec[k];
          if (!kind) err(i, op, `${type} has no setting "${k}" (it takes: ${Object.keys(spec).join(', ') || 'none'})`);
          if (Array.isArray(kind)) {
            const up = String(v).toUpperCase();
            if (!kind.includes(up)) err(i, op, `"${k}" must be ${kind.join('|')}`);
            set[k] = up;
          } else if (kind === 'num') set[k] = num(v, i, op, k, -1e4, 1e4);
          else if (kind === 'int') set[k] = Math.round(num(v, i, op, k, 0, 10_000));
          else if (kind === 'deg') set[k] = num(v, i, op, k, -36000, 36000);
          else if (kind === 'bool') {
            if (typeof v !== 'boolean') err(i, op, `"${k}" must be true or false`);
            set[k] = v;
          } else if (kind === 'vec3') set[k] = vec3(v, i, op, k);
          else if (kind === 'obj') set[k] = name(v, i, op, k);
        }
        if (type === 'subsurf' && ((set.levels as number) > 6 || (set.render_levels as number) > 6))
          err(i, op, 'subsurf levels go up to 6');
        if (type === 'array' && (set.count as number) > 1000) err(i, op, 'array count goes up to 1000');
        if (type === 'boolean' && !set.object) err(i, op, 'boolean needs "object" (the cutter) in settings');
        if (type === 'remesh' && set.voxel_size !== undefined && (set.voxel_size as number) <= 0) err(i, op, 'voxel_size must be > 0');
        out.settings = set;
        break;
      }
      case 'modifier_remove':
        out.object = name(a.object, i, op);
        out.name = name(a.name, i, op, 'name');
        break;
      case 'apply':
        out.object = name(a.object, i, op);
        if (a.modifiers !== undefined) {
          if (!Array.isArray(a.modifiers)) err(i, op, '"modifiers" must be a list of modifier names');
          out.modifiers = a.modifiers.map((m) => name(m, i, op, 'modifiers'));
        }
        break;
      case 'material':
        out.object = name(a.object, i, op);
        if (a.name !== undefined) out.name = name(a.name, i, op, 'name');
        if (a.color !== undefined) out.color = color(a.color, i, op, 'color');
        if (a.metallic !== undefined) out.metallic = num(a.metallic, i, op, 'metallic', 0, 1);
        if (a.roughness !== undefined) out.roughness = num(a.roughness, i, op, 'roughness', 0, 1);
        if (a.alpha !== undefined) out.alpha = num(a.alpha, i, op, 'alpha', 0, 1);
        if (a.emission !== undefined) out.emission = color(a.emission, i, op, 'emission');
        if (a.emission_strength !== undefined) out.emission_strength = num(a.emission_strength, i, op, 'emission_strength', 0, 1000);
        if (a.texture !== undefined) {
          if (typeof a.texture !== 'string' || !/\.(png|jpe?g|webp|tga|exr|hdr|bmp|tiff?)$/i.test(a.texture))
            err(i, op, '"texture" must be an image file');
          out.texture = resolve(a.texture, 'texture');
        }
        if (a.slot !== undefined) out.slot = Math.round(num(a.slot, i, op, 'slot', 0, 64));
        break;
      case 'uv': {
        out.object = name(a.object, i, op);
        const m = String(a.method ?? 'smart');
        if (!(UV_METHODS as readonly string[]).includes(m)) err(i, op, `"method" must be ${UV_METHODS.join('|')}`);
        out.method = m;
        if (a.angle !== undefined) out.angle = num(a.angle, i, op, 'angle', 1, 89);
        if (a.margin !== undefined) out.margin = num(a.margin, i, op, 'margin', 0, 1);
        break;
      }
      case 'shade':
        out.object = name(a.object, i, op);
        if (typeof a.smooth !== 'boolean') err(i, op, '"smooth" must be true or false');
        out.smooth = a.smooth;
        if (a.angle !== undefined) out.angle = num(a.angle, i, op, 'angle', 0, 180);
        break;
      case 'origin': {
        out.object = name(a.object, i, op);
        const to = String(a.to ?? 'geometry');
        if (!['geometry', 'bottom', 'world'].includes(to)) err(i, op, '"to" must be geometry|bottom|world');
        out.to = to;
        break;
      }
      case 'join':
        if (!Array.isArray(a.objects) || a.objects.length < 2) err(i, op, '"objects" must list 2 or more names');
        out.objects = a.objects.map((o) => name(o, i, op, 'objects'));
        if (a.name !== undefined) out.name = name(a.name, i, op, 'name');
        break;
      case 'import': {
        if (typeof a.path !== 'string') err(i, op, '"path" is required');
        const ext = a.path.split('.').pop()!.toLowerCase();
        if (!(BLENDER_IMPORTS as readonly string[]).includes(ext)) err(i, op, `imports ${BLENDER_IMPORTS.join(', ')}`);
        out.path = resolve(a.path, 'import');
        out.format = ext;
        if (a.scale !== undefined) out.scale = num(a.scale, i, op, 'scale', 1e-6, 1e6);
        break;
      }
      case 'export': {
        if (typeof a.path !== 'string') err(i, op, '"path" is required');
        const ext = a.path.split('.').pop()!.toLowerCase();
        const fmt = ext === 'usdc' || ext === 'usda' || ext === 'usdz' ? 'usd' : ext;
        if (!(BLENDER_EXPORTS as readonly string[]).includes(fmt)) err(i, op, `exports ${BLENDER_EXPORTS.join(', ')}`);
        out.path = resolve(a.path, 'export');
        out.format = fmt;
        if (a.objects !== undefined) {
          if (!Array.isArray(a.objects) || !a.objects.length) err(i, op, '"objects" must list object names');
          out.objects = a.objects.map((o) => name(o, i, op, 'objects'));
        }
        if (a.scale !== undefined) out.scale = num(a.scale, i, op, 'scale', 1e-6, 1e6);
        out.apply_modifiers = a.apply_modifiers !== false;
        break;
      }
    }
    return out as BlenderOp;
  });
}

const base = (p: unknown) => String(p).split(/[\\/]/).pop();

/** One short Spanish line per op, for the approval card. */
export function describeBlenderOps(ops: BlenderOp[]): string {
  const one = (o: BlenderOp): string => {
    const ob = typeof o.object === 'string' ? `"${o.object}"` : '';
    switch (o.op) {
      case 'add':
        return `añadir ${o.type}${o.name ? ` "${o.name}"` : ''}`;
      case 'transform':
        return `mover/girar/escalar ${ob}`;
      case 'delete':
        return `borrar ${ob}`;
      case 'duplicate':
        return `duplicar ${ob}`;
      case 'rename':
        return `renombrar ${ob} a "${o.name}"`;
      case 'modifier':
        return `modificador ${o.type} en ${ob}`;
      case 'modifier_remove':
        return `quitar el modificador "${o.name}" de ${ob}`;
      case 'apply':
        return `aplicar modificadores de ${ob}`;
      case 'material':
        return `material${o.name ? ` "${o.name}"` : ''} en ${ob}${o.texture ? ` con la textura ${base(o.texture)}` : ''}`;
      case 'uv':
        return `desplegar UV (${o.method}) de ${ob}`;
      case 'shade':
        return `sombreado ${o.smooth ? 'suave' : 'plano'} en ${ob}`;
      case 'origin':
        return `origen de ${ob}`;
      case 'join':
        return `unir ${(o.objects as string[]).length} objetos`;
      case 'import':
        return `importar ${base(o.path)}`;
      case 'export':
        return `exportar a ${base(o.path)}`;
    }
  };
  const lines = ops.map(one);
  return lines.length > 8 ? `${lines.slice(0, 8).join('; ')}; y ${lines.length - 8} más` : lines.join('; ');
}

/** Files the ops write (for the approval card and to tell the editor). */
export const exportsOf = (ops: BlenderOp[]): string[] =>
  ops.filter((o) => o.op === 'export').map((o) => String(o.path));

export interface BlenderObjectInfo {
  name: string;
  type: string;
  location: number[];
  rotation: number[];
  scale: number[];
  dimensions: number[];
  vertices?: number;
  faces?: number;
  triangles?: number;
  modifiers?: { name: string; type: string }[];
  materials?: string[];
  uv?: string[];
  parent?: string;
}

export interface BlenderReport {
  blender: string;
  objects: BlenderObjectInfo[];
  materials: string[];
  /** Units of the scene ("METRIC", scale_length). */
  units: { system: string; scale: number };
  exported: string[];
  saved?: string;
  preview?: string;
  warnings: string[];
}

/** The report as text for the agent. */
export function describeBlenderReport(r: BlenderReport): string {
  const v3 = (v: number[]) => v.map((x) => +x.toFixed(3)).join(', ');
  const lines = [
    `Blender ${r.blender}; units ${r.units.system} (scale ${r.units.scale}); ${r.objects.length} object(s).`,
    ...r.objects.slice(0, 80).map((o) => {
      const mesh = o.vertices !== undefined ? ` ${o.vertices} verts, ${o.faces} faces, ${o.triangles} tris` : '';
      const mods = o.modifiers?.length ? ` modifiers: ${o.modifiers.map((m) => `${m.name}(${m.type})`).join(', ')}` : '';
      const mats = o.materials?.length ? ` materials: ${o.materials.join(', ')}` : '';
      const uv = o.type === 'MESH' ? (o.uv?.length ? ` UV: ${o.uv.join(', ')}` : ' no UV') : '';
      return `- "${o.name}" ${o.type} at [${v3(o.location)}] rot [${v3(o.rotation)}]° scale [${v3(o.scale)}] size [${v3(o.dimensions)}] m;${mesh}${mods}${mats}${uv}${o.parent ? ` parent ${o.parent}` : ''}`;
    }),
    ...(r.objects.length > 80 ? [`… and ${r.objects.length - 80} more`] : []),
    ...(r.exported.length ? [`Exported: ${r.exported.join(', ')}`] : []),
    ...(r.saved ? [`Saved: ${r.saved}`] : []),
    ...r.warnings.map((w) => `Warning: ${w}`),
  ];
  return lines.join('\n');
}

/**
 * The runner. argv after "--": the job JSON file {ops, save, preview, report, input}.
 * Opens (or the caller already opened) the file, applies the ops, writes the report, renders a
 * Workbench preview, saves. Any failure exits with code 1 before saving anything.
 */
export const BLENDER_RUNNER_PY = String.raw`
import bpy, bmesh, json, math, os, sys, traceback
from mathutils import Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
warnings = []
exported = []

def fail(msg):
    print("ZINARIX_ERROR " + msg, flush=True)
    sys.exit(1)

if job.get("input"):
    ext = os.path.splitext(job["input"])[1].lower()
    if ext != ".blend":
        bpy.ops.wm.read_factory_settings(use_empty=True)
        p = job["input"]
        if ext in (".glb", ".gltf"): bpy.ops.import_scene.gltf(filepath=p)
        elif ext == ".fbx": bpy.ops.import_scene.fbx(filepath=p)
        elif ext == ".obj": bpy.ops.wm.obj_import(filepath=p)
        elif ext == ".stl": bpy.ops.wm.stl_import(filepath=p)
        elif ext == ".ply": bpy.ops.wm.ply_import(filepath=p)
        else: fail("cannot open " + ext)
elif job.get("new"):
    bpy.ops.wm.read_factory_settings(use_empty=True)

scene = bpy.context.scene

def obj(name):
    o = bpy.data.objects.get(name)
    if o is None:
        names = ", ".join(sorted(x.name for x in scene.objects)[:30])
        raise ValueError('no object "%s" (objects: %s)' % (name, names or "none"))
    return o

def active(o):
    for x in list(bpy.context.view_layer.objects):
        if x is not None: x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)

def tf(o, op):
    if "location" in op: o.location = op["location"]
    if "rotation" in op: o.rotation_euler = [math.radians(v) for v in op["rotation"]]
    if "scale" in op: o.scale = op["scale"]

def to_mesh(o):
    if o.type in ("CURVE", "FONT", "SURFACE", "META"):
        active(o)
        bpy.ops.object.convert(target="MESH")
    return o

def ensure_mode():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

MOD_TYPES = {"bevel": "BEVEL", "subsurf": "SUBSURF", "mirror": "MIRROR", "array": "ARRAY",
  "solidify": "SOLIDIFY", "boolean": "BOOLEAN", "decimate": "DECIMATE", "remesh": "REMESH",
  "smooth": "SMOOTH", "weld": "WELD", "triangulate": "TRIANGULATE", "wireframe": "WIREFRAME",
  "screw": "SCREW", "displace": "DISPLACE", "weighted_normal": "WEIGHTED_NORMAL", "skin": "SKIN"}

def set_mod(m, t, s):
    if t == "bevel":
        if "width" in s: m.width = s["width"]
        if "segments" in s: m.segments = max(1, s["segments"])
        if "limit" in s: m.limit_method = s["limit"]
        if "angle" in s: m.angle_limit = math.radians(s["angle"])
    elif t == "subsurf":
        if "levels" in s: m.levels = s["levels"]
        if "render_levels" in s: m.render_levels = s["render_levels"]
    elif t == "mirror":
        if "axis" in s:
            m.use_axis = ["X" in s["axis"], "Y" in s["axis"], "Z" in s["axis"]]
            if "bisect" in s: m.use_bisect_axis = [a and s["bisect"] for a in m.use_axis]
        if "clip" in s: m.use_clip = s["clip"]
        if "object" in s: m.mirror_object = obj(s["object"])
    elif t == "array":
        if "count" in s: m.count = max(1, s["count"])
        if "offset" in s:
            m.use_relative_offset = True
            m.relative_offset_displace = s["offset"]
        if "constant" in s:
            m.use_constant_offset = True
            m.constant_offset_displace = s["constant"]
        if "merge" in s: m.use_merge_vertices = s["merge"]
    elif t == "solidify":
        if "thickness" in s: m.thickness = s["thickness"]
        if "offset" in s: m.offset = s["offset"]
        if "even" in s: m.use_even_offset = s["even"]
    elif t == "boolean":
        if "operation" in s: m.operation = s["operation"]
        if "solver" in s:
            try: m.solver = s["solver"]
            except TypeError: warnings.append("boolean solver %s not in this Blender" % s["solver"])
        cutter = obj(s["object"])
        m.object = cutter
        if s.get("hide_cutter", True):
            cutter.hide_render = True
            cutter.display_type = "WIRE"
    elif t == "decimate":
        if "ratio" in s: m.ratio = min(1.0, max(0.0, s["ratio"]))
    elif t == "remesh":
        m.mode = "VOXEL"
        if "voxel_size" in s: m.voxel_size = s["voxel_size"]
        if "smooth" in s: m.use_smooth_shade = s["smooth"]
    elif t == "smooth":
        if "factor" in s: m.factor = s["factor"]
        if "iterations" in s: m.iterations = s["iterations"]
    elif t == "weld":
        if "distance" in s: m.merge_threshold = s["distance"]
    elif t == "wireframe":
        if "thickness" in s: m.thickness = s["thickness"]
    elif t == "screw":
        if "angle" in s: m.angle = math.radians(s["angle"])
        if "steps" in s: m.steps = max(1, s["steps"])
        if "offset" in s: m.screw_offset = s["offset"]
        if "axis" in s: m.axis = s["axis"]
    elif t == "displace":
        if "strength" in s: m.strength = s["strength"]
        if "mid_level" in s: m.mid_level = s["mid_level"]

def material(o, op):
    if o.type not in ("MESH", "CURVE", "FONT", "SURFACE", "META"):
        raise ValueError('"%s" (%s) cannot have materials' % (o.name, o.type))
    slot = op.get("slot", 0)
    mat = None
    if "name" in op: mat = bpy.data.materials.get(op["name"])
    if mat is None and slot < len(o.material_slots) and o.material_slots[slot].material and "name" not in op:
        mat = o.material_slots[slot].material
    if mat is None:
        mat = bpy.data.materials.new(op.get("name", o.name + " material"))
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    def inp(*names):
        for n in names:
            if n in bsdf.inputs: return bsdf.inputs[n]
        return None
    if "color" in op:
        inp("Base Color").default_value = op["color"]
        mat.diffuse_color = op["color"]
    if "metallic" in op:
        inp("Metallic").default_value = op["metallic"]
        mat.metallic = op["metallic"]
    if "roughness" in op:
        inp("Roughness").default_value = op["roughness"]
        mat.roughness = op["roughness"]
    if "alpha" in op:
        inp("Alpha").default_value = op["alpha"]
        c = list(mat.diffuse_color); c[3] = op["alpha"]; mat.diffuse_color = c
        if op["alpha"] < 1:
            try: mat.surface_render_method = "BLENDED"
            except Exception: pass
    if "emission" in op:
        s = inp("Emission Color", "Emission")
        if s: s.default_value = op["emission"]
        if "emission_strength" not in op and inp("Emission Strength"): inp("Emission Strength").default_value = 1.0
    if "emission_strength" in op and inp("Emission Strength"):
        inp("Emission Strength").default_value = op["emission_strength"]
    if "texture" in op:
        img = bpy.data.images.load(op["texture"], check_existing=True)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.location = (bsdf.location.x - 320, bsdf.location.y)
        nt.links.new(tex.outputs["Color"], inp("Base Color"))
    if slot < len(o.material_slots):
        o.material_slots[slot].material = mat
    else:
        o.data.materials.append(mat)
    return mat

def uv(o, op):
    if o.type != "MESH": raise ValueError('"%s" is not a mesh' % o.name)
    active(o)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    m = op["method"]
    margin = op.get("margin", 0.02)
    if m == "smart": bpy.ops.uv.smart_project(angle_limit=math.radians(op.get("angle", 66)), island_margin=margin)
    elif m == "cube": bpy.ops.uv.cube_project()
    elif m == "cylinder": bpy.ops.uv.cylinder_project()
    elif m == "sphere": bpy.ops.uv.sphere_project()
    elif m == "lightmap": bpy.ops.uv.lightmap_pack(PREF_MARGIN_DIV=max(0.001, margin))
    elif m == "reset": bpy.ops.uv.reset()
    bpy.ops.object.mode_set(mode="OBJECT")

def add(op):
    t = op["type"]; s = op.get("size", 1.0); seg = op.get("segments")
    ensure_mode()
    if t == "cube": bpy.ops.mesh.primitive_cube_add(size=s)
    elif t == "uv_sphere": bpy.ops.mesh.primitive_uv_sphere_add(radius=s / 2, **({"segments": seg, "ring_count": max(3, seg // 2)} if seg else {}))
    elif t == "ico_sphere": bpy.ops.mesh.primitive_ico_sphere_add(radius=s / 2, subdivisions=min(6, max(1, (seg or 3) // 8 + 1)) if seg else 3)
    elif t == "cylinder": bpy.ops.mesh.primitive_cylinder_add(radius=s / 2, depth=s, **({"vertices": seg} if seg else {}))
    elif t == "cone": bpy.ops.mesh.primitive_cone_add(radius1=s / 2, depth=s, **({"vertices": seg} if seg else {}))
    elif t == "torus": bpy.ops.mesh.primitive_torus_add(major_radius=s / 2, minor_radius=s / 8, **({"major_segments": seg} if seg else {}))
    elif t == "plane": bpy.ops.mesh.primitive_plane_add(size=s)
    elif t == "circle": bpy.ops.mesh.primitive_circle_add(radius=s / 2, fill_type="NGON", **({"vertices": seg} if seg else {}))
    elif t == "monkey": bpy.ops.mesh.primitive_monkey_add(size=s)
    elif t == "text":
        bpy.ops.object.text_add()
        o = bpy.context.object
        o.data.body = op["text"]
        o.data.size = s
        o.data.extrude = op.get("extrude", 0.05 * s)
        o.data.align_x = "CENTER"
    o = bpy.context.object
    if "name" in op: o.name = op["name"]; o.data.name = op["name"]
    tf(o, op)
    return o

def bottom_origin(o):
    if o.type != "MESH": raise ValueError("origin bottom needs a mesh")
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    low = Vector((sum(v.x for v in bb) / 8, sum(v.y for v in bb) / 8, min(v.z for v in bb)))
    cur = scene.cursor.location.copy()
    scene.cursor.location = low
    active(o)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    scene.cursor.location = cur

def export(op):
    ensure_mode()
    p = op["path"]; f = op["format"]; sc = op.get("scale", 1.0)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    sel = op.get("objects")
    for x in list(bpy.context.view_layer.objects):
        if x is not None: x.select_set(False)
    if sel:
        for n in sel: obj(n).select_set(True)
    only = bool(sel)
    am = op.get("apply_modifiers", True)
    if f in ("glb", "gltf"):
        bpy.ops.export_scene.gltf(filepath=p, export_format="GLB" if f == "glb" else "GLTF_SEPARATE", use_selection=only, export_apply=am)
    elif f == "fbx":
        bpy.ops.export_scene.fbx(filepath=p, use_selection=only, use_mesh_modifiers=am, global_scale=sc)
    elif f == "obj":
        bpy.ops.wm.obj_export(filepath=p, export_selected_objects=only, apply_modifiers=am, global_scale=sc)
    elif f == "stl":
        bpy.ops.wm.stl_export(filepath=p, export_selected_objects=only, apply_modifiers=am, global_scale=sc, ascii_format=False)
    elif f == "ply":
        bpy.ops.wm.ply_export(filepath=p, export_selected_objects=only, apply_modifiers=am, global_scale=sc)
    elif f == "usd":
        bpy.ops.wm.usd_export(filepath=p, selected_objects_only=only)
    if not os.path.exists(p): raise ValueError("Blender wrote no file")
    exported.append(p)

for i, op in enumerate(job["ops"]):
    try:
        k = op["op"]
        if k == "add": add(op)
        elif k == "transform": tf(obj(op["object"]), op)
        elif k == "delete":
            bpy.data.objects.remove(obj(op["object"]), do_unlink=True)
            bpy.context.view_layer.update()
        elif k == "duplicate":
            src = obj(op["object"])
            c = src.copy()
            if src.data: c.data = src.data.copy()
            for col in src.users_collection: col.objects.link(c)
            if "name" in op: c.name = op["name"]
            tf(c, op)
        elif k == "rename": obj(op["object"]).name = op["name"]
        elif k == "modifier":
            o = obj(op["object"])
            if o.type not in ("MESH", "CURVE", "FONT", "SURFACE", "LATTICE"):
                raise ValueError('"%s" (%s) cannot have modifiers' % (o.name, o.type))
            m = o.modifiers.new(op.get("name", op["type"].capitalize()), MOD_TYPES[op["type"]])
            if m is None: raise ValueError("%s does not take a %s modifier" % (o.type, op["type"]))
            set_mod(m, op["type"], op.get("settings", {}))
        elif k == "modifier_remove":
            o = obj(op["object"]); m = o.modifiers.get(op["name"])
            if m is None: raise ValueError('"%s" has no modifier "%s" (it has: %s)' % (o.name, op["name"], ", ".join(x.name for x in o.modifiers) or "none"))
            o.modifiers.remove(m)
        elif k == "apply":
            o = to_mesh(obj(op["object"]))
            active(o)
            names = op.get("modifiers") or [m.name for m in o.modifiers]
            for n in names:
                if n not in o.modifiers: raise ValueError('"%s" has no modifier "%s"' % (o.name, n))
                bpy.ops.object.modifier_apply(modifier=n)
        elif k == "material": material(obj(op["object"]), op)
        elif k == "uv": uv(to_mesh(obj(op["object"])), op)
        elif k == "shade":
            o = obj(op["object"]); active(o)
            if op["smooth"]:
                if "angle" in op:
                    try: bpy.ops.object.shade_auto_smooth(angle=math.radians(op["angle"]))
                    except Exception: bpy.ops.object.shade_smooth()
                else: bpy.ops.object.shade_smooth()
            else: bpy.ops.object.shade_flat()
        elif k == "origin":
            o = obj(op["object"])
            if op["to"] == "bottom": bottom_origin(o)
            elif op["to"] == "world":
                cur = scene.cursor.location.copy(); scene.cursor.location = (0, 0, 0)
                active(o); bpy.ops.object.origin_set(type="ORIGIN_CURSOR"); scene.cursor.location = cur
            else: active(o); bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
        elif k == "join":
            objs = [to_mesh(obj(n)) for n in op["objects"]]
            active(objs[0])
            for x in objs[1:]: x.select_set(True)
            bpy.ops.object.join()
            if "name" in op: bpy.context.object.name = op["name"]
        elif k == "import":
            before = set(bpy.data.objects)
            p = op["path"]; f = op["format"]
            if f in ("glb", "gltf"): bpy.ops.import_scene.gltf(filepath=p)
            elif f == "fbx": bpy.ops.import_scene.fbx(filepath=p)
            elif f == "obj": bpy.ops.wm.obj_import(filepath=p)
            elif f == "stl": bpy.ops.wm.stl_import(filepath=p, global_scale=op.get("scale", 1.0))
            elif f == "ply": bpy.ops.wm.ply_import(filepath=p)
            new = [o.name for o in bpy.data.objects if o not in before]
            warnings.append("imported %s: %s" % (os.path.basename(p), ", ".join(new[:20]) or "nothing"))
        elif k == "export": export(op)
    except SystemExit:
        raise
    except Exception as e:
        fail("op #%d (%s): %s" % (i + 1, op.get("op"), e))

ensure_mode()

def info(o):
    d = {"name": o.name, "type": o.type, "location": list(o.location),
         "rotation": [math.degrees(v) for v in o.rotation_euler], "scale": list(o.scale),
         "dimensions": list(o.dimensions)}
    if o.parent: d["parent"] = o.parent.name
    if o.type == "MESH":
        me = o.data
        d["vertices"] = len(me.vertices); d["faces"] = len(me.polygons)
        d["triangles"] = sum(len(p.vertices) - 2 for p in me.polygons)
        d["uv"] = [l.name for l in me.uv_layers]
    if hasattr(o, "modifiers"): d["modifiers"] = [{"name": m.name, "type": m.type} for m in o.modifiers]
    if hasattr(o.data, "materials") and o.data is not None:
        d["materials"] = [m.name for m in o.data.materials if m]
    return d

report = {"blender": bpy.app.version_string, "objects": [info(o) for o in scene.objects],
  "materials": [m.name for m in bpy.data.materials if m.users],
  "units": {"system": scene.unit_settings.system, "scale": scene.unit_settings.scale_length},
  "exported": exported, "warnings": warnings}

if job.get("preview"):
    try:
        meshes = [o for o in scene.objects if o.type in ("MESH", "CURVE", "FONT", "SURFACE", "META") and o.visible_get()]
        if meshes:
            pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
            lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
            hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            center = (lo + hi) / 2
            radius = max((hi - lo).length / 2, 1e-4)
            cam_data = bpy.data.cameras.new("ZinarixPreviewCam")
            cam = bpy.data.objects.new("ZinarixPreviewCam", cam_data)
            scene.collection.objects.link(cam)
            cam_data.lens = 50
            cam_data.clip_end = radius * 100
            cam_data.clip_start = radius / 1000
            direction = Vector((1.0, -1.2, 0.85)).normalized()
            cam.location = center + direction * radius * 3.2
            cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
            old_cam = scene.camera
            scene.camera = cam
            r = scene.render
            old = (r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath, r.film_transparent)
            r.engine = "BLENDER_WORKBENCH"
            scene.display.shading.light = "STUDIO"
            scene.display.shading.color_type = "MATERIAL"
            scene.display.shading.show_cavity = True
            r.resolution_x = job.get("preview_size", 768); r.resolution_y = job.get("preview_size", 768)
            r.resolution_percentage = 100
            r.film_transparent = False
            # A dark backdrop (temporary: the saved file keeps its own world).
            old_world = scene.world
            tmp_world = bpy.data.worlds.new("ZinarixPreviewWorld")
            tmp_world.color = (0.035, 0.038, 0.045)
            scene.world = tmp_world
            r.image_settings.file_format = "PNG"
            r.filepath = job["preview"]
            bpy.ops.render.render(write_still=True)
            report["preview"] = job["preview"]
            r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath, r.film_transparent = old
            scene.camera = old_cam
            scene.world = old_world
            bpy.data.worlds.remove(tmp_world)
            bpy.data.objects.remove(cam, do_unlink=True)
            bpy.data.cameras.remove(cam_data)
    except Exception as e:
        warnings.append("preview failed: %s" % e)

if job.get("save"):
    try:
        bpy.ops.wm.save_as_mainfile(filepath=job["save"])
        report["saved"] = job["save"]
    except Exception as e:
        fail("could not save: %s" % e)

with open(job["report"], "w", encoding="utf-8") as fh:
    json.dump(report, fh)
print("ZINARIX_OK", flush=True)
`;
