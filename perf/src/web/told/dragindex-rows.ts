/**
 * What the drag index builder shows for each loadout row, from the loadout and the drag index `computeTold` gave
 * (the view never computes the drag index: it only adds up a row's own lines for its columns). Pure: no DOM.
 */
import { storesFor, suspensionsFor, type Catalogue, type StoreRow } from '../../core/dragindex/catalogue.ts';
import type { DragIndex, DragLine, Loadout, LoadoutRow } from '../../core/dragindex/loadout.ts';
import { capacity } from '../../core/dragindex/racks.ts';
import { EMPTY_TEXT, NO_TIP_TEXT, problemText, signed, stationLabel, storeText, unbreak } from './dragindex-text.ts';
import { maxCount, pairOf } from './loadout-edit.ts';

export interface SuspensionModel {
  readonly chosen: string;
  /** Every sheet 2 item that carries the store here; more than one makes a picker. */
  readonly options: readonly string[];
  /** Count, each and drag index text; '' while the drag index does not compute. */
  readonly countText: string;
  readonly eachText: string;
  readonly dragText: string;
}

export interface RowModel {
  readonly index: number;
  readonly row: LoadoutRow;
  readonly label: string;
  readonly storeText: string;
  readonly empty: boolean;
  /** A `LoadoutProblem` names this row: the store gets the dotted underline. */
  readonly problem: boolean;
  readonly action: 'split' | 'join' | null;
  /**
   * The count shown and the highest the picker offers (what the allowed suspensions carry); null on an empty row.
   * While the drag index does not compute, `value` is the loadout's own and may lie outside 1 .. `max`.
   */
  readonly count: { readonly value: number; readonly max: number } | null;
  readonly eachText: string;
  readonly dragText: string;
  /** A grey line under the store: the tank variant, or the one station a pair at count 1 loads. */
  readonly variant: string | null;
  readonly suspension: SuspensionModel | null;
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** A key no store of this data version has: its printed name, read out of the key, so the row says what it was. */
function nameInKey(key: string): string {
  const [, group, name] = key.split('|');
  if (name !== undefined && name !== '') return unbreak(name);
  if (group !== undefined && group !== '' && group !== 'null') return unbreak(group);
  return key;
}

function nameOf(cat: Catalogue, row: LoadoutRow): string {
  if (row.storeKey === null) return EMPTY_TEXT;
  if (row.storeKey === 'noTipMissile') return NO_TIP_TEXT;
  const key = row.storeKey;
  const store = cat.stores.find((s) => s.key === key);
  return store === undefined ? nameInKey(key) : storeText(store);
}

function actionOf(loadout: Loadout, index: number, row: LoadoutRow): RowModel['action'] {
  if (pairOf(row.stations) !== null) return row.storeKey === null ? null : 'split';
  const next = loadout[index + 1];
  const [a] = row.stations;
  const [b] = next?.stations ?? [];
  if (row.stations.length !== 1 || next?.stations.length !== 1 || a === undefined || b === undefined) return null;
  return pairOf([a, b]) === null ? null : 'join';
}

function variantOf(row: LoadoutRow, lines: readonly DragLine[], count: number): string | null {
  const loaded = row.stations.slice(0, Math.min(count, row.stations.length));
  const tank = lines.filter((l) => l.variant !== null);
  if (tank.length > 0) {
    const names = unique(tank.map((l) => (l.variant ?? '').toLowerCase()));
    if (names.length === 1) return names[0] ?? null;
    let at = 0;
    return tank
      .map((l) => {
        const stations = loaded.slice(at, at + l.count);
        at += l.count;
        return `${stationLabel(stations)}: ${(l.variant ?? '').toLowerCase()}`;
      })
      .join('; ');
  }
  if (row.storeKey !== null && loaded.length > 0 && loaded.length < row.stations.length) {
    return `at ${stationLabel(loaded)} only`;
  }
  return null;
}

function suspensionOf(
  row: LoadoutRow,
  allowed: StoreRow | undefined,
  candidates: readonly string[],
  lines: readonly DragLine[],
): SuspensionModel | null {
  const first = lines[0];
  if (first !== undefined) {
    const s = first.suspension;
    if (s === null) return null;
    const count = sum(lines.map((l) => l.suspensionCount));
    return {
      chosen: s.name,
      options: candidates,
      countText: String(count),
      eachText: signed(s.drag.subsonic),
      dragText: signed(count * s.drag.subsonic),
    };
  }
  if (row.suspension === null) return null;
  return {
    chosen: row.suspension,
    options: allowed === undefined ? [] : candidates,
    countText: '',
    eachText: '',
    dragText: '',
  };
}

function rowModel(cat: Catalogue, loadout: Loadout, drag: DragIndex, index: number, row: LoadoutRow): RowModel {
  const lines = drag.ok ? drag.lines.filter((l) => l.row === row) : [];
  const problem = !drag.ok && drag.problems.some((p) => p.row === index);
  const key = row.storeKey;
  const allowed =
    key === null || key === 'noTipMissile' ? undefined : storesFor(cat, row.stations).find((s) => s.key === key);
  const candidates = allowed === undefined ? [] : suspensionsFor(cat, allowed, row.stations).map((s) => s.name);
  const k = row.stations.length;
  const max = candidates.length > 0 ? Math.max(...candidates.map(capacity)) * k : key === null ? 0 : k;
  const value = lines.length > 0 ? sum(lines.map((l) => l.count)) : row.count;
  return {
    index,
    row,
    label: stationLabel(row.stations),
    storeText: nameOf(cat, row),
    empty: key === null,
    problem,
    action: actionOf(loadout, index, row),
    count: key === null ? null : { value, max: Math.min(max, maxCount(row.stations)) },
    eachText: unique(lines.map((l) => signed(l.eachExact))).join(', '),
    dragText: lines.length > 0 ? signed(sum(lines.map((l) => l.count * l.eachExact))) : '',
    variant: variantOf(row, lines, value),
    suspension: suspensionOf(row, allowed, candidates, lines),
  };
}

/** One model per loadout row, in loadout order. */
export function rowModels(cat: Catalogue, loadout: Loadout, drag: DragIndex): RowModel[] {
  return loadout.map((row, index) => rowModel(cat, loadout, drag, index, row));
}

/** The grey line under the builder: the problems, then the notes of the lines, each once. */
export function notesText(loadout: Loadout, drag: DragIndex): string {
  const texts = drag.ok ? drag.lines.flatMap((l) => l.notes) : drag.problems.map((p) => problemText(p, loadout));
  return unique(texts).join(' ');
}

/** The total: null ("—") while the additional drag index or the loadout does not compute; cons. when it differs. */
export function totalText(
  drag: DragIndex,
  additionalOk: boolean,
): { readonly exact: string; readonly conservative: string | null } | null {
  if (!additionalOk || !drag.ok) return null;
  return {
    exact: signed(drag.exact),
    conservative: drag.conservative === drag.exact ? null : signed(drag.conservative),
  };
}
