/**
 * Loadout → drag index, exact and conservative (Fig. B1-1; TOLD.md decisions of 29 Oct 2026, section 5.2).
 * Basic aircraft + each loaded row's stores and suspensions + the pilot's additional drag index. The loadout is
 * user input: one the catalogue does not allow gives `ok: false` with `checkLoadout`'s problems, never a throw (a
 * throw here is a data defect). A count over what the suspension carries is capped, with a note.
 */
import {
  storesFor,
  suspensionsFor,
  type Catalogue,
  type Station,
  type StoreRow,
  type SuspensionRow,
} from './catalogue.ts';
import { checkLoadout, type LoadoutProblem } from './check.ts';
import type { Loadout, LoadoutRow } from './loadout-row.ts';
import { capacity } from './racks.ts';
import { centrelineCondition, wingCondition, type Neighbour, type TankCondition } from './tank.ts';
import { isAim9, storeEach, tipMissileDrag } from './tip.ts';

export { DEFAULT_LOADOUT, type Loadout, type LoadoutRow } from './loadout-row.ts';
export { checkLoadout, type LoadoutProblem } from './check.ts';

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

export type DragIndex =
  | { readonly ok: true; readonly exact: number; readonly conservative: number; readonly lines: readonly DragLine[] }
  | { readonly ok: false; readonly problems: readonly LoadoutProblem[] };

/** A loaded row, resolved against the catalogue: its store (null: no tip missile), count and suspension. */
interface Resolved {
  readonly row: LoadoutRow;
  readonly store: StoreRow | null;
  readonly count: number;
  readonly suspension: SuspensionRow | null;
  readonly loaded: readonly Station[];
  readonly notes: readonly string[];
}

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
  const notes: string[] = [];
  let store: StoreRow | null = null;
  let suspension: SuspensionRow | null = null;
  let cap = k;
  if (row.storeKey !== 'noTipMissile') {
    const key = row.storeKey;
    store = storesFor(cat, row.stations).find((s) => s.key === key) ?? null;
    if (store === null) throw new Error(`unreachable: checkLoadout passed store "${String(key)}"`);
    const candidates = suspensionsFor(cat, store, row.stations);
    if (row.suspension === null) {
      suspension = defaultSuspension(candidates, row.count, k);
    } else {
      suspension = candidates.find((c) => c.name === row.suspension) ?? null;
      if (suspension === null) throw new Error(`unreachable: checkLoadout passed suspension "${row.suspension}"`);
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
    const aim9 = r.store !== null && isAim9(r.store);
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

/**
 * The drag index of a loadout: basic aircraft (subsonic) + every loaded row + `additional`, exact and
 * conservative. A loadout `checkLoadout` finds problems in gives `ok: false` with them.
 */
export function dragIndex(cat: Catalogue, loadout: Loadout, additional: number): DragIndex {
  const problems = checkLoadout(cat, loadout);
  if (problems.length > 0) return { ok: false, problems };
  const resolved = loadout.filter((row) => row.storeKey !== null).map((row) => resolve(cat, row));
  const at = neighbours(resolved);
  const lines = resolved.flatMap((r) => rowLines(cat, r, at));
  const sum = (pick: (l: DragLine) => number): number => lines.reduce((total, l) => total + pick(l), 0);
  const base = cat.basic.subsonic + additional;
  return { ok: true, exact: base + sum((l) => l.exact), conservative: base + sum((l) => l.conservative), lines };
}
