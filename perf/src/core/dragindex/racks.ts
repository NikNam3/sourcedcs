/**
 * Fig. B1-1's rack strings (sheets 3 to 7, "RACK" column) and the sheet 2 suspension items that carry them
 * (questioner ruling Q3). The station filter in `suspensionsFor` does the rest: `PYLON` names one item per
 * station class and leaves none at 5L, whose LANTIRN navigation pod is printed "*WITH PYLON".
 */

const WEAPON_PYLON = 'WEAPON PYLON* (16S1700)';
const CENTERLINE_PYLON = 'CENTERLINE PYLON* (16S951)';
const TER_1750 = 'TER (16S1750) + WEAPON PYLON*';
const TER_66J = 'TER (66J45517) + WEAPON PYLON*';
const LAU_88A = 'LAU-88/A + WEAPON PYLON*';
const LAU_88AA = 'LAU-88 A/A + WEAPON PYLON*';
const LAU_117 = 'LAU-117/A, A(V)1/A, A(V)3/A + WEAPON PYLON*';

/** Every B1-1 rack string → the sheet 2 item names that carry it, in sheet 2 order. `NONE` carries nothing. */
export const RACK_SUSPENSIONS: Readonly<Record<string, readonly string[]>> = {
  LAUNCHER: ['AIM-9 LAUNCHER (16S210)', 'LAU-129/A LAUNCHER'],
  'LAUNCHER + ADAPTER': ['AIM-9 LAUNCHER (16S210) + ADAPTER (16S301)', 'LAU-129/A LAUNCHER + ADAPTER (16S301)'],
  PYLON: [CENTERLINE_PYLON, 'LANTIRN TARGETING POD PYLON (16S1150)', WEAPON_PYLON],
  'PYLON/TER': [CENTERLINE_PYLON, TER_1750, TER_66J, WEAPON_PYLON],
  TER: [TER_1750, TER_66J],
  'LAU-88/A, A/A, -117/A, A(V)1/A, A(V)3/A': [LAU_88A, LAU_88AA, LAU_117],
  // Sheet 7 (TGM-65) prints "A(V)1A": the manual's misprint, kept as its own key (TOLD.md 1.2).
  'LAU-88/A, A/A, -117/A, A(V)1A, A(V)3/A': [LAU_88A, LAU_88AA, LAU_117],
  'LAU-117/A, A(V)1/A, A(V)3/A': [LAU_117],
  'LAU-118(V)4/A': ['LAU-118(V)4/A + WEAPON PYLON*'],
  'PYLON (NJETT)': ['NONJETTISON (NJETT) FUEL PYLON*'],
  NONE: [],
};

/**
 * Stores one suspension item carries on one station. Fig. B1-1 gives no capacities: three on a TER or a LAU-88,
 * one otherwise, is the project's own limit (Limitations II.4).
 */
const CAPACITY: Readonly<Record<string, number>> = Object.fromEntries(
  [...new Set(Object.values(RACK_SUSPENSIONS).flat())].map((name) => [
    name,
    [TER_1750, TER_66J, LAU_88A, LAU_88AA].includes(name) ? 3 : 1,
  ]),
);

/** The capacity of a suspension item a rack string names. Any other name is a defect and throws. */
export function capacity(suspensionName: string): number {
  const found = Object.hasOwn(CAPACITY, suspensionName) ? CAPACITY[suspensionName] : undefined;
  if (found === undefined) throw new Error(`no rack carries the suspension "${suspensionName}"`);
  return found;
}

/** The sheet 2 item names a rack string names. An unknown rack string is a data defect and throws. */
export function rackSuspensions(rack: string): readonly string[] {
  const found = Object.hasOwn(RACK_SUSPENSIONS, rack) ? RACK_SUSPENSIONS[rack] : undefined;
  if (found === undefined) throw new Error(`Fig. B1-1 rack "${rack}" is not in the racks table`);
  return found;
}
