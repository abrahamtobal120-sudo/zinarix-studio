/**
 * Serial plotter (Fase 5A del plan de funciones): numbers a board prints, read the way the
 * Arduino IDE plotter reads them, kept as aligned samples for the chart and the AI's
 * summary. Pure: tested in Node.
 *
 * Accepted lines: "12 34 56", "12,34,56", "12\t34", "temp:23.5 hum:40", "temp=23.5, hum=40",
 * "Temp: 23.5 C". Text lines with no number ("Starting…") are not samples.
 */

export interface PlotValue {
  name: string;
  value: number;
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const LABELED = new RegExp(String.raw`([A-Za-z_][\w.\-]*)\s*[:=]\s*(${NUM})(?![\w.])`, 'g');
const ONLY_NUM = new RegExp(`^${NUM}$`);

/** The values of one line, or null when it is not a line of numbers. */
export function parsePlotLine(line: string): PlotValue[] | null {
  const text = line.trim();
  if (!text || text.length > 2000) return null;
  const labeled: PlotValue[] = [];
  for (const m of text.matchAll(LABELED)) {
    const v = Number(m[2]);
    if (Number.isFinite(v)) labeled.push({ name: m[1]!, value: v });
  }
  if (labeled.length) return labeled;
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length || parts.length > 32 || !parts.every((p) => ONLY_NUM.test(p))) return null;
  return parts.map((p, i) => ({ name: `v${i + 1}`, value: Number(p) }));
}

export interface PlotSample {
  /** Sample number since the plot started (keeps counting after old samples go). */
  n: number;
  values: Record<string, number>;
}

export interface SeriesStats {
  name: string;
  count: number;
  last: number;
  min: number;
  max: number;
  avg: number;
}

/** Samples of the last lines, oldest first, with the series in the order they appeared. */
export class PlotData {
  samples: PlotSample[] = [];
  series: string[] = [];
  private count = 0;
  private partial = '';

  constructor(readonly max = 2000) {}

  /** Adds the complete lines of a chunk of serial text (a cut line waits for the rest). */
  push(chunk: string): number {
    const text = this.partial + chunk;
    const lines = text.split(/\r?\n|\r/);
    this.partial = lines.pop() ?? '';
    if (this.partial.length > 4000) this.partial = '';
    let added = 0;
    for (const l of lines) if (this.pushLine(l)) added++;
    return added;
  }

  pushLine(line: string): boolean {
    const vals = parsePlotLine(line);
    if (!vals) return false;
    const values: Record<string, number> = {};
    for (const v of vals) {
      if (!(v.name in values) && !this.series.includes(v.name)) {
        if (this.series.length >= 16) continue;
        this.series.push(v.name);
      }
      values[v.name] = v.value;
    }
    this.samples.push({ n: this.count++, values });
    if (this.samples.length > this.max) this.samples.splice(0, this.samples.length - this.max);
    return true;
  }

  clear(): void {
    this.samples = [];
    this.series = [];
    this.count = 0;
    this.partial = '';
  }
}

/** Min / max / average / last of each series over the given samples. */
export function seriesStats(samples: PlotSample[], series: string[]): SeriesStats[] {
  return series.map((name) => {
    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    let last = Number.NaN;
    for (const s of samples) {
      const v = s.values[name];
      if (v === undefined) continue;
      count++;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
      last = v;
    }
    return { name, count, last, min: count ? min : Number.NaN, max: count ? max : Number.NaN, avg: count ? sum / count : Number.NaN };
  });
}

/** Y range with a little margin, never empty (a flat line still gets some height). */
export function plotRange(samples: PlotSample[], series: string[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples)
    for (const name of series) {
      const v = s.values[name];
      if (v === undefined) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** Round axis ticks between min and max (about `count` of them). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [min];
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Samples as CSV (n, then each series), for saving the plot. */
export function plotCsv(samples: PlotSample[], series: string[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [['n', ...series].map(esc).join(',')];
  for (const s of samples) rows.push([String(s.n), ...series.map((k) => (s.values[k] === undefined ? '' : String(s.values[k])))].join(','));
  return `${rows.join('\n')}\n`;
}
