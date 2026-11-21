/**
 * State of Zinarix Video Studio (same pattern as ../../store.ts: one object, setState, a
 * useSyncExternalStore hook). The project itself is the pure model of shared/video.ts; every
 * edit goes through commit() so it can be undone.
 */
import { useSyncExternalStore } from 'react';
import type { VideoJobView } from '../../../shared/api';
import type { Clip, MediaItem, VideoProject } from '../../../shared/video';
import type { Look } from '../../../shared/videoFx';
import {
  insertMedia,
  mediaKindOf,
  newProject,
  projectDuration,
  toFrame,
} from '../../../shared/video';
import { confirmDialog } from '../../confirm';
import { api, toast } from '../../store';
import { tv } from './strings';
import { autoProxy, findProxies } from './proxies';

export type StudioTab =
  | 'media'
  | 'easy'
  | 'audio'
  | 'text'
  | 'stickers'
  | 'effects'
  | 'transitions'
  | 'color'
  | 'ai'
  | '3d';

export interface VState {
  open: boolean;
  minimized: boolean;
  project: VideoProject;
  /** Where the .zvproj lives (null = never saved). */
  path: string | null;
  dirty: boolean;
  savedAt: number | null;
  autosavedAt: number | null;
  past: { project: VideoProject; label: string }[];
  future: { project: VideoProject; label: string }[];
  /** zmedia:// URLs by media id (runtime only, never saved). */
  urls: Record<string, string>;
  /** Fase 4C: proxy URLs by media id, and the progress (0–1) of the ones being made. */
  proxies: Record<string, string>;
  proxyProg: Record<string, number>;
  /** Play the proxies instead of the originals (the export always reads the originals). */
  useProxy: boolean;
  /** Make proxies on import for videos above 1080p. */
  autoProxy: boolean;
  thumbs: Record<string, string>;
  waves: Record<string, { pps: number; peaks: number[] }>;
  importing: string[];
  playhead: number;
  playing: boolean;
  /** Playback speed while playing (J/K/L): negative = backwards. */
  rate: number;
  selection: string[];
  snap: boolean;
  /** Pixels per second on the timeline. */
  zoom: number;
  tab: StudioTab;
  quality: 1 | 0.5 | 0.25;
  jobs: VideoJobView[];
  dialog: null | 'new' | 'export' | 'shortcuts';
  tools: { ffmpeg: boolean; version: string | null } | null;
  clipboard: Clip[];
  /** The studio's own text prompt (the app's modals sit below the studio). */
  prompt: { label: string; value: string; resolve: (v: string | null) => void } | null;
  /**
   * Hovering an animation card: these clips play it on a loop in the viewer (runtime only,
   * nothing is edited). `since` is performance.now() when the hover started.
   */
  fxPreview: { ids: string[]; look: (k: number) => Look; since: number } | null;
}

const LAYOUT_KEY = 'zvs.layout';
const PROXY_KEY = 'zvs.proxy';

function proxyPrefs(): { useProxy: boolean; autoProxy: boolean } {
  try {
    const j = JSON.parse(localStorage.getItem(PROXY_KEY) ?? '{}') as Record<string, unknown>;
    return { useProxy: j.use !== false, autoProxy: j.auto !== false };
  } catch {
    return { useProxy: true, autoProxy: true };
  }
}
export function saveProxyPrefs(p: { useProxy?: boolean; autoProxy?: boolean }): void {
  setV(p);
  try {
    localStorage.setItem(PROXY_KEY, JSON.stringify({ use: state.useProxy, auto: state.autoProxy }));
  } catch {
    // private mode: only this session
  }
}

/** Fase 4C: what the preview plays for a media item (its proxy when there is one and they are on). */
export function playUrl(s: VState, mediaId: string): string | undefined {
  return (s.useProxy && s.proxies[mediaId]) || s.urls[mediaId];
}

let state: VState = {
  open: false,
  minimized: false,
  project: newProject({ name: tv('untitled') }),
  path: null,
  dirty: false,
  savedAt: null,
  autosavedAt: null,
  past: [],
  future: [],
  urls: {},
  proxies: {},
  proxyProg: {},
  ...proxyPrefs(),
  thumbs: {},
  waves: {},
  importing: [],
  playhead: 0,
  playing: false,
  rate: 1,
  selection: [],
  snap: true,
  zoom: 60,
  tab: 'media',
  quality: 0.5,
  jobs: [],
  dialog: null,
  tools: null,
  clipboard: [],
  prompt: null,
  fxPreview: null,
};

const listeners = new Set<() => void>();
export function setV(patch: Partial<VState> | ((s: VState) => Partial<VState>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const l of listeners) l();
}
export function getV(): VState {
  return state;
}
export function useV<T>(select: (s: VState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export function vPrompt(label: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => setV({ prompt: { label, value, resolve } }));
}

/** Open menus and popovers: Esc closes the newest one before it closes anything else. */
const escapeStack: (() => void)[] = [];
export function holdEscape(close: () => void): () => void {
  escapeStack.push(close);
  return () => {
    const i = escapeStack.lastIndexOf(close);
    if (i >= 0) escapeStack.splice(i, 1);
  };
}
/** Closes the newest open menu; false when there is none. */
export function closeTopPopover(): boolean {
  const close = escapeStack.at(-1);
  if (!close) return false;
  close();
  return true;
}

const HISTORY_MAX = 300;

/** Applies an edit (undoable). */
export function commit(next: VideoProject, label: string): void {
  if (next === state.project) return;
  setV((s) => ({
    project: next,
    past: [...s.past.slice(-HISTORY_MAX + 1), { project: s.project, label }],
    future: [],
    dirty: true,
    // Drop selected clips that no longer exist.
    selection: s.selection.filter((id) => next.clips.some((c) => c.id === id)),
  }));
}

/** Commits, or folds into the last history step when it has the same label (slider drags). */
export function commitMerged(next: VideoProject, label: string): void {
  if (state.past.at(-1)?.label === label && !state.future.length)
    setV({ project: next, dirty: true });
  else commit(next, label);
}

export function undo(): void {
  const last = state.past.at(-1);
  if (!last) return;
  setV((s) => ({
    project: last.project,
    past: s.past.slice(0, -1),
    future: [{ project: s.project, label: last.label }, ...s.future],
    dirty: true,
    selection: s.selection.filter((id) => last.project.clips.some((c) => c.id === id)),
  }));
}

export function redo(): void {
  const next = state.future[0];
  if (!next) return;
  setV((s) => ({
    project: next.project,
    future: s.future.slice(1),
    past: [...s.past, { project: s.project, label: next.label }],
    dirty: true,
  }));
}

export function seek(t: number): void {
  const p = state.project;
  const max = Math.max(projectDuration(p), 0);
  setV({ playhead: toFrame(Math.min(Math.max(0, t), max), p.fps) });
}

// ---------------- opening / closing ----------------

let recoveryChecked = false;

export async function openStudio(file?: string): Promise<void> {
  setV({ open: true, minimized: false });
  document.body.classList.add('vs-open');
  if (!state.tools)
    void api()
      .video.tools()
      .then((tools) => setV({ tools }));
  if (!recoveryChecked) {
    recoveryChecked = true;
    const rec = await api()
      .video.recover()
      .catch(() => null);
    if (rec && !state.dirty && !state.project.clips.length) {
      const when = new Date(rec.savedAt).toLocaleString();
      if (
        await confirmDialog(tv('recoverAsk', { name: rec.project.name, time: when }), {
          okLabel: tv('recover'),
          cancelLabel: tv('discard'),
        })
      ) {
        await loadProject(rec.project, rec.path);
        setV({ dirty: true });
      } else void api().video.autosave(null, null);
    }
  }
  if (file) await openFileInStudio(file);
}

/** "Back to chat": hides the studio; the project stays as it is. */
export async function closeStudio(ask = false): Promise<void> {
  if (ask && state.dirty && !(await confirmDialog(tv('backConfirm')))) return;
  setV({ open: false, playing: false, dialog: null });
  document.body.classList.remove('vs-open');
}

let lastToggle = 0;
export function toggleStudio(): void {
  // The shortcut can arrive twice (page key handler + app menu): one toggle per press.
  const now = Date.now();
  if (now - lastToggle < 400) return;
  lastToggle = now;
  if (state.open && !state.minimized) void closeStudio();
  else void openStudio();
}

export function minimizeStudio(): void {
  setV({ minimized: true, playing: false });
  document.body.classList.remove('vs-open');
}

/** A media file or a .zvproj (from the explorer, a drop or the command line). */
export async function openFileInStudio(path: string): Promise<void> {
  if (path.toLowerCase().endsWith('.zvproj')) return void openProjectFile(path);
  const m = await importPaths([path]);
  // Straight onto the timeline when it is the first thing in an empty project.
  if (m[0] && !state.project.clips.length) addToTimeline(m[0]);
}

// ---------------- media ----------------

export async function importPaths(paths: string[]): Promise<MediaItem[]> {
  const added: MediaItem[] = [];
  for (const path of paths) {
    if (!mediaKindOf(path)) {
      toast(
        tv('importFailed', {
          name: path.split(/[\\/]/).pop() ?? path,
          err: 'formato no compatible',
        }),
      );
      continue;
    }
    const existing = state.project.media.find((m) => m.path === path && !m.missing);
    if (existing) {
      added.push(existing);
      continue;
    }
    const name = path.split(/[\\/]/).pop() ?? path;
    setV((s) => ({ importing: [...s.importing, name] }));
    try {
      const { url, ...item } = await api().video.probe(path);
      commit({ ...state.project, media: [...state.project.media, item] }, tv('import'));
      setV((s) => ({ urls: { ...s.urls, [item.id]: url } }));
      void loadDerived(item);
      void autoProxy(item);
      added.push(item);
    } catch (e) {
      toast(
        tv('importFailed', {
          name,
          err: (e as Error).message.replace(
            /^Error invoking remote method '[^']+': (Error: )?/,
            '',
          ),
        }),
      );
    } finally {
      setV((s) => ({ importing: s.importing.filter((x) => x !== name) }));
    }
  }
  return added;
}

/** Thumbnails and waveform, in the background. */
async function loadDerived(m: MediaItem): Promise<void> {
  if (m.missing) return;
  if (m.kind === 'video' && m.hasVideo)
    void api()
      .video.thumbnails(m.path, m.duration, 24)
      .then((url) => setV((s) => ({ thumbs: { ...s.thumbs, [m.id]: url } })))
      .catch(() => undefined);
  if (m.kind === 'image' && state.urls[m.id])
    setV((s) => ({ thumbs: { ...s.thumbs, [m.id]: s.urls[m.id]! } }));
  if (m.hasAudio)
    void api()
      .video.waveform(m.path)
      .then((w) =>
        setV((s) => ({ waves: { ...s.waves, [m.id]: { pps: w.peaksPerSecond, peaks: w.peaks } } })),
      )
      .catch(() => undefined);
}

export function addToTimeline(m: MediaItem, at?: { trackId?: string; start?: number }): void {
  const { project, clip } = insertMedia(state.project, m, at ?? { start: undefined });
  if (!clip) return;
  commit(project, tv('addToTimeline'));
  setV({ selection: [clip.id] });
}

export async function removeMedia(m: MediaItem): Promise<void> {
  const used = state.project.clips.filter((c) => c.mediaId === m.id).length;
  if (
    used &&
    !(await confirmDialog(tv('removeMediaUsed', { name: m.name, n: used }), { danger: true }))
  )
    return;
  commit(
    {
      ...state.project,
      media: state.project.media.filter((x) => x.id !== m.id),
      clips: state.project.clips.filter((c) => c.mediaId !== m.id),
    },
    tv('removeMedia'),
  );
}

export async function relinkMedia(m: MediaItem): Promise<void> {
  const path = await api().video.relink(m.name);
  if (!path) return;
  try {
    const { url, id: _id, ...probed } = await api().video.probe(path);
    const item: MediaItem = { ...m, ...probed, id: m.id, missing: false };
    commit(
      { ...state.project, media: state.project.media.map((x) => (x.id === m.id ? item : x)) },
      tv('relink'),
    );
    setV((s) => ({ urls: { ...s.urls, [m.id]: url } }));
    void loadDerived(item);
    toast(tv('relinked'));
  } catch (e) {
    toast((e as Error).message);
  }
}

// ---------------- project files ----------------

async function loadProject(project: VideoProject, path: string | null): Promise<void> {
  const urls: Record<string, string> = {};
  for (const m of project.media) {
    if (m.missing) continue;
    const u = await api()
      .video.mediaUrl(m.path)
      .catch(() => null);
    if (u) urls[m.id] = u;
  }
  setV({
    project,
    path,
    dirty: false,
    past: [],
    future: [],
    urls,
    proxies: {},
    proxyProg: {},
    thumbs: {},
    waves: {},
    selection: [],
    playhead: 0,
    playing: false,
    savedAt: path ? Date.now() : null,
  });
  for (const m of project.media) void loadDerived(m);
  void findProxies();
}

export async function newProjectWith(opts: {
  width: number;
  height: number;
  fps: number;
  name?: string;
}): Promise<void> {
  if (state.dirty && !(await confirmDialog(tv('discardChanges'), { danger: true }))) return;
  await loadProject(newProject({ ...opts, name: opts.name ?? tv('untitled') }), null);
  void api().video.autosave(null, null);
}

export async function openProjectFile(path: string | null = null): Promise<void> {
  if (state.dirty && !(await confirmDialog(tv('discardChanges'), { danger: true }))) return;
  try {
    const r = await api().video.openProject(path);
    if (r) await loadProject(r.project, r.path);
  } catch (e) {
    toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

let saving = false;
export async function saveProject(saveAs = false): Promise<boolean> {
  if (saving) return false;
  saving = true;
  try {
    const path = await api().video.saveProject(state.project, state.path, saveAs);
    if (!path) return false;
    setV({ path, dirty: false, savedAt: Date.now() });
    void api().video.autosave(null, null);
    toast(tv('projectSaved'));
    return true;
  } catch (e) {
    toast((e as Error).message);
    return false;
  } finally {
    saving = false;
  }
}

// Crash copy every 30 s while there are unsaved changes.
setInterval(() => {
  if (!state.dirty || (!state.project.clips.length && !state.project.media.length)) return;
  void api()
    .video.autosave(state.project, state.path)
    .then(() => setV({ autosavedAt: Date.now() }))
    .catch(() => undefined);
}, 30_000);

// ---------------- layout ----------------

export interface Layout {
  left: number;
  right: number;
  timeline: number;
  showLeft: boolean;
  showRight: boolean;
}
export function loadLayout(): Layout {
  try {
    const j = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<Layout>;
    return {
      left: j.left ?? 300,
      right: j.right ?? 280,
      timeline: j.timeline ?? 300,
      showLeft: j.showLeft ?? true,
      showRight: j.showRight ?? true,
    };
  } catch {
    return { left: 300, right: 280, timeline: 300, showLeft: true, showRight: true };
  }
}
export function saveLayout(l: Layout): void {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
}

// ---------------- export jobs ----------------

let jobsWired = false;
export function wireJobs(): void {
  if (jobsWired) return;
  jobsWired = true;
  api().on((ev) => {
    if (ev.type !== 'video:job') return;
    const job = ev.job;
    const prev = state.jobs.find((j) => j.id === job.id);
    setV((s) => ({
      jobs: prev ? s.jobs.map((j) => (j.id === job.id ? job : j)) : [...s.jobs, job],
    }));
    if (prev?.state !== job.state) {
      if (job.state === 'done')
        toast(tv('exportDone', { name: job.out.split(/[\\/]/).pop() ?? job.out }));
      if (job.state === 'error') toast(tv('exportFailed', { err: job.error ?? '' }));
    }
  });
}
