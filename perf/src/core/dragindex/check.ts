/**
 * What is wrong with a loadout, against the catalogue. The loadout is user input: a problem is reported, never
 * thrown. Empty rows (`storeKey` null) are not checked beyond their stations.
 */
import { storesFor, suspensionsFor, type Catalogue, type Station } from './catalogue.ts';
import type { Loadout, LoadoutRow } from './loadout-row.ts';

export interface LoadoutProblem {
  /** The row's index in the loadout. */
  readonly row: number;
  readonly code:
    | 'stationTwice' // a station already in an earlier row
    | 'badCount' // not a whole number from 1
    | 'unknownStore' // no Fig. B1-1 store has this key
    | 'storeOffStations' // the store is not allowed on every one of the row's stations
    | 'tipOnly' // no tip missile off stations 1 and 9
    | 'suspensionOffStore'; // the suspension does not carry the store here (or any with no tip missile)
}

const TIP: readonly Station[] = ['1', '9'];

function rowProblem(cat: Catalogue, row: LoadoutRow): LoadoutProblem['code'] | null {
  if (!Number.isInteger(row.count) || row.count < 1) return 'badCount';
  if (row.storeKey === 'noTipMissile') {
    if (!row.stations.every((s) => TIP.includes(s))) return 'tipOnly';
    return row.suspension === null ? null : 'suspensionOffStore';
  }
  const key = row.storeKey;
  const anywhere = cat.stores.find((s) => s.key === key);
  if (anywhere === undefined) return 'unknownStore';
  const store = storesFor(cat, row.stations).find((s) => s.key === key);
  if (store === undefined) return 'storeOffStations';
  if (row.suspension === null) return null;
  const carries = suspensionsFor(cat, store, row.stations).some((c) => c.name === row.suspension);
  return carries ? null : 'suspensionOffStore';
}

/** Every problem in the loadout, in row order; empty when `dragIndex` can compute it. */
export function checkLoadout(cat: Catalogue, loadout: Loadout): readonly LoadoutProblem[] {
  const problems: LoadoutProblem[] = [];
  const seen = new Set<Station>();
  loadout.forEach((row, index) => {
    if (row.stations.some((s) => seen.has(s))) problems.push({ row: index, code: 'stationTwice' });
    for (const s of row.stations) seen.add(s);
    if (row.storeKey === null) return;
    const code = rowProblem(cat, row);
    if (code !== null) problems.push({ row: index, code });
  });
  return problems;
}
