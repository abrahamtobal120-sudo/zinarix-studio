import { useEffect, useState } from 'react';
import type { DebugConfig, DebugVariable } from '../../shared/devtools';
import { pressable } from '../a11y';
import {
  addWatch,
  children,
  cont,
  getDebug,
  loadConfigs,
  pause,
  refreshWatches,
  removeAllBreakpoints,
  removeWatch,
  restartDebug,
  scopes,
  selectFrame,
  setCondition,
  setConfigIndex,
  startDebug,
  stepInto,
  stepOut,
  stepOver,
  stopDebug,
  toggleBreakpoint,
  useDebug,
  useWatchValues,
} from '../debug';
import { td } from '../i18nDebug';
import { api, askText, getState, openFile, toast, useStore } from '../store';
import { Icon, type IconName } from './Icon';

/** The toolbar shown while a session runs (also used at the top of the editor). */
export function DebugToolbar() {
  const state = useDebug((v) => v.state);
  if (state === 'idle') return null;
  const btn = (icon: IconName, label: string, keys: string, run: () => void, disabled = false) => (
    <button title={`${label} (${keys})`} aria-label={label} disabled={disabled} onClick={run}>
      <Icon name={icon} size={15} />
    </button>
  );
  const stopped = state === 'stopped';
  return (
    <div className="dbg-toolbar" role="toolbar" aria-label={td('dbgTitle')}>
      {stopped
        ? btn('continue', td('dbgContinue'), 'F5', cont)
        : btn('pause', td('dbgPause'), 'F6', pause, state !== 'running')}
      {btn('stepOver', td('dbgStepOver'), 'F10', stepOver, !stopped)}
      {btn('stepInto', td('dbgStepInto'), 'F11', stepInto, !stopped)}
      {btn('stepOut', td('dbgStepOut'), 'Shift+F11', stepOut, !stopped)}
      {btn('refresh', td('dbgRestart'), 'Ctrl+Shift+F5', restartDebug)}
      {btn('stop', td('dbgStop'), 'Shift+F5', stopDebug)}
    </div>
  );
}

function Section({
  title,
  actions,
  children: body,
  initial = true,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  initial?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="dbg-section">
      <div className="dbg-section-head">
        <span className="dbg-section-title" {...pressable(() => setOpen(!open))} aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'chevron'} size={12} /> {title.toUpperCase()}
        </span>
        {open && actions && <span className="sidebar-actions">{actions}</span>}
      </div>
      {open && <div className="dbg-section-body">{body}</div>}
    </section>
  );
}

/** One variable; children load when it is expanded. */
function VarRow({ v, depth }: { v: DebugVariable; depth: number }) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<DebugVariable[] | null>(null);
  const toggle = () => {
    if (!v.ref) return;
    if (!open && !kids)
      void children(v.ref).then(setKids, (e: unknown) => toast(String((e as Error).message ?? e)));
    setOpen(!open);
  };
  return (
    <>
      <div
        className="dbg-var"
        style={{ paddingLeft: 6 + depth * 12 }}
        title={v.type ? `${v.name}: ${v.type}` : v.name}
        {...(v.ref ? pressable(toggle) : {})}
      >
        <span className="dbg-twisty">{v.ref ? <Icon name={open ? 'chevronDown' : 'chevron'} size={11} /> : null}</span>
        <span className="dbg-var-name">{v.name}</span>
        {v.value !== '' && <span className="dbg-var-sep">:</span>}
        <span className="dbg-var-value">{v.value}</span>
      </div>
      {open && kids?.map((k, i) => <VarRow key={`${k.name}:${i}`} v={k} depth={depth + 1} />)}
    </>
  );
}

function Variables() {
  const frameId = useDebug((v) => v.frameId);
  const state = useDebug((v) => v.state);
  const [list, setList] = useState<DebugVariable[]>([]);
  useEffect(() => {
    if (frameId === null || state !== 'stopped') return setList([]);
    let live = true;
    void scopes(frameId).then(
      (s) => live && setList(s),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [frameId, state]);
  if (state !== 'stopped') return <p className="dim small dbg-empty">{td('dbgNotPaused')}</p>;
  // Each scope is a variable whose children are its locals; the first one starts open.
  return (
    <div className="dbg-tree">
      {list.map((s, i) => (
        <ScopeRow key={`${s.name}:${frameId}`} v={s} initial={i === 0} />
      ))}
    </div>
  );
}

function ScopeRow({ v, initial }: { v: DebugVariable; initial: boolean }) {
  const [open, setOpen] = useState(initial);
  const [kids, setKids] = useState<DebugVariable[] | null>(null);
  useEffect(() => {
    if (open && !kids && v.ref) void children(v.ref).then(setKids, () => setKids([]));
  }, [open, kids, v.ref]);
  return (
    <>
      <div className="dbg-var scope" {...pressable(() => setOpen(!open))}>
        <span className="dbg-twisty">
          <Icon name={open ? 'chevronDown' : 'chevron'} size={11} />
        </span>
        <span className="dbg-var-name">{v.name}</span>
      </div>
      {open && kids?.map((k, i) => <VarRow key={`${k.name}:${i}`} v={k} depth={1} />)}
    </>
  );
}

function CallStack() {
  const frames = useDebug((v) => v.frames);
  const frameId = useDebug((v) => v.frameId);
  const state = useDebug((v) => v.state);
  if (state !== 'stopped' || !frames.length)
    return <p className="dim small dbg-empty">{td('dbgNoFrames')}</p>;
  return (
    <div className="dbg-tree">
      {frames.map((f) => (
        <div
          key={f.id}
          className={`dbg-frame ${f.id === frameId ? 'selected' : ''} ${f.path ? '' : 'external'}`}
          title={f.absPath ?? f.path}
          {...pressable(() => void selectFrame(f))}
        >
          <span className="dbg-frame-name">{f.name}</span>
          <span className="dbg-frame-loc dim">
            {(f.path ?? f.absPath ?? '').split(/[\\/]/).pop()}
            {f.line ? `:${f.line}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function Watches() {
  const values = useWatchValues();
  const watches = useDebug((v) => v.watches);
  useEffect(() => {
    void refreshWatches();
  }, [watches.length]);
  return (
    <div className="dbg-tree">
      {values.map((w) => (
        <div key={w.expression} className="dbg-watch">
          {w.value ? (
            <VarRow v={{ ...w.value, name: w.expression }} depth={0} />
          ) : (
            <div className="dbg-var">
              <span className="dbg-twisty" />
              <span className="dbg-var-name">{w.expression}</span>
              <span className="dbg-var-sep">:</span>
              <span className={`dbg-var-value ${w.error ? 'err' : 'dim'}`}>{w.error ?? '—'}</span>
            </div>
          )}
          <button
            className="dbg-row-x"
            title={td('dbgRemove')}
            aria-label={td('dbgRemove')}
            onClick={() => removeWatch(w.expression)}
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Breakpoints() {
  const bps = useDebug((v) => v.breakpoints);
  const verified = useDebug((v) => v.verified);
  const state = useDebug((v) => v.state);
  const rows = Object.entries(bps).flatMap(([path, list]) => list.map((b) => ({ path, ...b })));
  if (!rows.length) return <p className="dim small dbg-empty">{td('dbgNoBreakpoints')}</p>;
  return (
    <div className="dbg-tree">
      {rows.map((b) => {
        const unbound = state !== 'idle' && verified[b.path] && !verified[b.path]!.includes(b.line);
        return (
          <div
            key={`${b.path}:${b.line}`}
            className="dbg-bp-row"
            title={b.condition ? `${b.path}:${b.line} — ${b.condition}` : `${b.path}:${b.line}`}
            {...pressable(() => void openFile(b.path, { line: b.line, column: 1 }))}
          >
            <span className={`dbg-bp-dot ${b.condition ? 'cond' : ''} ${unbound ? 'unbound' : ''}`} />
            <span className="dbg-bp-file">{b.path.split('/').pop()}</span>
            <span className="dim small dbg-bp-line">
              {b.line}
              {b.condition ? ` · ${b.condition}` : ''}
            </span>
            <span className="spacer" />
            <button
              className="dbg-row-x"
              title={td('dbgEditCondition')}
              aria-label={td('dbgEditCondition')}
              onClick={(e) => {
                e.stopPropagation();
                void askText(td('dbgCondition'), b.condition ?? '').then(
                  (c) => c !== null && setCondition(b.path, b.line, c.trim()),
                );
              }}
            >
              <Icon name="edit" size={11} />
            </button>
            <button
              className="dbg-row-x"
              title={td('dbgRemove')}
              aria-label={td('dbgRemove')}
              onClick={(e) => {
                e.stopPropagation();
                toggleBreakpoint(b.path, b.line);
              }}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

const LAUNCH_TEMPLATE = `{
  // Configuraciones de depuración (mismo formato que .vscode/launch.json).
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Node: programa",
      "type": "node",
      "request": "launch",
      "program": "\${workspaceFolder}/index.js"
    },
    {
      "name": "Python: archivo actual",
      "type": "python",
      "request": "launch",
      "program": "\${file}"
    }
  ]
}
`;

async function createLaunch(): Promise<void> {
  const path = '.zinarix/launch.json';
  try {
    await api().workspace.createDir('.zinarix');
  } catch {
    // already there
  }
  try {
    await api().workspace.createFile(path);
    await api().workspace.writeFile(path, LAUNCH_TEMPLATE);
  } catch {
    // exists: just open it
  }
  await openFile(path);
}

export function DebugPanel() {
  const state = useDebug((v) => v.state);
  const name = useDebug((v) => v.name);
  const reason = useDebug((v) => v.reason);
  const configIndex = useDebug((v) => v.configIndex);
  const hasBps = useDebug((v) => Object.keys(v.breakpoints).length > 0);
  const active = useStore((s) => s.active);
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const [configs, setConfigs] = useState<{ configs: DebugConfig[]; file?: string }>({ configs: [] });

  useEffect(() => {
    void loadConfigs().then(setConfigs);
  }, [active, workspace?.root, fsVersion]);

  const fromLaunch = Boolean(configs.file);
  const label =
    state === 'idle'
      ? td('dbgIdle')
      : state === 'starting'
        ? td('dbgStarting')
        : state === 'running'
          ? td('dbgRunning')
          : td('dbgStopped', { reason: reason ?? '' });

  return (
    <div className="run-panel dbg-panel">
      <div className="sidebar-title">
        <span>{td('dbgTitle').toUpperCase()}</span>
        <span className="sidebar-actions">
          <button
            title={td('dbgCreateLaunch')}
            aria-label={td('dbgCreateLaunch')}
            disabled={!workspace}
            onClick={() => void createLaunch()}
          >
            <Icon name="settings" size={14} />
          </button>
        </span>
      </div>
      <div className="dbg-start">
        {state === 'idle' ? (
          <>
            <button
              className="primary dbg-start-btn"
              disabled={!workspace}
              title={`${td('dbgStart')} (F5)`}
              onClick={() => void startDebug()}
            >
              <Icon name="play" size={14} /> {fromLaunch ? td('dbgStart') : td('dbgStartFile')}
            </button>
            {fromLaunch && configs.configs.length > 0 && (
              <select
                className="dbg-config"
                aria-label={td('dbgConfig')}
                value={Math.max(0, configIndex)}
                onChange={(e) => setConfigIndex(Number(e.target.value))}
              >
                {configs.configs.map((c, i) => (
                  <option key={`${c.name}:${i}`} value={i}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {!fromLaunch && configs.configs[0] && (
              <p className="dim small">{td('dbgAutoConfig')}: {configs.configs[0].type}</p>
            )}
          </>
        ) : (
          <>
            <DebugToolbar />
            <p className="dim small dbg-status">
              {name ? <strong>{name}</strong> : null} {label}
            </p>
          </>
        )}
        {state === 'idle' && <p className="dim small">{label}</p>}
      </div>
      <div className="dbg-sections">
        <Section title={td('dbgVariables')}>
          <Variables />
        </Section>
        <Section
          title={td('dbgWatch')}
          actions={
            <button
              title={td('dbgWatchAdd')}
              aria-label={td('dbgWatchAdd')}
              onClick={() =>
                void askText(td('dbgWatchPrompt')).then((e) => e !== null && addWatch(e))
              }
            >
              <Icon name="plus" size={13} />
            </button>
          }
        >
          <Watches />
        </Section>
        <Section title={td('dbgCallStack')}>
          <CallStack />
        </Section>
        <Section
          title={td('dbgBreakpoints')}
          actions={
            hasBps ? (
              <button
                title={td('dbgRemoveAll')}
                aria-label={td('dbgRemoveAll')}
                onClick={() => removeAllBreakpoints()}
              >
                <Icon name="trash" size={13} />
              </button>
            ) : null
          }
        >
          <Breakpoints />
        </Section>
      </div>
    </div>
  );
}

/** For the command palette when the panel is not shown. */
export function debugBusy(): boolean {
  return getDebug().state !== 'idle';
}
export { getState as _unusedGetState };
