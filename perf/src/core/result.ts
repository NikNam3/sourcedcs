/**
 * The result of reading a chart. A building block never extrapolates and never
 * throws for an input outside a chart: it returns an OutOfChart that names the
 * figure, the input, the value and the range the chart draws for that input.
 */

export interface OutOfChart {
  readonly kind: 'outOfChart';
  readonly figure: string;
  readonly input: string;
  readonly value: number;
  /** The range the chart draws for the input; null when there is none, e.g. a table key not found. */
  readonly drawnRange: readonly [number, number] | null;
}

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: OutOfChart };

export function ok<T>(value: T): Read<T> {
  return { ok: true, value };
}

export function outOfChart(
  figure: string,
  input: string,
  value: number,
  drawnRange: readonly [number, number] | null,
): Read<never> {
  return { ok: false, error: { kind: 'outOfChart', figure, input, value, drawnRange } };
}
