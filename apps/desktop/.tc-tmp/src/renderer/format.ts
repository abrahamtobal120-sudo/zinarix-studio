import { lang } from './i18n';

/** BCP 47 locale of the app language (not the system one), for every Intl formatter. */
export const appLocale = lang === 'en' ? 'en-US' : 'es-ES';

const cache = new Map<string, Intl.NumberFormat>();
function usdFormat(min: number, max: number): Intl.NumberFormat {
  const k = `${min}:${max}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(appLocale, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    cache.set(k, f);
  }
  return f;
}

/**
 * Dollars in the app language ("$1.25" / "1,25 $").
 * Default: 2 decimals, 4 for amounts under one cent (so tiny costs do not show as $0.00).
 * `digits` fixes the maximum decimals and drops trailing zeros (prices per million tokens).
 */
export function formatUsd(n: number, digits?: number): string {
  if (digits !== undefined) return usdFormat(0, digits).format(n);
  if (n !== 0 && Math.abs(n) < 0.01) return usdFormat(4, 4).format(n);
  return usdFormat(2, 2).format(n);
}

/** Month and year in the app language ("noviembre de 2026"). */
export function formatMonth(d: Date): string {
  return d.toLocaleDateString(appLocale, { month: 'long', year: 'numeric' });
}
