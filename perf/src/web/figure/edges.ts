/**
 * Where a path starts and ends on a figure page (TOLD 1.8): the edge each axis is printed on, from the frames table.
 * Coordinates are PDF points. No DOM.
 */
import type { FigureFile } from '../../core/data/types.ts';

import { FRAMES } from './frames.ts';
import type { Edge, Frame } from './frames.ts';

/** A page point, PDF points. */
export type Pt = [number, number];

/** The page coordinate of the axis edge `name` is printed on: the outermost frame on that side of its panels. */
function edgeOf(fig: FigureFile, name: string): { edge: Edge; at: number } | null {
  const frames = Object.hasOwn(FRAMES, fig.id) ? FRAMES[fig.id] : undefined;
  if (frames === undefined || !Object.hasOwn(frames.edges, name)) return null;
  const edge = frames.edges[name];
  if (edge === undefined) return null;
  const values: number[] = [];
  for (const p of fig.panels) {
    if (p.type === 'table' || p.type === 'scale_pair' || !Object.hasOwn(p.axes, name)) continue;
    const frame = Object.hasOwn(frames.panels, p.id) ? frames.panels[p.id] : undefined;
    if (frame === undefined) continue;
    values.push(
      edge === 'left' ? frame.x[0] : edge === 'right' ? frame.x[1] : edge === 'top' ? frame.y[0] : frame.y[1],
    );
  }
  if (values.length === 0) return null;
  return { edge, at: edge === 'left' || edge === 'top' ? Math.min(...values) : Math.max(...values) };
}

/** `point` moved along its other page axis to the edge of `name`, or null when that edge does not run across it. */
export function toEdge(fig: FigureFile, name: string, point: Pt, along: 'x' | 'y'): Pt | null {
  const edge = edgeOf(fig, name);
  if (edge === null) return null;
  const edgeAxis = edge.edge === 'left' || edge.edge === 'right' ? 'x' : 'y';
  if (edgeAxis !== along) return null;
  return along === 'x' ? [edge.at, point[1]] : [point[0], edge.at];
}

/** A panel's frame; a panel the table does not hold is a defect and throws. */
export function frameOf(fig: FigureFile, panelId: string): Frame {
  const frame = FRAMES[fig.id]?.panels[panelId];
  if (frame === undefined) throw new Error(`${fig.id} panel "${panelId}" has no frame`);
  return frame;
}
