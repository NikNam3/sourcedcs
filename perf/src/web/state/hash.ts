/**
 * Inputs and loadout ↔ the URL hash (TOLD 1.8 "State"): `v=1&` then every Inputs field as typed under its short key,
 * empty ones too, then `lo`, through `URLSearchParams`. A decoded `v=1` hash takes a missing key's default and
 * ignores an unknown key; a `v` other than `1` is refused. `decodeState` never throws. No DOM.
 */
import { DEFAULT_LOADOUT } from '../../core/dragindex/loadout-row.ts';
import type { Loadout } from '../../core/dragindex/loadout-row.ts';
import { DEFAULT_INPUTS } from '../../core/inputs/inputs.ts';
import type { InputField, Inputs } from '../../core/inputs/inputs.ts';

import { decodeLoadout, encodeLoadout } from './loadout-code.ts';

export interface AppState {
  readonly inputs: Inputs;
  readonly loadout: Loadout;
}

export type Decoded =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'ok'; readonly state: AppState; readonly droppedRows: number };

const VERSION = '1';

/** The short keys, in hash order. */
const KEYS: readonly (readonly [string, InputField])[] = [
  ['tgw', 'takeoffGwLb'],
  ['lgw', 'landingGwLb'],
  ['cg', 'cgPct'],
  ['adi', 'additionalDragIndex'],
  ['rwy', 'runway'],
  ['hdg', 'headingDeg'],
  ['len', 'lengthFt'],
  ['ne', 'nearElevFt'],
  ['fe', 'farElevFt'],
  ['alt', 'altimeterInHg'],
  ['t', 'tempC'],
  ['w', 'wind'],
  ['rd', 'rcrDry'],
  ['rw', 'rcrWet'],
];

/** Without '#', starting 'v=1&'. */
export function encodeState(s: AppState): string {
  const params = new URLSearchParams();
  params.set('v', VERSION);
  for (const [key, field] of KEYS) params.set(key, s.inputs[field]);
  params.set('lo', encodeLoadout(s.loadout));
  return params.toString();
}

/** With or without '#'. Never throws. */
export function decodeState(text: string): Decoded {
  try {
    const params = new URLSearchParams(text.startsWith('#') ? text.slice(1) : text);
    const v = params.get('v');
    if (v === null) return { kind: 'none' };
    if (v !== VERSION) return { kind: 'refused' };
    const inputs: Inputs = { ...DEFAULT_INPUTS };
    for (const [key, field] of KEYS) {
      const value = params.get(key);
      if (value !== null) inputs[field] = value;
    }
    const lo = params.get('lo');
    if (lo === null) return { kind: 'ok', state: { inputs, loadout: DEFAULT_LOADOUT }, droppedRows: 0 };
    const { loadout, droppedRows } = decodeLoadout(lo);
    return { kind: 'ok', state: { inputs, loadout }, droppedRows };
  } catch {
    // URLSearchParams does not throw on a string today; a link is never allowed to break the page.
    return { kind: 'none' };
  }
}
