/**
 * Fase 17: the window layout as data. Which areas are open, where the bottom panel sits, the
 * sizes the user dragged to, and the workspaces (Código, Agentes, Diseño, Video, Nube), each
 * with its own arrangement. Pure: no DOM, no storage. The renderer reads and writes it in
 * renderer/layout.ts.
 *
 * Stability rule: the layout never changes by itself. A newer version of Zinarix may ship new
 * presets; the user's saved arrangements stay as they are and `presetsChanged` tells the UI
 * to offer "Restablecer" instead of applying the new ones.
 */

/** Shape of the saved layout. 1 = the three loose localStorage keys used before Fase 17. */
export const LAYOUT_VERSION = 2;

/** Bump when PRESETS change, so users who saved an older arrangement get a notice. */
export const PRESETS_VERSION = 1;

export const SPACES = ['code', 'agents', 'design', 'video', 'cloud'] as const;
export type SpaceId = (typeof SPACES)[number];

/** The side views of the activity bar (mirrors State['sidebar'] in renderer/store.ts). */
export const SIDE_VIEWS = [
  'explorer',
  'search',
  'git',
  'run',
  'vercel',
  'supabase',
  'gcloud',
  'mail',
  'watch',
  'automations',
  'apps',
  'debug',
  'testing',
  'docker',
  'extensions',
  'hardware',
  'mobile',
  'games',
  'cad',
  'sketchup',
  'design',
  'graphics',
] as const;
export type SideView = (typeof SIDE_VIEWS)[number];

export type PanelPosition = 'bottom' | 'right';
export type Density = 'comfortable' | 'compact';

/** What one workspace shows. */
export interface Arrangement {
  sidebar: SideView | null;
  panelOpen: boolean;
  panelPosition: PanelPosition;
  chatOpen: boolean;
  /** Video Studio on screen. */
  studio: boolean;
}

/** Dragged sizes in px, shared by every workspace. null = not dragged yet (the window decides). */
export interface Sizes {
  side: number | null;
  chat: number | null;
  /** Height of the bottom panel. */
  panel: number | null;
  /** Width of the panel when it sits at the right of the editor. */
  panelSide: number | null;
}

export interface Layout {
  version: typeof LAYOUT_VERSION;
  /** PRESETS_VERSION the arrangements were made with. */
  presets: number;
  space: SpaceId;
  spaces: Record<SpaceId, Arrangement>;
  sizes: Sizes;
  zen: boolean;
  density: Density;
}

export const PRESETS: Readonly<Record<SpaceId, Readonly<Arrangement>>> = {
  code: {
    sidebar: 'explorer',
    panelOpen: false,
    panelPosition: 'bottom',
    chatOpen: true,
    studio: false,
  },
  // No side bar: with no file open the chat takes the whole center (App.tsx "chatWide").
  agents: {
    sidebar: null,
    panelOpen: false,
    panelPosition: 'bottom',
    chatOpen: true,
    studio: false,
  },
  design: {
    sidebar: 'design',
    panelOpen: false,
    panelPosition: 'bottom',
    chatOpen: true,
    studio: false,
  },
  video: {
    sidebar: 'explorer',
    panelOpen: false,
    panelPosition: 'bottom',
    chatOpen: true,
    studio: true,
  },
  // Integrations list, with the terminal open for deploy and CLI output.
  cloud: {
    sidebar: 'apps',
    panelOpen: true,
    panelPosition: 'bottom',
    chatOpen: true,
    studio: false,
  },
};

/** Smallest and largest size kept for each dragged size (the window may show less). */
export const SIZE_LIMITS: Readonly<Record<keyof Sizes, readonly [number, number]>> = {
  side: [160, 900],
  chat: [280, 1600],
  panel: [100, 4000],
  panelSide: [200, 4000],
};

/** Room the editor keeps beside a panel docked at its right. */
export const EDITOR_MIN_BESIDE_PANEL = 240;

export function isSpace(v: unknown): v is SpaceId {
  return typeof v === 'string' && (SPACES as readonly string[]).includes(v);
}

export function isSideView(v: unknown): v is SideView {
  return typeof v === 'string' && (SIDE_VIEWS as readonly string[]).includes(v);
}

function presetSpaces(): Record<SpaceId, Arrangement> {
  return Object.fromEntries(SPACES.map((id) => [id, { ...PRESETS[id] }])) as Record<
    SpaceId,
    Arrangement
  >;
}

export function defaultLayout(): Layout {
  return {
    version: LAYOUT_VERSION,
    presets: PRESETS_VERSION,
    space: 'code',
    spaces: presetSpaces(),
    sizes: { side: null, chat: null, panel: null, panelSide: null },
    zen: false,
    density: 'comfortable',
  };
}

/** A saved size: a finite number inside its limits (clamped), otherwise null. */
export function cleanSize(key: keyof Sizes, v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const [lo, hi] = SIZE_LIMITS[key];
  // Below the minimum is a broken value (the app never saves one), not a small panel.
  if (n < lo) return null;
  return Math.round(Math.min(hi, n));
}

function cleanArrangement(raw: unknown, fallback: Arrangement): Arrangement {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    sidebar: r.sidebar === null ? null : isSideView(r.sidebar) ? r.sidebar : fallback.sidebar,
    panelOpen: typeof r.panelOpen === 'boolean' ? r.panelOpen : fallback.panelOpen,
    panelPosition:
      r.panelPosition === 'bottom' || r.panelPosition === 'right'
        ? r.panelPosition
        : fallback.panelPosition,
    chatOpen: typeof r.chatOpen === 'boolean' ? r.chatOpen : fallback.chatOpen,
    studio: typeof r.studio === 'boolean' ? r.studio : fallback.studio,
  };
}

/** The loose keys written before Fase 17 (zs.sideWidth, zs.chatWidth, zs.panelHeight). */
export interface LegacySizes {
  side?: string | null;
  chat?: string | null;
  panel?: string | null;
}

export interface Migrated {
  layout: Layout;
  /** Version that was read: 0 = nothing saved, 1 = loose keys, 2+ = a saved layout. */
  from: number;
  /** Saved with older presets: offer "Restablecer", never apply them silently. */
  presetsChanged: boolean;
}

/**
 * Reads whatever was saved (parsed JSON, or null) into a valid Layout. Never throws: a broken
 * field falls back to its preset, the rest is kept. A layout from a newer Zinarix (version > 2)
 * keeps every field this version knows.
 */
export function migrateLayout(raw: unknown, legacy: LegacySizes = {}): Migrated {
  const base = defaultLayout();
  const r =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const version = r && typeof r.version === 'number' ? r.version : 0;

  if (!r || version < 2) {
    const sizes: Sizes = {
      side: cleanSize('side', legacy.side),
      chat: cleanSize('chat', legacy.chat),
      panel: cleanSize('panel', legacy.panel),
      panelSide: null,
    };
    const had = Object.values(sizes).some((s) => s !== null);
    return { layout: { ...base, sizes }, from: had ? 1 : 0, presetsChanged: false };
  }

  const rawSpaces = (r.spaces && typeof r.spaces === 'object' ? r.spaces : {}) as Record<
    string,
    unknown
  >;
  const spaces = Object.fromEntries(
    SPACES.map((id) => [id, cleanArrangement(rawSpaces[id], PRESETS[id])]),
  ) as Record<SpaceId, Arrangement>;
  const rs = (r.sizes && typeof r.sizes === 'object' ? r.sizes : {}) as Record<string, unknown>;
  const presets = typeof r.presets === 'number' && Number.isFinite(r.presets) ? r.presets : 0;
  const layout: Layout = {
    version: LAYOUT_VERSION,
    presets,
    space: isSpace(r.space) ? r.space : base.space,
    spaces,
    sizes: {
      side: cleanSize('side', rs.side),
      chat: cleanSize('chat', rs.chat),
      panel: cleanSize('panel', rs.panel),
      panelSide: cleanSize('panelSide', rs.panelSide),
    },
    zen: r.zen === true,
    density: r.density === 'compact' ? 'compact' : 'comfortable',
  };
  return { layout, from: version, presetsChanged: presets < PRESETS_VERSION };
}

/** Saves what is on screen as the arrangement of the current workspace. */
export function capture(layout: Layout, now: Arrangement): Layout {
  const prev = layout.spaces[layout.space];
  if (sameArrangement(prev, now)) return layout;
  return { ...layout, spaces: { ...layout.spaces, [layout.space]: { ...now } } };
}

export function sameArrangement(a: Arrangement, b: Arrangement): boolean {
  return (
    a.sidebar === b.sidebar &&
    a.panelOpen === b.panelOpen &&
    a.panelPosition === b.panelPosition &&
    a.chatOpen === b.chatOpen &&
    a.studio === b.studio
  );
}

/**
 * Leaves the current workspace (keeping what is on screen as its arrangement) and returns the
 * arrangement to show for `to`.
 */
export function switchSpace(
  layout: Layout,
  now: Arrangement,
  to: SpaceId,
): { layout: Layout; show: Arrangement } {
  const kept = capture(layout, now);
  return { layout: { ...kept, space: to }, show: { ...kept.spaces[to] } };
}

/** Puts one workspace back to its preset. Resetting every one also accepts the new presets. */
export function resetSpace(layout: Layout, id: SpaceId | 'all'): Layout {
  if (id === 'all') return { ...layout, presets: PRESETS_VERSION, spaces: presetSpaces() };
  return { ...layout, spaces: { ...layout.spaces, [id]: { ...PRESETS[id] } } };
}

/** Keeps the user's arrangements but stops showing the "presets changed" notice. */
export function keepArrangements(layout: Layout): Layout {
  return { ...layout, presets: PRESETS_VERSION };
}

export function setSize(layout: Layout, key: keyof Sizes, px: number): Layout {
  const v = cleanSize(key, px);
  if (v === null || v === layout.sizes[key]) return layout;
  return { ...layout, sizes: { ...layout.sizes, [key]: v } };
}

/**
 * Width shown for a panel docked at the right of the editor: what the user dragged to, inside
 * what fits next to an editor of EDITOR_MIN_BESIDE_PANEL px. `center` = width of the editor
 * column with the panel included.
 */
export function panelSideWidth(wanted: number | null, center: number): number {
  const [lo] = SIZE_LIMITS.panelSide;
  const w = wanted ?? Math.round(center * 0.4);
  const hi = Math.max(lo, center - EDITOR_MIN_BESIDE_PANEL);
  return Math.max(lo, Math.min(hi, w));
}
