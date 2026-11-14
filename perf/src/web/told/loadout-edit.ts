/**
 * The drag index builder's edits on a `Loadout` (TOLD.md decisions of 29 Oct 2026). Pure: every edit returns a new
 * loadout and leaves the old one alone; an index outside the loadout, or an edit that does not apply (split on a
 * single station, join on anything but the first of two split rows), returns the loadout unchanged.
 */
import type { Station } from '../../core/dragindex/catalogue.ts';
import type { Loadout, LoadoutRow } from '../../core/dragindex/loadout.ts';

/** The station pairs, as in the manual's worked example. A split pair becomes two rows, in this order. */
export const PAIRS: readonly (readonly [Station, Station])[] = [
  ['1', '9'],
  ['2', '8'],
  ['3', '7'],
  ['4', '6'],
];

/** The most stores per station any suspension carries (a TER or a LAU-88, Limitations II.4). */
const MOST_PER_STATION = 3;

/** The highest count a row on these stations can hold, whatever its suspension. */
export const maxCount = (stations: readonly Station[]): number => MOST_PER_STATION * stations.length;

/** The pair these stations are, or null. */
export function pairOf(stations: readonly Station[]): readonly [Station, Station] | null {
  const [a, b] = stations;
  return PAIRS.find((p) => stations.length === 2 && p[0] === a && p[1] === b) ?? null;
}

function replace(l: Loadout, row: number, edit: (r: LoadoutRow) => LoadoutRow): Loadout {
  const old = l[row];
  if (old === undefined) return l;
  return l.map((r, i) => (i === row ? edit(old) : r));
}

/** A new store (null: empty): the suspension back to the default, one store per station. */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- names the sentinel in the type
export function setStore(l: Loadout, row: number, storeKey: string | 'noTipMissile' | null): Loadout {
  return replace(l, row, (r) => ({ ...r, storeKey, suspension: null, count: r.stations.length }));
}

/** A suspension by its sheet 2 name; null is the default (the smallest that carries the count). */
export function setSuspension(l: Loadout, row: number, name: string | null): Loadout {
  return replace(l, row, (r) => ({ ...r, suspension: name }));
}

/** A count, rounded and clamped to 1 .. `maxCount`; a count that is not a number is 1. */
export function setCount(l: Loadout, row: number, count: number): Loadout {
  return replace(l, row, (r) => {
    const whole = Number.isFinite(count) ? Math.round(count) : 1;
    return { ...r, count: Math.min(Math.max(whole, 1), maxCount(r.stations)) };
  });
}

/**
 * A pair → two single-station rows with the same store and suspension, the count shared out, the first station
 * taking the odd one. A pair at count 1 loads only its first station, so the second row is then empty.
 */
export function split(l: Loadout, row: number): Loadout {
  const r = l[row];
  const pair = r === undefined ? null : pairOf(r.stations);
  if (r === undefined || pair === null) return l;
  const first = Math.ceil(r.count / 2);
  const second = r.count - first;
  const a: LoadoutRow = { stations: [pair[0]], storeKey: r.storeKey, suspension: r.suspension, count: first };
  const b: LoadoutRow =
    second > 0 && r.storeKey !== null
      ? { stations: [pair[1]], storeKey: r.storeKey, suspension: r.suspension, count: second }
      : { stations: [pair[1]], storeKey: null, suspension: null, count: 1 };
  return [...l.slice(0, row), a, b, ...l.slice(row + 1)];
}

/**
 * The first of two split rows → the pair again. The first station's store wins: with the same store the counts
 * add; with another store on the second, the first's count goes on both; with only the second loaded, its store
 * and count. Both empty: an empty pair.
 */
export function join(l: Loadout, row: number): Loadout {
  const a = l[row];
  const b = l[row + 1];
  if (a === undefined || b === undefined) return l;
  const [sa] = a.stations;
  const [sb] = b.stations;
  if (a.stations.length !== 1 || b.stations.length !== 1 || sa === undefined || sb === undefined) return l;
  const pair = pairOf([sa, sb]);
  if (pair === null) return l;
  let joined: LoadoutRow;
  if (a.storeKey === null && b.storeKey === null) {
    joined = { stations: pair, storeKey: null, suspension: null, count: 2 };
  } else if (a.storeKey === null) {
    joined = { stations: pair, storeKey: b.storeKey, suspension: b.suspension, count: b.count };
  } else {
    const count = b.storeKey === null ? a.count : b.storeKey === a.storeKey ? a.count + b.count : a.count * 2;
    joined = { stations: pair, storeKey: a.storeKey, suspension: a.suspension, count };
  }
  return [...l.slice(0, row), joined, ...l.slice(row + 2)];
}
