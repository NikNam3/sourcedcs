/**
 * The derived line under section II (TOLD 1.8, the approved mockup): "Pressure altitude 2,036 ft · slope 0.8 %
 * uphill", then "Headwind 7.5 kt · crosswind 2.7 kt from the right · gust 15 kt". A value that does not compute is
 * left out; a line with nothing in it is not given. Pure: no DOM.
 */
import type { DerivedInputs } from '../../core/inputs/derive.ts';
import { formatThousands } from '../format.ts';

const one = (n: number): string => formatThousands(Math.abs(n), 1);
/** The sign of `n` as shown with one decimal: a value that shows as 0.0 has no side (0, or float noise). */
const shownSign = (n: number): number => Math.sign(Math.round(n * 10));

function slopeText(pct: number): string {
  const sign = shownSign(pct);
  if (sign === 0) return `slope ${one(pct)} %`;
  return `slope ${one(pct)} % ${sign > 0 ? 'uphill' : 'downhill'}`;
}

function headwindText(kt: number): string {
  return `${shownSign(kt) < 0 ? 'tailwind' : 'headwind'} ${one(kt)} kt`;
}

function crosswindText(kt: number): string {
  const sign = shownSign(kt);
  if (sign === 0) return `crosswind ${one(kt)} kt`;
  return `crosswind ${one(kt)} kt from the ${sign > 0 ? 'right' : 'left'}`;
}

/** The parts joined with " · ", the first capitalised; null when there are none. */
function line(parts: readonly (string | null)[]): string | null {
  const text = parts.filter((p) => p !== null).join(' · ');
  return text === '' ? null : text.charAt(0).toUpperCase() + text.slice(1);
}

export function derivedLines(d: DerivedInputs): string[] {
  const pa = d.paFt.ok ? `pressure altitude ${formatThousands(d.paFt.value, 0)} ft` : null;
  const slope = d.slopePct.ok ? slopeText(d.slopePct.value) : null;
  const head = d.headwindKt.ok ? headwindText(d.headwindKt.value) : null;
  const cross = d.crosswindKt.ok ? crosswindText(d.crosswindKt.value) : null;
  const gust = d.gustKt.ok && d.gustKt.value !== null ? `gust ${formatThousands(d.gustKt.value)} kt` : null;
  return [line([pa, slope]), line([head, cross, gust])].filter((l) => l !== null);
}
