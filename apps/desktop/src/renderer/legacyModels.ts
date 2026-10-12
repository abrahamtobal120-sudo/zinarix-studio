/**
 * Live model lists keep years of history: dated snapshots of every alias
 * (gpt-4o-2024-05-13 next to gpt-4o) and previous generations. The picker hides them
 * by default so the current models are easy to find; "Show older models" brings them back.
 */

/** Trailing release date: -2024-05-13, -20250514 or -0125. */
const SNAPSHOT = /^(.+?)-(?:\d{4}-\d{2}-\d{2}|20\d{6}|\d{4})$/;

/** Previous generations that providers still list but have newer replacements. */
const OLD_GENERATIONS = [
  /^gpt-3\.5/,
  /^gpt-4(-|$)/,
  /^gpt-4-turbo/,
  /^gpt-4o/,
  /^chatgpt-4o/,
  /^gpt-4\.1/,
  /^gpt-4\.5/,
  /^o1(-|$)/,
  /^o3-mini/,
  /^text-/,
  /^gemini-1\./,
  /^gemini-2\.0/,
  /^gemini-pro/,
  /^claude-(instant|2|3)/,
  /^llama-?2/,
  /^llama-?3(-|\.0|$)/,
  /^mixtral-8x7b/,
  /^qwen-?(1\.5|2)(-|$)/,
  /^deepseek-(coder|v2)/,
];

/** The model id without provider prefixes (models/…, accounts/…/models/…, org/…). */
function bare(id: string): string {
  return id.toLowerCase().split('/').pop() ?? id.toLowerCase();
}

/** Ids of one provider's models, for snapshot detection. */
export function siblingIds(ids: Iterable<string>): Set<string> {
  return new Set([...ids].map(bare));
}

export function isLegacyModel(id: string, siblings: Set<string>): boolean {
  const s = bare(id);
  const snap = SNAPSHOT.exec(s);
  if (snap && siblings.has(snap[1]!)) return true;
  return OLD_GENERATIONS.some((r) => r.test(s));
}
