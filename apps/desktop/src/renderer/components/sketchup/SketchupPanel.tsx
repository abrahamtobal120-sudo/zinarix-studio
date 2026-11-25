import { useCallback, useEffect, useRef, useState } from 'react';
import type { Object3D } from 'three';
import { openLink } from '../../links';
import { api, openFile, toast, useStore } from '../../store';
import { errText } from '../../errText';
import { askAgent } from '../Chat';
import { Icon } from '../Icon';
import { formatBytes } from '../FileViewers';
import { MeshViewer } from '../cad/meshViewer';
import { parseStl } from '../../../shared/mesh3d';
import {
  SKETCHUP_PREVIEWABLE,
  type SketchupRunView,
  type SketchupStatusView,
  type SkpInfoView,
} from '../../../shared/sketchup';
import { tsu } from './sketchupStrings';
import '../cad/cad.css';
import './sketchup.css';

// ---------------------------------------------------------------- shared pieces

/** Version + thumbnail of .skp files, read once per path and file change. */
const infoCache = new Map<string, Promise<SkpInfoView>>();
function skpInfo(path: string, version: number): Promise<SkpInfoView> {
  const k = `${version}:${path}`;
  let p = infoCache.get(k);
  if (!p) {
    p = api().sketchup.inspect(path);
    infoCache.set(k, p);
    p.catch(() => infoCache.delete(k));
  }
  return p;
}

function useBlobUrl(bytes: Uint8Array | null | undefined, type = 'image/png'): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) return setUrl(null);
    const u = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, type]);
  return url;
}

/** The preview picture SketchUp stores inside a .skp. */
export function SkpThumb({ path, big = false }: { path: string; big?: boolean }) {
  const fsVersion = useStore((s) => s.fsVersion);
  const [info, setInfo] = useState<SkpInfoView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    skpInfo(path, fsVersion).then(
      (i) => alive && setInfo(i),
      (e: unknown) => alive && setError(errText(e)),
    );
    return () => {
      alive = false;
    };
  }, [path, fsVersion]);
  const url = useBlobUrl(info?.thumbnail);
  return (
    <div className={`skp-thumb${big ? ' big' : ''}`} title={error ?? info?.label ?? path}>
      {url ? <img src={url} alt="" /> : <Icon name="home" size={big ? 40 : 18} />}
    </div>
  );
}

/** Small 3D preview of a mesh SketchUp exported (.stl / .obj / .dae). */
export function SkpMeshPreview({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<MeshViewer | null>(null);
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: true });
  const fsVersion = useStore((s) => s.fsVersion);
  useEffect(() => {
    if (!host.current) return;
    const v = new MeshViewer(host.current);
    viewer.current = v;
    return () => {
      v.dispose();
      viewer.current = null;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    void (async () => {
      try {
        const bytes = await api().sketchup.readExport(path);
        const v = viewer.current;
        if (!alive || !v) return;
        const e = path.toLowerCase().split('.').pop();
        if (e === 'stl') v.setTris(parseStl(bytes), true);
        else {
          let o: Object3D;
          if (e === 'obj') {
            const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
            o = new OBJLoader().parse(new TextDecoder().decode(bytes));
          } else {
            const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
            const dae = new ColladaLoader().parse(new TextDecoder().decode(bytes), '');
            if (!dae) throw new Error('DAE');
            o = dae.scene;
          }
          if (!alive) return;
          // SketchUp's OBJ and DAE come Y-up (DAE is converted by the loader).
          v.setObject(o, true);
        }
        if (alive) setState({ loading: false });
      } catch (err) {
        if (alive) setState({ loading: false, error: errText(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, fsVersion]);
  return (
    <div className="skp-mesh">
      <div className="skp-mesh-view" ref={host} />
      {state.loading && <div className="cad-overlay">{tsu('working')}</div>}
      {state.error && <div className="cad-error">{tsu('loadFail', { err: state.error })}</div>}
      <div className="skp-mesh-btns">
        {(['iso', 'front', 'top'] as const).map((v) => (
          <button key={v} className="btn ghost cad-small" onClick={() => viewer.current?.view(v)}>
            {v}
          </button>
        ))}
        <button className="btn ghost cad-small" onClick={() => void openFile(path)} title={path}>
          <Icon name="external" size={12} />
        </button>
      </div>
    </div>
  );
}

const safeName = (s: string) =>
  s
    .replace(/\.skp$/i, '')
    .replace(/[^\w\- ]+/g, '_')
    .trim() || 'modelo';

// ---------------------------------------------------------------- the panel

/** The SketchUp side panel (Más → SketchUp). */
export function SketchupPanel() {
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const [st, setSt] = useState<SketchupStatusView | null>(null);
  const [files, setFiles] = useState<{ skp: string[]; mesh: string[] }>({ skp: [], mesh: [] });
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [box, setBox] = useState({ w: 1000, d: 1000, h: 1000 });
  const shotUrl = useBlobUrl(shot);

  const load = useCallback(async () => {
    setSt(
      await api()
        .sketchup.status()
        .catch(() => null),
    );
  }, []);
  const loadFiles = useCallback(async () => {
    if (!workspace) return setFiles({ skp: [], mesh: [] });
    const all = await api()
      .workspace.listFiles()
      .catch(() => [] as string[]);
    setFiles({
      skp: all.filter((f) => /\.skp$/i.test(f)).slice(0, 200),
      mesh: all.filter((f) => SKETCHUP_PREVIEWABLE.test(f)).slice(0, 100),
    });
  }, [workspace]);

  useEffect(() => {
    void load();
    // SketchUp opening or closing shows up without pressing refresh.
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => void loadFiles(), [loadFiles, fsVersion]);

  const run = async (
    path: string | null,
    ops: Record<string, unknown>[],
    opts: { shot?: boolean; save?: boolean } = {},
  ): Promise<SketchupRunView | null> => {
    setBusy(true);
    try {
      const r = await api().sketchup.run(path, ops, { units: 'mm', ...opts });
      if (!r.ok) toast(r.error ?? 'SketchUp');
      if (r.shot) setShot(r.shot);
      void load();
      return r;
    } catch (e) {
      toast(errText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setBusy(true);
    try {
      setSt(await api().sketchup.install());
      toast(tsu('installed'));
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    const r = await api()
      .sketchup.pick()
      .catch(() => null);
    if (r) setSt(r);
    else toast(tsu('notSketchup'));
  };

  const openIn = async (f: string) => {
    try {
      await api().sketchup.open(f);
      setTimeout(() => void load(), 1500);
    } catch (e) {
      toast(errText(e));
    }
  };

  const exportAs = async (ext: 'stl' | 'obj' | 'dae') => {
    if (!st?.connected) return toast(tsu('needConnect'));
    const name = safeName(st.running?.title || st.running?.model.split(/[\\/]/).pop() || 'modelo');
    const out = `exports/${name}.${ext}`;
    const r = await run(null, [{ op: 'export', path: out }]);
    if (r?.ok) {
      toast(tsu('exported', { f: out }));
      await loadFiles();
      setPreview(out);
    }
  };

  const newBox = async () => {
    if (!st?.connected) return toast(tsu('needConnect'));
    await run(
      null,
      [
        { op: 'add_box', name: `Caja ${Date.now() % 10000}`, x: 0, y: 0, z: 0, ...box },
        { op: 'view', preset: 'iso' },
      ],
      { shot: true },
    );
  };

  const sendAsk = () => {
    const q = ask.trim();
    if (!q) return;
    askAgent(tsu('askPrefix') + q);
    setAsk('');
  };

  const ext = st?.extension;
  return (
    <div className="explorer cad-panel skp-panel">
      <div className="sidebar-title">
        <span className="panel-title">{tsu('title')}</span>
        <span className="sidebar-actions">
          <button
            title={tsu('recheck')}
            aria-label={tsu('recheck')}
            onClick={() => (void load(), void loadFiles())}
          >
            <Icon name="refresh" size={15} />
          </button>
        </span>
      </div>
      <div className="cad-panel-body">
        {!st ? (
          <p className="cad-hint">{tsu('loading')}</p>
        ) : (
          <section className="cad-card">
            <div className={`cad-engine ${st.active ? 'ok' : 'skp-missing'}`}>
              <Icon name="home" />
              <span>
                {st.active
                  ? st.active.year
                    ? tsu('found', { v: st.active.year })
                    : tsu('foundNoYear')
                  : tsu('notFound')}
              </span>
            </div>
            {!st.active && <p className="cad-hint">{tsu('notFoundHint')}</p>}
            {st.active && (
              <div className={`skp-line ${ext?.installed && !ext.outdated ? 'ok' : 'warn'}`}>
                <Icon name={ext?.installed && !ext.outdated ? 'check' : 'warning'} size={13} />
                <span>
                  {ext?.installed
                    ? ext.outdated
                      ? tsu('extOld')
                      : tsu('extOk')
                    : tsu('extMissing')}
                </span>
              </div>
            )}
            {st.active && (!ext?.installed || ext.outdated) && (
              <p className="cad-hint">{tsu('extHint')}</p>
            )}
            {st.active && (
              <div className={`skp-line ${st.connected ? 'ok' : ''}`}>
                <span className={`skp-dot${st.connected ? ' on' : ''}`} aria-hidden="true" />
                <span>
                  {st.connected
                    ? tsu('connected', { v: st.running?.version ?? '' })
                    : tsu('disconnected')}
                  {st.connected && (
                    <>
                      <br />
                      <span className="skp-dim">
                        {tsu('connectedModel', { m: st.running?.model || tsu('unsavedModel') })}
                      </span>
                    </>
                  )}
                </span>
              </div>
            )}
            <div className="cad-row-btns">
              {!st.active && (
                <button
                  className="btn cad-small"
                  onClick={() => openLink('https://www.sketchup.com/try-sketchup')}
                >
                  {tsu('download')}
                </button>
              )}
              {st.active && (!ext?.installed || ext.outdated) && (
                <button className="btn cad-small" disabled={busy} onClick={() => void install()}>
                  {ext?.installed ? tsu('update') : tsu('install')}
                </button>
              )}
              {st.active && !st.connected && (
                <button
                  className="btn ghost cad-small"
                  disabled={busy}
                  onClick={() => void run(null, []).then(() => load())}
                >
                  {tsu('launch')}
                </button>
              )}
              <button className="btn ghost cad-small" onClick={() => void pick()}>
                {tsu('pick')}
              </button>
            </div>
          </section>
        )}

        <section className="cad-card">
          <h3 className="cad-h">{tsu('askTitle')}</h3>
          <textarea
            className="skp-ask"
            rows={3}
            value={ask}
            placeholder={tsu('askPlaceholder')}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendAsk();
            }}
          />
          <div className="cad-row-btns">
            <button className="btn cad-small" disabled={!ask.trim()} onClick={sendAsk}>
              <Icon name="message" size={13} /> {tsu('askSend')}
            </button>
          </div>
        </section>

        {st?.active && (
          <section className="cad-card">
            <h3 className="cad-h">{tsu('quick')}</h3>
            <p className="cad-hint">{tsu('quickHint')}</p>
            <div className="skp-box">
              <span>{tsu('boxSize')}</span>
              {(['w', 'd', 'h'] as const).map((k) => (
                <input
                  key={k}
                  type="number"
                  min={1}
                  aria-label={k}
                  value={box[k]}
                  onChange={(e) =>
                    setBox((b) => ({ ...b, [k]: Math.max(1, Number(e.target.value) || 1) }))
                  }
                />
              ))}
            </div>
            <div className="cad-row-btns">
              <button
                className="btn ghost cad-small"
                disabled={busy || !st.connected || !workspace}
                onClick={() => void newBox()}
              >
                <Icon name="cube" size={13} /> {tsu('newBox')}
              </button>
              <button
                className="btn ghost cad-small"
                disabled={busy || !st.connected || !workspace}
                onClick={() => void exportAs('stl')}
              >
                {tsu('exportStl')}
              </button>
              <button
                className="btn ghost cad-small"
                disabled={busy || !st.connected || !workspace}
                onClick={() => void exportAs('obj')}
              >
                {tsu('exportObj')}
              </button>
              <button
                className="btn ghost cad-small"
                disabled={busy || !st.connected || !workspace}
                onClick={() => void exportAs('dae')}
              >
                {tsu('exportDae')}
              </button>
              <button
                className="btn ghost cad-small"
                disabled={busy || !st.connected}
                onClick={() => void run(null, [], { shot: true })}
              >
                <Icon name="image" size={13} /> {tsu('screenshot')}
              </button>
            </div>
            {busy && <p className="cad-hint">{tsu('working')}</p>}
            {shotUrl && <img className="skp-shot" src={shotUrl} alt={tsu('screenshot')} />}
          </section>
        )}

        {!workspace ? (
          <section className="cad-card skp-empty">
            <Icon name="files" size={22} />
            <p className="cad-hint">{tsu('noFolder')}</p>
            <button className="btn cad-small" onClick={() => void api().workspace.openDialog()}>
              {tsu('openFolder')}
            </button>
          </section>
        ) : (
          <>
            <section className="cad-card">
              <h3 className="cad-h">{tsu('models')}</h3>
              {files.skp.length ? (
                <ul className="skp-files">
                  {files.skp.map((f) => (
                    <li key={f} className="skp-item">
                      <button className="skp-item-main" title={f} onClick={() => void openFile(f)}>
                        <SkpThumb path={f} />
                        <span className="skp-name">{f}</span>
                      </button>
                      {st?.active && (
                        <button
                          className="btn ghost cad-small"
                          title={tsu('openIn')}
                          aria-label={tsu('openIn')}
                          onClick={() => void openIn(f)}
                        >
                          <Icon name="external" size={12} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cad-hint">{tsu('noModels')}</p>
              )}
            </section>
            <section className="cad-card">
              <h3 className="cad-h">{tsu('exports')}</h3>
              {files.mesh.length ? (
                <ul className="cad-files">
                  {files.mesh.map((f) => (
                    <li key={f}>
                      <button
                        className={`cad-file${preview === f ? ' on' : ''}`}
                        title={f}
                        onClick={() => setPreview(preview === f ? null : f)}
                      >
                        <Icon name="cube" /> {f}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cad-hint">{tsu('noExports')}</p>
              )}
              {preview && <SkpMeshPreview key={preview} path={preview} />}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- .skp tab

/** What a .skp tab shows: the stored thumbnail, version and size, and "open in SketchUp". */
export function SkpView({ path }: { path: string }) {
  const fsVersion = useStore((s) => s.fsVersion);
  const [info, setInfo] = useState<SkpInfoView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [st, setSt] = useState<SketchupStatusView | null>(null);
  useEffect(() => {
    let alive = true;
    skpInfo(path, fsVersion).then(
      (i) => alive && setInfo(i),
      (e: unknown) => alive && setError(errText(e)),
    );
    api()
      .sketchup.status()
      .then((s) => alive && setSt(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path, fsVersion]);
  const url = useBlobUrl(info?.thumbnail);
  const fileYear = info?.label.match(/20\d\d/)?.[0];
  const name = path.split(/[\\/]/).pop() ?? path;
  return (
    <div className="skp-view" aria-label={name}>
      <div className="cad-toolbar">
        <strong className="cad-title">{name}</strong>
        <span className="cad-grow" />
        {st?.active && (
          <button
            className="btn cad-small"
            onClick={() =>
              void api()
                .sketchup.open(path)
                .catch((e: unknown) => toast(errText(e)))
            }
          >
            <Icon name="external" size={13} /> {tsu('openIn')}
          </button>
        )}
        <button
          className="btn ghost cad-small"
          onClick={() => askAgent(tsu('checkAiPrompt', { file: path }))}
        >
          <Icon name="message" size={13} /> {tsu('checkAi')}
        </button>
      </div>
      <div className="skp-view-body">
        {error ? (
          <div className="cad-error" role="alert">
            {tsu('loadFail', { err: error })}
          </div>
        ) : !info ? (
          <p className="cad-hint">{tsu('loading')}</p>
        ) : (
          <>
            {url ? (
              <img className="skp-view-img" src={url} alt={name} />
            ) : (
              <div className="skp-thumb big">{tsu('noThumb')}</div>
            )}
            <p className="skp-meta">
              {tsu('version', { v: `${info.label}${info.version ? ` (${info.version})` : ''}` })} ·{' '}
              {formatBytes(info.size)}
            </p>
            {st && !st.active && <p className="cad-hint">{tsu('noSketchupOpen')}</p>}
            {st?.active?.year && fileYear && Number(fileYear) > st.active.year && (
              <p className="cad-hint">{tsu('newerFile', { f: fileYear, i: st.active.year })}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
