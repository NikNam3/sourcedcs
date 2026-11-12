/**
 * The TOLD page's links to its subpages, each carrying the current state (TOLD 1.8): a figure view
 * `figure.html#<state>&fig=<figure without sheet>&view=<view>` and the Limitations page `limitations.html#<state>`.
 * Pure: no DOM.
 */
import { figureOf } from '../figure-ref.ts';
import type { View } from '../figure-ref.ts';
import { encodeState } from '../state/hash.ts';
import type { AppState } from '../state/hash.ts';

export function figureHref(state: AppState, figureId: string, view: View): string {
  return `figure.html#${encodeState(state)}&fig=${encodeURIComponent(figureOf(figureId))}&view=${view}`;
}

export function limitationsHref(state: AppState): string {
  return `limitations.html#${encodeState(state)}`;
}
