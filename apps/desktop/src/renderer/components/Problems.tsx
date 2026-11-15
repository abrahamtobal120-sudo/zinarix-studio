import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { pressable } from '../a11y';
import { clearConsole, evaluateInConsole, useDebug } from '../debug';
import { td } from '../i18nDebug';
import { monaco } from '../monaco';
import { openFile } from '../store';
import { Icon } from './Icon';

// ---------------- markers of every open model (LSP, TypeScript, JSON, CSS…) ----------------

export interface Problem {
  path: string;
  line: number;
  column: number;
  message: string;
  severity: monaco.MarkerSeverity;
  source?: string;
  code?: string;
}

let problems: Problem[] = [];
const listeners = new Set<() => void>();
let installed = false;

function codeOf(c: monaco.editor.IMarker['code']): string | undefined {
  if (c === undefined) return undefined;
  return typeof c === 'string' ? c : c.value;
}

function collect(): void {
  problems = monaco.editor
    .getModelMarkers({})
    .filter((m) => m.resource.scheme === 'file' && m.severity >= monaco.MarkerSeverity.Info)
    .map((m) => ({
      path: m.resource.path.replace(/^\//, ''),
      line: m.startLineNumber,
      column: m.startColumn,
      message: m.message,
      severity: m.severity,
      source: m.source ?? (m.owner === 'lsp' ? undefined : m.owner),
      code: codeOf(m.code),
    }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) || b.severity - a.severity || a.line - b.line || a.column - b.column,
    );
  for (const l of listeners) l();
}

function install(): void {
  if (installed) return;
  installed = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  monaco.editor.onDidChangeMarkers(() => {
    clearTimeout(timer);
    timer = setTimeout(collect, 150);
  });
  collect();
}

export function useProblems(): Problem[] {
  install();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => problems,
  );
}

/** Errors and warnings, for the status bar and the panel tab. */
export function useProblemCounts(): { errors: number; warnings: number } {
  const list = useProblems();
  return useMemo(
    () => ({
      errors: list.filter((p) => p.severity === monaco.MarkerSeverity.Error).length,
      warnings: list.filter((p) => p.severity === monaco.MarkerSeverity.Warning).length,
    }),
    [list],
  );
}

let nextIndex = 0;
/** F8: opens the next problem of the project. */
export function goToNextProblem(): void {
  install();
  if (!problems.length) return;
  const p = problems[nextIndex % problems.length]!;
  nextIndex++;
  void openFile(p.path, { line: p.line, column: p.column });
}

function sevIcon(s: monaco.MarkerSeverity) {
  if (s === monaco.MarkerSeverity.Error) return <span className="prob-sev err" aria-label={td('probErrors')}>●</span>;
  if (s === monaco.MarkerSeverity.Warning)
    return (
      <span className="prob-sev warn" aria-label={td('probWarnings')}>
        <Icon name="warning" size={12} />
      </span>
    );
  return (
    <span className="prob-sev info" aria-label={td('probInfos')}>
      <Icon name="info" size={12} />
    </span>
  );
}

export function ProblemsView() {
  const list = useProblems();
  const [filter, setFilter] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out = new Map<string, Problem[]>();
    for (const p of list) {
      if (f && !p.message.toLowerCase().includes(f) && !p.path.toLowerCase().includes(f)) continue;
      out.set(p.path, [...(out.get(p.path) ?? []), p]);
    }
    return [...out.entries()];
  }, [list, filter]);
  return (
    <div className="prob-view">
      <div className="prob-bar">
        <input
          className="prob-filter"
          placeholder={td('probFilter')}
          aria-label={td('probFilter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="prob-list" role="tree">
        {groups.length === 0 && <p className="dim small prob-empty">{td('probNone')}</p>}
        {groups.map(([path, items]) => {
          const open = !closed.has(path);
          return (
            <div key={path} role="treeitem" aria-expanded={open}>
              <div
                className="prob-file"
                {...pressable(() =>
                  setClosed((c) => {
                    const n = new Set(c);
                    if (open) n.add(path);
                    else n.delete(path);
                    return n;
                  }),
                )}
              >
                <Icon name={open ? 'chevronDown' : 'chevron'} size={11} />
                <span className="prob-file-name">{path.split('/').pop()}</span>
                <span className="dim small prob-file-dir">{path.split('/').slice(0, -1).join('/')}</span>
                <span className="prob-badge">{items.length}</span>
              </div>
              {open &&
                items.map((p, i) => (
                  <div
                    key={`${p.line}:${p.column}:${i}`}
                    className="prob-row"
                    title={p.message}
                    {...pressable(() => void openFile(p.path, { line: p.line, column: p.column }))}
                  >
                    {sevIcon(p.severity)}
                    <span className="prob-msg">{p.message.split('\n')[0]}</span>
                    {(p.source || p.code) && (
                      <span className="dim small">
                        {p.source}
                        {p.code ? `(${p.code})` : ''}
                      </span>
                    )}
                    <span className="dim small prob-pos">
                      [{p.line}, {p.column}]
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- debug console ----------------

export function DebugConsole() {
  const lines = useDebug((v) => v.console);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [hIndex, setHIndex] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);
  return (
    <div className="dbg-console">
      <div className="dbg-console-out" role="log" aria-live="polite">
        {lines.map((l) => (
          <div key={l.id} className={`dbg-line-out ${l.category}`}>
            {l.category === 'input' ? '› ' : ''}
            {l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="dbg-console-in">
        <span className="dim">›</span>
        <input
          value={input}
          placeholder={td('dbgConsoleHint')}
          aria-label={td('dbgConsoleHint')}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) {
              void evaluateInConsole(input);
              setHistory((h) => [input, ...h.filter((x) => x !== input)].slice(0, 100));
              setHIndex(-1);
              setInput('');
            } else if (e.key === 'ArrowUp' && history.length) {
              e.preventDefault();
              const i = Math.min(history.length - 1, hIndex + 1);
              setHIndex(i);
              setInput(history[i]!);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              const i = hIndex - 1;
              setHIndex(Math.max(-1, i));
              setInput(i >= 0 ? history[i]! : '');
            }
          }}
        />
        <button className="dbg-row-x" title={td('dbgClear')} aria-label={td('dbgClear')} onClick={clearConsole}>
          <Icon name="trash" size={12} />
        </button>
      </div>
    </div>
  );
}
