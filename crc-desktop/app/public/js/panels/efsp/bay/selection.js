'use strict';
import { noteEfspStripSelected } from '../efsp-metrics-client.js';
import { getEfspStrip } from '../efsp-state.js';
import { markEfspChanged } from '../efsp-change-bus.js';
import { _stripElById } from './open-bays.js';

// Click-to-select state for the non-drag move path (DESK-SPLIT, split out of bay-view.js). Selecting marks the 'selection'
// topic: the three highlights (MARSA, ATO join, correlated contact) re-resolve first (ORDER.RESOLVE), then the Bays redraw
// (efsp-change-bus.js), so this module imports no renderer and no highlight.
export let _selectedStripId = null;

export function getSelectedEfspStripId() { return _selectedStripId; }

/** Drops the selection without a redraw: the caller (a move to a Rack) is about to cause one. */
export function _clearSelectedStrip() { _selectedStripId = null; }

export function _setSelectedStripIdForTest(id) { _selectedStripId = id; }
export function _setSelectEfspStripByIdForTest(fn) { selectEfspStripById = fn; }

export function _selectStrip(stripId) {
  _selectedStripId = _selectedStripId === stripId ? null : stripId;
  noteEfspStripSelected(_selectedStripId); // docs/adr/0072
  _afterSelectionChanged();
}

/**
 * Selects a Strip without the toggle. Called when a click on the MAP resolves
 * to this Strip (correlation-highlight.js's selectStripForTrack) — clicking a
 * contact twice must not deselect its Strip, which is what _selectStrip's
 * toggle would do.
 */
export function selectEfspStripById(stripId) {
  if (!getEfspStrip(stripId)) return false;
  _selectedStripId = stripId;
  noteEfspStripSelected(_selectedStripId); // docs/adr/0072
  _afterSelectionChanged();
  const el = _stripElById(stripId);
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest' });
  }
  return true;
}

function _afterSelectionChanged() {
  // §9.2 rule 5 — "selecting one participant MUST highlight the others." The highlights (MARSA, ATO join, the ringed contact)
  // subscribe to 'selection' at ORDER.RESOLVE, so they resolve BEFORE the Bays redraw: the highlight is a class each Strip
  // element reads while it is being built, and the other way round leaves it one selection behind.
  markEfspChanged('selection');
}
