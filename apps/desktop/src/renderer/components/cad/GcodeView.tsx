import { useEffect, useRef, useState } from 'react';
import { api, openLargeInEditor, toast } from '../../store';
import { errText } from '../../errText';
import { lang } from '../../i18n';
import { Icon } from '../Icon';
import {
  filamentGrams,
  formatDuration,
  gcodeTime,
  parseGcode,
  type GcodeParsed,
} from '../../../shared/gcode';
import { MeshViewer, type ViewName } from './meshViewer';
import { BEDS } from './PrintCheck';
import { SendBox } from './Printers';
import { tc } from './cadStrings';
import './cad.css';

const L = () => (lang === 'en' ? 'en' : 'es');

/**
 * Fase 7 (mejora): a G-code file as its toolpaths, layer by layer (slider, animation, travel
 * moves), with time, filament and temperatures, and sending it to a network printer.
 */
export function GcodeView({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<MeshViewer | null>(null);
  const [g, setG] = useState<GcodeParsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState(0);
  const [only, setOnly] = useState(false);
  const [travel, setTravel] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [bed, setBed] = useState(BEDS[0]!);
  const [reload, setReload] = useState(0);

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
    setError(null);
    void (async () => {
      try {
        const bytes = await api().cad.readMesh(path);
        // Let the "loading" text paint before the (synchronous) parse of a big file.
        await new Promise((r) => setTimeout(r, 0));
        const p = parseGcode(new TextDecoder().decode(bytes));
        if (!alive) return;
        viewer.current?.setToolpath(p.extrude, p.travel, reload === 0, p.stats.bounds);
        setG(p);
        setLayer(p.layers.length);
      } catch (e) {
        if (alive) setError(errText(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, reload]);

  // What is drawn: every layer up to the chosen one (or only it), the chosen one highlighted.
  useEffect(() => {
    const l = g?.layers[layer - 1];
    if (!g || !l) return;
    viewer.current?.showLayers({
      from: only ? l.e0 : 0,
      curFrom: l.e0,
      to: l.e1,
      travelFrom: l.t0,
      travelTo: l.t1,
      travel,
    });
  }, [g, layer, only, travel]);

  useEffect(() => viewer.current?.setBed([bed.size[0], bed.size[1]]), [bed, g]);

  // Animation: one layer every 80 ms, from the first.
  useEffect(() => {
    if (!playing || !g) return;
    const t = setInterval(() => {
      setLayer((n) => {
        if (n >= g.layers.length) {
          setPlaying(false);
          return n;
        }
        return n + 1;
      });
    }, 80);
    return () => clearInterval(t);
  }, [playing, g]);

  const st = g?.stats;
  const cur = g?.layers[layer - 1];
  const name = path.split(/[\\/]/).pop() ?? path;
  const views: [ViewName, string][] = [
    ['iso', tc('viewIso')],
    ['front', tc('viewFront')],
    ['right', tc('viewRight')],
    ['top', tc('viewTop')],
  ];
  const out =
    st?.bounds &&
    (st.bounds[0] < -1 ||
      st.bounds[1] < -1 ||
      st.bounds[3] > bed.size[0] + 1 ||
      st.bounds[4] > bed.size[1] + 1 ||
      st.bounds[5] > bed.size[2] + 0.5);
  const mm = st ? (st.slicerFilamentMm ?? st.filamentMm) : 0;

  return (
    <div className="cad-model" aria-label={name}>
      <div className="cad-toolbar">
        <strong className="cad-title">{name}</strong>
        <span className="cad-grow" />
        {views.map(([v, label]) => (
          <button key={v} className="btn ghost cad-small" onClick={() => viewer.current?.view(v)}>
            {label}
          </button>
        ))}
        <button className="btn ghost cad-small" onClick={() => setReload((n) => n + 1)}>
          <Icon name="refresh" /> {tc('render')}
        </button>
        <button
          className="btn ghost cad-small"
          title={tc('asTextHint')}
          onClick={() => void openLargeInEditor(path).catch((e: unknown) => toast(errText(e)))}
        >
          <Icon name="code" /> {tc('asText')}
        </button>
      </div>
      <div className="cad-model-body">
        <div className="cad-view-wrap">
          <div className="cad-view" ref={host} />
          {!g && !error && <div className="cad-overlay">{tc('loadingModel')}</div>}
          {error && (
            <div className="cad-error" role="alert">
              {tc('loadFail', { err: error })}
            </div>
          )}
          {st?.binary && <div className="cad-overlay">{tc('binaryGcode')}</div>}
          {g && !st?.binary && !g.layers.length && (
            <div className="cad-overlay">{tc('gcodeEmpty')}</div>
          )}
          {g && g.layers.length > 0 && (
            <div className="cad-layers">
              <button
                className="icon-btn"
                title={playing ? tc('stop') : tc('play')}
                aria-label={playing ? tc('stop') : tc('play')}
                onClick={() =>
                  playing
                    ? setPlaying(false)
                    : (layer >= g.layers.length && setLayer(1), setPlaying(true))
                }
              >
                <Icon name={playing ? 'pause' : 'play'} />
              </button>
              <input
                type="range"
                min={1}
                max={g.layers.length}
                value={layer}
                aria-label={tc('layer', { n: layer, total: g.layers.length })}
                onChange={(e) => (setPlaying(false), setLayer(Number(e.target.value)))}
              />
              <span className="cad-layers-text">
                {tc('layer', { n: layer, total: g.layers.length })} ·{' '}
                {tc('layerZ', { z: cur ? cur.z.toFixed(2) : '?' })}
              </span>
              <label className="cad-check">
                <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
                {tc('onlyLayer')}
              </label>
              <label className="cad-check">
                <input
                  type="checkbox"
                  checked={travel}
                  onChange={(e) => setTravel(e.target.checked)}
                />
                {tc('travel')}
              </label>
            </div>
          )}
        </div>
        <div className="cad-side">
          {st && !st.binary && (
            <section className="cad-sec">
              <div className="cad-sec-head static">{tc('gcodeTitle')}</div>
              <dl className="cad-facts">
                <dt>{tc('time')}</dt>
                <dd>
                  {formatDuration(gcodeTime(st), L())}
                  {st.slicerTimeS === undefined ? ` ${tc('approx')}` : ''}
                </dd>
                <dt>{tc('filament')}</dt>
                <dd>
                  {(mm / 1000).toFixed(2)} m ·{' '}
                  {(st.slicerFilamentG ?? filamentGrams(mm)).toFixed(1)} g
                </dd>
                <dt>{tc('layersN')}</dt>
                <dd>
                  {st.layers}
                  {st.layerHeight ? ` × ${st.layerHeight} mm` : ''}
                </dd>
                {st.bounds && (
                  <>
                    <dt>{tc('size')}</dt>
                    <dd>
                      {(st.bounds[3] - st.bounds[0]).toFixed(1)} ×{' '}
                      {(st.bounds[4] - st.bounds[1]).toFixed(1)} × {st.bounds[5].toFixed(1)} mm
                    </dd>
                  </>
                )}
                {(st.nozzleTemp || st.bedTemp) && (
                  <>
                    <dt>{tc('temps')}</dt>
                    <dd>
                      {[
                        st.nozzleTemp ? tc('tempNozzle', { n: st.nozzleTemp }) : null,
                        st.bedTemp ? tc('tempBed', { b: st.bedTemp }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </dd>
                  </>
                )}
                {st.slicer && (
                  <>
                    <dt>{tc('slicedWith')}</dt>
                    <dd>{st.slicer}</dd>
                  </>
                )}
              </dl>
              {out && <p className="cad-print-line bad">{tc('outOfBed')}</p>}
              {st.truncated && <p className="cad-print-line warn">{tc('gcodeTruncated')}</p>}
              <label className="cad-field">
                <span>{tc('bed')}</span>
                <select
                  value={bed.id}
                  onChange={(e) => setBed(BEDS.find((b) => b.id === e.target.value) ?? BEDS[0]!)}
                >
                  {BEDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} mm
                    </option>
                  ))}
                </select>
              </label>
            </section>
          )}
          <section className="cad-sec">
            <div className="cad-sec-head static">{tc('send')}</div>
            <SendBox path={path} />
          </section>
        </div>
      </div>
    </div>
  );
}
