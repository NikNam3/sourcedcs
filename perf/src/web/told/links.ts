/**
 * The TOLD page's links to its subpages, each carrying the current state (TOLD 1.8): a figure view
 * `figure.html#<state>&fig=<figure without sheet>&view=<view>` and the Limitations page `limitations.html#<state>`.
 * Pure: no DOM.
 */
import { encodeState } from '../state/hash.ts';
import type { AppState } from '../state/hash.ts';

/** takeoff: MIL and MAX AB together; normal, heavy: a landing weight, dry and wet together. */
export type FigureView = 'takeoff' | 'normal' | 'heavy';

/** A figure file id without its sheet: 'B2-6.sh2' → 'B2-6'. */
export const figureOf = (figureId: string): string => figureId.replace(/\.sh\d+$/, '');

export function figureHref(state: AppState, figureId: string, view: FigureView): string {
  return `figure.html#${encodeState(state)}&fig=${encodeURIComponent(figureOf(figureId))}&view=${view}`;
}

export function limitationsHref(state: AppState): string {
  return `limitations.html#${encodeState(state)}`;
}
