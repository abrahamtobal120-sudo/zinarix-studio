import { useEffect, useRef, useState } from 'react';
import type { BridgeState } from '../../shared/api';
import { api, toast } from '../store';
import { Icon } from './Icon';
import { t3, type Key3D } from './three/strings3d';
import './bridge-status.css';

/** "Error invoking remote method 'x': Error: msg" → "msg". */
const ipcMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']*': (?:\w*Error: )?/,
    '',
  );

const CLOSED: BridgeState = { permanent: false, url: null, token: null, origins: [] };

/**
 * Status bar item for the permanent bridge: keeps the local connection to the models connected
 * in Zinarix open (also at app start), for any Blender with the Zinarix AI add-on and for web
 * apps. The user copies the URL and token into the web app and lists the sites allowed to call it.
 * It lives in the status bar so it is reachable from every part of Zinarix, not only the 3D studio.
 */
export function BridgeStatus() {
  const [state, setState] = useState<BridgeState | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sites, setSites] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const show = (b: BridgeState) => {
    setState(b);
    setSites(b.origins.join('\n'));
  };
  useEffect(() => {
    void api().scene3d.bridge().then(show, () => show(CLOSED));
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [open]);
  const run = async (f: () => Promise<BridgeState>, ok?: (b: BridgeState) => string) => {
    if (busy) return;
    setBusy(true);
    try {
      const b = await f();
      show(b);
      if (ok) toast(ok(b));
    } catch (e) {
      toast(t3('bridgeFailed', { msg: ipcMessage(e) }));
    } finally {
      setBusy(false);
    }
  };
  const on = !!state?.permanent;
  const copy = (text: string | null, done: Key3D) => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => toast(t3(done)));
  };
  const saveSites = () =>
    run(
      () => api().scene3d.setBridgeOrigins(sites.split(/[\s,]+/).filter(Boolean)),
      (b) => t3('bridgeSitesSaved', { n: String(b.origins.length) }),
    );
  return (
    <div className="bridge-status" ref={box}>
      <button
        type="button"
        className={`status-item bridge-trigger${on ? ' on' : ' off'}`}
        title={t3('bridgeHint')}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={state === undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="plug" size={13} /> {t3('bridge')}
      </button>
      {open && state && (
        <div
          className="bridge-pop"
          role="dialog"
          aria-label={t3('bridge')}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setOpen(false);
            box.current?.querySelector<HTMLElement>('.bridge-trigger')?.focus();
          }}
        >
          <p className="bridge-hint">{t3('bridgeHint')}</p>
          <button
            type="button"
            className="bridge-opt"
            disabled={busy}
            onClick={() =>
              void run(
                () => api().scene3d.setBridge(!on),
                (b) => t3(b.permanent ? 'bridgeOn' : 'bridgeOff'),
              )
            }
          >
            <Icon name="plug" size={14} /> {t3(on ? 'bridgeClose' : 'bridgeOpen')}
          </button>
          {on && state.url && (
            <>
              <div className="bridge-sep" role="separator" />
              <p className="bridge-hint">{t3('bridgeWebHint')}</p>
              <code className="bridge-url">{state.url}</code>
              <button
                type="button"
                className="bridge-opt"
                onClick={() => copy(state.url, 'bridgeUrlCopied')}
              >
                <Icon name="copy" size={14} /> {t3('bridgeCopyUrl')}
              </button>
              <button
                type="button"
                className="bridge-opt"
                onClick={() => copy(state.token, 'bridgeTokenCopied')}
              >
                <Icon name="key" size={14} /> {t3('bridgeCopyToken')}
              </button>
              <button
                type="button"
                className="bridge-opt"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api().scene3d.rotateBridgeToken(),
                    () => t3('bridgeTokenRotated'),
                  )
                }
              >
                <Icon name="refresh" size={14} /> {t3('bridgeRotateToken')}
              </button>
              <label className="bridge-hint" htmlFor="bridge-sites">
                {t3('bridgeSites')}
              </label>
              <textarea
                id="bridge-sites"
                className="bridge-sites"
                rows={3}
                spellCheck={false}
                placeholder="https://mi-app.vercel.app"
                value={sites}
                onChange={(e) => setSites(e.target.value)}
              />
              <button
                type="button"
                className="bridge-opt"
                disabled={busy}
                onClick={() => void saveSites()}
              >
                <Icon name="check" size={14} /> {t3('bridgeSitesSave')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
