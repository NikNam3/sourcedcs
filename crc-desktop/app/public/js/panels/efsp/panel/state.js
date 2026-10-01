'use strict';

// The panel's shared state, split out of efsp-panel.js (ESM-2b). A module cannot assign another module's `let`,
// so what more than one feature module writes lives here: the live exports below (assigned through their
// setters), the cached elements, and the create-Strip latches. Cached ONCE in initEfspPanel() — see the
// module comment in efsp-panel.js for why this can't be a fresh document.getElementById() per render.

export let _activePositionTab = null;
export let _activeBayId = null;
// ESM-1: scramble.js assigns both; an imported binding is read-only.
export function _setActivePositionTab(v) { _activePositionTab = v; }
export function _setActiveBayId(v) { _activeBayId = v; }

export const els = {
  positionTabs: null,
  bayTabs: null,
  bayContent: null,
  createStripInput: null,
  createStripBtn: null,
  createStripMsg: null,
  createStripRole: null,
  createStripStereo: null,
  createStripBind: null,
  dotCommandInput: null,
  dotCommandPreview: null,
  mutationError: null,
  mutationWarning: null,
  connectionBanner: null,
  efspPanelRoot: null, // cached, not document.getElementById() per check — same detached-DOM reasoning as every other element
};

// The create-Strip box, the toolbar's pickers and the dot commands share these.
export const createState = {
  pendingMutationId: null,
  // Callsign the duplicate-origination warning has already been shown for, so
  // a second press goes through. Cleared on any successful create.
  pendingDuplicateCallsign: null,
  stereoRoutes: [],
};

export function _setBayContentElForTest(el) { els.bayContent = el; }
