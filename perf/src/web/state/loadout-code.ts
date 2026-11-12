/**
 * The loadout in the hash (TOLD 1.8 "Loadout encoding"): rows joined by `;`, each `stations:storeKey:suspension:count`
 * with stations joined by `-`, each part through `encodeURIComponent`, a null store or suspension an empty part. A
 * `noTipMissile` row is an ordinary row with the literal `noTipMissile` as its store part (`1-9:noTipMissile::2`).
 * No DOM.
 */
import type { Station } from '../../core/dragindex/catalogue.ts';
import type { Loadout, LoadoutRow } from '../../core/dragindex/loadout-row.ts';

import { normaliseLoadout } from './loadout-layout.ts';

const STATIONS: readonly Station[] = ['1', '2', '3', '4', '5', '5L', '5R', '6', '7', '8', '9'];
const isStation = (text: string): text is Station => (STATIONS as readonly string[]).includes(text);
/** A count with no sign, no leading zero, no decimals; its range is checked against the row's stations. */
const COUNT = /^[1-9]\d*$/;
/** The most stores one station carries (a TER or LAU-88); more than its rack holds is `checkLoadout`'s to report. */
const MAX_PER_STATION = 3;

function encodeRow(row: LoadoutRow): string {
  return [row.stations.join('-'), row.storeKey ?? '', row.suspension ?? '', String(row.count)]
    .map(encodeURIComponent)
    .join(':');
}

export function encodeLoadout(loadout: Loadout): string {
  return loadout.map(encodeRow).join(';');
}

/**
 * One row, or null when it does not decode: not four parts, an empty or unknown station, a count that is not an
 * integer from 1 to 3 × the row's stations (ruling R1: the count is over all of them), or a malformed escape.
 */
function decodeRow(text: string): LoadoutRow | null {
  const parts = text.split(':');
  if (parts.length !== 4) return null;
  let decoded: string[];
  try {
    decoded = parts.map(decodeURIComponent);
  } catch {
    return null;
  }
  const [stationsText = '', storeKey = '', suspension = '', countText = ''] = decoded;
  const stations = stationsText.split('-');
  if (!stations.every(isStation)) return null;
  if (!COUNT.test(countText)) return null;
  const count = Number(countText);
  if (count > MAX_PER_STATION * stations.length) return null;
  return {
    stations,
    storeKey: storeKey === '' ? null : storeKey,
    suspension: suspension === '' ? null : suspension,
    count,
  };
}

/**
 * The rows that decode, in order, with every station they leave uncovered given its default empty row
 * (`normaliseLoadout`), and how many rows did not decode. An empty string is the default loadout.
 */
export function decodeLoadout(text: string): { loadout: LoadoutRow[]; droppedRows: number } {
  const rows: LoadoutRow[] = [];
  let droppedRows = 0;
  if (text !== '') {
    for (const part of text.split(';')) {
      const row = decodeRow(part);
      if (row === null) droppedRows += 1;
      else rows.push(row);
    }
  }
  return { loadout: normaliseLoadout(rows), droppedRows };
}
