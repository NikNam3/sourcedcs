'use strict';

// The panel's shared state, split out of efsp-panel.js (ESM-2b). A module cannot assign another module's `let`,
// so what more than one feature module writes lives here, assigned through the setters (live exports for
// everyone who reads it).

export let _activePositionTab = null;
export let _activeBayId = null;
// ESM-1: scramble.js assigns both; an imported binding is read-only.
export function _setActivePositionTab(v) { _activePositionTab = v; }
export function _setActiveBayId(v) { _activeBayId = v; }

// Cached once in initEfspPanel() — see the module comment above for why
// this can't be a fresh document.getElementById() per render.
export let _positionTabsEl = null;
export let _bayTabsEl = null;
export let _bayContentEl = null;
export let _createStripInputEl = null;
export let _createStripBtnEl = null;
export let _createStripMsgEl = null;
export let _createStripTypeEl = null;
export let _createStripStereoEl = null;
export let _createStripBindEl = null;
export let _dotCommandInputEl = null;
export let _dotCommandPreviewEl = null;
export let _mutationErrorEl = null;
export let _mutationWarningEl = null;
export let _undoSlotEl = null;
export let _undoVoidedEl = null;
export let _controlAttestEl = null;
export let _connectionBannerEl = null;
export let _combinationEl = null; // crc-sync docs/adr/0105
export let _efspPanelRootEl = null; // cached, not document.getElementById() per check — same detached-DOM reasoning as every other element above

export function _setBayContentElForTest(el) { _bayContentEl = el; }

/** initEfspPanel()'s element lookups, here because only this module can assign these bindings. */
export function _cachePanelElements() {
  _efspPanelRootEl = document.getElementById('efsp-panel');
  _positionTabsEl = document.getElementById('efsp-position-tabs');
  _bayTabsEl = document.getElementById('efsp-bay-tabs');
  _bayContentEl = document.getElementById('efsp-bay-content');
  _createStripInputEl = document.getElementById('efsp-new-strip-callsign');
  _createStripBtnEl = document.getElementById('efsp-create-strip-btn');
  _createStripMsgEl = document.getElementById('efsp-create-strip-msg');
  _createStripTypeEl = document.getElementById('efsp-create-strip-type');
  _createStripStereoEl = document.getElementById('efsp-create-strip-stereo');
  _createStripBindEl = document.getElementById('efsp-create-strip-bind');
  _dotCommandInputEl = document.getElementById('efsp-dot-command-input');
  _dotCommandPreviewEl = document.getElementById('efsp-dot-command-preview');
  _mutationErrorEl = document.getElementById('efsp-mutation-error');
  _mutationWarningEl = document.getElementById('efsp-mutation-warning');
  _undoSlotEl = document.getElementById('efsp-undo-slot');
  _undoVoidedEl = document.getElementById('efsp-undo-voided');
  _controlAttestEl = document.getElementById('efsp-control-attest');
  _connectionBannerEl = document.getElementById('efsp-connection-banner');
  _combinationEl = document.getElementById('efsp-combination');
}

export function _isEfspPanelShowing() {
  if (!_bayContentEl) return false;
  if (_bayContentEl.isConnected === false) return false;
  return _bayContentEl.offsetParent !== null;
}

/** The Bay the controller is looking at right now, or null when the panel is hidden. */
export function efspVisibleBayId() {
  return _activeBayId && _isEfspPanelShowing() ? _activeBayId : null;
}

// The active Bay search's text (null when none is active). Here, not in tabs.js, so bay-view.js reads it without importing the tabs.
export let _searchQuery = null;
export function _setSearchQuery(v) { _searchQuery = v; }
export function getActiveEfspSearchQuery() { return _searchQuery; }
