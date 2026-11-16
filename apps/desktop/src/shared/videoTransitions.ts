/**
 * Custom transitions: a transition described only with data (no code), so the AI can invent
 * one, the user can keep it in a library and anyone can share it through the Zinarix Studio
 * repository (community/transitions/*.json).
 *
 * A transition is how the incoming clip looks while it comes in, over k = 0 (not there yet)
 * → 1 (fully in): curves of keys for alpha, dx / dy (share of the frame), scale and reveal
 * (share shown from the left). The same numbers drive the preview (customLook) and the
 * FFmpeg export (customLookExpr), so both look the same. Only numbers ever reach FFmpeg.
 */

export const TRANSITION_FORMAT = 'zinarix-transition';
export const TRANSITION_VERSION = 1;

export type TransitionChannel = 'alpha' | 'dx' | 'dy' | 'scale' | 'reveal';
export const TRANSITION_CHANNELS: readonly TransitionChannel[] = [
  'alpha',
  'dx',
  'dy',
  'scale',
  'reveal',
];

/** Allowed values per channel, and where each must end (k = 1: the clip in place). */
export const CHANNEL_RANGE: Record<TransitionChannel, readonly [number, number]> = {
  alpha: [0, 1],
  dx: [-1, 1],
  dy: [-1, 1],
  scale: [0.1, 3],
  reveal: [0, 1],
};
export const CHANNEL_END: Record<TransitionChannel, number> = {
  alpha: 1,
  dx: 0,
  dy: 0,
  scale: 1,
  reveal: 1,
};

export type TransitionEase = 'linear' | 'smooth';

export interface TransitionKey {
  /** 0…1 along the transition. */
  t: number;
  v: number;
}

export interface TransitionDef {
  format: typeof TRANSITION_FORMAT;
  version: number;
  /** Slug: a-z, 0-9 and dashes. Also the file name in community/transitions. */
  id: string;
  name: string;
  description?: string;
  author?: string;
  ease: TransitionEase;
  channels: Partial<Record<TransitionChannel, TransitionKey[]>>;
}

/** What a custom transition does at k (only the channels it has). */
export interface CustomLook {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  reveal: number;
}

export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 200;
export const AUTHOR_MAX = 40;
export const KEYS_MIN = 2;
export const KEYS_MAX = 12;
/** Largest JSON file accepted (community downloads, imports). */
export const DEF_BYTES_MAX = 16 * 1024;

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r4 = (x: number) => Math.round(x * 10000) / 10000;
// Strip control characters and the characters that matter to FFmpeg or HTML.
const clean = (s: unknown, max: number) =>
  typeof s === 'string'
    ? s
        .replace(/[\p{Cc}<>`]/gu, '')
        .trim()
        .slice(0, max)
    : '';

/** "Barrido Diagonal!" → "barrido-diagonal". */
export function slugify(s: string): string {
  const slug = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'transicion';
}

export const validSlug = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s);

/** Keys sorted, inside the channel's range, starting at t = 0 and ending in place at t = 1. */
function normalizeKeys(ch: TransitionChannel, raw: unknown): TransitionKey[] | string {
  if (!Array.isArray(raw)) return `${ch}: keys must be a list of {t, v}`;
  const [lo, hi] = CHANNEL_RANGE[ch];
  const keys: TransitionKey[] = [];
  for (const k of raw) {
    const t = Array.isArray(k) ? k[0] : (k as TransitionKey | null)?.t;
    const v = Array.isArray(k) ? k[1] : (k as TransitionKey | null)?.v;
    if (!finite(t) || !finite(v)) return `${ch}: every key needs numbers t and v`;
    keys.push({ t: r4(clamp(t, 0, 1)), v: r4(clamp(v, lo, hi)) });
  }
  keys.sort((a, b) => a.t - b.t);
  // One key per t (the last one given wins).
  const out = keys.filter((k, i) => i === keys.length - 1 || keys[i + 1]!.t !== k.t);
  if (!out.length) return `${ch}: give at least one key`;
  if (out[0]!.t > 0) out.unshift({ t: 0, v: out[0]!.v });
  const end = CHANNEL_END[ch];
  if (out[out.length - 1]!.t < 1) out.push({ t: 1, v: end });
  else out[out.length - 1] = { t: 1, v: end };
  if (out.length > KEYS_MAX) return `${ch}: at most ${KEYS_MAX} keys`;
  return out;
}

/**
 * A safe transition from anything (the AI's arguments, a file, a download): unknown fields
 * dropped, numbers clamped, the end forced to "clip in place". Error text for the model.
 */
export function normalizeTransitionDef(raw: unknown): TransitionDef | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'The transition must be an object.' };
  const r = raw as Record<string, unknown>;
  if (r.format !== undefined && r.format !== TRANSITION_FORMAT)
    return { error: `"format" must be "${TRANSITION_FORMAT}".` };
  if (finite(r.version) && r.version > TRANSITION_VERSION)
    return { error: 'This transition needs a newer Zinarix Studio.' };
  const name = clean(r.name, NAME_MAX);
  if (!name) return { error: 'Give the transition a "name".' };
  const src = r.channels;
  if (!src || typeof src !== 'object')
    return { error: 'Give "channels" (alpha, dx, dy, scale, reveal).' };
  const channels: TransitionDef['channels'] = {};
  for (const [ch, keys] of Object.entries(src as Record<string, unknown>)) {
    if (!(TRANSITION_CHANNELS as readonly string[]).includes(ch))
      return { error: `Unknown channel "${ch}". Use: ${TRANSITION_CHANNELS.join(', ')}.` };
    const n = normalizeKeys(ch as TransitionChannel, keys);
    if (typeof n === 'string') return { error: n };
    // A channel that never leaves its end value does nothing.
    if (n.some((k) => k.v !== CHANNEL_END[ch as TransitionChannel]))
      channels[ch as TransitionChannel] = n;
  }
  if (!Object.keys(channels).length)
    return { error: 'The transition changes nothing: every channel stays at its end value.' };
  const description = clean(r.description, DESCRIPTION_MAX);
  const author = clean(r.author, AUTHOR_MAX);
  return {
    format: TRANSITION_FORMAT,
    version: TRANSITION_VERSION,
    id: validSlug(r.id) ? r.id : slugify(name),
    name,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ease: r.ease === 'linear' ? 'linear' : 'smooth',
    channels,
  };
}

/** True when x is already a normalized definition (what a saved project must hold). */
export function validTransitionDef(x: unknown): x is TransitionDef {
  const n = normalizeTransitionDef(x);
  return !('error' in n) && JSON.stringify(n) === JSON.stringify(x);
}

const easeOf = (e: TransitionEase, u: number) => (e === 'linear' ? u : u * u * (3 - 2 * u));

function channelAt(keys: TransitionKey[], ease: TransitionEase, k: number): number {
  const x = clamp(k, 0, 1);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (x <= b.t || i === keys.length - 2) {
      const u = b.t > a.t ? clamp((x - a.t) / (b.t - a.t), 0, 1) : 1;
      return a.v + (b.v - a.v) * easeOf(ease, u);
    }
  }
  return keys[keys.length - 1]!.v;
}

/** How the incoming clip looks at k with this transition (preview). */
export function customLook(def: TransitionDef, k: number): CustomLook {
  const at = (ch: TransitionChannel) => {
    const keys = def.channels[ch];
    return keys ? channelAt(keys, def.ease, k) : CHANNEL_END[ch];
  };
  return {
    alpha: at('alpha'),
    dx: at('dx'),
    dy: at('dy'),
    scale: at('scale'),
    reveal: at('reveal'),
  };
}

const n6 = (x: number) => {
  const s = (Math.round(x * 1e6) / 1e6).toString();
  return s.includes('e') ? '0' : s;
};

/** FFmpeg expression of one channel over k (an expression already clipped to 0…1). */
function channelExpr(keys: TransitionKey[], ease: TransitionEase, k: string): string {
  let e = n6(keys[keys.length - 1]!.v);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const span = b.t - a.t;
    if (span <= 0) continue;
    const u = `clip((${k}-${n6(a.t)})/${n6(span)},0,1)`;
    const eu = ease === 'linear' ? u : `(${u}*${u}*(3-2*${u}))`;
    const seg = `(${n6(a.v)}+${n6(b.v - a.v)}*${eu})`;
    e = i === keys.length - 2 ? seg : `if(lt(${k},${n6(b.t)}),${seg},${e})`;
  }
  return e;
}

/** FFmpeg expressions of the transition over k (same curves as customLook). */
export function customLookExpr(
  def: TransitionDef,
  k: string,
): Partial<Record<TransitionChannel, string>> {
  const out: Partial<Record<TransitionChannel, string>> = {};
  for (const ch of TRANSITION_CHANNELS) {
    const keys = def.channels[ch];
    if (keys) out[ch] = channelExpr(keys, def.ease, k);
  }
  return out;
}

/** Largest scale the transition reaches (the export scales once to it). */
export function maxDefScale(def: TransitionDef): number {
  const keys = def.channels.scale;
  return keys ? Math.max(1, ...keys.map((x) => x.v)) : 1;
}

/** The file to save or share: pretty JSON with a final newline. */
export function transitionFile(def: TransitionDef): string {
  return `${JSON.stringify(def, null, 2)}\n`;
}

/** Parses a .json file (import, community download). */
export function parseTransitionFile(text: string): TransitionDef | { error: string } {
  if (text.length > DEF_BYTES_MAX) return { error: 'The file is too large for a transition.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'The file is not valid JSON.' };
  }
  if ((raw as { format?: unknown } | null)?.format !== TRANSITION_FORMAT)
    return { error: `Not a Zinarix transition (format must be "${TRANSITION_FORMAT}").` };
  return normalizeTransitionDef(raw);
}

// ---------------- the shared library (Zinarix Studio repository) ----------------

export const COMMUNITY_REPO = 'abrahamtobal120-sudo/zinarix-studio';
export const COMMUNITY_DIR = 'community/transitions';

/**
 * The page that proposes the file to the repository: GitHub opens its editor with the file
 * filled in, and for someone who cannot write to the repo it makes a fork and a pull request.
 * Nothing is published until the user presses "Commit / Propose" there, signed in to GitHub.
 */
export function shareUrl(def: TransitionDef): string {
  const q = new URLSearchParams({
    filename: `${def.id}.json`,
    value: transitionFile(def),
    message: `Transición: ${def.name}`,
  });
  return `https://github.com/${COMMUNITY_REPO}/new/main/${COMMUNITY_DIR}?${q.toString()}`;
}

/** GitHub API listing of the shared folder. */
export const COMMUNITY_LIST_URL = `https://api.github.com/repos/${COMMUNITY_REPO}/contents/${COMMUNITY_DIR}?ref=main`;

/** Merges lists by id: later lists win (library over community over bundled). */
export function mergeDefs(...lists: readonly (readonly TransitionDef[])[]): TransitionDef[] {
  const m = new Map<string, TransitionDef>();
  for (const l of lists) for (const d of l) m.set(d.id, d);
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** An id not used yet ("zoom-giro", "zoom-giro-2"…). */
export function freeId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  for (let i = 2; ; i++) {
    const s = `${id.slice(0, 36)}-${i}`;
    if (!taken.has(s)) return s;
  }
}
