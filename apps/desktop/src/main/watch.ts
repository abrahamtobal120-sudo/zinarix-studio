import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { OmniCore } from '@omni/core';
import { redact } from '@omni/security';
import type { WatchItem, WatchReport, WatchSettings, WatchStatus } from '../shared/api.js';
import { renderTree } from './agent.js';
import { run } from './git.js';
import type { Workspace } from './workspace.js';

/**
 * The Watcher (Vigía): always on, but almost always free. Every few minutes it looks at the
 * open projects with git (no AI, no tokens). Only when a project changed, the changes have
 * settled and enough time passed since the last review, it sends one short request to the
 * AI and keeps what it says should be fixed or improved.
 */

/** How often the projects are looked at (free). */
const CHECK_MS = 5 * 60_000;
/** A project must stay unchanged this long before a review (not in the middle of an edit). */
const SETTLE_MS = 3 * 60_000;
/** Most text sent in one review (about 10k tokens). */
const MAX_MATERIAL = 40_000;
const MAX_REPORTS = 30;

export const DEFAULT_WATCH: WatchSettings = {
  enabled: true,
  everyMin: 120,
  maxPerDay: 4,
  model: null,
};

const WATCH_SYSTEM =
  'You are the Watcher of Zinarix Studio: a senior engineer who looks at a project now and then and tells ' +
  'its owner the few things most worth doing. You get the file tree, the recent commits and the changes since ' +
  'your last look. Point out real bugs, security problems, broken or risky code first ("fix"), then the ' +
  'improvements with the best value for the effort ("improve"). Be concrete: name the file and what to change. ' +
  'At most 5 items, ordered by importance; fewer is better than filler. Never repeat advice listed as already ' +
  'given unless it is still unresolved and serious. If nothing is worth saying, return no items.\n' +
  'Answer ONLY with JSON, no fences: {"summary": "one sentence about the state of the changes", ' +
  '"items": [{"kind": "fix" | "improve", "title": "short", "detail": "1-3 sentences", "file": "path:line (optional)"}]}. ' +
  'Write summary, titles and details in Spanish unless the project is clearly written for another language.';

interface ProjectState {
  /** Fingerprint seen on the last check, and since when. */
  fp: string;
  changedAt: number;
  /** Fingerprint and commit at the last review. */
  reviewedFp?: string;
  reviewedHead?: string | null;
  reviewedAt?: number;
}

interface Stored {
  settings: WatchSettings;
  reports: WatchReport[];
  projects: Record<string, ProjectState>;
  day: string;
  count: number;
  lastReview: number | null;
}

export interface WatchDeps {
  home: string;
  core: OmniCore;
  /** Folders open in the windows right now. */
  projects: () => Workspace[];
  /** The status changed (sent to every window). */
  changed: (status: WatchStatus) => void;
  /** A review found something (a desktop notification when no window is in front). */
  found: (report: WatchReport) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const sha = (text: string) => createHash('sha1').update(text).digest('hex');

const git = (ws: Workspace, args: string[]) => run('git', args, ws.root, 30_000);

/** Cheap summary of the project's content: changes only when the code does. */
async function fingerprint(ws: Workspace): Promise<string> {
  try {
    const [head, diff, untracked] = await Promise.all([
      git(ws, ['rev-parse', 'HEAD']).catch(() => 'no-head'),
      git(ws, ['diff', 'HEAD', '--no-color', '--no-ext-diff']).catch(() => ''),
      git(ws, ['ls-files', '--others', '--exclude-standard']),
    ]);
    return sha(`${head}\0${diff}\0${untracked}`);
  } catch {
    // Not a git repository: names, sizes and times of the files.
    const files = await ws.listFiles(5000);
    const parts = await Promise.all(
      files.map(async (f) => {
        const s = await stat(ws.resolve(f)).catch(() => undefined);
        return s ? `${f}:${s.size}:${s.mtimeMs}` : f;
      }),
    );
    return sha(parts.join('\n'));
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… [recortado]` : text;
}

/** What the AI gets to see: tree, recent commits and the changes since the last review. */
async function material(ws: Workspace, p: ProjectState | undefined): Promise<string> {
  const files = await ws.listFiles(5000).catch(() => [] as string[]);
  const tree = renderTree(files, '', 3).slice(0, 250).join('\n');
  const parts = [`<file-tree>\n${tree}\n</file-tree>`];
  const isGit = await git(ws, ['rev-parse', '--is-inside-work-tree']).then(
    () => true,
    () => false,
  );
  if (isGit) {
    const since = p?.reviewedHead;
    const known =
      since && (await git(ws, ['merge-base', '--is-ancestor', since, 'HEAD']).then(
        () => true,
        () => false,
      ));
    const log = await git(
      ws,
      known ? ['log', '--oneline', '-20', `${since}..HEAD`] : ['log', '--oneline', '-10'],
    ).catch(() => '');
    if (log.trim()) parts.push(`<recent-commits>\n${log.trim()}\n</recent-commits>`);
    const args = ['diff', '--no-color', '--no-ext-diff', '--stat', '--patch'];
    let diff = await git(ws, known ? [...args, since!] : [...args, 'HEAD']).catch(() => '');
    // First look at a clean project: the last few commits show what is being worked on.
    if (!diff.trim() && !known) diff = await git(ws, [...args, 'HEAD~3']).catch(() => '');
    if (diff.trim())
      parts.push(`<changes since="${known ? 'last review' : 'recent'}">\n${diff}\n</changes>`);
    const untracked = (await git(ws, ['ls-files', '--others', '--exclude-standard']).catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .slice(0, 50);
    if (untracked.length) parts.push(`<new-files>\n${untracked.join('\n')}\n</new-files>`);
  } else {
    // Without git: the files touched since the last review (or the newest ones).
    const since = p?.reviewedAt ?? 0;
    const dated = await Promise.all(
      files.slice(0, 5000).map(async (f) => ({
        f,
        t: (await stat(ws.resolve(f)).catch(() => undefined))?.mtimeMs ?? 0,
      })),
    );
    const recent = dated
      .filter((x) => x.t > since)
      .sort((a, b) => b.t - a.t)
      .slice(0, 8);
    for (const { f } of recent) {
      const r = await ws.readFile(f).catch(() => undefined);
      if (r && !r.binary && !r.tooLarge)
        parts.push(`<file path="${f}">\n${clip(r.content, 6000)}\n</file>`);
    }
  }
  return redact(clip(parts.join('\n\n'), MAX_MATERIAL));
}

/** The AI's JSON answer, tolerating fences or text around it. */
export function parseReview(text: string): { summary: string; items: WatchItem[] } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as {
      summary?: unknown;
      items?: unknown;
    };
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it: Record<string, unknown>) => ({
        kind: it.kind === 'fix' ? ('fix' as const) : ('improve' as const),
        title: String(it.title ?? '').slice(0, 200),
        detail: String(it.detail ?? '').slice(0, 1500),
        ...(typeof it.file === 'string' && it.file.trim() ? { file: it.file.trim().slice(0, 300) } : {}),
      }))
      .filter((it) => it.title)
      .slice(0, 5);
    return { summary: String(raw.summary ?? '').slice(0, 500), items };
  } catch {
    return { summary: text.trim().slice(0, 500), items: [] };
  }
}

export class Watcher {
  private data: Stored;
  private busy: string | null = null;
  private lastError: string | null = null;
  private timer?: NodeJS.Timeout;

  constructor(private readonly deps: WatchDeps) {
    this.data = this.load();
  }

  private get file(): string {
    return join(this.deps.home, 'watch.json');
  }

  private load(): Stored {
    let d: Partial<Stored> = {};
    try {
      d = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>;
    } catch {
      // first run
    }
    return {
      settings: { ...DEFAULT_WATCH, ...d.settings },
      reports: d.reports ?? [],
      projects: d.projects ?? {},
      day: d.day ?? today(),
      count: d.count ?? 0,
      lastReview: d.lastReview ?? null,
    };
  }

  private save(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    } catch {
      // read-only home: the watcher keeps working for this session
    }
  }

  private changed(): void {
    this.save();
    this.deps.changed(this.status());
  }

  private countToday(): number {
    if (this.data.day !== today()) {
      this.data.day = today();
      this.data.count = 0;
    }
    return this.data.count;
  }

  status(): WatchStatus {
    const s = this.data.settings;
    const last = this.data.lastReview;
    return {
      settings: s,
      busy: this.busy,
      lastReview: last,
      nextAt: !s.enabled
        ? null
        : this.countToday() >= s.maxPerDay
          ? new Date(`${today()}T00:00:00`).getTime() + 86_400_000
          : (last ?? 0) + s.everyMin * 60_000,
      reviewsToday: this.countToday(),
      lastError: this.lastError,
      reports: this.data.reports,
    };
  }

  start(): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref();
    // A first look shortly after the app opens.
    setTimeout(() => void this.tick(), 60_000).unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  configure(patch: Partial<WatchSettings>): WatchStatus {
    this.data.settings = { ...this.data.settings, ...patch };
    this.changed();
    return this.status();
  }

  seen(): WatchStatus {
    for (const r of this.data.reports) r.seen = true;
    this.changed();
    return this.status();
  }

  dismiss(id: string): WatchStatus {
    this.data.reports = this.data.reports.filter((r) => r.id !== id);
    this.changed();
    return this.status();
  }

  /** The free check: decides, per project, whether a review is due. */
  async tick(): Promise<void> {
    const s = this.data.settings;
    if (!s.enabled || this.busy) return;
    const now = Date.now();
    const seen = new Set<string>();
    for (const ws of this.deps.projects()) {
      if (seen.has(ws.root)) continue;
      seen.add(ws.root);
      const fp = await fingerprint(ws).catch(() => null);
      if (!fp) continue;
      const p = (this.data.projects[ws.root] ??= { fp, changedAt: now });
      if (p.fp !== fp) {
        p.fp = fp;
        p.changedAt = now;
      }
      const due =
        fp !== p.reviewedFp &&
        now - p.changedAt >= SETTLE_MS &&
        now - (this.data.lastReview ?? 0) >= s.everyMin * 60_000 &&
        this.countToday() < s.maxPerDay;
      // One review per check at most: the next project waits for its turn.
      if (due) {
        await this.review(ws, fp);
        return;
      }
    }
    this.save();
  }

  /** Reviews one project now (the "Revisar ahora" button skips the waiting rules). */
  async runNow(ws: Workspace | undefined): Promise<WatchStatus> {
    if (!ws) throw new Error('Abre una carpeta para que el Vigía la revise.');
    if (this.busy) return this.status();
    await this.review(ws, await fingerprint(ws).catch(() => ''));
    return this.status();
  }

  private async review(ws: Workspace, fp: string): Promise<void> {
    const p = this.data.projects[ws.root];
    this.busy = ws.root;
    this.lastError = null;
    this.deps.changed(this.status());
    try {
      const before = this.data.reports
        .filter((r) => r.project === ws.root)
        .slice(0, 2)
        .flatMap((r) => r.items.map((it) => `- [${it.kind}] ${it.title}`));
      const body =
        (await material(ws, p)) +
        (before.length ? `\n\n<already-given>\n${before.join('\n')}\n</already-given>` : '');
      const r = await this.deps.core.complete(
        {
          model: this.data.settings.model ?? undefined,
          role: 'chat',
          project: ws.root,
          maxTokens: 1200,
          temperature: 0.2,
          messages: [
            { role: 'system', content: WATCH_SYSTEM },
            { role: 'user', content: `Project: ${basename(ws.root)}\n\n${body}` },
          ],
        },
        new AbortController().signal,
      );
      const { summary, items } = parseReview(r.text);
      const report: WatchReport = {
        id: randomUUID(),
        ts: Date.now(),
        project: ws.root,
        name: basename(ws.root),
        summary,
        items,
        model: `${r.provider}/${r.model}`,
        usd: r.usd,
        seen: items.length === 0,
      };
      this.data.reports = [report, ...this.data.reports].slice(0, MAX_REPORTS);
      const head = await git(ws, ['rev-parse', 'HEAD']).then(
        (h) => h.trim(),
        () => null,
      );
      this.data.projects[ws.root] = {
        fp: fp || (p?.fp ?? ''),
        changedAt: p?.changedAt ?? Date.now(),
        reviewedFp: fp || undefined,
        reviewedHead: head,
        reviewedAt: Date.now(),
      };
      if (items.length) this.deps.found(report);
    } catch (e) {
      this.lastError = (e as Error).message.slice(0, 300);
    } finally {
      // Errors count too: a broken key never turns into a request every five minutes.
      this.data.lastReview = Date.now();
      this.countToday();
      this.data.count++;
      this.busy = null;
      this.changed();
    }
  }
}
