/**
 * Fase 14: 3D models from a description or a picture, generated on Replicate (already in the
 * provider catalog) and saved as a file the 3D editor opens. Pure: no Node, no fetch.
 *
 * Each Replicate model has its own input fields, so the request is built from the model's
 * OpenAPI input schema read at run time (genInput), never from field names assumed here.
 * Replicate shows no per-run price we could verify for these models, so the cost is unknown
 * and said so; it is never guessed.
 */

export type Gen3DInput = 'text' | 'image';

export interface Gen3DModel {
  /** Replicate "owner/name". */
  id: string;
  label: string;
  /** What it accepts. A model with only 'image' needs a picture. */
  inputs: readonly Gen3DInput[];
  note?: string;
  source: string;
  verifiedAt: string;
}

const CHECKED = '2026-11-15';
const COLLECTION = 'https://replicate.com/collections/3d-models';

/** From Replicate's "3D models" collection (checked on the date above). */
export const GEN3D_MODELS: readonly Gen3DModel[] = [
  {
    id: 'tencent/hunyuan-3d-3.1',
    label: 'Hunyuan3D 3.1',
    inputs: ['text', 'image'],
    note: 'Malla con textura.',
    source: 'https://replicate.com/tencent/hunyuan-3d-3.1',
    verifiedAt: CHECKED,
  },
  {
    id: 'hyper3d/rodin',
    label: 'Rodin Gen-2',
    inputs: ['text', 'image'],
    source: 'https://replicate.com/hyper3d/rodin',
    verifiedAt: CHECKED,
  },
  {
    id: 'firtoz/trellis',
    label: 'TRELLIS',
    inputs: ['image'],
    source: 'https://replicate.com/firtoz/trellis',
    verifiedAt: CHECKED,
  },
];
export const GEN3D_SOURCE = COLLECTION;
export const GEN3D_PROVIDER = 'replicate';

export const findGen3dModel = (id: string): Gen3DModel | undefined =>
  GEN3D_MODELS.find((m) => m.id === id);

export interface Gen3DRequest {
  model: string;
  prompt?: string;
  /** Absolute path of a PNG/JPEG/WebP picture of the object. */
  image?: string;
  seed?: number;
}

export const GEN3D_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
export const GEN3D_IMAGE_MAX = 10 * 1024 * 1024;
/** A generated model larger than this is refused (they are usually 5–60 MB). */
export const GEN3D_FILE_MAX = 300 * 1024 * 1024;
export const GEN3D_PROMPT_MAX = 1000;

const isAbs = (p: string) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p);
export const isGen3dImage = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.length < 4096 &&
  isAbs(p) &&
  !p.includes('\0') &&
  GEN3D_IMAGE_EXTS.some((e) => p.toLowerCase().endsWith(e));

/** What is wrong with a request, in words for the user, or null. */
export function gen3dIssue(r: Gen3DRequest): string | null {
  const m = findGen3dModel(r.model);
  if (!m) return `"${r.model}" no es un modelo 3D de Zinarix.`;
  const prompt = r.prompt?.trim() ?? '';
  if (prompt.length > GEN3D_PROMPT_MAX)
    return `La descripción pasa de ${GEN3D_PROMPT_MAX} caracteres.`;
  if (r.image !== undefined && !isGen3dImage(r.image))
    return 'La imagen tiene que ser un PNG, JPEG o WebP.';
  if (!m.inputs.includes('text') && !r.image) return `${m.label} necesita una imagen del objeto.`;
  if (!prompt && !r.image) return 'Escribe una descripción o elige una imagen.';
  return null;
}

export const imageMime = (p: string): string => {
  const l = p.toLowerCase();
  return l.endsWith('.png') ? 'image/png' : l.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
};

/** Schema of one input field, as Replicate's OpenAPI gives it. */
export interface InputField {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  allOf?: { $ref?: string }[];
  items?: { type?: string };
}
export type InputProps = Record<string, InputField | undefined>;

const PROMPT_FIELDS = ['prompt', 'text_prompt', 'text', 'caption'];
const IMAGE_FIELDS = [
  'image',
  'input_image',
  'image_path',
  'images',
  'input_images',
  'image_urls',
  'front_image',
];
/** Booleans that ask for the textured mesh file (off by default on some models). */
const WANT_FIELDS = ['generate_model', 'generate_texture', 'texture', 'textured_mesh', 'enable_pbr'];
/** Booleans that ask for side outputs we do not use (videos, gaussian splats). */
const SKIP_FIELDS = ['generate_color', 'generate_normal', 'save_gaussian_ply', 'return_no_background'];
const FORMAT_FIELDS = ['geometry_file_format', 'output_format', 'file_format', 'format', 'mesh_format'];
const SEED_FIELDS = ['seed'];

const pick = (props: InputProps, names: string[]) => names.find((n) => props[n] !== undefined);

/**
 * The prediction input for this model's schema. Without a schema (it could not be read), only
 * the two fields every one of these models takes: `prompt` and `image`.
 */
export function genInput(
  props: InputProps | undefined,
  r: { prompt?: string; imageDataUrl?: string; seed?: number },
): Record<string, unknown> {
  const p: InputProps = props ?? { prompt: {}, image: {} };
  const input: Record<string, unknown> = {};
  const prompt = r.prompt?.trim();
  const pf = pick(p, PROMPT_FIELDS);
  if (prompt && pf) input[pf] = prompt;
  const imf = pick(p, IMAGE_FIELDS);
  if (r.imageDataUrl && imf) input[imf] = p[imf]?.type === 'array' ? [r.imageDataUrl] : r.imageDataUrl;
  for (const f of WANT_FIELDS) if (p[f]?.type === 'boolean') input[f] = true;
  for (const f of SKIP_FIELDS) if (p[f]?.type === 'boolean') input[f] = false;
  const ff = pick(p, FORMAT_FIELDS);
  const allowed = ff ? p[ff]?.enum : undefined;
  if (ff && (!allowed || allowed.some((x) => String(x).toLowerCase() === 'glb')))
    input[ff] = allowed?.find((x) => String(x).toLowerCase() === 'glb') ?? 'glb';
  const sf = pick(p, SEED_FIELDS);
  if (sf && typeof r.seed === 'number' && Number.isFinite(r.seed)) input[sf] = Math.round(r.seed);
  return input;
}

/** Field names genInput fills in that the schema does not have (for the warning list). */
export function missingInputs(
  props: InputProps | undefined,
  r: { prompt?: string; imageDataUrl?: string },
): string[] {
  if (!props) return [];
  const out: string[] = [];
  if (r.prompt?.trim() && !pick(props, PROMPT_FIELDS)) out.push('descripción');
  if (r.imageDataUrl && !pick(props, IMAGE_FIELDS)) out.push('imagen');
  return out;
}

const MODEL_EXT = /\.(glb|gltf|obj|fbx)(?:$|[?#])/i;
const RANK: Record<string, number> = { glb: 0, gltf: 3, fbx: 1, obj: 2 };

/**
 * The 3D file of a prediction output, which can be a URL, a list, or an object with fields like
 * `model_file`, `mesh` or `glb`. GLB wins (one file, textures inside); OBJ/FBX next; .gltf
 * last (it usually needs side files).
 */
export function modelUrlOf(output: unknown): { url: string; ext: string } | null {
  const found: { url: string; ext: string }[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 5 || found.length > 50) return;
    if (typeof v === 'string') {
      if (!/^https:\/\//i.test(v)) return;
      const m = MODEL_EXT.exec(new URL(v).pathname);
      if (m) found.push({ url: v, ext: m[1]!.toLowerCase() });
      return;
    }
    if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1);
  };
  try {
    walk(output, 0);
  } catch {
    return null;
  }
  found.sort((a, b) => (RANK[a.ext] ?? 9) - (RANK[b.ext] ?? 9));
  return found[0] ?? null;
}

/** "taza-roja-20261115-1830.glb" */
export function gen3dFileName(prompt: string | undefined, ext: string, at: Date): string {
  const slug =
    (prompt ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'modelo-3d';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${slug}-${stamp}.${ext}`;
}

export type Gen3DEvent =
  | { type: 'progress'; stage: 'sending' | 'waiting' | 'downloading'; percent?: number }
  | { type: 'done'; path: string; warnings: string[]; ms: number }
  | { type: 'error'; message: string };

/** Replicate logs progress bars as "45%|████…"; the last one is the progress. */
export function logPercent(logs: unknown): number | undefined {
  if (typeof logs !== 'string') return undefined;
  const all = [...logs.slice(-4000).matchAll(/(\d{1,3})%\|/g)];
  const last = all.at(-1);
  if (!last) return undefined;
  const n = Number(last[1]);
  return n >= 0 && n <= 100 ? n : undefined;
}
