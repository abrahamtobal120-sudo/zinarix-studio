import { useEffect, useState } from 'react';
import { openLink } from '../../links';
import { api, openFile, toast } from '../../store';
import { errText } from '../../errText';
import { lang } from '../../i18n';
import { Icon } from '../Icon';
import { formatDuration } from '../../../shared/gcode';
import {
  DEFAULT_SLICE,
  LAYER_CHOICES,
  MATERIALS,
  PRINTER_PRESETS,
  validateSlice,
  type SliceSettings,
  type SliceView,
  type SlicerView,
  type SupportMode,
} from '../../../shared/slicer';
import { tc } from './cadStrings';

const SETTINGS_KEY = 'zs.slice.settings';

/** The last settings used (any model), checked again in case the list of choices changed. */
export function loadSliceSettings(): SliceSettings {
  try {
    return validateSlice(
      JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<SliceSettings>,
    );
  } catch {
    return DEFAULT_SLICE;
  }
}

let slicerCache: SlicerView | null = null;

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/**
 * Fase 7 (mejora): slice the model to G-code with PrusaSlicer (simple choices, or the user's
 * own profile), then view the layers or open the model in a desktop slicer.
 * `code` / `values`: a .scad is sliced as the editor shows it (unsaved text and parameters).
 */
export function SliceBox({
  path,
  code,
  values,
}: {
  path: string;
  code?: () => string | null;
  values?: Record<string, unknown>;
}) {
  const [view, setView] = useState<SlicerView | null>(slicerCache);
  const [s, setS] = useState<SliceSettings>(loadSliceSettings);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SliceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `slice:${path}`;

  useEffect(() => {
    if (!slicerCache)
      void api()
        .print.slicer()
        .then((v) => ((slicerCache = v), setView(v)))
        .catch(() => {});
  }, []);
  useEffect(() => () => void api().print.cancel(key), [key]);
  useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)), [s]);

  const set = (patch: Partial<SliceSettings>) => {
    setDone(null);
    setS((old) => {
      try {
        return validateSlice({ ...old, ...patch });
      } catch {
        return old;
      }
    });
  };

  const slice = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(await api().print.slice(key, path, code?.() ?? null, values ?? {}, s));
    } catch (e) {
      const msg = errText(e);
      if (!/Cancelado/.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    const v = await api()
      .print.pickSlicer()
      .catch(() => null);
    if (v) setView((slicerCache = v));
    else toast(tc('notSlicer'));
  };
  const profile = async (clear: boolean) => {
    try {
      const v = await api().print.pickProfile(clear);
      if (v) setView((slicerCache = v));
    } catch (e) {
      toast(errText(e));
    }
  };

  if (!view) return null;
  const opens = view.desktop.map((d) => (
    <button
      key={d.id}
      className="btn ghost cad-small"
      onClick={() =>
        void api()
          .print.openIn(d.id, path)
          .catch((e: unknown) => toast(errText(e)))
      }
    >
      <Icon name="external" /> {tc('openIn', { app: d.name })}
    </button>
  ));
  if (!view.slicer)
    return (
      <div className="cad-slice">
        <p className="cad-hint">{tc('noSlicer')}</p>
        <div className="cad-row-btns">
          <button
            className="btn ghost cad-small"
            onClick={() => openLink('https://www.prusa3d.com/page/prusaslicer_424/')}
          >
            {tc('downloadSlicer')}
          </button>
          <button className="btn ghost cad-small" onClick={() => void pick()}>
            {tc('pickSlicer')}
          </button>
          {!/\.scad$/i.test(path) && opens}
        </div>
      </div>
    );
  const sup: [SupportMode, string][] = [
    ['none', tc('supNone')],
    ['buildplate', tc('supBuildplate')],
    ['everywhere', tc('supEverywhere')],
  ];
  return (
    <div className="cad-slice">
      {!view.profile && (
        <label className="cad-field">
          <span>{tc('slicePrinter')}</span>
          <select value={s.printer} onChange={(e) => set({ printer: e.target.value })}>
            {PRINTER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {lang === 'en' ? p.en : p.es}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="cad-slice-grid">
        <label className="cad-field">
          <span>{tc('sliceMaterial')}</span>
          <select value={s.material} onChange={(e) => set({ material: e.target.value })}>
            {MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cad-field" title={tc('sliceLayerHint')}>
          <span>{tc('sliceLayer')}</span>
          <select
            value={s.layerHeight}
            onChange={(e) => set({ layerHeight: Number(e.target.value) })}
          >
            {LAYER_CHOICES.map((h) => (
              <option key={h} value={h}>
                {h} mm
              </option>
            ))}
          </select>
        </label>
        <label className="cad-field">
          <span>{tc('sliceSupports')}</span>
          <select
            value={s.supports}
            onChange={(e) => set({ supports: e.target.value as SupportMode })}
          >
            {sup.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="cad-field">
          <span>{tc('sliceWalls')}</span>
          <input
            type="number"
            min={1}
            max={10}
            value={s.walls}
            onChange={(e) => e.target.value && set({ walls: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className="cad-field">
        <span>
          {tc('sliceInfill')} {s.infill} %
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={s.infill}
          aria-label={tc('sliceInfill')}
          onChange={(e) => set({ infill: Number(e.target.value) })}
        />
      </label>
      <label className="cad-check">
        <input
          type="checkbox"
          checked={s.brim > 0}
          onChange={(e) => set({ brim: e.target.checked ? 5 : 0 })}
        />
        {tc('sliceBrim')}
      </label>
      <div className="cad-row-btns">
        {busy ? (
          <>
            <span className="cad-status">{tc('slicing')}</span>
            <button className="btn ghost cad-small" onClick={() => void api().print.cancel(key)}>
              {tc('cancel')}
            </button>
          </>
        ) : (
          <button className="btn cad-small" onClick={() => void slice()}>
            <Icon name="layers" /> {tc('sliceBtn')}
          </button>
        )}
      </div>
      {done && (
        <div className="cad-slice-done" role="status">
          <span>
            <strong>{base(done.path)}</strong> ·{' '}
            {tc('sliceDone', {
              time: formatDuration(done.timeS, lang === 'en' ? 'en' : 'es'),
              grams: done.grams.toFixed(1),
              layers: done.layers,
            })}
          </span>
          <button className="btn ghost cad-small" onClick={() => void openFile(done.path)}>
            {tc('sliceOpen')}
          </button>
          {done.warnings.length > 0 && (
            <details className="cad-slice-warn">
              <summary>
                <Icon name="warning" /> {tc('sliceWarn')} ({done.warnings.length})
              </summary>
              <ul>
                {done.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {error && (
        <p className="cad-print-line bad" role="alert">
          {tc('sliceFail', { err: error })}
        </p>
      )}
      <p className="cad-hint">
        {tc('slicerOk', { name: view.slicer.name, v: view.slicer.version })}
        {view.profile ? ` · ${tc('profileOn', { file: base(view.profile) })}` : ''}
      </p>
      {view.profile && <p className="cad-hint">{tc('profileHint')}</p>}
      <div className="cad-row-btns">
        <button className="btn ghost cad-small" onClick={() => void profile(!!view.profile)}>
          {view.profile ? tc('profileOff') : tc('profileUse')}
        </button>
        {!/\.scad$/i.test(path) && opens}
      </div>
    </div>
  );
}
