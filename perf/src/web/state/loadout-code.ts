/**
 * The loadout in the hash (TOLD 1.8 "Loadout encoding"): rows joined by `;`, each `stations:storeKey:suspension:count`
 * with stations joined by `-`, each part through `encodeURIComponent`, a null store or suspension an empty part. A
 * `noTipMissile` row carries the literal `noTipMissile` as its store part. No DOM.
 */
import type { Station } from '../../core/dragindex/catalogue.ts';
import type { Loadout, LoadoutRow } from '../../core/dragindex/loadout-row.ts';

const STATIONS: readonly Station[] = ['1', '2', '3', '4', '5', '5L', '5R', '6', '7', '8', '9'];
const isStation = (text: string): text is Station => (STATIONS as readonly string[]).includes(text);
const COUNT = /^[0-3]$/;

function encodeRow(row: LoadoutRow): string {
  return [row.stations.join('-'), row.storeKey ?? '', row.suspension ?? '', String(row.count)]
    .map(encodeURIComponent)
    .join(':');
}

export function encodeLoadout(loadout: Loadout): string {
  return loadout.map(encodeRow).join(';');
}

/** One row, or null when it does not decode (part count, station, count, a malformed escape). */
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
  return {
    stations,
    storeKey: storeKey === '' ? null : storeKey,
    suspension: suspension === '' ? null : suspension,
    count: Number(countText),
  };
}

/** The rows that decode, in order, and how many did not. An empty string is an empty loadout. */
export function decodeLoadout(text: string): { loadout: LoadoutRow[]; droppedRows: number } {
  const loadout: LoadoutRow[] = [];
  let droppedRows = 0;
  if (text === '') return { loadout, droppedRows };
  for (const part of text.split(';')) {
    const row = decodeRow(part);
    if (row === null) droppedRows += 1;
    else loadout.push(row);
  }
  return { loadout, droppedRows };
}
