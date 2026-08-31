'use strict';

// ── Dockview bootstrap ────────────────────────────────────────────────────
// Owns the dockview grid that replaces individually hand-positioned
// `position:fixed` panels and their individual topbar/floating toggle
// buttons. Map is the one permanently-present panel (see REQUIRED_PANELS —
// it has no reopen affordance of any kind). Track Info, Radars (the
// radars-panel's internal id — see PANEL_TITLES for its current "PANELS"
// label), Settings, Airport, Squawk C/S, and Radio are all closable: Track
// Info reopens by clicking a track on the map (ensureTrackPanel), the
// Panels control via its own topbar button (wireRadarsPanelButton/
// toggleOrFocusPanel), and Settings/Airport/Squawk C/S/Radio via that
// control's own Panels section (wired in ui.js's initRadarPanel()) — which
// is why their old dedicated topbar/floating buttons (#btn-settings,
// #btn-calls, #btn-aprt) were removed rather than rewired, and the
// connection-settings ("SYNC") button moved into the Settings panel's
// Tools tab instead of floating above Radio's old fixed position.
//
// The UMD bundle's global is the literal (hyphenated) string "dockview-core",
// not a valid bare identifier, hence the bracket access below.
const DockviewCore = window['dockview-core'];

// Single source of truth for every panel's user-facing name. Every spot
// that displays a panel's name — its dockview tab title, its row label in
// the radars-panel's Panels section (ui.js's PANEL_CONTROL_ROWS), the
// topbar RADARS/PANELS button's own text — reads from here, so renaming a
// panel means changing exactly one string instead of hunting through both
// files and the static HTML and hoping none of the copies drift apart (this
// exact drift is what prompted consolidating it: the topbar button's label
// used to be hardcoded in index.html separately from the panel's own title
// here in dock.js). `map` has no entry — it uses dockview's own default
// (the tab shows its id) via createNoCloseTab, and nothing has asked for
// that to change.
const PANEL_TITLES = {
  track:    'TRACK INFO',
  radars:   'PANELS',
  settings: 'SETTINGS',
  airport:  'AIRPORT',
  calls:    'SQWK C/S',
  radio:    'RADIO',
};

const DOCK_LAYOUT_KEY = 'crc-desktop-dock-layout';

let dock = null;

function initDock() {
  const root = document.getElementById('dock-root');

  dock = new DockviewCore.DockviewComponent(root, {
    className: 'dockview-theme-abyss',
    createComponent(options) {
      switch (options.name) {
        case 'map':      return createMapPanel();
        case 'track':    return mountExistingPanel('track-panel', initTrackPanel);
        case 'calls':    return mountExistingPanel('calls-panel', initCallsPanel);
        case 'settings': return mountExistingPanel('settings-panel', initSettings);
        case 'airport':  return mountExistingPanel('aprt-panel', initAprtPanel);
        case 'radars':   return mountExistingPanel('radars-panel', initRadarPanel);
        case 'radio':    return mountExistingPanel('srs-radio-panel', null);
        default: throw new Error(`[dock] unknown panel component: ${options.name}`);
      }
    },
    createTabComponent(options) {
      switch (options.name) {
        case 'no-close': return createNoCloseTab();
        default: throw new Error(`[dock] unknown tab component: ${options.name}`);
      }
    },
  });

  loadDockLayout();
  // The radars-panel's own init() (ui.js's initRadarPanel, invoked by
  // mountExistingPanel while fromJSON()/buildDefaultDockLayout() above is
  // still running) renders the Panels checkboxes against whatever sibling
  // panels dockview has constructed *so far* — but fromJSON() walks the
  // saved grid and recreates panels one at a time, so settings/airport/
  // calls/radio frequently don't exist yet at that point and their
  // checkboxes get built unchecked even when the saved layout has them
  // open. Nothing re-renders afterward (onDidLayoutChange isn't wired up
  // until below, and dockview has no onShow-style revisit hook despite
  // ui.js's initRadarPanel returning one — see its comment). Re-rendering
  // once more here, now that the whole restore has settled, fixes that.
  if (typeof renderPanelControls === 'function') renderPanelControls();
  wireRadarsPanelButton();

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveDockLayout();
      captureOpenPanelPlacements();
    }, 400);
  }

  dock.api.onDidLayoutChange(() => {
    // IMPORTANT: never call addPanel()/removePanel() synchronously from
    // inside this callback. onDidLayoutChange can fire while dockview is
    // still mid-mutation — e.g. removing a group that just emptied out, or
    // partway through fromJSON() rebuilding a whole saved layout — and a
    // reentrant addPanel() call in that window previously froze the app:
    // dockview would still report the panel "missing" on the very next
    // change event that same synchronous mutation produced, so the re-add
    // fired again, and again, pegging the renderer in an infinite loop
    // (reproduced with 100% certainty by closing every left-group tab).
    // Deferring past the current synchronous call stack — and coalescing
    // bursts of change events into a single check — sidesteps this
    // entirely: by the time it runs, dockview's internal state has settled.
    scheduleEnsureRequiredPanels();
    // The radars-panel's Panels section (ui.js) mirrors dock state in its
    // own checkboxes/status text, but only re-renders on its own tab
    // becoming active or a click inside it — closing a panel by its own tab
    // (the dockview "x", not that checkbox) previously left the checkbox
    // showing on/OPEN until the Panels tab happened to be revisited. Every
    // layout change is a cheap enough re-render (a handful of DOM rows) to
    // just do unconditionally rather than trying to detect "was it a
    // close".
    if (typeof renderPanelControls === 'function') renderPanelControls();
    scheduleSave();
  });

  // Backstop: while testing this against a real running instance (devtools
  // protocol, driving actual pointer-event sash drags — a plain synthetic
  // mouse event isn't enough, dockview's sash only listens for real
  // PointerEvents), dock.api.onDidLayoutChange's debounced handler above
  // reliably captured the very first layout change of a session but then
  // repeatedly failed to fire for later ones — including plain resizes,
  // which is exactly the case placement memory most needs. Subscribing a
  // second, independent listener at that point kept receiving events fine,
  // so *something* about long-lived delivery to the original subscriber
  // was unreliable, though isolating the precise cause wasn't possible
  // (the test setup itself had unrelated graphics-stack issues muddying
  // results, so this may be a dockview quirk, a test artifact, or both).
  // Rather than depend on fully understanding that, polling sidesteps it
  // entirely: it doesn't rely on any specific event firing at all. 2s is
  // frequent enough that a panel closed shortly after being resized still
  // has fresh geometry recorded, and cheap enough (a handful of property
  // reads, most of the time finding nothing changed) to just always run.
  setInterval(scheduleSave, 2000);
}

// Panels with no dedicated reopen UI — always re-added if closed. Track Info
// deliberately is NOT here: it has its own reopen path (clicking a track on
// the map — see ensureTrackPanel/showTrackPanel), so it's free to stay
// closed like any other optional panel. Map is the one panel with no
// reopen affordance of any kind, so it alone gets force-restored.
//
// `options` may be a plain object or a function computing it at re-add
// time — needed here because the right place for Map to land depends on
// whether anything else is currently docked: with no position at all,
// dockview drops a re-added panel into whichever group happens to be
// active, which previously meant Map got merged as a tab into the left
// group instead of restored to its own column the moment it — and only
// it — was closed.
const REQUIRED_PANELS = [
  {
    id: 'map',
    options: () => {
      const anchor = dock.api.panels.map(p => p.id).find(id => id !== 'map');
      const base = { id: 'map', component: 'map', tabComponent: 'no-close' };
      return anchor
        ? { ...base, position: { referencePanel: anchor, direction: 'right' } }
        : base;
    },
  },
];

// Safe to call directly (synchronously adds whatever's missing) as long as
// the caller isn't itself running from inside an onDidLayoutChange callback
// — see scheduleEnsureRequiredPanels below for that case.
function addMissingRequiredPanels() {
  for (const { id, options } of REQUIRED_PANELS) {
    if (!dock.api.getPanel(id)) dock.addPanel(typeof options === 'function' ? options() : options);
  }
}

// Shared "where should this land" logic for every panel that belongs in the
// left auxiliary cluster (Track Info / Radars / Airport / Squawk C/S):
// rejoin whichever of them is already open, so a panel being (re)added
// tabs alongside its siblings instead of splitting off into its own column
// — which is what happens if you hand dockview a `position` referencing a
// panel that doesn't currently exist (it throws), or no position at all
// (it lands wherever the active group happens to be, sometimes merging
// into completely the wrong group — both reproduced firsthand while
// building this). `excludeId` leaves out the panel currently being placed.
const LEFT_CLUSTER = ['track', 'radars', 'airport', 'calls'];

function leftGroupAnchor(excludeId) {
  return LEFT_CLUSTER.filter(id => id !== excludeId).find(id => dock.api.getPanel(id));
}

// Which "side" each closable panel belongs to — see the big comment above
// PANEL_SIDE_SIZES below for why sizing is tracked per side rather than per
// panel. `map` isn't listed: it never closes, so it never needs a
// remembered size to come back to.
const PANEL_SIDE = {
  track: 'left', radars: 'left', airport: 'left', calls: 'left',
  settings: 'right',
  radio: 'bottom',
};

// Track Info's reopen path: clicking a track on the map (showTrackPanel, in
// ui.js) calls this to get-or-create the panel before activating it, rather
// than relying on a permanent required-panel restore.
function ensureTrackPanel() {
  const existing = dock.api.getPanel('track');
  if (existing) return existing;
  const anchor = leftGroupAnchor('track');
  return dock.addPanel(withRememberedPlacement('track', {
    id: 'track', component: 'track', title: PANEL_TITLES.track,
    position: anchor ? { referencePanel: anchor } : { referencePanel: 'map', direction: 'left' },
  }, !anchor));
}

let _ensureRequiredPanelsQueued = false;

function scheduleEnsureRequiredPanels() {
  if (_ensureRequiredPanelsQueued) return;
  _ensureRequiredPanelsQueued = true;
  setTimeout(() => {
    _ensureRequiredPanelsQueued = false;
    addMissingRequiredPanels();
  }, 0);
}

// The Radars/Panels control itself — reached only via the topbar button
// (see wireRadarsPanelButton/toggleOrFocusPanel below), not from any
// checkbox. (Internal id/component/DOM-id stay "radars" — only the
// user-facing name changed; renaming those too would touch a lot of
// references for zero user-visible benefit.)
function radarsPanelOptions() {
  const anchor = leftGroupAnchor('radars');
  return withRememberedPlacement('radars', {
    id: 'radars', component: 'radars', title: PANEL_TITLES.radars,
    position: anchor ? { referencePanel: anchor } : { referencePanel: 'map', direction: 'left' },
  }, !anchor);
}

function wireRadarsPanelButton() {
  const btn = document.getElementById('btn-radars');
  if (!btn) return;
  const label = document.getElementById('btn-radars-label');
  if (label) label.textContent = PANEL_TITLES.radars;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOrFocusPanel('radars', radarsPanelOptions);
  });
}

// Click-to-toggle for a panel reached via a single topbar button (as
// opposed to the Panels-section checkboxes, which are plain on/off): opens
// it and focuses it if it's not the active tab, closes it if it already is
// — the same "click again to dismiss" feel the old fixed-position toggle
// button had.
function toggleOrFocusPanel(id, addOptionsFn) {
  const existing = dock.api.getPanel(id);
  if (existing) {
    if (dock.api.activePanel === existing) dock.api.removePanel(existing);
    else existing.api.setActive();
  } else {
    dock.addPanel(addOptionsFn()).api.setActive();
  }
}

// Optional panels toggled from the radars-panel's "Panels" section (see
// initRadarPanel() in ui.js) — off by default so the map keeps maximum
// space until the user actually asks for one. Airport is additionally
// driven by radar state (see notifyRadarToggled) — Settings/Squawk C/S have
// no radar tie and are purely manual. Future dockable panels (flight
// strips, PAR scope, marshal stack, LSO, chat) register here too.
const DOCKABLE_PANELS = {
  // Always a fresh split off map (nothing else ever anchors to its own
  // right side) — safe to unconditionally size from memory, see
  // withRememberedPlacement's `allowGridSize` comment below.
  settings: () => withRememberedPlacement('settings', {
    id: 'settings', component: 'settings', title: PANEL_TITLES.settings,
    position: { referencePanel: 'map', direction: 'right' },
  }, true),
  airport: () => {
    const anchor = leftGroupAnchor('airport');
    return withRememberedPlacement('airport', {
      id: 'airport', component: 'airport', title: PANEL_TITLES.airport,
      position: anchor ? { referencePanel: anchor } : { referencePanel: 'map', direction: 'left' },
    }, !anchor);
  },
  calls: () => {
    const anchor = leftGroupAnchor('calls');
    return withRememberedPlacement('calls', {
      id: 'calls', component: 'calls', title: PANEL_TITLES.calls,
      position: anchor ? { referencePanel: anchor } : { referencePanel: 'map', direction: 'left' },
    }, !anchor);
  },
  // No referencePanel/referenceGroup at all — dockview interprets a bare
  // `direction` as relative to the whole grid (confirmed against its
  // source: it hits the "orthogonalize" branch rather than splitting a
  // single panel), which is what makes this a genuine full-width bottom
  // strip rather than just "below the map panel" specifically. Re-adding it
  // this way after a close also always lands back as a fresh full-width
  // strip, regardless of how the rest of the grid has been rearranged
  // since — always a fresh strip, so (like settings) safe to size from
  // memory; 90 is just the first-ever-launch fallback.
  radio: () => withRememberedPlacement('radio', {
    id: 'radio', component: 'radio', title: PANEL_TITLES.radio,
    position: { direction: 'below' },
    initialHeight: 90,
  }, true),
};

function isDockPanelOpen(id) {
  return !!(dock && dock.api.getPanel(id));
}

// `preserveFocus`: dockview's addPanel() focuses whatever it just added by
// default — fine for a deliberate "open this" click (Panels checkbox/pin),
// but wrong for a panel opening as a *side effect* of something else (radar
// implication, see notifyRadarToggled): confirmed firsthand that enabling a
// radar mid-search yanked focus away from the Radars panel to the newly-
// opened Airport panel, hiding the very search the user was still using.
function toggleDockPanel(id, open, { preserveFocus } = {}) {
  const optionsFn = DOCKABLE_PANELS[id];
  if (!optionsFn) return;
  const existing = dock.api.getPanel(id);
  if (open) {
    if (!existing) {
      const previousActive = preserveFocus ? dock.api.activePanel : null;
      dock.addPanel(optionsFn());
      if (previousActive && dock.api.getPanel(previousActive.id)) previousActive.api.setActive();
    }
  } else if (existing) {
    dock.api.removePanel(existing);
  }
}

// ── Placement memory: floats per panel, sizes per side ───────────────────
// Closing an optional panel re-adds it later via a hardcoded `position` in
// DOCKABLE_PANELS/radarsPanelOptions/ensureTrackPanel, which loses whatever
// the user had actually set up. Two genuinely different things get
// remembered here, deliberately kept in separate caches because they don't
// generalize the same way:
//
//  - A panel dragged out into its own floating window. This is inherently
//    per-PANEL — a float belongs to exactly one panel, there's no "side" to
//    share it with — so it's kept in _panelFloats, keyed by panel id, and
//    restored verbatim (an absolute x/y/width/height against the window is
//    never ambiguous, regardless of what else is docked elsewhere).
//
//  - A docked panel's size. This is NOT really a per-panel thing: Track
//    Info, Radars, Airport, and Squawk C/S all share the same physical
//    column (LEFT_CLUSTER) — the "left side is 900px wide" fact belongs to
//    that side, not to whichever one of them happened to be open when it
//    was last resized. The very first version of this only remembered a
//    resized width against the one panel that was open at the time: resize
//    while Track is open, close Track, reopen Airport instead (still an
//    empty side, so still a fresh split) — and Airport had no memory of
//    its own, so it fell back to dockview's default ~50/50 split anyway.
//    Tracking size per PANEL_SIDE instead of per panel id fixes that: any
//    panel on a given side, however it gets reopened, restores that side's
//    last known size. Kept in _sideSizes, keyed by 'left'/'right'/'bottom'
//    (see PANEL_SIDE above) — and applied only when the panel reopening is
//    about to become the sole/first occupant of a fresh split for its side
//    (the `allowGridSize` argument each DOCKABLE_PANELS entry passes in,
//    true only when it computed no anchor/sibling to join). Deliberately
//    NOT applied when rejoining an EXISTING sibling group as a new tab —
//    reproduced firsthand that forcing a remembered size there fights
//    dockview's own splitview math (the group already has its own live,
//    correct size) and can balloon one panel across most of the screen
//    while squeezing every other one down to a sliver.
//
// There's no "about to be removed" dockview event to hook (only
// onDidLayoutChange, which fires after removal, by which point the
// panel's geometry is already gone) — instead this piggybacks on the same
// debounced onDidLayoutChange tick (plus a periodic backstop poll, see
// initDock()) saveDockLayout uses, recording every currently-open tracked
// panel's current placement each time: whichever was live right before a
// panel/side was later closed is what's still in the cache when it's
// reopened.
const PANEL_FLOAT_KEY = 'crc-desktop-panel-float';
const SIDE_SIZE_KEY = 'crc-desktop-side-size';
const PLACEMENT_TRACKED_IDS = ['track', 'radars', 'settings', 'airport', 'calls', 'radio'];

function _loadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function _saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

let _panelFloats = _loadJSON(PANEL_FLOAT_KEY); // panel id -> floating box
let _sideSizes = _loadJSON(SIDE_SIZE_KEY);     // 'left'/'right'/'bottom' -> {width, height}

function captureOpenPanelPlacements() {
  let floatsChanged = false;
  let sidesChanged = false;
  for (const id of PLACEMENT_TRACKED_IDS) {
    const panel = dock.api.getPanel(id);
    if (!panel) continue;
    try {
      if (panel.api.location.type === 'floating') {
        const floatingGroup = dock.floatingGroups.find(g => g.group === panel.api.group);
        const box = floatingGroup && floatingGroup.overlay.toJSON();
        if (box && box.width > 0 && box.height > 0) {
          _panelFloats[id] = box;
          floatsChanged = true;
          continue;
        }
      } else if (panel.api.location.type === 'grid' && id in _panelFloats) {
        // Docked normally after previously having a remembered float. That
        // float no longer reflects where this panel belongs — without this,
        // it sits in _panelFloats forever (this cache is otherwise
        // write-only) and withRememberedPlacement keeps reapplying it on
        // every future reopen, so a panel the user re-docked and closed
        // normally comes back floating — unexpectedly, and "sometimes on
        // startup" specifically for panels force-restored (see
        // REQUIRED_PANELS/DOCKABLE_PANELS) before this function has ever
        // run this session to notice they're docked.
        delete _panelFloats[id];
        floatsChanged = true;
      }
      // Docked (or a floating box that failed the sanity check above —
      // e.g. read mid-mutation). Read the size off the *group*, not the
      // panel: panel.api.width/height only updates for whichever tab in
      // the group is currently active — confirmed live (real mouse-drag
      // resize via CDP) that a background tab's own panel.api.width stays
      // stale at its original creation-time value forever, while
      // panel.api.group.api.width tracks the group's actual live box
      // regardless of which tab is active. Only overwrite with a real,
      // laid-out measurement; a 0/undefined width or height means dockview
      // hasn't measured it yet this tick (seen right after a fromJSON()
      // restore), and persisting that would later apply a degenerate
      // zero-size split.
      const w = panel.api.group.api.width, h = panel.api.group.api.height;
      const side = PANEL_SIDE[id];
      if (side && Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        _sideSizes[side] = { width: w, height: h };
        sidesChanged = true;
      }
    } catch (err) {
      console.error(`[dock] failed to capture placement for panel '${id}':`, err.message);
    }
  }
  if (floatsChanged) _saveJSON(PANEL_FLOAT_KEY, _panelFloats);
  if (sidesChanged) _saveJSON(SIDE_SIZE_KEY, _sideSizes);
}

// Merges a remembered placement into freshly-computed addPanel() options.
// A remembered float always applies (never ambiguous). A remembered side
// size only applies when `allowGridSize` is true — see the big comment
// above for why.
function withRememberedPlacement(id, options, allowGridSize) {
  const box = _panelFloats[id];
  if (box) {
    const { width, height, top, bottom, left, right } = box;
    const position = {};
    if (typeof top === 'number') position.top = top;
    else if (typeof bottom === 'number') position.bottom = bottom;
    if (typeof left === 'number') position.left = left;
    else if (typeof right === 'number') position.right = right;
    const { position: _drop, ...rest } = options;
    return { ...rest, floating: { position, width, height } };
  }
  const sideSize = allowGridSize && _sideSizes[PANEL_SIDE[id]];
  if (sideSize) {
    const opts = { ...options };
    if (typeof sideSize.width === 'number') opts.initialWidth = sideSize.width;
    if (typeof sideSize.height === 'number') opts.initialHeight = sideSize.height;
    return opts;
  }
  return options;
}

// ── Radar-driven panel visibility ───────────────────────────────────────
// Enabling a radar that implies a panel (currently just airport-type radars
// → the Airport panel) opens it automatically; disabling the last radar
// that implies it closes it again — unless the user has pinned it, which
// keeps it open regardless of radar state until explicitly unpinned.
// Settings/Squawk C/S have no radar tie and aren't affected by any of this.
const RADAR_TYPE_TO_PANEL = { airport: 'airport' };

const PINNED_PANELS_KEY = 'crc-desktop-pinned-panels';

function _loadPinnedPanels() {
  try {
    const raw = localStorage.getItem(PINNED_PANELS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

let _pinnedPanels = _loadPinnedPanels();

function isPanelPinned(id) {
  return !!_pinnedPanels[id];
}

function setPanelPinned(id, pinned) {
  _pinnedPanels[id] = pinned;
  try {
    localStorage.setItem(PINNED_PANELS_KEY, JSON.stringify(_pinnedPanels));
  } catch (_) {}
  // Clicking PIN happens from inside the radars-panel's Panels section —
  // preserve focus there too, same reasoning as notifyRadarToggled.
  if (pinned) toggleDockPanel(id, true, { preserveFocus: true });
  else if (!isPanelImplied(id)) toggleDockPanel(id, false);
}

// True if any currently-enabled radar implies this panel.
function isPanelImplied(panelId) {
  for (const r of getAllRadars()) {
    if (enabledRadarIds.has(r.id) && RADAR_TYPE_TO_PANEL[r.type] === panelId) return true;
  }
  return false;
}

// Called from ui.js whenever a radar's enabled state changes (both from the
// active-radars list and the add-radar search) — reacts only to this one
// radar's own transition, not a continuously-enforced invariant, so
// manually closing an implied-open panel afterward doesn't get fought the
// way Track Info's old permanent auto-restore did.
function notifyRadarToggled(radar, enabled) {
  const panelId = RADAR_TYPE_TO_PANEL[radar.type];
  if (!panelId) return;
  if (enabled) {
    toggleDockPanel(panelId, true, { preserveFocus: true });
  } else if (!isPanelImplied(panelId) && !isPanelPinned(panelId)) {
    toggleDockPanel(panelId, false);
  }
}

// ── Map panel ──────────────────────────────────────────────────────────────
// initMap() (map-setup.js) is handed this panel's own container element
// directly rather than looking one up by DOM id, since dockview's attach
// timing relative to init() isn't something to depend on (see layout() below).
//
// Like mountExistingPanel's _legacyPanelState, `started` and `element` are
// cached at module level, NOT per createComponent() call. The map's tab has
// no close button (see createNoCloseTab below) so there's no direct UI path
// to trigger this, but re-closing/reopening it by any other means would
// otherwise call createMapPanel() again, constructing a *second* MapLibre
// instance while the shared `mapReady` flag (map-setup.js) stays stuck at
// true from the first instance's already-completed load — every source
// lookup against the new, not-yet-loaded map then crashes with "Cannot read
// properties of undefined (reading 'setData')" the moment any periodic
// update fires. One persistent MapLibre instance for the app's lifetime
// avoids the whole class of problem.
let _mapPanelElement = null;
let _mapPanelStarted = false;

function createMapPanel() {
  if (!_mapPanelElement) {
    _mapPanelElement = document.createElement('div');
    _mapPanelElement.id = 'map';
  }

  return {
    element: _mapPanelElement,
    init() {},
    layout() {
      // MapLibre measures its container synchronously at construction time,
      // so it must already have real (attached, non-zero) layout dimensions
      // — init() fires before dockview has necessarily attached `element`
      // to the document, but layout(width, height) only fires once it
      // actually has a rendered box. Constructing lazily on the first
      // layout() call sidesteps relying on dockview's exact attach/init
      // ordering.
      if (!_mapPanelStarted) {
        _mapPanelStarted = true;
        initMap(_mapPanelElement);
        return;
      }
      if (typeof map !== 'undefined' && map && typeof map.resize === 'function') {
        map.resize();
      }
    },
  };
}

// Tab renderer for the map panel — identical to dockview's built-in default
// tab (same classes, so it's styled the same) minus the close-button action
// element, so there's no way to close the one panel with no reopen UI at
// all. Mirrors DefaultTab's own approach (title text + reacting to
// api.onDidTitleChange) rather than dockview's undocumented internals.
function createNoCloseTab() {
  const element = document.createElement('div');
  element.className = 'dv-default-tab';
  const content = document.createElement('div');
  content.className = 'dv-default-tab-content';
  element.appendChild(content);
  let titleChangeDisposable = null;
  return {
    element,
    init(params) {
      content.textContent = params.title || '';
      titleChangeDisposable = params.api.onDidTitleChange((event) => {
        content.textContent = event.title || '';
      });
    },
    dispose() {
      if (titleChangeDisposable) titleChangeDisposable.dispose();
    },
  };
}

// ── Legacy-panel adapter ───────────────────────────────────────────────────
// Wraps an existing static DOM subtree (still declared in index.html, still
// referenced internally via its own document.getElementById lookups) as a
// dockview panel, without rewriting any of that panel's internal logic.
//
// State is cached per domId in a module-level map, NOT per createComponent()
// call — this is load-bearing, not a micro-optimisation. dockview calls
// createComponent() again every time a panel is re-created (e.g. Track Info
// being closed and later reopened via ensureTrackPanel), and by then
// dockview has already detached the panel's original DOM node from the
// document — a fresh document.getElementById(domId) at that point returns
// null. Handing dockview `element: null` previously caused every re-add
// attempt to fail, and since each failed attempt still fired another
// layout-change event, the required-panel safety net kept rescheduling
// itself forever, pegging the renderer (reproduced reliably by closing
// every left-group tab back when Track Info was also force-restored).
// Caching the element the first time it's genuinely attached — and reusing
// that same (possibly since-detached, but still-alive-in-memory) reference
// on every later re-creation — sidesteps this entirely; re-appending an
// orphaned node is completely valid, it just can't be found by id anymore.
// The same cache also makes `initFn` genuinely run-once across
// close/reopen cycles, rather than re-wiring (and duplicating) its event
// listeners on every reopen.
const _legacyPanelState = new Map(); // domId -> { element, initialized, hooks }

function mountExistingPanel(domId, initFn) {
  let state = _legacyPanelState.get(domId);
  if (!state) {
    const element = document.getElementById(domId);
    if (!element) console.error(`[dock] no #${domId} element found in index.html — this panel will not render`);
    // See the .dock-unmounted rule (index.html): every legacy-adapter div
    // starts hidden in the static markup, since a panel dockview hasn't
    // been asked to create yet this session has nowhere to go and would
    // otherwise render inline wherever it happens to sit in the HTML source.
    if (element) element.classList.remove('dock-unmounted');
    state = { element, initialized: false, hooks: null };
    _legacyPanelState.set(domId, state);
  }
  return {
    element: state.element,
    init() {
      if (state.initialized) return;
      state.initialized = true;
      state.hooks = (initFn && initFn()) || null;
    },
    // Runs when dockview removes this panel (tab closed, checkbox
    // unchecked, etc). Panels whose init() wired up state that keeps
    // getting written to on a timer/broadcast regardless of visibility
    // (Track Info's _trackPanelId, updated by the periodic track-data tick)
    // need to clear that state here, or the next tick after close tries to
    // write into DOM that's no longer attached to the document and throws.
    dispose() {
      if (state.hooks && state.hooks.onClose) state.hooks.onClose();
    },
    onShow() {
      if (state.hooks && state.hooks.onShow) state.hooks.onShow();
    },
  };
}

// ── Layout persistence ─────────────────────────────────────────────────────

function buildDefaultDockLayout() {
  // Called directly during boot, before onDidLayoutChange is wired up (see
  // initDock()) — safe to add panels synchronously here. Track Info and
  // Radio are part of the default layout (nice to see on first launch,
  // matching what used to always be visible) even though neither is
  // force-restored later — ensureTrackPanel() and the checkbox in the
  // radars-panel's Panels section cover reopening them respectively.
  addMissingRequiredPanels();
  ensureTrackPanel();
  toggleDockPanel('radio', true);
  // Settings/Airport/Squawk C/S intentionally NOT added here — they start
  // closed; the user opts in via the radars-panel's Panels checkboxes.
}

function saveDockLayout() {
  try {
    localStorage.setItem(DOCK_LAYOUT_KEY, JSON.stringify(dock.toJSON()));
  } catch (err) {
    console.error('[dock] failed to save layout:', err.message);
  }
}

function loadDockLayout() {
  try {
    const raw = localStorage.getItem(DOCK_LAYOUT_KEY);
    if (raw) {
      dock.fromJSON(JSON.parse(raw));
      return;
    }
  } catch (err) {
    console.error('[dock] failed to restore saved layout, using default:', err.message);
  }
  buildDefaultDockLayout();
}
