/**
 * Fase 4 (mejora): level meters of the mixer (L / R per track and the master). One animation
 * loop writes straight into the bars (no React render per frame); the levels come from the
 * waveform peaks at the playhead (shared/videoMeter.ts), with peak hold and a slow fall.
 */
import { useEffect } from 'react';
import { METER_FLOOR_DB, METER_TOP_DB, meterFall, meterFrac, mixLevels, toDb } from '../../../shared/videoMeter';
import { getV } from './videoStore';

type Bar = { l: HTMLDivElement | null; r: HTMLDivElement | null; db: HTMLElement | null };
const bars = new Map<string, Bar>();
/** Shown level per bar side (falls slowly), and the loudest peak of the last 1.5 s. */
const shown = new Map<string, { l: number; r: number; hold: number; holdAt: number }>();
export const MASTER = '__master__';

/** Where 0 dB sits on the bar (the marks and the colour change). */
const ZERO = (0 - METER_FLOOR_DB) / (METER_TOP_DB - METER_FLOOR_DB);

export function MeterBar({ id, label }: { id: string; label: string }) {
  const set = (k: keyof Bar) => (el: HTMLElement | null) => {
    const b = bars.get(id) ?? { l: null, r: null, db: null };
    (b[k] as HTMLElement | null) = el;
    bars.set(id, b);
  };
  useEffect(() => () => void bars.delete(id), [id]);
  return (
    <div className="vs-meter" role="meter" aria-label={label} aria-valuemin={METER_FLOOR_DB} aria-valuemax={METER_TOP_DB}>
      <div className="vs-meter-chs" style={{ ['--meter-0db' as string]: `${ZERO * 100}%` }}>
        <div className="vs-meter-ch">
          <div className="vs-meter-fill" ref={set('l')} />
        </div>
        <div className="vs-meter-ch">
          <div className="vs-meter-fill" ref={set('r')} />
        </div>
      </div>
      <code className="vs-meter-db" ref={set('db')}>
        −∞
      </code>
    </div>
  );
}

/** Runs while the mixer is open. */
export function useMeterLoop(): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const s = getV();
      const lv = mixLevels(s.project, s.waves, s.playhead);
      const all: [string, { l: number; r: number }][] = [...Object.entries(lv.tracks), [MASTER, lv.master]];
      for (const [id, v] of all) {
        const b = bars.get(id);
        if (!b) continue;
        const prev = shown.get(id) ?? { l: 0, r: 0, hold: 0, holdAt: 0 };
        const l = meterFall(prev.l, v.l, dt);
        const r = meterFall(prev.r, v.r, dt);
        const peak = Math.max(v.l, v.r);
        const hold = peak >= prev.hold || now - prev.holdAt > 1500 ? peak : prev.hold;
        const holdAt = hold === peak ? now : prev.holdAt;
        shown.set(id, { l, r, hold, holdAt });
        for (const [el, x] of [
          [b.l, l],
          [b.r, r],
        ] as const) {
          if (!el) continue;
          // The bar is a cover over the coloured scale: it shrinks as the level rises.
          el.style.width = `${(1 - meterFrac(x)) * 100}%`;
          el.parentElement?.classList.toggle('vs-meter-over', x > 1);
        }
        if (b.db) {
          const db = toDb(hold);
          b.db.textContent = Number.isFinite(db) && db > METER_FLOOR_DB ? `${db.toFixed(1)} dB` : '−∞';
          b.db.classList.toggle('vs-meter-over', hold > 1);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}
