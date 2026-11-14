/**
 * `computeTold` (TOLD 1.7, `told/told.ts`): parses and derives the inputs, builds the drag index, runs the six
 * evaluations (takeoff MIL and MAX AB; landing normal weight and heavyweight, dry and wet) and the runway rules, and
 * returns the one object plan 3's page renders. Figure data is passed in by figure id; core never fetches.
 *
 * A column whose inputs do not all parse is unparsed in every cell, naming the input fields it lacks (each once).
 * The takeoff columns also need the additional drag index (`parseNumber`, any sign; Extra 3) and a loadout the
 * builder computes (otherwise `loadout`, the problems in `dragIndex`); landing needs neither.
 */
import { evaluate } from '../ctx.ts';
import type { FigureSet } from '../data/figure-set.ts';
import { buildCatalogue } from '../dragindex/catalogue.ts';
import { dragIndex } from '../dragindex/loadout.ts';
import type { DragIndex, Loadout } from '../dragindex/loadout.ts';
import { deriveInputs } from '../inputs/derive.ts';
import type { Derived, DerivedInputs } from '../inputs/derive.ts';
import type { Inputs } from '../inputs/inputs.ts';
import { parseNumber } from '../inputs/parse.ts';

import { computedColumn, unparsedColumn } from './column.ts';
import type { ToldColumn, UnparsedField } from './column.ts';
import { LANDING_FIELDS, LANDING_KINDS, landingChain } from './landing.ts';
import type { LandingKey, LandingSide, LandingValues } from './landing.ts';
import { landingMarks, mark, RCR_MIN, takeoffMarks } from './rules.ts';
import type { RuleMark } from './rules.ts';
import { TAKEOFF_FIELDS, TAKEOFF_KINDS, takeoffChain } from './takeoff.ts';
import type { TakeoffKey, TakeoffSide, TakeoffValues } from './takeoff.ts';

export type { Reason, ToldCell, ToldColumn, UnparsedField } from './column.ts';

type Mode = 'mil' | 'ab';
type Weight = 'normal' | 'heavy';
type Surface = 'dry' | 'wet';

export interface Told {
  /** The builder's result; with an additional drag index that does not parse, the loadout's with 0 added. */
  readonly dragIndex: DragIndex;
  readonly takeoff: Readonly<Record<Mode, ToldColumn<TakeoffKey, TakeoffSide>>>;
  readonly landing: Readonly<Record<Weight, Readonly<Record<Surface, ToldColumn<LandingKey, LandingSide>>>>>;
  /** 3.18, RCR below 10 at the landing field: one mark per RCR input below 10, on the input. */
  readonly rcrMarks: readonly RuleMark[];
}

/** The input fields behind the derived values `names` that did not compute, each once, in order. */
function missingFields(derived: DerivedInputs, names: readonly (keyof DerivedInputs)[]): UnparsedField[] {
  const fields = new Set<UnparsedField>();
  for (const name of names) {
    const value = derived[name];
    if (!value.ok) for (const field of value.fields) fields.add(field);
  }
  return [...fields];
}

/** The value of a derived input `missingFields` found computed. */
function valueOf(d: Derived<number>): number {
  if (!d.ok) throw new Error('unreachable: a column runs only with every input it needs computed');
  return d.value;
}

/** One column's chain values, or the input fields it lacks (each once). `runwayFt` is for the runway rules. */
export type ColumnValues<V> =
  | { readonly ok: true; readonly values: V; readonly runwayFt: number }
  | { readonly ok: false; readonly fields: readonly UnparsedField[] };

/**
 * The values each chain runs on, exactly as `computeTold` builds them (plan 3's figure view runs the same chains):
 * the takeoff values (both modes), the landing values per weight and surface, and the drag index builder's result.
 */
export interface ChainValues {
  readonly dragIndex: DragIndex;
  readonly takeoff: ColumnValues<TakeoffValues>;
  readonly landing: Readonly<Record<Weight, Readonly<Record<Surface, ColumnValues<LandingValues>>>>>;
}

function takeoffValues(
  derived: DerivedInputs,
  drag: DragIndex,
  extra: readonly UnparsedField[],
): ColumnValues<TakeoffValues> {
  const fields = [...missingFields(derived, TAKEOFF_FIELDS), ...extra];
  // A drag index that is not ok is already in `fields` as 'loadout'; `!drag.ok` is kept to narrow its type.
  if (fields.length > 0 || !drag.ok) return { ok: false, fields };
  const runwayFt = valueOf(derived.runwayFt);
  const values = {
    paFt: valueOf(derived.paFt),
    tempC: valueOf(derived.tempC),
    grossWeightLb: valueOf(derived.takeoffGwLb),
    cgPct: valueOf(derived.cgPct),
    dragIndex: { exact: drag.exact, conservative: drag.conservative },
    headwindKt: valueOf(derived.headwindKt),
    slopePct: valueOf(derived.slopePct),
    runwayFt,
    rcrDry: valueOf(derived.rcrDry),
    rcrWet: valueOf(derived.rcrWet),
  };
  return { ok: true, values, runwayFt };
}

const RCR_FIELD = { dry: 'rcrDry', wet: 'rcrWet' } as const;

function landingValues(derived: DerivedInputs, weight: Weight, surface: Surface): ColumnValues<LandingValues> {
  const fields = missingFields(derived, LANDING_FIELDS[weight][surface]);
  if (fields.length > 0) return { ok: false, fields };
  const values = {
    paFt: valueOf(derived.paFt),
    tempC: valueOf(derived.tempC),
    grossWeightLb: valueOf(weight === 'normal' ? derived.landingGwLb : derived.takeoffGwLb),
    headwindKt: valueOf(derived.headwindKt),
    slopePct: valueOf(derived.slopePct),
    rcr: valueOf(derived[RCR_FIELD[surface]]),
  };
  return { ok: true, values, runwayFt: valueOf(derived.runwayFt) };
}

function chainValuesOf(figures: FigureSet, inputs: Inputs, loadout: Loadout, derived: DerivedInputs): ChainValues {
  const additional = parseNumber(inputs.additionalDragIndex);
  const drag = dragIndex(buildCatalogue(figures), loadout, additional.ok ? additional.value : 0);
  const extra: UnparsedField[] = [];
  if (!additional.ok) extra.push('additionalDragIndex');
  if (!drag.ok) extra.push('loadout');
  const landing = (weight: Weight): Record<Surface, ColumnValues<LandingValues>> => ({
    dry: landingValues(derived, weight, 'dry'),
    wet: landingValues(derived, weight, 'wet'),
  });
  return {
    dragIndex: drag,
    takeoff: takeoffValues(derived, drag, extra),
    landing: { normal: landing('normal'), heavy: landing('heavy') },
  };
}

/** 3.18 on the input: one mark per RCR field below 10, on the value as typed. */
function rcrMarksOf(derived: DerivedInputs): RuleMark[] {
  const marks: RuleMark[] = [];
  for (const field of [RCR_FIELD.dry, RCR_FIELD.wet]) {
    const rcr = derived[field];
    if (rcr.ok && rcr.value < RCR_MIN) marks.push(mark('landing-rcr-10', 'exact', { field }));
  }
  return marks;
}

/** The chain values `computeTold` runs on, for the figure view's exact paths (`tracePaths`). */
export function chainValues(figures: FigureSet, inputs: Inputs, loadout: Loadout): ChainValues {
  return chainValuesOf(figures, inputs, loadout, deriveInputs(inputs));
}

export function computeTold(figures: FigureSet, inputs: Inputs, loadout: Loadout): Told {
  const derived = deriveInputs(inputs);
  const values = chainValuesOf(figures, inputs, loadout, derived);

  const takeoff = (mode: Mode): ToldColumn<TakeoffKey, TakeoffSide> => {
    const v = values.takeoff;
    if (!v.ok) return unparsedColumn(TAKEOFF_KINDS, v.fields);
    const evaluation = evaluate(takeoffChain(figures, v.values, mode), TAKEOFF_KINDS);
    return computedColumn(evaluation, TAKEOFF_KINDS, (k, cell) =>
      k === 'distance' ? takeoffMarks(mode, cell, v.runwayFt) : [],
    );
  };
  const landingColumn = (weight: Weight, surface: Surface): ToldColumn<LandingKey, LandingSide> => {
    const v = values.landing[weight][surface];
    if (!v.ok) return unparsedColumn(LANDING_KINDS, v.fields);
    const evaluation = evaluate(landingChain(figures, v.values, surface), LANDING_KINDS);
    return computedColumn(evaluation, LANDING_KINDS, (k, cell) =>
      k === 'distance' ? landingMarks(cell, v.runwayFt, v.values.rcr) : [],
    );
  };
  const landing = (weight: Weight): Record<Surface, ToldColumn<LandingKey, LandingSide>> => ({
    dry: landingColumn(weight, 'dry'),
    wet: landingColumn(weight, 'wet'),
  });
  return {
    dragIndex: values.dragIndex,
    takeoff: { mil: takeoff('mil'), ab: takeoff('ab') },
    landing: { normal: landing('normal'), heavy: landing('heavy') },
    rcrMarks: rcrMarksOf(derived),
  };
}
