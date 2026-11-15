/**
 * Fase 8 — .gitignore / .zinarixignore rules for the code index (pure). Follows git's rules:
 * "#" comments, "!" re-includes, a trailing "/" matches only folders, a "/" at the start or in
 * the middle anchors the pattern to the ignore file's folder, otherwise it matches at any
 * depth; "*", "?", "**" and [classes]. Last matching rule wins, and a file inside an ignored
 * folder stays ignored (git cannot re-include it either).
 */

export interface IgnoreRule {
  /** Folder of the ignore file ('' = project root), "/"-separated. */
  base: string;
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globBody(p: string): string {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        const before = i === 0 || p[i - 1] === '/';
        const after = p[i + 2] === '/' || i + 2 === p.length;
        if (before && after) {
          i += 2; // consume "**" and the "/" after it (if any)
          re += i >= p.length ? '.*' : '(?:.*/)?';
          continue;
        }
      }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const close = p.indexOf(']', i + 2);
      if (close < 0) re += '\\[';
      else {
        let cls = p.slice(i + 1, close).replace(/\\/g, '\\\\');
        if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
        re += `[${cls}]`;
        i = close;
      }
    } else if (c === '\\' && i + 1 < p.length) {
      re += p[++i]!.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return re;
}

/** Rules of one ignore file whose folder is `base` ("" for the root). */
export function parseIgnore(text: string, base = ''): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const b = base.replace(/^\/+|\/+$/g, '');
  for (let line of text.replace(/\r\n/g, '\n').split('\n')) {
    // trailing spaces are ignored unless escaped
    line = line.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1);
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.replace(/\/+$/, '');
    }
    if (!line) continue;
    const anchored = line.includes('/');
    line = line.replace(/^\/+/, '');
    const body = globBody(line);
    const re = new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`, 'i');
    rules.push({ base: b, re, negate, dirOnly });
  }
  return rules;
}

function relTo(base: string, path: string): string | null {
  if (!base) return path;
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
}

/** Last rule matching `path` decides: true = ignored, false = re-included, undefined = no rule. */
function decide(rules: IgnoreRule[], path: string, isDir: boolean): boolean | undefined {
  let out: boolean | undefined;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    const rel = relTo(r.base, path);
    if (rel === null || !r.re.test(rel)) continue;
    out = !r.negate;
  }
  return out;
}

/** True when a project file ("src/a.ts") is ignored by the rules (its folders are checked too). */
export function isIgnored(path: string, rules: IgnoreRule[]): boolean {
  if (!rules.length) return false;
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++)
    if (decide(rules, parts.slice(0, i).join('/'), true)) return true;
  return decide(rules, path, false) ?? false;
}

/**
 * Ignore files that matter, in the order their rules apply: every .gitignore from the root
 * down (deeper ones win), and the root .zinarixignore last (it has the final word).
 */
export function ignoreFilesIn(files: string[]): string[] {
  const git = files
    .filter((p) => /(^|\/)\.gitignore$/.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return [...new Set(['.gitignore', ...git, '.zinarixignore'])];
}

/** Folder of an ignore file ("pkg/.gitignore" → "pkg"). */
export function ignoreBase(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '' : file.slice(0, i);
}
