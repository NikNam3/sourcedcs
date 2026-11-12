/**
 * The "Fill in to compute" line under a TOLD table: the empty fields its columns wait for, in page order. Without it
 * a table of "—" gives no hint that, say, the far-end elevation is still empty (every column needs all of its
 * inputs). A field that is filled but does not parse is left out: it is underlined. Pure: no DOM.
 */
import type { InputField, Inputs } from '../../core/inputs/inputs.ts';
import type { ToldColumn } from '../../core/told/told.ts';

import type { LineModel } from './table-lines.ts';

/** Each input's name in the line, in the page's order. CG, RCR and the additional drag index take their default when empty. */
const NAMES: readonly (readonly [InputField, string])[] = [
  ['takeoffGwLb', 'takeoff GW'],
  ['landingGwLb', 'landing GW'],
  ['runway', 'runway'],
  ['headingDeg', 'heading'],
  ['lengthFt', 'length available'],
  ['nearElevFt', 'threshold elevation'],
  ['farElevFt', 'far-end elevation'],
  ['altimeterInHg', 'altimeter'],
  ['tempC', 'temperature'],
  ['wind', 'wind'],
];

/** The line for the columns' empty inputs, or none when no column waits for an empty field. */
export function missingLines(columns: readonly ToldColumn<string, unknown>[], typed: Inputs): LineModel[] {
  const wanted = new Set<string>();
  for (const column of columns) {
    for (const cell of Object.values(column.cells))
      if (cell.kind === 'unparsed') for (const f of cell.fields) wanted.add(f);
  }
  const names = NAMES.filter(([field]) => wanted.has(field) && typed[field].trim() === '').map(([, name]) => name);
  return names.length === 0 ? [] : [{ figure: null, text: `Fill in to compute: ${names.join(', ')}` }];
}
