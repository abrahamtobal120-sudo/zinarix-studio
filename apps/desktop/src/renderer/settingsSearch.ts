/**
 * Search over the Settings dialog (plan B5). Pure: the dialog builds the entries from its own
 * labels, this ranks them for what the user typed.
 */

export type SettingEntry = {
  /** Section of the dialog the setting lives in. */
  section: string;
  /** Name of that section, shown next to the result. */
  sectionLabel: string;
  /** Visible label of the setting; also how the dialog finds its row to scroll to it. */
  label: string;
  /** Help text under the label. */
  hint?: string;
  /** Extra words people may type that are in neither text (synonyms, the other language). */
  keywords?: string;
  /** For a keyboard shortcut: the command it belongs to. */
  command?: string;
};

export type SettingHit = SettingEntry & { score: number };

export const MAX_SETTING_HITS = 40;

/** Lower case, without accents: "Tamaño" and "tamano" are the same word. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Where a word was found decides how much it counts. */
function wordScore(word: string, label: string, rest: string): number {
  const at = label.indexOf(word);
  if (at === 0) return 100;
  if (at > 0) return /[\s([{/·:-]/.test(label[at - 1]!) ? 80 : 60;
  return rest.includes(word) ? 20 : 0;
}

/**
 * Entries that contain every word typed (in the label, the hint, the keywords or the section
 * name), best first. A match in the label beats one in the help text; ties keep the order the
 * dialog lists them in.
 */
export function searchSettings(
  entries: readonly SettingEntry[],
  query: string,
  limit = MAX_SETTING_HITS,
): SettingHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: (SettingHit & { order: number })[] = [];
  entries.forEach((entry, order) => {
    const label = fold(entry.label);
    const rest = fold(`${entry.hint ?? ''} ${entry.keywords ?? ''} ${entry.sectionLabel}`);
    let score = 0;
    for (const word of words) {
      const s = wordScore(word, label, rest);
      if (!s) return;
      score += s;
    }
    // A setting ranks above a shortcut with the same match: settings are what was asked for.
    if (entry.command) score -= 5;
    hits.push({ ...entry, score, order });
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, limit).map(({ order: _order, ...hit }) => hit);
}
