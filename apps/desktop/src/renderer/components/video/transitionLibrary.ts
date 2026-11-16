/**
 * The custom transitions the user has: their own library (saved on this computer), the ones
 * that ship with the app (community/transitions in the repository, bundled at build time) and
 * the ones downloaded from the repository on GitHub (newer than this build).
 */
import { useSyncExternalStore } from 'react';
import {
  freeId,
  mergeDefs,
  normalizeTransitionDef,
  parseTransitionFile,
  type TransitionDef,
} from '../../../shared/videoTransitions';
import { api } from '../../store';

const KEY = 'zinarix.video.transitions';
const MAX = 200;

// Files of community/transitions at the repository root, checked by test/communityTransitions.
const bundledFiles = import.meta.glob('../../../../../../community/transitions/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export const BUNDLED: TransitionDef[] = Object.values(bundledFiles).flatMap((text) => {
  const d = parseTransitionFile(text);
  return 'error' in d ? [] : [d];
});

function load(): TransitionDef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x) => {
      const d = normalizeTransitionDef(x);
      return 'error' in d ? [] : [d];
    });
  } catch {
    return [];
  }
}

interface State {
  mine: TransitionDef[];
  community: TransitionDef[];
  /** 'idle' until the first download; then loading / ok / error. */
  remote: 'idle' | 'loading' | 'ok' | 'error';
}
let state: State = { mine: load(), community: [], remote: 'idle' };
const subs = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const useTransitionLibrary = () => useSyncExternalStore(subscribe, () => state);

/** Everything the user can apply: shared ones first, their own over them (same id). */
export const allTransitions = (): TransitionDef[] =>
  mergeDefs(BUNDLED, state.community, state.mine);

export const isMine = (id: string) => state.mine.some((d) => d.id === id);

/** Saves a transition in the user's library (same id replaces it). */
export function saveTransition(def: TransitionDef): void {
  const mine = [def, ...state.mine.filter((d) => d.id !== def.id)].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(mine));
  set({ mine });
}

export function deleteTransition(id: string): void {
  const mine = state.mine.filter((d) => d.id !== id);
  localStorage.setItem(KEY, JSON.stringify(mine));
  set({ mine });
}

/** Imports a .json file into the library; a different one with a taken id gets a new id. */
export function importTransition(text: string): TransitionDef | { error: string } {
  const d = parseTransitionFile(text);
  if ('error' in d) return d;
  const same = allTransitions().find((x) => x.id === d.id);
  if (same && JSON.stringify(same) !== JSON.stringify(d))
    d.id = freeId(d.id, new Set(allTransitions().map((x) => x.id)));
  saveTransition(d);
  return d;
}

/** Downloads the shared folder from GitHub (main validates every file). */
export async function refreshCommunity(force = false): Promise<void> {
  if (state.remote === 'loading') return;
  set({ remote: 'loading' });
  try {
    set({ community: await api().video.communityTransitions(force), remote: 'ok' });
  } catch {
    set({ remote: 'error' });
  }
}
