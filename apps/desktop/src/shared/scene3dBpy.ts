/**
 * Fase 14: the Blender bridge script. toBpy() returns a fixed Python program plus the scene as
 * base64 JSON, so nothing in the scene (names, text, paths) can turn into Python code. Blender
 * runs it with `blender -b --factory-startup --python <script>` and writes a numbered RGBA PNG
 * sequence that FFmpeg then encodes (encodeArgs in scene3d.ts).
 *
 * The scene is Y up (three.js); everything hangs from one root rotated +90° on X, which is
 * Blender's Z up. Imported models are already converted to Z up by Blender's importers, so
 * they get the inverse rotation inside their node.
 *
 * Works with Blender 3.6 – 5.x: no fcurve API (it changed in 4.4 / 5.0); interpolation is set
 * through the "new keyframe" preference before each insert, and EEVEE's engine id is probed.
 */
import type { Scene3D } from './scene3d.js';

export type BlenderEngine = 'eevee' | 'cycles';

export interface BpyOptions {
  /** Folder for the frames (absolute); frames are f_0001.png… */
  framesDir: string;
  engine: BlenderEngine;
  /** Cycles samples (EEVEE uses its own default). */
  samples?: number;
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

export const FRAME_PATTERN = 'f_%04d.png';

export function toBpy(scene: Scene3D, o: BpyOptions): string {
  const data = b64(
    JSON.stringify({
      scene,
      framesDir: o.framesDir,
      engine: o.engine,
      samples: Math.max(1, Math.min(4096, Math.round(o.samples ?? 64))),
    }),
  );
  return `${BPY_PROGRAM}\nmain(json.loads(base64.b64decode("${data}").decode("utf-8")))\n`;
}

/** The fixed part. Kept as one string so the tests can check what it does and does not call. */
export const BPY_PROGRAM = String.raw`# Zinarix Studio: builds a 3D scene and renders it (generated; data is base64 JSON).
import base64, json, math, os, sys
import bpy
from mathutils import Matrix, Vector

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))

def set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return

def make_material(name, m):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return mat
    r, g, b = hex_rgb(m['color'])
    set_input(bsdf, ['Base Color'], (r, g, b, 1.0))
    set_input(bsdf, ['Metallic'], float(m['metalness']))
    set_input(bsdf, ['Roughness'], float(m['roughness']))
    er, eg, eb = hex_rgb(m['emissive'])
    set_input(bsdf, ['Emission Color', 'Emission'], (er, eg, eb, 1.0))
    set_input(bsdf, ['Emission Strength'], float(m['emissiveIntensity']))
    if float(m['opacity']) < 1.0:
        set_input(bsdf, ['Alpha'], float(m['opacity']))
        if hasattr(mat, 'blend_method'):
            try:
                mat.blend_method = 'BLEND'
            except Exception:
                pass
    return mat

def deselect_all():
    for o in bpy.context.selected_objects:
        o.select_set(False)

def new_empty(name, parent):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    return e

def rot_x(obj_data, angle):
    obj_data.transform(Matrix.Rotation(angle, 4, 'X'))

def add_shape(n):
    shape = n.get('shape', 'box')
    deselect_all()
    if shape == 'box':
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    elif shape == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, segments=48, ring_count=24)
    elif shape == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=1.0, vertices=48)
    elif shape == 'cone':
        bpy.ops.mesh.primitive_cone_add(radius1=0.5, radius2=0.0, depth=1.0, vertices=48)
    elif shape == 'torus':
        bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=0.18)
    elif shape == 'plane':
        bpy.ops.mesh.primitive_plane_add(size=1.0)
    elif shape == 'text':
        bpy.ops.object.text_add()
        o = bpy.context.active_object
        o.data.body = n.get('text', 'Texto')
        o.data.align_x = 'CENTER'
        o.data.align_y = 'CENTER'
        o.data.extrude = float(n.get('depth', 0.25)) / 2.0
        o.data.bevel_depth = 0.01
        o.data.size = 1.0
        return o
    o = bpy.context.active_object
    # Blender builds cylinders, cones and tori around Z, planes facing Z; three.js uses Y
    # for the first three and faces planes to +Z: turn the mesh so the axes match.
    if shape in ('cylinder', 'cone', 'torus'):
        rot_x(o.data, -math.pi / 2)
    if shape == 'plane':
        rot_x(o.data, math.pi / 2)
    return o

IMPORTERS = {
    '.glb': lambda p: bpy.ops.import_scene.gltf(filepath=p),
    '.gltf': lambda p: bpy.ops.import_scene.gltf(filepath=p),
    '.fbx': lambda p: bpy.ops.import_scene.fbx(filepath=p),
}

def import_obj(p):
    if hasattr(bpy.ops.wm, 'obj_import'):
        bpy.ops.wm.obj_import(filepath=p)
    else:
        bpy.ops.import_scene.obj(filepath=p)

def add_model(n, holder):
    path = n['model']
    if not os.path.isfile(path):
        raise RuntimeError('Model not found: ' + path)
    ext = os.path.splitext(path)[1].lower()
    before = set(bpy.data.objects)
    deselect_all()
    if ext == '.obj':
        import_obj(path)
    else:
        IMPORTERS[ext](path)
    new = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    # Fit to 2 m and centre (as the viewer does), measured in Blender's Z-up world.
    pts = []
    for o in new:
        if o.type == 'MESH':
            for c in o.bound_box:
                pts.append(o.matrix_world @ Vector(c))
    fix = new_empty(n['name'] + ' (ajuste)', holder)
    fix.rotation_euler = (-math.pi / 2, 0, 0)
    if pts:
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        size = max(hi[i] - lo[i] for i in range(3)) or 1.0
        s = 2.0 / size
        cx, cy, cz = [(lo[i] + hi[i]) / 2 for i in range(3)]
        fix.scale = (s, s, s)
        # Rx(-90) maps (x, y, z) to (x, z, -y).
        fix.location = (-s * cx, -s * cz, s * cy)
    for o in new:
        if o.parent is None:
            mw = o.matrix_world.copy()
            o.parent = fix
            o.matrix_parent_inverse.identity()
            o.matrix_basis = mw
    if n.get('material'):
        mat = make_material(n['name'], n['material'])
        for o in new:
            if o.type == 'MESH':
                o.data.materials.clear()
                o.data.materials.append(mat)

INTERP = {'linear': 'LINEAR', 'ease': 'BEZIER', 'hold': 'CONSTANT'}
PATHS = {
    'px': ('location', 0), 'py': ('location', 1), 'pz': ('location', 2),
    'rx': ('rotation_euler', 0), 'ry': ('rotation_euler', 1), 'rz': ('rotation_euler', 2),
    'sx': ('scale', 0), 'sy': ('scale', 1), 'sz': ('scale', 2),
}

def insert(owner, path, index, frame, ease):
    bpy.context.preferences.edit.keyframe_new_interpolation_type = INTERP.get(ease or 'linear', 'LINEAR')
    owner.keyframe_insert(data_path=path, index=index, frame=frame)

def animate(obj, keys, fps, light=None, light_scale=1.0):
    for prop, lst in (keys or {}).items():
        for k in lst:
            frame = round(k['t'] * fps) + 1
            v = float(k['v'])
            if prop == 'intensity':
                if light is not None:
                    light.energy = v * light_scale
                    insert(light, 'energy', -1, frame, k.get('ease'))
                continue
            path, i = PATHS[prop]
            if path == 'rotation_euler':
                v = math.radians(v)
            getattr(obj, path)[i] = v
            insert(obj, path, i, frame, k.get('ease'))

def set_engine(scene, engine):
    if engine == 'cycles':
        scene.render.engine = 'CYCLES'
        return
    for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = e
            return
        except Exception:
            pass

def main(cfg):
    s = cfg['scene']
    fps = int(s['fps'])
    frames = max(1, round(s['duration'] * fps))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.resolution_x = int(s['width'])
    scene.render.resolution_y = int(s['height'])
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = frames
    set_engine(scene, cfg['engine'])
    if cfg['engine'] == 'cycles':
        scene.cycles.samples = int(cfg['samples'])
        try:
            scene.cycles.use_denoising = True
        except Exception:
            pass
    scene.render.film_transparent = bool(s['transparent'])
    for vt in ('AgX', 'Filmic', 'Standard'):
        try:
            scene.view_settings.view_transform = vt
            break
        except Exception:
            pass
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA' if s['transparent'] else 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.filepath = os.path.join(cfg['framesDir'], 'f_####')

    world = bpy.data.worlds.new('Zinarix')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    amb = [n for n in s['nodes'] if n['kind'] == 'light' and n['light']['type'] == 'ambient' and n.get('visible', True)]
    if bg is not None:
        if amb:
            r, g, b = hex_rgb(amb[0]['light']['color'])
            bg.inputs[0].default_value = (r, g, b, 1.0)
            bg.inputs[1].default_value = float(amb[0]['light']['intensity'])
        else:
            r, g, b = hex_rgb(s['background'])
            bg.inputs[0].default_value = (r, g, b, 1.0)
            bg.inputs[1].default_value = 0.0 if s['transparent'] else 1.0

    root = new_empty('Zinarix (Y arriba)', None)
    root.rotation_euler = (math.pi / 2, 0, 0)

    for n in s['nodes']:
        if not n.get('visible', True):
            continue
        kind = n['kind']
        if kind == 'light':
            t = n['light']['type']
            if t == 'ambient':
                continue
            scale = 1.0 if t == 'directional' else 20.0
            data = bpy.data.lights.new(n['name'], 'SUN' if t == 'directional' else 'POINT')
            r, g, b = hex_rgb(n['light']['color'])
            data.color = (r, g, b)
            data.energy = float(n['light']['intensity']) * scale
            obj = bpy.data.objects.new(n['name'], data)
            scene.collection.objects.link(obj)
            obj.parent = root
            obj.location = n['position']
            if t == 'directional':
                # A sun shines along its -Z: aim it from its position to the origin.
                c = obj.constraints.new('TRACK_TO')
                c.target = root
                c.track_axis = 'TRACK_NEGATIVE_Z'
                c.up_axis = 'UP_Y'
            animate(obj, n.get('keys'), fps, data, scale)
            continue
        holder = new_empty(n['name'], root)
        holder.location = n['position']
        holder.rotation_euler = [math.radians(a) for a in n['rotation']]
        holder.scale = n['scale']
        if kind == 'mesh':
            o = add_shape(n)
            o.name = n['name'] + ' (forma)'
            o.parent = holder
            o.location = (0, 0, 0)
            o.data.materials.append(make_material(n['name'], n['material']))
        else:
            add_model(n, holder)
        animate(holder, n.get('keys'), fps)

    cam = s['camera']
    cdata = bpy.data.cameras.new('Camara')
    cdata.lens_unit = 'FOV'
    cdata.sensor_fit = 'VERTICAL'
    cdata.angle = math.radians(float(cam['fov']))
    cobj = bpy.data.objects.new('Camara', cdata)
    scene.collection.objects.link(cobj)
    cobj.parent = root
    cobj.location = cam['position']
    target = new_empty('Objetivo', root)
    target.location = cam['target']
    c = cobj.constraints.new('TRACK_TO')
    c.target = target
    c.track_axis = 'TRACK_NEGATIVE_Z'
    c.up_axis = 'UP_Y'
    ck = cam.get('keys') or {}
    animate(cobj, {k: v for k, v in ck.items() if k in ('px', 'py', 'pz')}, fps)
    animate(target, {('p' + k[1]): v for k, v in ck.items() if k in ('tx', 'ty', 'tz')}, fps)
    scene.camera = cobj

    os.makedirs(cfg['framesDir'], exist_ok=True)
    print('ZINARIX_FRAMES', frames, flush=True)
    bpy.ops.render.render(animation=True)
    print('ZINARIX_DONE', flush=True)
`;

/** Parses Blender's console: "Fra:12 …" lines give the progress. */
export function blenderProgress(line: string, frames: number): number | null {
  const m = /(?:^|\s)Fra:(\d+)/.exec(line);
  if (!m) return null;
  return Math.max(0, Math.min(1, (Number(m[1]) - 1) / Math.max(1, frames)));
}
