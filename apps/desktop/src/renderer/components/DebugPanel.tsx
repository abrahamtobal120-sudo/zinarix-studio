import './debug.css';
import { useEffect, useState } from 'react';
import type { DebugConfig, DebugFrame, DebugVariable } from '../../shared/devtools';
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
  setLogMessage,
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
import { td, type DebugKey } from '../i18nDebug';
import { api, askText, attachToChat, openFile, toast, useStore } from '../store';
import { Icon, type IconName } from './Icon';

/**
 * The toolbar shown while a session runs: compact icons over the editor, or (labelled) big
 * buttons with their name and shortcut in the Debug panel.
 */
export function DebugToolbar({ labelled = false }: { labelled?: boolean }) {
  const state = useDebug((v) => v.state);
  if (state === 'idle') return null;
  const btn = (
    cls: string,
    icon: IconName,
    label: string,
    keys: string,
    tip: string,
    run: () => void,
    disabled = false,
  ) => (
    <button
      className={`dbg-tb-${cls}`}
      title={`${label} (${keys})\n${tip}`}
      aria-label={`${label} (${keys})`}
      disabled={disabled}
      onClick={run}
    >
      <Icon name={icon} size={labelled ? 16 : 15} />
      {labelled && (
        <>
          <span className="dbg-tb-label">{label}</span>
          <kbd className="dbg-tb-keys">{keys}</kbd>
        </>
      )}
    </button>
  );
  const stopped = state === 'stopped';
  return (
    <div
      className={`dbg-toolbar ${labelled ? 'labelled' : ''}`}
      role="toolbar"
      aria-label={td('dbgTitle')}
    >
      {stopped
        ? btn('go', 'continue', td('dbgContinue'), 'F5', td('dbgTipContinue'), cont)
        : btn('go', 'pause', td('dbgPause'), 'F6', td('dbgTipPause'), pause, state !== 'running')}
      {btn('step', 'stepOver', td('dbgStepOver'), 'F10', td('dbgTipStepOver'), stepOver, !stopped)}
      {btn(
        'step',
        'stepInto',
        td('dbgStepIntoShort'),
        'F11',
        td('dbgTipStepInto'),
        stepInto,
        !stopped,
      )}
      {btn(
        'step',
        'stepOut',
        td('dbgStepOutShort'),
        'Shift+F11',
        td('dbgTipStepOut'),
        stepOut,
        !stopped,
      )}
      {btn(
        'restart',
        'refresh',
        td('dbgRestart'),
        'Ctrl+Shift+F5',
        td('dbgTipRestart'),
        restartDebug,
      )}
      {btn('stop', 'stop', td('dbgStop'), 'Shift+F5', td('dbgTipStop'), stopDebug)}
    </div>
  );
}

function Section({
  title,
  help,
  count,
  actions,
  children: body,
  initial = true,
}: {
  title: string;
  /** One line on what the section is for, shown under the heading while it is open. */
  help?: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  initial?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section className={`dbg-section ${open ? 'open' : ''}`}>
      <div className="dbg-section-head">
        <span
          className="dbg-section-title"
          {...pressable(() => setOpen(!open))}
          aria-expanded={open}
        >
          <Icon name={open ? 'chevronDown' : 'chevron'} size={12} /> {title}
          {count ? <span className="dbg-count">{count}</span> : null}
        </span>
        {open && actions && <span className="sidebar-actions">{actions}</span>}
      </div>
      {open && help && <p className="dbg-help">{help}</p>}
      {open && <div className="dbg-section-body">{body}</div>}
    </section>
  );
}

/** "app.py:42" for a frame. */
function frameLoc(f: DebugFrame | undefined): string {
  if (!f) return '';
  const file = (f.path ?? f.absPath ?? '').split(/[\\/]/).pop() ?? '';
  return file ? `${file}${f.line ? `:${f.line}` : ''}` : f.name;
}

const REASONS: Record<string, DebugKey> = {
  breakpoint: 'dbgReasonBreakpoint',
  'function breakpoint': 'dbgReasonBreakpoint',
  'data breakpoint': 'dbgReasonBreakpoint',
  step: 'dbgReasonStep',
  exception: 'dbgReasonException',
  pause: 'dbgReasonPause',
  entry: 'dbgReasonEntry',
  goto: 'dbgReasonStep',
};

/** Why the program stopped, in plain words. */
function reasonText(reason: string | undefined): string {
  if (!reason) return td('dbgReasonPause');
  const key = REASONS[reason.toLowerCase()];
  return key ? td(key) : reason;
}

/**
 * Attaches where the program is paused (location, code around it, call stack, variables of
 * the innermost scope) to the chat, asking the AI to explain it.
 */
async function askAiWherePaused(): Promise<void> {
  const v = getDebug();
  const frame = v.frames.find((f) => f.id === v.frameId) ?? v.frames[0];
  if (v.state !== 'stopped' || !frame) return;
  const parts: string[] = [td('dbgAiPrompt')];
  parts.push(
    `${td('dbgAiWhere')}: ${frame.path ?? frame.absPath ?? '?'}:${frame.line} (${frame.name}) — ${reasonText(v.reason)}${v.description ? `: ${v.description}` : ''}`,
  );
  if (frame.path) {
    try {
      const f = await api().workspace.readFile(frame.path);
      if (!f.binary && !f.tooLarge) {
        const lines = f.content.split(/\r?\n/);
        const from = Math.max(0, frame.line - 8);
        const to = Math.min(lines.length, frame.line + 7);
        const code = lines
          .slice(from, to)
          .map(
            (l, i) =>
              `${from + i + 1 === frame.line ? '>' : ' '} ${String(from + i + 1).padStart(4)} | ${l}`,
          )
          .join('\n');
        parts.push(`${td('dbgAiCode')}:\n\`\`\`\n${code}\n\`\`\``);
      }
    } catch {
      // the code is optional context
    }
  }
  parts.push(
    `${td('dbgCallStack')}:\n${v.frames
      .slice(0, 12)
      .map((f) => `- ${f.name} (${frameLoc(f)})`)
      .join('\n')}`,
  );
  try {
    const sc = await scopes(frame.id);
    const first = sc[0];
    if (first?.ref) {
      const vars = (await children(first.ref)).slice(0, 40);
      if (vars.length)
        parts.push(
          `${td('dbgVariables')} (${first.name}):\n${vars
            .map((x) => `- ${x.name}${x.type ? `: ${x.type}` : ''} = ${x.value.slice(0, 200)}`)
            .join('\n')}`,
        );
    }
  } catch {
    // variables are optional context
  }
  attachToChat({ source: 'debug:paused', content: parts.join('\n\n') });
  toast(td('dbgAiAttached'));
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
        <span className="dbg-twisty">
          {v.ref ? <Icon name={open ? 'chevronDown' : 'chevron'} size={11} /> : null}
        </span>
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
  if (!values.length) return <p className="dim small dbg-empty">{td('dbgNoWatches')}</p>;
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
            title={`${b.path}:${b.line}${b.condition ? ` — ${b.condition}` : ''}${b.logMessage ? ` — ${td('dbgLogpoint')}: ${b.logMessage}` : ''}`}
            {...pressable(() => void openFile(b.path, { line: b.line, column: 1 }))}
          >
            <span
              className={`dbg-bp-dot ${b.logMessage ? 'log' : b.condition ? 'cond' : ''} ${unbound ? 'unbound' : ''}`}
            />
            <span className="dbg-bp-file">{b.path.split('/').pop()}</span>
            <span className="dim small dbg-bp-line">
              {b.line}
              {b.condition ? ` · ${b.condition}` : ''}
              {b.logMessage ? ` · ✎ ${b.logMessage}` : ''}
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
              title={td('dbgEditLogpoint')}
              aria-label={td('dbgEditLogpoint')}
              onClick={(e) => {
                e.stopPropagation();
                void askText(td('dbgLogpointAsk'), b.logMessage ?? '').then(
                  (m) => m !== null && setLogMessage(b.path, b.line, m),
                );
              }}
            >
              <Icon name="message" size={11} />
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
  const description = useDebug((v) => v.description);
  const frames = useDebug((v) => v.frames);
  const frameId = useDebug((v) => v.frameId);
  const configIndex = useDebug((v) => v.configIndex);
  const bpCount = useDebug((v) => Object.values(v.breakpoints).reduce((n, l) => n + l.length, 0));
  const watchCount = useDebug((v) => v.watches.length);
  const active = useStore((s) => s.active);
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const [configs, setConfigs] = useState<{ configs: DebugConfig[]; file?: string }>({
    configs: [],
  });
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    void loadConfigs().then(setConfigs);
  }, [active, workspace?.root, fsVersion]);

  const fromLaunch = Boolean(configs.file);
  const activeFile = active && !active.startsWith('::') ? active : null;
  const current = frames.find((f) => f.id === frameId) ?? frames[0];
  const where = frameLoc(current);

  const title =
    state === 'idle'
      ? td('dbgHeadIdle')
      : state === 'starting'
        ? td('dbgStarting')
        : state === 'running'
          ? td('dbgRunning')
          : where
            ? td('dbgHeadPaused', { loc: where })
            : td('dbgHeadPausedNoLoc');
  const subtitle =
    state === 'idle'
      ? td('dbgHeadIdleHint')
      : state === 'starting'
        ? td('dbgHeadStartingHint')
        : state === 'running'
          ? td('dbgHeadRunningHint')
          : `${reasonText(reason)}${description ? `: ${description}` : ''}`;

  const startLabel = fromLaunch ? td('dbgStart') : td('dbgStartFile');

  return (
    <div className="run-panel dbg-panel">
      <div className="sidebar-title">
        <span>{td('dbgTitle')}</span>
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

      <div className={`dbg-head dbg-head-${state}`} role="status" aria-live="polite">
        <span className="dbg-head-dot" aria-hidden="true" />
        <div className="dbg-head-text">
          <div className="dbg-head-title">
            {state === 'stopped' && current?.path ? (
              <span
                className="dbg-head-loc"
                title={td('dbgGoToLine')}
                {...pressable(() => void selectFrame(current))}
              >
                {title}
              </span>
            ) : (
              title
            )}
          </div>
          <div className="dbg-head-sub">
            {name && state !== 'idle' ? <strong>{name} · </strong> : null}
            {subtitle}
          </div>
        </div>
      </div>

      <div className="dbg-start">
        {state === 'idle' ? (
          <>
            <ol className="dbg-steps">
              <li className={bpCount > 0 ? 'done' : ''}>
                <span className="dbg-step-n">
                  {bpCount > 0 ? <Icon name="check" size={11} /> : 1}
                </span>
                <span>
                  {td('dbgStep1')}
                  {bpCount > 0 && (
                    <span className="dbg-step-ok"> {td('dbgStep1Done', { n: bpCount })}</span>
                  )}
                </span>
              </li>
              <li>
                <span className="dbg-step-n">2</span>
                <span>{td('dbgStep2', { start: startLabel })}</span>
              </li>
              <li>
                <span className="dbg-step-n">3</span>
                <span>{td('dbgStep3')}</span>
              </li>
            </ol>
            <button
              className="primary dbg-start-btn"
              disabled={!workspace}
              title={`${startLabel} (F5)`}
              onClick={() => void startDebug()}
            >
              <Icon name="play" size={14} /> {startLabel}
              <kbd className="dbg-tb-keys">F5</kbd>
            </button>
            {fromLaunch && configs.configs.length > 0 && (
              <label className="dbg-config-row">
                <span className="dim small">{td('dbgConfig')}</span>
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
              </label>
            )}
            {!fromLaunch && (
              <p className="dim small dbg-target">
                {activeFile
                  ? td('dbgWillDebug', { file: activeFile.split('/').pop() ?? activeFile })
                  : td('dbgOpenFileFirst')}
                {activeFile && configs.configs[0] ? ` (${configs.configs[0].type})` : ''}
              </p>
            )}
          </>
        ) : (
          <>
            <DebugToolbar labelled />
            {state === 'stopped' && (
              <button
                className="dbg-ai"
                disabled={asking}
                onClick={() => {
                  setAsking(true);
                  void askAiWherePaused().finally(() => setAsking(false));
                }}
              >
                <Icon name="message" size={14} /> {td('dbgAiExplain')}
              </button>
            )}
          </>
        )}
      </div>

      <div className="dbg-sections">
        {state !== 'idle' && (
          <Section title={td('dbgVariables')} help={td('dbgHelpVariables')}>
            <Variables />
          </Section>
        )}
        <Section
          title={td('dbgWatch')}
          help={td('dbgHelpWatch')}
          count={watchCount}
          initial={state !== 'idle' || watchCount > 0}
          actions={
            <button
              title={td('dbgWatchAdd')}
              aria-label={td('dbgWatchAdd')}
              onClick={() =>
                void askText(td('dbgWatchPrompt')).then(
                  (e) => e !== null && e.trim() && addWatch(e.trim()),
                )
              }
            >
              <Icon name="plus" size={13} />
            </button>
          }
        >
          <Watches />
        </Section>
        {state !== 'idle' && (
          <Section title={td('dbgCallStack')} help={td('dbgHelpCallStack')}>
            <CallStack />
          </Section>
        )}
        <Section
          title={td('dbgBreakpoints')}
          help={td('dbgHelpBreakpoints')}
          count={bpCount}
          actions={
            bpCount > 0 ? (
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
