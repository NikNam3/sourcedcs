/**
 * The result of reading a chart. A building block never extrapolates and never
 * throws for an input outside a chart: it returns an OutOfChart that names the
 * figure, the input, the value and the range the chart draws for that input.
 */

export interface OutOfChart {
  readonly kind: 'outOfChart';
  readonly figure: string;
  readonly input: string;
  /**
   * The input's value. NaN when the input has no number, e.g. a table key not found (JSON then
   * carries null); drawnRange is null then too.
   */
  readonly value: number;
  /**
   * The range the chart draws for the input; null when there is none, e.g. a table key not found.
   * The UI branches on drawnRange === null (no range to show), never on value.
   */
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
