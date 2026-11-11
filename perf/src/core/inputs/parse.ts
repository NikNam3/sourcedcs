/**
 * Typed text to numbers (TOLD 1.7). Only syntax and physical limits live here; every other range is the charts'.
 */
export type Field<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export interface Wind {
  readonly directionDeg: number;
  readonly speedKt: number;
  readonly gustKt: number | null;
}

const NOT_OK: Field<never> = { ok: false };

/** An optional minus, digits (thousands commas in groups of three allowed), an optional decimal part. */
const NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

/** "37,240", "-12", "29.92"; surrounding spaces ignored, no units. A number too large to be finite is not ok. */
export function parseNumber(text: string): Field<number> {
  const trimmed = text.trim();
  if (!NUMBER.test(trimmed)) return NOT_OK;
  const value = Number(trimmed.replaceAll(',', ''));
  return Number.isFinite(value) ? { ok: true, value } : NOT_OK;
}

/** `ddd/ss` with an optional `Ggg`, spaces allowed around the parts. */
const WIND = /^(\d{3})\s*\/\s*(\d{1,3})(?:\s*G\s*(\d{1,3}))?$/i;

/**
 * "230/08", "230/08G15", "230 / 08 G15". Direction 1 to 360, gust not below the steady wind. Calm is "000/00":
 * direction 000 only with speed 0 and no gust.
 */
export function parseWind(text: string): Field<Wind> {
  const match = WIND.exec(text.trim());
  if (match === null) return NOT_OK;
  const [, direction = '', speed = '', gust] = match;
  const directionDeg = Number(direction);
  const speedKt = Number(speed);
  const gustKt = gust === undefined ? null : Number(gust);
  const calm = directionDeg === 0 && speedKt === 0 && gustKt === null;
  if (!calm && (directionDeg < 1 || directionDeg > 360)) return NOT_OK;
  if (gustKt !== null && gustKt < speedKt) return NOT_OK;
  return { ok: true, value: { directionDeg, speedKt, gustKt } };
}
