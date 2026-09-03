'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

const COALITION_COLOR       = { 1: '#888888', 2: '#cc4444', 3: '#4488cc' };
const LIGHT_COALITION_COLOR = { 1: '#505050', 2: '#cc0000', 3: '#004499' }; // higher contrast on light map
const GROUND_COLOR          = { 1: '#7a7a68', 2: '#aa6644', 3: '#557799' };
const HISTORY_MAX      = 10;
const FADE_DURATION_MS = 10000;
const STALE_MS         = 10000;
const MIN_SPD_KT_PPL   = 30;

const GROUND_RADIUS_M  = 5000;
const GROUND_AGL_M     = 50;

const CRC_RANGE_NM     = 200;
const CRC_RANGE_M      = CRC_RANGE_NM * 1852;

// Default label position and geometry constants (used by geojson.js + map-setup.js)
const TEXT_SIZE_PX      = 11;
const TEXT_OFFSET_EM    = [4.0, -0.5]; // em units [right, up] from icon
const LEADER_ICON_GAP   = 7;
const LABEL_HALF_W      = 30;
const LABEL_HALF_H      = 13;
const LABEL_EDGE_MARGIN = 2;

const SQUAWK_EMERGENCY = { 7700: 'gen', 7600: 'radio', 7500: 'hijack' };
const EMERGENCY_COLOR  = { gen: '#cc2222', radio: '#b8a000', hijack: '#cc6600' };

// Radar sweep
const SWEEP_BEAM_DEG  = 4;   // rotating beam width in degrees
const SWEEP_INTERVAL  = 50;  // ms between sweep ticks

// Assumed antenna/mast height (meters) above field elevation / waterline —
// DCS doesn't report actual radar tower height, so ground-based radars need
// an assumed offset or terrain LOS masking would make them unrealistically
// easy to block (airborne radars use their own live altitude instead).
const AIRPORT_RADAR_HEIGHT_M = 15;
const SHIP_RADAR_HEIGHT_M    = 40;

// ── State ─────────────────────────────────────────────────────────────────

// latestFromServer: all track data as received from server (no filtering).
// tracks: tracks currently visible on scope (illuminated by at least one radar).
// lastSweepMs: when each track was last hit by a radar beam.
const latestFromServer = new Map(); // id → track (raw server data)
const tracks           = new Map(); // id → track (displayed)
window.getAllTracks    = () => [...latestFromServer.values()];
// Un-sweep-gated lookup for UI that should reflect crc-sync's shared state
// immediately (IFF declarations, renames, track numbers) rather than waiting
// for the simulated radar beam to illuminate the track — see ui.js's track
// panel, which uses this for everything except telemetry (alt/hdg/spd/vs),
// which stays sweep-gated on purpose (that IS the radar-realism simulation).
window.getLatestTrack   = (id) => latestFromServer.get(String(id)) || null;
const history          = new Map(); // id → [{lat, lon, alt, timestamp}, ...]
const labelOffsets     = new Map(); // id → [dLat, dLon] relative to track

// Per-radar sweep state
const radarSweepStart  = new Map(); // radarId → sweepStartMs
const noseScanLastMs   = new Map(); // radarId → lastScanMs (nose radars)
const lastSweepMs      = new Map(); // trackId → timestamp of last illumination
const zeroSpeedSinceMs = new Map(); // trackId → timestamp when 0-speed-airborne first detected

// User-assigned labels for ground vehicles (persists across view switches)
const groundLabels = new Map(); // trackId → string

// Datalink radar locks received from server: unitId → { targetLat, targetLon, targetId }
const radarLocks = new Map();

// Static reference data loaded at startup
let aircraftTypes = {};
let airportsDb    = {};

let missionData      = null;
let weather          = { pressurePa: 101325, tempK: 288.15 }; // ISA defaults until server sends live data
let atisActive       = []; // [{ frequency, ownerId }] — who's currently transmitting ATIS where, from crc-sync
let grpcStatus       = 'disconnected';
let noRadarsActive   = false; // true when all radars are disabled / none available
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

// Radar selector — opt-in: only radars in this set are used for tracking.
// Default: all off.  User enables radars from the Panels control (topbar
// button — see dock.js's PANEL_TITLES for its current label).
const enabledRadarIds = new Set();

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
  aiEnabled:         true,
  shipsEnabled:      false,
  hideGroundUnits:   false,
  braColor:      '#4488cc',
  hdgCorrection: 0, // manual true->grid heading fudge factor — NOT real-world magnetic variation, see geo.js
  radarDebug:    false,
  textMarksEnabled: false, // DCS mission-editor Text objects, shown as a map layer
  extCenterlineNm: 25, // extended APP-radar centerline length
  squawkMap:     {},
  squawkSeq:     {}, // sequential ranges: { "1101": "HAT1" } → 1101→HAT11, 1102→HAT12…
  scale:         1.0,
  lightMode:     false,
  showElevation: false, // computed contour lines + height labels (elevation.js), zoom-independent
  fadeGraceMs:    10000, // ms at full brightness after last sweep before fading starts
  navDeclutter:    true,  // hide navpoints whose names contain digits
  navDeclutter5:   true,  // hide navpoints whose names are not exactly 5 letters
  trailIntervalMs: 5000, // minimum ms between trail dot recordings
  declutter:       true,  // auto-hide labels for sequential-squawk formation flights
  datalink:        false, // auto-include all friendly aircraft radars
  transitionAltFt: 18000, // ft — below this use QNH, at/above use standard (FL)
  gameTimeOffset:  0,     // hours — theater UTC offset subtracted to display Zulu
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

// DCS altimeter model (reverse-engineered from flight test data).
// Atmosphere: full ISA piecewise (troposphere + isothermal stratosphere).
// Altimeter inversion: troposphere formula only, with empirical T_REF_ALT.
const ISA_T0 = 288.15, ISA_P0 = 101325, ISA_L = 0.0065;
const ISA_G = 9.80665, ISA_R = 287.05287;
const ISA_EXP = ISA_G / (ISA_R * ISA_L);   // G/(R*L) ≈ 5.2559
const ISA_INV = (ISA_R * ISA_L) / ISA_G;   // R*L/G ≈ 0.19026
const H_TROP = 11000.0;                     // m, tropopause
const T_REF_ALT = 288.97;                   // K, empirical DCS altimeter reference

function _pressureAtAlt(zM, seaPa, T0) {
  if (zM <= H_TROP) {
    return seaPa * Math.pow(1 - ISA_L * zM / T0, ISA_EXP);
  }
  const T_trop = T0 - ISA_L * H_TROP;
  const P_trop = seaPa * Math.pow(1 - ISA_L * H_TROP / T0, ISA_EXP);
  return P_trop * Math.exp(-ISA_G * (zM - H_TROP) / (ISA_R * T_trop));
}

function indicatedAltFt(trueAltM) {
  const { pressurePa, tempK } = weather;
  const trueAltFt = trueAltM / 0.3048;
  const taFt = settings.transitionAltFt ?? 18000;

  const P = _pressureAtAlt(trueAltM, pressurePa, tempK);
  if (trueAltFt >= taFt) {
    // FL: altimeter set to standard pressure (ISA_P0)
    return ((T_REF_ALT / ISA_L) * (1 - Math.pow(P / ISA_P0, ISA_INV))) / 0.3048;
  } else {
    // QNH: altimeter set to live sea-level pressure
    return ((T_REF_ALT / ISA_L) * (1 - Math.pow(P / pressurePa, ISA_INV))) / 0.3048;
  }
}

function loadEnabledRadars() {
  try {
    const raw = localStorage.getItem('crc-desktop-enabled-radars');
    if (raw) JSON.parse(raw).forEach(id => enabledRadarIds.add(id));
  } catch (_) {}
}

function saveEnabledRadars() {
  localStorage.setItem('crc-desktop-enabled-radars', JSON.stringify([...enabledRadarIds]));
}

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
  h.push({ lat: track.lat, lon: track.lon, alt: track.alt, timestamp: now });
  const max = settings.trailLength ?? HISTORY_MAX;
  if (h.length > max) h.splice(0, h.length - max);
}

// ── Radar simulation ──────────────────────────────────────────────────────

const _HELIPAD_RE = /helipad|farp|fob/i;

// Cache for getAllRadars() — valid for one sweep interval (< SWEEP_INTERVAL ms).
// Avoids rebuilding the radar list on every call within the same tick.
let _allRadarsCache   = null;
let _allRadarsCacheMs = 0;

function invalidateRadarsCache() {
  _allRadarsCache = null;
}

// Returns every radar that could potentially be active (regardless of user toggle).
// type: 'airport' | 'approach' | 'awacs' | 'fighter' | 'carrier'
function getAllRadars() {
  const now = Date.now();
  if (_allRadarsCache && now - _allRadarsCacheMs < SWEEP_INTERVAL - 5) return _allRadarsCache;
  _allRadarsCache   = _buildAllRadars();
  _allRadarsCacheMs = now;
  return _allRadarsCache;
}

function _buildAllRadars() {
  const radars   = [];
  const airports = (missionData && missionData.airports) || [];

  for (const apt of airports) {
    if (!apt.lat || !apt.lon) continue;
    if (apt.name === 'H' || _HELIPAD_RE.test(apt.name)) continue;
    const aptLabel = apt.icao || apt.name;

    radars.push({
      id: `apt:${apt.name}`, type: 'airport', label: aptLabel,
      lat: apt.lat, lon: apt.lon, elevM: (apt.elev || 0) + AIRPORT_RADAR_HEIGHT_M,
      rangeM: 40 * 1852, sweepMs: 2000,
      seesGround: true, seesShips: false, noGroundAircraft: false,
      angleFromNose: 360, heading: 0,
    });

    radars.push({
      id: `app:${apt.name}`, type: 'approach', label: aptLabel + ' APP',
      lat: apt.lat, lon: apt.lon, elevM: (apt.elev || 0) + AIRPORT_RADAR_HEIGHT_M,
      rangeM: 80 * 1852, sweepMs: 3000,
      seesGround: false, seesShips: false, noGroundAircraft: true,
      angleFromNose: 360, heading: 0,
    });
  }

  for (const t of latestFromServer.values()) {
    if (t.category !== 1 && t.category !== 2) continue;
    const spec = aircraftTypes[t.type];
    if (!spec || !spec.radar) continue;
    const onGnd = checkOnGround(t);
    // 360° rotating dish → AWACS; forward-looking nose radar → fighter
    const radarType = spec.radar.angleFromNose === 360 ? 'awacs' : 'fighter';
    radars.push({
      id: `crc:${t.id}`, type: radarType, label: resolveCallsign(t),
      sublabel: spec.label || t.type,
      lat: t.lat, lon: t.lon, elevM: t.alt,
      rangeM: spec.radar.rangeNm * 1852, sweepMs: spec.radar.sweepMs,
      seesGround: false, seesShips: true, noGroundAircraft: true,
      angleFromNose: spec.radar.angleFromNose, heading: t.heading || 0,
      onGround: onGnd,
      coalition: t.coalition,
    });
  }

  // Ship radars — all category-4 tracks get a radar entry.
  // Known types (in aircraft-types.json with carrierRadar) use their spec;
  // unknown ship types fall back to a generic 40 nm surface-search radar.
  const SHIP_RADAR_DEFAULT = { rangeNm: 40, sweepMs: 5000 };
  for (const t of latestFromServer.values()) {
    if (t.category !== 4) continue;
    const spec      = aircraftTypes[t.type];
    const radarSpec = (spec && spec.carrierRadar) || SHIP_RADAR_DEFAULT;
    radars.push({
      id: `carrier:${t.id}`, type: 'carrier',
      label:    resolveCallsign(t) || (spec && spec.label) || t.type,
      sublabel: (spec && spec.label) || t.type,
      lat: t.lat, lon: t.lon, elevM: t.alt + SHIP_RADAR_HEIGHT_M,
      rangeM: radarSpec.rangeNm * 1852, sweepMs: radarSpec.sweepMs,
      seesGround: false, seesShips: true, noGroundAircraft: true,
      angleFromNose: 360, heading: 0,
      onGround: false,
    });
    const isCarrier = (t.type && t.type.includes('CVN')) || (spec && spec.label && spec.label.includes('CVN'));
    if (isCarrier) {
      radars.push({
        id: `app:${t.id}`, type: 'carrier',
        label: `${resolveCallsign(t) || (spec && spec.label) || t.type} APP RDR`,
        sublabel: (spec && spec.label) || t.type,
        lat: t.lat, lon: t.lon, elevM: t.alt + 45,
        rangeM: 50 * 1852,
        sweepMs: 4000,
        seesGround: false, seesShips: false, noGroundAircraft: true,
        angleFromNose: 360,
        heading: 0,
        onGround: false,
      });
    }
  }

  return radars;
}

// Returns only the radars the user has explicitly enabled AND that are operational.
// When datalink is active, all friendly airborne aircraft radars are included automatically.
function getActiveRadars() {
  const all    = getAllRadars();
  const active = all.filter(r => enabledRadarIds.has(r.id) && !r.onGround);

  if (!settings.datalink) return active;

  // Datalink: auto-include every friendly coalition aircraft radar not already in the list
  const activeIds = new Set(active.map(r => r.id));
  for (const r of all) {
    if (activeIds.has(r.id)) continue;
    if (r.onGround) continue;
    if (r.type !== 'awacs' && r.type !== 'fighter') continue;
    if (r.coalition !== userCoalition) continue;
    active.push(r);
  }

  return active;
}

// Sweep simulation — runs every SWEEP_INTERVAL ms.
// For 360° radars: rotating beam illuminates each track as the beam passes over it.
// For nose radars: beam oscillates left→right→left within the cone (one pass = sweepMs).
setInterval(() => {
  const now    = Date.now();
  const radars = getActiveRadars();
  let   changed = false;

  // Per-tick on-ground cache: avoids repeating the airport-loop for each radar
  // that tests the same track. Only computed for cat 1/2 (the only ones checked).
  const onGroundCache = new Map();
  for (const [id, t] of latestFromServer) {
    if (t.category === 1 || t.category === 2) onGroundCache.set(id, checkOnGround(t));
  }

  for (const radar of radars) {
    if (radar.angleFromNose === 360) {
      if (!radarSweepStart.has(radar.id)) radarSweepStart.set(radar.id, now);
      const sweepAngle = ((now - radarSweepStart.get(radar.id)) % radar.sweepMs) / radar.sweepMs * 360;

      for (const [id, t] of latestFromServer) {
        if (t.category === 3 && !radar.seesGround) continue;
        if (t.category === 4 && !radar.seesShips) continue;
        const isGroundContact = (t.category === 1 || t.category === 2) && onGroundCache.get(id);
        if (radar.noGroundAircraft && isGroundContact) continue;
        const distM = haversineM(radar.lat, radar.lon, t.lat, t.lon);
        if (distM > radar.rangeM) continue;
        const bearing = bearingDeg(radar.lat, radar.lon, t.lat, t.lon);
        const diff = Math.abs(((bearing - sweepAngle + 540) % 360) - 180);
        if (diff > SWEEP_BEAM_DEG) continue;
        // Real-world DEM terrain masking doesn't apply within an airfield's own
        // footprint: DCS grades airports flat regardless of what the actual
        // terrain there looks like, so a ground contact sitting a few meters
        // from the tower can get spuriously blocked by an unrelated real-world
        // bump the sim doesn't model — see checkOnGround's GROUND_RADIUS_M.
        if (!isGroundContact && losHasLineOfSight(radar.lat, radar.lon, radar.elevM, t.lat, t.lon, t.alt) === false) continue;

        const prevSweep = lastSweepMs.get(id) || 0;
        tracks.set(id, t);
        lastSweepMs.set(id, now);
        if (now - prevSweep > 1000) pushHistory(id, t);
        changed = true;
      }

    } else {
      // Nose radar: oscillating beam sweeps left→right→left
      if (!radarSweepStart.has(radar.id)) radarSweepStart.set(radar.id, now);
      const halfAngle = radar.angleFromNose / 2;
      const cycleMs   = radar.sweepMs * 2;
      const phase     = ((now - radarSweepStart.get(radar.id)) % cycleMs) / cycleMs;
      const tNorm     = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      const beamAngle = (radar.heading - halfAngle + tNorm * radar.angleFromNose + 360) % 360;

      for (const [id, t] of latestFromServer) {
        if (t.category === 3 && !radar.seesGround) continue;
        if (t.category === 4 && !radar.seesShips) continue;
        const isGroundContact = (t.category === 1 || t.category === 2) && onGroundCache.get(id);
        if (radar.noGroundAircraft && isGroundContact) continue;
        const distM = haversineM(radar.lat, radar.lon, t.lat, t.lon);
        if (distM > radar.rangeM) continue;
        const bearing = bearingDeg(radar.lat, radar.lon, t.lat, t.lon);
        const diff = Math.abs(((bearing - beamAngle + 540) % 360) - 180);
        if (diff > SWEEP_BEAM_DEG) continue;
        // See the 360°-sweep branch above for why ground contacts skip real terrain LOS.
        if (!isGroundContact && losHasLineOfSight(radar.lat, radar.lon, radar.elevM, t.lat, t.lon, t.alt) === false) continue;

        const prevSweep = lastSweepMs.get(id) || 0;
        tracks.set(id, t);
        lastSweepMs.set(id, now);
        if (now - prevSweep > 1000) pushHistory(id, t);
        changed = true;
      }
    }
  }

  // "No radars active" overlay
  const newNoRadars = radars.length === 0;
  if (newNoRadars !== noRadarsActive) { noRadarsActive = newNoRadars; updateNoAwacsUI(); }

  // Zero-speed-airborne detection: track when each visible airborne track first hits 0 kt.
  // These tracks are faded out after the normal grace period even if the radar keeps sweeping them.
  for (const [id, t] of tracks) {
    if (t.category === 3 || t.category === 4) { zeroSpeedSinceMs.delete(id); continue; }
    if (onGroundCache.get(id)) { zeroSpeedSinceMs.delete(id); continue; }
    const hist = history.get(id) || [];
    const { speedKt } = kinematics(hist);
    if (speedKt < 1) {
      if (!zeroSpeedSinceMs.has(id)) zeroSpeedSinceMs.set(id, now);
    } else {
      zeroSpeedSinceMs.delete(id);
    }
  }

  // Remove expired (fully faded) tracks
  const totalTrackLifeMs = FADE_DURATION_MS + (settings.fadeGraceMs ?? 10000);
  for (const [id] of tracks) {
    const sinceLastSweep = now - (lastSweepMs.get(id) || 0);
    const zeroSince      = zeroSpeedSinceMs.get(id);
    const sinceZeroSpeed = zeroSince ? now - zeroSince : 0;
    if (sinceLastSweep > totalTrackLifeMs || sinceZeroSpeed > totalTrackLifeMs) {
      tracks.delete(id);
      lastSweepMs.delete(id);
      zeroSpeedSinceMs.delete(id);
      history.delete(id);
      labelOffsets.delete(id);
      if (id === selectedRef) { selectedRef = null; }
      changed = true;
    }
  }

  if (changed) {
    lastUpdateMs = now;
    updateMap();
  }

  // Radar debug overlay update (runs even when no track changed)
  if (settings.radarDebug && mapReady) {
    map.getSource('radar-debug').setData(buildRadarDebug(radars));
  }
}, SWEEP_INTERVAL);

// ── Track state ───────────────────────────────────────────────────────────

// Clear all sweep/display state — called on snapshot reload or view switch.
// latestFromServer is NOT cleared here; it holds raw server data.
function resetSweepState() {
  tracks.clear();
  lastSweepMs.clear();
  zeroSpeedSinceMs.clear();
  history.clear();
  labelOffsets.clear();
  radarSweepStart.clear();
  selectedRef = null;
  updateMap();
}

function applySnapshot(trackList) {
  latestFromServer.clear();
  radarLocks.clear();
  invalidateRadarsCache();
  resetSweepState();
  for (const t of trackList) latestFromServer.set(t.id, t);
  lastUpdateMs = Date.now();
  updateMap();
  // Rebuild panel in case AWACS/carrier tracks changed the available radar list
  refreshRadarPanelData();
}

function applyDelta(updated, gone) {
  for (const id of gone) {
    latestFromServer.delete(id);
    // Displayed track stays in `tracks` and fades out naturally via lastSweepMs
  }
  let metaChanged = false;
  for (const t of updated) {
    latestFromServer.set(t.id, t);
    // Do NOT update position/kinematics here — those only update when the
    // radar beam hits the track. But IFF/callsign/rename/track-number are
    // the controller's own declarations (or a resolution of them), not
    // something a beam needs to "reveal" — refresh them on an
    // already-displayed track immediately so the map icon doesn't sit on
    // stale IFF color/label until the next sweep happens to pass over it.
    const displayed = tracks.get(t.id);
    if (displayed) {
      for (const key of ['iffState', 'iffOverride', 'callsign', 'rename', 'trackNumber']) {
        if (displayed[key] !== t[key]) { displayed[key] = t[key]; metaChanged = true; }
      }
    }
  }
  invalidateRadarsCache();
  if (metaChanged) updateMap();
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
        updateGameTime(msg.datetime);
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
          clearAllIffOverrides();
          clearAllTrackRenames();
          clearAllTrackNumbers();
          localStorage.setItem('crc-desktop-mission-id', msg.missionId);
        }
        missionData = msg;
        invalidateRadarsCache();
        if (mapReady) {
          map.getSource('airports').setData(buildAirports());
          map.getSource('bullseye').setData(buildBullseye());
          map.getSource('navpoints').setData(buildNavpoints());
          map.getSource('drawings').setData(buildDrawings());
          map.getSource('text-marks').setData(buildTextMarks());
        }
        // Rebuild radar panel so airport radars reflect the new mission
        refreshRadarPanelData();
        updateRadarBadge();
        // Refresh APRT panel airport list if panel is open
        refreshAprtAptList();
        break;
      }
      case 'squawk-map':
        // Squadron-wide config (crc-sync/config/squawk-map.json), pushed on
        // connect and whenever anyone edits it from the SQWK C/S panel —
        // authoritative, so it overwrites whatever this client had cached.
        settings.squawkMap = msg.squawkMap || {};
        settings.squawkSeq = msg.squawkSeq || {};
        saveSettings();
        refreshCallsPanel();
        updateMap();
        break;
      case 'theater-settings':
        // Squadron-wide config (crc-sync/src/theater-settings.js), same
        // deal as 'squawk-map' above — pushed on connect and whenever any
        // client edits transition alt / hdg correction / game-time offset
        // from the Airport panel, authoritative over this client's cache.
        settings.transitionAltFt = msg.transitionAltFt;
        settings.hdgCorrection   = msg.hdgCorrection;
        settings.gameTimeOffset  = msg.gameTimeOffset;
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
      case 'snapshot':
        applySnapshot((msg.tracks || []).map(normaliseTrack));
        break;
      case 'delta':
        applyDelta(
          (msg.updated || []).map(normaliseTrack),
          (msg.gone    || []).map(id => String(id)),
        );
        break;
      // EFSP — sent once at connect (efsp-snapshot) plus immediately on
      // every accepted Mutation (efsp-board-delta), not on this file's own
      // 500ms track/delta rhythm (see crc-sync's docs/adr/0004-immediate-
      // board-broadcast.md — the guide's <200ms remote-change budget).
      case 'efsp-snapshot':
        applyEfspSnapshot(msg);
        if (typeof refreshEfspPanel === 'function') refreshEfspPanel();
        if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
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
      case 'efsp-board-delta':
        applyEfspDelta(msg);
        if (typeof refreshEfspPanel === 'function') refreshEfspPanel();
        if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
        break;
      // Sent every 500ms unconditionally (ws-hub.js's _tick) — the genuine
      // periodic signal a staleness check needs, since "no message" on a
      // quiet Board is not itself evidence the connection died (guide §5.6
      // rule 5). See efsp-panel.js's staleness interval.
      case 'efsp-heartbeat':
        if (typeof noteEfspHeartbeat === 'function') noteEfspHeartbeat();
        break;
      case 'efsp-mutation-ack': {
        const result = applyEfspMutationAck(msg);
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
      // WP4A (docs/adr/0021), guide §4.6.1 — a timed forwarding obligation
      // came due. Unconditional broadcast (ws-hub.js), same as
      // efsp-board-delta — every connected client applies it and re-renders
      // whatever Bay currently shows the affected Strip.
      case 'efsp-obligation-alert':
        if (typeof applyEfspObligationAlert === 'function') applyEfspObligationAlert(msg);
        if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
        break;
      case 'radar-locks': {
        radarLocks.clear();
        for (const lock of (msg.locks || [])) {
          if (lock.coalition !== userCoalition) continue;
          radarLocks.set(lock.unitId, {
            targetLat: lock.targetLat,
            targetLon: lock.targetLon,
            targetId:  lock.targetId || null,
          });
        }
        updateMap();
        break;
      }
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
    if (t.squawkStatus === 2)       hasIdent = true;
    if (squawkEmergency(t.squawk))  hasEmerg = true;
    if (hasIdent && hasEmerg) break;
  }
  if (hasIdent || hasEmerg) updateMap();
  if (mapReady) {
    map.setPaintProperty('unit-emerg-square', 'icon-opacity', _pulseBright ? 0.95 : 0.12);
  }
}, 500);

// ── Boot ──────────────────────────────────────────────────────────────────

loadSettings();
loadEnabledRadars();
loadUserCoalition();
loadIffOverrides();
loadTrackRenames();
loadTrackNumbers();
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
