'use strict';
import { _setSyncSocket, getSyncFeedUrl, _syncAuthHeaders } from './sync.js';
import { loadTerrainGrid } from './terrain-grid.js';
import { noteCoveragePositions, redeclareEfspPositions } from './panels/efsp/efsp-ws.js';
import { UPDATE_REQUIRED_CLOSE, hideUpdateRequired, isUpdateRequiredShown, showUpdateRequired } from './update-required.js';
import { kinematics } from './geo.js';
import { settings, saveSettings, loadSettings } from './settings.js';
import { map, mapReady, updateZoomLimits } from './map-handle.js';
import { FADE_DURATION_MS, HISTORY_MAX } from './scope-constants.js';
import {
  coverageDatalink, coverageRadars, coverageSignedOnPositions, history, labelOffsets, lastSweepMs, latestFromServer,
  setAircraftTypes, setAtisActive, setCoverage, setMissionData, tracks, zeroSpeedSinceMs
} from './picture.js';
import {
  _pulseBright, grpcStatus, noRadarsActive, selectedRef, setGrpcStatus, setLastUpdateMs, setNoRadarsActive, setPulseBright,
  setSelectedRef, setSrsStatus
} from './view-state.js';
import { refreshAirspaceLayers } from './airspace-layer.js';
import { applyTheaterFacts } from './magnetic.js';
import { getUserCoalition, loadUserCoalition, toggleUserCoalition } from './iff.js';
import { trackEmergency, trackIsIdent } from './track-label.js';
import {
  buildAirports, buildBullseye, buildDrawings, buildNavpoints, buildRadarDebug, buildTextMarks, updateMap
} from './geojson.js';
import { initDock, notifyCoverageChanged } from './dock.js';
import { checkStale, initUpdateStatus, initZuluClock, updateNoAwacsUI, updateStatusUI, updateTopbarUI } from './panels/topbar.js';
import { updateGameTime } from './mission-clock.js';
import { applyLightMode } from './panels/settings-panel.js';
import {
  refreshRadarPanelData, updateRadarBadge
} from './panels/radar-panel.js';
import { initAptSelector, initRwyInput, resolveApproachCourse } from './panels/airport-selector.js';
import {
  _updateAprtRefCard, _updateAprtRwyHeading, refreshAprtAptList, refreshAprtSelectedApt, refreshAprtTheaterFacts
} from './panels/aprt-panel.js';
import { dispatchEfspMessage } from './panels/efsp/efsp-message-registry.js';
import './panels/efsp/efsp-messages.js';

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

// The picture, the map handle, the settings and the small view state live in leaf modules (picture.js, map-handle.js,
// settings.js, view-state.js); this module writes them from the socket.
export let _ws              = null;
let airportsDb    = {};
let weather          = { pressurePa: 101325, tempK: 288.15 }; // ISA defaults until server sends live data

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
    setAircraftTypes(at);
    airportsDb    = ap;
    console.log(`[crc] loaded ${Object.keys(at).length} aircraft types, ${Object.keys(airportsDb).length} airports`);
  } catch (e) {
    console.warn('[crc-desktop] failed to load static data:', e);
  }
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

// ESM-1 (S-ESM1b): ran at script load; startApp() now calls it, so importing app.js starts nothing.
function _startTrackFadeBeat() {
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
      if (id === selectedRef) setSelectedRef(null);
      changed = true;
    }
  }

  if (changed) {
    setLastUpdateMs(now);
    updateMap();
  }

  // The debug beam overlay draws from the radar geometry in the coverage
  // message, which carries the server's own sweep phase — so the beam it
  // draws is where the beam actually is.
  if (settings.radarDebug && mapReady) {
    map.getSource('radar-debug').setData(buildRadarDebug(coverageRadars));
  }
}, FADE_TICK_MS);
}

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
  setSelectedRef(null);
  updateMap();
}

/**
 * A full picture from the server. Arrives at connect and again whenever
 * coverage changes — taking or handing back a Position releases radars, and
 * every contact only those radars could see has to go with them, which a
 * snapshot says without any chance of getting the diff wrong.
 */
export function applySnapshot(trackList) {
  latestFromServer.clear();
  resetDisplayedTracks();
  for (const t of trackList) {
    latestFromServer.set(t.id, t);
    _receiveIllumination(t);
  }
  setLastUpdateMs(Date.now());
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

  if (changed) { setLastUpdateMs(Date.now()); updateMap(); }
}

/**
 * A `coverage` message: which radars the Positions this controller holds let
 * them look through (crc-sync's docs/adr/0042). Not a selection — there is
 * nothing to toggle, and an empty list is the correct answer for a Ground or
 * Clearance Delivery controller rather than a fault.
 */
export function applyCoverage(msg) {
  setCoverage(msg.radars || [], msg.signedOnPositions || [], !!msg.datalink);
  noteCoveragePositions(coverageSignedOnPositions); // Primary or Observer, per Position

  // The datalink is a picture too (crc-sync's docs/adr/0059): a tactical
  // controller whose AWACS is still on the ground sees their own aircraft.
  const nowNoRadars = coverageRadars.length === 0 && !coverageDatalink;
  if (nowNoRadars !== noRadarsActive) { setNoRadarsActive(nowNoRadars); updateNoAwacsUI(); }

  refreshRadarPanelData();
  updateRadarBadge();
  updateZoomLimits();
  // Taking Tower or Approach is what opens the Airport panel now — see
  // dock.js's notifyCoverageChanged.
  notifyCoverageChanged();
  updateMap();
}

// ── WebSocket ─────────────────────────────────────────────────────────────

function normaliseTrack(t) {
  return t.id === String(t.id) ? t : { ...t, id: String(t.id) };
}

// crc-sync refused this client's wire protocol (docs/adr/0103): stop reconnecting until the overlay's Retry.
let _updateRequired = false;
function retryAfterUpdateRequired() { _updateRequired = false; connect(); }

async function connect() {
  if (_updateRequired) return;
  // crc-sync is a required dependency (no offline/solo mode) — getSyncFeedUrl
  // returns null and shows a login gate if we're not authenticated yet; the
  // existing reconnect timer below just keeps retrying until login completes.
  const url = await getSyncFeedUrl();
  if (!url) { setTimeout(connect, 2000); return; }

  const ws = new WebSocket(url);
  _ws = ws;
  _setSyncSocket(ws);

  // No resync on reconnect (R3-47): the server sends a full snapshot on every connect,
  // which is the recovery. Resync is for a Board epoch change and a missed delta only.
  ws.onopen = () => {
    hideUpdateRequired();
    console.log('[ws] connected to crc-sync');
    redeclareEfspPositions(); // the server signs a closed session off after its grace: say again what we hold
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg.type === 'update-required') { _updateRequired = true; showUpdateRequired(msg, { onRetry: retryAfterUpdateRequired }); return; }
    onSyncMessage(msg);
  };

  const onSyncMessage = (msg) => {
    switch (msg.type) {
      case 'weather':
        weather = { pressurePa: msg.pressurePa, tempK: msg.tempK };
        break;
      case 'game-time':
        updateGameTime(msg);
        break;
      case 'status':
        setGrpcStatus(msg.grpc);
        setSrsStatus(msg.srs);
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
        setMissionData(msg);
        if (mapReady) {
          map.getSource('airports').setData(buildAirports());
          map.getSource('bullseye').setData(buildBullseye());
          map.getSource('navpoints').setData(buildNavpoints());
          map.getSource('drawings').setData(buildDrawings());
          map.getSource('text-marks').setData(buildTextMarks());
          refreshAirspaceLayers();
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
      case 'theater':
        // The map's fixed facts (crc-sync's theater-context.js, docs/adr/
        // 0085): transition altitude and the magnetic variation grid every
        // displayed bearing goes through. On connect, mission load and a new
        // mission day. A typed magnetic value was converted with the old
        // model, so both runway entries are converted again.
        applyTheaterFacts(msg);
        // The theater's DCS height grid, for the contours and the radar-debug LOS (crc-sync docs/adr/0133).
        loadTerrainGrid(msg.theatre || null, _syncAuthHeaders());
        settings.transitionAltFt = msg.transitionAltFt;
        resolveApproachCourse();
        _updateAprtRwyHeading();
        updateMap();
        _updateAprtRefCard();
        refreshAprtTheaterFacts();
        break;
      case 'atis':
        // Live "who's transmitting ATIS on which frequency" list — pushed
        // on connect, on every /api/atis-transmit start/stop, and on a
        // periodic tick so a crashed client's entry still clears for
        // everyone once it goes stale (see crc-sync's AtisStore.getActive()).
        setAtisActive(msg.active || []);
        _updateAprtRefCard();
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
        refreshAprtSelectedApt();
        break;
      // Which radars the Positions we are signed on to let us look through. Arrives before
      // the first snapshot and again whenever the signed-on set changes — see
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
      // Every EFSP message type: registered by its family's module (panels/efsp/efsp-messages.js and the
      // panel modules), routed by type; an unknown one is ignored.
      default:
        dispatchEfspMessage(msg);
        break;
    }
  };

  ws.onclose = (event) => {
    if (_ws === ws) { _ws = null; _setSyncSocket(null); }
    setGrpcStatus('disconnected');
    setSrsStatus('disconnected');
    updateStatusUI();
    updateMap();
    if (event && event.code === UPDATE_REQUIRED_CLOSE) {
      // Normally the frame arrived first; if only the close did, still show the overlay (server protocol unknown).
      _updateRequired = true;
      if (!isUpdateRequiredShown()) showUpdateRequired({}, { onRetry: retryAfterUpdateRequired });
    }
    if (_updateRequired) return;
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

// ── Periodic maintenance ──────────────────────────────────────────────────

// ESM-1 (S-ESM1b): ran at script load; startApp() now calls it, so importing app.js starts nothing.
function _startMaintenanceBeats() {
setInterval(() => {
  checkStale();
  if (grpcStatus !== 'connected') updateMap();
}, 500);

setInterval(() => {
  setPulseBright(!_pulseBright);
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
}

// ── Boot ──────────────────────────────────────────────────────────────────

// ESM-1: the boot sequence ran at script-execution time, after every earlier script. A module is evaluated in
// dependency order instead, so main.js calls this once every module has been evaluated (S-ESM1a).
export function startApp() {
_startTrackFadeBeat();
_startMaintenanceBeats();
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
}

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
