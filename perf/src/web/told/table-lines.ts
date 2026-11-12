/**
 * The grey lines under the TOLD tables (TOLD 1.8): one reason line per distinct reason per table, its figure a link
 * to the view; one rule line per distinct (rule, column), the exact mark's when the exact cell is marked, else the
 * conservative one's; RCR below 10 once, under the landing table; and the conservative check-distance line. Also
 * the acceleration check row's label. Pure: no DOM.
 */
import type { FigureSet } from '../../core/data/figure-set.ts';
import type { DerivedInputs } from '../../core/inputs/derive.ts';
import type { RuleMark } from '../../core/told/rules.ts';
import type { TakeoffKey, TakeoffSide } from '../../core/told/takeoff.ts';
import type { Told, ToldColumn } from '../../core/told/told.ts';
import { formatThousands } from '../format.ts';
import { reasonText, signsOf } from '../reasons.ts';
import type { Signs } from '../reasons.ts';
import { ruleLine } from '../rule-lines.ts';
import type { ColumnName } from '../rule-lines.ts';

import type { View } from '../figure-ref.ts';

export interface LineModel {
  /** The reason's figure: its label ('B2-6 sh. 2'), its file id and the view the link opens; null for other lines. */
  readonly figure: { readonly label: string; readonly id: string; readonly view: View } | null;
  readonly text: string;
}

interface Column {
  readonly name: ColumnName;
  readonly view: View;
  readonly column: ToldColumn<string, unknown>;
}

function reasonLines(columns: readonly Column[], figures: FigureSet, signs: Signs): LineModel[] {
  const seen = new Set<string>();
  const out: LineModel[] = [];
  for (const { view, column } of columns) {
    for (const reason of column.reasons) {
      const { figure, text } = reasonText(reason, figures, signs);
      const key = `${figure}: ${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ figure: { label: figure, id: reason.error.figure, view }, text });
    }
  }
  return out;
}

/** The column's marks, one per (rule, line): the exact mark when there is one. RCR below 10 is left out (once). */
function columnMarks(column: ToldColumn<string, unknown>): RuleMark[] {
  const chosen = new Map<string, RuleMark>();
  for (const cell of Object.values(column.cells)) {
    if (cell.kind !== 'computed') continue;
    for (const m of cell.marks) {
      if (m.rule === 'landing-rcr-10') continue;
      const key = `${m.rule}|${m.line ?? ''}`;
      const had = chosen.get(key);
      if (had === undefined || (had.cell === 'conservative' && m.cell === 'exact')) chosen.set(key, m);
    }
  }
  return [...chosen.values()];
}

function ruleLines(columns: readonly Column[], figures: FigureSet): LineModel[] {
  const texts = columns.flatMap(({ name, column }) => columnMarks(column).map((m) => ruleLine(m, name, null, figures)));
  return [...new Set(texts)].map((text) => ({ figure: null, text }));
}

const distanceText = (ft: number): string => `${formatThousands(ft)} ft`;

/** "Accel. check at 2,000 ft, KIAS", "at 2,000 / 1,000 ft" when MIL and MAX AB differ, from the exact cells. */
export function accelLabel(told: Told): string {
  const distances = [told.takeoff.mil, told.takeoff.ab].map((col) => {
    const cell = col.cells.accelCheck;
    return cell.kind === 'computed' ? cell.cell.exactSide.checkDistanceFt : null;
  });
  const known = distances.filter((d) => d !== null);
  const [first] = known;
  if (first === undefined) return 'Accel. check, KIAS';
  if (known.every((d) => d === first)) return `Accel. check at ${distanceText(first)}, KIAS`;
  return `Accel. check at ${known.map((d) => formatThousands(d)).join(' / ')} ft, KIAS`;
}

/** "MAX AB conservative: checked at 2,000 ft" for a conservative cell checked at the other distance. */
function checkLines(
  columns: readonly { name: ColumnName; column: ToldColumn<TakeoffKey, TakeoffSide> }[],
): LineModel[] {
  const out: LineModel[] = [];
  for (const { name, column } of columns) {
    const cell = column.cells.accelCheck;
    if (cell.kind !== 'computed') continue;
    const exact = cell.cell.exactSide.checkDistanceFt;
    const cons = cell.cell.conservativeSide.checkDistanceFt;
    if (exact !== null && cons !== null && cons !== exact) {
      out.push({ figure: null, text: `${name} conservative: checked at ${distanceText(cons)}` });
    }
  }
  return out;
}

export function takeoffLines(told: Told, derived: DerivedInputs, figures: FigureSet): LineModel[] {
  const columns: Column[] = [
    { name: 'MIL', view: 'takeoff', column: told.takeoff.mil },
    { name: 'MAX AB', view: 'takeoff', column: told.takeoff.ab },
  ];
  return [
    ...reasonLines(columns, figures, signsOf(derived)),
    ...ruleLines(columns, figures),
    ...checkLines([
      { name: 'MIL', column: told.takeoff.mil },
      { name: 'MAX AB', column: told.takeoff.ab },
    ]),
  ];
}

/**
 * RCR below 10 at the landing field, one line in all (TOLD 1.8 "shown once"): the input carries the mark, one per RCR
 * field; dry and wet both below 10 with different values name both, dry first ("RCR 8 / 6").
 */
function rcrLines(told: Told, derived: DerivedInputs, figures: FigureSet): LineModel[] {
  const [first] = told.rcrMarks;
  if (first === undefined) return [];
  const values: number[] = [];
  for (const m of told.rcrMarks) {
    const rcr = m.field === undefined ? null : derived[m.field];
    if (rcr?.ok === true && !values.includes(rcr.value)) values.push(rcr.value);
  }
  return [{ figure: null, text: ruleLine(first, null, values, figures) }];
}

export function landingLines(told: Told, derived: DerivedInputs, figures: FigureSet): LineModel[] {
  const { normal, heavy } = told.landing;
  const columns: Column[] = [
    { name: 'normal dry', view: 'normal', column: normal.dry },
    { name: 'normal wet', view: 'normal', column: normal.wet },
    { name: 'heavyweight dry', view: 'heavy', column: heavy.dry },
    { name: 'heavyweight wet', view: 'heavy', column: heavy.wet },
  ];
  return [
    ...reasonLines(columns, figures, signsOf(derived)),
    ...ruleLines(columns, figures),
    ...rcrLines(told, derived, figures),
  ];
}
