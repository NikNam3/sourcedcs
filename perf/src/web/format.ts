/**
 * Numbers for the page (TOLD 1.8 "Cells"): speeds exact with one decimal and conservative whole, distances whole
 * with thousands separators, runway used % with one decimal, "—" for a cell that does not compute. Every number is
 * en-US grouped with a true minus sign (U+2212). No DOM.
 */
import type { Read } from '../core/result.ts';

/** U+2014: a cell that does not compute. */
export const DASH = '—';

const MINUS = '−';

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(min: number, max: number): Intl.NumberFormat {
  const key = `${String(min)}:${String(max)}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      signDisplay: 'negative',
    });
    formatters.set(key, f);
  }
  return f;
}

/**
 * en-US grouping and a U+2212 minus. With `decimals`, exactly that many; without, as many as needed up to two
 * (37,300; 18.75; 2.1). A value that rounds to zero shows no sign.
 */
export function formatThousands(value: number, decimals?: number): string {
  const f = decimals === undefined ? formatter(0, 2) : formatter(decimals, decimals);
  return f.format(value).replace('-', MINUS);
}

/** A speed cell: exact with one decimal (172.5), conservative whole (174); "—" out of chart. */
export function formatSpeed(r: Read<number>, which: 'exact' | 'conservative'): string {
  if (!r.ok) return DASH;
  return formatThousands(r.value, which === 'exact' ? 1 : 0);
}

/** A distance cell, whole with thousands separators (5,752), exact and conservative alike; "—" out of chart. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `which` keeps the signature formatSpeed has
export function formatDistance(r: Read<number>, which: 'exact' | 'conservative'): string {
  return r.ok ? formatThousands(r.value, 0) : DASH;
}

/** Runway used, one decimal (97.5, 83.0). */
export function formatPercent(value: number): string {
  return formatThousands(value, 1);
}

/** A figure file id as printed: 'B2-6.sh2' → 'B2-6 sh. 2'; 'B2-3' unchanged. */
export function figureLabel(figureId: string): string {
  return figureId.replace(/\.sh(\d+)$/, ' sh. $1');
}
