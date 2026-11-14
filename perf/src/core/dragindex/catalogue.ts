/**
 * The Fig. B1-1 catalogue: the basic aircraft's drag index (sheet 1), the suspension items (sheet 2) and the
 * stores (sheets 3 to 7), as printed. A row that does not parse is a data defect and throws.
 */
import { figure, type FigureSet } from '../data/figure-set.ts';
import { panel } from '../data/panel.ts';
import type { Table } from '../data/types.ts';
import { tableCell } from '../read/table.ts';
import { rackSuspensions } from './racks.ts';
import { isTankGroup, tankCondition, type TankCondition } from './tank.ts';

export type Station = '1' | '2' | '3' | '4' | '5' | '5L' | '5R' | '6' | '7' | '8' | '9';

/** A printed drag index: subsonic, the supersonic value where two are printed, and the tip note mark. */
export interface DragValue {
  readonly subsonic: number;
  readonly supersonic: number | null;
  readonly note: '' | '*' | '**';
  readonly printed: string;
}

/** A tank variant (sheet 7): the printed text, the condition it states, its drag index. */
export interface TankVariant {
  readonly name: string;
  readonly condition: TankCondition;
  readonly drag: DragValue;
}

/**
 * A store. A tank group is one store with an empty name; `variants` holds its rows (empty for any other store)
 * and `drag` is its highest variant, for display only: `dragIndex` picks the variant.
 */
export interface StoreRow {
  readonly key: string;
  readonly sheet: number;
  readonly group: string | null;
  readonly name: string;
  readonly stations: readonly Station[];
  readonly rack: string;
  readonly drag: DragValue;
  readonly variants: readonly TankVariant[];
}

export interface SuspensionRow {
  readonly name: string;
  readonly stations: readonly Station[];
  readonly drag: DragValue;
}

export interface Catalogue {
  readonly basic: DragValue;
  readonly stores: readonly StoreRow[];
  readonly suspensions: readonly SuspensionRow[];
}

const STATIONS: ReadonlySet<string> = new Set(['1', '2', '3', '4', '5', '5L', '5R', '6', '7', '8', '9']);
const isStation = (text: string): text is Station => STATIONS.has(text);

/** "2,3,7, OR 8" → ['2', '3', '7', '8']. An unknown station or an empty list throws. */
export function parseStations(text: string): Station[] {
  const parts = text.split(/[\s,]+/).filter((part) => part !== '' && part !== 'OR');
  if (parts.length === 0) throw new Error(`Fig. B1-1 stations "${text}" name no station`);
  return parts.map((part) => {
    if (!isStation(part)) throw new Error(`Fig. B1-1 stations "${text}": unknown station "${part}"`);
    return part;
  });
}

/** 4, "13/8", "4*", "2**", "4/2". Anything else throws. */
export function parseDrag(cell: string | number): DragValue {
  const printed = String(cell);
  if (typeof cell === 'number') {
    if (!Number.isInteger(cell) || cell < 0) throw new Error(`Fig. B1-1 drag index ${printed} is not printed`);
    return { subsonic: cell, supersonic: null, note: '', printed };
  }
  const two = /^(\d+)(?:\/(\d+))?$/.exec(cell);
  if (two !== null) {
    return { subsonic: Number(two[1]), supersonic: two[2] === undefined ? null : Number(two[2]), note: '', printed };
  }
  const marked = /^(\d+)(\*{1,2})$/.exec(cell);
  if (marked !== null)
    return { subsonic: Number(marked[1]), supersonic: null, note: marked[2] === '*' ? '*' : '**', printed };
  throw new Error(`Fig. B1-1 drag index "${printed}" does not parse`);
}

/** A table's cell by column name; a missing column throws. */
function cellReader(t: Table): (row: readonly (string | number | null)[], column: string) => string | number | null {
  return (row, column) => {
    const index = t.columns.findIndex((c) => c.name === column);
    if (index < 0) throw new Error(`table "${t.id}" has no column "${column}"`);
    return row[index] ?? null;
  };
}

function text(value: string | number | null, what: string): string {
  if (typeof value !== 'string') throw new Error(`Fig. B1-1 ${what} ${JSON.stringify(value)} is not text`);
  return value;
}

function dragCell(value: string | number | null, what: string): DragValue {
  if (value === null) throw new Error(`Fig. B1-1 ${what} has no drag index`);
  return parseDrag(value);
}

function suspensionsOf(figures: FigureSet): SuspensionRow[] {
  const t = panel(figure(figures, 'B1-1.sh2'), 'suspension', 'table');
  const cell = cellReader(t);
  return t.rows.map((row) => {
    const name = text(cell(row, 'store'), 'suspension');
    return {
      name,
      stations: parseStations(text(cell(row, 'station'), name)),
      drag: dragCell(cell(row, 'drag_index'), name),
    };
  });
}

interface PrintedRow {
  readonly sheet: number;
  readonly group: string | null;
  readonly name: string;
  readonly stationsText: string;
  readonly rack: string;
  readonly drag: DragValue;
}

function printedStores(figures: FigureSet): PrintedRow[] {
  return [3, 4, 5, 6, 7].flatMap((sheet) => {
    const t = panel(figure(figures, `B1-1.sh${String(sheet)}`), 'stores', 'table');
    const cell = cellReader(t);
    return t.rows.map((row) => {
      const groupCell = cell(row, 'group');
      const group = groupCell === null ? null : text(groupCell, 'group');
      const name = text(cell(row, 'store'), 'store');
      const what = `sheet ${String(sheet)} "${name}"`;
      return {
        sheet,
        group,
        name,
        stationsText: text(cell(row, 'station'), what),
        rack: text(cell(row, 'rack'), what),
        drag: dragCell(cell(row, 'drag_index'), what),
      };
    });
  });
}

/** One tank store from its group's variant rows; they must agree on stations and rack. */
function tankStore(rows: readonly PrintedRow[]): StoreRow {
  const [first] = rows;
  if (first === undefined) throw new Error('a tank group with no rows');
  for (const r of rows) {
    if (r.stationsText !== first.stationsText || r.rack !== first.rack) {
      throw new Error(`Fig. B1-1 ${String(first.group)}: the variants differ in stations or rack`);
    }
  }
  const variants = rows.map((r) => ({ name: r.name, condition: tankCondition(r.name), drag: r.drag }));
  const highest = variants.reduce((a, b) => (b.drag.subsonic > a.drag.subsonic ? b : a));
  return {
    key: `${String(first.sheet)}|${String(first.group)}||${first.stationsText}`,
    sheet: first.sheet,
    group: first.group,
    name: '',
    stations: parseStations(first.stationsText),
    rack: first.rack,
    drag: highest.drag,
    variants,
  };
}

function plainStore(r: PrintedRow): StoreRow {
  return {
    key: `${String(r.sheet)}|${r.group ?? ''}|${r.name}|${r.stationsText}`,
    sheet: r.sheet,
    group: r.group,
    name: r.name,
    stations: parseStations(r.stationsText),
    rack: r.rack,
    drag: r.drag,
    variants: [],
  };
}

/** The catalogue from Fig. B1-1 sheets 1 to 7 (F-16C columns). */
export function buildCatalogue(figures: FigureSet): Catalogue {
  const sh1 = figure(figures, 'B1-1.sh1');
  const basicCell = tableCell(panel(sh1, 'drag_index', 'table'), sh1.id, { item: 'BASIC AIRCRAFT' }, 'drag_index_f16c');
  if (!basicCell.ok) throw new Error('Fig. B1-1 sheet 1 has no F-16C basic aircraft drag index');
  // A tank group's rows become one store, at the group's first row.
  const entries: (PrintedRow | PrintedRow[])[] = [];
  const tanks = new Map<string, PrintedRow[]>();
  for (const r of printedStores(figures)) {
    rackSuspensions(r.rack);
    if (!isTankGroup(r.group)) {
      entries.push(r);
      continue;
    }
    const groupKey = `${String(r.sheet)}|${String(r.group)}`;
    let rows = tanks.get(groupKey);
    if (rows === undefined) {
      rows = [];
      tanks.set(groupKey, rows);
      entries.push(rows);
    }
    rows.push(r);
  }
  const stores = entries.map((e) => (Array.isArray(e) ? tankStore(e) : plainStore(e)));
  const keys = new Set(stores.map((s) => s.key));
  if (keys.size !== stores.length) throw new Error('Fig. B1-1 has two stores with the same key');
  return { basic: parseDrag(basicCell.value), stores, suspensions: suspensionsOf(figures) };
}

const allowedOn = (allowed: readonly Station[], stations: readonly Station[]): boolean =>
  stations.every((s) => allowed.includes(s));

/** The stores allowed on every one of these stations, in printed order. */
export function storesFor(cat: Catalogue, stations: readonly Station[]): StoreRow[] {
  return cat.stores.filter((s) => allowedOn(s.stations, stations));
}

/** The sheet 2 items that carry this store's rack on every one of these stations, in sheet 2 order. */
export function suspensionsFor(cat: Catalogue, store: StoreRow, stations: readonly Station[]): SuspensionRow[] {
  const names = rackSuspensions(store.rack);
  return cat.suspensions.filter((s) => names.includes(s.name) && allowedOn(s.stations, stations));
}
