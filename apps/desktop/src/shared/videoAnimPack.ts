/**
 * The animation pack: about a hundred extra transitions and in / out animations, written as
 * curves of keys ([t, v, t, v…]) on the same channels as the custom transitions (alpha, dx,
 * dy, scale, reveal). videoFx.ts turns each one into a preset, so the preview and the FFmpeg
 * export compute them with the same formula, and every one ends with the clip in place.
 *
 * Pure data: no DOM, no FFmpeg. Names in Spanish and English.
 */
import type { TransitionChannel } from './videoTransitions.js';

export type PackGroup =
  'slide' | 'bounce' | 'zoom' | 'spin' | 'shake' | 'light' | 'reveal' | 'camera';
export const PACK_GROUPS: readonly PackGroup[] = [
  'slide',
  'bounce',
  'zoom',
  'spin',
  'shake',
  'light',
  'reveal',
  'camera',
];

export interface PackEntry {
  es: string;
  en: string;
  group: PackGroup;
  ease: 'smooth' | 'linear';
  ch: Partial<Record<TransitionChannel, readonly number[]>>;
}

// ---------------- directional families: 8 styles × 8 directions ----------------

const D = 0.75; // diagonals move this much on each axis
const DIRS = {
  Left: { v: [-1, 0], es: 'desde la izquierda', en: 'from the left' },
  Right: { v: [1, 0], es: 'desde la derecha', en: 'from the right' },
  Top: { v: [0, -1], es: 'desde arriba', en: 'from above' },
  Bottom: { v: [0, 1], es: 'desde abajo', en: 'from below' },
  TopLeft: { v: [-D, -D], es: 'desde arriba a la izquierda', en: 'from the top left' },
  TopRight: { v: [D, -D], es: 'desde arriba a la derecha', en: 'from the top right' },
  BottomLeft: { v: [-D, D], es: 'desde abajo a la izquierda', en: 'from the bottom left' },
  BottomRight: { v: [D, D], es: 'desde abajo a la derecha', en: 'from the bottom right' },
} as const;
type Dir = keyof typeof DIRS;

interface Style {
  es: string;
  en: string;
  group: PackGroup;
  ease: 'smooth' | 'linear';
  /** Offset along the direction, as [t, v…] (1 = a whole frame away). */
  off: readonly number[];
  extra?: Partial<Record<TransitionChannel, readonly number[]>>;
}

const STYLES = {
  glide: {
    es: 'Deslizar suave',
    en: 'Soft glide',
    group: 'slide',
    ease: 'smooth',
    off: [0, 0.3, 1, 0],
    extra: { alpha: [0, 0, 0.6, 1] },
  },
  overshoot: {
    es: 'Entrar con impulso',
    en: 'Overshoot',
    group: 'slide',
    ease: 'smooth',
    off: [0, 1, 0.6, -0.06, 0.82, 0.015, 1, 0],
  },
  dash: {
    es: 'Ráfaga',
    en: 'Dash',
    group: 'slide',
    ease: 'smooth',
    off: [0, 1, 0.25, 0.05, 0.5, -0.025, 1, 0],
    extra: { alpha: [0, 0.3, 0.2, 1] },
  },
  hop: {
    es: 'Rebotar',
    en: 'Bounce in',
    group: 'bounce',
    ease: 'linear',
    off: [0, 1, 0.4, 0, 0.55, 0.12, 0.7, 0, 0.82, 0.035, 0.92, 0, 1, 0],
  },
  spring: {
    es: 'Resorte',
    en: 'Spring',
    group: 'bounce',
    ease: 'smooth',
    off: [0, 1, 0.3, -0.25, 0.45, 0.12, 0.6, -0.06, 0.75, 0.025, 1, 0],
  },
  zoomSlide: {
    es: 'Acercar deslizando',
    en: 'Zoom glide',
    group: 'zoom',
    ease: 'smooth',
    off: [0, 0.5, 1, 0],
    extra: { scale: [0, 0.5, 1, 1], alpha: [0, 0, 0.4, 1] },
  },
  landing: {
    es: 'Aterrizar',
    en: 'Land',
    group: 'zoom',
    ease: 'smooth',
    off: [0, 0.25, 1, 0],
    extra: { scale: [0, 1.6, 0.75, 0.97, 1, 1], alpha: [0, 0, 0.5, 1] },
  },
  ghostSlide: {
    es: 'Estela',
    en: 'Trail',
    group: 'light',
    ease: 'smooth',
    off: [0, 0.6, 0.5, 0.15, 1, 0],
    extra: { alpha: [0, 0, 0.2, 0.6, 0.35, 0.3, 0.55, 0.8, 0.7, 0.6, 1, 1] },
  },
} as const satisfies Record<string, Style>;
type StyleId = keyof typeof STYLES;

export type DirKind = `${StyleId}From${Dir}`;

function directional(): Record<DirKind, PackEntry> {
  const out = {} as Record<DirKind, PackEntry>;
  for (const [sid, s] of Object.entries(STYLES) as [StyleId, Style][]) {
    for (const [did, d] of Object.entries(DIRS) as [Dir, (typeof DIRS)[Dir]][]) {
      const [ux, uy] = d.v;
      const along = (u: number) => s.off.map((x, i) => (i % 2 ? x * u : x));
      const ch: PackEntry['ch'] = { ...s.extra };
      if (ux) ch.dx = along(ux);
      if (uy) ch.dy = along(uy);
      out[`${sid}From${did}`] = {
        es: `${s.es} ${d.es}`,
        en: `${s.en} ${d.en}`,
        group: s.group,
        ease: s.ease,
        ch,
      };
    }
  }
  return out;
}

// ---------------- curves made with a little maths ----------------

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** dx / dy keys along a spiral that ends in the centre: `turns` turns from radius r0. */
function spiral(turns: number, r0: number, sign: 1 | -1, n = 11) {
  const dx: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = r0 * (1 - t);
    const a = sign * turns * 2 * Math.PI * t;
    dx.push(r3(t), r3(r * Math.cos(a)));
    dy.push(r3(t), r3(r * Math.sin(a)));
  }
  return { dx, dy };
}

/** A circle of radius r that shrinks to the centre in the last stretch. */
function orbit(r: number, n = 11) {
  const dx: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rr = t < 0.6 ? r : r * (1 - (t - 0.6) / 0.4);
    const a = 2 * Math.PI * t;
    dx.push(r3(t), r3(rr * Math.sin(a)));
    dy.push(r3(t), r3(-rr * Math.cos(a)));
  }
  return { dx, dy };
}

/** A figure of eight that fades in to the centre. */
function eight(r: number, n = 11) {
  const dx: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rr = r * (1 - t);
    const a = 2 * Math.PI * t;
    dx.push(r3(t), r3(rr * Math.sin(a)));
    dy.push(r3(t), r3(rr * Math.sin(2 * a) * 0.5));
  }
  return { dx, dy };
}

// ---------------- one-of-a-kind animations ----------------

const SINGLES = {
  // zoom
  pulseIn: {
    es: 'Pulso',
    en: 'Pulse',
    group: 'zoom',
    ease: 'smooth',
    ch: { scale: [0, 0.6, 0.5, 1.12, 0.75, 0.96, 1, 1], alpha: [0, 0, 0.3, 1] },
  },
  heartbeat: {
    es: 'Latido',
    en: 'Heartbeat',
    group: 'zoom',
    ease: 'smooth',
    ch: {
      scale: [0, 0.8, 0.25, 1.15, 0.4, 0.95, 0.6, 1.1, 0.8, 0.98, 1, 1],
      alpha: [0, 0, 0.2, 1],
    },
  },
  dollyIn: {
    es: 'Travelling hacia adentro',
    en: 'Dolly in',
    group: 'camera',
    ease: 'smooth',
    ch: { scale: [0, 0.85, 1, 1], alpha: [0, 0, 0.7, 1] },
  },
  dollyOut: {
    es: 'Travelling hacia afuera',
    en: 'Dolly out',
    group: 'camera',
    ease: 'smooth',
    ch: { scale: [0, 1.2, 1, 1], alpha: [0, 0, 0.7, 1] },
  },
  crashZoom: {
    es: 'Zoom choque',
    en: 'Crash zoom',
    group: 'zoom',
    ease: 'smooth',
    ch: { scale: [0, 3, 0.35, 1.05, 0.6, 0.99, 1, 1], alpha: [0, 0, 0.15, 1] },
  },
  springZoom: {
    es: 'Zoom resorte',
    en: 'Spring zoom',
    group: 'bounce',
    ease: 'smooth',
    ch: { scale: [0, 0.3, 0.4, 1.25, 0.6, 0.88, 0.78, 1.06, 1, 1], alpha: [0, 0, 0.25, 1] },
  },
  jelly: {
    es: 'Gelatina',
    en: 'Jelly',
    group: 'bounce',
    ease: 'smooth',
    ch: {
      scale: [0, 0.5, 0.3, 1.2, 0.45, 0.85, 0.6, 1.1, 0.75, 0.95, 0.9, 1.02, 1, 1],
      alpha: [0, 0, 0.2, 1],
    },
  },
  breathe: {
    es: 'Respirar',
    en: 'Breathe',
    group: 'zoom',
    ease: 'smooth',
    ch: { scale: [0, 0.9, 0.35, 1.05, 0.7, 0.97, 1, 1], alpha: [0, 0, 0.5, 1] },
  },
  tinyPop: {
    es: 'Mini rebote',
    en: 'Tiny pop',
    group: 'bounce',
    ease: 'smooth',
    ch: { scale: [0, 0.85, 0.6, 1.04, 1, 1], alpha: [0, 0, 0.4, 1] },
  },
  balloon: {
    es: 'Globo',
    en: 'Balloon',
    group: 'zoom',
    ease: 'smooth',
    ch: { scale: [0, 0.1, 0.7, 1.15, 1, 1], alpha: [0, 0, 0.2, 1], dy: [0, 0.1, 0.7, -0.02, 1, 0] },
  },
  shrinkIn: {
    es: 'Desde gigante',
    en: 'From giant',
    group: 'zoom',
    ease: 'smooth',
    ch: { scale: [0, 2.2, 0.7, 0.95, 1, 1], alpha: [0, 0, 0.6, 1] },
  },
  slam: {
    es: 'Azotón',
    en: 'Slam',
    group: 'shake',
    ease: 'linear',
    ch: {
      scale: [0, 2.5, 0.3, 1, 0.4, 0.97, 0.55, 1, 1, 1],
      dy: [0, 0, 0.3, 0, 0.36, 0.03, 0.42, -0.02, 0.5, 0.01, 0.6, 0, 1, 0],
      alpha: [0, 0, 0.12, 1],
    },
  },
  tada: {
    es: '¡Tadá!',
    en: 'Ta-da!',
    group: 'bounce',
    ease: 'smooth',
    ch: {
      scale: [0, 0.8, 0.2, 0.9, 0.4, 1.1, 0.6, 1.08, 0.8, 1.03, 1, 1],
      dx: [0, 0, 0.3, -0.02, 0.45, 0.02, 0.6, -0.015, 0.75, 0.01, 1, 0],
      alpha: [0, 0, 0.15, 1],
    },
  },
  rubberBand: {
    es: 'Liga',
    en: 'Rubber band',
    group: 'bounce',
    ease: 'smooth',
    ch: {
      scale: [0, 1.25, 0.3, 0.8, 0.45, 1.15, 0.6, 0.95, 0.75, 1.05, 1, 1],
      alpha: [0, 0, 0.2, 1],
    },
  },
  dropZoom: {
    es: 'Caída con zoom',
    en: 'Drop zoom',
    group: 'zoom',
    ease: 'smooth',
    ch: {
      dy: [0, -0.5, 0.5, 0, 1, 0],
      scale: [0, 0.5, 0.5, 0.6, 0.8, 1.08, 1, 1],
      alpha: [0, 0, 0.3, 1],
    },
  },
  // spin-like paths
  spiralIn: {
    es: 'Espiral',
    en: 'Spiral',
    group: 'spin',
    ease: 'smooth',
    ch: { ...spiral(1.5, 0.6, 1), scale: [0, 0.3, 1, 1], alpha: [0, 0, 0.3, 1] },
  },
  spiralBack: {
    es: 'Espiral inversa',
    en: 'Reverse spiral',
    group: 'spin',
    ease: 'smooth',
    ch: { ...spiral(1.5, 0.6, -1), scale: [0, 0.3, 1, 1], alpha: [0, 0, 0.3, 1] },
  },
  whirl: {
    es: 'Remolino',
    en: 'Whirl',
    group: 'spin',
    ease: 'smooth',
    ch: { ...spiral(2, 0.4, 1), scale: [0, 2, 1, 1], alpha: [0, 0, 0.3, 1] },
  },
  tornado: {
    es: 'Tornado',
    en: 'Tornado',
    group: 'spin',
    ease: 'linear',
    ch: { ...spiral(2.5, 0.5, -1), scale: [0, 0.15, 0.7, 0.9, 1, 1], alpha: [0, 0, 0.25, 1] },
  },
  orbit: {
    es: 'Órbita',
    en: 'Orbit',
    group: 'spin',
    ease: 'smooth',
    ch: { ...orbit(0.3), scale: [0, 0.6, 0.6, 0.8, 1, 1], alpha: [0, 0, 0.2, 1] },
  },
  figureEight: {
    es: 'Ocho',
    en: 'Figure eight',
    group: 'spin',
    ease: 'smooth',
    ch: { ...eight(0.45), alpha: [0, 0, 0.3, 1] },
  },
  pendulum: {
    es: 'Péndulo',
    en: 'Pendulum',
    group: 'spin',
    ease: 'smooth',
    ch: {
      dx: [0, 0.4, 0.25, -0.3, 0.45, 0.2, 0.65, -0.12, 0.82, 0.05, 1, 0],
      dy: [0, -0.06, 0.12, 0, 0.25, -0.05, 0.35, 0, 0.45, -0.03, 1, 0],
      alpha: [0, 0, 0.2, 1],
    },
  },
  swing: {
    es: 'Columpio',
    en: 'Swing',
    group: 'spin',
    ease: 'smooth',
    ch: {
      dx: [0, -0.5, 0.35, 0.25, 0.6, -0.1, 0.8, 0.03, 1, 0],
      dy: [0, -0.2, 0.18, 0.04, 0.35, -0.1, 0.48, 0.02, 0.6, -0.03, 1, 0],
      alpha: [0, 0, 0.25, 1],
    },
  },
  // paths
  zigzagIn: {
    es: 'Zigzag',
    en: 'Zigzag',
    group: 'slide',
    ease: 'linear',
    ch: {
      dx: [0, -0.3, 0.2, 0.3, 0.4, -0.2, 0.6, 0.15, 0.8, -0.05, 1, 0],
      dy: [0, -0.6, 1, 0],
      alpha: [0, 0, 0.2, 1],
    },
  },
  waveIn: {
    es: 'Ola',
    en: 'Wave',
    group: 'slide',
    ease: 'smooth',
    ch: {
      dx: [0, 1, 1, 0],
      dy: [0, 0, 0.2, -0.12, 0.4, 0.1, 0.6, -0.07, 0.8, 0.03, 1, 0],
    },
  },
  stairs: {
    es: 'Escalera',
    en: 'Stairs',
    group: 'slide',
    ease: 'smooth',
    ch: {
      dx: [0, 0.6, 0.2, 0.45, 0.4, 0.3, 0.6, 0.15, 0.8, 0, 1, 0],
      dy: [0, 0.6, 0.1, 0.45, 0.3, 0.45, 0.4, 0.3, 0.6, 0.3, 0.7, 0.15, 0.9, 0.15, 1, 0],
      alpha: [0, 0, 0.15, 1],
    },
  },
  rocket: {
    es: 'Cohete',
    en: 'Rocket',
    group: 'slide',
    ease: 'smooth',
    ch: { dy: [0, 1, 0.5, -0.05, 1, 0], scale: [0, 0.6, 0.5, 1.05, 1, 1] },
  },
  sink: {
    es: 'Hundirse',
    en: 'Sink in',
    group: 'slide',
    ease: 'smooth',
    ch: { dy: [0, -0.6, 0.7, 0.02, 1, 0], scale: [0, 1.1, 1, 1], alpha: [0, 0, 0.4, 1] },
  },
  floatUp: {
    es: 'Flotar',
    en: 'Float up',
    group: 'slide',
    ease: 'smooth',
    ch: { dy: [0, 0.12, 1, 0], alpha: [0, 0, 0.8, 1] },
  },
  leaf: {
    es: 'Hoja que cae',
    en: 'Falling leaf',
    group: 'spin',
    ease: 'smooth',
    ch: {
      dy: [0, -0.6, 1, 0],
      dx: [0, 0.2, 0.25, -0.15, 0.5, 0.1, 0.75, -0.05, 1, 0],
      alpha: [0, 0, 0.3, 1],
    },
  },
  parachute: {
    es: 'Paracaídas',
    en: 'Parachute',
    group: 'slide',
    ease: 'smooth',
    ch: {
      dy: [0, -0.8, 0.6, -0.05, 1, 0],
      dx: [0, 0.05, 0.3, -0.04, 0.6, 0.03, 0.85, -0.01, 1, 0],
    },
  },
  pinball: {
    es: 'Pinball',
    en: 'Pinball',
    group: 'bounce',
    ease: 'linear',
    ch: {
      dx: [0, -0.8, 0.25, 0.4, 0.5, -0.2, 0.75, 0.08, 1, 0],
      dy: [0, 0.5, 0.25, -0.35, 0.5, 0.2, 0.75, -0.06, 1, 0],
    },
  },
  boomerang: {
    es: 'Bumerán',
    en: 'Boomerang',
    group: 'slide',
    ease: 'smooth',
    ch: { dx: [0, -1, 0.4, 0.3, 0.7, -0.05, 1, 0], scale: [0, 0.6, 0.4, 0.85, 1, 1] },
  },
  slingshot: {
    es: 'Resortera',
    en: 'Slingshot',
    group: 'bounce',
    ease: 'smooth',
    ch: {
      dx: [0, 0, 0.25, 0.15, 0.55, -0.08, 0.8, 0.02, 1, 0],
      scale: [0, 0.7, 0.25, 0.85, 0.55, 1.05, 1, 1],
      alpha: [0, 0, 0.2, 1],
    },
  },
  skate: {
    es: 'Patinar',
    en: 'Skate',
    group: 'slide',
    ease: 'smooth',
    ch: { dx: [0, 1, 0.7, -0.03, 1, 0], dy: [0, 0, 0.35, -0.05, 0.7, 0, 1, 0] },
  },
  // shake and glitch
  shake: {
    es: 'Sacudida',
    en: 'Shake',
    group: 'shake',
    ease: 'linear',
    ch: {
      dx: [0, 0.06, 0.1, -0.05, 0.2, 0.04, 0.3, -0.03, 0.45, 0.02, 0.6, -0.01, 1, 0],
      alpha: [0, 0, 0.1, 1],
    },
  },
  tremor: {
    es: 'Temblor vertical',
    en: 'Vertical tremor',
    group: 'shake',
    ease: 'linear',
    ch: {
      dy: [0, 0.06, 0.1, -0.05, 0.2, 0.04, 0.3, -0.03, 0.45, 0.02, 0.6, -0.01, 1, 0],
      alpha: [0, 0, 0.1, 1],
    },
  },
  vibrate: {
    es: 'Vibrar',
    en: 'Vibrate',
    group: 'shake',
    ease: 'linear',
    ch: {
      dx: [0, 0.02, 0.1, -0.02, 0.2, 0.02, 0.3, -0.02, 0.4, 0.015, 0.5, -0.01, 0.6, 0.005, 1, 0],
      dy: [0, -0.02, 0.15, 0.02, 0.25, -0.015, 0.35, 0.015, 0.45, -0.01, 1, 0],
      alpha: [0, 0, 0.15, 1],
    },
  },
  glitch: {
    es: 'Glitch',
    en: 'Glitch',
    group: 'shake',
    ease: 'linear',
    ch: {
      dx: [0, 0.1, 0.1, 0.1, 0.12, -0.06, 0.3, -0.06, 0.32, 0.04, 0.5, 0.04, 0.52, 0, 1, 0],
      alpha: [0, 0, 0.1, 1, 0.2, 0.3, 0.3, 1, 0.42, 0.5, 0.52, 1, 1, 1],
    },
  },
  glitchHard: {
    es: 'Glitch fuerte',
    en: 'Hard glitch',
    group: 'shake',
    ease: 'linear',
    ch: {
      dx: [0, -0.2, 0.15, 0.15, 0.3, -0.1, 0.45, 0.06, 0.6, -0.02, 0.7, 0, 1, 0],
      dy: [0, 0.05, 0.15, -0.04, 0.3, 0.03, 0.45, 0, 1, 0],
      reveal: [0, 0.3, 0.15, 0.7, 0.3, 0.5, 0.45, 0.9, 0.6, 1, 1, 1],
      alpha: [0, 0.4, 0.2, 1, 0.3, 0.5, 0.45, 1, 1, 1],
    },
  },
  impact: {
    es: 'Impacto',
    en: 'Impact',
    group: 'shake',
    ease: 'smooth',
    ch: {
      scale: [0, 1.3, 0.2, 0.95, 0.35, 1.03, 0.5, 1, 1, 1],
      dx: [0, 0, 0.2, 0.04, 0.3, -0.03, 0.4, 0.02, 0.5, 0, 1, 0],
      alpha: [0, 0, 0.12, 1],
    },
  },
  handheld: {
    es: 'Cámara en mano',
    en: 'Handheld',
    group: 'camera',
    ease: 'smooth',
    ch: {
      dx: [0, 0.03, 0.2, -0.02, 0.4, 0.025, 0.6, -0.012, 0.8, 0.008, 1, 0],
      dy: [0, -0.02, 0.25, 0.02, 0.5, -0.015, 0.75, 0.01, 1, 0],
      scale: [0, 1.06, 1, 1],
      alpha: [0, 0, 0.3, 1],
    },
  },
  // light
  slowFade: {
    es: 'Fundido lento',
    en: 'Slow fade',
    group: 'light',
    ease: 'smooth',
    ch: { alpha: [0, 0, 0.4, 0.15, 1, 1] },
  },
  quickFade: {
    es: 'Fundido rápido',
    en: 'Quick fade',
    group: 'light',
    ease: 'smooth',
    ch: { alpha: [0, 0, 0.3, 1] },
  },
  strobe: {
    es: 'Estrobo',
    en: 'Strobe',
    group: 'light',
    ease: 'linear',
    ch: {
      alpha: [0, 0, 0.1, 1, 0.2, 0, 0.3, 1, 0.4, 0, 0.5, 1, 0.6, 0, 0.7, 1, 0.8, 0.2, 0.9, 1, 1, 1],
    },
  },
  candle: {
    es: 'Vela',
    en: 'Candle',
    group: 'light',
    ease: 'smooth',
    ch: { alpha: [0, 0, 0.2, 0.5, 0.3, 0.25, 0.45, 0.75, 0.55, 0.5, 0.75, 0.9, 0.85, 0.75, 1, 1] },
  },
  flash: {
    es: 'Destello',
    en: 'Flash',
    group: 'light',
    ease: 'smooth',
    ch: { alpha: [0, 0, 0.08, 1, 0.2, 0.3, 0.4, 1], scale: [0, 1.05, 0.4, 1] },
  },
  ghost: {
    es: 'Fantasma',
    en: 'Ghost',
    group: 'light',
    ease: 'smooth',
    ch: {
      alpha: [0, 0, 0.5, 0.4, 0.6, 0.2, 1, 1],
      scale: [0, 1.08, 1, 1],
      dx: [0, 0.03, 1, 0],
    },
  },
  powerOn: {
    es: 'Encendido',
    en: 'Power on',
    group: 'light',
    ease: 'linear',
    ch: {
      alpha: [0, 0, 0.1, 1, 0.18, 0.2, 0.3, 1],
      scale: [0, 0.2, 0.1, 1.15, 0.3, 1],
    },
  },
  neon: {
    es: 'Neón',
    en: 'Neon',
    group: 'light',
    ease: 'linear',
    ch: { alpha: [0, 0, 0.05, 0.8, 0.1, 0, 0.3, 0, 0.35, 1, 0.4, 0.3, 0.55, 1, 1, 1] },
  },
  // reveal
  softWipe: {
    es: 'Barrido suave',
    en: 'Soft wipe',
    group: 'reveal',
    ease: 'smooth',
    ch: { reveal: [0, 0, 1, 1], alpha: [0, 0.3, 0.6, 1] },
  },
  wipeBounce: {
    es: 'Barrido con rebote',
    en: 'Bouncy wipe',
    group: 'reveal',
    ease: 'smooth',
    ch: { reveal: [0, 0, 0.6, 1, 0.75, 0.85, 0.9, 1, 1, 1] },
  },
  wipeZoom: {
    es: 'Barrido con zoom',
    en: 'Zoom wipe',
    group: 'reveal',
    ease: 'smooth',
    ch: { reveal: [0, 0, 1, 1], scale: [0, 1.2, 1, 1] },
  },
  wipeSlide: {
    es: 'Barrido deslizante',
    en: 'Sliding wipe',
    group: 'reveal',
    ease: 'smooth',
    ch: { reveal: [0, 0, 1, 1], dx: [0, -0.15, 1, 0] },
  },
  blinds: {
    es: 'Persiana',
    en: 'Blinds',
    group: 'reveal',
    ease: 'smooth',
    ch: {
      reveal: [
        0, 0, 0.15, 0.25, 0.25, 0.25, 0.4, 0.5, 0.5, 0.5, 0.65, 0.75, 0.75, 0.75, 0.9, 1, 1, 1,
      ],
    },
  },
  scanner: {
    es: 'Escáner',
    en: 'Scanner',
    group: 'reveal',
    ease: 'linear',
    ch: { reveal: [0, 0, 1, 1], alpha: [0, 1, 0.3, 0.6, 0.5, 1, 0.7, 0.7, 1, 1] },
  },
  stutter: {
    es: 'Tartamudeo',
    en: 'Stutter',
    group: 'reveal',
    ease: 'linear',
    ch: { reveal: [0, 0, 0.2, 0.3, 0.25, 0.1, 0.45, 0.6, 0.5, 0.4, 0.75, 0.9, 1, 1] },
  },
  wipeFast: {
    es: 'Barrido veloz',
    en: 'Fast wipe',
    group: 'reveal',
    ease: 'smooth',
    ch: { reveal: [0, 0, 0.4, 1], dx: [0, 0.04, 0.4, 0, 1, 0] },
  },
  // camera
  panLeft: {
    es: 'Paneo a la izquierda',
    en: 'Pan left',
    group: 'camera',
    ease: 'smooth',
    ch: { dx: [0, 0.12, 1, 0], scale: [0, 1.12, 1, 1] },
  },
  panRight: {
    es: 'Paneo a la derecha',
    en: 'Pan right',
    group: 'camera',
    ease: 'smooth',
    ch: { dx: [0, -0.12, 1, 0], scale: [0, 1.12, 1, 1] },
  },
  tiltUp: {
    es: 'Inclinar hacia arriba',
    en: 'Tilt up',
    group: 'camera',
    ease: 'smooth',
    ch: { dy: [0, 0.12, 1, 0], scale: [0, 1.12, 1, 1] },
  },
  tiltDown: {
    es: 'Inclinar hacia abajo',
    en: 'Tilt down',
    group: 'camera',
    ease: 'smooth',
    ch: { dy: [0, -0.12, 1, 0], scale: [0, 1.12, 1, 1] },
  },
  focusPull: {
    es: 'Cambio de foco',
    en: 'Focus pull',
    group: 'camera',
    ease: 'smooth',
    ch: { scale: [0, 1.04, 0.5, 0.98, 1, 1], alpha: [0, 0, 0.5, 0.7, 1, 1] },
  },
  snapZoom: {
    es: 'Zoom seco',
    en: 'Snap zoom',
    group: 'camera',
    ease: 'linear',
    ch: { scale: [0, 1.35, 0.15, 1.35, 0.2, 1, 1, 1] },
  },
} as const satisfies Record<string, PackEntry>;

export type SingleKind = keyof typeof SINGLES;
export type PackKind = DirKind | SingleKind;

export const PACK: Readonly<Record<PackKind, PackEntry>> = { ...directional(), ...SINGLES };
export const PACK_KINDS = Object.keys(PACK) as PackKind[];

export const isPackKind = (k: unknown): k is PackKind =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(PACK, k);
