/**
 * A column's OutOfChart reason as a line (TOLD 1.8 "Reason lines"): "B2-3: gross weight 52,000 lb outside the drawn
 * range 20,000–48,000 lb". The name is the data quantity's (`_` as a space, a few named below), its unit found on
 * the error figure's panels (then any figure's); values in 1000 lb or 1000 ft are shown in lb or ft. Wind and slope
 * get their side back from the signed inputs, since the core gives magnitudes. No DOM.
 */
import type { FigureSet } from '../core/data/figure-set.ts';
import type { FigureFile, Panel, Quantity } from '../core/data/types.ts';
import type { Reason } from '../core/told/column.ts';

import { figureLabel, formatThousands } from './format.ts';

/** The signed inputs: headwind positive (negative a tailwind), slope uphill positive. Null when not computed. */
export interface Signs {
  readonly headwindKt: number | null;
  readonly slopePct: number | null;
}

/** Quantities whose shown name is not the data name with `_` as a space. */
const NAMES: Readonly<Record<string, string>> = Object.freeze({
  cg: 'CG',
  rcr: 'RCR',
  tof_mil: 'MIL takeoff factor',
  tof_ab: 'MAX AB takeoff factor',
});

const WIND_NAMES: ReadonlySet<string> = new Set(['wind', 'headwind', 'tailwind']);

/** Chart units shown in a plain unit: the value times the factor. */
const SCALED: Readonly<Record<string, { factor: number; unit: string }>> = Object.freeze({
  '1000 lb': { factor: 1000, unit: 'lb' },
  '1000 ft': { factor: 1000, unit: 'ft' },
});

function quantitiesOf(p: Panel): Quantity[] {
  switch (p.type) {
    case 'curve_family':
      return [p.input, p.output, p.param];
    case 'single_curve':
    case 'guideline_panel':
    case 'limit_line':
      return [p.input, p.output];
    case 'scale_pair':
      return [p.from, p.to];
    case 'table':
      return p.columns;
  }
}

function unitOn(fig: FigureFile | undefined, name: string): string | undefined {
  if (fig === undefined) return undefined;
  for (const p of fig.panels) {
    const q = quantitiesOf(p).find((x) => x.name === name);
    if (q !== undefined) return q.unit;
  }
  return undefined;
}

/** The unit of `name`: on the error figure if it has it, else the first figure in the set that does; else none. */
function unitOf(figures: FigureSet, figureId: string, name: string): string {
  const own = unitOn(Object.hasOwn(figures, figureId) ? figures[figureId] : undefined, name);
  if (own !== undefined) return own;
  for (const fig of Object.values(figures)) {
    const unit = unitOn(fig, name);
    if (unit !== undefined) return unit;
  }
  return '';
}

function side(positive: string, negative: string, sign: number | null, fallback: string): string {
  if (sign === null || sign === 0) return fallback;
  return sign > 0 ? positive : negative;
}

function nameOf(input: string, signs: Signs): string {
  const plain = NAMES[input] ?? input.replaceAll('_', ' ');
  if (WIND_NAMES.has(input)) return side('headwind', 'tailwind', signs.headwindKt, plain);
  if (input === 'slope') return side('uphill slope', 'downhill slope', signs.slopePct, plain);
  return plain;
}

export function reasonText(reason: Reason, figures: FigureSet, signs: Signs): { figure: string; text: string } {
  const { error } = reason;
  const chartUnit = unitOf(figures, error.figure, error.input);
  const scaled = SCALED[chartUnit];
  const factor = scaled === undefined ? 1 : scaled.factor;
  const unit = scaled === undefined ? chartUnit : scaled.unit;
  const withUnit = (value: number): string => {
    const text = formatThousands(value * factor);
    return unit === '' ? text : `${text} ${unit}`;
  };

  const name = (reason.cell === 'conservative' ? 'conservative ' : '') + nameOf(error.input, signs);
  let text: string;
  if (Number.isNaN(error.value)) {
    text = `${name} not in the table`;
  } else if (error.drawnRange === null) {
    text = `${name} ${withUnit(error.value)} outside the drawn chart`;
  } else {
    const [low, high] = error.drawnRange;
    const range = `${formatThousands(low * factor)}–${withUnit(high)}`;
    text = `${name} ${withUnit(error.value)} outside the drawn range ${range}`;
  }
  return { figure: figureLabel(error.figure), text };
}
