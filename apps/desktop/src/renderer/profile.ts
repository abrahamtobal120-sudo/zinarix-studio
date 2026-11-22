import { useSyncExternalStore } from 'react';

/**
 * The first-run questionnaire's answers and what they set up: which panels get a button of
 * their own in the activity bar, the theme, how much the AI does by itself and how much help
 * the app shows. Pure parts (recommend) are tested; the rest is a tiny localStorage store.
 */

export type Use =
  | 'web'
  | 'mobile'
  | 'games'
  | 'hardware'
  | 'arch3d'
  | 'print3d'
  | 'video'
  | 'graphics'
  | 'data'
  | 'cloud'
  | 'office';
export type Level = 'new' | 'some' | 'pro';
export type AiWay = 'local' | 'keys' | 'cli' | 'unsure';
export type Help = 'auto' | 'ask' | 'chat';
export type Look = 'dark' | 'light';

export interface Answers {
  uses: Use[];
  level: Level;
  ai: AiWay;
  help: Help;
  look: Look;
}

export interface Profile {
  answers: Answers;
  /** Activity bar keys (Chrome.tsx useBarItems) shown as buttons of their own. */
  pinned: string[];
  /** The side panel to open when the questionnaire ends. */
  start: string | null;
  at: number;
}

export const USES: Use[] = [
  'web',
  'mobile',
  'games',
  'hardware',
  'arch3d',
  'print3d',
  'video',
  'graphics',
  'data',
  'cloud',
  'office',
];

/** Panels for each use, most useful first. */
const PANELS: Record<Use, string[]> = {
  web: ['browser', 'design', 'playground'],
  mobile: ['mobile'],
  games: ['games', 'studio3d'],
  hardware: ['hardware'],
  arch3d: ['sketchup', 'studio3d', 'cad'],
  print3d: ['cad', 'studio3d'],
  video: ['video', 'graphics'],
  graphics: ['graphics', 'design'],
  data: ['testing'],
  cloud: ['docker', 'vercel', 'supabase', 'gcloud'],
  office: ['mail', 'browser', 'automations'],
};

/** Side panels (not toggles) that can be opened at the end. */
const START: Partial<Record<Use, string>> = {
  mobile: 'mobile',
  games: 'games',
  hardware: 'hardware',
  arch3d: 'sketchup',
  print3d: 'cad',
  graphics: 'graphics',
  cloud: 'docker',
  office: 'mail',
};

/** At most this many pinned buttons, so the bar stays short. */
export const MAX_PINNED = 6;

export function recommend(a: Answers): Pick<Profile, 'pinned' | 'start'> {
  const pinned: string[] = [];
  // Round robin over the chosen uses, so every use gets its main panel first.
  const lists = a.uses.map((u) => PANELS[u]);
  for (let i = 0; pinned.length < MAX_PINNED && lists.some((l) => i < l.length); i++)
    for (const l of lists) {
      const k = l[i];
      if (k && !pinned.includes(k) && pinned.length < MAX_PINNED) pinned.push(k);
    }
  const first = a.uses.find((u) => START[u]);
  return { pinned, start: first ? START[first]! : null };
}

const KEY = 'zs.profile';

function load(): Profile | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Profile | null;
    return v && Array.isArray(v.pinned) ? v : null;
  } catch {
    return null;
  }
}

let current: Profile | null = load();
const subs = new Set<() => void>();

export function getProfile(): Profile | null {
  return current;
}

export function saveProfile(p: Profile | null): void {
  current = p;
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the answers last until the app closes
  }
  for (const f of subs) f();
}

export function setPinned(pinned: string[]): void {
  if (current) saveProfile({ ...current, pinned });
}

export function usePinned(): string[] {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current?.pinned ?? EMPTY,
  );
}
const EMPTY: string[] = [];
