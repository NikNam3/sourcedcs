'use strict';

// Hull config and ship state (guide §9.12 rule 5, docs/adr/0064).
//
// §9.12 rule 5: "Ship state is a banner, not a field. Speed, heading,
// position, time and altimeter are shared by every carrier Position, and
// final bearing is computed from ship heading, not typed. This is how the
// real system does it." So ShipState is BUILT from a DCS ship track, never
// written. The one value DCS does not give per ship — the altimeter — is the
// only controller input (applyShipStateInput), and it accepts nothing else.
//
// Provenance:
//   §9.12 (binding)   — final bearing is computed from ship heading; ship state
//                       is shared by every carrier Position.
//   decisions H13/H26 — the squadron's carrier is CVN-72, DCS unit `UNION`, one
//                       hull (DEFAULT_HULL).
//   decisions H15     — every bearing is computed in TRUE and converted to
//                       magnetic only at display, with an injected variation
//                       (displayBearing). DCS-gRPC's orientation.heading is a
//                       flat-world GRID heading (common.proto:418-424), so the
//                       builder converts grid → true with an injected grid
//                       convergence; when none is given it keeps the grid
//                       value and SAYS so (headingRef: 'GRID').
//   [SOURCE-DEFINED]  — ANGLED_DECK_BY_TYPE (9° to port for the Nimitz class,
//                       the commonly published figure; the guide gives none);
//                       the altimeter's sane band 27.00–32.00 inHg; the 1°
//                       re-broadcast step.
//
// No clock, no store, no disk: `now` is passed in (the mission clock's now(),
// decisions H11) and the hull config is data the caller loads. The hull is
// matched by DCS unit name, then type — never by track id, which DCS re-mints
// on every crc-sync restart (docs/adr/0045).

const { normDeg, gridToTrue, toMagnetic } = require('./angles');

const SHIP_CATEGORY = 4; // DCS unit category for ships (radars.js uses the same test)
const MS_TO_KT = 1.943844;
const PA_PER_INHG = 3386.389;
const ALTIMETER_MIN_INHG = 27.0; // [SOURCE-DEFINED]
const ALTIMETER_MAX_INHG = 32.0; // [SOURCE-DEFINED]

// Degrees the landing area is angled to PORT, by DCS type. [SOURCE-DEFINED] —
// L4 briefing Q2. Any type not listed (CV_59, LHA_Tarawa, Kuznetsov, anything
// new) has no offset and therefore no final bearing — never a guess (D11).
const ANGLED_DECK_BY_TYPE = Object.freeze({ CVN_71: 9, CVN_72: 9, CVN_73: 9, CVN_74: 9, CVN_75: 9 });

// decisions H13/H26 — the one hull the squadron flies. L17 ships it as the
// config/efsp-carriers.json default; this constant is that file's seed.
const DEFAULT_HULL = Object.freeze({
  hullId: 'CVN-72',
  label: 'CVN-72',
  match: Object.freeze({ unitName: 'UNION', type: 'CVN_72', coalition: 'own' }),
  angledDeckDeg: null, // null → ANGLED_DECK_BY_TYPE for the matched type
});

const SHIP_INPUT_KEYS = Object.freeze(['altimeterInHg']);

function _fail(detail) {
  return { ok: false, reason: 'VALIDATION_ERROR', detail };
}

function _isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function _finite(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ── Hull config ──────────────────────────────────────────────────────────────

/**
 * HullConfig = { hullId, match: { unitName?, type?, coalition?: 'own'|'any' },
 *                angledDeckDeg?: number|null, label? }
 */
function validateHullConfig(hull) {
  if (!_isObj(hull)) return _fail('hull config must be an object');
  if (typeof hull.hullId !== 'string' || !hull.hullId) return _fail('hullId must be a non-empty string');
  if (!_isObj(hull.match)) return _fail(`${hull.hullId}: match must be an object`);
  const { unitName, type, coalition } = hull.match;
  if (unitName != null && (typeof unitName !== 'string' || !unitName)) return _fail(`${hull.hullId}: match.unitName must be a non-empty string`);
  if (type != null && (typeof type !== 'string' || !type)) return _fail(`${hull.hullId}: match.type must be a non-empty string`);
  if (!unitName && !type) return _fail(`${hull.hullId}: match needs a unitName or a type — never a track id (ids re-mint, docs/adr/0045)`);
  if (coalition != null && coalition !== 'own' && coalition !== 'any') return _fail(`${hull.hullId}: match.coalition must be 'own' or 'any'`);
  if (hull.angledDeckDeg != null && !(_finite(hull.angledDeckDeg) && hull.angledDeckDeg >= 0 && hull.angledDeckDeg < 45)) {
    return _fail(`${hull.hullId}: angledDeckDeg must be degrees to port in [0, 45), or null`);
  }
  if (hull.label != null && typeof hull.label !== 'string') return _fail(`${hull.hullId}: label must be a string`);
  return { ok: true, hull };
}

/**
 * The live track for this hull, or null. Ships only (category 4). Unit name
 * first; then type, and only if exactly one ship of that type qualifies — two
 * is "hull ambiguous, configure unitName", never a guess. `coalition: 'own'`
 * (the default) compares against the injected `ownCoalition`; an unknown
 * ownCoalition matches nothing.
 * @param {Iterable<object>} tracks  track objects (tracks.js shape)
 */
function matchHullTrack(hull, tracks, { ownCoalition = null } = {}) {
  if (!validateHullConfig(hull).ok || tracks == null || typeof tracks[Symbol.iterator] !== 'function') return null;
  const wantOwn = (hull.match.coalition || 'own') === 'own';
  const ships = [];
  for (const t of tracks) {
    if (!_isObj(t) || t.category !== SHIP_CATEGORY) continue;
    if (wantOwn && (ownCoalition == null || t.coalition !== ownCoalition)) continue;
    ships.push(t);
  }
  if (hull.match.unitName) {
    const byName = ships.filter((t) => t.name === hull.match.unitName);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) return null;
  }
  if (hull.match.type) {
    const byType = ships.filter((t) => t.type === hull.match.type);
    if (byType.length === 1) return byType[0];
  }
  return null;
}

/** Why matchHullTrack returned null, for the banner. Same inputs. */
function hullMatchProblem(hull, tracks, { ownCoalition = null } = {}) {
  if (!validateHullConfig(hull).ok) return 'hull not configured';
  if (matchHullTrack(hull, tracks, { ownCoalition })) return null;
  const wantOwn = (hull.match.coalition || 'own') === 'own';
  if (wantOwn && ownCoalition == null) return 'own coalition unknown';
  const list = tracks && typeof tracks[Symbol.iterator] === 'function' ? [...tracks] : [];
  const ships = list.filter((t) => _isObj(t) && t.category === SHIP_CATEGORY && (!wantOwn || t.coalition === ownCoalition));
  if (hull.match.type && ships.filter((t) => t.type === hull.match.type).length > 1) return 'hull ambiguous — configure unitName';
  return 'hull not found';
}

// ── Final bearing ────────────────────────────────────────────────────────────

/**
 * The landing area is angled to port, so the final bearing is LEFT of (less
 * than) the ship's heading: normDeg(brc − offset). Unknown either → null.
 */
function computeFinalBearing(brcDeg, angledDeckDeg) {
  if (!_finite(brcDeg) || !_finite(angledDeckDeg)) return null;
  return normDeg(brcDeg - angledDeckDeg);
}

function _angledDeck(hull, type) {
  if (_isObj(hull) && _finite(hull.angledDeckDeg)) return { deg: hull.angledDeckDeg, source: 'HULL' };
  if (typeof type === 'string' && Object.prototype.hasOwnProperty.call(ANGLED_DECK_BY_TYPE, type)) {
    return { deg: ANGLED_DECK_BY_TYPE[type], source: 'TYPE_DEFAULT' };
  }
  return { deg: null, source: null };
}

/** Pa → inHg, 2 decimals. For L17's weather-derived default altimeter. */
function inHgFromPa(pa) {
  if (!_finite(pa) || pa <= 0) return null;
  return Math.round((pa / PA_PER_INHG) * 100) / 100;
}

// ── Ship state ───────────────────────────────────────────────────────────────

/**
 * Build the banner from a DCS ship track. Nothing here is typed by anyone
 * except, through `inputs`, the altimeter.
 *
 * @param {object} args
 * @param {object} args.hull               HullConfig
 * @param {object|null} args.track         the matched ship track (tracks.js shape), or null
 * @param {number} args.now                mission clock now(), epoch ms Zulu (decisions H11)
 * @param {object} [args.inputs]           ShipInputs — { altimeterInHg } set by a controller
 * @param {number} [args.weatherPa]        theater sea-level pressure (grpc-client 'weather'), the default altimeter
 * @param {number} [args.gridConvergenceDeg] true = grid + γ; unknown → the heading stays GRID, labelled
 */
function buildShipState({ hull, track = null, now = null, inputs = null, weatherPa = null, gridConvergenceDeg = null } = {}) {
  const hullId = _isObj(hull) && typeof hull.hullId === 'string' ? hull.hullId : null;
  let altimeterInHg = null;
  let altimeterSource = null;
  if (_isObj(inputs) && _finite(inputs.altimeterInHg)) {
    altimeterInHg = inputs.altimeterInHg;
    altimeterSource = 'SET';
  } else if (inHgFromPa(weatherPa) != null) {
    altimeterInHg = inHgFromPa(weatherPa);
    altimeterSource = 'THEATER_WEATHER';
  }
  const atUtc = _finite(now) ? now : null;

  if (!_isObj(track)) {
    return {
      hullId, trackId: null, unitName: null, type: null, lat: null, lon: null,
      headingDeg: null, headingRef: null, brcDeg: null,
      angledDeckDeg: null, angledDeckSource: null,
      finalBearingDeg: null, finalBearingUnavailable: 'no ship track',
      speedKt: null, altimeterInHg, altimeterSource, atUtc, stale: false, found: false,
    };
  }

  // Any finalBearingDeg / brcDeg on the track or inputs is ignored by
  // construction: only track.heading is read (WP7A bullet 5).
  const grid = normDeg(track.heading);
  const trueHdg = grid == null ? null : gridToTrue(grid, gridConvergenceDeg);
  const headingDeg = trueHdg != null ? trueHdg : grid;
  const headingRef = headingDeg == null ? null : (trueHdg != null ? 'TRUE' : 'GRID');
  const brcDeg = headingDeg == null ? null : normDeg(Math.round(headingDeg));
  const deck = _angledDeck(hull, track.type);
  const finalBearingDeg = computeFinalBearing(brcDeg, deck.deg);
  let finalBearingUnavailable = null;
  if (brcDeg == null) finalBearingUnavailable = 'no ship heading';
  else if (deck.deg == null) finalBearingUnavailable = `angled deck not configured for ${track.type || 'unknown type'}`;

  return {
    hullId,
    trackId: track.id ?? null, // transient — never trusted after a restart (docs/adr/0045)
    unitName: track.name ?? null,
    type: track.type ?? null,
    lat: _finite(track.lat) ? track.lat : null,
    lon: _finite(track.lon) ? track.lon : null,
    headingDeg,
    headingRef,
    brcDeg,
    angledDeckDeg: deck.deg,
    angledDeckSource: deck.source,
    finalBearingDeg,
    finalBearingUnavailable,
    speedKt: _finite(track.groundSpeed) ? Math.round(track.groundSpeed * MS_TO_KT) : null,
    altimeterInHg,
    altimeterSource,
    atUtc,
    stale: false,
    found: true,
  };
}

/**
 * The track has gone: keep the last-known banner, marked stale. `atUtc` stays
 * the time it was last true; `staleSinceUtc` records when it went stale.
 */
function staleFrom(previous, now) {
  if (!_isObj(previous)) return null;
  if (previous.stale) return { ...previous };
  return { ...previous, stale: true, staleSinceUtc: _finite(now) ? now : null };
}

/**
 * Should the banner be re-broadcast? BRC moves only in whole-degree steps of
 * at least `headingStepDeg`, so a ship in a turn does not re-send every tick.
 */
function shipStateChanged(prev, next, { headingStepDeg = 1 } = {}) {
  if (!_isObj(prev) || !_isObj(next)) return prev !== next;
  if (prev.brcDeg !== next.brcDeg) {
    if (prev.brcDeg == null || next.brcDeg == null) return true;
    const d = Math.abs(prev.brcDeg - next.brcDeg) % 360;
    if ((d > 180 ? 360 - d : d) >= headingStepDeg) return true;
  }
  for (const k of ['finalBearingDeg', 'finalBearingUnavailable', 'speedKt', 'altimeterInHg', 'altimeterSource', 'stale', 'found', 'headingRef', 'hullId']) {
    if (prev[k] !== next[k]) {
      if (k === 'finalBearingDeg' && prev.brcDeg !== next.brcDeg) continue; // follows BRC's step
      return true;
    }
  }
  return false;
}

/** ShipInputs — what a controller may set. Today: the altimeter only. */
function defaultShipInputs() {
  return { altimeterInHg: null };
}

/**
 * The ONLY controller-writable path into the banner. Accepts exactly
 * { altimeterInHg } — a number in 27.00–32.00, or null to fall back to the
 * theater weather. Any other key is refused: final bearing is computed from
 * ship heading (§9.12 rule 5) and cannot be entered.
 */
function applyShipStateInput(inputs, input) {
  const current = _isObj(inputs) ? inputs : defaultShipInputs();
  if (!_isObj(input)) return _fail('input must be an object');
  const keys = Object.keys(input);
  if (keys.length === 0) return _fail('input is empty');
  for (const k of keys) {
    if (!SHIP_INPUT_KEYS.includes(k)) {
      return _fail(`'${k}' cannot be entered: final bearing is computed from ship heading (§9.12 rule 5) and cannot be entered; only the altimeter is a controller input`);
    }
  }
  const v = input.altimeterInHg;
  if (v !== null && !(_finite(v) && v >= ALTIMETER_MIN_INHG && v <= ALTIMETER_MAX_INHG)) {
    return _fail(`altimeterInHg must be ${ALTIMETER_MIN_INHG.toFixed(2)}–${ALTIMETER_MAX_INHG.toFixed(2)} inHg, or null to use the theater weather`);
  }
  return { ok: true, inputs: { ...current, altimeterInHg: v === null ? null : Math.round(v * 100) / 100 } };
}

function normalizeShipInputs(raw) {
  const out = defaultShipInputs();
  if (_isObj(raw) && _finite(raw.altimeterInHg) && raw.altimeterInHg >= ALTIMETER_MIN_INHG && raw.altimeterInHg <= ALTIMETER_MAX_INHG) {
    out.altimeterInHg = raw.altimeterInHg;
  }
  return out;
}

/**
 * A bearing as a controller reads it (decisions H15: magnetic, always).
 * `ref` is the reference the bearing was computed in (ShipState.headingRef).
 *   TRUE + known variation → { value, ref: 'M' }   (the normal case)
 *   TRUE, variation unknown → { value, ref: 'T' }  (labelled, never passed off as magnetic)
 *   GRID                    → { value, ref: 'G' }  (no true → no magnetic)
 * Whole degrees; 0 stays 0 (rendering "360" is the renderer's call).
 */
function displayBearing(deg, { ref = 'TRUE', magneticVariationDeg = null } = {}) {
  const n = normDeg(deg);
  if (n == null) return { value: null, ref: null };
  if (ref === 'TRUE') {
    const m = toMagnetic(n, magneticVariationDeg);
    if (m != null) return { value: normDeg(Math.round(m)), ref: 'M' };
    return { value: normDeg(Math.round(n)), ref: 'T' };
  }
  if (ref === 'GRID') return { value: normDeg(Math.round(n)), ref: 'G' };
  return { value: null, ref: null };
}

module.exports = {
  SHIP_CATEGORY,
  ANGLED_DECK_BY_TYPE,
  DEFAULT_HULL,
  SHIP_INPUT_KEYS,
  ALTIMETER_MIN_INHG,
  ALTIMETER_MAX_INHG,
  validateHullConfig,
  matchHullTrack,
  hullMatchProblem,
  computeFinalBearing,
  inHgFromPa,
  buildShipState,
  staleFrom,
  shipStateChanged,
  defaultShipInputs,
  applyShipStateInput,
  normalizeShipInputs,
  displayBearing,
};
