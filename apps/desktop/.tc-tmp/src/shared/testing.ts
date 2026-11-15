/**
 * Test Explorer model (pure, no I/O): finds tests in source files, builds the filter that runs
 * one of them, and reads the results of Vitest / Jest (JSON reporter) and Pytest (JUnit XML).
 */

export type TestFramework = 'vitest' | 'jest' | 'pytest';

export type TestStatus = 'passed' | 'failed' | 'skipped';

/** A test or a group (describe / class) found by reading the file. */
export interface TestItem {
  /** `${file}::${fullName}`. */
  id: string;
  /** Workspace-relative path, with "/". */
  file: string;
  /** Own title ("adds numbers"). */
  name: string;
  /**
   * Name the runner reports and filters by: describe titles + title joined by " " (Vitest,
   * Jest), or "Class::test" (Pytest).
   */
  fullName: string;
  kind: 'suite' | 'test';
  /** 1-based line of the call / def. */
  line: number;
  /** Uses a template (`it.each`, "%s", "$name"): the reported names differ from the title. */
  dynamic?: boolean;
}

export interface TestResult {
  file: string;
  /** '' = the file itself (it failed to load, or a pytest collection error). */
  fullName: string;
  status: TestStatus;
  durationMs?: number;
  /** First failure message (trimmed). */
  message?: string;
  line?: number;
  /** Line of the test file where it failed (from the error's stack), when known. */
  failLine?: number;
}

export interface TestRunSummary {
  framework: TestFramework;
  /** Folder the runner ran in (workspace-relative, '' = root). */
  cwd: string;
  results: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  /** ms since epoch. */
  finishedAt: number;
  durationMs: number;
  /** The run itself broke (runner missing, crashed before reporting…). */
  error?: string;
}

/** A folder where one runner runs a group of test files. */
export interface TestProject {
  framework: TestFramework;
  /** Workspace-relative folder the runner runs in ('' = root). */
  cwd: string;
  files: string[];
  /** Why it cannot run (runner not installed…); undefined = ready. */
  problem?: string;
}

export interface TestDiscovery {
  projects: TestProject[];
  items: TestItem[];
}

export type TestTarget = Pick<TestItem, 'file' | 'fullName' | 'kind' | 'dynamic'>;

/**
 * What to run: a project, optionally only some files, optionally one item (or several, e.g.
 * "rerun the failed ones"), or the tests related to some changed source files (Vitest / Jest).
 */
export interface TestRunRequest {
  framework: TestFramework;
  cwd: string;
  files?: string[];
  item?: TestTarget;
  items?: TestTarget[];
  /** Source files that changed: runs the tests that import them (`vitest related`). */
  related?: string[];
}

/** The items a request names (`item` and `items` together). */
export function targetsOf(req: TestRunRequest): TestTarget[] {
  return [...(req.item ? [req.item] : []), ...(req.items ?? [])];
}

export type TestEvent =
  | { kind: 'state'; running: boolean; label?: string }
  | { kind: 'output'; text: string }
  | { kind: 'done'; summary: TestRunSummary; merged: TestRunSummary };

// ---------------- which files are tests ----------------

const JS_TEST = /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/;
const JS_IN_TESTS_DIR = /(^|\/)__tests__\/[^/]+\.[cm]?[jt]sx?$/;
const PY_TEST = /(^|\/)(test_[^/]*|[^/]+_test)\.py$/;

export function isJsTestFile(path: string): boolean {
  return JS_TEST.test(path) || JS_IN_TESTS_DIR.test(path);
}

export function isPyTestFile(path: string): boolean {
  return PY_TEST.test(path);
}

// ---------------- reading JS / TS test files ----------------

/**
 * Brace depth at each character, and whether it is code (not inside a string, template or
 * comment). Regex literals are not recognised: good enough for test files.
 */
function scan(text: string): { depth: Int32Array; code: Uint8Array } {
  const depth = new Int32Array(text.length + 1);
  const code = new Uint8Array(text.length + 1);
  let d = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const n = text[i + 1];
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') depth[i++] = d;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      while (i < stop) depth[i++] = d;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      depth[i] = d;
      code[i] = 1; // the opening quote: where a title argument starts
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') depth[i++] = d;
        if (c !== '`' && text[i] === '\n') break; // unterminated string
        depth[i++] = d;
      }
      depth[i] = d;
      i++;
      continue;
    }
    if (c === '{') d++;
    depth[i] = c === '}' ? d - 1 : d;
    code[i] = 1;
    if (c === '}') d = Math.max(0, d - 1);
    i++;
  }
  depth[text.length] = d;
  return { depth, code };
}

const CALL =
  /\b(describe|suite|context|it|test|bench)((?:\.(?:only|skip|todo|concurrent|sequential|fails|skipIf\([^)]*\)|runIf\([^)]*\)))*)(\.each\s*(?:\([^)]*\)|`[^`]*`))?\s*\(\s*(['"`])((?:\\.|(?!\4)[^\\])*)\4/g;

const TEMPLATE_NAME = /%[sdifjoOp#%]|\$[\w.]+|\$\{/;

function unescape(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

/** Tests and describe blocks of a JS / TS test file, with their nesting. */
export function parseJsTests(file: string, text: string): TestItem[] {
  const { depth, code } = scan(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const out: TestItem[] = [];
  const stack: { name: string; depth: number; dynamic: boolean }[] = [];
  for (const m of text.matchAll(CALL)) {
    const at = m.index;
    if (!code[at]) continue; // inside a comment or a string
    const prev = text[at - 1];
    if (prev === '.' || (prev && /[\w$]/.test(prev))) continue; // foo.it(…), myit(…)
    const d = depth[at]!;
    while (stack.length && stack[stack.length - 1]!.depth >= d) stack.pop();
    const fn = m[1]!;
    const name = unescape(m[5]!);
    const dynamic =
      Boolean(m[3]) || (m[4] === '`' && name.includes('${')) || TEMPLATE_NAME.test(name);
    const parents = stack.map((s) => s.name);
    const fullName = [...parents, name].join(' ');
    const suite = fn === 'describe' || fn === 'suite' || fn === 'context';
    out.push({
      id: `${file}::${fullName}`,
      file,
      name,
      fullName,
      kind: suite ? 'suite' : 'test',
      line: lineOf(at),
      ...(dynamic || stack.some((s) => s.dynamic) ? { dynamic: true } : {}),
    });
    if (suite) stack.push({ name, depth: d, dynamic });
  }
  return out;
}

// ---------------- reading Python test files ----------------

/** `test_*` functions and `Test*` classes (with their methods) of a pytest file. */
export function parsePyTests(file: string, text: string): TestItem[] {
  const out: TestItem[] = [];
  const stack: { name: string; indent: number }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const m = /^(\s*)(?:async\s+)?(def|class)\s+(\w+)/.exec(raw);
    if (!m) return;
    const indent = m[1]!.replace(/\t/g, '    ').length;
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const [, , kw, name] = m as unknown as [string, string, string, string];
    const inClass = stack.length > 0;
    if (kw === 'class') {
      // Only Test* classes (at module level or nested in another Test* class) hold tests.
      if (!/^Test/.test(name) || (indent > 0 && !inClass)) {
        stack.push({ name: '', indent }); // a non-test class: hides what is inside it
        return;
      }
      if (stack.some((s) => !s.name)) return;
      const fullName = [...stack.map((s) => s.name), name].join('::');
      out.push({ id: `${file}::${fullName}`, file, name, fullName, kind: 'suite', line: i + 1 });
      stack.push({ name, indent });
      return;
    }
    // Functions inside a function or a non-test class are not collected.
    if (/^test/.test(name) && !stack.some((s) => !s.name) && (indent === 0 || inClass)) {
      const fullName = [...stack.map((s) => s.name), name].join('::');
      out.push({ id: `${file}::${fullName}`, file, name, fullName, kind: 'test', line: i + 1 });
    }
    stack.push({ name: '', indent }); // hides whatever is defined inside this function
  });
  return out;
}

export function parseTests(file: string, text: string): TestItem[] {
  if (isPyTestFile(file)) return parsePyTests(file, text);
  if (isJsTestFile(file)) return parseJsTests(file, text);
  return [];
}

// ---------------- running one test ----------------

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/g;

/**
 * The `-t` pattern (Vitest, Jest) that runs an item: anchored at the start, and for a test also
 * at the end, so "adds" does not also run "adds twice". Template parts become ".*".
 */
export function namePattern(item: Pick<TestItem, 'fullName' | 'kind' | 'dynamic'>): string {
  let p = item.fullName.replace(REGEX_SPECIAL, '\\$&');
  if (item.dynamic)
    p = p.replace(/%[sdifjoOp#]|\\\$\\\{[^}]*\\\}|\\\$[\w.]+/g, '.*').replace(/%%/g, '%');
  return item.kind === 'test' ? `^${p}$` : `^${p}( |$)`;
}

/** One `-t` pattern for several items (any of them). */
export function namesPattern(items: Pick<TestItem, 'fullName' | 'kind' | 'dynamic'>[]): string {
  if (items.length === 1) return namePattern(items[0]!);
  return items.map((i) => `(?:${namePattern(i)})`).join('|');
}

/** pytest node id ("tests/test_x.py::TestA::test_b"), relative to the folder pytest runs in. */
export function pytestNodeId(file: string, fullName: string, cwd = ''): string {
  const rel = cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file;
  return fullName ? `${rel}::${fullName}` : rel;
}

// ---------------- reading results ----------------

const MESSAGE_MAX = 4000;

/** Removes ANSI colours and trims a failure message. */
export function cleanMessage(s: string): string {
  const plain = s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
  return plain.length > MESSAGE_MAX ? `${plain.slice(0, MESSAGE_MAX)}…` : plain;
}

const FRAME =
  /(?:file:\/\/\/?)?((?:[A-Za-z]:)?[^\s()'"<>|]*?\.(?:[cm]?[jt]sx?|py)):(\d+)(?::\d+)?/g;

/**
 * Line of `file` where a test failed, read from its error: the first stack frame inside the
 * file (JS: the assertion is on top) or the last one (pytest prints the traceback top-down).
 * Paths may be absolute, relative to the workspace or to the folder the runner ran in.
 */
export function failureLine(
  message: string,
  file: string,
  root: string,
  cwd = '',
): number | undefined {
  const lines: number[] = [];
  for (const m of message.matchAll(FRAME)) {
    const raw = m[1]!.replace(/\\/g, '/');
    const abs = /^([A-Za-z]:)?\//.test(raw);
    const rel = abs ? relativeTo(root, raw) : raw.replace(/^\.\//, '');
    const hit = rel === file || (!abs && cwd !== '' && `${cwd}/${rel}` === file);
    if (hit) lines.push(Number(m[2]));
  }
  if (!lines.length) return undefined;
  return file.endsWith('.py') ? lines[lines.length - 1] : lines[0];
}

function statusOf(s: unknown): TestStatus {
  if (s === 'passed') return 'passed';
  if (s === 'failed') return 'failed';
  return 'skipped'; // pending, skipped, todo, disabled
}

/** "C:\\repo\\a\\b.ts" or "/repo/a/b.ts" → "a/b.ts" when inside root (else the path as is). */
export function relativeTo(root: string, abs: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const a = norm(abs);
  const ci = /^[A-Za-z]:\//.test(r); // Windows paths: compare without case
  const prefix = `${r}/`;
  if ((ci ? a.toLowerCase() : a).startsWith(ci ? prefix.toLowerCase() : prefix))
    return a.slice(prefix.length);
  return a;
}

interface JestAssertion {
  ancestorTitles?: string[];
  title?: string;
  fullName?: string;
  status?: string;
  duration?: number | null;
  failureMessages?: string[];
  location?: { line?: number; column?: number } | null;
}

interface JestFile {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: JestAssertion[];
}

/** Vitest `--reporter=json` and Jest `--json` share this format. */
export function parseJestJson(json: string, root: string): TestResult[] {
  const data = JSON.parse(json) as { testResults?: JestFile[] };
  const out: TestResult[] = [];
  for (const f of data.testResults ?? []) {
    if (!f.name) continue;
    const file = relativeTo(root, f.name);
    const tests = f.assertionResults ?? [];
    for (const a of tests) {
      const fullName =
        a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? ''].filter(Boolean).join(' ');
      const msg = (a.failureMessages ?? []).join('\n');
      const failLine = msg ? failureLine(msg, file, root) : undefined;
      out.push({
        file,
        fullName,
        status: statusOf(a.status),
        ...(typeof a.duration === 'number' ? { durationMs: Math.round(a.duration) } : {}),
        ...(msg ? { message: cleanMessage(msg) } : {}),
        ...(a.location?.line ? { line: a.location.line } : {}),
        ...(failLine ? { failLine } : {}),
      });
    }
    // The file broke before (or besides) its tests: syntax error, failing import, hook…
    if (f.status === 'failed' && (f.message || !tests.length))
      out.push({
        file,
        fullName: '',
        status: 'failed',
        message: cleanMessage(f.message || 'The test file failed to run.'),
      });
  }
  return out;
}

function xmlAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : undefined;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Pytest `--junitxml` with `-o junit_family=xunit1` (it adds file and line). `cwd` is the folder
 * pytest ran in, relative to the workspace, since its paths are relative to it.
 */
export function parseJunitXml(xml: string, cwd = '', root = ''): TestResult[] {
  const out: TestResult[] = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(re)) {
    const tag = m[1]!;
    const body = m[3] ?? '';
    const name = xmlAttr(tag, 'name') ?? '';
    const classname = xmlAttr(tag, 'classname') ?? '';
    let file = (xmlAttr(tag, 'file') ?? '').replace(/\\/g, '/');
    if (!file && classname) {
      // Without xunit1: guess the module from the dotted class name.
      const parts = classname.split('.');
      const firstClass = parts.findIndex((p) => /^[A-Z]/.test(p));
      file = `${parts.slice(0, firstClass < 0 ? undefined : firstClass).join('/')}.py`;
    }
    if (cwd && file && !file.startsWith('/') && !/^[A-Za-z]:/.test(file)) file = `${cwd}/${file}`;
    const module = file.replace(/^.*?([^/]+)\.py$/, '$1');
    const cls = classname.split('.');
    const at = cls.lastIndexOf(module);
    const classes = (at >= 0 ? cls.slice(at + 1) : cls.filter((p) => /^[A-Z]/.test(p))).filter(
      Boolean,
    );
    const fullName = [...classes, name].join('::');
    const failed = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(
      body,
    );
    const skipped = /<skipped\b/.test(body);
    const time = Number(xmlAttr(tag, 'time'));
    const line = Number(xmlAttr(tag, 'line'));
    const failText = failed
      ? decodeXml(failed[3] ?? '') || xmlAttr(` ${failed[2] ?? failed[5] ?? ''}`, 'message') || ''
      : '';
    const failLine = failText ? failureLine(failText, file, root, cwd) : undefined;
    out.push({
      file,
      // A collection error comes as a testcase named after the module, with no test name.
      fullName: name && !(failed && !classname) ? fullName : '',
      status: failed ? 'failed' : skipped ? 'skipped' : 'passed',
      ...(Number.isFinite(time) ? { durationMs: Math.round(time * 1000) } : {}),
      ...(failed ? { message: cleanMessage(failText || 'failed') } : {}),
      ...(failLine ? { failLine } : {}),
      // xunit1 lines are 0-based.
      ...(Number.isFinite(line) && xmlAttr(tag, 'line') !== undefined ? { line: line + 1 } : {}),
    });
  }
  return out;
}

export function summarize(
  framework: TestFramework,
  cwd: string,
  results: TestResult[],
  durationMs: number,
  error?: string,
): TestRunSummary {
  const count = (s: TestStatus) => results.filter((r) => r.status === s && r.fullName).length;
  return {
    framework,
    cwd,
    results,
    passed: count('passed'),
    failed: count('failed') + results.filter((r) => !r.fullName && r.status === 'failed').length,
    skipped: count('skipped'),
    finishedAt: Date.now(),
    durationMs,
    ...(error ? { error } : {}),
  };
}

// ---------------- results ↔ items ----------------

/** Strips pytest parameters: "test_x[1-2]" → "test_x". */
function baseName(fullName: string): string {
  return fullName.replace(/\[[^\]]*\]$/, '');
}

function templateRegex(item: TestItem): RegExp | null {
  if (!item.dynamic) return null;
  try {
    return new RegExp(namePattern({ ...item, kind: 'test' }));
  } catch {
    return null;
  }
}

/**
 * Status of each item from the results of a run: a test is failed if any of its runs failed
 * (parameters, `.each` rows), a suite if any test inside it failed.
 */
export function statusByItem(items: TestItem[], results: TestResult[]): Map<string, TestStatus> {
  const byFile = new Map<string, TestResult[]>();
  for (const r of results) {
    const list = byFile.get(r.file) ?? [];
    list.push(r);
    byFile.set(r.file, list);
  }
  const out = new Map<string, TestStatus>();
  const merge = (a: TestStatus | undefined, b: TestStatus): TestStatus =>
    a === 'failed' || b === 'failed' ? 'failed' : a === 'passed' || b === 'passed' ? 'passed' : b;
  for (const item of items) {
    const list = byFile.get(item.file);
    if (!list) continue;
    const py = isPyTestFile(item.file);
    const re = templateRegex(item);
    let st: TestStatus | undefined;
    for (const r of list) {
      if (!r.fullName) continue;
      const name = py ? baseName(r.fullName) : r.fullName;
      const hit =
        item.kind === 'test'
          ? name === item.fullName || (re ? re.test(name) : false)
          : name.startsWith(item.fullName + (py ? '::' : ' '));
      if (hit) st = merge(st, r.status);
    }
    if (st) out.set(item.id, st);
  }
  return out;
}

/** Failed results first, as short text for the agent ("which tests fail?"). */
export function failuresText(summary: TestRunSummary, max = 20): string {
  const failed = summary.results.filter((r) => r.status === 'failed');
  const head =
    `${summary.framework}: ${summary.passed} passed, ${summary.failed} failed, ` +
    `${summary.skipped} skipped (${new Date(summary.finishedAt).toISOString()})`;
  if (summary.error) return `${head}\nRun error: ${summary.error}`;
  if (!failed.length) return `${head}\nNo failing tests.`;
  const rows = failed.slice(0, max).map((r) => {
    const where = `${r.file}${r.line ? `:${r.line}` : ''}`;
    const title = r.fullName || '(file failed to load)';
    const msg = (r.message ?? '').split('\n').slice(0, 12).join('\n');
    return `✗ ${title} — ${where}${msg ? `\n${msg}` : ''}`;
  });
  const more = failed.length > max ? `\n… and ${failed.length - max} more` : '';
  return `${head}\n\n${rows.join('\n\n')}${more}`;
}
