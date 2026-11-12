/**
 * Which paths one figure view draws (TOLD 1.8 "The figure page"): the view's chains are rebuilt from the state with
 * the values `computeTold` uses (`chainValues`), run once exact (`tracePaths`), and their marks on the figure kept.
 * Takeoff draws MIL solid and MAX AB dashed (B2-5 is the MIL chart only, B2-6 the MAX AB one); landing draws one
 * weight, dry solid and wet dashed. Two paths with the same marks (B2-1, B2-2, B7-1 read the same for both) are drawn
 * once, solid, under both labels. No DOM.
 */
import type { FigureSet } from '../../core/data/figure-set.ts';
import type { PathMark } from '../../core/path/mark.ts';
import { tracePaths } from '../../core/path/trace.ts';
import type { OutOfChart, Read } from '../../core/result.ts';
import { landingChain } from '../../core/told/landing.ts';
import { takeoffChain } from '../../core/told/takeoff.ts';
import { chainValues } from '../../core/told/told.ts';
import type { Reason } from '../../core/told/told.ts';
import { formatThousands } from '../format.ts';
import type { AppState } from '../state/hash.ts';

export type View = 'takeoff' | 'normal' | 'heavy';

export interface ViewPath {
  readonly style: 'solid' | 'dashed';
  readonly label: string;
  /** The path's marks on the figure, every sheet, in chain order. */
  readonly marks: readonly PathMark[];
  /** The sheets on which the path left the chart: it ends at its last panel there, with no result at the axis. */
  readonly stoppedOn: readonly string[];
}

export interface FigureView {
  /** Figure file ids of the figure the paths cross, in chain order; the figure's first sheet when none. */
  readonly sheets: readonly string[];
  readonly paths: readonly ViewPath[];
  /** The exact reasons of the drawn columns' cells this figure gives, and of any that names it; each once. */
  readonly reasons: readonly Reason[];
  /** Grey lines under a sheet's key, by sheet id: a TOLD value read between two of the shown sheets. */
  readonly notes: readonly { readonly sheet: string; readonly text: string }[];
}

const TAKEOFF_FIGURES: ReadonlySet<string> = new Set(['B2-1', 'B2-2', 'B2-3', 'B2-4', 'B2-5', 'B2-6']);
const LANDING_FIGURES: ReadonlySet<string> = new Set(['B7-1', 'B7-2']);

/** The cells each figure gives; a reason of one of these is the figure's, whichever figure it names. */
const OUTPUTS: Readonly<Record<string, readonly string[]>> = {
  'B2-1': [],
  'B2-2': ['rotation', 'takeoffSpeed'],
  'B2-3': ['distance'],
  'B2-4': ['accelCheck'],
  'B2-5': ['refusalDry', 'refusalWet'],
  'B2-6': ['refusalDry', 'refusalWet'],
  'B7-1': ['finalApproach', 'touchdown'],
  'B7-2': ['distance'],
};

/** The figure a figure file belongs to: 'B2-5.sh3' → 'B2-5'. */
export const figureOf = (fileId: string): string => fileId.replace(/\.sh\d+$/, '');

/** A known figure and view from the hash's `fig` and `view`, or null. */
export function parseView(fig: string | null, view: string | null): { fig: string; view: View } | null {
  if (fig === null || view === null) return null;
  if (view === 'takeoff' && TAKEOFF_FIGURES.has(fig)) return { fig, view };
  if ((view === 'normal' || view === 'heavy') && LANDING_FIGURES.has(fig)) return { fig, view };
  return null;
}

/** One chain's exact run: its marks and its outputs. */
interface Traced {
  readonly label: string;
  readonly style: ViewPath['style'];
  readonly marks: readonly PathMark[];
  readonly outputs: Readonly<Record<string, Read<number>>>;
}

function traced(figures: FigureSet, state: AppState, fig: string, view: View): Traced[] {
  const values = chainValues(figures, state.inputs, state.loadout);
  const out: Traced[] = [];
  if (view === 'takeoff') {
    const v = values.takeoff;
    if (!v.ok) return out;
    const modes = fig === 'B2-5' ? (['mil'] as const) : fig === 'B2-6' ? (['ab'] as const) : (['mil', 'ab'] as const);
    for (const mode of modes) {
      const { run, marks } = tracePaths(takeoffChain(figures, v.values, mode));
      out.push({
        label: mode === 'mil' ? 'MIL' : 'MAX AB',
        style: mode === 'mil' ? 'solid' : 'dashed',
        marks,
        outputs: run.outputs,
      });
    }
    return out;
  }
  for (const surface of ['dry', 'wet'] as const) {
    const v = values.landing[view][surface];
    if (!v.ok) continue;
    const { run, marks } = tracePaths(landingChain(figures, v.values, surface));
    out.push({
      label: surface === 'dry' ? 'Dry' : 'Wet',
      style: surface === 'dry' ? 'solid' : 'dashed',
      marks,
      outputs: run.outputs,
    });
  }
  return out;
}

const errorsOf = (t: Traced): [string, OutOfChart][] =>
  Object.entries(t.outputs).flatMap(([key, read]) => (read.ok ? [] : [[key, read.error] as [string, OutOfChart]]));

function reasonKey(e: OutOfChart): string {
  const range = e.drawnRange === null ? 'null' : e.drawnRange.join(',');
  return [e.figure, e.input, String(e.value), range].join('|');
}

/** A label after "and": 'Wet' → 'wet', an abbreviation (MAX AB) unchanged. */
const andLabel = (label: string): string => (/^[A-Z ]+$/.test(label) ? label : label.toLowerCase());

/**
 * The refusal charts print dry RCR 16 on sheet 1 and 8 on sheet 3: a dry RCR between them is the linear value between
 * the two sheets' reads (Part 2), which the TOLD cell shows and neither sheet does. Said once, under the later sheet.
 */
function betweenSheets(
  figures: FigureSet,
  state: AppState,
  fig: string,
  view: View,
  sheets: readonly string[],
): FigureView['notes'] {
  if (view !== 'takeoff' || (fig !== 'B2-5' && fig !== 'B2-6')) return [];
  const low = `${fig}.sh3`;
  if (!sheets.includes(`${fig}.sh1`) || !sheets.includes(low)) return [];
  const v = chainValues(figures, state.inputs, state.loadout).takeoff;
  if (!v.ok || !(v.values.rcrDry > 8 && v.values.rcrDry < 16)) return [];
  const rcr = formatThousands(v.values.rcrDry);
  return [
    { sheet: low, text: `The TOLD value for RCR ${rcr} lies between these two sheets' values (interpolated, Part 2).` },
  ];
}

/** The figure's first sheet: the figure file itself, else its sheet 1. */
function firstSheet(figures: FigureSet, fig: string): string {
  return Object.hasOwn(figures, fig) ? fig : `${fig}.sh1`;
}

export function viewPaths(figures: FigureSet, state: AppState, fig: string, view: View): FigureView | null {
  if (parseView(fig, view) === null) return null;
  const runs = traced(figures, state, fig, view);
  const own = OUTPUTS[fig] ?? [];

  const paths: ViewPath[] = [];
  const reasons: Reason[] = [];
  const seen = new Set<string>();
  for (const t of runs) {
    const marks = t.marks.filter((m) => figureOf(m.figure) === fig);
    const errors = errorsOf(t);
    const stoppedOn = [...new Set(errors.map(([, e]) => e.figure).filter((id) => figureOf(id) === fig))];
    for (const [key, error] of errors) {
      if (!own.includes(key) && figureOf(error.figure) !== fig) continue;
      const k = reasonKey(error);
      if (seen.has(k)) continue;
      seen.add(k);
      reasons.push({ cell: 'exact', error });
    }
    const same = paths.find(
      (p) => JSON.stringify(p.marks) === JSON.stringify(marks) && p.stoppedOn.join() === stoppedOn.join(),
    );
    if (same !== undefined) {
      paths[paths.indexOf(same)] = { ...same, label: `${same.label} and ${andLabel(t.label)}` };
      continue;
    }
    paths.push({ style: t.style, label: t.label, marks, stoppedOn });
  }

  const sheets = [...new Set(paths.flatMap((p) => p.marks.map((m) => m.figure)))];
  const notes = betweenSheets(figures, state, fig, view, sheets);
  return { sheets: sheets.length > 0 ? sheets : [firstSheet(figures, fig)], paths, reasons, notes };
}
