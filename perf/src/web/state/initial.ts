/**
 * The load order (TOLD 1.8 "State"): the hash, then storage, then `DEFAULT_INPUTS` and `DEFAULT_LOADOUT`. A refused
 * hash and dropped loadout rows give the page's grey notes; a bad stored string is ignored silently. No DOM.
 */
import { DEFAULT_LOADOUT } from '../../core/dragindex/loadout-row.ts';
import { DEFAULT_INPUTS } from '../../core/inputs/inputs.ts';

import { decodeState } from './hash.ts';
import type { AppState } from './hash.ts';

export interface Initial {
  readonly state: AppState;
  readonly notes: readonly string[];
}

export const REFUSED_NOTE = 'This link is from another version of the calculator and was not loaded.';
export const DROPPED_ROWS_NOTE = 'Part of the loadout in this link could not be read.';

function storedOrDefault(stored: string | null): AppState {
  const d = stored === null ? null : decodeState(stored);
  if (d?.kind === 'ok') return d.state;
  return { inputs: { ...DEFAULT_INPUTS }, loadout: DEFAULT_LOADOUT };
}

export function initialState(hash: string, stored: string | null): Initial {
  const fromHash = decodeState(hash);
  switch (fromHash.kind) {
    case 'ok':
      return { state: fromHash.state, notes: fromHash.droppedRows > 0 ? [DROPPED_ROWS_NOTE] : [] };
    case 'refused':
      return { state: storedOrDefault(stored), notes: [REFUSED_NOTE] };
    case 'none':
      return { state: storedOrDefault(stored), notes: [] };
  }
}
