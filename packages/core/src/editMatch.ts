/**
 * The text replacement behind the agent's edit_file tool (desktop and headless share it).
 *
 * Models often copy a block almost right: LF where the file has CRLF, spaces where it has
 * tabs, one indentation level off, trailing spaces dropped. Refusing those costs a model turn
 * each time, so after the exact match fails two tolerant matches are tried, and the new text is
 * written in the file's own line endings and indentation:
 *
 *   1. exact
 *   2. same text with the file's line endings
 *   3. same lines ignoring indentation and trailing whitespace (must match exactly one place)
 */

export type EditHow = 'exact' | 'line-endings' | 'whitespace';

export type EditResult =
  { ok: true; text: string; count: number; how: EditHow } | { ok: false; error: string };

export interface EditOptions {
  /** Replace every exact occurrence instead of requiring a single one. */
  replaceAll?: boolean;
}

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

/** The line ending the file uses (the most common one); LF when it has no line breaks. */
export function dominantEol(text: string): '\r\n' | '\n' {
  const crlf = countOf(text, '\r\n');
  const lf = countOf(text, '\n') - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

const toEol = (s: string, eol: string): string => s.replace(/\r\n|\n/g, eol);

function replaceExact(
  text: string,
  oldS: string,
  newS: string,
  opts: EditOptions,
  how: EditHow,
): EditResult | null {
  const count = countOf(text, oldS);
  if (count === 0) return null;
  if (count > 1 && !opts.replaceAll)
    return {
      ok: false,
      error: `old_string appears ${count} times; include more surrounding lines to make it unique.`,
    };
  return {
    ok: true,
    text: opts.replaceAll ? text.split(oldS).join(newS) : text.replace(oldS, () => newS),
    count,
    how,
  };
}

const indentOf = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? '';
/** Width of an indentation where a tab counts as `unit` columns. */
const widthOf = (indent: string, unit: number): number =>
  [...indent].reduce((n, ch) => n + (ch === '\t' ? unit : 1), 0);

/** Smallest step between the indentation widths of these lines (2 when they are all level). */
function indentUnit(lines: string[]): number {
  const widths = [
    ...new Set(lines.filter((l) => l.trim()).map((l) => widthOf(indentOf(l), 1))),
  ].sort((a, b) => a - b);
  let unit = 0;
  for (let i = 1; i < widths.length; i++) {
    const step = widths[i]! - widths[i - 1]!;
    if (step > 0 && (unit === 0 || step < unit)) unit = step;
  }
  if (unit === 0 && widths.length && widths[0]! > 0) unit = widths[0]!;
  return unit || 2;
}

function replaceLoose(text: string, oldS: string, newS: string): EditResult | null {
  const eol = dominantEol(text);
  const fileLines = text.split(/\r\n|\n/);
  const oldLines = oldS.split(/\r\n|\n/);
  // A trailing line break in old_string is not a line to match.
  if (oldLines.length > 1 && oldLines.at(-1) === '') oldLines.pop();
  const wanted = oldLines.map((l) => l.trim());
  if (!wanted.some(Boolean)) return null;

  const hits: number[] = [];
  for (let i = 0; i + wanted.length <= fileLines.length; i++) {
    let same = true;
    for (let j = 0; j < wanted.length; j++) {
      if (fileLines[i + j]!.trim() !== wanted[j]) {
        same = false;
        break;
      }
    }
    if (same) hits.push(i);
  }
  if (hits.length === 0) return null;
  if (hits.length > 1)
    return {
      ok: false,
      error: `old_string matches ${hits.length} places when indentation is ignored; include more surrounding lines to make it unique.`,
    };

  const at = hits[0]!;
  const region = fileLines.slice(at, at + wanted.length);
  const newLines = newS.split(/\r\n|\n/);
  const endsWithBreak = newLines.length > 1 && newLines.at(-1) === '';
  if (endsWithBreak) newLines.pop();

  // Map the model's indentation to the file's: the first non-blank line pairs the two bases,
  // and deeper or shallower lines move by whole levels in the file's own unit.
  const first = oldLines.findIndex((l) => l.trim());
  const modelBase = indentOf(oldLines[first]!);
  const fileBase = indentOf(region[first]!);
  const modelUnit = indentUnit([...oldLines, ...newLines]);
  const fileTabs = region.some((l) => indentOf(l).includes('\t')) || fileBase.includes('\t');
  const fileUnit = fileTabs ? '\t' : ' '.repeat(indentUnit(region) || modelUnit);
  const baseWidth = widthOf(modelBase, modelUnit);
  const reindent = (line: string): string => {
    if (!line.trim()) return '';
    const levels = (widthOf(indentOf(line), modelUnit) - baseWidth) / modelUnit;
    const body = line.slice(indentOf(line).length);
    if (!Number.isInteger(levels)) return fileBase + body;
    if (levels >= 0) return fileBase + fileUnit.repeat(levels) + body;
    const cut = Math.min(fileBase.length, -levels * fileUnit.length);
    return fileBase.slice(0, fileBase.length - cut) + body;
  };

  // Offsets of the matched lines in the original text, so everything around them (and its
  // line endings) stays byte for byte.
  const starts: number[] = [0];
  const breakRe = /\r\n|\n/g;
  const breakLens: number[] = [];
  for (let m = breakRe.exec(text); m; m = breakRe.exec(text)) {
    starts.push(m.index + m[0].length);
    breakLens.push(m[0].length);
  }
  const last = at + wanted.length - 1;
  const from = starts[at]!;
  let to = starts[last]! + fileLines[last]!.length;
  const followingBreak = breakLens[last] ?? 0;
  const oldHadBreak = oldS.endsWith('\n');
  let insert = newLines.map(reindent).join(eol);
  if (newS === '' || (oldHadBreak && !endsWithBreak)) to += followingBreak;
  else if (endsWithBreak && !oldHadBreak) insert += eol;
  const out = text.slice(0, from) + insert + text.slice(to);
  return { ok: true, text: out, count: 1, how: 'whitespace' };
}

/** Replaces `oldS` with `newS` in `text`. Never guesses between several candidate places. */
export function applyEdit(
  text: string,
  oldS: string,
  newS: string,
  opts: EditOptions = {},
): EditResult {
  if (!oldS) return { ok: false, error: 'old_string is required.' };
  const exact = replaceExact(text, oldS, newS, opts, 'exact');
  if (exact) return exact;

  const eol = dominantEol(text);
  const oldEol = toEol(oldS, eol);
  if (oldEol !== oldS) {
    const fixed = replaceExact(text, oldEol, toEol(newS, eol), opts, 'line-endings');
    if (fixed) return fixed;
  }

  if (!opts.replaceAll) {
    const loose = replaceLoose(text, oldS, newS);
    if (loose) return loose;
  }
  return {
    ok: false,
    error: 'old_string was not found in the file. Read the file again and copy the exact text.',
  };
}

/** What to tell the model when the match was not exact, so it learns what the file really has. */
export function editNote(how: EditHow): string {
  if (how === 'line-endings') return "; matched with the file's line endings, which were kept";
  if (how === 'whitespace')
    return "; matched ignoring indentation, and written with the file's own indentation";
  return '';
}

/** One replacement of a multi-edit call. */
export interface EditStep {
  oldS: string;
  newS: string;
  replaceAll?: boolean;
}

/**
 * The replacements an edit_file call asks for: the `edits` list when it is there (several
 * changes to one file in a single call), else the one old_string / new_string pair.
 * A string is the mistake to tell the model.
 */
export function editSteps(a: Record<string, unknown>): EditStep[] | string {
  const step = (v: Record<string, unknown>, where: string): EditStep | string => {
    if (typeof v.old_string !== 'string' || !v.old_string)
      return `${where}old_string is required (use write_file to create a file).`;
    if (typeof v.new_string !== 'string') return `${where}new_string is required.`;
    return { oldS: v.old_string, newS: v.new_string, replaceAll: v.replace_all === true };
  };
  if (a.edits === undefined || a.edits === null) {
    const one = step(a, '');
    return typeof one === 'string' ? one : [one];
  }
  if (!Array.isArray(a.edits) || !a.edits.length)
    return 'edits must be a non-empty list of { old_string, new_string }.';
  const out: EditStep[] = [];
  for (const [i, v] of a.edits.entries()) {
    if (!v || typeof v !== 'object') return `edits[${i}] must be { old_string, new_string }.`;
    const one = step(v as Record<string, unknown>, `edits[${i}]: `);
    if (typeof one === 'string') return one;
    out.push(one);
  }
  return out;
}

const HOW_RANK: Record<EditHow, number> = { exact: 0, 'line-endings': 1, whitespace: 2 };

/**
 * Applies the steps in order, each on the result of the one before. All or nothing: when one
 * does not apply, nothing is changed and the error says which one.
 */
export function applyEdits(text: string, steps: EditStep[]): EditResult {
  let out = text;
  let count = 0;
  let how: EditHow = 'exact';
  for (const [i, s] of steps.entries()) {
    const r = applyEdit(out, s.oldS, s.newS, { replaceAll: s.replaceAll });
    if (!r.ok)
      return steps.length > 1
        ? { ok: false, error: `edits[${i}] did not apply, so nothing was changed: ${r.error}` }
        : r;
    out = r.text;
    count += r.count;
    if (HOW_RANK[r.how] > HOW_RANK[how]) how = r.how;
  }
  return { ok: true, text: out, count, how };
}
