/**
 * A store's drag index each, with Fig. B1-1 sheet 3's tip rules (questioner Extra 1). The `*` mark is not one
 * rule: on a sheet 3 row at stations 1 or 9, `4*` is the tip AIM-9 already in the basic aircraft (adds 0) and
 * `2**` a tip pod that replaces it (its value less the tip AIM-9's); elsewhere, as LANTIRN NAVIGATION's `32*`
 * ("*WITH PYLON"), the value adds as printed.
 */
import type { Catalogue, StoreRow } from './catalogue.ts';

const isTipRow = (store: StoreRow): boolean =>
  store.sheet === 3 && store.stations.length === 2 && store.stations.includes('1') && store.stations.includes('9');

/** The tip AIM-9's drag index (sheet 3, `4*`): what a removed tip missile or a tip pod takes away. */
export function tipMissileDrag(cat: Catalogue): number {
  const values = new Set(
    cat.stores.filter((s) => isTipRow(s) && s.drag.note === '*' && /^AIM-9/.test(s.name)).map((s) => s.drag.subsonic),
  );
  const [only] = values;
  if (only === undefined || values.size > 1) throw new Error('Fig. B1-1 sheet 3 has no single tip AIM-9 drag index');
  return only;
}

/** The drag index each store adds (subsonic), and the note that explains it, if any. */
export function storeEach(cat: Catalogue, store: StoreRow): { each: number; note: string | null } {
  const { drag } = store;
  if (isTipRow(store) && drag.note === '*') {
    return { each: 0, note: 'A tip AIM-9 is in the basic aircraft (sheet 3, note *): adds 0.' };
  }
  if (isTipRow(store) && drag.note === '**') {
    const tip = tipMissileDrag(cat);
    return {
      each: drag.subsonic - tip,
      note: `A tip pod replaces the tip AIM-9 (sheet 3, note **): ${String(drag.subsonic)} − ${String(tip)}.`,
    };
  }
  if (drag.supersonic !== null) {
    return { each: drag.subsonic, note: 'Two values printed (subsonic/supersonic): the subsonic one.' };
  }
  return { each: drag.subsonic, note: null };
}
