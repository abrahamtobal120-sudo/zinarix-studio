import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmDialog } from '../../confirm';
import { api, openFile, toast, useStore } from '../../store';
import { Icon } from '../Icon';
import {
  toDevicePoint,
  type MobileDevice,
  type MobileInput,
  type MobileKey,
} from '../../../shared/mobile';
import { tm } from './mobileStrings';

/**
 * The phone inside Zinarix (mejoras de la Fase 5B): its screen refreshed over adb (screencap)
 * and used with the mouse (click = tap, hold = long press, drag = swipe), the keyboard
 * (typing, Enter, Backspace, arrows) and the Android buttons. And the apps of the phone:
 * open, stop, clear, uninstall, and install an .apk of the project.
 */

const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );
const fail = (e: unknown) => toast(tm('error', { err: errText(e) }));

const KEYMAP: Record<string, MobileKey> = {
  Enter: 'enter',
  Backspace: 'delete',
  Tab: 'tab',
  Escape: 'back',
  ArrowUp: 'dpad_up',
  ArrowDown: 'dpad_down',
  ArrowLeft: 'dpad_left',
  ArrowRight: 'dpad_right',
};

const NAV: {
  key: MobileKey;
  icon: Parameters<typeof Icon>[0]['name'];
  label: 'navBack' | 'navHome' | 'navRecents';
}[] = [
  { key: 'back', icon: 'back', label: 'navBack' },
  { key: 'home', icon: 'home', label: 'navHome' },
  { key: 'recents', icon: 'apps', label: 'navRecents' },
];

export function ScreenView({
  device,
  scrcpy,
  onBack,
}: {
  device: MobileDevice;
  scrcpy: boolean;
  onBack: () => void;
}) {
  const root = useStore((s) => s.workspace?.root ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [fps, setFps] = useState(0);
  const [last, setLast] = useState<string>('');
  const img = useRef<HTMLImageElement>(null);
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const typed = useRef('');
  const typeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const kick = useRef<() => void>(() => undefined);
  const latest = useRef<string | null>(null);

  // Live picture: ask for the next screenshot as soon as one arrives (adb gives 1–4 per second).
  useEffect(() => {
    if (!live) return;
    let alive = true;
    let wake: (() => void) | null = null;
    kick.current = () => wake?.();
    const times: number[] = [];
    void (async () => {
      while (alive) {
        try {
          const u = await api().mobile.screenshot(device.serial);
          if (!alive) break;
          latest.current = u;
          setUrl(u);
          const now = performance.now();
          times.push(now);
          while (times.length && now - times[0]! > 3000) times.shift();
          setFps(times.length / 3);
        } catch (e) {
          if (alive) {
            fail(e);
            setLive(false);
          }
          break;
        }
        // A short rest (or until an input asks for a fresh picture).
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, document.visibilityState === 'visible' ? 120 : 1500);
        });
        wake = null;
      }
    })();
    return () => {
      alive = false;
      kick.current = () => undefined;
    };
  }, [live, device.serial]);

  const send = useCallback(
    async (i: MobileInput, label: string) => {
      setLast(label);
      try {
        await api().mobile.input(device.serial, i);
        kick.current();
      } catch (e) {
        fail(e);
      }
    },
    [device.serial],
  );

  const flushText = useCallback(() => {
    clearTimeout(typeTimer.current);
    const t = typed.current;
    typed.current = '';
    if (t)
      void send(
        { kind: 'text', text: t },
        tm('typed', { text: t.length > 24 ? `${t.slice(0, 24)}…` : t }),
      );
  }, [send]);
  useEffect(() => () => clearTimeout(typeTimer.current), []);

  const point = (e: React.PointerEvent) => {
    const el = img.current!;
    const r = el.getBoundingClientRect();
    return toDevicePoint(
      e.clientX - r.left,
      e.clientY - r.top,
      { width: r.width, height: r.height },
      { width: el.naturalWidth, height: el.naturalHeight },
    );
  };

  const onUp = (e: React.PointerEvent) => {
    const start = press.current;
    press.current = null;
    if (!start || !img.current?.naturalWidth) return;
    const end = point(e);
    const dt = performance.now() - start.t;
    const scale = img.current.naturalWidth / Math.max(1, img.current.getBoundingClientRect().width);
    const moved = Math.hypot(end.x - start.x, end.y - start.y) / scale;
    if (moved < 8) {
      if (dt < 450)
        void send(
          { kind: 'tap', x: start.x, y: start.y },
          tm('tapped', { x: start.x, y: start.y }),
        );
      else
        void send(
          { kind: 'long_press', x: start.x, y: start.y, ms: Math.min(3000, dt) },
          tm('held', { x: start.x, y: start.y }),
        );
    } else
      void send(
        {
          kind: 'swipe',
          x: start.x,
          y: start.y,
          x2: end.x,
          y2: end.y,
          ms: Math.max(80, Math.min(2000, dt)),
        },
        tm('swiped'),
      );
  };

  const save = async () => {
    const u = latest.current;
    if (!u) return;
    try {
      const bytes = Uint8Array.from(atob(u.split(',')[1] ?? ''), (c) => c.charCodeAt(0));
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const path = `media/screenshots/${device.model.replace(/[^\w-]+/g, '_')}-${stamp}.png`;
      // createDir makes one level at a time.
      await api()
        .workspace.createDir('media')
        .catch(() => undefined);
      await api()
        .workspace.createDir('media/screenshots')
        .catch(() => undefined);
      await api().workspace.writeBytes(path, bytes);
      toast(tm('saved', { path }));
      void openFile(path);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="explorer hw-panel mb-panel">
      <div className="sidebar-title">
        <button className="icon-btn" title={tm('back')} aria-label={tm('back')} onClick={onBack}>
          <Icon name="back" size={15} />
        </button>
        <span className="panel-title mb-ltitle" title={device.serial}>
          {device.model}
        </span>
        <div className="spacer" />
        <button
          className="icon-btn"
          title={live ? tm('screenPause') : tm('screenLive')}
          aria-label={live ? tm('screenPause') : tm('screenLive')}
          aria-pressed={live}
          onClick={() => setLive(!live)}
        >
          <Icon name={live ? 'pause' : 'continue'} size={14} />
        </button>
        {root && (
          <button
            className="icon-btn"
            title={tm('shotSave')}
            aria-label={tm('shotSave')}
            disabled={!url}
            onClick={() => void save()}
          >
            <Icon name="download" size={14} />
          </button>
        )}
        {scrcpy && (
          <button
            className="icon-btn"
            title={tm('mirrorTip')}
            aria-label={tm('mirror')}
            onClick={() => void api().mobile.mirror(device.serial).catch(fail)}
          >
            <Icon name="eye" size={14} />
          </button>
        )}
      </div>
      <div className="mb-screenwrap">
        <div
          className="mb-screen"
          tabIndex={0}
          role="application"
          aria-label={tm('screenAria', { device: device.model })}
          onKeyDown={(e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const k = KEYMAP[e.key];
            if (k) {
              e.preventDefault();
              flushText();
              void send({ kind: 'key', key: k }, tm('pressed', { key: e.key }));
            } else if (e.key.length === 1) {
              e.preventDefault();
              if (/[^\x20-\x7e]/.test(e.key)) return toast(tm('asciiOnly'));
              typed.current += e.key;
              clearTimeout(typeTimer.current);
              typeTimer.current = setTimeout(flushText, 350);
            }
          }}
        >
          {url ? (
            <img
              ref={img}
              src={url}
              alt={tm('screenAlt', { device: device.model })}
              draggable={false}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                e.currentTarget.parentElement?.focus();
                const p = point(e);
                press.current = { ...p, t: performance.now() };
              }}
              onPointerUp={onUp}
              onPointerCancel={() => (press.current = null)}
            />
          ) : (
            <div className="hw-dim">{tm('screenLoading')}</div>
          )}
        </div>
      </div>
      <div className="mb-nav" role="toolbar" aria-label={tm('navBar')}>
        {NAV.map((n) => (
          <button
            key={n.key}
            className="icon-btn"
            title={tm(n.label)}
            aria-label={tm(n.label)}
            onClick={() => void send({ kind: 'key', key: n.key }, tm(n.label))}
          >
            <Icon name={n.icon} size={15} />
          </button>
        ))}
        <span className="mb-navsep" />
        <button
          className="btn ghost hw-small"
          title={tm('volDown')}
          onClick={() => void send({ kind: 'key', key: 'volume_down' }, tm('volDown'))}
        >
          −
        </button>
        <button
          className="btn ghost hw-small"
          title={tm('volUp')}
          onClick={() => void send({ kind: 'key', key: 'volume_up' }, tm('volUp'))}
        >
          +
        </button>
        <button
          className="btn ghost hw-small"
          title={tm('powerTip')}
          onClick={() => void send({ kind: 'key', key: 'power' }, tm('power'))}
        >
          {tm('power')}
        </button>
      </div>
      <div className="mb-screeninfo hw-dim">
        {live ? tm('fps', { fps: fps.toFixed(1) }) : tm('paused')}
        {last ? ` · ${last}` : ''}
      </div>
      <div className="hw-hint mb-screenhelp">{tm('screenHelp')}</div>
    </div>
  );
}

export function AppsView({ device, onBack }: { device: MobileDevice; onBack: () => void }) {
  const root = useStore((s) => s.workspace?.root ?? null);
  const [pkgs, setPkgs] = useState<string[] | null>(null);
  const [system, setSystem] = useState(false);
  const [query, setQuery] = useState('');
  const [apks, setApks] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPkgs(null);
    setPkgs(
      await api()
        .mobile.packages(device.serial, !system)
        .catch((e) => (fail(e), [] as string[])),
    );
  }, [device.serial, system]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (root)
      void api()
        .mobile.apks()
        .then(setApks)
        .catch(() => setApks([]));
  }, [root]);

  const shown = useMemo(
    () => (pkgs ?? []).filter((p) => !query || p.toLowerCase().includes(query.toLowerCase())),
    [pkgs, query],
  );

  const act = async (pkg: string, action: 'launch' | 'stop' | 'clear' | 'uninstall') => {
    if (
      action === 'clear' &&
      !(await confirmDialog(tm('clearAsk', { pkg }), { okLabel: tm('appClear'), danger: true }))
    )
      return;
    if (
      action === 'uninstall' &&
      !(await confirmDialog(tm('uninstallAsk', { pkg }), {
        okLabel: tm('appUninstall'),
        danger: true,
      }))
    )
      return;
    setBusy(`${pkg}:${action}`);
    try {
      await api().mobile.app(device.serial, pkg, action);
      toast(tm(`done_${action}`, { pkg }));
      if (action === 'uninstall') void load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const install = async (apk: string) => {
    setBusy(`apk:${apk}`);
    try {
      await api().mobile.install(device.serial, apk);
      toast(tm('installed', { apk: apk.split('/').pop() ?? apk }));
      void load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="explorer hw-panel mb-panel">
      <div className="sidebar-title">
        <button className="icon-btn" title={tm('back')} aria-label={tm('back')} onClick={onBack}>
          <Icon name="back" size={15} />
        </button>
        <span className="panel-title mb-ltitle" title={device.serial}>
          {tm('apps')} · {device.model}
        </span>
        <div className="spacer" />
        <button
          className="icon-btn"
          title={tm('refresh')}
          aria-label={tm('refresh')}
          onClick={() => void load()}
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <div className="hw-body">
        {root && (
          <div className="hw-section mb-first">
            <div className="hw-subtitle">
              <Icon name="package" size={13} /> {tm('apkTitle')}
            </div>
            {!apks.length ? (
              <div className="hw-hint">{tm('noApks')}</div>
            ) : (
              apks.slice(0, 8).map((a) => (
                <div className="mb-apk" key={a}>
                  <span className="mb-apkname" title={a}>
                    {a}
                  </span>
                  <button
                    className="btn hw-small"
                    disabled={!!busy}
                    onClick={() => void install(a)}
                  >
                    {busy === `apk:${a}` ? tm('installing') : tm('install')}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        <div className="hw-section">
          <div className="mb-lfilters">
            <input
              value={query}
              placeholder={tm('appSearch')}
              aria-label={tm('appSearch')}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="mb-sys">
              <input
                type="checkbox"
                checked={system}
                onChange={(e) => setSystem(e.target.checked)}
              />{' '}
              {tm('systemApps')}
            </label>
          </div>
          {pkgs === null ? (
            <div className="hw-dim">{tm('loading')}</div>
          ) : !shown.length ? (
            <div className="hw-hint">{tm('noApps')}</div>
          ) : (
            <ul className="mb-apps">
              {shown.slice(0, 300).map((p) => (
                <li key={p}>
                  <span className="mb-pkg" title={p}>
                    {p}
                  </span>
                  <span className="mb-appbtns">
                    <button
                      className="icon-btn"
                      title={tm('appLaunch')}
                      aria-label={`${tm('appLaunch')} ${p}`}
                      disabled={!!busy}
                      onClick={() => void act(p, 'launch')}
                    >
                      <Icon name="continue" size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      title={tm('appStop')}
                      aria-label={`${tm('appStop')} ${p}`}
                      disabled={!!busy}
                      onClick={() => void act(p, 'stop')}
                    >
                      <Icon name="pause" size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      title={tm('appClear')}
                      aria-label={`${tm('appClear')} ${p}`}
                      disabled={!!busy}
                      onClick={() => void act(p, 'clear')}
                    >
                      <Icon name="refresh" size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      title={tm('appUninstall')}
                      aria-label={`${tm('appUninstall')} ${p}`}
                      disabled={!!busy}
                      onClick={() => void act(p, 'uninstall')}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** adb over Wi-Fi: connect to IP:port, or pair first with the 6-digit code (Android 11+). */
export function WifiConnect({ onConnected }: { onConnected: () => void }) {
  const [open, setOpen] = useState(false);
  const [addr, setAddr] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (pair: boolean) => {
    setBusy(true);
    try {
      const out = await api().mobile.connect(addr.trim(), pair ? code.trim() : null);
      toast(pair ? tm('paired') : out || tm('connected'));
      if (pair) setCode('');
      else onConnected();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button className="btn ghost hw-small mb-wifibtn" onClick={() => setOpen(true)}>
        <Icon name="wifi" size={12} /> {tm('wifi')}
      </button>
    );
  return (
    <form
      className="mb-wifi"
      onSubmit={(e) => {
        e.preventDefault();
        void run(!!code.trim());
      }}
    >
      <div className="hw-hint">{tm('wifiHelp')}</div>
      <input
        value={addr}
        placeholder="192.168.1.20:37099"
        aria-label={tm('wifiAddr')}
        onChange={(e) => setAddr(e.target.value)}
      />
      <input
        value={code}
        inputMode="numeric"
        maxLength={6}
        placeholder={tm('wifiCodePh')}
        aria-label={tm('wifiCodePh')}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      <div className="hw-row-btns">
        <button
          className="btn hw-small"
          type="submit"
          disabled={busy || !addr.trim() || (!!code && code.length !== 6)}
        >
          {code ? tm('wifiPair') : tm('wifiConnect')}
        </button>
        <button className="btn ghost hw-small" type="button" onClick={() => setOpen(false)}>
          {tm('cancel')}
        </button>
      </div>
    </form>
  );
}
