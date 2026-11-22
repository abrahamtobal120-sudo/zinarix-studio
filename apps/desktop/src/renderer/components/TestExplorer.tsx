import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TestItem, TestProject, TestResult, TestStatus } from '../../shared/testing';
import { pressable } from '../a11y';
import { t } from '../i18n';
import { api, openFile, useStore } from '../store';
import {
  cancelTests,
  clearResults,
  debugTest,
  discover,
  fileErrors,
  requestFor,
  rerunFailed,
  resultsOf,
  runAll,
  runTests,
  setRunOnSave,
  useTests,
  variantsOf,
} from '../testExplorer';
import { filesUnder, testFileLabel, testFileTree, type TestFolder } from '../testTree';
import { folderIcon } from './icons';
import { Icon } from './Icon';
import './test-explorer.css';

type Mark = TestStatus | 'running' | 'none';

/** A runner with more test files than this starts collapsed (and so do its folders). */
const BIG_GROUP = 15;

interface Tally {
  files: number;
  tests: number;
  passed: number;
  failed: number;
}

function StatusMark({ st }: { st: Mark }) {
  const label =
    st === 'running'
      ? t('teRunning')
      : st === 'passed'
        ? t('tePassed')
        : st === 'failed'
          ? t('teFailed')
          : st === 'skipped'
            ? t('teSkipped')
            : '';
  return (
    <span
      className={`te-status te-${st}`}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      title={label || undefined}
    >
      {st === 'passed'
        ? '✓'
        : st === 'failed'
          ? '✗'
          : st === 'skipped'
            ? '○'
            : st === 'running'
              ? ''
              : '·'}
    </span>
  );
}

/** A test that takes this long gets its time shown in the list. */
const SLOW_MS = 1000;

function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** Total time of the runs behind an item (undefined = not run). */
function timeOf(results: TestResult[]): number | undefined {
  const times = results.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number');
  return times.length ? times.reduce((a, b) => a + b, 0) : undefined;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

/** Items of a file as a tree (a test hangs from the innermost describe whose name prefixes it). */
interface Node {
  item: TestItem;
  children: Node[];
}
function treeOf(items: TestItem[]): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  const sep = (i: TestItem) => (i.file.endsWith('.py') ? '::' : ' ');
  for (const item of [...items].sort((a, b) => a.line - b.line)) {
    while (
      stack.length &&
      !item.fullName.startsWith(stack[stack.length - 1]!.item.fullName + sep(item))
    )
      stack.pop();
    const node = { item, children: [] };
    (stack.length ? stack[stack.length - 1]!.children : roots).push(node);
    if (item.kind === 'suite') stack.push(node);
  }
  return roots;
}

export function TestExplorer() {
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const discovery = useTests((v) => v.discovery);
  const loading = useTests((v) => v.loading);
  const running = useTests((v) => v.running);
  const label = useTests((v) => v.label);
  const summary = useTests((v) => v.summary);
  const status = useTests((v) => v.status);
  const pending = useTests((v) => v.pending);
  const output = useTests((v) => v.output);
  const onSave = useTests((v) => v.onSave);
  const [filter, setFilter] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Runners and folders whose open/closed state the user flipped from the default.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  useEffect(() => {
    if (workspace && !discovery && !loading) void discover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // Test files change while editing: rescan after a pause.
  useEffect(() => {
    if (!workspace || fsVersion === 0) return;
    const timer = setTimeout(() => void discover(), 1500);
    return () => clearTimeout(timer);
  }, [fsVersion, workspace]);

  const byFile = useMemo(() => {
    const m = new Map<string, TestItem[]>();
    for (const i of discovery?.items ?? []) m.set(i.file, [...(m.get(i.file) ?? []), i]);
    return m;
  }, [discovery]);

  if (!workspace) {
    return (
      <div className="sidebar-empty">
        <p>{t('noFolder')}</p>
        <button className="primary" onClick={() => void api().workspace.openDialog()}>
          {t('openFolder')}
        </button>
      </div>
    );
  }

  const markOf = (item: TestItem): Mark =>
    pending.has(item.id) ? 'running' : (status.get(item.id) ?? 'none');
  const pendingMark = (item: TestItem): Mark | undefined =>
    pending.has(item.id) ? 'running' : undefined;
  const fileMark = (file: string, items: TestItem[]): Mark => {
    if (items.some((i) => pending.has(i.id))) return 'running';
    if (fileErrors(file).length) return 'failed';
    const marks = items.filter((i) => i.kind === 'test').map(markOf);
    if (marks.includes('failed')) return 'failed';
    if (
      marks.length &&
      marks.every((m) => m === 'passed' || m === 'skipped') &&
      marks.includes('passed')
    )
      return 'passed';
    return marks.length && marks.every((m) => m === 'skipped') ? 'skipped' : 'none';
  };
  const q = filter.trim().toLowerCase();
  const visible = (item: TestItem): boolean =>
    (!q || item.fullName.toLowerCase().includes(q) || item.file.toLowerCase().includes(q)) &&
    (!onlyFailed || markOf(item) === 'failed');
  const filtering = Boolean(q) || onlyFailed;
  const pathHit = (file: string) => Boolean(q) && file.toLowerCase().includes(q);
  const fileShown = (file: string, items: TestItem[]): boolean =>
    !filtering ||
    items.some(visible) ||
    (onlyFailed ? fileErrors(file).length > 0 && (!q || pathHit(file)) : pathHit(file));
  const tally = (files: string[]): Tally => {
    const c: Tally = { files: 0, tests: 0, passed: 0, failed: 0 };
    for (const file of files) {
      const items = byFile.get(file) ?? [];
      if (!fileShown(file, items)) continue;
      c.files++;
      for (const i of items) {
        if (i.kind !== 'test' || (filtering && !visible(i))) continue;
        c.tests++;
        const m = markOf(i);
        if (m === 'passed') c.passed++;
        else if (m === 'failed') c.failed++;
      }
    }
    return c;
  };
  const isOpen = (key: string, byDefault: boolean) => filtering || flipped.has(key) !== byDefault;
  const flip = (key: string) =>
    setFlipped((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const actions = (project: TestProject, target?: TestItem | string) => (
    <span className="te-actions">
      <button
        title={t('teRun')}
        aria-label={t('teRun')}
        disabled={running || Boolean(project.problem)}
        onClick={(e) => {
          e.stopPropagation();
          void runTests(requestFor(project, target));
        }}
      >
        <Icon name="play" size={13} />
      </button>
      <button
        title={t('teDebug')}
        aria-label={t('teDebug')}
        disabled={Boolean(project.problem)}
        onClick={(e) => {
          e.stopPropagation();
          void debugTest(project, target);
        }}
      >
        <Icon name="bug" size={13} />
      </button>
    </span>
  );

  /** The error of a failed run, with a link to the line where it broke. */
  const errorBlock = (rows: TestResult[], own: string, indent: number) => (
    <div className="te-error" style={{ marginLeft: indent }}>
      {rows.slice(0, 3).map((r, i) => (
        <div key={i}>
          <pre>
            {r.fullName !== own ? `${r.fullName}\n` : ''}
            {r.message ?? t('teFailed')}
          </pre>
          {r.failLine && (
            <button
              className="link small"
              onClick={() => void openFile(r.file, { line: r.failLine!, column: 1 })}
            >
              {t('teGoToFailure')} ({r.file.split('/').pop()}:{r.failLine})
            </button>
          )}
        </div>
      ))}
    </div>
  );

  const renderNode = (project: TestProject, node: Node, depth: number): ReactNode => {
    const { item } = node;
    const kids = node.children.filter(function keep(n): boolean {
      return visible(n.item) || n.children.some(keep);
    });
    if (!visible(item) && !kids.length) return null;
    const runs = item.kind === 'test' ? resultsOf(item) : [];
    const failed = markOf(item) === 'failed' ? runs.filter((r) => r.status === 'failed') : [];
    const variants = variantsOf(item);
    const time = timeOf(runs);
    const isOpen = shown === item.id;
    const title = [
      item.fullName,
      item.dynamic ? t('teDynamic') : '',
      time !== undefined ? duration(time) : '',
    ]
      .filter(Boolean)
      .join(' — ');
    return (
      <div key={item.id}>
        <div
          className={`te-row ${isOpen ? 'sel' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={title}
          aria-expanded={variants.length ? isOpen : undefined}
          {...pressable(() => {
            setShown(isOpen ? null : item.id);
            void openFile(item.file, { line: item.line, column: 1 });
          })}
        >
          <StatusMark st={markOf(item)} />
          <span className={`te-name ${item.kind === 'suite' ? 'suite' : ''}`}>{item.name}</span>
          {variants.length > 0 && (
            <span className="te-meta dim small">{t('teVariants', { n: variants.length })}</span>
          )}
          {time !== undefined && time >= SLOW_MS && (
            <span className="te-meta te-slow small" title={t('teSlow')}>
              {duration(time)}
            </span>
          )}
          {actions(project, item)}
        </div>
        {isOpen &&
          failed.length > 0 &&
          !variants.length &&
          errorBlock(failed, item.fullName, 20 + depth * 12)}
        {isOpen &&
          variants.map((r) => {
            const vid = `${item.id}::${r.fullName}`;
            const vOpen = shown === vid;
            const prefix = item.fullName.slice(0, item.fullName.length - item.name.length);
            const label = r.fullName.startsWith(prefix)
              ? r.fullName.slice(prefix.length)
              : r.fullName;
            const pending = pendingMark(item);
            return (
              <div key={vid}>
                <div
                  className={`te-row te-variant ${vOpen ? 'sel' : ''}`}
                  style={{ paddingLeft: 8 + (depth + 1) * 12 }}
                  title={
                    r.durationMs !== undefined
                      ? `${r.fullName} — ${duration(r.durationMs)}`
                      : r.fullName
                  }
                  {...pressable(() => {
                    setShown(vOpen ? item.id : vid);
                    void openFile(item.file, { line: r.failLine ?? item.line, column: 1 });
                  })}
                >
                  <StatusMark st={pending ?? r.status} />
                  <span className="te-name">{label}</span>
                  {actions(project, { ...item, fullName: r.fullName, dynamic: undefined, id: vid })}
                </div>
                {vOpen &&
                  r.status === 'failed' &&
                  errorBlock([r], r.fullName, 20 + (depth + 1) * 12)}
              </div>
            );
          })}
        {kids.map((k) => renderNode(project, k, depth + 1))}
      </div>
    );
  };

  const projects = discovery?.projects ?? [];
  const anyVisible = projects.some((p) => p.files.some((f) => fileShown(f, byFile.get(f) ?? [])));

  /** Test and pass / fail counts of a runner, folder or file. */
  const counts = (c: Tally, label?: string) => (
    <span
      className="te-counts small"
      title={[
        t('teCounts', { files: c.files, tests: c.tests }),
        c.passed ? `${t('tePassed')}: ${c.passed}` : '',
        c.failed ? `${t('teFailed')}: ${c.failed}` : '',
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <span className="dim">{label ?? c.tests}</span>
      {c.passed > 0 && <span className="te-n-pass">✓{c.passed}</span>}
      {c.failed > 0 && <span className="te-n-fail">✗{c.failed}</span>}
    </span>
  );

  const renderFile = (p: TestProject, file: string, depth: number): ReactNode => {
    const items = byFile.get(file) ?? [];
    if (!fileShown(file, items)) return null;
    const errors = fileErrors(file);
    const expanded = open.has(file) || (filtering && items.some(visible));
    return (
      <div key={file}>
        <div
          className="te-row te-file"
          style={{ paddingLeft: 8 + depth * 12 }}
          title={file}
          aria-expanded={expanded}
          {...pressable(() => toggle(file))}
        >
          <Icon name="chevron" size={12} className={`te-chev ${expanded ? 'open' : ''}`} />
          <StatusMark st={fileMark(file, items)} />
          <span className="te-name">{testFileLabel(file)}</span>
          {counts(tally([file]))}
          {actions(p, file)}
        </div>
        {expanded && errors.length > 0 && (
          <div className="te-error" style={{ marginLeft: 28 + depth * 12 }}>
            <strong>{t('teFileError')}</strong>
            <pre>{errors[0]!.message}</pre>
          </div>
        )}
        {expanded && treeOf(items).map((n) => renderNode(p, n, depth + 1))}
      </div>
    );
  };

  const renderFolder = (
    p: TestProject,
    folder: TestFolder,
    depth: number,
    byDefault: boolean,
  ): ReactNode => {
    const all = filesUnder(folder);
    const c = tally(all);
    if (!c.files) return null;
    const key = `${p.framework}:${p.cwd}|${folder.path}`;
    const expanded = isOpen(key, byDefault);
    const last = folder.name.slice(folder.name.lastIndexOf('/') + 1);
    return (
      <div key={key}>
        <div
          className="te-row te-folder"
          style={{ paddingLeft: 8 + depth * 12 }}
          title={folder.path}
          aria-expanded={expanded}
          {...pressable(() => flip(key))}
        >
          <Icon name="chevron" size={12} className={`te-chev ${expanded ? 'open' : ''}`} />
          <span className="te-ficon">{folderIcon(last, expanded)}</span>
          <span className="te-path">
            <bdi>{folder.name}</bdi>
          </span>
          {counts(c, String(c.files))}
          <span className="te-actions">
            <button
              title={t('teRun')}
              aria-label={t('teRun')}
              disabled={running || Boolean(p.problem)}
              onClick={(e) => {
                e.stopPropagation();
                void runTests({ ...requestFor(p), files: all });
              }}
            >
              <Icon name="play" size={13} />
            </button>
          </span>
        </div>
        {expanded && renderLevel(p, folder, depth + 1, byDefault)}
      </div>
    );
  };

  const renderLevel = (
    p: TestProject,
    folder: TestFolder,
    depth: number,
    byDefault: boolean,
  ): ReactNode => (
    <>
      {folder.folders.map((f) => renderFolder(p, f, depth, byDefault))}
      {folder.files.map((f) => renderFile(p, f, depth))}
    </>
  );

  return (
    <div className="te-panel">
      <div className="sidebar-title">
        <span>{t('teTitle').toUpperCase()}</span>
        <span className="sidebar-actions">
          {running ? (
            <button title={t('teCancel')} aria-label={t('teCancel')} onClick={cancelTests}>
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <>
              <button
                title={t('teRunAll')}
                aria-label={t('teRunAll')}
                disabled={!projects.length}
                onClick={() => void runAll()}
              >
                <Icon name="play" size={14} />
              </button>
              {(summary?.failed ?? 0) > 0 && (
                <button
                  className="te-rerun"
                  title={t('teRerunFailed')}
                  aria-label={t('teRerunFailed')}
                  onClick={() => void rerunFailed()}
                >
                  <Icon name="undo" size={14} />
                </button>
              )}
            </>
          )}
          <button title={t('refresh')} aria-label={t('refresh')} onClick={() => void discover()}>
            <Icon name="refresh" size={14} />
          </button>
        </span>
      </div>
      <div className="te-body">
        <div className="te-tools">
          <input
            className="te-filter"
            placeholder={t('teFilter')}
            aria-label={t('teFilter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="te-only">
            <input
              type="checkbox"
              checked={onlyFailed}
              onChange={(e) => setOnlyFailed(e.target.checked)}
            />
            {t('teOnlyFailed')}
          </label>
          <label className="te-only" title={t('teOnSaveHint')}>
            <input
              type="checkbox"
              checked={onSave}
              onChange={(e) => setRunOnSave(e.target.checked)}
            />
            {t('teOnSave')}
          </label>
        </div>
        <div className="te-summary dim small" aria-live="polite">
          {running
            ? `${t('teRunning')} ${label ?? ''}`
            : summary
              ? `${t('teSummary', { passed: summary.passed, failed: summary.failed, skipped: summary.skipped })} · ${t('teAgo', { time: ago(summary.finishedAt) })}`
              : projects.length
                ? t('teNever')
                : ''}
          {summary && !running && (
            <button className="link te-clear" onClick={() => void clearResults()}>
              {t('teClear')}
            </button>
          )}
        </div>
        {loading && !discovery && <p className="dim small">{t('teLoading')}</p>}
        {discovery && !projects.length && <p className="dim small">{t('teNone')}</p>}
        {discovery && projects.length > 0 && !anyVisible && (
          <p className="dim small">{t('teNoMatch')}</p>
        )}
        {projects.map((p) => {
          const key = `${p.framework}:${p.cwd}`;
          const big = p.files.length > BIG_GROUP;
          const expanded = isOpen(key, !big);
          const c = tally(p.files);
          if (filtering && !c.files) return null;
          return (
            <div key={key} className="te-project">
              <div
                className="te-row te-project-head"
                title={p.cwd || workspace.name}
                aria-expanded={expanded}
                {...pressable(() => flip(key))}
              >
                <Icon name="chevron" size={12} className={`te-chev ${expanded ? 'open' : ''}`} />
                <span className="te-fw">{p.framework}</span>
                <span className="te-path dim small">
                  <bdi>{p.cwd || '.'}</bdi>
                </span>
                {counts(c, t('teCounts', { files: c.files, tests: c.tests }))}
                {actions(p)}
              </div>
              {p.problem && <p className="te-problem small">{p.problem}</p>}
              {expanded && renderLevel(p, testFileTree(p.files, p.cwd), 1, !big)}
            </div>
          );
        })}
        {output && (
          <div className="te-output">
            <button
              className="link"
              aria-expanded={showOutput}
              onClick={() => setShowOutput((v) => !v)}
            >
              {t('teOutput')}
            </button>
            {showOutput && <pre>{output.slice(-30_000)}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}
