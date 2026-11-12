/**
 * The TOLD tables' rows and cells (TOLD 1.8 "Cells"), in MDC order: exact regular, conservative bold, a cell that
 * does not compute "—", a cell with a rule mark red (exact and conservative on their own). Runway used is the
 * cell's distance over the runway length, with the distance cell's marks. Pure: no DOM.
 */
import type { DerivedInputs } from '../../core/inputs/derive.ts';
import type { Read } from '../../core/result.ts';
import type { ToldCell, ToldColumn } from '../../core/told/told.ts';
import type { LandingKey, LandingSide } from '../../core/told/landing.ts';
import { runwayUsedPct } from '../../core/told/rules.ts';
import type { TakeoffKey, TakeoffSide } from '../../core/told/takeoff.ts';
import type { Told } from '../../core/told/told.ts';
import { DASH, formatDistance, formatPercent, formatSpeed, formatThousands } from '../format.ts';

import { accelLabel } from './table-lines.ts';

type Which = 'exact' | 'conservative';
type Format = 'speed' | 'distance' | 'percent';

export interface CellModel {
  readonly text: string;
  /** 'num exact' or 'num cons', with 'no-value' for "—" and 'alert' for a rule mark. */
  readonly className: string;
}

export type RowModel =
  | {
      readonly kind: 'values';
      readonly label: string;
      readonly figures: readonly string[];
      readonly cells: readonly CellModel[];
      readonly groupStart: boolean;
    }
  | {
      readonly kind: 'subheading';
      readonly title: string;
      readonly weight: string | null;
      readonly groupStart: boolean;
    };

function valueText(read: Read<number>, which: Which, format: Format, runwayFt: number | null): string {
  if (format === 'speed') return formatSpeed(read, which);
  if (format === 'distance') return formatDistance(read, which);
  if (!read.ok || runwayFt === null) return DASH;
  return formatPercent(runwayUsedPct(read.value, runwayFt));
}

function cellModels<S>(cell: ToldCell<S>, format: Format, runwayFt: number | null): CellModel[] {
  return (['exact', 'conservative'] as const).map((which) => {
    const base = which === 'exact' ? 'num exact' : 'num cons';
    if (cell.kind === 'unparsed') return { text: DASH, className: `${base} no-value` };
    const text = valueText(cell.cell[which], which, format, runwayFt);
    const alert = cell.marks.some((m) => m.cell === which);
    return { text, className: [base, text === DASH ? 'no-value' : '', alert ? 'alert' : ''].filter(Boolean).join(' ') };
  });
}

/** One row: the label, its figures, the four cells (first column exact and cons., then the second). */
function row<K extends string, S>(
  columns: readonly [ToldColumn<K, S>, ToldColumn<K, S>],
  key: K,
  format: Format,
  runwayFt: number | null,
  label: string,
  figures: readonly string[],
  groupStart = false,
): RowModel {
  const cells = columns.flatMap((c) => cellModels(c.cells[key], format, runwayFt));
  return { kind: 'values', label, figures, cells, groupStart };
}

const runwayOf = (derived: DerivedInputs): number | null => (derived.runwayFt.ok ? derived.runwayFt.value : null);

export function takeoffRows(told: Told, derived: DerivedInputs): RowModel[] {
  const cols: readonly [ToldColumn<TakeoffKey, TakeoffSide>, ToldColumn<TakeoffKey, TakeoffSide>] = [
    told.takeoff.mil,
    told.takeoff.ab,
  ];
  const rwy = runwayOf(derived);
  return [
    row(cols, 'rotation', 'speed', rwy, 'Rotation, KIAS', ['B2-2']),
    row(cols, 'takeoffSpeed', 'speed', rwy, 'Takeoff speed, KIAS', ['B2-2']),
    row(cols, 'distance', 'distance', rwy, 'Takeoff distance, ft', ['B2-3'], true),
    row(cols, 'distance', 'percent', rwy, 'Runway used, %', ['B2-3']),
    row(cols, 'accelCheck', 'speed', rwy, accelLabel(told), ['B2-4'], true),
    row(cols, 'refusalDry', 'speed', rwy, 'Refusal speed, dry, KIAS', ['B2-5', 'B2-6']),
    row(cols, 'refusalWet', 'speed', rwy, 'Refusal speed, wet, KIAS', ['B2-5', 'B2-6']),
  ];
}

export function landingRows(told: Told, derived: DerivedInputs, weight: 'normal' | 'heavy'): RowModel[] {
  const { dry, wet } = told.landing[weight];
  const cols: readonly [ToldColumn<LandingKey, LandingSide>, ToldColumn<LandingKey, LandingSide>] = [dry, wet];
  const rwy = runwayOf(derived);
  const gw = weight === 'normal' ? derived.landingGwLb : derived.takeoffGwLb;
  return [
    {
      kind: 'subheading',
      title: weight === 'normal' ? 'Normal' : 'Heavyweight',
      weight: gw.ok ? `${formatThousands(gw.value)} lb` : null,
      groupStart: weight === 'heavy',
    },
    row(cols, 'finalApproach', 'speed', rwy, 'Final approach, KIAS', ['B7-1']),
    row(cols, 'touchdown', 'speed', rwy, 'Touchdown, KIAS', ['B7-1']),
    row(cols, 'distance', 'distance', rwy, 'Landing distance, ft', ['B7-2']),
    row(cols, 'distance', 'percent', rwy, 'Runway used, %', ['B7-2']),
  ];
}
