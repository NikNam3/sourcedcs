'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

const COALITION_COLOR       = { 1: '#888888', 2: '#cc4444', 3: '#4488cc' };
const LIGHT_COALITION_COLOR = { 1: '#505050', 2: '#cc0000', 3: '#004499' }; // higher contrast on light map
const GROUND_COLOR          = { 1: '#7a7a68', 2: '#aa6644', 3: '#557799' };
const HISTORY_MAX      = 10;
const FADE_DURATION_MS = 10000;
const STALE_MS         = 10000;
const MIN_SPD_KT_PPL   = 30;

const CRC_RANGE_NM     = 200;
const CRC_RANGE_M      = CRC_RANGE_NM * 1852;

// Default label position and geometry constants (used by geojson.js + map-setup.js)
const TEXT_SIZE_PX      = 11;
const TEXT_OFFSET_EM    = [4.0, -0.5]; // em units [right, up] from icon
const LEADER_ICON_GAP   = 7;
const LABEL_HALF_W      = 30;
const LABEL_HALF_H      = 13;
const LABEL_EDGE_MARGIN = 2;

// Radar sweep
// Beam width for the debug overlay only. Detection is crc-sync's, and it
// computes the instant the beam crosses a contact's bearing rather than
// testing whether the beam happens to be within a few degrees of it — so this
// is now purely how wide the drawn wedge is (see its src/coverage.js).
const SWEEP_BEAM_DEG  = 4;
// How often the fade/expiry pass runs. It used to be the sweep tick at 50ms,
// where the interval decided which contacts were found at all; now nothing is
// detected here and 250ms is smooth enough for a ten-second fade.
const FADE_TICK_MS    = 250;

// Assumed antenna/mast height (meters) above field elevation / waterline —
// DCS doesn't report actual radar tower height, so ground-based radars need
// an assumed offset or terrain LOS masking would make them unrealistically
// easy to block (airborne radars use their own live altitude instead).
const AIRPORT_RADAR_HEIGHT_M = 15;
const SHIP_RADAR_HEIGHT_M    = 40;

// ── State ─────────────────────────────────────────────────────────────────

// The radar picture is server-authoritative (crc-sync's docs/adr/0042). This
// renderer no longer derives radars, owns a sweep phase, or decides what it is
// allowed to see: crc-sync sends only the contacts the Positions this
// controller holds can actually see, each stamped with `illuminatedAt` — when
// the beam last passed over it. What each contact carries is only what those
// sensors could know (crc-sync's docs/adr/0059); track-label.js reads it.
//
// Two maps, and the distinction between them is load-bearing:
//   latestFromServer — every contact in this controller's coverage, with
//     who it is (label, IFF) updated at once rather than waiting for a beam.
//   tracks — the contacts still inside the fade window, i.e. what is on the
//     scope right now. Position and altitude stay gated on illumination on
//     purpose: that IS the radar simulation, computed once on the server.
const latestFromServer = new Map(); // id → track (as delivered, incl. illuminatedAt)
const tracks           = new Map(); // id → track (displayed)
window.getAllTracks    = () => [...latestFromServer.values()];
window.getLatestTrack   = (id) => latestFromServer.get(String(id)) || null;
const history          = new Map(); // id → [{lat, lon, altFt, timestamp}, ...] — altFt null when no sensor gives one
const labelOffsets     = new Map(); // id → [dLat, dLon] relative to track

// When the server says each contact was last illuminated. Replaces the local
// `lastSweepMs` the deleted sweep loop used to write, and is the one clock the
// fade is computed against — so two controllers watching one contact see it
// decay together.
const lastSweepMs      = new Map(); // trackId → illuminatedAt, from the server
const zeroSpeedSinceMs = new Map(); // trackId → timestamp when 0-speed-airborne first detected

// Static reference data loaded at startup
let aircraftTypes = {};
let airportsDb    = {};

let missionData      = null;
let weather          = { pressurePa: 101325, tempK: 288.15 }; // ISA defaults until server sends live data
let atisActive       = []; // [{ frequency, ownerId }] — who's currently transmitting ATIS where, from crc-sync
let grpcStatus       = 'disconnected';
let noRadarsActive   = false; // true when the held Positions grant no radar at all
let srsStatus        = 'disconnected';
let lastUpdateMs     = null;
let mapReady         = false;
let map;
let _drag            = null;
let _measure         = null;
let bullseyePickTarget = null; // 'blue' | 'red' | null — awaiting a map click to set bullseye override
let _pulseBright     = true;
let selectedRef      = null; // string track id (reference)
let selectedApt      = null;
let _ws              = null;
let approachRwyCourse = null; // used for approach-vector line

// ── Coverage ──────────────────────────────────────────────────────────────
// What this controller is looking through, as crc-sync's `coverage` message
// last stated it. Not a selection: it follows the Positions they hold
// (crc-sync's docs/adr/0042), so there is nothing here for a user to toggle
// and the radar selector that used to own it is gone. Ground, Clearance
// Delivery and Operations have no scope, and a controller holding only those
// correctly gets an empty list — the banner says so rather than the map going
// quietly blank.
let coverageRadars = [];          // [{id, type, label, lat, lon, elevM, rangeM, sweepMs, sweepStart, grantedBy, ...}]
let coverageHeldPositions = [];   // [{facilityId, positionId, isPrimary}]
let coverageDatalink = false;     // whether a held Position is on the datalink

/** Every radar this controller is looking through. */
function getActiveRadars() { return coverageRadars; }

/** The approach radar for an airfield, if we are looking through it — used by the extended centerline. */
function coverageApproachFor(airportName) {
  return coverageRadars.find(r => r.type === 'approach' && r.airport === airportName) || null;
}

// ── Static data ───────────────────────────────────────────────────────────

async function loadStaticData() {
  try {
    const [at, ap] = await Promise.all([
      fetch('/data/aircraft-types.json').then(r => r.json()),
      fetch('/data/airports.json').then(r => r.json()),
    ]);
    // Strip the _comment key
    // Remove comment keys so they don't appear in type lookups
    Object.keys(at).filter(k => k.startsWith('_comment')).forEach(k => delete at[k]);
    delete ap._comment;
    aircraftTypes = at;
    airportsDb    = ap;
    console.log(`[crc] loaded ${Object.keys(aircraftTypes).length} aircraft types, ${Object.keys(airportsDb).length} airports`);
  } catch (e) {
    console.warn('[crc-desktop] failed to load static data:', e);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────

const DEFAULTS = {
  pplEnabled:    true,
  pplDuration:   60,
  trailEnabled:  true,
  trailLength:   10,
  shipsEnabled:      false,
  hideGroundUnits:   false,
  braColor:      '#4488cc',
  hdgCorrection: 0, // manual true->grid heading fudge factor — NOT real-world magnetic variation, see geo.js
  radarDebug:    false,
  textMarksEnabled: false, // DCS mission-editor Text objects, shown as a map layer
  extCenterlineNm: 25, // extended APP-radar centerline length
  scale:         1.0,
  lightMode:     false,
  showElevation: false, // computed contour lines + height labels (elevation.js), zoom-independent
  fadeGraceMs:    10000, // ms at full brightness after last sweep before fading starts
  navDeclutter:    true,  // hide navpoints whose names contain digits
  navDeclutter5:   true,  // hide navpoints whose names are not exactly 5 letters
  trailIntervalMs: 5000, // minimum ms between trail dot recordings
  declutter:       true,  // auto-hide labels for sequential-squawk formation flights
  showDatalinkLocks: true, // draw the datalink's radar-lock lines (geojson.js's buildDatalinkLines)
  transitionAltFt: 18000, // ft — how an ASSIGNED altitude is written; a contact's own comes from crc-sync
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

let settings = { ...DEFAULTS };

function loadSettings() {
  try {
    const raw = localStorage.getItem('crc-desktop-settings');
    if (raw) settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {}
}

function saveSettings() {
  localStorage.setItem('crc-desktop-settings', JSON.stringify(settings));
}

// Effective bullseye positions, combining live mission data with any
// user-configured overrides from the settings panel (per coalition).
function getBullseye() {
  const base = (missionData && missionData.bullseye) || {};
  const ov   = settings.bullseyeOverride || {};
  const pick = (side) => {
    const o = ov[side];
    if (o && o.enabled && o.lat != null && o.lon != null) return { lat: o.lat, lon: o.lon };
    return base[side] || null;
  };
  return { blue: pick('blue'), red: pick('red') };
}

// A contact's altitude is crc-sync's (its src/altimetry.js), and arrives only
// when a sensor could know it (docs/adr/0059). Nothing here computes one.

// `crc-desktop-enabled-radars` in localStorage, and the load/save pair that
// owned it, are gone: coverage is not a per-client preference any more, so
// there is nothing to persist. A leftover key from a previous version is
// harmless and simply never read again.

// ── Scale helpers ─────────────────────────────────────────────────────────

function getScale()         { return settings.scale || 1.0; }
function getTextSizePx()    { return TEXT_SIZE_PX    * getScale(); }
function getLeaderIconGap() { return LEADER_ICON_GAP * getScale(); }
function getLabelHalfW()    { return LABEL_HALF_W    * getScale(); }
function getLabelHalfH()    { return LABEL_HALF_H    * getScale(); }

function applyScale() {
  if (!mapReady) return;
  const s = getScale();
  map.setLayoutProperty('unit-squares',      'icon-size',     s);
  map.setLayoutProperty('unit-emerg-square', 'icon-size',     s);
  map.setLayoutProperty('unit-labels',       'text-size',     getTextSizePx());
  map.setLayoutProperty('navpt-labels',      'text-size',     9 * s);
  map.setPaintProperty('trail-dots',         'circle-radius', 1.5 * s);
  map.setPaintProperty('leader-lines',       'line-width',    0.75 * s);
  map.setPaintProperty('ppl-lines',          'line-width',    s);
  updateMap();
}

// ── History management ────────────────────────────────────────────────────

function pushHistory(id, track) {
  if (!history.has(id)) history.set(id, []);
  const h        = history.get(id);
  const minGapMs = settings.trailIntervalMs ?? 5000;
  const now      = Date.now();
  // Drop the new point if the last stored dot is too recent
  if (h.length > 0 && now - h[h.length - 1].timestamp < minGapMs) return;
  h.push({ lat: track.lat, lon: track.lon, altFt: track.altitude ? track.altitude.ft : null, timestamp: now });
  const max = settings.trailLength ?? HISTORY_MAX;
  if (h.length > max) h.splice(0, h.length - max);
}

// ── The picture, as delivered ─────────────────────────────────────────────
//
// Everything that used to live here is crc-sync's now: the radar list derived
// from mission data, the 50ms rotating-beam sweep, the ±4° beam test and the
// terrain call all moved into its src/radars.js, src/coverage.js and
// src/terrain.js (its docs/adr/0042). Two bugs went with them. The sweep
// sampled a ~22ms beam dwell on a 50ms tick and silently missed contacts
// depending on where the tick landed; and every client ran its beams at its
// own phase, so no two controllers ever saw quite the same picture — which is
// what made a shared "this Strip is that contact" record impossible.
//
// What stays here is the part that was always a display concern: how a contact
// fades once its beam has passed, and when it finally goes.

setInterval(() => {
  const now = Date.now();
  let changed = false;

  // Zero-speed-airborne detection: a contact that stops dead in the air is
  // almost always a despawn DCS has not reported, so it ages out even while
  // the beam keeps finding it.
  for (const [id, t] of tracks) {
    if (t.domain !== 'AIR') { zeroSpeedSinceMs.delete(id); continue; }
    if (t.onGround) { zeroSpeedSinceMs.delete(id); continue; }
    const { speedKt } = kinematics(history.get(id) || []);
    if (speedKt < 1) {
      if (!zeroSpeedSinceMs.has(id)) zeroSpeedSinceMs.set(id, now);
    } else {
      zeroSpeedSinceMs.delete(id);
    }
  }

  // Remove fully-faded contacts.
  const totalTrackLifeMs = FADE_DURATION_MS + (settings.fadeGraceMs ?? 10000);
  for (const [id] of tracks) {
    const sinceLastSweep = now - (lastSweepMs.get(id) || 0);
    const zeroSince      = zeroSpeedSinceMs.get(id);
    const sinceZeroSpeed = zeroSince ? now - zeroSince : 0;
    if (sinceLastSweep > totalTrackLifeMs || sinceZeroSpeed > totalTrackLifeMs) {
      tracks.delete(id);
      zeroSpeedSinceMs.delete(id);
      history.delete(id);
      labelOffsets.delete(id);
      if (id === selectedRef) selectedRef = null;
      changed = true;
    }
  }

  if (changed) {
    lastUpdateMs = now;
    updateMap();
  }

  // The debug beam overlay draws from the radar geometry in the coverage
  // message, which carries the server's own sweep phase — so the beam it
  // draws is where the beam actually is.
  if (settings.radarDebug && mapReady) {
    map.getSource('radar-debug').setData(buildRadarDebug(coverageRadars));
  }
}, FADE_TICK_MS);

// ── Track state ───────────────────────────────────────────────────────────

// Clears the displayed picture. `latestFromServer` is NOT cleared here: it
// holds everything in this controller's coverage, and a fade reset is not a
// statement about what they are entitled to see.
function resetDisplayedTracks() {
  tracks.clear();
  lastSweepMs.clear();
  zeroSpeedSinceMs.clear();
  history.clear();
  labelOffsets.clear();
  selectedRef = null;
  updateMap();
}

/**
 * A full picture from the server. Arrives at connect and again whenever
 * coverage changes — taking or handing back a Position releases radars, and
 * every contact only those radars could see has to go with them, which a
 * snapshot says without any chance of getting the diff wrong.
 */
function applySnapshot(trackList) {
  latestFromServer.clear();
  resetDisplayedTracks();
  for (const t of trackList) {
    latestFromServer.set(t.id, t);
    _receiveIllumination(t);
  }
  lastUpdateMs = Date.now();
  updateMap();
  refreshRadarPanelData();
}

/**
 * Takes a delivered contact into the displayed picture if its beam has just
 * passed over it. `illuminatedAt` is the server's instant, not ours, which is
 * what keeps two controllers' fades in step.
 */
function _receiveIllumination(t) {
  const at = t.illuminatedAt;
  if (!Number.isFinite(at)) return false;
  const previous = lastSweepMs.get(t.id) || 0;
  if (at <= previous) return false;
  tracks.set(t.id, t);
  lastSweepMs.set(t.id, at);
  // Same 1s floor the local sweep used, so a fast-scanning radar does not
  // fill the trail with near-identical dots.
  if (at - previous > 1000) pushHistory(t.id, t);
  return true;
}

/**
 * A `delta`: contacts newly returned by this controller's sensors, contacts
 * whose identity changed (`relabeled` — their flight, tag or IFF; no new
 * position, so they are not a radar return), and contacts that left.
 */
function applyDelta(updated, relabeled, gone) {
  let changed = false;

  for (const id of gone || []) {
    latestFromServer.delete(id);
    // The displayed contact stays in `tracks` and fades out from its last
    // illumination — a contact leaving coverage should decay off the scope,
    // not vanish mid-sweep.
  }

  for (const t of updated || []) {
    latestFromServer.set(t.id, t);
    if (_receiveIllumination(t)) changed = true;
  }

  // Who a contact is lands at once, on both the delivered and the displayed
  // copy: it is shared state, not something a beam has to reveal.
  for (const r of relabeled || []) {
    for (const copy of [latestFromServer.get(r.id), tracks.get(r.id)]) {
      if (!copy) continue;
      copy.iffState = r.iffState;
      copy.iffOverride = r.iffOverride;
      copy.label = r.label;
      copy.type = r.type;
      changed = true;
    }
  }

  if (changed) { lastUpdateMs = Date.now(); updateMap(); }
}

/**
 * A `coverage` message: which radars the Positions this controller holds let
 * them look through (crc-sync's docs/adr/0042). Not a selection — there is
 * nothing to toggle, and an empty list is the correct answer for a Ground or
 * Clearance Delivery controller rather than a fault.
 */
function applyCoverage(msg) {
  coverageRadars = msg.radars || [];
  coverageHeldPositions = msg.heldPositions || [];
  coverageDatalink = !!msg.datalink;

  // The datalink is a picture too (crc-sync's docs/adr/0059): a tactical
  // controller whose AWACS is still on the ground sees their own aircraft.
  const nowNoRadars = coverageRadars.length === 0 && !coverageDatalink;
  if (nowNoRadars !== noRadarsActive) { noRadarsActive = nowNoRadars; updateNoAwacsUI(); }

  refreshRadarPanelData();
  updateRadarBadge();
  updateZoomLimits();
  // Taking Tower or Approach is what opens the Airport panel now — see
  // dock.js's notifyCoverageChanged.
  if (typeof notifyCoverageChanged === 'function') notifyCoverageChanged();
  updateMap();
}

// ── Zoom + pan limits ─────────────────────────────────────────────────────
// Computes the bounding rectangle of all active radar coverage areas (each
// radar treated as a square), then enforces that rectangle as the map bounds
// and sets minZoom so the full coverage area is always visible.
function updateZoomLimits() {
  if (!mapReady) return;
  const radars = getActiveRadars();

  if (radars.length === 0) {
    map.setMaxBounds(null);
    map.setMinZoom(2);
    return;
  }

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  for (const r of radars) {
    const latDeg = r.rangeM / 111320;
    const lonDeg = r.rangeM / (111320 * Math.cos(r.lat * Math.PI / 180)) * 1.5;
    minLat = Math.min(minLat, r.lat - latDeg);
    maxLat = Math.max(maxLat, r.lat + latDeg);
    minLon = Math.min(minLon, r.lon - lonDeg);
    maxLon = Math.max(maxLon, r.lon + lonDeg);
  }

  // Aggressive: pad only 3% so the view is tightly constrained
  const padLat = (maxLat - minLat) * 0.03;
  const padLon = (maxLon - minLon) * 0.03;

  map.setMaxBounds([
    [minLon - padLon, minLat - padLat],
    [maxLon + padLon, maxLat + padLat],
  ]);

  // minZoom: just enough to see the full coverage rect at screen size
  const spanDeg = Math.max(maxLat - minLat, (maxLon - minLon) * 0.65);
  const minZoom = spanDeg > 12 ? 4 : spanDeg > 5 ? 5 : spanDeg > 2 ? 6 : 7;
  map.setMinZoom(minZoom);
}

// ── WebSocket ─────────────────────────────────────────────────────────────

function normaliseTrack(t) {
  return t.id === String(t.id) ? t : { ...t, id: String(t.id) };
}

async function connect() {
  // crc-sync is a required dependency (no offline/solo mode) — getSyncFeedUrl
  // returns null and shows a login gate if we're not authenticated yet; the
  // existing reconnect timer below just keeps retrying until login completes.
  const url = await getSyncFeedUrl();
  if (!url) { setTimeout(connect, 2000); return; }

  const ws = new WebSocket(url);
  _ws = ws;
  _setSyncSocket(ws);

  ws.onopen = () => console.log('[ws] connected to crc-sync');

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }

    switch (msg.type) {
      case 'weather':
        weather = { pressurePa: msg.pressurePa, tempK: msg.tempK };
        break;
      case 'game-time':
        updateGameTime(msg);
        break;
      case 'status':
        grpcStatus = msg.grpc;
        srsStatus  = msg.srs;
        updateStatusUI();
        updateMap();
        break;
      case 'init': {
        // Clear per-track overrides when a new mission is loaded (IDs are recycled between missions).
        // On reconnect to the same running mission the missionId is unchanged, so we don't clear.
        const prevMissionId = localStorage.getItem('crc-desktop-mission-id');
        if (msg.missionId && msg.missionId !== prevMissionId) {
          localStorage.setItem('crc-desktop-mission-id', msg.missionId);
        }
        missionData = msg;
        if (mapReady) {
          map.getSource('airports').setData(buildAirports());
          map.getSource('bullseye').setData(buildBullseye());
          map.getSource('navpoints').setData(buildNavpoints());
          map.getSource('drawings').setData(buildDrawings());
          map.getSource('text-marks').setData(buildTextMarks());
        }
        // The airfields changed, so the coverage list the server resolves for
        // us will too — it sends a fresh `coverage` message of its own right
        // after this. Redraw what we have in the meantime.
        refreshRadarPanelData();
        updateRadarBadge();
        // Refresh APRT panel airport list if panel is open
        refreshAprtAptList();
        break;
      }
      case 'theater-settings':
        // Squadron-wide config (crc-sync/src/theater-settings.js) — pushed
        // on connect and whenever any
        // client edits transition alt / hdg correction
        // from the Airport panel, authoritative over this client's cache.
        settings.transitionAltFt = msg.transitionAltFt;
        settings.hdgCorrection   = msg.hdgCorrection;
        saveSettings();
        updateMap();
        if (typeof _updateAprtRefCard === 'function') _updateAprtRefCard();
        if (typeof refreshAprtTheaterInputs === 'function') refreshAprtTheaterInputs();
        break;
      case 'atis':
        // Live "who's transmitting ATIS on which frequency" list — pushed
        // on connect, on every /api/atis-transmit start/stop, and on a
        // periodic tick so a crashed client's entry still clears for
        // everyone once it goes stale (see crc-sync's AtisStore.getActive()).
        atisActive = msg.active || [];
        if (typeof _updateAprtRefCard === 'function') _updateAprtRefCard();
        break;
      case 'apt-config':
        // Squadron-wide config (crc-sync/src/apt-config.js): per-airport
        // saved ATIS freq/runway/info-letter/manual-wx, same deal as
        // 'squawk-map' — pushed on connect and whenever any client edits an
        // airport's setup from the Airport panel, authoritative over this
        // client's cache, so every controller sees the same runway/freq/wx
        // for a given airport instead of only whoever last edited it.
        settings.aprtAtisFreq = {};
        settings.aprtAtisRwy  = {};
        settings.aprtAtisInfo = {};
        settings.aprtManualWx = {};
        for (const [key, entry] of Object.entries(msg.airports || {})) {
          settings.aprtAtisFreq[key] = entry.freq || '';
          settings.aprtAtisRwy[key]  = entry.rwy  || '';
          settings.aprtAtisInfo[key] = entry.info || '';
          settings.aprtManualWx[key] = entry.manualWx || { vis: '', clouds: [] };
        }
        saveSettings();
        if (typeof refreshAprtSelectedApt === 'function') refreshAprtSelectedApt();
        break;
      // Which radars our held Positions let us look through. Arrives before
      // the first snapshot and again whenever the held set changes — see
      // applyCoverage and crc-sync's docs/adr/0042.
      case 'coverage':
        applyCoverage(msg);
        break;
      case 'snapshot':
        applySnapshot((msg.tracks || []).map(normaliseTrack));
        break;
      case 'delta':
        applyDelta(
          (msg.updated   || []).map(normaliseTrack),
          (msg.relabeled || []).map(normaliseTrack),
          (msg.gone      || []).map(id => String(id)),
        );
        break;
      // EFSP — sent once at connect (efsp-snapshot) plus immediately on
      // every accepted Mutation (efsp-board-delta), not on this file's own
      // 500ms track/delta rhythm (see crc-sync's docs/adr/0004-immediate-
      // board-broadcast.md — the guide's <200ms remote-change budget).
      case 'efsp-snapshot':
        applyEfspSnapshot(msg);
        if (typeof refreshEfspPanel === 'function') refreshEfspPanel();
        // §9.10's route table is fetched over HTTP, not carried on the
        // snapshot — but a snapshot is the one event that means crc-sync may
        // have restarted, which is also the only way the table can change.
        // See efsp-panel.js's _loadStereoRoutes for the bug this closes.
        if (typeof reloadEfspStereoRoutes === 'function') reloadEfspStereoRoutes();
        // MARSA relations come back with the snapshot too, so the selected
        // Strip's participant highlight has to be re-resolved before the
        // re-render below — same reason the correlation ring is, a few lines
        // down. Resolved first, rendered second: the highlight is a class each
        // Strip reads while being built.
        if (typeof refreshMarsaHighlight === 'function') refreshMarsaHighlight();
        if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
        // A reconnect brings correlations back with the rest of the snapshot,
        // so a Strip that was selected before the drop needs its ring redrawn
        // — otherwise it stays absent until the next reconcile delta happens
        // to touch that flight, which could be a while on a quiet board.
        if (typeof refreshCorrelatedHighlight === 'function') refreshCorrelatedHighlight();
        updateMap();
        if (typeof renderAirspacePanel === 'function') renderAirspacePanel();
        // §5.6.3 — replay every still-pending Mutation against this fresh
        // baseline. A no-op on the very first connect (nothing pending
        // yet); on a RECONNECT this is what stops a Mutation in flight at
        // the moment of disconnect from being silently lost forever (its
        // ack could never otherwise arrive on the dead connection —
        // defect D6, "the worst failure mode in the system").
        if (typeof replayPendingEfspMutations === 'function') {
          replayPendingEfspMutations((orphaned) => {
            if (typeof notifyEfspOrphanedMutation === 'function') notifyEfspOrphanedMutation(orphaned);
          });
        }
        break;
      case 'efsp-board-delta': {
        // Where the changed Strips sat BEFORE this delta, so the panel can
        // tell a Strip that just arrived in one of this controller's Bays
        // from one that merely changed (efsp-arrivals.js, docs/adr/0057).
        const placementBefore = typeof captureEfspPlacement === 'function' ? captureEfspPlacement(msg, getEfspStrip) : null;
        applyEfspDelta(msg);
        if (placementBefore && typeof noteEfspBoardArrivals === 'function') noteEfspBoardArrivals(msg, placementBefore);
        if (typeof refreshEfspPanel === 'function') refreshEfspPanel();
        if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
        break;
      }
      // Sent every 500ms unconditionally (ws-hub.js's _tick) — the genuine
      // periodic signal a staleness check needs, since "no message" on a
      // quiet Board is not itself evidence the connection died (guide §5.6
      // rule 5). See efsp-panel.js's staleness interval.
      case 'efsp-heartbeat':
        if (typeof noteEfspHeartbeat === 'function') noteEfspHeartbeat();
        break;
      case 'efsp-mutation-ack': {
        // This controller's own move can land here BEFORE the board delta that
        // also carries it, and by then the Strip already sits in its new Bay —
        // so arrivals are noted from the ack too (docs/adr/0057). Whichever of
        // the two comes second sees no Bay change and adds nothing.
        const ackAsDelta = { strips: { updated: msg.strip ? [msg.strip] : [] } };
        const ackPlacementBefore = typeof captureEfspPlacement === 'function' ? captureEfspPlacement(ackAsDelta, getEfspStrip) : null;
        const result = applyEfspMutationAck(msg);
        if (ackPlacementBefore && typeof noteEfspBoardArrivals === 'function') {
          noteEfspBoardArrivals(ackAsDelta, ackPlacementBefore);
          if (typeof refreshEfspPanel === 'function') refreshEfspPanel(); // the tab counts and arrivals line
        }
        if (!result.ok) console.warn('[efsp] Mutation rejected:', result.reason, msg);
        if (typeof notifyEfspMutationAck === 'function') notifyEfspMutationAck(msg.clientMutationId, result);
        if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
        break;
      }
      case 'efsp-positions-ack':
        console.warn('[efsp] efsp-positions-ack received, held =', msg.held, 'warnings =', msg.warnings);
        if (typeof renderPositionControls === 'function') renderPositionControls();
        if (typeof renderPositionWarnings === 'function') renderPositionWarnings(msg.warnings);
        if (typeof refreshEfspPanel === 'function') refreshEfspPanel();
        break;
      // The RANGE slice — an airspace is not a Strip and rides no Board's
      // seq, so it gets its own delta rather than a section of
      // efsp-board-delta.
      // WP5 (crc-sync's docs/adr/0045) — changed correlation records, once
      // per server reconcile tick. updateMap() matters as much as the
      // re-render: a re-bind has to move the ring on the scope, not just the
      // badge on the Strip.
      case 'efsp-correlation-delta':
        applyEfspCorrelationDelta(msg);
        if (typeof refreshCorrelatedHighlight === 'function') refreshCorrelatedHighlight();
        renderAllOpenEfspBays();
        refreshEfspPanel();
        updateMap();
        break;
      case 'efsp-correlation-ack':
        // _showMutationError's signature is (reason, detail, context) — this
        // passed the whole message object as `reason` and rendered
        // "[object Object]" for every refused bind (docs/ui-findings F-103).
        // A correlation op registers nothing pending (efsp-ws.js: the §5.6.3
        // replay machinery is keyed on Strip identity), so the flight can only
        // be named from whatever record the ack carries back.
        if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, msg.correlation ? { fdrId: msg.correlation.fdrId } : null);
        applyEfspCorrelationDelta({ correlations: { updated: msg.correlation ? [msg.correlation] : [] } });
        if (typeof refreshCorrelatedHighlight === 'function') refreshCorrelatedHighlight();
        renderAllOpenEfspBays();
        updateMap();
        break;
      // WP6 (crc-sync's docs/adr/0051), guide §9.2. Its own delta type with its
      // own seq, like the airspace and correlation deltas — a relation is not a
      // Strip and rides no Board's sequence.
      //
      // A delta lands for two reasons: somebody acted on a relation, or a
      // clearance voided one. The second arrives ALONGSIDE an efsp-board-delta
      // in the same round trip, which is why this case does a full re-render
      // rather than trusting the board delta to have done one — the two
      // messages are independent and either may arrive first.
      case 'efsp-marsa-delta':
        if (typeof applyEfspMarsaDelta === 'function') applyEfspMarsaDelta(msg);
        if (typeof refreshMarsaHighlight === 'function') refreshMarsaHighlight();
        renderAllOpenEfspBays();
        break;
      case 'efsp-marsa-ack':
        // Same one-argument bug as efsp-correlation-ack above, same fix. A
        // relation is named by its participants, not by one Strip — §9.2's
        // "model it as an edge, not a flag" applies to the refusal too.
        if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, msg.marsa ? { fdrIds: msg.marsa.participants } : null);
        if (typeof applyEfspMarsaDelta === 'function') {
          applyEfspMarsaDelta({ marsa: { updated: msg.marsa ? [msg.marsa] : [] } });
        }
        if (typeof refreshMarsaHighlight === 'function') refreshMarsaHighlight();
        renderAllOpenEfspBays();
        break;
      case 'efsp-airspace-delta':
        if (typeof applyEfspAirspaceDelta === 'function') applyEfspAirspaceDelta(msg);
        if (typeof renderAirspacePanel === 'function') renderAirspacePanel();
        break;
      case 'efsp-airspace-ack':
        if (!msg.ok) {
          console.warn('[efsp] airspace op rejected:', msg.reason, msg);
          // An airspace op targets no Strip, so it is named by the block it
          // was about rather than by a callsign (F-103's attribution rule,
          // applied to the thing that actually was refused).
          if (typeof _showMutationError === 'function') {
            _showMutationError(msg.reason || 'Rejected', msg.detail,
              msg.airspace ? { subject: (msg.airspace.definition && msg.airspace.definition.name) || msg.airspace.airspaceId } : null);
          }
        } else if (msg.warning === 'AIRSPACE_STILL_OCCUPIED') {
          // Released with flights still in it. Allowed — the controller may
          // know they are clear — but they are on the block's frequency and
          // the panel now treats them as being in airspace nobody holds.
          if (typeof _showMutationWarning === 'function') {
            _showMutationWarning(`Released with ${msg.occupied} flight${msg.occupied === 1 ? '' : 's'} still in the block`);
          }
        }
        if (typeof renderAirspacePanel === 'function') renderAirspacePanel();
        break;
      // docs/adr/0058 — the whole conformance + short-term conflict picture,
      // and (docs/adr/0067) every forwarding obligation due right now, sent
      // when it changes and once on connect; one no longer listed is cleared.
      case 'efsp-alerts':
        if (typeof applyEfspAlerts === 'function') applyEfspAlerts(msg);
        if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
        updateMap();
        if (typeof updateTrackPanel === 'function') updateTrackPanel();
        break;
    }
  };

  ws.onclose = () => {
    if (_ws === ws) { _ws = null; _setSyncSocket(null); }
    grpcStatus = 'disconnected';
    srsStatus  = 'disconnected';
    updateStatusUI();
    updateMap();
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

// ── Periodic maintenance ──────────────────────────────────────────────────

setInterval(() => {
  checkStale();
  if (grpcStatus !== 'connected') updateMap();
}, 500);

setInterval(() => {
  _pulseBright = !_pulseBright;
  let hasIdent = false, hasEmerg = false;
  for (const t of tracks.values()) {
    if (trackIsIdent(t))   hasIdent = true;
    if (trackEmergency(t)) hasEmerg = true;
    if (hasIdent && hasEmerg) break;
  }
  if (hasIdent || hasEmerg) updateMap();
  if (mapReady) {
    map.setPaintProperty('unit-emerg-square', 'icon-opacity', _pulseBright ? 0.95 : 0.12);
  }
}, 500);

// ── Boot ──────────────────────────────────────────────────────────────────

loadSettings();
loadUserCoalition();
loadStaticData();
// Settings is now a lazily-mounted dockable panel (see dock.js) — it may
// never mount if the user never opens it, but the light/dark theme it
// controls is app-wide and must apply unconditionally at boot.
applyLightMode();
initDock();
initUpdateStatus();
initAptSelector();
initRwyInput();
initCoalitionBtn();
initZuluClock();
updateTopbarUI();
connect();

function initCoalitionBtn() {
  const $btn = document.getElementById('btn-coalition');
  if (!$btn) return;
  _updateCoalitionBtn($btn);
  $btn.addEventListener('click', () => {
    toggleUserCoalition();
    _updateCoalitionBtn($btn);
    updateMap();
  });
}

function _updateCoalitionBtn($btn) {
  const blue = getUserCoalition() === 3;
  $btn.textContent = blue ? 'BLUE' : 'RED';
  $btn.classList.toggle('coalition-red', !blue);
}
