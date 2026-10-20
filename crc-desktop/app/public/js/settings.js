'use strict';
// The client's settings: the defaults, the one `settings` object every module reads, and its localStorage load/save.
// A leaf (DESK-GRAPH): imports nothing, so a rule or a panel can read a setting without importing `app.js`.

const DEFAULTS = {
  pplEnabled:    true,
  pplDuration:   60,
  trailEnabled:  true,
  trailLength:   10,
  shipsEnabled:      false,
  braColor:      '#4488cc',
  radarDebug:    false,
  textMarksEnabled: false, // DCS mission-editor Text objects, shown as a map layer
  drawingsEnabled: true,   // DCS mission-editor shape drawings (geojson.js buildDrawings); Settings → Declutter
  airportSurface:  true,   // the basemap's airport surface at high zoom: pavement, taxiways, designators, names (airport-surface.js)
  extCenterlineNm: 25, // extended AP-radar centerline length
  scale:         1.0,
  lightMode:     false,
  showElevation: false, // computed contour lines + height labels (elevation.js), zoom-independent
  fadeGraceMs:    10000, // ms at full brightness after last sweep before fading starts
  navDeclutter:    false, // hide navpoints whose names contain digits (off: H70)
  navDeclutter5:   false, // hide navpoints whose names are not exactly 5 letters (off: H70)
  trailIntervalMs: 5000, // minimum ms between trail dot recordings
  // Auto-hide labels for sequential-squawk formation flights. OFF, and forced
  // off once for existing installs below: every declutter behaviour stays
  // disabled until the end of the EFSP work (decision H6). The code path in
  // geojson.js's getDeclutteredIds() is kept — REVISIT then.
  declutter:       false,
  airspaceMenu:    null,   // the airspace layer menu's choices (airspace-layer-menu.js); null = its default (ACTIVE only). Per user, never synced
  coordFormat:     'DM',   // how coordinates are shown and prefilled: 'DMS' | 'DM' | 'MGRS' (coords.js, H102 AP2B-Q2); input accepts all
  showDatalinkLocks: true, // draw the datalink's radar-lock lines (geojson.js's buildDatalinkLines)
  conflictAlertPaths: true, // T30: draw a conflict alert's predicted paths and closest-point line (geojson.js's buildConflictAlertOverlay); the CA in the data block and the CPA marker stay either way
  transitionAltFt: 18000, // ft — how an ASSIGNED altitude is written. The theater's, from crc-sync's `theater` message (its docs/adr/0085); not a setting. [SOURCE-DEFINED] (docs/adr/0085): 18,000 ft is only the fallback until the first `theater` message (sent on connect); the other client files read it with no fallback of their own
  aprtManualWx:    {},    // per-airport manually-entered vis/cloud data, keyed by ICAO — squadron-wide, see crc-sync's apt-config.js
  aprtAtisFreq:    {},    // per-airport saved ATIS frequency, keyed by ICAO — squadron-wide, see crc-sync's apt-config.js
  aprtAtisRwy:     {},    // per-airport saved ATIS runway, keyed by ICAO — squadron-wide, see crc-sync's apt-config.js
  aprtAtisInfo:    {},    // per-airport saved ATIS info letter, keyed by ICAO — squadron-wide, see crc-sync's apt-config.js
  bullseyeOverride: {     // manual bullseye position override, per coalition
    blue: { enabled: false, lat: null, lon: null },
    red:  { enabled: false, lat: null, lon: null },
  },
  // ── Colours ───────────────────────────────────────────────────────────────
  colFriendly:    '#4488cc',
  colBogey:       '#ccaa00',
  colNeutral:     '#888888',
  colBandit:      '#cc6600',
  colHostile:     '#cc2222',
  colEmergGen:    '#cc2222',   // 7700 general emergency
  colEmergRadio:  '#b8a000',   // 7600 radio failure
  colEmergHijack: '#cc6600',   // 7500 hijack
  colRangeRing:   '#8aaa6a',
  colNavpoint:    '#3a5a3a',
};

export let settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem('crc-desktop-settings');
    if (raw) settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {}
  // H6: a saved settings object carries the old `declutter: true` default;
  // switch it off once. A controller may still turn it back on by hand.
  if (!settings.declutterOffH6) { settings.declutter = false; settings.declutterOffH6 = true; }
  // H70: navpoint declutter goes off too, once, until AIRAC data replaces it.
  if (!settings.navDeclutterOffH70) { settings.navDeclutter = false; settings.navDeclutter5 = false; settings.navDeclutterOffH70 = true; }
  // H15: headings are magnetic from crc-sync's model; the manual correction is gone.
  delete settings.hdgCorrection;
  migratePar(settings);
}

/** ADR 0123: the single PAR elevation tolerance `parTolEl` becomes the upper limit; the lower one takes its own default. */
export function migratePar(s) {
  if (typeof s.parTolEl === 'number' && Number.isFinite(s.parTolEl) && s.parTolElHigh === undefined) s.parTolElHigh = s.parTolEl;
  delete s.parTolEl;
}

export function saveSettings() {
  localStorage.setItem('crc-desktop-settings', JSON.stringify(settings));
}
