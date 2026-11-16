/**
 * Fase 14: state of the 3D editor (scene, selection, playhead, undo) with a tiny external store.
 * The scene itself is the pure model of shared/scene3d.ts; every change goes through commit().
 */
import { useSyncExternalStore } from 'react';
import {
  newScene,
  sanitizeScene,
  updateNode,
  type Node3D,
  type Scene3D,
} from '../../../shared/scene3d';

export type Gizmo = 'translate' | 'rotate' | 'scale';

export interface RenderState {
  progress: number;
  label: string;
  cancel: () => void;
}

export interface S3 {
  open: boolean;
  scene: Scene3D;
  /** Node id, "camera", or null (scene settings). */
  selected: string | null;
  time: number;
  playing: boolean;
  gizmo: Gizmo;
  /** Look through the render camera instead of the free editor view. */
  viewCam: boolean;
  path: string | null;
  dirty: boolean;
  past: Scene3D[];
  future: Scene3D[];
  /** Label of the last commit: same label within a moment merges (one undo per drag). */
  lastLabel: string;
  lastAt: number;
  render: RenderState | null;
  /** The render dialog is open. */
  dialog: boolean;
  /** The "Generar con IA" dialog is open. */
  genOpen: boolean;
}

const SAVE_KEY = 'zinarix.scene3d.autosave';

function restore(): Scene3D {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return sanitizeScene(JSON.parse(raw));
  } catch {
    // a broken autosave starts over
  }
  return newScene();
}

let state: S3 = {
  open: false,
  scene: restore(),
  selected: null,
  time: 0,
  playing: false,
  gizmo: 'translate',
  viewCam: false,
  path: null,
  dirty: false,
  past: [],
  future: [],
  lastLabel: '',
  lastAt: 0,
  render: null,
  dialog: false,
  genOpen: false,
};
const subs = new Set<() => void>();

export const get3 = (): S3 => state;

export function set3(patch: Partial<S3> | ((s: S3) => Partial<S3>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const f of subs) f();
}

export function use3<T>(pick: (s: S3) => T): T {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => pick(state),
  );
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state.scene));
    } catch {
      // quota: the file save still works
    }
  }, 500);
}

const HISTORY = 100;

/** A change the user can undo. Commits with the same label within 1 s merge into one. */
export function commit(scene: Scene3D, label: string): void {
  const now = Date.now();
  const merge = label === state.lastLabel && now - state.lastAt < 1000;
  set3((s) => ({
    scene,
    dirty: true,
    past: merge ? s.past : [...s.past, s.scene].slice(-HISTORY),
    future: [],
    lastLabel: label,
    lastAt: now,
    time: Math.min(s.time, scene.duration),
    selected:
      s.selected && s.selected !== 'camera' && !scene.nodes.some((n) => n.id === s.selected)
        ? null
        : s.selected,
  }));
  autosave();
}

export function commitNode(id: string, fn: (n: Node3D) => Node3D, label: string): void {
  commit(updateNode(state.scene, id, fn), label);
}

export function undo3(): void {
  const prev = state.past[state.past.length - 1];
  if (!prev) return;
  set3((s) => ({
    scene: prev,
    past: s.past.slice(0, -1),
    future: [s.scene, ...s.future],
    lastLabel: '',
  }));
  autosave();
}

export function redo3(): void {
  const next = state.future[0];
  if (!next) return;
  set3((s) => ({
    scene: next,
    past: [...s.past, s.scene],
    future: s.future.slice(1),
    lastLabel: '',
  }));
  autosave();
}

/** Replaces the scene (template, file): undoable, and the playhead goes back to 0. */
export function loadScene(scene: Scene3D, label: string, path: string | null = state.path): void {
  commit(scene, label);
  set3({ time: 0, playing: false, selected: null, path, dirty: path === null });
}

export const selectedNode = (s: S3): Node3D | undefined =>
  s.selected && s.selected !== 'camera'
    ? s.scene.nodes.find((n) => n.id === s.selected)
    : undefined;

export const open3d = (): void => set3({ open: true });
export const close3d = (): void => set3({ open: false, playing: false });
/** Activity bar / command: opens the editor on its own (no Video Studio needed) or closes it. */
export const toggle3d = (): void => (state.open ? close3d() : open3d());
