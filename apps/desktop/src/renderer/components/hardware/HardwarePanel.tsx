import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmDialog } from '../../confirm';
import { openLink } from '../../links';
import { api, openFile, toast, useStore } from '../../store';
import { askAgent } from '../Chat';
import { Icon } from '../Icon';
import { runInTerminal } from '../Terminal';
import { AnsiText } from '../notebook/Ansi';
import {
  BAUD_RATES,
  lineEnding,
  problemPath,
  type PioBoard,
  type PioDevice,
  type PioProject,
  type PioResult,
  type PioStatus,
  type PioTarget,
} from '../../../shared/platformio';
import { PlotData } from '../../../shared/serialPlot';
import { LibrariesBox } from './LibrariesBox';
import { SerialPlot } from './SerialPlot';
import { th } from './hardwareStrings';
import './hardware.css';

/**
 * Hardware panel (Fase 5A del plan de funciones): the PlatformIO projects of the open folder
 * (platformio.ini), build / upload / clean with live output, compiler errors that open the
 * file at the line, RAM and Flash use, the serial ports and a serial monitor (the same one
 * the AI reads with serial_monitor), and a new project for any board PlatformIO knows.
 */

const JOB = 'hw-job';
const MAX_OUT = 600_000;
const MAX_LINES = 5000;

type Ending = 'nl' | 'cr' | 'crlf' | 'none';
interface Line {
  t: number;
  s: string;
}

const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const pref = (k: string, d: string) => localStorage.getItem(`zs.hw.${k}`) ?? d;
const setPref = (k: string, v: string) => localStorage.setItem(`zs.hw.${k}`, v);

export function HardwarePanel() {
  const root = useStore((s) => s.workspace?.root ?? null);
  const [status, setStatus] = useState<PioStatus | null>(null);
  const [projects, setProjects] = useState<PioProject[]>([]);
  const [dir, setDir] = useState<string>('');
  const [env, setEnv] = useState<string>('');
  const [devices, setDevices] = useState<PioDevice[]>([]);
  const [port, setPort] = useState<string>(() => pref('port', ''));
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (force = false) => {
      const st = await api().pio.status(force).catch((): PioStatus => ({ state: 'missing' }));
      setStatus(st);
      if (st.state !== 'ready') return;
      const [ps, ds] = await Promise.all([
        api().pio.projects().catch(() => [] as PioProject[]),
        api().pio.devices().catch(() => [] as PioDevice[]),
      ]);
      setProjects(ps);
      setDevices(ds);
    },
    [],
  );
  useEffect(() => {
    void load();
  }, [load, root]);

  const project = projects.find((p) => p.dir === dir) ?? projects[0] ?? null;
  useEffect(() => {
    if (!project) return;
    if (project.dir !== dir) setDir(project.dir);
    if (!project.envs.some((e) => e.name === env))
      setEnv(project.defaultEnvs[0] ?? project.envs[0]?.name ?? '');
  }, [project, dir, env]);
  const envInfo = project?.envs.find((e) => e.name === env) ?? null;

  const refreshPorts = () =>
    void api()
      .pio.devices()
      .then(setDevices)
      .catch((e) => toast(th('error', { err: errText(e) })));

  const choosePort = (p: string) => {
    setPort(p);
    setPref('port', p);
  };

  return (
    <div className="explorer hw-panel">
      <div className="sidebar-title">
        <span className="panel-title">
          HARDWARE
          {status?.state === 'ready' && <span className="hw-version">{th('version', { v: status.version.replace(/\.post\d+$/, '') })}</span>}
        </span>
        <span className="sidebar-actions">
          {status?.state === 'ready' && root && (
            <button title={th('newProject')} aria-label={th('newProject')} onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} />
            </button>
          )}
          <button title={th('refresh')} aria-label={th('refresh')} onClick={() => void load(true)}>
            <Icon name="refresh" size={15} />
          </button>
        </span>
      </div>
      {!status ? (
        <div className="hw-empty">{th('loading')}</div>
      ) : status.state === 'missing' ? (
        <div className="hw-empty">
          <p>{th('missing')}</p>
          <code className="hw-cmd">{th('installCmd')}</code>
          <div className="hw-row-btns">
            <button className="btn" onClick={() => void runInTerminal(th('installCmd'))}>
              {th('install')}
            </button>
            <button className="btn ghost" onClick={() => openLink('https://docs.platformio.org/en/latest/core/installation/index.html')}>
              {th('docs')}
            </button>
            <button className="btn ghost" onClick={() => void load(true)}>
              {th('recheck')}
            </button>
          </div>
        </div>
      ) : !root ? (
        <div className="hw-empty">{th('noFolder')}</div>
      ) : creating ? (
        <NewProject
          onCancel={() => setCreating(false)}
          onCreated={(d) => {
            setCreating(false);
            setDir(d);
            void load();
          }}
        />
      ) : !project ? (
        <div className="hw-empty">
          <p>{th('noProjects')}</p>
          <button className="btn" onClick={() => setCreating(true)}>
            {th('newProject')}
          </button>
        </div>
      ) : (
        <div className="hw-body">
          <div className="hw-fields">
            {projects.length > 1 && (
              <label className="hw-field">
                <span>{th('project')}</span>
                <select value={project.dir} onChange={(e) => setDir(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.dir} value={p.dir}>
                      {p.dir || '.'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="hw-field">
              <span>{th('env')}</span>
              <select value={env} onChange={(e) => setEnv(e.target.value)}>
                {project.envs.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            {envInfo && (
              <div className="hw-envinfo" title={envInfo.framework}>
                {th('envInfo', { board: envInfo.board || '?', platform: envInfo.platform || '?' })}
              </div>
            )}
            <label className="hw-field">
              <span>{th('port')}</span>
              <select value={port} onChange={(e) => choosePort(e.target.value)}>
                <option value="">{th('autoPort')}</option>
                {devices.map((d) => (
                  <option key={d.port} value={d.port}>
                    {d.port} — {d.description}
                    {d.board ? '' : ` (${th('notBoard')})`}
                  </option>
                ))}
                {port && !devices.some((d) => d.port === port) && <option value={port}>{port}</option>}
              </select>
              <button className="icon-btn" title={th('refreshPorts')} aria-label={th('refreshPorts')} onClick={refreshPorts}>
                <Icon name="refresh" size={13} />
              </button>
            </label>
            {!devices.length && <div className="hw-hint">{th('noPorts')}</div>}
          </div>
          <BuildBox project={project} env={env} port={port} onDone={() => void load()} />
          <LibrariesBox project={project} env={env} onChanged={() => void load()} />
          <SerialMonitor
            port={port}
            devices={devices}
            defaultBaud={envInfo?.monitorSpeed ?? 9600}
            pioBin={status.bin}
          />
        </div>
      )}
    </div>
  );
}

/** Build / upload / clean buttons, live output, memory and problems. */
function BuildBox({ project, env, port, onDone }: { project: PioProject; env: string; port: string; onDone: () => void }) {
  const [out, setOut] = useState('');
  const [running, setRunning] = useState<PioTarget | null>(null);
  const [result, setResult] = useState<PioResult | null>(null);
  const [stopped, setStopped] = useState(false);
  const [showOut, setShowOut] = useState(() => pref('showOut', '1') === '1');
  const pre = useRef<HTMLPreElement>(null);
  const lastTarget = useRef<PioTarget>('build');

  useEffect(
    () =>
      api().on((ev) => {
        if (ev.type !== 'pio') return;
        const e = ev.event;
        if (e.kind === 'job-data' && e.key === JOB)
          setOut((t) => {
            const next = t + e.chunk;
            return next.length > MAX_OUT ? next.slice(next.length - MAX_OUT) : next;
          });
        else if (e.kind === 'job-end' && e.key === JOB) {
          setRunning(null);
          void api()
            .pio.lastResult(JOB)
            .then((r) => {
              setResult(r);
              if (r?.ok && lastTarget.current === 'compiledb') toast(th('compileDbOn'));
            });
          onDone();
        }
      }),
    [onDone],
  );
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [out, showOut]);
  useEffect(() => () => void api().pio.stopJob(JOB).catch(() => undefined), []);

  const start = async (target: PioTarget) => {
    if (target === 'upload') {
      const ok = await confirmDialog(th('uploadAsk', { port: port ? ` (${port})` : '' }), { okLabel: th('uploadGo') });
      if (!ok) return;
    }
    lastTarget.current = target;
    setOut('');
    setResult(null);
    setStopped(false);
    setRunning(target);
    try {
      await api().pio.startJob(JOB, { dir: project.dir, env: env || null, target, port: port || null });
    } catch (e) {
      setRunning(null);
      setOut(`${errText(e)}\n`);
      setResult({ ok: false, problems: [], memory: null, seconds: null });
    }
  };

  const errors = result?.problems.filter((p) => p.severity === 'error') ?? [];
  const fix = () => {
    const list = (result?.problems ?? [])
      .slice(0, 40)
      .map((p) => `${p.severity}: ${problemPath(project.dir, p.file) ?? p.file}:${p.line}:${p.column}: ${p.message}`)
      .join('\n');
    askAgent(th('fixPrompt', { dir: project.dir || '.', env: env || '-', errors: list }));
  };

  return (
    <div className="hw-section">
      <div className="hw-actions">
        <button className="btn" disabled={!!running} onClick={() => void start('build')} title="pio run">
          <Icon name="check" size={13} /> {th('build')}
        </button>
        <button className="btn" disabled={!!running} onClick={() => void start('upload')} title="pio run -t upload">
          <Icon name="bolt" size={13} /> {th('upload')}
        </button>
        <button className="btn ghost" disabled={!!running} onClick={() => void start('clean')} title="pio run -t clean">
          <Icon name="trash" size={13} /> {th('clean')}
        </button>
        {running && (
          <button
            className="btn ghost"
            onClick={() => {
              setStopped(true);
              void api().pio.stopJob(JOB);
            }}
          >
            <Icon name="stop" size={13} /> {th('stop')}
          </button>
        )}
        <div className="spacer" />
        <button
          className={`btn ghost hw-small ${project.compileDb ? 'on' : ''}`}
          disabled={!!running}
          title={th('compileDbTip')}
          onClick={() => void start('compiledb')}
        >
          <Icon name="code" size={12} /> {th('compileDb')}
          {project.compileDb ? ' ✓' : ''}
        </button>
      </div>
      {(running || result) && (
        <div className={`hw-status ${running ? 'busy' : result?.ok ? 'ok' : 'bad'}`} role="status">
          {running
            ? th('running')
            : stopped
              ? th('stopped')
              : result?.ok
                ? result.seconds != null
                  ? th('ok', { s: result.seconds.toFixed(1) })
                  : th('okNoTime')
                : th('failed')}
        </div>
      )}
      {result?.memory && (
        <div className="hw-mem">
          <MemBar label={th('ram')} used={result.memory.ramUsed} total={result.memory.ramTotal} />
          <MemBar label={th('flash')} used={result.memory.flashUsed} total={result.memory.flashTotal} />
        </div>
      )}
      {result && result.problems.length > 0 && (
        <div className="hw-problems">
          <div className="hw-subtitle">
            {th('problems')} ({result.problems.length})
            <div className="spacer" />
            {errors.length > 0 && (
              <button className="btn hw-small" title={th('fixAiTip')} onClick={fix}>
                <Icon name="sparkle" size={13} /> {th('fixAi')}
              </button>
            )}
          </div>
          {result.problems.slice(0, 200).map((p, i) => {
            const rel = problemPath(project.dir, p.file);
            return (
              <button
                key={i}
                className={`hw-problem ${p.severity}`}
                disabled={!rel}
                title={rel ?? `${p.file} ${th('outside')}`}
                onClick={() => rel && void openFile(rel, { line: p.line, column: p.column })}
              >
                <Icon name={p.severity === 'error' ? 'warning' : 'info'} size={12} />
                <span className="hw-pmsg">{p.message}</span>
                <span className="hw-ploc">
                  {(rel ?? p.file).split('/').pop()}:{p.line}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {(out || running) && (
        <div className="hw-out">
          <div className="hw-subtitle">
            <button
              className="hw-toggle"
              aria-expanded={showOut}
              onClick={() => {
                setShowOut(!showOut);
                setPref('showOut', showOut ? '0' : '1');
              }}
            >
              <Icon name={showOut ? 'chevronDown' : 'chevron'} size={12} /> {th('output')}
            </button>
            <div className="spacer" />
            <button className="icon-btn" title={th('clearOut')} aria-label={th('clearOut')} onClick={() => setOut('')}>
              <Icon name="trash" size={12} />
            </button>
          </div>
          {showOut && (
            <pre className="hw-log" ref={pre}>
              <AnsiText text={out} />
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function MemBar({ label, used, total }: { label: string; used: number; total: number }) {
  if (!total) return null;
  const pct = Math.min(100, (used / total) * 100);
  return (
    <div className="hw-membar" title={`${used.toLocaleString()} / ${total.toLocaleString()} bytes`}>
      <span className="hw-memlabel">{label}</span>
      <span className="hw-memtrack">
        <span className={`hw-memfill ${pct > 90 ? 'hot' : pct > 75 ? 'warm' : ''}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="hw-memval">
        {pct.toFixed(1)}% · {(used / 1024).toFixed(1)}/{(total / 1024).toFixed(0)} KB
      </span>
    </div>
  );
}

/** Splits incoming text into timed lines (a chunk can end in the middle of one). */
function addChunk(lines: Line[], chunk: string, now: number): Line[] {
  const parts = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const next = lines.slice();
  const last = next[next.length - 1];
  if (last && !last.s.endsWith('\n')) next[next.length - 1] = { t: last.t, s: last.s + parts[0] };
  else next.push({ t: now, s: parts[0]! });
  for (let i = 1; i < parts.length; i++) {
    const prev = next[next.length - 1]!;
    next[next.length - 1] = { t: prev.t, s: `${prev.s}\n` };
    next.push({ t: now, s: parts[i]! });
  }
  if (next.length && next[next.length - 1]!.s === '') next.pop();
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

const clock = (t: number) => {
  const d = new Date(t);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

function SerialMonitor({
  port: chosen,
  devices,
  defaultBaud,
  pioBin,
}: {
  port: string;
  devices: PioDevice[];
  defaultBaud: number;
  pioBin: string;
}) {
  const [openPort, setOpenPort] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [baud, setBaud] = useState<number>(() => Number(pref('baud', '0')) || defaultBaud);
  const [ending, setEnding] = useState<Ending>(() => pref('ending', 'nl') as Ending);
  const [stamps, setStamps] = useState(() => pref('stamps', '0') === '1');
  const [follow, setFollow] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  const history = useRef<string[]>([]);
  const hpos = useRef(-1);
  const [view, setView] = useState<'text' | 'plot'>(() => (pref('view', 'text') === 'plot' ? 'plot' : 'text'));
  const plot = useRef(new PlotData(2000));
  const [ptick, setPtick] = useState(0);
  const frame = useRef(0);
  // New numbers redraw the plot at most once per frame.
  const replot = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setPtick((t) => t + 1);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The port of the monitor: the chosen one, else the only board plugged in.
  const target = chosen || (devices.filter((d) => d.board).length === 1 ? devices.find((d) => d.board)!.port : '');

  useEffect(() => {
    if (!pref('baud', '')) setBaud(defaultBaud);
  }, [defaultBaud]);

  // A monitor may already be open (another window, or the AI opened it).
  useEffect(() => {
    void api()
      .pio.serialState()
      .then((list) => {
        const cur = list[0];
        if (!cur) return;
        setOpenPort(cur.port);
        setBaud(cur.baud);
        setLines(addChunk([], cur.text, Date.now()));
        plot.current.push(cur.text);
        replot();
      })
      .catch(() => undefined);
    return api().on((ev) => {
      if (ev.type !== 'pio') return;
      const e = ev.event;
      if (e.kind === 'serial-data') {
        setOpenPort((p) => p ?? e.port);
        setLines((l) => addChunk(l, e.chunk, Date.now()));
        if (plot.current.push(e.chunk)) replot();
      } else if (e.kind === 'serial-state') {
        if (e.open) setOpenPort(e.port);
        else {
          setOpenPort((p) => (p === e.port ? null : p));
          if (e.error) toast(th('portClosed', { port: e.port, why: `: ${e.error}` }));
        }
      }
    });
  }, [replot]);

  useEffect(() => {
    if (follow && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [lines, follow, stamps]);

  const open = async () => {
    if (!target) return toast(th('pickPort'));
    setBusy(true);
    try {
      await api().pio.serialOpen(target, baud);
      setOpenPort(target);
    } catch (e) {
      toast(th('error', { err: errText(e) }));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (openPort) void api().pio.serialClose(openPort);
    setOpenPort(null);
  };
  const send = async () => {
    if (!openPort || !input) return;
    try {
      await api().pio.serialWrite(openPort, lineEnding(input, ending));
      history.current = [input, ...history.current.filter((h) => h !== input)].slice(0, 50);
      hpos.current = -1;
      setInput('');
    } catch (e) {
      toast(th('error', { err: errText(e) }));
    }
  };

  const text = useMemo(
    () => (stamps ? lines.map((l) => `${clock(l.t)} → ${l.s}`).join('') : lines.map((l) => l.s).join('')),
    [lines, stamps],
  );

  return (
    <div className="hw-section hw-monitor">
      <div className="hw-subtitle">
        <Icon name="plug" size={13} /> {th('monitor')}
        {openPort && <span className="hw-live">● {openPort}</span>}
        <div className="spacer" />
        <select
          className="hw-baud"
          aria-label={th('baud')}
          title={th('baud')}
          value={baud}
          disabled={!!openPort}
          onChange={(e) => {
            setBaud(Number(e.target.value));
            setPref('baud', e.target.value);
          }}
        >
          {[...new Set([...BAUD_RATES, baud])].sort((a, b) => a - b).map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        {openPort ? (
          <button className="btn hw-small" onClick={close}>
            {th('close')}
          </button>
        ) : (
          <button className="btn hw-small" disabled={busy} title={th('openTip')} onClick={() => void open()}>
            {th('open')}
          </button>
        )}
      </div>
      <div className="hw-montools">
        <div className="hw-seg" role="group" aria-label={th('monitorView')}>
          {(['text', 'plot'] as const).map((v) => (
            <button
              key={v}
              className={view === v ? 'on' : ''}
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                setPref('view', v);
              }}
            >
              <Icon name={v === 'text' ? 'terminal' : 'chart'} size={11} /> {th(v === 'text' ? 'viewText' : 'viewPlot')}
            </button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={stamps}
            onChange={(e) => {
              setStamps(e.target.checked);
              setPref('stamps', e.target.checked ? '1' : '0');
            }}
          />{' '}
          {th('timestamps')}
        </label>
        <label>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {th('autoscroll')}
        </label>
        <div className="spacer" />
        <button
          className="icon-btn"
          title={th('clear')}
          aria-label={th('clear')}
          onClick={() => {
            setLines([]);
            plot.current.clear();
            replot();
            if (openPort) void api().pio.serialClear(openPort);
          }}
        >
          <Icon name="trash" size={12} />
        </button>
        <button
          className="icon-btn"
          title={th('inTerminal')}
          aria-label={th('inTerminal')}
          disabled={!target}
          onClick={() => {
            if (openPort) close();
            const bin = /\s/.test(pioBin) ? `& "${pioBin}"` : pioBin;
            void runInTerminal(`${bin} device monitor -p ${target} -b ${baud}`);
          }}
        >
          <Icon name="terminal" size={12} />
        </button>
      </div>
      {view === 'plot' ? (
        <SerialPlot data={plot.current} tick={ptick} />
      ) : (
      <pre
        className="hw-serial"
        ref={pre}
        aria-live="off"
        onWheel={(e) => {
          if (e.deltaY < 0) setFollow(false);
        }}
      >
        {text ? <AnsiText text={text} /> : <span className="hw-dim">{openPort ? th('monitorEmpty') : th('monitorClosed')}</span>}
      </pre>
      )}
      <div className="hw-send">
        <input
          value={input}
          placeholder={th('sendPh')}
          aria-label={th('sendPh')}
          disabled={!openPort}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
            else if (e.key === 'ArrowUp' && history.current.length) {
              hpos.current = Math.min(history.current.length - 1, hpos.current + 1);
              setInput(history.current[hpos.current]!);
              e.preventDefault();
            } else if (e.key === 'ArrowDown') {
              hpos.current = Math.max(-1, hpos.current - 1);
              setInput(hpos.current < 0 ? '' : history.current[hpos.current]!);
              e.preventDefault();
            }
          }}
        />
        <select
          aria-label={th('ending')}
          title={th('ending')}
          value={ending}
          onChange={(e) => {
            setEnding(e.target.value as Ending);
            setPref('ending', e.target.value);
          }}
        >
          <option value="nl">{th('endNl')}</option>
          <option value="cr">{th('endCr')}</option>
          <option value="crlf">{th('endCrlf')}</option>
          <option value="none">{th('endNone')}</option>
        </select>
        <button className="btn hw-small" disabled={!openPort || !input} onClick={() => void send()}>
          {th('send')}
        </button>
      </div>
    </div>
  );
}

const QUICK = ['uno', 'nanoatmega328', 'esp32dev', 'esp32-s3-devkitc-1', 'pico', 'bluepill_f103c8', 'nodemcuv2'];

function NewProject({ onCancel, onCreated }: { onCancel: () => void; onCreated: (dir: string) => void }) {
  const [name, setName] = useState('mi-proyecto');
  const [query, setQuery] = useState('');
  const [boards, setBoards] = useState<PioBoard[] | null>(null);
  const [board, setBoard] = useState<PioBoard | null>(null);
  const [framework, setFramework] = useState('arduino');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setBoards(null);
    const t = setTimeout(() => {
      void api()
        .pio.boards(query.trim())
        .then((list) => {
          if (!alive) return;
          const q = query.trim();
          // Without a search, the usual boards first.
          setBoards(q ? list : [...list].sort((a, b) => Number(QUICK.includes(b.id)) - Number(QUICK.includes(a.id))));
        })
        .catch(() => alive && setBoards([]));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  const create = async () => {
    if (!board) return;
    setBusy(true);
    try {
      const dir = await api().pio.createProject(name.trim(), board.id, framework);
      toast(th('created', { dir }));
      onCreated(dir);
      void openFile(`${dir}/src/main.cpp`);
    } catch (e) {
      toast(th('error', { err: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hw-body hw-new">
      <div className="hw-subtitle">{th('newTitle')}</div>
      <label className="hw-field col">
        <span>{th('name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </label>
      <label className="hw-field col">
        <span>{th('board')}</span>
        <input value={query} placeholder={th('boardSearch')} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="hw-boards" role="listbox" aria-label={th('board')}>
        {boards === null ? (
          <div className="hw-dim">{th('searching')}</div>
        ) : !boards.length ? (
          <div className="hw-dim">{th('noBoards')}</div>
        ) : (
          boards.slice(0, 80).map((b) => (
            <button
              key={b.id}
              role="option"
              aria-selected={board?.id === b.id}
              className={`hw-board ${board?.id === b.id ? 'on' : ''}`}
              onClick={() => {
                setBoard(b);
                if (!b.frameworks.includes(framework)) setFramework(b.frameworks[0] ?? 'arduino');
              }}
            >
              <span className="hw-bname">{b.name}</span>
              <span className="hw-bmeta">
                {b.id} · {b.mcu}
              </span>
            </button>
          ))
        )}
      </div>
      {board && (
        <label className="hw-field">
          <span>{th('framework')}</span>
          <select value={framework} onChange={(e) => setFramework(e.target.value)}>
            {board.frameworks.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      )}
      {busy && <div className="hw-hint">{th('creating')}</div>}
      <div className="hw-row-btns">
        <button className="btn" disabled={!board || !name.trim() || busy} onClick={() => void create()}>
          {th('create')}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onCancel}>
          {th('cancel')}
        </button>
      </div>
    </div>
  );
}
