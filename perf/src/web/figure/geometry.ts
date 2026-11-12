/**
 * Path marks → polylines in page-image pixels (TOLD 1.8 "Path geometry"). Each mark is placed with its panel's own
 * axis transforms (`page = a * value + b`, PDF points), then shifted by the image's `clipPt` and scaled by `pxPerPt`.
 * Consecutive marks that carry one value from panel to panel (the previous mark's output is the next one's input) join
 * into one run; a run starts at the input axis's edge and, unless the path stopped there, ends at the output axis's
 * edge (`frames.ts`). A guideline mark follows its bracketing lines from (baseline, entry) to (target, exit), sampled
 * the way `guidelinePanel` interpolates them. Each run also gives its stations: where a value is read, for the
 * circled letters. No DOM.
 */
import type { FigureFile, Panel, Quantity, Transform } from '../../core/data/types.ts';
import type { PathMark } from '../../core/path/mark.ts';
import { guidelinePanel } from '../../core/read/guideline-panel.ts';

import { frameOf, toEdge } from './edges.ts';
import type { Pt } from './edges.ts';

export type Px = readonly [number, number];

/** A place on the path where a value is read: the input at the axis, a curve's parameter, a result at the axis. */
export interface Station {
  readonly at: Px;
  readonly quantity: Quantity;
  readonly value: number;
  /** The guideline family (headwind, uphill, …) for a guideline panel's target; null otherwise. */
  readonly family: string | null;
  readonly panel: string;
  readonly role: 'entry' | 'param' | 'exit';
}

export interface Run {
  readonly points: readonly Px[];
  readonly stations: readonly Station[];
}

/** Guideline paths are sampled at this many points from the baseline to the target, both included. */
export const GUIDELINE_SAMPLES = 20;

type ChartPanel = Exclude<Panel, { type: 'table' }>;

function panelOf(fig: FigureFile, id: string): ChartPanel {
  const p = fig.panels.find((q) => q.id === id);
  if (p === undefined || p.type === 'table') throw new Error(`${fig.id} has no chart panel "${id}"`);
  return p;
}

function transformOf(p: ChartPanel, name: string): Transform {
  const t = Object.hasOwn(p.axes, name) ? p.axes[name] : undefined;
  if (t === undefined) throw new Error(`panel "${p.id}" has no axis "${name}"`);
  return t;
}

const pageOf = (t: Transform, value: number): number => t.a * value + t.b;

function pxOf(fig: FigureFile, [x, y]: Pt): Px {
  const [left, top] = fig.image.clipPt;
  return [(x - left) * fig.image.pxPerPt, (y - top) * fig.image.pxPerPt];
}

/** The page point of a panel's values: each quantity sets the page coordinate its transform names. */
function place(p: ChartPanel, values: readonly (readonly [string, number])[]): Pt {
  const at: Pt = [Number.NaN, Number.NaN];
  for (const [name, value] of values) {
    const t = transformOf(p, name);
    at[t.page === 'x' ? 0 : 1] = pageOf(t, value);
  }
  return at;
}

/**
 * The pixel of `x` and `y` on a panel with one quantity on each page axis (`x` the value of the quantity its
 * transforms put on the page's x).
 */
export function toPx(fig: FigureFile, panelId: string, x: number, y: number): Px {
  const transforms = Object.values(panelOf(fig, panelId).axes);
  const tx = transforms.filter((t) => t.page === 'x');
  const ty = transforms.filter((t) => t.page === 'y');
  const [onX] = tx;
  const [onY] = ty;
  if (onX === undefined || onY === undefined || tx.length > 1 || ty.length > 1) {
    throw new Error(`${fig.id} panel "${panelId}" has not one quantity per page axis`);
  }
  return pxOf(fig, [pageOf(onX, x), pageOf(onY, y)]);
}

type Kind = PathMark['kind'];
type MarkOf<K extends Kind> = Extract<PathMark, { kind: K }>;
type PanelOf<K extends Kind> = Extract<ChartPanel, { type: K }>;

/** A mark with its panel, of the same kind. */
type Paired = { [K in Kind]: { readonly kind: K; readonly p: PanelOf<K>; readonly m: MarkOf<K> } }[Kind];

function paired(fig: FigureFile, m: PathMark): Paired {
  const p = panelOf(fig, m.panel);
  if (m.kind === 'curve_family' && p.type === 'curve_family') return { kind: m.kind, p, m };
  if (m.kind === 'single_curve' && p.type === 'single_curve') return { kind: m.kind, p, m };
  if (m.kind === 'scale_pair' && p.type === 'scale_pair') return { kind: m.kind, p, m };
  if (m.kind === 'guideline_panel' && p.type === 'guideline_panel') return { kind: m.kind, p, m };
  throw new Error(`${fig.id} panel "${m.panel}" is a ${p.type}, its mark a ${m.kind}`);
}

/** Where the path enters a mark's panel: the quantity and its value. */
function entryOf(x: Paired): { q: Quantity; value: number } {
  switch (x.kind) {
    case 'curve_family':
    case 'single_curve':
      return { q: x.p.input, value: x.m.input };
    case 'scale_pair':
      return { q: x.p.from, value: x.m.from };
    case 'guideline_panel':
      return { q: x.p.output, value: x.m.entry };
  }
}

/** Where the path leaves a mark's panel. */
function exitOf(x: Paired): { q: Quantity; value: number } {
  switch (x.kind) {
    case 'curve_family':
    case 'single_curve':
      return { q: x.p.output, value: x.m.output };
    case 'scale_pair':
      return { q: x.p.to, value: x.m.to };
    case 'guideline_panel':
      return { q: x.p.output, value: x.m.exit };
  }
}

/** Equal up to float noise: a carried value can come back as x * 1000 / 1000. */
export const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

interface Placed {
  readonly points: Pt[];
  readonly stations: (Omit<Station, 'at'> & { at: Pt })[];
}

const station = (
  at: Pt,
  quantity: Quantity,
  value: number,
  panel: string,
  role: Station['role'],
  family: string | null = null,
): Placed['stations'][number] => ({ at, quantity, value, family, panel, role });

/** The points and stations of one mark inside its panel. */
function placeMark(fig: FigureFile, x: Paired): Placed {
  switch (x.kind) {
    case 'curve_family': {
      const { p, m } = x;
      const at = place(p, [
        [p.input.name, m.input],
        [p.output.name, m.output],
      ]);
      return { points: [at], stations: [station(at, p.param, m.param, p.id, 'param')] };
    }
    case 'single_curve': {
      const { p, m } = x;
      const at = place(p, [
        [p.input.name, m.input],
        [p.output.name, m.output],
      ]);
      return { points: [at], stations: [] };
    }
    case 'scale_pair': {
      // Two scales printed one beyond the other across the frame: `from` on its near side, `to` on its far side.
      const { p, m } = x;
      const tFrom = transformOf(p, p.from.name);
      const tTo = transformOf(p, p.to.name);
      const frame = frameOf(fig, p.id);
      const across = tFrom.page === 'x' ? frame.y : frame.x;
      const at = (t: Transform, value: number, other: number): Pt =>
        t.page === 'x' ? [pageOf(t, value), other] : [other, pageOf(t, value)];
      const from = at(tFrom, m.from, across[0]);
      const to = at(tTo, m.to, across[1]);
      return {
        points: [from, to],
        stations: [station(from, p.from, m.from, p.id, 'param'), station(to, p.to, m.to, p.id, 'exit')],
      };
    }
    case 'guideline_panel': {
      const { p, m } = x;
      const points: Pt[] = [];
      const last = GUIDELINE_SAMPLES - 1;
      for (let i = 0; i <= last; i++) {
        const t = m.baseline + ((m.target - m.baseline) * i) / last;
        let out: number | null = i === 0 ? m.entry : i === last ? m.exit : null;
        if (out === null) {
          const read = guidelinePanel(p, fig.id, m.family, m.entry, t);
          out = read.ok ? read.value : null;
        }
        if (out !== null) {
          points.push(
            place(p, [
              [p.input.name, t],
              [p.output.name, out],
            ]),
          );
        }
      }
      const end = points[points.length - 1] ?? place(p, [[p.output.name, m.exit]]);
      return { points, stations: [station(end, p.input, m.target, p.id, 'param', m.family)] };
    }
  }
}

const pageAxisOf = (p: ChartPanel, q: Quantity): 'x' | 'y' => transformOf(p, q.name).page;

/**
 * The runs of `marks` (all on `fig`, in chain order). With `stopped`, the last run ends at its last panel: the path
 * left the chart after it and draws no result at the axis.
 */
export function markRuns(fig: FigureFile, marks: readonly PathMark[], stopped = false): Run[] {
  const runs: Placed[] = [];
  let current: Placed | null = null;
  let previous: Paired | null = null;

  const close = (run: Placed, prev: Paired): void => {
    if (prev.kind === 'scale_pair') return;
    const { q, value } = exitOf(prev);
    const lastPoint = run.points[run.points.length - 1];
    if (lastPoint === undefined || transformOf(prev.p, q.name).unscaled === true) return;
    const along = pageAxisOf(prev.p, q) === 'x' ? 'y' : 'x';
    const end = toEdge(fig, q.name, lastPoint, along);
    if (end === null) return;
    run.points.push(end);
    run.stations.push(station(end, q, value, prev.p.id, 'exit'));
  };

  for (const m of marks) {
    if (m.figure !== fig.id) throw new Error(`a mark of ${m.figure} placed on ${fig.id}`);
    const x = paired(fig, m);
    const placed = placeMark(fig, x);
    const entry = entryOf(x);
    const before = previous === null ? null : exitOf(previous);
    if (current === null || previous === null || before?.q.name !== entry.q.name || !near(before.value, entry.value)) {
      if (current !== null && previous !== null) close(current, previous);
      current = { points: [], stations: [] };
      runs.push(current);
      const first = placed.points[0];
      const scaled = transformOf(x.p, entry.q.name).unscaled !== true;
      if ((x.kind === 'curve_family' || x.kind === 'single_curve') && first !== undefined && scaled) {
        const start = toEdge(fig, entry.q.name, first, pageAxisOf(x.p, x.p.output)) ?? first;
        current.points.push(start);
        current.stations.push(station(start, entry.q, entry.value, x.p.id, 'entry'));
      }
    }
    current.points.push(...placed.points);
    current.stations.push(...placed.stations);
    previous = x;
  }
  if (current !== null && previous !== null && !stopped) close(current, previous);

  return runs.map((run) => ({
    points: dedupe(run.points.map((pt) => pxOf(fig, pt))),
    stations: run.stations.map((s) => ({ ...s, at: pxOf(fig, s.at) })),
  }));
}

/** Drops a point equal to the one before it (a guideline panel at its baseline is one point). */
function dedupe(points: readonly Px[]): Px[] {
  const out: Px[] = [];
  for (const pt of points) {
    const last = out[out.length - 1];
    if (last === undefined || !near(last[0], pt[0]) || !near(last[1], pt[1])) out.push(pt);
  }
  return out;
}

/** One polyline per connected run of `marks`, in page-image pixels. */
export function markPolyline(fig: FigureFile, marks: readonly PathMark[], stopped = false): Px[][] {
  return markRuns(fig, marks, stopped).map((run) => [...run.points]);
}
