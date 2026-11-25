/**
 * Pure parts of "open files follow the disk" (store.ts `syncOpenFiles`): telling Zinarix's
 * own writes from someone else's, and deciding what an open tab does about a change.
 */

/**
 * A short fingerprint of a text (length + FNV-1a of its UTF-16 units). Not cryptographic:
 * it only answers "is this the text we last read or wrote?" without keeping a second copy
 * of every open file in memory.
 */
export function textFingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

export type DiskAction =
  /** The disk has what the tab last read or wrote: nothing to do. */
  | 'same'
  /** Changed outside and the tab has no unsaved changes: take the new text. */
  | 'reload'
  /** Changed outside but the tab has unsaved changes: keep them and tell the user. */
  | 'warn';

export function diskAction(known: string | undefined, onDisk: string, dirty: boolean): DiskAction {
  if (known === textFingerprint(onDisk)) return 'same';
  return dirty ? 'warn' : 'reload';
}

/** At most one "changed on disk" notice per tab in this many milliseconds. */
export const WARN_EVERY_MS = 60_000;

/** True when the notice may be shown now; records it in `last`. */
export function mayWarn(last: Map<string, number>, path: string, now: number): boolean {
  const before = last.get(path);
  if (before !== undefined && now - before < WARN_EVERY_MS) return false;
  last.set(path, now);
  return true;
}
