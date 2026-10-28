'use strict';


// The airspace panel's live state (DESK-SPLIT, split out of airspace-panel.js): the open inline views, the open menu and Delay form, the typed drafts and the filter.

// Inline views (the editor, History, Delete) by airspace id; a new airspace's editor lives under NEW_KEY. One view per card.
export const NEW_KEY = '\u0000new';

export const _views = new Map();

export let _menuFor = null;      // the airspace whose ⋯ menu is open

export let _delayFor = null;     // the airspace whose Delay note form is open

export let _denyFor = null;      // the airspace whose Deny reason form is open (Electron has no window.prompt)

export function _setMenuFor(id) { _menuFor = id; }

export function _setDelayFor(id) { _delayFor = id; }

export function _setDenyFor(id) { _denyFor = id; }

// In-progress text of the card forms. Every update of any airspace rebuilds every card, so what a controller has
// typed lives here, keyed by a stable name, and is put back into the new input (B9, docs/wip/ARCH-C.md §3.1).
export const _drafts = new Map();        // draft key -> typed text

export const _draftInputs = new Map();   // draft key -> the input currently in the DOM (rebuilt each render)

const FILTER_KEY = 'crc.airspace.filter';

export let _filter = _loadFilter(); // 'mine' | 'all'

function _loadFilter() {
  try { return localStorage.getItem(FILTER_KEY) === 'all' ? 'all' : 'mine'; } catch (_) { return 'mine'; }
}

export function _saveFilter(value) {
  _filter = value;
  try { localStorage.setItem(FILTER_KEY, value); } catch (_) { /* a per-viewer convenience only */ }
}
