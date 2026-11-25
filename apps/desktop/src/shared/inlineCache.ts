/**
 * Cache of inline (ghost-text) completions, keyed by what is before the cursor.
 *
 * Two cases are answered without asking the model again (and without the typing pause):
 * - the same place again (the cursor came back, or the editor asked twice);
 * - the user typed the first characters of the suggestion: what is left of it still applies.
 * Pure (no Monaco, no IPC) so it can be tested on its own.
 */

interface Entry {
  path: string;
  /** Everything before the cursor when the suggestion was made. */
  prefix: string;
  /** First line after the cursor at that moment: the suggestion was made to fit before it. */
  after: string;
  text: string;
}

/** Suggestions remembered (the newest ones; a typing session rarely needs more). */
export const INLINE_CACHE_SIZE = 40;

function firstLine(s: string): string {
  const at = s.indexOf('\n');
  return (at < 0 ? s : s.slice(0, at)).replace(/\r$/, '');
}

/**
 * Whether a suggestion can help at this place. With code left on the line after the cursor
 * (anything but closing brackets, quotes and punctuation) the cursor is in the middle of a
 * statement: a suggestion there rarely fits and is seldom accepted, so the model is not asked.
 */
export function worthAsking(prefix: string, suffix: string): boolean {
  if (!prefix.trim()) return false;
  return /^[\s)\]}>"'`;,:]*$/.test(firstLine(suffix));
}

export class InlineCache {
  private entries: Entry[] = [];

  constructor(private readonly size = INLINE_CACHE_SIZE) {}

  /** Remembers the suggestion made at this place. Empty suggestions count ("nothing to add"). */
  put(path: string, prefix: string, suffix: string, text: string): void {
    const after = firstLine(suffix);
    this.entries = this.entries.filter(
      (e) => !(e.path === path && e.prefix === prefix && e.after === after),
    );
    this.entries.push({ path, prefix, after, text });
    if (this.entries.length > this.size) this.entries.splice(0, this.entries.length - this.size);
  }

  /**
   * The suggestion for this place: undefined = not known (ask the model); '' = known to be
   * nothing. A suggestion whose beginning the user has typed comes back without that part.
   */
  get(path: string, prefix: string, suffix: string): string | undefined {
    const after = firstLine(suffix);
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.path !== path || e.after !== after) continue;
      if (e.prefix === prefix) return e.text;
      if (!e.text || prefix.length <= e.prefix.length || !prefix.startsWith(e.prefix)) continue;
      const typed = prefix.slice(e.prefix.length);
      // Typed exactly what was suggested: the rest still fits (nothing left = ask again).
      if (typed.length < e.text.length && e.text.startsWith(typed))
        return e.text.slice(typed.length);
    }
    return undefined;
  }

  clear(): void {
    this.entries = [];
  }
}
