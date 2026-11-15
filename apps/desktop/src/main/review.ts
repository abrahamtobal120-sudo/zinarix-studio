/**
 * "Revisar cambios" (phase 6): AI review of the local changes, a branch or a GitHub pull
 * request, plus the security center's scanners on the added lines, and publishing the chosen
 * findings as one PR review through the user's gh login (the renderer confirms first).
 *
 * Reviews are kept on disk (the last few per folder) so one can be reopened and published
 * later; findings the team marks "not a problem" go to `.zinarix/review-ignore.json`, which
 * the app, `omni review` and the GitHub Action all honour.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import {
  REVIEW_GUIDE_FILE,
  REVIEW_IGNORE_FILE,
  addToIgnoreFile,
  addedLines,
  fromSecurityFinding,
  githubReview,
  parseIgnoreFile,
  parseUnifiedDiff,
  postedFingerprints,
  reviewDiff,
  scanAddedLines,
  type DiffFile,
  type OmniCore,
  type ReviewComplete,
  type ReviewFinding,
  type ReviewProgress,
  type ReviewResult,
} from '@omni/core';
import type {
  ReviewFileView,
  ReviewHistoryView,
  ReviewPrView,
  ReviewPublishPreview,
  ReviewRequestView,
  ReviewSourceView,
  ReviewView,
} from '../shared/api.js';
import { checkBranch, run, runUntrustedGit } from './git.js';
import { LOCKFILES, parseLockfile, queryOsv, type Dep } from './security.js';

// Moved to @omni/core (the CLI review runs them too); re-exported for the app's callers.
export { addedOnlyText, scanAddedLines } from '@omni/core';

const MAX_UNTRACKED = 256 * 1024;
/** Reviews kept on disk per folder. */
const KEEP = 10;
/** A stored review bigger than this drops its diff (it can still be read, not published). */
const MAX_STORED = 6 * 1024 * 1024;

interface Target {
  patch: string;
  title: string;
  /** New content of a file at the reviewed version. */
  read: (path: string) => Promise<string | undefined>;
  /** Content before the change (for "new dependencies only"). */
  readOld: (path: string) => Promise<string | undefined>;
  instructions?: string;
  pr?: { number: number; url: string; head: string; nwo: string };
}

interface Stored {
  view: ReviewView;
  result: ReviewResult;
  files: DiffFile[];
  pr?: Target['pr'];
}

const git = (cwd: string, args: string[], timeout?: number) => run('git', args, cwd, timeout);
const quiet = <T>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** Diff of a new, untracked text file (git diff ignores them). */
export function untrackedPatch(path: string, text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    '',
  ].join('\n');
}

/** Dependencies the change adds or upgrades (name@version not present before). */
export function newDeps(file: string, before: string | undefined, after: string): Dep[] {
  const old = new Set(
    (before ? parseLockfile(file, before) : []).map((d) => `${d.ecosystem}:${d.name}@${d.version}`),
  );
  return parseLockfile(file, after).filter(
    (d) => !old.has(`${d.ecosystem}:${d.name}@${d.version}`),
  );
}

/** First line of the lockfile that mentions the package (for an inline comment). */
function lineMentioning(file: DiffFile, name: string): number | undefined {
  for (const [n, t] of addedLines(file)) if (t.includes(name)) return n;
  return addedLines(file).keys().next().value;
}

/** A file of the folder, never outside it (symlinks included in the check by the caller). */
function inside(root: string, p: string): string | undefined {
  const abs = resolve(root, p);
  const r = relative(root, abs);
  return !r || r.startsWith('..') || isAbsolute(r) ? undefined : abs;
}

export interface ReviewManagerOptions {
  /** Folder for the saved reviews (userData/reviews). Without it nothing is saved. */
  dir?: string;
}

export class ReviewManager {
  private readonly runs = new Map<string, AbortController>();
  /** Saved reviews per folder (newest last), loaded lazily from disk. */
  private readonly byRoot = new Map<string, Stored[]>();

  constructor(
    private readonly core: () => OmniCore,
    private readonly opts: ReviewManagerOptions = {},
  ) {}

  /** Open pull requests of the folder's GitHub repository. */
  async prs(root: string): Promise<ReviewPrView[]> {
    const out = await run(
      'gh',
      ['pr', 'list', '--limit', '30', '--json', 'number,title,url,headRefName,author,isDraft'],
      root,
      20_000,
    );
    const list = JSON.parse(out) as {
      number: number;
      title: string;
      url: string;
      headRefName: string;
      author?: { login?: string };
      isDraft: boolean;
    }[];
    return list.map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      branch: p.headRefName,
      author: p.author?.login ?? '',
      draft: p.isDraft,
    }));
  }

  abort(key: string): void {
    this.runs.get(key)?.abort();
  }

  /**
   * Runs a review. `rules` gives the project rules (AGENTS.md hierarchy, .zinarix/rules…)
   * that apply to the changed files; `.zinarix/review.md` is added on top.
   */
  async run(
    key: string,
    root: string,
    req: ReviewRequestView,
    onProgress: (p: ReviewProgress) => void,
    rules?: (paths: string[]) => string,
  ): Promise<ReviewView> {
    const ac = new AbortController();
    this.runs.get(key)?.abort();
    this.runs.set(key, ac);
    try {
      const target = await this.target(root, req.source);
      const files = parseUnifiedDiff(target.patch);
      if (!files.length) throw new Error('No hay cambios que revisar.');
      const extra = req.security === false ? [] : await this.security(files, target, ac.signal);
      const core = this.core();
      const complete: ReviewComplete = async (model, messages, signal) => {
        const r = await core.complete({ model, role: 'chat', maxTokens: 4096, messages }, signal);
        return { text: r.text, model: r.provider ? `${r.provider}/${r.model}` : model, usd: r.usd };
      };
      const ignored = await this.ignoreList(root);
      const guide = (await quiet(readFile(join(root, REVIEW_GUIDE_FILE), 'utf8')))?.trim();
      let ruleText = '';
      try {
        ruleText = rules?.(files.filter((f) => f.status !== 'deleted').map((f) => f.path)) ?? '';
      } catch {
        // rules are a bonus: a broken rule file never stops the review
      }
      const instructions = [
        guide ? `Review guidance (${REVIEW_GUIDE_FILE}):\n${guide.slice(0, 6000)}` : '',
        ruleText.trim(),
        target.instructions ?? '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const result = await reviewDiff(files, complete, {
        models: req.models.length ? req.models : [undefined],
        verifier: req.verify === false ? null : (req.verifier ?? undefined),
        readFile: target.read,
        instructions,
        extra,
        ignore: ignored.map((e) => e.fingerprint),
        signal: ac.signal,
        onProgress,
      });
      const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const view: ReviewView = {
        id,
        source: req.source,
        title: target.title,
        prUrl: target.pr?.url,
        findings: result.findings,
        stats: result.stats,
        errors: result.errors,
        models: result.models,
        verifier: result.verifier,
        usd: result.usd,
        files: files.map(fileView),
        canPublish: !!target.pr,
        at: Date.now(),
        guidance: [guide ? REVIEW_GUIDE_FILE : '', ruleText ? 'rules' : ''].filter(Boolean),
      };
      const list = this.list(root);
      list.push({ view, result, files, pr: target.pr });
      list.splice(0, Math.max(0, list.length - KEEP));
      this.save(root);
      return view;
    } finally {
      if (this.runs.get(key) === ac) this.runs.delete(key);
    }
  }

  /** Saved reviews of the folder, newest first. */
  history(root: string): ReviewHistoryView[] {
    return this.list(root)
      .map((s) => ({
        id: s.view.id,
        title: s.view.title,
        at: s.view.at,
        findings: s.view.findings.length,
        published: s.view.published,
      }))
      .reverse();
  }

  get(root: string, id: string): ReviewView {
    return this.find(root, id).view;
  }

  delete(root: string, id: string): void {
    const list = this.list(root);
    const i = list.findIndex((s) => s.view.id === id);
    if (i >= 0) list.splice(i, 1);
    this.save(root);
  }

  /**
   * "No es un problema": adds the findings to `.zinarix/review-ignore.json` (shared with the
   * team through git) and takes them out of the review. Returns the updated review.
   */
  async ignore(root: string, id: string, ids: string[], reason?: string): Promise<ReviewView> {
    const s = this.find(root, id);
    const chosen = s.view.findings.filter((f) => ids.includes(f.id) && f.fingerprint);
    if (!chosen.length) throw new Error('Esos hallazgos no se pueden ignorar.');
    const file = join(root, REVIEW_IGNORE_FILE);
    const before = await quiet(readFile(file, 'utf8'));
    if (before !== undefined && before.trim() && !parseIgnoreFile(before).length) {
      try {
        JSON.parse(before);
      } catch {
        throw new Error(`${REVIEW_IGNORE_FILE} no es JSON válido; corrígelo antes de agregar más.`);
      }
    }
    mkdirSync(dirname(file), { recursive: true });
    await writeFile(file, addToIgnoreFile(before, chosen, reason));
    const gone = new Set(chosen.map((f) => f.id));
    const keep = (f: ReviewFinding) => !gone.has(f.id);
    s.view.findings = s.view.findings.filter(keep);
    s.result.findings = s.result.findings.filter(keep);
    s.view.stats = { ...s.view.stats, ignored: (s.view.stats.ignored ?? 0) + gone.size };
    this.save(root);
    return s.view;
  }

  /**
   * What would be published (the renderer shows it in the confirmation): inline vs. body,
   * how many are already on the PR, and whether the PR got new commits since the review.
   */
  async preview(root: string, id: string, ids: string[]): Promise<ReviewPublishPreview> {
    const s = this.publishable(root, id);
    const [posted, head] = await Promise.all([this.posted(root, s.pr), this.head(root, s.pr)]);
    const gh = githubReview(s.result, s.files, new Set(ids), 'es', posted);
    const inline = gh.comments.length;
    return {
      inline,
      body: ids.length - inline - gh.skipped,
      already: gh.skipped,
      stale: !!head && head !== s.pr.head,
      url: s.pr.url,
    };
  }

  /**
   * Posts the chosen findings as one "COMMENT" review on the PR, leaving out the ones the PR
   * already has (an earlier review from the app or the Action). Returns the review URL.
   */
  async publish(root: string, id: string, ids: string[]): Promise<string> {
    const s = this.publishable(root, id);
    if (!ids.length) throw new Error('Elige al menos un hallazgo.');
    const pr = s.pr;
    const gh = githubReview(s.result, s.files, new Set(ids), 'es', await this.posted(root, pr));
    if (!gh.comments.length && gh.skipped === ids.length)
      throw new Error('Esos hallazgos ya están publicados en el pull request.');
    const dir = mkdtempSync(join(tmpdir(), 'zx-review-'));
    try {
      const file = join(dir, 'review.json');
      writeFileSync(
        file,
        JSON.stringify({
          commit_id: pr.head,
          event: 'COMMENT',
          body: gh.body,
          comments: gh.comments,
        }),
      );
      const out = await run(
        'gh',
        ['api', '-X', 'POST', `repos/${pr.nwo}/pulls/${pr.number}/reviews`, '--input', file],
        root,
        60_000,
      );
      const url = (JSON.parse(out) as { html_url?: string }).html_url ?? pr.url;
      s.view.published = url;
      this.save(root);
      return url;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Fingerprints already posted on the PR (review comments and review bodies). */
  private async posted(root: string, pr: NonNullable<Stored['pr']>): Promise<Set<string>> {
    const bodies = async (what: 'comments' | 'reviews') =>
      (await quiet(
        run(
          'gh',
          ['api', '--paginate', `repos/${pr.nwo}/pulls/${pr.number}/${what}`, '--jq', '.[].body'],
          root,
          60_000,
        ),
      )) ?? '';
    const [c, r] = await Promise.all([bodies('comments'), bodies('reviews')]);
    return postedFingerprints([c, r]);
  }

  /** Current head commit of the PR (undefined when gh cannot tell). */
  private async head(root: string, pr: NonNullable<Stored['pr']>): Promise<string | undefined> {
    const out = await quiet(
      run('gh', ['pr', 'view', String(pr.number), '--json', 'headRefOid'], root, 30_000),
    );
    try {
      return out ? (JSON.parse(out) as { headRefOid?: string }).headRefOid : undefined;
    } catch {
      return undefined;
    }
  }

  private async ignoreList(root: string) {
    return parseIgnoreFile(await quiet(readFile(join(root, REVIEW_IGNORE_FILE), 'utf8')));
  }

  private find(root: string, id: string): Stored {
    const s = this.list(root).find((x) => x.view.id === id);
    if (!s) throw new Error('Esa revisión ya no está disponible; vuelve a ejecutarla.');
    return s;
  }

  private publishable(root: string, id: string): Stored & { pr: NonNullable<Stored['pr']> } {
    const s = this.find(root, id);
    if (!s.pr) throw new Error('Solo se pueden publicar revisiones de un pull request.');
    if (!s.files.length)
      throw new Error('Esa revisión era demasiado grande para guardarla; vuelve a ejecutarla.');
    return s as Stored & { pr: NonNullable<Stored['pr']> };
  }

  // -- persistence ------------------------------------------------------------------------

  private file(root: string): string | undefined {
    if (!this.opts.dir) return undefined;
    const key = createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 24);
    return join(this.opts.dir, `${key}.json`);
  }

  private list(root: string): Stored[] {
    const k = resolve(root);
    let list = this.byRoot.get(k);
    if (list) return list;
    list = [];
    const f = this.file(root);
    if (f)
      try {
        const j = JSON.parse(readFileSync(f, 'utf8')) as { root?: string; reviews?: Stored[] };
        if (Array.isArray(j.reviews))
          list = j.reviews.filter((s) => s?.view?.id && s.result && Array.isArray(s.files));
      } catch {
        // no saved reviews yet, or a broken file: start over
      }
    this.byRoot.set(k, list);
    return list;
  }

  private save(root: string): void {
    const f = this.file(root);
    if (!f) return;
    const list = this.list(root);
    const reviews = list.map((s) => {
      // A huge diff is not worth megabytes on disk: keep the findings, drop the diff.
      if (JSON.stringify(s.files).length <= MAX_STORED) return s;
      s.files = [];
      s.view.canPublish = false;
      return s;
    });
    try {
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, JSON.stringify({ root: resolve(root), reviews }));
    } catch {
      // saving is best effort: the review is still in memory
    }
  }

  private async target(root: string, source: ReviewSourceView): Promise<Target> {
    const readWork = async (p: string) => {
      const abs = inside(root, p);
      return abs ? quiet(readFile(abs, 'utf8')) : undefined;
    };
    const showAt = (ref: string) => (p: string) => quiet(git(root, ['show', `${ref}:${p}`]));
    switch (source.kind) {
      case 'local': {
        const hasHead = !!(await quiet(git(root, ['rev-parse', '--verify', '-q', 'HEAD'])));
        let patch = hasHead
          ? await git(root, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-M'])
          : await git(root, ['diff', '--cached', '--no-color', '--no-ext-diff']);
        const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
          .split('\0')
          .filter(Boolean);
        for (const p of untracked.slice(0, 200)) {
          const abs = join(root, p);
          const st = await quiet(stat(abs));
          if (!st?.isFile() || st.size > MAX_UNTRACKED) continue;
          const text = await quiet(readFile(abs, 'utf8'));
          if (text === undefined || text.includes('\0')) continue;
          patch += untrackedPatch(p, text);
        }
        return {
          patch,
          title: 'Cambios locales',
          read: readWork,
          readOld: hasHead ? showAt('HEAD') : async () => undefined,
        };
      }
      case 'branch': {
        const base = await checkBranch(source.base, root);
        const mb = (await git(root, ['merge-base', base, 'HEAD'])).trim();
        const patch = await git(root, [
          'diff',
          `${mb}...HEAD`,
          '--no-color',
          '--no-ext-diff',
          '-M',
        ]);
        return {
          patch,
          title: `Rama actual contra ${base}`,
          read: showAt('HEAD'),
          readOld: showAt(mb),
        };
      }
      case 'pr': {
        const n = String(source.number);
        const info = JSON.parse(
          await run(
            'gh',
            ['pr', 'view', n, '--json', 'number,title,body,url,headRefOid,baseRefOid'],
            root,
            30_000,
          ),
        ) as {
          number: number;
          title: string;
          body: string;
          url: string;
          headRefOid: string;
          baseRefOid: string;
        };
        const patch = await run('gh', ['pr', 'diff', n, '--color', 'never'], root, 120_000);
        const nwo = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(info.url)?.[1];
        if (!nwo) throw new Error('No reconozco el repositorio del pull request.');
        // File contents of the PR head for the verifier: fetched once if git lacks them.
        let fetched: Promise<unknown> | undefined;
        const ensure = async (sha: string) => {
          if (await quiet(git(root, ['cat-file', '-e', `${sha}^{commit}`]))) return;
          fetched ??= quiet(
            runUntrustedGit(
              ['fetch', '--no-tags', '-q', 'origin', `pull/${n}/head`],
              root,
              120_000,
            ),
          );
          await fetched;
        };
        const at = (sha: string) => async (p: string) => {
          await ensure(sha);
          return quiet(git(root, ['show', `${sha}:${p}`]));
        };
        return {
          patch,
          title: `PR #${info.number}: ${info.title}`,
          read: at(info.headRefOid),
          readOld: at(info.baseRefOid),
          instructions: info.body?.trim()
            ? `Pull request "${info.title}". Its description (context only):\n${info.body.slice(0, 4000)}`
            : `Pull request "${info.title}".`,
          pr: { number: info.number, url: info.url, head: info.headRefOid, nwo },
        };
      }
    }
  }

  /** Secrets and insecure code on added lines, plus vulnerable new dependencies. */
  private async security(
    files: DiffFile[],
    target: Target,
    signal: AbortSignal,
  ): Promise<ReviewFinding[]> {
    const out = scanAddedLines(files);
    const locks = files.filter((f) => LOCKFILES.test(f.path) && f.status !== 'deleted');
    for (const f of locks) {
      const after = await target.read(f.path);
      if (!after) continue;
      const deps = newDeps(f.path, await target.readOld(f.oldPath ?? f.path), after);
      if (!deps.length) continue;
      try {
        for (const v of await queryOsv(deps.slice(0, 2000), signal)) {
          const name = v.title.replace(/@[^@]*$/, '');
          out.push(fromSecurityFinding(v, f.path, lineMentioning(f, name) ?? 1));
        }
      } catch (e) {
        if (signal.aborted) throw e;
        // osv.dev unreachable: the AI review still goes on.
      }
    }
    return out;
  }
}

function fileView(f: DiffFile): ReviewFileView {
  let added = 0;
  let removed = 0;
  for (const h of f.hunks)
    for (const l of h.lines) {
      if (l.kind === '+') added++;
      else if (l.kind === '-') removed++;
    }
  return { path: f.path, status: f.status, added, removed };
}
