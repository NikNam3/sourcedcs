/**
 * The circled letters of one sheet and their key (TOLD 1.8 "The figure page"): every station of a path (the input at
 * its axis, each panel's parameter, the result at its axis) gets the next letter Ⓐ, Ⓑ, … in chain order. Paths on
 * one sheet read the same panels in the same order, so a letter names one quantity for every path; it is drawn once,
 * where the first path that has it reads it, and the key lists its value per path. No DOM.
 */
import type { Quantity } from '../../core/data/types.ts';

import { DASH, formatThousands } from '../format.ts';

import type { Px, Run, Station } from './geometry.ts';
import { figureOf } from './views.ts';

export interface Letter {
  /** 'A', 'B', … */
  readonly letter: string;
  readonly at: Px;
}

export interface KeyRow {
  /** Ⓐ, Ⓑ, … */
  readonly circled: string;
  readonly label: string;
  /** The figure the value comes from, when another figure gives it (Ⓐ takeoff factor from B2-1). */
  readonly from: string | null;
  /** One per path, in path order; "—" where that path does not read it. */
  readonly values: readonly string[];
  /** The path's result at the axis. */
  readonly result: boolean;
}

/** Quantities named otherwise than the data name with `_` as a space. */
const NAMES: Readonly<Record<string, string>> = {
  cg: 'CG',
  rcr: 'RCR',
  tof_mil: 'MIL takeoff factor',
  tof_ab: 'MAX AB takeoff factor',
  distance: 'Takeoff distance',
  accel_check_speed: 'Acceleration check speed',
  uncorrected_roll: 'Uncorrected ground roll',
};

/** B7-1 draws both speeds against one airspeed axis: the panel names the speed. */
const PANEL_NAMES: Readonly<Record<string, string>> = {
  final_approach: 'Final approach speed',
  touchdown: 'Touchdown speed',
};

/** Values another figure gives: the figure page links to it. */
const FROM: Readonly<Record<string, string>> = { takeoff_factor: 'B2-1', check_distance: 'B2-3' };

const SCALED: Readonly<Record<string, { factor: number; unit: string }>> = {
  '1000 lb': { factor: 1000, unit: 'lb' },
  '1000 ft': { factor: 1000, unit: 'ft' },
};

/** Decimals per shown unit; a unit not listed shows as many as needed up to two. */
const DECIMALS: Readonly<Record<string, number>> = { KIAS: 1, ft: 0, lb: 0, kt: 1, '%': 1, '% MAC': 1 };
/** Takeoff factors with two decimals, as the manual's examples print them. */
const FACTORS: ReadonlySet<string> = new Set(['takeoff_factor', 'tof_mil', 'tof_ab']);

const circled = (i: number): string => String.fromCodePoint(0x24b6 + i);
const plainLetter = (i: number): string => String.fromCodePoint(0x41 + i);

function shownUnit(q: Quantity): { factor: number; unit: string } {
  return SCALED[q.unit] ?? { factor: 1, unit: q.unit };
}

function nameOf(s: Station): string {
  if (s.quantity.name === 'airspeed') return PANEL_NAMES[s.panel] ?? 'Airspeed';
  if (s.quantity.name === 'wind' && s.family !== null) return s.family === 'tailwind' ? 'Tailwind' : 'Headwind';
  const plain = NAMES[s.quantity.name] ?? s.quantity.name.replaceAll('_', ' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** "Gross weight, lb"; "Takeoff factor". */
export function labelOf(s: Station): string {
  const { unit } = shownUnit(s.quantity);
  return unit === '' ? nameOf(s) : `${nameOf(s)}, ${unit}`;
}

/** The value in its shown unit: "33,000", "3.16", "1.0 up". */
export function valueText(s: Station): string {
  const { factor, unit } = shownUnit(s.quantity);
  const decimals = FACTORS.has(s.quantity.name) ? 2 : DECIMALS[unit];
  const text = formatThousands(s.value * factor, decimals);
  if (s.family === 'uphill') return `${text} up`;
  if (s.family === 'downhill') return `${text} down`;
  return text;
}

/** The stations of a path on one sheet, every run in order. */
const stationsOf = (runs: readonly Run[]): Station[] => runs.flatMap((run) => [...run.stations]);

/** The letters and key of one sheet; `paths` holds each path's runs on it, in path order. */
export function sheetLetters(
  figure: string,
  paths: readonly (readonly Run[])[],
): { letters: Letter[]; rows: KeyRow[] } {
  const stations = paths.map(stationsOf);
  const count = Math.max(0, ...stations.map((s) => s.length));
  const letters: Letter[] = [];
  const rows: KeyRow[] = [];
  for (let i = 0; i < count; i++) {
    const first = stations.map((s) => s[i]).find((s) => s !== undefined);
    if (first === undefined) continue;
    const from = FROM[first.quantity.name];
    letters.push({ letter: plainLetter(i), at: first.at });
    rows.push({
      circled: circled(i),
      label: labelOf(first),
      from: from !== undefined && figureOf(figure) !== from ? from : null,
      values: stations.map((s) => {
        const at = s[i];
        return at === undefined ? DASH : valueText(at);
      }),
      result: first.role === 'exit',
    });
  }
  return { letters, rows };
}
