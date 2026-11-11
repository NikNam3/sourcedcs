/**
 * Fig. B1-1 sheet 7's tank variants: a tank's drag index depends on what is loaded next to it. A wing tank looks
 * at the store inboard of it (4 at 3, 6 at 7), the centreline tank at 4 and 6.
 */

/** What a variant row's printed text asks of the neighbouring stations. */
export type TankCondition = 'none' | 'aim9' | 'single' | 'multiple' | 'both';

const CONDITIONS: readonly [RegExp, TankCondition][] = [
  [/^NO STORES AT (3 OR 7|4 OR 6)$/, 'none'],
  [/^AIM-9'S AT 3 OR 7$/, 'aim9'],
  [/^SINGLE RACKS OR STORES AT 3 OR 7$/, 'single'],
  [/^MULTIPLE STORES AT 3 OR 7$/, 'multiple'],
  [/^STORES AT 4 AND 6$/, 'both'],
];

/** A tank group heading, "370-GALLON TANK (EMPTY/FULL):". */
export function isTankGroup(group: string | null): boolean {
  return group !== null && / TANK \(EMPTY\/FULL\):$/.test(group);
}

/** The condition a variant row's printed text states. Any other text is a data defect and throws. */
export function tankCondition(text: string): TankCondition {
  const found = CONDITIONS.find(([pattern]) => pattern.test(text));
  if (found === undefined) throw new Error(`Fig. B1-1 tank variant "${text}" states no known condition`);
  return found[1];
}

/** What one station holds, as a tank's neighbour sees it. */
export interface Neighbour {
  readonly loaded: boolean;
  readonly aim9: boolean;
  readonly perStation: number;
}

/** The wing tank's condition from the station inboard of it. */
export function wingCondition(inboard: Neighbour): TankCondition {
  if (!inboard.loaded) return 'none';
  if (inboard.aim9) return 'aim9';
  return inboard.perStation > 1 ? 'multiple' : 'single';
}

/**
 * The centreline tank's condition from 4 and 6. The manual prints "NO STORES AT 4 OR 6" and "STORES AT 4 AND 6";
 * one side loaded is printed nowhere and takes the higher, "both" (questioner Extra 2), with a note.
 */
export function centrelineCondition(at4: Neighbour, at6: Neighbour): { condition: TankCondition; note: string | null } {
  if (!at4.loaded && !at6.loaded) return { condition: 'none', note: null };
  if (at4.loaded && at6.loaded) return { condition: 'both', note: null };
  return {
    condition: 'both',
    note: 'Centreline tank with only one of 4 and 6 loaded: not printed; the "stores at 4 and 6" value is used.',
  };
}
