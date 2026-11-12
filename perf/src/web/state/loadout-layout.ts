/**
 * A decoded loadout put back onto the station layout (final review I2): the builder has no control to add a station
 * row back, so a link or stored string that lost rows would lose those stations for good. The rows that decoded are
 * kept, in order; every station none of them covers gets its default empty row from `DEFAULT_LOADOUT`, where the
 * default order has it. A pair with both halves uncovered comes back as the pair; a pair with one half covered (a
 * split pair that lost a row) gets the other half as a single empty row next to it. No DOM.
 */
import type { Station } from '../../core/dragindex/catalogue.ts';
import { DEFAULT_LOADOUT } from '../../core/dragindex/loadout-row.ts';
import type { Loadout, LoadoutRow } from '../../core/dragindex/loadout-row.ts';

/** A station's place in the default layout: its row's index, then its place in the row (3 before 7). */
function rankOf(station: Station): number {
  for (const [i, row] of DEFAULT_LOADOUT.entries()) {
    const j = row.stations.indexOf(station);
    if (j >= 0) return i + j / 10;
  }
  return DEFAULT_LOADOUT.length;
}

const rowRank = (row: LoadoutRow): number => Math.min(...row.stations.map(rankOf));

const emptyRow = (stations: readonly Station[]): LoadoutRow => ({
  stations,
  storeKey: null,
  suspension: null,
  count: stations.length,
});

export function normaliseLoadout(rows: Loadout): LoadoutRow[] {
  const covered = new Set(rows.flatMap((row) => row.stations));
  const out: LoadoutRow[] = [...rows];
  for (const row of DEFAULT_LOADOUT) {
    const missing = row.stations.filter((s) => !covered.has(s));
    if (missing.length === 0) continue;
    const added = missing.length === row.stations.length ? row : emptyRow(missing);
    const rank = rowRank(added);
    const at = out.findIndex((r) => rowRank(r) > rank);
    out.splice(at < 0 ? out.length : at, 0, added);
  }
  return out;
}
