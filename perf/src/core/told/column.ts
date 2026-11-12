/**
 * One TOLD column (a takeoff mode or a landing weight and surface): its cells with their rule marks, the exact trace
 * for plan 3's figure view, and the reasons its OutOfChart cells give. A column whose inputs do not parse has every
 * cell unparsed, naming those inputs.
 */
import type { Cell, Evaluation, OutputKind } from '../ctx.ts';
import type { InputField } from '../inputs/inputs.ts';
import type { OutOfChart } from '../result.ts';

import type { RuleMark } from './rules.ts';

/** An input field, or the loadout the drag index builder could not compute. */
export type UnparsedField = InputField | 'loadout';

export type ToldCell<S> =
  | { readonly kind: 'computed'; readonly cell: Cell<S>; readonly marks: readonly RuleMark[] }
  | { readonly kind: 'unparsed'; readonly fields: readonly UnparsedField[] };

export interface Reason {
  readonly cell: 'exact' | 'conservative';
  readonly error: OutOfChart;
}

export interface ToldColumn<K extends string, S> {
  readonly cells: Readonly<Record<K, ToldCell<S>>>;
  readonly trace: Evaluation<K, S>['trace'];
  /**
   * One per distinct (figure, input, value, drawn range, cell), in cell order, exact before conservative. A cell
   * rejected outright (its conservative value is the exact error itself) gives only its exact reason.
   */
  readonly reasons: readonly Reason[];
}

const keysOf = <K extends string>(kinds: Readonly<Record<K, OutputKind>>): K[] => Object.keys(kinds) as K[];

function reasonKey({ cell, error }: Reason): string {
  const range = error.drawnRange === null ? 'null' : error.drawnRange.join(',');
  return [cell, error.figure, error.input, String(error.value), range].join('|');
}

/** The reasons of a column's cells, each distinct one once. */
export function reasonsOf<K extends string, S>(cells: Readonly<Record<K, Cell<S>>>, keys: readonly K[]): Reason[] {
  const seen = new Set<string>();
  const reasons: Reason[] = [];
  for (const k of keys) {
    for (const which of ['exact', 'conservative'] as const) {
      const read = cells[k][which];
      if (read.ok) continue;
      // A cell rejected outright carries the exact error as its conservative value (`cellOf`): one reason, exact.
      if (which === 'conservative' && read === cells[k].exact) continue;
      const reason = { cell: which, error: read.error };
      const key = reasonKey(reason);
      if (seen.has(key)) continue;
      seen.add(key);
      reasons.push(reason);
    }
  }
  return reasons;
}

/** A computed column: every cell with the marks `marksOf` gives it. */
export function computedColumn<K extends string, S>(
  evaluation: Evaluation<K, S>,
  kinds: Readonly<Record<K, OutputKind>>,
  marksOf: (k: K, cell: Cell<S>) => readonly RuleMark[],
): ToldColumn<K, S> {
  const keys = keysOf(kinds);
  const cells = {} as Record<K, ToldCell<S>>;
  for (const k of keys) {
    const cell = evaluation.cells[k];
    cells[k] = { kind: 'computed', cell, marks: marksOf(k, cell) };
  }
  return { cells, trace: evaluation.trace, reasons: reasonsOf(evaluation.cells, keys) };
}

/** A column whose inputs do not parse: every cell unparsed on `fields`, no trace, no reasons. */
export function unparsedColumn<K extends string, S>(
  kinds: Readonly<Record<K, OutputKind>>,
  fields: readonly UnparsedField[],
): ToldColumn<K, S> {
  const cells = {} as Record<K, ToldCell<S>>;
  for (const k of keysOf(kinds)) cells[k] = { kind: 'unparsed', fields };
  return { cells, trace: [], reasons: [] };
}
