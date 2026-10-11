'use strict';

// What the panels need from the dock without importing it (DESK-SPLIT; dock.js imports every panel's init, so a panel that
// imported dock.js made a cycle): the panel titles, the dockview instance, and the dock's actions, which dock.js registers
// at load. A leaf: it imports nothing.

// Single source of truth for every panel's user-facing name. Every spot
// that displays a panel's name — its dockview tab title, its row label in
// the radars-panel's Panels section (panels/radar-panel.js's panelControlRows()), the
// topbar RADARS/PANELS button's own text — reads from here, so renaming a
// panel means changing exactly one string instead of hunting through both
// files and the static HTML and hoping none of the copies drift apart (this
// exact drift is what prompted consolidating it: the topbar button's label
// used to be hardcoded in index.html separately from the panel's own title
// here in dock.js). `map` has no entry — it uses dockview's own default
// (the tab shows its id) via createNoCloseTab, and nothing has asked for
// that to change.
export const PANEL_TITLES = {
  track:    'TRACK INFO',
  radars:   'PANELS',
  settings: 'SETTINGS',
  airport:  'AIRPORT',
  radio:    'RADIO',
  efsp:     'FLIGHT STRIPS',
  airspace: 'AIRSPACE',
  runwayStatus: 'RUNWAY STATUS',
  carrier:  'CARRIER',
  marshal:  'MARSHAL',
  carrierMap: 'CARRIER MAP',
  par:      'PAR',
  metrics:  'METRICS',
};

export let dock = null;
export function setDock(d) { dock = d; }

let _actions = null;
export function registerDockActions(actions) { _actions = actions; }
function act(name) {
  if (!_actions) throw new Error(`dock action ${name} called before dock.js loaded`);
  return _actions[name];
}

export function ensureTrackPanel(...args) { return act('ensureTrackPanel')(...args); }
export function isDockPanelOpen(...args) { return act('isDockPanelOpen')(...args); }
export function toggleDockPanel(...args) { return act('toggleDockPanel')(...args); }
export function isPanelPinned(...args) { return act('isPanelPinned')(...args); }
export function setPanelPinned(...args) { return act('setPanelPinned')(...args); }
