import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openLink } from '../../links';
import { api, toast, useStore } from '../../store';
import { Icon } from '../Icon';
import { runInTerminal } from '../Terminal';
import {
  filterLog,
  LOG_LEVELS,
  parseLogLine,
  type LogLevel,
  type MobileAction,
  type MobileDevice,
  type MobileProject,
  type MobileTools,
} from '../../../shared/mobile';
import { AppsView, ScreenView, WifiConnect } from './MobileScreen';
import { tm, type KeyMb } from './mobileStrings';
import '../hardware/hardware.css';
import './mobile.css';

/**
 * Phone panel (Fase 5B del plan de funciones): which tools are installed (Android SDK, adb,
 * emulator, Flutter, scrcpy), the phones and emulators adb sees (live screen with scrcpy,
 * screenshot, logcat), the emulators that can be started, and the Flutter / Expo / React
 * Native / Gradle projects of the folder, run in the integrated terminal.
 */

type View =
  | { kind: 'main' }
  | { kind: 'logcat'; device: MobileDevice }
  | { kind: 'screen'; device: MobileDevice }
  | { kind: 'apps'; device: MobileDevice };

const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fail = (e: unknown) => toast(tm('error', { err: errText(e) }));

export function MobilePanel() {
  const root = useStore((s) => s.workspace?.root ?? null);
  const [tools, setTools] = useState<MobileTools | null>(null);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [avds, setAvds] = useState<string[]>([]);
  const [projects, setProjects] = useState<MobileProject[]>([]);
  const [target, setTarget] = useState<string>('');
  const [view, setView] = useState<View>({ kind: 'main' });

  const load = useCallback(async (force = false) => {
    const t = await api().mobile.tools(force).catch(() => null);
    setTools(t);
    const [d, a, p] = await Promise.all([
      t?.adb ? api().mobile.devices().catch(() => [] as MobileDevice[]) : Promise.resolve([] as MobileDevice[]),
      t?.emulator ? api().mobile.avds().catch(() => [] as string[]) : Promise.resolve([] as string[]),
      api().mobile.projects().catch(() => [] as MobileProject[]),
    ]);
    setDevices(d);
    setAvds(a);
    setProjects(p);
  }, []);
  useEffect(() => {
    void load();
  }, [load, root]);
  // Phones come and go (USB, emulators booting): look again every 4 s while the list shows.
  useEffect(() => {
    if (!tools?.adb || view.kind !== 'main') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible')
        void api().mobile.devices().then(setDevices).catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [tools?.adb, view.kind]);

  const ready = devices.filter((d) => d.state === 'device');
  const chosen = ready.find((d) => d.serial === target) ?? (ready.length === 1 ? ready[0] : undefined);

  if (view.kind === 'logcat') return <LogcatView device={view.device} onBack={() => setView({ kind: 'main' })} />;
  if (view.kind === 'screen') return <ScreenView device={view.device} scrcpy={!!tools?.scrcpy} onBack={() => setView({ kind: 'main' })} />;
  if (view.kind === 'apps') return <AppsView device={view.device} onBack={() => setView({ kind: 'main' })} />;

  const runProject = async (p: MobileProject, action: MobileAction) => {
    try {
      const cmd = await api().mobile.command(p.dir, action, chosen?.serial ?? null);
      await runInTerminal(cmd);
    } catch (e) {
      fail(e);
    }
  };

  const toolRow = (label: string, path: string | null) => (
    <div className="mb-tool" key={label} title={path ?? undefined}>
      <span className={`mb-dot ${path ? 'on' : ''}`} aria-hidden="true" />
      <span className="mb-tlabel">{label}</span>
      <span className="hw-dim">{path ? tm('found') : tm('notFound')}</span>
    </div>
  );

  return (
    <div className="explorer hw-panel mb-panel">
      <div className="sidebar-title">
        <span className="panel-title">{tm('title').toUpperCase()}</span>
        <span className="sidebar-actions">
          <button title={tm('refresh')} aria-label={tm('refresh')} onClick={() => void load(true)}>
            <Icon name="refresh" size={15} />
          </button>
        </span>
      </div>
      {!tools ? (
        <div className="hw-empty">{tm('loading')}</div>
      ) : (
        <div className="hw-body">
          {/* ---------- devices ---------- */}
          <div className="hw-section mb-first">
            <div className="hw-subtitle">
              <Icon name="smartphone" size={13} /> {tm('devices')}
            </div>
            {!tools.adb ? (
              <div className="hw-hint">{tm('noAdb')}</div>
            ) : !devices.length ? (
              <div className="hw-hint">{tm('noDevices')}</div>
            ) : (
              devices.map((d) => (
                <div className={`mb-device ${chosen?.serial === d.serial ? 'on' : ''}`} key={d.serial}>
                  <label className="mb-dname" title={d.serial}>
                    {ready.length > 1 && d.state === 'device' && (
                      <input type="radio" name="mb-target" checked={chosen?.serial === d.serial} onChange={() => setTarget(d.serial)} />
                    )}
                    <Icon name={d.emulator ? 'monitor' : 'smartphone'} size={13} />
                    <span>{d.model}</span>
                    <span className="hw-dim">
                      {d.emulator ? tm('emulator') : d.serial}
                      {d.state !== 'device' ? ` · ${d.state === 'offline' ? tm('offline') : d.state}` : ''}
                    </span>
                  </label>
                  {d.state === 'unauthorized' && <div className="hw-hint">{tm('unauthorized')}</div>}
                  {d.state === 'device' && (
                    <div className="hw-row-btns">
                      {tools.scrcpy && (
                        <button className="btn hw-small" title={tm('mirrorTip')} onClick={() => void api().mobile.mirror(d.serial).catch(fail)}>
                          <Icon name="eye" size={12} /> {tm('mirror')}
                        </button>
                      )}
                      <button className="btn ghost hw-small" title={tm('screenTip')} onClick={() => setView({ kind: 'screen', device: d })}>
                        <Icon name="smartphone" size={12} /> {tm('screen')}
                      </button>
                      <button className="btn ghost hw-small" onClick={() => setView({ kind: 'apps', device: d })}>
                        <Icon name="apps" size={12} /> {tm('apps')}
                      </button>
                      <button className="btn ghost hw-small" onClick={() => setView({ kind: 'logcat', device: d })}>
                        <Icon name="scroll" size={12} /> {tm('logcat')}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
            {tools.adb && <WifiConnect onConnected={() => void load()} />}
          </div>

          {/* ---------- emulators ---------- */}
          {tools.emulator && (
            <div className="hw-section">
              <div className="hw-subtitle">
                <Icon name="monitor" size={13} /> {tm('emulators')}
              </div>
              {!avds.length ? (
                <div className="hw-hint">{tm('noAvds')}</div>
              ) : (
                avds.map((avd) => (
                  <div className="mb-avd" key={avd}>
                    <span className="mb-avdname">{avd.replace(/_/g, ' ')}</span>
                    <button
                      className="btn hw-small"
                      onClick={() =>
                        void api()
                          .mobile.startEmulator(avd)
                          .then(() => toast(tm('starting', { avd })))
                          .catch(fail)
                      }
                    >
                      {tm('start')}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ---------- projects ---------- */}
          <div className="hw-section">
            <div className="hw-subtitle">
              <Icon name="folder" size={13} /> {tm('projects')}
            </div>
            {!root ? (
              <div className="hw-hint">{tm('noFolder')}</div>
            ) : !projects.length ? (
              <div className="hw-hint">{tm('noProjects')}</div>
            ) : (
              <>
                {projects.map((p) => (
                  <div className="mb-project" key={`${p.kind}:${p.dir}`}>
                    <div className="mb-pname">
                      <span className={`mb-kind k-${p.kind}`}>{KIND[p.kind]}</span>
                      <span title={p.dir || '.'}>{p.name}</span>
                    </div>
                    <div className="hw-row-btns">
                      <button className="btn hw-small" onClick={() => void runProject(p, 'run')}>
                        <Icon name="continue" size={12} /> {tm('run')}
                      </button>
                      <button className="btn ghost hw-small" onClick={() => void runProject(p, 'build')}>
                        <Icon name="wrench" size={12} /> {tm('build')}
                      </button>
                      {p.kind !== 'android' && (
                        <button
                          className="btn ghost hw-small"
                          title={tools.platform === 'darwin' ? tm('iosTipMac') : tm('iosTipCloud')}
                          onClick={() => void runProject(p, 'ios')}
                        >
                          {tm('ios')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="hw-dim">{tm('runOn', { device: chosen?.model ?? tm('anyDevice') })}</div>
              </>
            )}
          </div>

          {/* ---------- tools ---------- */}
          <div className="hw-section">
            <div className="hw-subtitle">
              <Icon name="wrench" size={13} /> {tm('tools')}
            </div>
            {toolRow('Android SDK', tools.sdk)}
            {toolRow('adb', tools.adb)}
            {toolRow('Emulator', tools.emulator)}
            {toolRow('Flutter', tools.flutter)}
            {toolRow('scrcpy', tools.scrcpy)}
            {tools.platform === 'darwin' && toolRow('Xcode (xcrun)', tools.xcrun)}
            {!tools.adb && <div className="hw-hint">{tm('sdkHelp')}</div>}
            <div className="hw-row-btns">
              {!tools.sdk && (
                <button className="btn ghost hw-small" onClick={() => openLink('https://developer.android.com/studio')}>
                  {tm('getStudio')}
                </button>
              )}
              {!tools.adb && (
                <button className="btn ghost hw-small" onClick={() => openLink('https://developer.android.com/tools/releases/platform-tools')}>
                  {tm('getTools')}
                </button>
              )}
              {!tools.scrcpy && (
                <button className="btn ghost hw-small" onClick={() => openLink('https://github.com/Genymobile/scrcpy#get-the-app')}>
                  {tm('getScrcpy')}
                </button>
              )}
              {!tools.flutter && projects.some((p) => p.kind === 'flutter') && (
                <button className="btn ghost hw-small" onClick={() => openLink('https://docs.flutter.dev/get-started/install')}>
                  {tm('getFlutter')}
                </button>
              )}
            </div>
            {tools.platform !== 'darwin' && <div className="hw-hint">{tm('iosNote')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const KIND: Record<MobileProject['kind'], string> = {
  android: 'Android',
  flutter: 'Flutter',
  expo: 'Expo',
  'react-native': 'React Native',
};

const MAX_LOG = 20_000;
let logSeq = 0;

/** Live logcat of one device, with level / text filters and pause. */
function LogcatView({ device, onBack }: { device: MobileDevice; onBack: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [level, setLevel] = useState<LogLevel>(() => (localStorage.getItem('zs.mb.level') as LogLevel) || 'I');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const pre = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const partial = useRef('');
  pausedRef.current = paused;

  useEffect(() => {
    const key = `logcat-${++logSeq}`;
    const off = api().on((ev) => {
      if (ev.type !== 'mobile' || ev.event.key !== key) return;
      if (ev.event.kind === 'logcat-end') return setEnded(true);
      const text = partial.current + ev.event.chunk;
      const parts = text.split(/\r?\n/);
      partial.current = parts.pop() ?? '';
      if (pausedRef.current || !parts.length) return;
      setLines((l) => {
        const next = l.concat(parts);
        return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
      });
    });
    void api().mobile.followLogcat(key, device.serial).catch((e) => {
      fail(e);
      setEnded(true);
    });
    return () => {
      off();
      void api().mobile.stopLogcat(key).catch(() => undefined);
    };
  }, [device.serial]);

  const shown = useMemo(() => filterLog(lines, { level, query }).slice(-3000), [lines, level, query]);
  useEffect(() => {
    if (!paused && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [shown, paused]);

  return (
    <div className="explorer hw-panel mb-panel">
      <div className="sidebar-title">
        <button className="icon-btn" title={tm('back')} aria-label={tm('back')} onClick={onBack}>
          <Icon name="back" size={15} />
        </button>
        <span className="panel-title mb-ltitle" title={device.serial}>
          {tm('logcat')} · {device.model}
        </span>
        <div className="spacer" />
        <button className="icon-btn" title={paused ? tm('resume') : tm('pause')} aria-label={paused ? tm('resume') : tm('pause')} onClick={() => setPaused(!paused)}>
          <Icon name={paused ? 'continue' : 'pause'} size={14} />
        </button>
        <button className="icon-btn" title={tm('clear')} aria-label={tm('clear')} onClick={() => setLines([])}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="mb-lfilters">
        <select
          aria-label={tm('level')}
          value={level}
          onChange={(e) => {
            setLevel(e.target.value as LogLevel);
            localStorage.setItem('zs.mb.level', e.target.value);
          }}
        >
          {LOG_LEVELS.map((l) => (
            <option key={l} value={l}>
              {tm(`level${l}` as KeyMb)}
            </option>
          ))}
        </select>
        <input value={query} placeholder={tm('search')} aria-label={tm('search')} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="mb-log" ref={pre} role="log">
        {shown.map((l, i) => {
          const p = parseLogLine(l);
          return (
            <div key={i} className={`mb-line lv-${p?.level ?? 'x'}`}>
              {p ? (
                <>
                  <span className="mb-ltime">{p.time.slice(6)}</span> <span className="mb-llevel">{p.level}</span>{' '}
                  <span className="mb-ltag">{p.tag}</span> {p.message}
                </>
              ) : (
                l
              )}
            </div>
          );
        })}
        {ended && <div className="hw-dim">{tm('logEnded')}</div>}
      </div>
    </div>
  );
}
