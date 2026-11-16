/**
 * Zinarix Video Studio, phase 2: clip effects, titles, in/out animations and transitions.
 * Pure maths shared by the preview (canvas) and the export (FFmpeg), so both look the same:
 * the effects use the exact matrices of the CSS filter functions the canvas applies.
 * No runtime imports from video.ts (it imports the validators from here).
 */
import {
  customLook,
  customLookExpr,
  validTransitionDef,
  type TransitionDef,
} from './videoTransitions.js';

// ---------------- effects ----------------

export interface Effects {
  /** −1…1: CSS brightness(1 + b). */
  brightness?: number;
  /** −1…1: CSS contrast(1 + c). */
  contrast?: number;
  /** −1…1: CSS saturate(1 + s). */
  saturation?: number;
  /** Degrees, −180…180. */
  hue?: number;
  /** 0…1. */
  sepia?: number;
  /** 0…1. */
  grayscale?: number;
  /** Gaussian blur radius in pixels of a 1080-pixel-high frame (scaled to the real size). */
  blur?: number;
}
export type EffectKey = keyof Effects;
export const EFFECT_RANGE: Record<EffectKey, [number, number]> = {
  brightness: [-1, 1],
  contrast: [-1, 1],
  saturation: [-1, 1],
  hue: [-180, 180],
  sepia: [0, 1],
  grayscale: [0, 1],
  blur: [0, 40],
};
export const EFFECT_KEYS = Object.keys(EFFECT_RANGE) as EffectKey[];

/** Ready-made looks: one click on the Effects tab. */
export const LOOKS: { id: string; fx: Effects }[] = [
  { id: 'none', fx: {} },
  { id: 'bw', fx: { grayscale: 1 } },
  { id: 'noir', fx: { grayscale: 1, contrast: 0.4, brightness: -0.05 } },
  { id: 'sepia', fx: { sepia: 0.85 } },
  { id: 'vivid', fx: { saturation: 0.5, contrast: 0.15 } },
  { id: 'cinema', fx: { saturation: -0.25, contrast: 0.2, brightness: -0.05 } },
  { id: 'warm', fx: { sepia: 0.25, saturation: 0.15, brightness: 0.03 } },
  { id: 'faded', fx: { contrast: -0.2, brightness: 0.06, saturation: -0.3 } },
  { id: 'dream', fx: { blur: 2, brightness: 0.1, saturation: 0.2 } },
  { id: 'blur', fx: { blur: 12 } },
];

const clampTo = (v: unknown, [lo, hi]: [number, number]) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;
};

/** Effects with every value in range and the neutral ones dropped (undefined = no effects). */
export function cleanEffects(fx: Effects | undefined): Effects | undefined {
  if (!fx) return undefined;
  const out: Effects = {};
  for (const k of EFFECT_KEYS) {
    const v = clampTo(fx[k], EFFECT_RANGE[k]);
    if (Math.abs(v) > 1e-4) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The canvas filter string. `pxScale` = real frame height / 1080 (for the blur). */
export function cssFilter(fx: Effects | undefined, pxScale = 1): string {
  const e = cleanEffects(fx);
  if (!e) return 'none';
  const f: string[] = [];
  if (e.brightness) f.push(`brightness(${1 + e.brightness})`);
  if (e.contrast) f.push(`contrast(${1 + e.contrast})`);
  if (e.saturation) f.push(`saturate(${1 + e.saturation})`);
  if (e.hue) f.push(`hue-rotate(${e.hue}deg)`);
  if (e.sepia) f.push(`sepia(${e.sepia})`);
  if (e.grayscale) f.push(`grayscale(${e.grayscale})`);
  if (e.blur) f.push(`blur(${(e.blur * pxScale).toFixed(2)}px)`);
  return f.join(' ') || 'none';
}

type M3 = [number, number, number, number, number, number, number, number, number];
const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** a × b (apply b first, then a). */
function mul(a: M3, b: M3): M3 {
  const r = [0, 0, 0, 0, 0, 0, 0, 0, 0] as M3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return r;
}
// The matrices of the Filter Effects spec (what Chromium's canvas filter uses).
function saturateM(s: number): M3 {
  return [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s,
  ];
}
function hueM(deg: number): M3 {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [
    0.213 + c * 0.787 - s * 0.213,
    0.715 - c * 0.715 - s * 0.715,
    0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143,
    0.715 + c * 0.285 + s * 0.14,
    0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 + s * 0.715,
    0.072 + c * 0.928 + s * 0.072,
  ];
}
function sepiaM(a: number): M3 {
  const k = 1 - a;
  return [
    0.393 + 0.607 * k,
    0.769 - 0.769 * k,
    0.189 - 0.189 * k,
    0.349 - 0.349 * k,
    0.686 + 0.314 * k,
    0.168 - 0.168 * k,
    0.272 - 0.272 * k,
    0.534 - 0.534 * k,
    0.131 + 0.869 * k,
  ];
}
function grayM(a: number): M3 {
  const k = 1 - a;
  return [
    0.2126 + 0.7874 * k,
    0.7152 - 0.7152 * k,
    0.0722 - 0.0722 * k,
    0.2126 - 0.2126 * k,
    0.7152 + 0.2848 * k,
    0.0722 - 0.0722 * k,
    0.2126 - 0.2126 * k,
    0.7152 - 0.7152 * k,
    0.0722 + 0.9278 * k,
  ];
}

const n6 = (x: number) => (Math.round(x * 1e6) / 1e6).toString();

/**
 * FFmpeg filters for the effects, in the canvas order (brightness, contrast, then the colour
 * matrices, then blur). The input must be RGB(A). Numbers only.
 */
export function ffmpegEffects(fx: Effects | undefined, pxScale = 1): string[] {
  const e = cleanEffects(fx);
  if (!e) return [];
  const f: string[] = [];
  if (e.brightness) {
    const k = n6(1 + e.brightness);
    f.push(`colorchannelmixer=rr=${k}:gg=${k}:bb=${k}`);
  }
  if (e.contrast) {
    // CSS contrast: (v − ½)·c + ½ on each channel.
    const c = n6(1 + e.contrast);
    const x = `clip((val-127.5)*${c}+127.5,0,255)`;
    f.push(`lutrgb=r='${x}':g='${x}':b='${x}'`);
  }
  let m = I3;
  if (e.saturation) m = mul(saturateM(1 + e.saturation), m);
  if (e.hue) m = mul(hueM(e.hue), m);
  if (e.sepia) m = mul(sepiaM(e.sepia), m);
  if (e.grayscale) m = mul(grayM(e.grayscale), m);
  if (m !== I3) {
    const [rr, rg, rb, gr, gg, gb, br, bg, bb] = m.map(n6);
    f.push(
      `colorchannelmixer=rr=${rr}:rg=${rg}:rb=${rb}:gr=${gr}:gg=${gg}:gb=${gb}:br=${br}:bg=${bg}:bb=${bb}`,
    );
  }
  if (e.blur) f.push(`gblur=sigma=${n6(Math.max(0.01, e.blur * pxScale))}`);
  return f;
}

// ---------------- in / out animations ----------------

export type AnimKind =
  'none' | 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'pop' | 'zoom';
export const ANIM_KINDS: readonly AnimKind[] = [
  'none',
  'fade',
  'slideUp',
  'slideDown',
  'slideLeft',
  'slideRight',
  'pop',
  'zoom',
];
export interface ClipAnim {
  in?: AnimKind;
  /** Seconds. */
  inD?: number;
  out?: AnimKind;
  outD?: number;
}
export const ANIM_DEFAULT = 0.5;
export const ANIM_MAX = 5;

/** How an element looks while appearing: k = 0 (hidden) → 1 (in place). */
export interface Look {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  /** 0–1: share of the picture shown from the left (wipes). */
  reveal: number;
}
export const LOOK_NONE: Look = { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };

const smooth = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};

/** Slides move this share of the canvas. */
const SLIDE = 0.08;

export function animLook(kind: AnimKind | undefined, k: number): Look {
  const e = smooth(k);
  switch (kind) {
    case 'fade':
      return { ...LOOK_NONE, alpha: e };
    case 'slideUp':
      return { ...LOOK_NONE, alpha: e, dy: SLIDE * (1 - e) };
    case 'slideDown':
      return { ...LOOK_NONE, alpha: e, dy: -SLIDE * (1 - e) };
    case 'slideLeft':
      return { ...LOOK_NONE, alpha: e, dx: SLIDE * (1 - e) };
    case 'slideRight':
      return { ...LOOK_NONE, alpha: e, dx: -SLIDE * (1 - e) };
    case 'pop':
      return { ...LOOK_NONE, alpha: e, scale: 0.6 + 0.4 * e };
    case 'zoom':
      return { ...LOOK_NONE, alpha: e, scale: 1.4 - 0.4 * e };
    default:
      return LOOK_NONE;
  }
}

export function combine(a: Look, b: Look): Look {
  return {
    alpha: a.alpha * b.alpha,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    reveal: Math.min(a.reveal, b.reveal),
  };
}

/** In/out animation lengths kept inside a clip of length `len` (both at most its length). */
export function animLengths(a: ClipAnim | undefined, len: number): { inD: number; outD: number } {
  if (!a) return { inD: 0, outD: 0 };
  let inD = a.in && a.in !== 'none' ? clampTo(a.inD ?? ANIM_DEFAULT, [0, ANIM_MAX]) : 0;
  let outD = a.out && a.out !== 'none' ? clampTo(a.outD ?? ANIM_DEFAULT, [0, ANIM_MAX]) : 0;
  if (inD + outD > len) {
    const k = len / (inD + outD);
    inD *= k;
    outD *= k;
  }
  return { inD, outD };
}

/** The animation's look at `into` seconds into a clip of length `len`. */
export function animAt(a: ClipAnim | undefined, into: number, len: number): Look {
  const { inD, outD } = animLengths(a, len);
  let l = LOOK_NONE;
  if (inD > 1e-6 && into < inD) l = combine(l, animLook(a!.in, into / inD));
  if (outD > 1e-6 && len - into < outD) l = combine(l, animLook(a!.out, (len - into) / outD));
  return l;
}

/** FFmpeg expressions of a look over k (an expression already clipped to 0…1). */
export interface LookExpr {
  alpha?: string;
  dx?: string;
  dy?: string;
  scale?: string;
  reveal?: string;
}
function lookExpr(
  kind: AnimKind | TransitionName | undefined,
  k: string,
  def?: TransitionDef,
): LookExpr {
  if (kind === 'custom') return def ? customLookExpr(def, k) : {};
  const e = `(${k}*${k}*(3-2*${k}))`;
  switch (kind) {
    case 'fade':
    case 'dissolve':
      return { alpha: e };
    case 'slideUp':
      return { alpha: e, dy: `${SLIDE}*(1-${e})` };
    case 'slideDown':
      return { alpha: e, dy: `-${SLIDE}*(1-${e})` };
    case 'slideLeft':
      return { alpha: e, dx: `${SLIDE}*(1-${e})` };
    case 'slideRight':
      return { alpha: e, dx: `-${SLIDE}*(1-${e})` };
    case 'pop':
      return { alpha: e, scale: `(0.6+0.4*${e})` };
    case 'zoom':
      return { alpha: e, scale: `(1.4-0.4*${e})` };
    case 'wipe':
      return { reveal: k };
    case 'slide':
      return { dx: `(1-${e})` };
    case 'zoomIn':
      return { alpha: e, scale: `(1.25-0.25*${e})` };
    default:
      return {};
  }
}

/**
 * The window [from, from + d] (seconds on some time axis T) where kind plays, appearing
 * (`appear`) or disappearing: FFmpeg expressions for the look, numbers only.
 */
export function windowExpr(
  kind: AnimKind | TransitionName | undefined,
  T: string,
  from: number,
  d: number,
  appear: boolean,
  def?: TransitionDef,
): LookExpr {
  if (!kind || kind === 'none' || !(d > 1e-6)) return {};
  const k = appear
    ? `clip((${T}-(${n6(from)}))/${n6(d)},0,1)`
    : `clip(((${n6(from + d)})-${T})/${n6(d)},0,1)`;
  return lookExpr(kind, k, def);
}

/** Several looks at once: alphas and scales multiply, offsets add. */
export function combineExpr(list: LookExpr[]): LookExpr {
  const out: LookExpr = {};
  const join = (key: keyof LookExpr, op: string) => {
    const parts = list.map((l) => l[key]).filter((x): x is string => !!x);
    if (parts.length) out[key] = parts.length === 1 ? parts[0] : `(${parts.join(op)})`;
  };
  join('alpha', '*');
  join('dx', '+');
  join('dy', '+');
  join('scale', '*');
  const reveals = list.map((l) => l.reveal).filter((x): x is string => !!x);
  if (reveals.length) out.reveal = reveals.reduce((a, b) => `min(${a},${b})`);
  return out;
}

// ---------------- transitions ----------------

export type TransitionKind = 'dissolve' | 'wipe' | 'slide' | 'zoomIn';
export const TRANSITION_KINDS: readonly TransitionKind[] = ['dissolve', 'wipe', 'slide', 'zoomIn'];
/** A built-in kind, or 'custom': a data-only transition (videoTransitions.ts) kept in `def`. */
export type TransitionName = TransitionKind | 'custom';
export interface Transition {
  kind: TransitionName;
  /** Seconds. */
  d: number;
  /** The definition of a 'custom' transition, kept in the clip so the project is self-contained. */
  def?: TransitionDef;
}
export const TRANSITION_DEFAULT = 0.6;
export const TRANSITION_MIN = 0.1;
export const TRANSITION_MAX = 4;

/** How the incoming clip looks at k (0 = not yet there, 1 = fully in). */
export function transitionLook(kind: TransitionName, k: number, def?: TransitionDef): Look {
  const e = smooth(k);
  switch (kind) {
    case 'custom':
      return def ? customLook(def, k) : LOOK_NONE;
    case 'dissolve':
      return { ...LOOK_NONE, alpha: e };
    case 'wipe':
      return { ...LOOK_NONE, reveal: Math.min(1, Math.max(0, k)) };
    case 'slide':
      return { ...LOOK_NONE, dx: 1 - e };
    case 'zoomIn':
      return { ...LOOK_NONE, alpha: e, scale: 1.25 - 0.25 * e };
  }
}

// ---------------- titles ----------------

export type TextFont = 'sans' | 'serif' | 'mono' | 'display' | 'hand';
export const TEXT_FONTS: readonly TextFont[] = ['sans', 'serif', 'mono', 'display', 'hand'];
export type TextAlign = 'left' | 'center' | 'right';

export interface TextSpec {
  content: string;
  font: TextFont;
  /** Letter height as a share of the canvas height. */
  size: number;
  /** #rrggbb. */
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** Outline (width as a share of the letter size). */
  stroke?: { color: string; width: number };
  shadow?: boolean;
  /** Box behind the text. */
  bg?: string;
}
export const TEXT_MAX = 2000;
export const TEXT_DEFAULT_DUR = 4;

export const TEXT_PRESETS: { id: string; spec: TextSpec; y: number; anim: ClipAnim }[] = [
  {
    id: 'title',
    spec: {
      content: 'Título',
      font: 'display',
      size: 0.12,
      color: '#ffffff',
      bold: true,
      italic: false,
      align: 'center',
      shadow: true,
    },
    y: 0,
    anim: { in: 'pop', out: 'fade' },
  },
  {
    id: 'subtitle',
    spec: {
      content: 'Subtítulo',
      font: 'sans',
      size: 0.06,
      color: '#ffffff',
      bold: false,
      italic: false,
      align: 'center',
      shadow: true,
    },
    y: 0.1,
    anim: { in: 'fade', out: 'fade' },
  },
  {
    id: 'lower',
    spec: {
      content: 'Nombre Apellido\nCargo',
      font: 'sans',
      size: 0.045,
      color: '#ffffff',
      bold: true,
      italic: false,
      align: 'left',
      bg: '#1f6feb',
    },
    y: 0.32,
    anim: { in: 'slideRight', out: 'slideLeft' },
  },
  {
    id: 'caption',
    spec: {
      content: 'Texto en pantalla',
      font: 'sans',
      size: 0.05,
      color: '#ffffff',
      bold: true,
      italic: false,
      align: 'center',
      stroke: { color: '#000000', width: 0.12 },
    },
    y: 0.36,
    anim: { in: 'none', out: 'none' },
  },
  {
    id: 'cta',
    spec: {
      content: '¡Suscríbete!',
      font: 'display',
      size: 0.08,
      color: '#ffffff',
      bold: true,
      italic: false,
      align: 'center',
      bg: '#e5484d',
    },
    y: 0.3,
    anim: { in: 'zoom', out: 'fade' },
  },
  {
    id: 'quote',
    spec: {
      content: '“Una frase memorable”',
      font: 'serif',
      size: 0.07,
      color: '#f5f5f5',
      bold: false,
      italic: true,
      align: 'center',
      shadow: true,
    },
    y: 0,
    anim: { in: 'slideUp', out: 'fade' },
  },
];

// ---------------- stickers (emojis, shapes, arrows) ----------------

/**
 * Stickers are titles whose text is one emoji or symbol: they reuse the text clip, so the
 * preview and the export draw them the same way and the inspector can change them later.
 */
export type StickerGroup = 'emoji' | 'shapes' | 'arrows';
export const STICKER_GROUPS: { id: StickerGroup; items: string[] }[] = [
  {
    id: 'emoji',
    items: [
      '😀',
      '😂',
      '😍',
      '😎',
      '🤩',
      '😮',
      '😢',
      '😡',
      '🤔',
      '🥳',
      '👍',
      '👎',
      '👏',
      '🙌',
      '🙏',
      '💪',
      '👀',
      '❤️',
      '🔥',
      '✨',
      '⭐',
      '🎉',
      '💯',
      '✅',
      '❌',
      '⚠️',
      '💡',
      '📌',
      '🎬',
      '🎵',
      '📷',
      '🚀',
      '💰',
      '🏆',
      '⏰',
      '📢',
    ],
  },
  { id: 'shapes', items: ['●', '■', '▲', '◆', '★', '♥', '○', '□', '△', '◇', '☆', '♡'] },
  { id: 'arrows', items: ['→', '←', '↑', '↓', '↗', '↘', '↙', '↖', '➜', '⇨', '↻', '⤴'] },
];
export const STICKER_COLORS = ['#ffffff', '#ffd400', '#ff3b30', '#34c759', '#0a84ff', '#000000'];

/** Text spec of a sticker. Emojis keep their own colours; shapes and arrows use `color`. */
export function stickerSpec(item: string, group: StickerGroup, color = '#ffffff'): TextSpec {
  const emoji = group === 'emoji';
  return {
    content: item.slice(0, 16),
    font: 'sans',
    size: emoji ? 0.2 : 0.18,
    color: HEX.test(color) ? color : '#ffffff',
    bold: !emoji,
    italic: false,
    align: 'center',
    shadow: true,
  };
}
export const STICKER_ANIM: ClipAnim = { in: 'pop', out: 'fade' };

// ---------------- validation (project files) ----------------

const HEX = /^#[0-9a-f]{6}$/i;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validEffects(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  return Object.entries(x).every(
    ([k, v]) => (EFFECT_KEYS as string[]).includes(k) && (v === undefined || finite(v)),
  );
}

export function validAnim(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object') return false;
  const a = x as ClipAnim;
  return (
    (a.in === undefined || ANIM_KINDS.includes(a.in)) &&
    (a.out === undefined || ANIM_KINDS.includes(a.out)) &&
    (a.inD === undefined || finite(a.inD)) &&
    (a.outD === undefined || finite(a.outD))
  );
}

export function validTransition(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object') return false;
  const t = x as Transition;
  if (!finite(t.d) || !(t.d > 0)) return false;
  if (t.kind === 'custom') return validTransitionDef(t.def);
  return TRANSITION_KINDS.includes(t.kind) && t.def === undefined;
}

export function validText(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object') return false;
  const t = x as TextSpec;
  return (
    typeof t.content === 'string' &&
    t.content.length <= TEXT_MAX &&
    TEXT_FONTS.includes(t.font) &&
    finite(t.size) &&
    t.size > 0 &&
    t.size <= 1 &&
    typeof t.color === 'string' &&
    HEX.test(t.color) &&
    typeof t.bold === 'boolean' &&
    typeof t.italic === 'boolean' &&
    ['left', 'center', 'right'].includes(t.align) &&
    (t.stroke === undefined ||
      (!!t.stroke && HEX.test(t.stroke.color) && finite(t.stroke.width))) &&
    (t.shadow === undefined || typeof t.shadow === 'boolean') &&
    (t.bg === undefined || (typeof t.bg === 'string' && HEX.test(t.bg)))
  );
}

export const isHex = (s: string): boolean => HEX.test(s);
