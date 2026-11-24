import { lang } from '../../i18n';
import { checkPrint, type MeshReport } from '../../../shared/mesh3d';
import { tc } from './cadStrings';

/** Common printer beds (mm). */
export const BEDS: { id: string; label: string; size: [number, number, number] }[] = [
  { id: 'std', label: '220 × 220 × 250', size: [220, 220, 250] },
  { id: 'mini', label: '180 × 180 × 180', size: [180, 180, 180] },
  { id: 'big', label: '256 × 256 × 256', size: [256, 256, 256] },
  { id: 'xl', label: '350 × 350 × 400', size: [350, 350, 400] },
];

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

/** Size, watertight, problems and grams of a mesh, in plain words. */
export function PrintCheck({
  report,
  units,
  bed,
}: {
  report: MeshReport | null;
  units: 'mm' | 'm';
  bed: [number, number, number];
}) {
  if (!report) return null;
  const c = checkPrint(report, { units, bed, lang: lang === 'en' ? 'en' : 'es' });
  const k = units === 'm' ? 1000 : 1;
  const s = report.bounds.size;
  // The size and the number of pieces are already in the table above: skip those notes.
  const notes = c.notes.filter(
    (m) => !/^(Mide [^:]*\.$|It measures [^:]*\.$|Son \d+ piezas|It is \d+ separate)/.test(m),
  );
  return (
    <div className="cad-print" role="group" aria-label={tc('print')}>
      <div
        className={`cad-print-head ${c.ok && !c.warnings.length ? 'ok' : c.ok ? 'warn' : 'bad'}`}
      >
        {c.ok ? tc('printOk') : tc('printBad')}
      </div>
      <dl className="cad-facts">
        <dt>{tc('size')}</dt>
        <dd>
          {fmt(s[0] * k)} × {fmt(s[1] * k)} × {fmt(s[2] * k)} mm
        </dd>
        <dt>{tc('tris', { n: report.triangles.toLocaleString() })}</dt>
        <dd>
          {report.watertight ? tc('watertight') : tc('notWatertight')}
          {report.shells > 1 ? ` · ${tc('pieces', { n: report.shells })}` : ''}
        </dd>
      </dl>
      {[
        ...c.errors.map((m) => ['bad', m] as const),
        ...c.warnings.map((m) => ['warn', m] as const),
        ...notes.slice(0, 4).map((m) => ['note', m] as const),
      ].map(([kind, m], i) => (
        <p key={i} className={`cad-print-line ${kind}`}>
          {m}
        </p>
      ))}
    </div>
  );
}
