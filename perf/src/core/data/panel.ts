import type { FigureFile, Panel } from './types.ts';

function isType<T extends Panel['type']>(p: Panel, type: T): p is Extract<Panel, { type: T }> {
  return p.type === type;
}

/**
 * The figure's panel `id`, of type `type`. A missing id, two panels with that id, or another type is
 * a data defect, not an input problem, and throws.
 */
export function panel<T extends Panel['type']>(fig: FigureFile, id: string, type: T): Extract<Panel, { type: T }> {
  const found = fig.panels.filter((p) => p.id === id);
  const only = found[0];
  if (only === undefined) throw new Error(`${fig.id} has no panel "${id}"`);
  if (found.length > 1) throw new Error(`${fig.id} has ${String(found.length)} panels "${id}"`);
  if (!isType(only, type)) throw new Error(`${fig.id} panel "${id}" is a ${only.type}, not a ${type}`);
  return only;
}
