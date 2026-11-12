/**
 * The drag index builder's texts (TOLD.md decisions of 29 Oct 2026): store names as printed less the line-break
 * hyphen, the store menu's options grouped under the manual's headings, the problem lines. Pure: no DOM.
 */
import { storesFor, type Catalogue, type Station, type StoreRow } from '../../core/dragindex/catalogue.ts';
import type { Loadout, LoadoutProblem } from '../../core/dragindex/loadout.ts';
import { tipMissileDrag } from '../../core/dragindex/tip.ts';

/** A whole number with a true minus sign: −4. */
export const signed = (n: number): string => (n < 0 ? `−${String(-n)}` : String(n));

/** Printed text without the line-break hyphen: "LAUNCHER- WITH" → "LAUNCHER WITH". */
export const unbreak = (text: string): string => text.replace(/(\S)- /g, '$1 ');

/** A group heading for the menu: unbroken, without its closing colon. */
export const heading = (group: string | null): string => (group === null ? '' : unbreak(group).replace(/:$/, ''));

const TANK_SUFFIX = / \(EMPTY\/FULL\):$/;

/** A store's name in the builder: a tank group by its heading ("370-GALLON TANK"), any other as printed. */
export function storeText(store: StoreRow): string {
  if (store.variants.length > 0) return unbreak(store.group ?? '').replace(TANK_SUFFIX, '');
  return unbreak(store.name);
}

export const NO_TIP_TEXT = 'NO TIP MISSILE';
export const EMPTY_TEXT = '— empty';

/** The stations as the builder labels them: "1, 9". */
export const stationLabel = (stations: readonly Station[]): string => stations.join(', ');

const TIP: readonly Station[] = ['1', '9'];
const isTip = (stations: readonly Station[]): boolean => stations.length > 0 && stations.every((s) => TIP.includes(s));

export interface MenuOption {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- names the sentinel in the type
  readonly key: string | 'noTipMissile' | null;
  readonly text: string;
  /** The manual's heading the option sits under; '' for none. */
  readonly heading: string;
  readonly rack: string;
  /** The drag index as printed ("13/8", "4*"); a tank's depends on its neighbour ("by 3/7"). */
  readonly dragText: string;
}

/** The store menu for one row: empty, no tip missile at 1/9, then the stores allowed there, in printed order. */
export function menuOptions(cat: Catalogue, stations: readonly Station[]): MenuOption[] {
  const options: MenuOption[] = [{ key: null, text: EMPTY_TEXT, heading: '', rack: '', dragText: '' }];
  if (isTip(stations)) {
    const tip = tipMissileDrag(cat);
    options.push({ key: 'noTipMissile', text: NO_TIP_TEXT, heading: '', rack: 'NONE', dragText: signed(-tip) });
  }
  for (const s of storesFor(cat, stations)) {
    const tank = s.variants.length > 0;
    options.push({
      key: s.key,
      text: storeText(s),
      heading: tank ? '' : heading(s.group),
      rack: s.rack,
      dragText: tank ? (s.stations.includes('5') ? 'by 4/6' : 'by 3/7') : s.drag.printed,
    });
  }
  return options;
}

/** The options a typed filter keeps: heading and name contain it, case ignored; an empty filter keeps all. */
export function filterOptions(options: readonly MenuOption[], typed: string): MenuOption[] {
  const q = typed.trim().toUpperCase();
  if (q === '') return [...options];
  return options.filter((o) => `${o.heading} ${o.text}`.toUpperCase().includes(q));
}

const PROBLEM: Readonly<Record<LoadoutProblem['code'], string>> = {
  noStations: 'names no station',
  stationTwice: 'a station is in two rows',
  badCount: 'the number of stores is not a whole number from 1',
  unknownStore: 'the store is not in Fig. B1-1 of this data version',
  storeOffStations: 'Fig. B1-1 does not allow the store here',
  tipOnly: 'no tip missile is only for stations 1 and 9',
  suspensionOffStore: 'the suspension does not carry the store here (Fig. B1-1 sheet 2)',
};

/** "Station 3, 7: the store is not in Fig. B1-1 of this data version." */
export function problemText(problem: LoadoutProblem, loadout: Loadout): string {
  const stations = loadout[problem.row]?.stations ?? [];
  const where = stations.length === 0 ? 'A loadout row' : `Station ${stationLabel(stations)}`;
  const sep = stations.length === 0 ? ' ' : ': ';
  return `${where}${sep}${PROBLEM[problem.code]}.`;
}
