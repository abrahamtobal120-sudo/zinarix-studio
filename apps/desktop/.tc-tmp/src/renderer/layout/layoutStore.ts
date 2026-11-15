import { useSyncExternalStore } from 'react';
import {
  capture,
  keepArrangements,
  migrateLayout,
  resetSpace,
  setSize,
  switchSpace,
  type Arrangement,
  type Density,
  type Layout,
  type Sizes,
  type SpaceId,
} from '../../shared/layout';
import { closeStudio, getV, openStudio } from '../components/video/videoStore';
import { getState, setState, toast, type State } from '../store';
import { spaceName, tl } from './i18nLayout';

/**
 * Fase 17: the saved layout (workspaces, dragged sizes, panel position, Zen, density), kept in
 * localStorage under one key. The pure model lives in shared/layout.ts.
 */

const KEY = 'zs.layout';
/** Written before Fase 17; read once by the migration. */
const LEGACY = { side: 'zs.sideWidth', chat: 'zs.chatWidth', panel: 'zs.panelHeight' } as const;

function read(): ReturnType<typeof migrateLayout> {
  let raw: unknown = null;
  try {
    const text = localStorage.getItem(KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const legacy = {
    side: localStorage.getItem(LEGACY.side),
    chat: localStorage.getItem(LEGACY.chat),
    panel: localStorage.getItem(LEGACY.panel),
  };
  return migrateLayout(raw, legacy);
}

const first = read();
let layout: Layout = first.layout;
/** Saved with older presets: Zinarix offers to reset, never changes the layout by itself. */
export const presetsChanged = first.presetsChanged;

const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      // storage full or blocked: the layout only lasts for this session
    }
  }, 150);
}
// Closing the window right after a drag must not lose it.
window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
});

function setLayout(next: Layout): void {
  if (next === layout) return;
  layout = next;
  applyDensity();
  save();
  for (const l of listeners) l();
}

export function getLayout(): Layout {
  return layout;
}

export function useLayout<T>(select: (l: Layout) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(layout),
  );
}

function applyDensity(): void {
  document.documentElement.dataset.density = layout.density;
}

/** What is on screen now, as an arrangement of the current workspace. */
export function onScreen(s: State = getState()): Arrangement {
  const v = getV();
  return {
    sidebar: s.sidebar,
    panelOpen: s.panelOpen,
    panelPosition: layout.spaces[layout.space].panelPosition,
    chatOpen: s.chatOpen,
    studio: v.open && !v.minimized,
  };
}

function show(a: Arrangement): void {
  setState({ sidebar: a.sidebar, panelOpen: a.panelOpen, chatOpen: a.chatOpen, maximized: null });
  const v = getV();
  const studioShown = v.open && !v.minimized;
  if (a.studio && !studioShown) void openStudio();
  if (!a.studio && studioShown) void closeStudio();
}

/** Called whenever the areas on screen change (App.tsx): the workspace remembers them. */
export function captureNow(): void {
  setLayout(capture(layout, onScreen()));
}

export function goToSpace(id: SpaceId): void {
  if (id === layout.space) return;
  const { layout: next, show: a } = switchSpace(layout, onScreen(), id);
  setLayout(next);
  show(a);
}

export function resetCurrentSpace(): void {
  const next = resetSpace(layout, layout.space);
  setLayout(next);
  show(next.spaces[next.space]);
  toast(tl('lyResetDone', { space: spaceName(layout.space) }));
}

export function resetAllSpaces(): void {
  const next = resetSpace(layout, 'all');
  setLayout(next);
  show(next.spaces[next.space]);
}

export function keepMyLayout(): void {
  setLayout(keepArrangements(layout));
}

export function setLayoutSize(key: keyof Sizes, px: number): void {
  setLayout(setSize(layout, key, px));
}

export function togglePanelPosition(): void {
  const cur = layout.spaces[layout.space];
  const panelPosition = cur.panelPosition === 'right' ? 'bottom' : 'right';
  setLayout({
    ...layout,
    spaces: { ...layout.spaces, [layout.space]: { ...onScreen(), panelPosition } },
  });
  // Moving the panel is pointless if it is hidden: show it.
  if (!getState().panelOpen) setState({ panelOpen: true });
}

export function toggleZen(): void {
  const zen = !layout.zen;
  setLayout({ ...layout, zen });
  if (zen) {
    setState({ maximized: null });
    toast(tl('lyZenOn'));
  }
}

export function exitZen(): void {
  if (layout.zen) setLayout({ ...layout, zen: false });
}

export function setDensity(density: Density): void {
  if (density !== layout.density) setLayout({ ...layout, density });
}

// Startup: show the workspace as it was left.
applyDensity();
{
  const a = layout.spaces[layout.space];
  setState({ sidebar: a.sidebar, panelOpen: a.panelOpen, chatOpen: a.chatOpen });
  if (a.studio) queueMicrotask(() => void openStudio());
}
// The loose keys are not read again once the layout was saved.
if (first.from === 1) {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // ignore: the migration runs again next time
  }
  for (const k of Object.values(LEGACY)) localStorage.removeItem(k);
}
