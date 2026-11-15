/**
 * AI code review of a unified diff (local changes, a branch or a pull request).
 *
 * Pipeline: parse the diff → show it to one or more models with the NEW line number of every
 * line → parse their JSON findings → keep only findings that point at a line of the diff →
 * merge what several models found → ask a verifier model, finding by finding, whether it is
 * real → drop the false positives. Pure apart from the injected `complete` function, so the
 * desktop app, the `omni review` CLI and the tests share it.
 */
import { scanCodeInText, scanSecretsInText, type SecurityFinding } from './scanners.js';

export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low';
export const REVIEW_SEVERITIES: ReviewSeverity[] = ['critical', 'high', 'medium', 'low'];
const SEV_RANK: Record<ReviewSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export type ReviewCategory = 'bug' | 'security' | 'performance' | 'reliability' | 'maintainability';
const CATEGORIES: ReviewCategory[] = [
  'bug',
  'security',
  'performance',
  'reliability',
  'maintainability',
];

export interface DiffLine {
  kind: '+' | '-' | ' ';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary: boolean;
  hunks: DiffHunk[];
}

export interface ReviewFinding {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  title: string;
  detail: string;
  fix?: string;
  /** Models that reported it ("provider/model"); "scanner" for the security center. */
  models: string[];
  source: 'ai' | 'scanner';
  /** confirmed = the verifier agreed; plausible = not verified, or the verifier was unsure. */
  verdict: 'confirmed' | 'plausible';
  verifyNote?: string;
  /**
   * Stable id of "this kind of problem on this line of code": file + category + the text of
   * the line. Survives line shifts between reviews; used by the ignore list and to not post
   * the same comment twice on a PR.
   */
  fingerprint?: string;
}

export interface ReviewStats {
  files: number;
  reviewedFiles: number;
  skippedFiles: string[];
  raw: number;
  offDiff: number;
  merged: number;
  falsePositives: number;
  /** Findings hidden by the project's ignore list. */
  ignored?: number;
}

/** Project file with review guidance (read by the app, `omni review` and the Action). */
export const REVIEW_GUIDE_FILE = '.zinarix/review.md';
/** Project file with the findings the team decided are not a problem. */
export const REVIEW_IGNORE_FILE = '.zinarix/review-ignore.json';

export interface ReviewIgnoreEntry {
  fingerprint: string;
  file: string;
  title: string;
  reason?: string;
  /** ISO date. */
  at?: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  stats: ReviewStats;
  /** Per-model problems (a model that failed does not sink the review). */
  errors: { model: string; error: string }[];
  models: string[];
  verifier?: string;
  usd: number;
}

export type ReviewComplete = (
  model: string | undefined,
  messages: { role: 'system' | 'user'; content: string }[],
  signal: AbortSignal,
) => Promise<{ text: string; model?: string; usd?: number | null }>;

export interface ReviewOptions {
  /** Reviewer models; undefined entries mean "the default model". At least one is used. */
  models?: (string | undefined)[];
  /** Verifier model (default: the first reviewer). null skips the verification pass. */
  verifier?: string | null;
  /** New content of a file (for context around a finding while verifying). */
  readFile?: (path: string) => Promise<string | undefined>;
  /** Extra guidance (project rules, the PR description…). */
  instructions?: string;
  /** Findings from deterministic scanners, merged in without verification. */
  extra?: ReviewFinding[];
  signal?: AbortSignal;
  onProgress?: (p: ReviewProgress) => void;
  /** Characters of annotated diff per model request (default 60 000). */
  batchChars?: number;
  /** At most this many findings go to the verifier (the rest stay "plausible"). */
  maxVerify?: number;
  /** Fingerprints to hide (the project's ignore list); dropped before verification. */
  ignore?: Iterable<string>;
}

export type ReviewProgress =
  | { phase: 'review'; done: number; total: number }
  | { phase: 'verify'; done: number; total: number }
  | { phase: 'done' };

// ---------------------------------------------------------------------------------------
// Diff parsing

const unquote = (p: string): string => {
  let s = p.trim();
  if (s.startsWith('"') && s.endsWith('"'))
    s = s
      .slice(1, -1)
      .replace(/\\(["\\])/g, '$1')
      .replace(/\\t/g, '\t');
  return s.replace(/^[ab]\//, '');
};

/** Parses `git diff` / `gh pr diff` output. Tolerates CRLF and missing headers. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line);
      file = {
        path: m ? m[2]! : line.slice(11),
        oldPath: m ? m[1] : undefined,
        status: 'modified',
        binary: false,
        hunks: [],
      };
      if (file.oldPath === file.path) file.oldPath = undefined;
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file || !hunk) {
      if (line.startsWith('--- ') && !file) {
        // Diff without a "diff --git" header (plain `diff -u`).
        file = { path: '', status: 'modified', binary: false, hunks: [] };
        files.push(file);
      }
      if (!file) continue;
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from ')) {
        file.oldPath = line.slice(12);
        file.status = 'renamed';
      } else if (line.startsWith('rename to ')) {
        file.path = line.slice(10);
        file.status = 'renamed';
      } else if (/^Binary files .* differ$/.test(line) || line.startsWith('GIT binary patch'))
        file.binary = true;
      else if (line.startsWith('--- ')) {
        const p = line.slice(4).split('\t')[0]!;
        if (p === '/dev/null') file.status = 'added';
        else if (!file.oldPath && !file.path) file.oldPath = unquote(p);
      } else if (line.startsWith('+++ ')) {
        const p = line.slice(4).split('\t')[0]!;
        if (p === '/dev/null') {
          file.status = 'deleted';
          file.path ||= file.oldPath ?? '';
        } else file.path = unquote(p);
      }
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (h) {
      oldNo = Number(h[1]);
      oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      newNo = Number(h[3]);
      newLeft = h[4] === undefined ? 1 : Number(h[4]);
      hunk = { oldStart: oldNo, newStart: newNo, header: h[5]!.trim(), lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const c = line[0];
    if (c === '\\') continue; // "\ No newline at end of file"
    if (oldLeft <= 0 && newLeft <= 0) {
      hunk = undefined; // the header's line counts are used up
      continue;
    }
    if (c === '+' && newLeft > 0) {
      hunk.lines.push({ kind: '+', text: line.slice(1), newLine: newNo++ });
      newLeft--;
    } else if (c === '-' && oldLeft > 0) {
      hunk.lines.push({ kind: '-', text: line.slice(1), oldLine: oldNo++ });
      oldLeft--;
    } else if (c === ' ' || line === '') {
      // An empty line inside a hunk is a context line whose leading space was trimmed.
      hunk.lines.push({ kind: ' ', text: line.slice(1), oldLine: oldNo++, newLine: newNo++ });
      oldLeft--;
      newLeft--;
    } else hunk = undefined;
  }
  return files.filter((f) => f.path);
}

/** Lines of the new file a comment may point at (added or context lines of a hunk). */
export function commentableLines(file: DiffFile): Set<number> {
  const s = new Set<number>();
  for (const h of file.hunks)
    for (const l of h.lines) if (l.newLine !== undefined) s.add(l.newLine);
  return s;
}

export function addedLines(file: DiffFile): Map<number, string> {
  const m = new Map<number, string>();
  for (const h of file.hunks)
    for (const l of h.lines)
      if (l.kind === '+' && l.newLine !== undefined) m.set(l.newLine, l.text);
  return m;
}

const SKIP_FILE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|uv\.lock)$|\.(min\.(js|css)|map|svg|png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|eot|mp[34]|wav|lock)$|(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//i;

/** Lockfiles, build output, minified and binary files are not worth a model's attention. */
export function reviewable(file: DiffFile): boolean {
  return (
    !file.binary && file.status !== 'deleted' && file.hunks.length > 0 && !SKIP_FILE.test(file.path)
  );
}

/**
 * The diff as the model sees it: every line carries its line number in the new file (deleted
 * lines show "-"), so a finding can point at the exact line without counting.
 */
export function annotateFile(file: DiffFile): string {
  const out = [
    `=== FILE: ${file.path}${file.status === 'added' ? ' (new file)' : ''}${file.oldPath ? ` (renamed from ${file.oldPath})` : ''}`,
  ];
  for (const h of file.hunks) {
    out.push(`@@ ${h.header}`.trimEnd());
    for (const l of h.lines) {
      const no = l.newLine !== undefined ? String(l.newLine).padStart(5) : '    -';
      out.push(`${no} ${l.kind} ${l.text}`);
    }
  }
  return out.join('\n');
}

/** Splits the reviewable files into requests of at most `maxChars` (a huge file is cut). */
export function batchFiles(files: DiffFile[], maxChars = 60_000): string[] {
  const batches: string[] = [];
  let cur = '';
  for (const f of files) {
    let text = annotateFile(f);
    if (text.length > maxChars) text = `${text.slice(0, maxChars - 40)}\n… (file cut: too long)`;
    if (cur && cur.length + text.length + 2 > maxChars) {
      batches.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n\n${text}` : text;
  }
  if (cur) batches.push(cur);
  return batches;
}

// ---------------------------------------------------------------------------------------
// Prompts

export const REVIEW_SYSTEM = `You are a meticulous senior code reviewer. You review a diff and report only real defects that the change introduces or exposes: logic errors, off-by-one and boundary mistakes, wrong conditions, null/undefined handling, race conditions, resource leaks, broken error handling, security vulnerabilities (injection, path traversal, missing auth checks, secrets), data loss and clear performance problems.

Rules:
- Each diff line starts with its line number in the NEW file (a "-" means the line was deleted), then "+" (added), "-" (deleted) or a space (unchanged context). Point every finding at the new-file line number of the offending line, copied from that left column.
- Prefer added lines ("+"). Only point at a context line when the bug is there and the change makes it matter.
- Do not report style, naming, formatting, missing comments, missing tests or speculative "might be" issues. No praise. If nothing is wrong, return an empty list.
- Be concrete: say what input breaks it and what happens.

Answer with JSON only, no prose, in this exact shape:
{"findings":[{"file":"path/as/in/the/diff","line":42,"end_line":42,"severity":"critical|high|medium|low","category":"bug|security|performance|reliability|maintainability","title":"short claim","detail":"what breaks and when","fix":"how to fix it","confidence":0.0}]}`;

export const VERIFY_SYSTEM = `You verify one code-review finding. Be skeptical: many findings from automated reviewers are false positives (the code is actually correct, the issue is handled elsewhere in the shown code, or the claim misreads the code). Read the code and decide.

Answer with JSON only:
{"verdict":"real|false_positive|unsure","reason":"one or two sentences","severity":"critical|high|medium|low","line":42}
"line" is the new-file line number of the offending line if the finding points at the wrong one; omit it otherwise.`;

// ---------------------------------------------------------------------------------------
// Parsing model output

/** First JSON object or array in the text (fenced or bare). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const t = c.trim();
    try {
      return JSON.parse(t);
    } catch {
      // try the outermost braces/brackets
    }
    for (const [open, close] of [
      ['{', '}'],
      ['[', ']'],
    ] as const) {
      const a = t.indexOf(open);
      const b = t.lastIndexOf(close);
      if (a >= 0 && b > a)
        try {
          return JSON.parse(t.slice(a, b + 1));
        } catch {
          // keep looking
        }
    }
  }
  return undefined;
}

const SEV_ALIASES: Record<string, ReviewSeverity> = {
  critical: 'critical',
  crítico: 'critical',
  critico: 'critical',
  blocker: 'critical',
  high: 'high',
  alto: 'high',
  major: 'high',
  error: 'high',
  medium: 'medium',
  medio: 'medium',
  moderate: 'medium',
  warning: 'medium',
  low: 'low',
  bajo: 'low',
  minor: 'low',
  info: 'low',
  nit: 'low',
};

export function normalizeSeverity(s: unknown): ReviewSeverity {
  return (
    SEV_ALIASES[
      String(s ?? '')
        .toLowerCase()
        .trim()
    ] ?? 'medium'
  );
}

function normalizeCategory(s: unknown): ReviewCategory {
  const v = String(s ?? '').toLowerCase();
  return (CATEGORIES as string[]).includes(v)
    ? (v as ReviewCategory)
    : v.includes('secur')
      ? 'security'
      : 'bug';
}

export interface RawFinding {
  file: string;
  line: number;
  endLine?: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  title: string;
  detail: string;
  fix?: string;
  confidence?: number;
}

export function parseFindings(text: string): RawFinding[] {
  const j = extractJson(text);
  const list = Array.isArray(j)
    ? j
    : j && typeof j === 'object' && Array.isArray((j as { findings?: unknown }).findings)
      ? (j as { findings: unknown[] }).findings
      : [];
  const out: RawFinding[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const file = String(o.file ?? o.path ?? '').trim();
    const line = Number(o.line ?? o.start_line ?? o.startLine);
    const title = String(o.title ?? o.summary ?? '').trim();
    if (!file || !Number.isFinite(line) || line < 1 || !title) continue;
    const end = Number(o.end_line ?? o.endLine);
    const conf = Number(o.confidence);
    out.push({
      file,
      line: Math.floor(line),
      endLine: Number.isFinite(end) && end >= line ? Math.floor(end) : undefined,
      severity: normalizeSeverity(o.severity),
      category: normalizeCategory(o.category),
      title: title.slice(0, 200),
      detail: String(o.detail ?? o.description ?? o.body ?? '')
        .trim()
        .slice(0, 2000),
      fix:
        o.fix || o.suggestion
          ? String(o.fix ?? o.suggestion)
              .trim()
              .slice(0, 1500)
          : undefined,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Anchoring and merging

function findFile(files: DiffFile[], name: string): DiffFile | undefined {
  const n = name
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^[ab]\//, '');
  return (
    files.find((f) => f.path === n) ??
    files.find((f) => f.path.endsWith(`/${n}`) || n.endsWith(`/${f.path}`))
  );
}

/**
 * Moves a finding onto a line of the diff: the line itself, or the nearest added/context line
 * at most `slack` lines away (models are sometimes off by one). Undefined = not in the diff.
 */
export function anchor(
  files: DiffFile[],
  f: RawFinding,
  slack = 3,
): { file: string; line: number } | undefined {
  const file = findFile(files, f.file);
  if (!file) return undefined;
  const ok = commentableLines(file);
  if (ok.has(f.line)) return { file: file.path, line: f.line };
  const added = addedLines(file);
  let best: number | undefined;
  for (let d = 1; d <= slack && best === undefined; d++)
    for (const c of [f.line - d, f.line + d])
      if (added.has(c)) {
        best = c;
        break;
      }
  for (let d = 1; d <= slack && best === undefined; d++)
    for (const c of [f.line - d, f.line + d])
      if (ok.has(c)) {
        best = c;
        break;
      }
  return best === undefined ? undefined : { file: file.path, line: best };
}

const words = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((w) => w.length > 2),
  );

function similar(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

let seq = 0;
const newId = (): string => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Same line and kind of problem, or lines at most 2 apart with a similar title → one finding. */
export function mergeFindings(list: ReviewFinding[]): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  for (const f of list) {
    const twin = out.find(
      (g) =>
        g.file === f.file &&
        ((g.line === f.line && g.category === f.category) ||
          (Math.abs(g.line - f.line) <= 2 && similar(g.title, f.title) >= 0.25)),
    );
    if (!twin) {
      out.push({ ...f, models: [...f.models] });
      continue;
    }
    for (const m of f.models) if (!twin.models.includes(m)) twin.models.push(m);
    if (SEV_RANK[f.severity] < SEV_RANK[twin.severity]) twin.severity = f.severity;
    if (f.detail.length > twin.detail.length) twin.detail = f.detail;
    twin.fix ??= f.fix;
  }
  return out;
}

export function sortFindings(list: ReviewFinding[]): ReviewFinding[] {
  return [...list].sort(
    (a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
      (a.verdict === b.verdict ? 0 : a.verdict === 'confirmed' ? -1 : 1) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}

// ---------------------------------------------------------------------------------------
// Fingerprints and the ignore list

/** FNV-1a, twice with different seeds: 16 hex chars, plenty for "same finding" checks. */
function hash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Text of a new-file line as the diff shows it (added or context line). */
export function diffLineText(files: DiffFile[], file: string, line: number): string | undefined {
  const f = files.find((x) => x.path === file);
  for (const h of f?.hunks ?? []) for (const l of h.lines) if (l.newLine === line) return l.text;
  return undefined;
}

/**
 * file + category + the code of the line (whitespace collapsed), so the same problem keeps
 * its fingerprint when lines above it move. Without the line text, the title is used.
 */
export function fingerprintOf(f: ReviewFinding, files: DiffFile[]): string {
  const code = diffLineText(files, f.file, f.line)?.trim().replace(/\s+/g, ' ');
  const what = code ? `code:${code}` : `title:${[...words(f.title)].sort().join(' ')}`;
  return hash(`${f.file}\n${f.category}\n${what}`);
}

/** Reads `.zinarix/review-ignore.json` ({"ignore":[…]} or a bare array); bad entries are skipped. */
export function parseIgnoreFile(text: string | undefined): ReviewIgnoreEntry[] {
  if (!text?.trim()) return [];
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(j)
    ? j
    : j && typeof j === 'object' && Array.isArray((j as { ignore?: unknown }).ignore)
      ? (j as { ignore: unknown[] }).ignore
      : [];
  const out: ReviewIgnoreEntry[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const fp = typeof o.fingerprint === 'string' ? o.fingerprint.trim() : '';
    if (!/^[0-9a-f]{16}$/.test(fp)) continue;
    out.push({
      fingerprint: fp,
      file: String(o.file ?? ''),
      title: String(o.title ?? ''),
      reason: typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim() : undefined,
      at: typeof o.at === 'string' ? o.at : undefined,
    });
  }
  return out;
}

/** The ignore file with these findings added (existing entries kept, no duplicates). */
export function addToIgnoreFile(
  text: string | undefined,
  findings: Pick<ReviewFinding, 'fingerprint' | 'file' | 'title'>[],
  reason?: string,
  now = new Date(),
): string {
  const list = parseIgnoreFile(text);
  const have = new Set(list.map((e) => e.fingerprint));
  for (const f of findings) {
    if (!f.fingerprint || have.has(f.fingerprint)) continue;
    have.add(f.fingerprint);
    list.push({
      fingerprint: f.fingerprint,
      file: f.file,
      title: f.title,
      ...(reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}),
      at: now.toISOString().slice(0, 10),
    });
  }
  return `${JSON.stringify({ ignore: list }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------
// Verification

/** The code around a finding: the full new file when known (±40 lines), else its hunks. */
export function findingContext(file: DiffFile | undefined, line: number, content?: string): string {
  if (content !== undefined) {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const from = Math.max(1, line - 40);
    const to = Math.min(lines.length, line + 40);
    const added = file ? addedLines(file) : new Map<number, string>();
    const out: string[] = [];
    for (let i = from; i <= to; i++)
      out.push(`${String(i).padStart(5)} ${added.has(i) ? '+' : ' '} ${lines[i - 1]}`);
    return out.join('\n');
  }
  if (!file) return '';
  const near = file.hunks.filter((h) =>
    h.lines.some((l) => l.newLine !== undefined && Math.abs(l.newLine - line) <= 60),
  );
  return annotateFile({ ...file, hunks: near.length ? near : file.hunks.slice(0, 3) });
}

export function parseVerdict(text: string): {
  verdict: 'real' | 'false_positive' | 'unsure';
  reason: string;
  severity?: ReviewSeverity;
  line?: number;
} {
  const j = extractJson(text) as Record<string, unknown> | undefined;
  const raw = String(j?.verdict ?? '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const verdict =
    raw === 'real' || raw === 'true_positive' || raw === 'confirmed'
      ? 'real'
      : raw.startsWith('false') || raw === 'not_a_bug' || raw === 'invalid'
        ? 'false_positive'
        : 'unsure';
  const line = Number(j?.line);
  return {
    verdict,
    reason: String(j?.reason ?? '')
      .trim()
      .slice(0, 600),
    severity: j?.severity ? normalizeSeverity(j.severity) : undefined,
    line: Number.isFinite(line) && line > 0 ? Math.floor(line) : undefined,
  };
}

async function pool<T>(
  items: T[],
  limit: number,
  fn: (t: T, i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

// ---------------------------------------------------------------------------------------
// The whole review

export async function reviewDiff(
  patch: string | DiffFile[],
  complete: ReviewComplete,
  opts: ReviewOptions = {},
): Promise<ReviewResult> {
  const signal = opts.signal ?? new AbortController().signal;
  const files = typeof patch === 'string' ? parseUnifiedDiff(patch) : patch;
  const todo = files.filter(reviewable);
  const models = opts.models?.length ? [...new Set(opts.models)] : [undefined];
  const batches = batchFiles(todo, opts.batchChars);
  const errors: ReviewResult['errors'] = [];
  const stats: ReviewStats = {
    files: files.length,
    reviewedFiles: todo.length,
    skippedFiles: files.filter((f) => !reviewable(f)).map((f) => f.path),
    raw: 0,
    offDiff: 0,
    merged: 0,
    falsePositives: 0,
  };
  let usd = 0;
  const usedModels = new Set<string>();
  const found: ReviewFinding[] = [];
  const guidance = opts.instructions?.trim()
    ? `\n\nProject guidance (follow it when judging, do not review it):\n${opts.instructions.trim().slice(0, 16_000)}`
    : '';

  const jobs = models.flatMap((m) => batches.map((b) => ({ model: m, batch: b })));
  let done = 0;
  opts.onProgress?.({ phase: 'review', done, total: jobs.length });
  await pool(jobs, 4, async ({ model, batch }) => {
    const label = model ?? 'default';
    try {
      const r = await complete(
        model,
        [
          { role: 'system', content: REVIEW_SYSTEM + guidance },
          { role: 'user', content: `Review this diff.\n\n${batch}` },
        ],
        signal,
      );
      usd += r.usd ?? 0;
      const name = r.model || label;
      usedModels.add(name);
      for (const f of parseFindings(r.text)) {
        stats.raw++;
        const at = anchor(files, f);
        if (!at) {
          stats.offDiff++;
          continue;
        }
        found.push({
          id: newId(),
          file: at.file,
          line: at.line,
          endLine: f.endLine && f.endLine >= at.line ? f.endLine : undefined,
          severity: f.severity,
          category: f.category,
          title: f.title,
          detail: f.detail,
          fix: f.fix,
          models: [name],
          source: 'ai',
          verdict: 'plausible',
        });
      }
    } catch (e) {
      if (signal.aborted) throw e;
      errors.push({ model: label, error: (e as Error).message });
    }
    opts.onProgress?.({ phase: 'review', done: ++done, total: jobs.length });
  });
  if (jobs.length && errors.length === jobs.length)
    throw new Error(`La revisión falló: ${errors[0]!.error}`);

  let merged = mergeFindings(found);
  stats.merged = found.length - merged.length;

  // The project's ignore list goes first, so ignored findings cost no verification.
  const ignore = new Set(opts.ignore ?? []);
  stats.ignored = 0;
  const notIgnored = (list: ReviewFinding[]): ReviewFinding[] =>
    list.filter((f) => {
      f.fingerprint = fingerprintOf(f, files);
      if (!ignore.has(f.fingerprint)) return true;
      stats.ignored!++;
      return false;
    });
  merged = notIgnored(merged);

  const verifier = opts.verifier === null ? null : (opts.verifier ?? models[0]);
  let verifierName: string | undefined;
  if (verifier !== null && merged.length) {
    const queue = sortFindings(merged).slice(0, opts.maxVerify ?? 30);
    const contents = new Map<string, Promise<string | undefined>>();
    const content = (p: string) => {
      if (!opts.readFile) return Promise.resolve(undefined);
      if (!contents.has(p))
        contents.set(
          p,
          opts.readFile(p).catch(() => undefined),
        );
      return contents.get(p)!;
    };
    const dropped = new Set<string>();
    let vdone = 0;
    opts.onProgress?.({ phase: 'verify', done: 0, total: queue.length });
    await pool(queue, 4, async (f) => {
      const file = findFile(files, f.file);
      const ctx = findingContext(file, f.line, await content(f.file));
      try {
        const r = await complete(
          verifier,
          [
            { role: 'system', content: VERIFY_SYSTEM + guidance },
            {
              role: 'user',
              content: `Finding (${f.severity}, ${f.category}) at ${f.file}:${f.line}\nTitle: ${f.title}\nDetail: ${f.detail}${f.fix ? `\nSuggested fix: ${f.fix}` : ''}\n\nCode (line number in the new file, "+" = added by this change):\n${ctx}`,
            },
          ],
          signal,
        );
        usd += r.usd ?? 0;
        verifierName ??= r.model || verifier || 'default';
        const v = parseVerdict(r.text);
        if (v.verdict === 'false_positive') {
          dropped.add(f.id);
          stats.falsePositives++;
        } else {
          f.verdict = v.verdict === 'real' ? 'confirmed' : 'plausible';
          f.verifyNote = v.reason || undefined;
          if (v.severity) f.severity = v.severity;
          if (v.line && v.line !== f.line && file && commentableLines(file).has(v.line))
            f.line = v.line;
        }
      } catch (e) {
        if (signal.aborted) throw e;
        // The verifier failed: the finding stays, unverified.
      }
      opts.onProgress?.({ phase: 'verify', done: ++vdone, total: queue.length });
    });
    // The verifier may have moved a finding to another line: fingerprint it again.
    merged = notIgnored(merged.filter((f) => !dropped.has(f.id)));
  }

  const all = mergeFindings([...merged, ...notIgnored((opts.extra ?? []).map((f) => ({ ...f })))]);
  opts.onProgress?.({ phase: 'done' });
  return {
    findings: sortFindings(all),
    stats,
    errors,
    models: [...usedModels],
    verifier: verifierName,
    usd,
  };
}

// ---------------------------------------------------------------------------------------
// Output

const LABELS = {
  es: {
    critical: 'Crítico',
    high: 'Alto',
    medium: 'Medio',
    low: 'Bajo',
    title: 'Revisión de código de Zinarix',
    none: 'Sin hallazgos.',
    fix: 'Solución',
    confirmed: 'verificado',
    plausible: 'sin verificar',
    summary: (n: number, f: number) => `${n} hallazgos en ${f} archivos revisados`,
    outside: 'Hallazgos fuera de las líneas del diff',
  },
  en: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    title: 'Zinarix code review',
    none: 'No findings.',
    fix: 'Fix',
    confirmed: 'verified',
    plausible: 'unverified',
    summary: (n: number, f: number) => `${n} findings in ${f} reviewed files`,
    outside: 'Findings outside the diff lines',
  },
};

const ICON: Record<ReviewSeverity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
};

export function findingBody(f: ReviewFinding, lang: 'es' | 'en' = 'es'): string {
  const L = LABELS[lang];
  const parts = [
    `${ICON[f.severity]} **${L[f.severity]} · ${f.category}** — ${f.title}`,
    f.detail,
    f.fix ? `**${L.fix}:** ${f.fix}` : '',
    `<sub>${f.source === 'scanner' ? 'scanner' : `${f.models.join(', ')} · ${L[f.verdict]}`}</sub>`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function reviewMarkdown(r: ReviewResult, lang: 'es' | 'en' = 'es'): string {
  const L = LABELS[lang];
  const out = [`## ${L.title}`, '', L.summary(r.findings.length, r.stats.reviewedFiles), ''];
  if (!r.findings.length) out.push(L.none);
  for (const f of r.findings) out.push(`### \`${f.file}:${f.line}\``, '', findingBody(f, lang), '');
  return out.join('\n').trim() + '\n';
}

export function reviewText(r: ReviewResult, lang: 'es' | 'en' = 'es'): string {
  const L = LABELS[lang];
  const out = [L.summary(r.findings.length, r.stats.reviewedFiles)];
  for (const f of r.findings) {
    out.push(
      '',
      `[${L[f.severity].toUpperCase()}] ${f.file}:${f.line} — ${f.title} (${f.source === 'scanner' ? 'scanner' : L[f.verdict]})`,
    );
    if (f.detail) out.push(`    ${f.detail.replace(/\n/g, '\n    ')}`);
    if (f.fix) out.push(`    ${L.fix}: ${f.fix.replace(/\n/g, '\n    ')}`);
  }
  for (const e of r.errors) out.push('', `! ${e.model}: ${e.error}`);
  return out.join('\n');
}

export interface GithubReview {
  body: string;
  comments: {
    path: string;
    line: number;
    side: 'RIGHT';
    /** First line of a multi-line comment. */
    start_line?: number;
    start_side?: 'RIGHT';
    body: string;
  }[];
  /** Selected findings left out because the PR already has them (posted earlier). */
  skipped: number;
}

/** Hidden marker at the end of every posted comment, so a later review does not repeat it. */
const marker = (fp: string) => `<!-- zinarix-review:${fp} -->`;

/** Fingerprints already posted on a PR, from the bodies of its review comments and reviews. */
export function postedFingerprints(bodies: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const b of bodies)
    for (const m of (b ?? '').matchAll(/<!-- zinarix-review:([0-9a-f]{16}) -->/g)) out.add(m[1]!);
  return out;
}

/** Range of a multi-line comment when every line of it is on the diff (GitHub requires it). */
function commentRange(file: DiffFile, f: ReviewFinding): { start: number; end: number } {
  const ok = commentableLines(file);
  if (!f.endLine || f.endLine <= f.line || f.endLine - f.line > 30)
    return { start: f.line, end: f.line };
  for (let n = f.line; n <= f.endLine; n++) if (!ok.has(n)) return { start: f.line, end: f.line };
  const hunk = file.hunks.find((h) => h.lines.some((l) => l.newLine === f.line));
  if (!hunk?.lines.some((l) => l.newLine === f.endLine)) return { start: f.line, end: f.line };
  return { start: f.line, end: f.endLine };
}

/**
 * One PR review: inline comments on diff lines, the rest listed in the body. Findings whose
 * fingerprint is in `posted` (already on the PR) are skipped.
 */
export function githubReview(
  r: ReviewResult,
  files: DiffFile[],
  selected?: Set<string>,
  lang: 'es' | 'en' = 'es',
  posted?: Set<string>,
): GithubReview {
  const L = LABELS[lang];
  const chosen = r.findings.filter((f) => !selected || selected.has(f.id));
  const list = chosen.filter((f) => !f.fingerprint || !posted?.has(f.fingerprint));
  const comments: GithubReview['comments'] = [];
  const outside: ReviewFinding[] = [];
  for (const f of list) {
    const file = files.find((x) => x.path === f.file);
    const body = findingBody(f, lang) + (f.fingerprint ? `\n\n${marker(f.fingerprint)}` : '');
    if (file && commentableLines(file).has(f.line)) {
      const { start, end } = commentRange(file, f);
      comments.push({
        path: f.file,
        line: end,
        side: 'RIGHT',
        ...(start !== end ? { start_line: start, start_side: 'RIGHT' as const } : {}),
        body,
      });
    } else outside.push(f);
  }
  const body = [
    `## ${L.title}`,
    '',
    list.length ? L.summary(list.length, r.stats.reviewedFiles) : L.none,
    ...(outside.length
      ? [
          '',
          `### ${L.outside}`,
          ...outside.map(
            (f) =>
              `- \`${f.file}:${f.line}\` ${findingBody(f, lang).split('\n')[0]}${f.fingerprint ? ` ${marker(f.fingerprint)}` : ''}`,
          ),
        ]
      : []),
  ].join('\n');
  return { body, comments, skipped: chosen.length - list.length };
}

// ---------------------------------------------------------------------------------------
// Security scanners on the added lines (secrets, insecure code)

const SCAN_SEV: Record<SecurityFinding['severity'], ReviewSeverity> = {
  crítico: 'critical',
  alto: 'high',
  medio: 'medium',
  bajo: 'low',
};

/** A security center finding as a review finding (already "confirmed": it is deterministic). */
export function fromSecurityFinding(s: SecurityFinding, file: string, line: number): ReviewFinding {
  return {
    id: `s${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    file,
    line,
    severity: SCAN_SEV[s.severity],
    category: 'security',
    title: s.title,
    detail: [s.category, s.detail].filter(Boolean).join(': '),
    fix: s.fix,
    models: ['scanner'],
    source: 'scanner',
    verdict: 'confirmed',
  };
}

/**
 * The added lines of a file at their real line numbers (everything else blank), so the
 * scanners only report what the change brings and point at the right line.
 */
export function addedOnlyText(file: DiffFile): string {
  const added = addedLines(file);
  const max = Math.max(0, ...added.keys());
  const out: string[] = new Array<string>(max).fill('');
  for (const [n, t] of added) out[n - 1] = t;
  return out.join('\n');
}

/** Secrets and insecure code on the lines a change adds. */
export function scanAddedLines(files: DiffFile[]): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  for (const f of files) {
    if (f.binary || f.status === 'deleted' || !f.hunks.length) continue;
    const text = addedOnlyText(f);
    for (const s of [...scanSecretsInText(f.path, text), ...scanCodeInText(f.path, text)]) {
      const line = Number(/:(\d+)$/.exec(s.where ?? '')?.[1] ?? 0);
      if (line) out.push(fromSecurityFinding(s, f.path, line));
    }
  }
  return out;
}

/**
 * Review guidance of a project for tools without the app's rule system (the CLI, the
 * Action): `.zinarix/review.md` (review-only guidance) and the root AGENTS.md (or CLAUDE.md).
 */
export async function projectReviewGuidance(
  read: (path: string) => Promise<string | undefined>,
): Promise<string> {
  const parts: string[] = [];
  const guide = (await read(REVIEW_GUIDE_FILE))?.trim();
  if (guide) parts.push(`Review guidance (${REVIEW_GUIDE_FILE}):\n${guide.slice(0, 6000)}`);
  const agents = (await read('AGENTS.md'))?.trim() || (await read('CLAUDE.md'))?.trim();
  if (agents) parts.push(`Project rules (AGENTS.md):\n${agents.slice(0, 6000)}`);
  return parts.join('\n\n');
}

/** True when a finding is at least as serious as `min` (for `--fail-on`). */
export function atLeast(sev: ReviewSeverity, min: ReviewSeverity): boolean {
  return SEV_RANK[sev] <= SEV_RANK[min];
}
