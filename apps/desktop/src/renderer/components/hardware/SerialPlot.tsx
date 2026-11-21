import { useEffect, useMemo, useRef, useState } from 'react';
import { api, openFile, toast, useStore } from '../../store';
import { Icon } from '../Icon';
import { niceTicks, plotCsv, plotRange, seriesStats, type PlotData, type PlotSample } from '../../../shared/serialPlot';
import { th } from './hardwareStrings';

/**
 * Serial plotter (Fase 5A del plan de funciones): the numbers the board prints, as lines,
 * like the Arduino IDE plotter. Series can be hidden; the window is the last N samples;
 * pausing freezes the picture (data keeps arriving); the samples save as CSV.
 */

const WINDOWS = [100, 300, 1000, 2000] as const;
const PALETTE_VARS = ['--accent', '--ok', '--warn', '--danger', '--fg'];
const fmt = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(5))) : '–');

/** Theme colours for the canvas, then extra hues for more series. */
function palette(el: HTMLElement): string[] {
  const cs = getComputedStyle(el);
  const base = PALETTE_VARS.map((v) => cs.getPropertyValue(v).trim()).filter(Boolean);
  const extra = [280, 190, 30, 330, 150, 60, 230, 0, 100, 260, 210].map((h) => `hsl(${h} 70% 60%)`);
  return [...base, ...extra];
}

export function SerialPlot({ data, tick }: { data: PlotData; tick: number }) {
  const root = useStore((s) => s.workspace?.root ?? null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState<number>(() => Number(localStorage.getItem('zs.hw.plotWin')) || 300);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [paused, setPaused] = useState<PlotSample[] | null>(null);
  const [size, setSize] = useState({ w: 300, h: 180 });
  const [hover, setHover] = useState<number | null>(null);
  /** Where the lines are drawn (left / right edge in CSS px), for the hover cursor. */
  const plotX = useRef({ left: 40, right: 300 });

  const samples = useMemo(
    () => (paused ?? data.samples).slice(-win),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paused, data, tick, win],
  );
  const series = data.series;
  const shown = series.filter((s) => !hidden.has(s));
  const colors = useMemo(() => (box.current ? palette(box.current) : []), [size.w]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = (name: string) => colors[series.indexOf(name) % Math.max(1, colors.length)] ?? 'currentColor';
  const stats = useMemo(() => seriesStats(samples, series), [samples, series]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(120, el.clientWidth), h: Math.max(120, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const el = box.current;
    if (!c || !el) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const cs = getComputedStyle(el);
    const dim = cs.getPropertyValue('--fg-dim').trim() || 'gray';
    const grid = cs.getPropertyValue('--border').trim() || 'rgba(128,128,128,.3)';
    const mono = cs.getPropertyValue('--font-mono').trim() || 'monospace';
    const { min, max } = plotRange(samples, shown);
    const ticks = niceTicks(min, max, Math.max(2, Math.floor(size.h / 40)));
    g.font = `10px ${mono}`;
    const left = Math.min(70, Math.max(28, ...ticks.map((t) => g.measureText(fmt(t)).width + 8)));
    const top = 6;
    const bottom = size.h - 16;
    const right = size.w - 6;
    plotX.current = { left, right };
    const yOf = (v: number) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
    // grid + y labels
    g.lineWidth = 1;
    g.strokeStyle = grid;
    g.fillStyle = dim;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const t of ticks) {
      const y = Math.round(yOf(t)) + 0.5;
      if (y < top - 1 || y > bottom + 1) continue;
      g.beginPath();
      g.moveTo(left, y);
      g.lineTo(right, y);
      g.stroke();
      g.fillText(fmt(t), left - 4, y);
    }
    if (!samples.length) return;
    const first = samples[0]!.n;
    // Until the window fills, the samples so far stretch across the width.
    const span = Math.max(1, Math.min(win, samples.length) - 1);
    const xOf = (n: number) => left + ((n - first) / span) * (right - left);
    // x labels: first and last sample numbers
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillText(String(first), left, bottom + 3);
    g.textAlign = 'right';
    g.fillText(String(samples[samples.length - 1]!.n), right, bottom + 3);
    // lines
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    for (const name of shown) {
      g.strokeStyle = color(name);
      g.beginPath();
      let pen = false;
      for (const s of samples) {
        const v = s.values[name];
        if (v === undefined) {
          pen = false;
          continue;
        }
        const x = xOf(s.n);
        const y = yOf(v);
        if (pen) g.lineTo(x, y);
        else g.moveTo(x, y);
        pen = true;
      }
      g.stroke();
    }
    // hover cursor
    if (hover != null) {
      const s = samples.find((x) => x.n === hover);
      if (s) {
        const x = Math.round(xOf(s.n)) + 0.5;
        g.strokeStyle = dim;
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(x, top);
        g.lineTo(x, bottom);
        g.stroke();
        g.setLineDash([]);
        for (const name of shown) {
          const v = s.values[name];
          if (v === undefined) continue;
          g.fillStyle = color(name);
          g.beginPath();
          g.arc(x, yOf(v), 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }, [samples, shown.join('\u0000'), size, win, hover, colors]); // eslint-disable-line react-hooks/exhaustive-deps

  const hovered = hover != null ? samples.find((x) => x.n === hover) : undefined;

  const saveCsv = async () => {
    const all = paused ?? data.samples;
    if (!all.length) return;
    try {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const path = `serial/plot-${stamp}.csv`;
      await api().workspace.createDir('serial').catch(() => undefined);
      await api().workspace.writeBytes(path, new TextEncoder().encode(plotCsv(all, series)));
      toast(th('plotSaved', { path }));
      void openFile(path);
    } catch (e) {
      toast(th('error', { err: String((e as Error)?.message ?? e) }));
    }
  };

  return (
    <div className="hw-plot">
      <div className="hw-plotbar">
        <select
          aria-label={th('plotWindow')}
          title={th('plotWindow')}
          value={win}
          onChange={(e) => {
            setWin(Number(e.target.value));
            localStorage.setItem('zs.hw.plotWin', e.target.value);
          }}
        >
          {WINDOWS.map((w) => (
            <option key={w} value={w}>
              {th('plotLast', { n: w })}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <button
          className="icon-btn"
          title={paused ? th('plotResume') : th('plotPause')}
          aria-label={paused ? th('plotResume') : th('plotPause')}
          aria-pressed={!!paused}
          onClick={() => setPaused(paused ? null : data.samples.slice())}
        >
          <Icon name={paused ? 'continue' : 'pause'} size={12} />
        </button>
        <button className="icon-btn" title={th('plotCsv')} aria-label={th('plotCsv')} disabled={!root || !data.samples.length} onClick={() => void saveCsv()}>
          <Icon name="download" size={12} />
        </button>
      </div>
      <div
        className="hw-plotarea"
        ref={box}
        onMouseMove={(e) => {
          if (!samples.length) return;
          const r = e.currentTarget.getBoundingClientRect();
          const { left, right } = plotX.current;
          const f = Math.max(0, Math.min(1, (e.clientX - r.left - left) / Math.max(1, right - left)));
          const n = samples[0]!.n + Math.round(f * Math.max(1, Math.min(win, samples.length) - 1));
          setHover(Math.min(samples[samples.length - 1]!.n, n));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} aria-label={th('plot')} role="img" />
        {!data.samples.length && <div className="hw-plotempty">{th('plotEmpty')}</div>}
      </div>
      {!!series.length && (
        <div className="hw-legend">
          {stats.map((st) => (
            <button
              key={st.name}
              className={`hw-lg ${hidden.has(st.name) ? 'off' : ''}`}
              title={th('plotStats', { min: fmt(st.min), max: fmt(st.max), avg: fmt(st.avg) })}
              aria-pressed={!hidden.has(st.name)}
              onClick={() =>
                setHidden((h) => {
                  const n = new Set(h);
                  if (n.has(st.name)) n.delete(st.name);
                  else n.add(st.name);
                  return n;
                })
              }
            >
              <span className="hw-swatch" style={{ background: color(st.name) }} aria-hidden="true" />
              <span className="hw-lgname">{st.name}</span>
              <span className="hw-lgval">{fmt(hovered ? hovered.values[st.name] ?? Number.NaN : st.last)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
