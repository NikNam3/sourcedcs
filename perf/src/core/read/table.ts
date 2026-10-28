import type { Table } from '../data/types.ts';
import { ok, outOfChart, type Read } from '../result.ts';

/** A key cell: a table key is matched exactly; null matches an empty cell, e.g. a row outside any group. */
export type TableKey = Readonly<Record<string, string | number | null>>;

function columnIndex(p: Table, name: string): number {
  const index = p.columns.findIndex((column) => column.name === name);
  if (index < 0) throw new Error(`table "${p.id}" has no column "${name}"`);
  return index;
}

/**
 * The cell in `column` of the one row whose key columns all equal `key`. No such row, or a null
 * cell, gives OutOfChart on the column with no drawn range (and NaN for the value: a table has no
 * number to report). An unknown column or more than one matching row is a data defect and throws
 * (ruling R7).
 */
export function tableCell(p: Table, figure: string, key: TableKey, column: string): Read<number | string> {
  const keyCells = Object.entries(key).map(([name, value]) => [columnIndex(p, name), value] as const);
  const valueIndex = columnIndex(p, column);
  const matches = p.rows.filter((row) => keyCells.every(([index, value]) => row[index] === value));
  if (matches.length > 1) {
    throw new Error(`table "${p.id}": ${String(matches.length)} rows match ${JSON.stringify(key)}`);
  }
  const cell = matches[0]?.[valueIndex];
  return cell === undefined || cell === null ? outOfChart(figure, column, NaN, null) : ok(cell);
}
