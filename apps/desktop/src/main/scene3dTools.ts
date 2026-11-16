import type { ToolDefinition } from '@omni/shared';
import {
  describeScene,
  formatFor,
  fromTemplate,
  sanitizeScene,
  SHAPES,
  TEMPLATES,
  type Render3DFormat,
  type Scene3D,
  type Shape,
  type TemplateId,
} from '../shared/scene3d.js';
import type { Scene3DService } from './scene3d.js';
import type { Gen3DService } from './gen3d.js';
import { EASES_3D } from '../shared/scene3d.js';
import { GEN3D_MODELS, findGen3dModel, gen3dIssue, type Gen3DRequest } from '../shared/gen3d.js';
import type { SystemPreview } from './system.js';
import { SCENE3D_OPS, describeOps } from '../shared/scene3dAgent.js';

/**
 * Fase 14: agent tools for 3D. render_3d builds a scene (a template or full scene JSON) and
 * renders it in the viewer or with Blender; blender_script runs a bpy script the user reads
 * first. Both are approved every time: a render takes minutes and the script is code.
 */
const IMAGE_ONLY = GEN3D_MODELS.filter((m) => !m.inputs.includes('text'))
  .map((m) => m.id)
  .join(', ');

export const SCENE3D_TOOLS: ToolDefinition[] = [
  {
    name: 'scene3d_state',
    description:
      'Read the scene open in the 3D editor: size, fps, duration, camera, and every node (id, name, kind, shape, position, rotation, scale, material, keyframes). Call it before scene3d_edit; ids change when nodes are added or deleted.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'scene3d_edit',
    description:
      'Edit the scene open in the 3D editor (the user sees it change; all ops are one Ctrl+Z step). Pass "ops", applied in order; if one fails nothing changes. Refer to nodes by id or exact name (a name given in "add" can be used by later ops of the same call). Ops: ' +
      '{op:"add", kind:"mesh"|"light"|"model", shape:' +
      SHAPES.join('|') +
      ', light:"ambient"|"directional"|"point", model:"<absolute .glb/.gltf/.obj/.fbx>", name, text, depth, position:[x,y,z], rotation:[deg,deg,deg], scale:[x,y,z], color:"#rrggbb", metalness, roughness, emissive, emissiveIntensity, opacity, intensity, visible}; ' +
      '{op:"set", id, ...same fields}; {op:"delete", id}; {op:"duplicate", id, ...fields for the copy}; ' +
      '{op:"key", id (node or "camera"), prop (node: px py pz rx ry rz sx sy sz intensity; camera: px py pz tx ty tz), t (seconds, default the playhead), v, ease} to animate: put at least two keys per property; ' +
      '{op:"clear_keys", id, prop?, t?}; {op:"camera", position, target, fov}; {op:"scene", width, height, fps, duration, background, transparent}; ' +
      '{op:"template", template:logo|turntable|orbit, text, color, shape, model, duration} replaces the whole scene. Y is up, units are metres; the ground is y=0 around the origin. ease: ' +
      EASES_3D.join(' | ') +
      '. To make a video of it afterwards, use scene3d_render.',
    parameters: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            properties: { op: { type: 'string', enum: [...SCENE3D_OPS] } },
            required: ['op'],
          },
        },
      },
      required: ['ops'],
    },
  },
  {
    name: 'scene3d_render',
    description:
      'Render the scene open in the 3D editor (as it is now) to a video in media/3d and add it to Video Studio. engine "viewer" (default) or "blender". The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name (no extension)' },
        engine: { type: 'string', enum: ['viewer', 'blender'] },
        quality: { type: 'string', enum: ['eevee', 'cycles'], description: 'Blender only' },
      },
    },
  },
  {
    name: 'render_3d',
    description:
      'Render a short 3D animation to a video file in media/3d and add it to Video Studio (library and timeline). Use a template (logo: 3D text turning once; turntable: an object turning; orbit: the camera circling it) or pass a full scene. Transparent backgrounds give a WebM with alpha that overlays other clips. engine "viewer" (default) uses the built-in viewer; "blender" uses Blender (EEVEE or Cycles) when installed. The user approves each render.',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: [...TEMPLATES] },
        text: { type: 'string', description: 'logo: the text (up to 60 characters)' },
        color: { type: 'string', description: 'Main colour, "#rrggbb"' },
        metal: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: '0 plastic … 1 polished metal',
        },
        shape: { type: 'string', enum: SHAPES.filter((s) => s !== 'text') },
        model: {
          type: 'string',
          description: 'Absolute path to a .glb/.gltf/.obj/.fbx to use instead of a shape',
        },
        duration: { type: 'number', minimum: 0.5, maximum: 60, description: 'Seconds' },
        transparent: { type: 'boolean', description: 'Transparent background (default true)' },
        width: { type: 'integer', minimum: 64, maximum: 3840 },
        height: { type: 'integer', minimum: 64, maximum: 2160 },
        fps: { type: 'integer', minimum: 12, maximum: 60 },
        scene: {
          type: 'object',
          description:
            'Full scene instead of a template: {width,height,fps,duration,transparent,background,camera:{position,target,fov,keys},nodes:[{kind:"mesh"|"model"|"light",shape,text,depth,model,light:{type,color,intensity},position,rotation(deg),scale,material:{color,metalness,roughness,emissive,emissiveIntensity,opacity},keys:{px|py|pz|rx|ry|rz|sx|sy|sz|intensity:[{t,v,ease}]}}]}. Y is up. ease (curve to the next key): ' +
            EASES_3D.join(' | ') +
            '.',
        },
        engine: { type: 'string', enum: ['viewer', 'blender'] },
        quality: { type: 'string', enum: ['eevee', 'cycles'], description: 'Blender only' },
        name: { type: 'string', description: 'File name (without extension)' },
      },
    },
  },
  {
    name: 'generate_3d_model',
    description:
      "Generate a 3D model (GLB) of an object from a description and/or a picture with a model on Replicate, and save it to media/3d. Use the returned path as render_3d's model (or in a scene). It sends the description and the picture to Replicate and is billed to the user's Replicate account (no published price: the cost is unknown); the user approves each call. Takes 1–5 minutes.",
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The object: shape, material, colours, style' },
        image: {
          type: 'string',
          description: 'Absolute path of a PNG/JPEG/WebP picture of the object (optional)',
        },
        model: {
          type: 'string',
          enum: GEN3D_MODELS.map((m) => m.id),
          description: `Default ${GEN3D_MODELS[0]!.id}. Image-only: ${IMAGE_ONLY}.`,
        },
        seed: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'blender_script',
    description:
      'Run a Blender Python (bpy) script without a window, for what render_3d cannot do (modelling, modifiers, physics, materials by nodes). The user reads the script and approves it. The script gets the folder ZINARIX_OUT in its environment: render PNG frames there as f_0001.png, f_0002.png… (they become a video) or save .png/.glb/.blend files there; they are copied to media/3d. Start from bpy.ops.wm.read_factory_settings(use_empty=True).',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'The Python code' },
        name: { type: 'string' },
        fps: { type: 'integer', minimum: 12, maximum: 60 },
        transparent: {
          type: 'boolean',
          description: 'Frames have alpha: encode a WebM with alpha',
        },
      },
      required: ['script'],
    },
  },
];

export const SCENE3D_TOOL_NAMES = new Set(SCENE3D_TOOLS.map((t) => t.name));

export const SCENE3D_PROMPT_PART =
  '- scene3d_state, scene3d_edit and scene3d_render: the scene open in the 3D editor. When the user asks to add, change, move, colour, light or animate something "in 3D" / "in the scene", read scene3d_state, then change it with scene3d_edit (one call with many ops is better than many calls), and render it with scene3d_render only if they want a video.\n- render_3d and blender_script: 3D animations (logos, products, titles) rendered to video in media/3d and added to Video Studio. Prefer render_3d with a template; write a full scene only when needed, and blender_script only when Blender is required (both need approval). generate_3d_model makes a GLB of an object (paid, on Replicate) that render_3d can then animate.';

/** The viewer lives in the renderer: main asks the window to render and waits. */
export interface Scene3DUi {
  /** scene3d_state / scene3d_edit / scene3d_render, answered by the window's 3D editor. */
  editor(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; content: string; summary: string }>;
  render(scene: Scene3D, name: string, format: Render3DFormat): Promise<{ path: string }>;
  /** A file to put into Video Studio (library + timeline). */
  imported(path: string): void;
}

const text = (a: Record<string, unknown>, k: string) =>
  typeof a[k] === 'string' ? (a[k] as string).trim() : '';
const num = (a: Record<string, unknown>, k: string) =>
  typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : undefined;

/** The scene a render_3d call stands for. */
export function sceneOf(a: Record<string, unknown>): Scene3D {
  if (a.scene && typeof a.scene === 'object') return sanitizeScene(a.scene);
  const id = (TEMPLATES as readonly string[]).includes(text(a, 'template'))
    ? (text(a, 'template') as TemplateId)
    : 'logo';
  const shape = text(a, 'shape');
  // The template builder clamps nothing about size: sanitize does (even, within 4K).
  return sanitizeScene(
    fromTemplate(id, {
      text: text(a, 'text') || undefined,
      color: text(a, 'color') || undefined,
      metal: num(a, 'metal'),
      duration: num(a, 'duration'),
      transparent: typeof a.transparent === 'boolean' ? a.transparent : undefined,
      shape: (SHAPES as readonly string[]).includes(shape) ? (shape as Shape) : undefined,
      model: text(a, 'model') || undefined,
      width: num(a, 'width'),
      height: num(a, 'height'),
      fps: num(a, 'fps'),
    }),
  );
}

/** The generation a generate_3d_model call stands for. */
export function gen3dRequestOf(a: Record<string, unknown>): Gen3DRequest {
  const model = findGen3dModel(text(a, 'model'))?.id ?? GEN3D_MODELS[0]!.id;
  const seed = num(a, 'seed');
  return {
    model,
    ...(text(a, 'prompt') ? { prompt: text(a, 'prompt') } : {}),
    ...(text(a, 'image') ? { image: text(a, 'image') } : {}),
    ...(seed !== undefined ? { seed: Math.max(0, Math.round(seed)) } : {}),
  };
}

/** null for scene3d_state (a read: no approval); the agent's gate takes null as "nothing to ask". */
export function scene3dPreview(name: 'scene3d_state', a: Record<string, unknown>): null;
export function scene3dPreview(name: string, a: Record<string, unknown>): SystemPreview;
export function scene3dPreview(name: string, a: Record<string, unknown>): SystemPreview | null {
  // Reading the open scene changes nothing.
  if (name === 'scene3d_state') return null;
  if (name === 'scene3d_edit')
    return {
      risk: 'medium',
      action: 'editar la escena 3D abierta',
      warning: `${describeOps(a.ops)}. Se deshace con Ctrl+Z en el editor 3D.`,
      // Undoable: may be allowed for the rest of the conversation.
      allowKey: 'scene3d_edit',
    };
  if (name === 'scene3d_render') {
    const blender = text(a, 'engine') === 'blender';
    return {
      risk: 'medium',
      action: `renderizar la escena 3D abierta ${blender ? `con Zinarix Pro (${text(a, 'quality') === 'cycles' ? 'realista' : 'calidad'})` : 'con Zinarix (rápido)'}`,
      warning: 'El video se guarda en media/3d y se agrega a Video Studio.',
    };
  }
  if (name === 'generate_3d_model') {
    const r = gen3dRequestOf(a);
    const m = findGen3dModel(r.model)!;
    const issue = gen3dIssue(r);
    return {
      risk: 'medium',
      action: `generar un modelo 3D con Replicate · ${m.label}`,
      warning:
        issue ??
        `Se envía${r.prompt ? ' la descripción' : ''}${r.prompt && r.image ? ' y' : ''}${r.image ? ' la imagen' : ''} a Replicate. Se cobra a tu cuenta de Replicate; no hay un precio publicado que se pueda verificar, así que el costo no se estima. El archivo se guarda en media/3d.`,
      command: [r.prompt, r.image].filter(Boolean).join('\n'),
    };
  }
  if (name === 'blender_script') {
    const script = text(a, 'script');
    return {
      risk: 'high',
      action: 'ejecutar un script de Python en el motor Pro (Blender)',
      warning:
        'El script corre con tus permisos y puede leer o cambiar archivos fuera del proyecto. Léelo antes de aprobar. No recibe tus claves ni tokens.',
      command: script.slice(0, 20_000),
    };
  }
  try {
    const s = sceneOf(a);
    const blender = text(a, 'engine') === 'blender';
    return {
      risk: 'medium',
      action: `renderizar una animación 3D ${blender ? `con Zinarix Pro (${text(a, 'quality') === 'cycles' ? 'realista' : 'calidad'})` : 'con Zinarix (rápido)'}`,
      warning: `${describeScene(s)}. El video se guarda en media/3d y se agrega a Video Studio.`,
    };
  } catch (e) {
    return { risk: 'medium', action: 'renderizar una animación 3D', warning: (e as Error).message };
  }
}

export async function runScene3dTool(
  svc: Scene3DService,
  ui: Scene3DUi | undefined,
  name: string,
  a: Record<string, unknown>,
  workspaceRoot: string | undefined,
  signal: AbortSignal,
  gen?: Gen3DService,
  callId = 'gen3d',
): Promise<{ ok: boolean; content: string; summary: string }> {
  try {
    if (name === 'scene3d_state' || name === 'scene3d_edit' || name === 'scene3d_render') {
      if (!ui)
        return { ok: false, content: 'The 3D editor is not available.', summary: 'sin editor' };
      return await ui.editor(name, a);
    }
    if (name === 'generate_3d_model') {
      if (!gen)
        return { ok: false, content: '3D generation is not available.', summary: 'no disponible' };
      const req = gen3dRequestOf(a);
      const r = await gen.generate(`agent:${callId}`, req, workspaceRoot, undefined, signal);
      return {
        ok: true,
        content: [
          `3D model saved in ${(r.ms / 1000).toFixed(0)} s: ${r.path}`,
          'Use it as render_3d "model" (or a scene node {kind:"model", model}).',
          ...r.warnings.map((w) => `Note: ${w}`),
        ].join('\n'),
        summary: r.path.split(/[\\/]/).pop() ?? r.path,
      };
    }
    if (name === 'blender_script') {
      const script = text(a, 'script');
      if (!script) return { ok: false, content: 'The script is empty.', summary: 'sin script' };
      const r = await svc.runScript(
        script,
        {
          fps: Math.round(num(a, 'fps') ?? 30),
          format: a.transparent === true ? 'webm' : 'mp4',
          name: text(a, 'name') || 'blender',
        },
        workspaceRoot,
        signal,
      );
      for (const p of r.paths) if (/\.(webm|mp4|png|jpg)$/i.test(p)) ui?.imported(p);
      return {
        ok: true,
        content: [
          r.paths.length
            ? `Files:\n${r.paths.map((p) => `- ${p}`).join('\n')}`
            : 'The script wrote no files to ZINARIX_OUT.',
          `Blender log (end):\n${r.log}`,
        ].join('\n\n'),
        summary: `${r.paths.length} archivo(s)`,
      };
    }
    const scene = sceneOf(a);
    const fileName = text(a, 'name') || (scene.nodes.find((n) => n.text)?.text ?? 'escena-3d');
    const format = formatFor(scene);
    let path: string;
    let how: string;
    if (text(a, 'engine') === 'blender') {
      const b = await svc.findBlender();
      if (!b)
        return {
          ok: false,
          content:
            'Blender 3.6 or newer is not installed. Use engine "viewer", or ask the user to install Blender.',
          summary: 'sin motor Pro',
        };
      const r = await svc.renderWithBlender(
        scene,
        { engine: text(a, 'quality') === 'cycles' ? 'cycles' : 'eevee', format, name: fileName },
        workspaceRoot,
        undefined,
        signal,
      );
      path = r.path;
      how = `Blender ${b.version}`;
      ui?.imported(path);
    } else {
      if (!ui)
        return { ok: false, content: 'The 3D viewer is not available.', summary: 'sin visor' };
      path = (await ui.render(scene, fileName, format)).path;
      how = 'the viewer';
    }
    return {
      ok: true,
      content: `Rendered with ${how}: ${path}\n${describeScene(scene)}\nIt was added to Video Studio (library and timeline).`,
      summary: path.split(/[\\/]/).pop() ?? path,
    };
  } catch (e) {
    return { ok: false, content: `3D render failed: ${(e as Error).message}`, summary: 'falló' };
  }
}
