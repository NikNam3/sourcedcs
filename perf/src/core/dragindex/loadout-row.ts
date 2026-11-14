/** The loadout the pilot builds: one row per station pair or single station. */
import type { Station } from './catalogue.ts';

/**
 * One station row: the store, the suspension (null: the default), the count over all its stations. The stations
 * loaded are the first `min(count, stations)`: a pair at count 1 loads only its first station (3 of 3/7), which
 * plan 3's display should show.
 */
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
