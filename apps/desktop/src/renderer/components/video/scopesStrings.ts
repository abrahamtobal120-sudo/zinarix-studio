import { lang } from '../../i18n';

/** Strings of Fase 12C: the video scopes. */
const es = {
  title: 'Monitores',
  waveform: 'Forma de onda',
  parade: 'Desfile RGB',
  vector: 'Vectorscopio',
  histogram: 'Histograma',
  live: 'en vivo (reducido)',
  exact: 'exacto',
  liveHint: 'Muestreo reducido mientras se reproduce.',
  exactHint: 'Todos los píxeles del cuadro en pausa.',
  noSource: 'Sin imagen en el visor.',
  lumaRange: 'Y {min}–{max}',
  outRange: 'Fuera de 16–235: {pct} %',
  below: 'Bajo 16: {pct} %',
  above: 'Sobre 235: {pct} %',
  skin: 'Piel',
  error: 'No se pudo calcular: {e}',
};

const en: Record<ScopesKey, string> = {
  title: 'Scopes',
  waveform: 'Waveform',
  parade: 'RGB parade',
  vector: 'Vectorscope',
  histogram: 'Histogram',
  live: 'live (reduced)',
  exact: 'exact',
  liveHint: 'Reduced sampling while playing.',
  exactHint: 'Every pixel of the paused frame.',
  noSource: 'No picture in the viewer.',
  lumaRange: 'Y {min}–{max}',
  outRange: 'Outside 16–235: {pct} %',
  below: 'Below 16: {pct} %',
  above: 'Above 235: {pct} %',
  skin: 'Skin',
  error: 'Could not compute: {e}',
};

export type ScopesKey = keyof typeof es;

export function tsc(key: ScopesKey, vars: Record<string, string | number> = {}): string {
  const s = (lang === 'en' ? en : es)[key];
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
