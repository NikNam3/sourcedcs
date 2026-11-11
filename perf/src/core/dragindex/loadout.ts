/**
 * Loadout → drag index, exact and conservative (Fig. B1-1; TOLD.md decisions of 29 Oct 2026, section 5.2).
 * Basic aircraft + each loaded row's stores and suspensions + the pilot's additional drag index. A loadout the
 * catalogue does not allow (unknown store, a store or suspension off its stations, a station in two rows) is a
 * defect of the caller and throws; a count over what the suspension carries is capped.
 */
import {
  storesFor,
  suspensionsFor,
  type Catalogue,
  type Station,
  type StoreRow,
  type SuspensionRow,
} from './catalogue.ts';
import { capacity } from './racks.ts';
import { centrelineCondition, wingCondition, type Neighbour, type TankCondition } from './tank.ts';
import { storeEach, tipMissileDrag } from './tip.ts';

/** One station row: the store, the suspension (null: the default), the count over all its stations. */
export interface LoadoutRow {
  readonly stations: readonly Station[];
  /** A `StoreRow.key`, or `'noTipMissile'` at 1/9: the tip AIM-9s removed. */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- names the sentinel in the type
  readonly storeKey: string | 'noTipMissile' | null;
  readonly suspension: string | null;
  readonly count: number;
}

export type Loadout = readonly LoadoutRow[];

const empty = (stations: Station[]): LoadoutRow => ({
  stations,
  storeKey: null,
  suspension: null,
  count: stations.length,
});

/** Pairs 1/9, 2/8, 3/7, 4/6, then 5, 5L, 5R, as the manual's worked example; all empty. */
export const DEFAULT_LOADOUT: Loadout = [
  empty(['1', '9']),
  empty(['2', '8']),
  empty(['3', '7']),
  empty(['4', '6']),
  empty(['5']),
  empty(['5L']),
  empty(['5R']),
];

/**
 * One drag index line: `count` stores at `eachExact`/`eachConservative`, plus `suspensionCount` of `suspension`.
 * A row gives one line, or one per variant when its tank variants differ between its stations.
 */
export interface DragLine {
  readonly row: LoadoutRow;
  readonly count: number;
  readonly eachExact: number;
  readonly eachConservative: number;
  readonly suspension: SuspensionRow | null;
  readonly suspensionCount: number;
  /** The tank variant's printed text; null for any other store. */
  readonly variant: string | null;
  readonly exact: number;
  readonly conservative: number;
  readonly notes: readonly string[];
}

export interface DragIndex {
  readonly exact: number;
  readonly conservative: number;
  readonly lines: readonly DragLine[];
}

/** A loaded row, resolved against the catalogue: its store (null: no tip missile), count and suspension. */
interface Resolved {
  readonly row: LoadoutRow;
  readonly store: StoreRow | null;
  readonly count: number;
  readonly suspension: SuspensionRow | null;
  readonly loaded: readonly Station[];
  readonly notes: readonly string[];
}

const TIP: readonly Station[] = ['1', '9'];

/** The suspension untouched: the smallest that carries the count; with none big enough, the biggest. */
function defaultSuspension(
  candidates: readonly SuspensionRow[],
  count: number,
  stations: number,
): SuspensionRow | null {
  const carrying = candidates.filter((c) => capacity(c.name) * stations >= count);
  const pool = carrying.length > 0 ? carrying : candidates;
  const sizes = pool.map((c) => capacity(c.name));
  const size = carrying.length > 0 ? Math.min(...sizes) : Math.max(...sizes);
  // On a tie, the first in sheet 2 order (questioner Q3).
  return pool.find((c) => capacity(c.name) === size) ?? null;
}

function resolve(cat: Catalogue, row: LoadoutRow): Resolved {
  const k = row.stations.length;
  if (!Number.isInteger(row.count) || row.count < 1) {
    throw new Error(`stations ${row.stations.join('/')}: count ${String(row.count)} is not a whole number from 1`);
  }
  const notes: string[] = [];
  let store: StoreRow | null = null;
  let suspension: SuspensionRow | null = null;
  let cap = k;
  if (row.storeKey === 'noTipMissile') {
    if (!row.stations.every((s) => TIP.includes(s))) throw new Error('no tip missile: only on stations 1 and 9');
    if (row.suspension !== null) throw new Error('no tip missile: no suspension');
  } else {
    const key = row.storeKey;
    store = storesFor(cat, row.stations).find((s) => s.key === key) ?? null;
    if (store === null)
      throw new Error(`store "${String(key)}" is not in Fig. B1-1 for stations ${row.stations.join('/')}`);
    const candidates = suspensionsFor(cat, store, row.stations);
    if (row.suspension === null) {
      suspension = defaultSuspension(candidates, row.count, k);
    } else {
      suspension = candidates.find((c) => c.name === row.suspension) ?? null;
      if (suspension === null) throw new Error(`suspension "${row.suspension}" does not carry "${store.key}" here`);
    }
    if (suspension !== null) cap = capacity(suspension.name) * k;
  }
  const count = Math.min(row.count, cap);
  if (count < row.count)
    notes.push(`Count limited to ${String(count)}: what the suspension carries (Limitations II.4).`);
  return { row, store, count, suspension, loaded: row.stations.slice(0, Math.min(count, k)), notes };
}

/**
 * What each station holds, for the tank variants. A pair row does not say which station carries an odd store,
 * so every loaded station of the row counts the higher share.
 */
function neighbours(resolved: readonly Resolved[]): Map<Station, Neighbour> {
  const map = new Map<Station, Neighbour>();
  for (const r of resolved) {
    const perStation = Math.ceil(r.count / r.row.stations.length);
    const aim9 = r.store !== null && /^AIM-9/.test(r.store.name);
    for (const s of r.loaded) map.set(s, { loaded: true, aim9, perStation });
  }
  return map;
}

const NOTHING: Neighbour = { loaded: false, aim9: false, perStation: 0 };
const INBOARD: Partial<Record<Station, Station>> = { '4': '3', '6': '7' };

function tankConditionAt(
  station: Station,
  at: Map<Station, Neighbour>,
): { condition: TankCondition; note: string | null } {
  if (station === '5') return centrelineCondition(at.get('4') ?? NOTHING, at.get('6') ?? NOTHING);
  const inboard = INBOARD[station];
  if (inboard === undefined) throw new Error(`a tank at station ${station} has no printed variant`);
  return { condition: wingCondition(at.get(inboard) ?? NOTHING), note: null };
}

function line(
  r: Resolved,
  count: number,
  stations: number,
  each: { readonly exact: number; readonly conservative: number },
  variant: string | null,
  notes: readonly string[],
): DragLine {
  const eachExact = each.exact;
  const eachConservative = each.conservative;
  const suspensionCount = r.suspension === null ? 0 : stations;
  const suspensionDrag = r.suspension === null ? 0 : suspensionCount * r.suspension.drag.subsonic;
  return {
    row: r.row,
    count,
    eachExact,
    eachConservative,
    suspension: r.suspension,
    suspensionCount,
    variant,
    exact: count * eachExact + suspensionDrag,
    conservative: count * eachConservative + suspensionDrag,
    notes,
  };
}

/** A tank row: one line per run of stations with the same variant. */
function tankLines(r: Resolved, store: StoreRow, at: Map<Station, Neighbour>): DragLine[] {
  const picks = r.loaded.map((station) => {
    const { condition, note } = tankConditionAt(station, at);
    const variant = store.variants.find((v) => v.condition === condition);
    if (variant === undefined) throw new Error(`${String(store.group)} has no variant for "${condition}"`);
    return { variant, note };
  });
  const lines: DragLine[] = [];
  let start = 0;
  for (let i = 1; i <= picks.length; i += 1) {
    const first = picks[start];
    if (first === undefined) break;
    if (picks[i]?.variant === first.variant && picks[i]?.note === first.note) continue;
    const each = first.variant.drag.subsonic;
    const notes = [...r.notes, ...(first.note === null ? [] : [first.note])];
    lines.push(line(r, i - start, i - start, { exact: each, conservative: each }, first.variant.name, notes));
    start = i;
  }
  return lines;
}

function rowLines(cat: Catalogue, r: Resolved, at: Map<Station, Neighbour>): DragLine[] {
  if (r.store === null) {
    const tip = tipMissileDrag(cat);
    const note = `No tip missile: −${String(tip)} each exact, 0 conservative (sheet 3, note *).`;
    return [line(r, r.count, r.loaded.length, { exact: -tip, conservative: 0 }, null, [...r.notes, note])];
  }
  if (r.store.variants.length > 0) return tankLines(r, r.store, at);
  const { each, note } = storeEach(cat, r.store);
  return [
    line(r, r.count, r.loaded.length, { exact: each, conservative: each }, null, [
      ...r.notes,
      ...(note === null ? [] : [note]),
    ]),
  ];
}

/** The drag index of a loadout: basic aircraft (subsonic) + every loaded row + `additional`, exact and conservative. */
export function dragIndex(cat: Catalogue, loadout: Loadout, additional: number): DragIndex {
  const seen = new Set<Station>();
  for (const row of loadout) {
    for (const s of row.stations) {
      if (seen.has(s)) throw new Error(`station ${s} is in two loadout rows`);
      seen.add(s);
    }
  }
  const resolved = loadout.filter((row) => row.storeKey !== null).map((row) => resolve(cat, row));
  const at = neighbours(resolved);
  const lines = resolved.flatMap((r) => rowLines(cat, r, at));
  const sum = (pick: (l: DragLine) => number): number => lines.reduce((total, l) => total + pick(l), 0);
  const base = cat.basic.subsonic + additional;
  return { exact: base + sum((l) => l.exact), conservative: base + sum((l) => l.conservative), lines };
}
