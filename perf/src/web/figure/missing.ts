/**
 * The grey line under a figure view's first sheet when a drawn column did not compute because of its inputs (final
 * review I1): the figure page has no fields, so it names them, as the TOLD page labels them (`web/index.html`, the
 * unit left off). A loadout problem has its own line. Pure: no DOM.
 */
import type { InputField } from '../../core/inputs/inputs.ts';
import type { UnparsedField } from '../../core/told/column.ts';

/** The TOLD page's field labels (RCR is one field there, "RCR dry / wet": each part is named on its own). */
const LABELS: Readonly<Record<InputField, string>> = Object.freeze({
  takeoffGwLb: 'Takeoff GW',
  landingGwLb: 'Landing GW',
  cgPct: 'CG',
  additionalDragIndex: 'Additional drag index',
  runway: 'Runway',
  headingDeg: 'Heading',
  lengthFt: 'Length avail.',
  nearElevFt: 'Threshold elev.',
  farElevFt: 'Far-end elev.',
  altimeterInHg: 'Altimeter',
  tempC: 'Temperature',
  wind: 'Wind',
  rcrDry: 'RCR dry',
  rcrWet: 'RCR wet',
});

export const LOADOUT_LINE = 'No path: the loadout has a problem (see the drag index builder).';

/** "A", "A and B", "A, B and C". */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The lines for the fields behind the columns that did not compute, in the order given; none when none. */
export function missingLines(missing: readonly UnparsedField[]): string[] {
  const fields = missing.filter((f): f is InputField => f !== 'loadout');
  const lines: string[] = [];
  if (fields.length > 0) lines.push(`No path: ${listOf(fields.map((f) => LABELS[f]))} not entered or not readable.`);
  if (missing.includes('loadout')) lines.push(LOADOUT_LINE);
  return lines;
}
