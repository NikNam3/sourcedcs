'use strict';

// The carrier's state: every value a recovery is run by, each with a SOURCE and an optional OVERRIDE (docs/adr/0113).
//
//   source 'dcs'       the value is read from the game (the ship's heading, the wind at the ship plus its speed, the pressure)
//   source 'default'   the value is worked out from other values, or is a shipped default (final bearing = BRC - the angled
//                      deck; marshal radial = final bearing + 180; first fix 21 DME; the tanker's altitude and side)
//   source 'override'  a controller typed it; clearing it ("Use DCS" / "Use default") puts the automatic value back
//   source 'none'      there is no automatic value and nobody has typed one (ramp time, ceiling, visibility, tanker side number)
//
// Only the overrides are stored (carrier-store.js, `record.overrides`); the Case lives in its own record (recovery-case.js, its
// history is the audit of who set it), and everything else here is DERIVED each time a view is built, which is what keeps a
// DCS value from going stale on disk. The resolved state feeds the Marshal stack's derivation (marshal-stack.js) and the wire.
//
// Every bearing is stored and computed TRUE (decisions H15). A controller types MAGNETIC, and `validateField` converts once,
// here on the server, with the variation at the ship; `display` carries the magnetic reading back out.
//
// Pure: no clock, no store, no disk. The mission clock's now() and the tuning are passed in.

const { normDeg, reciprocal } = require('./angles');
const { computeFinalBearing, displayBearing } = require('./ship-state');
const { resolveZuluHhmm } = require('../zulu-time');
const { PATTERN_SIDES } = require('./recovery-tuning');

const ALTIMETER_MIN_INHG = 27.0; // [SOURCE-DEFINED], as the banner's was
const ALTIMETER_MAX_INHG = 32.0;

/**
 * The editable fields, by the name the wire carries. `key` is the stored override; `kind` says how a typed value is checked.
 * Ranges are [SOURCE-DEFINED] sanity bounds, not doctrine.
 */
const FIELDS = Object.freeze({
  brc:               { key: 'brcDeg',            kind: 'bearing' },
  finalBearing:      { key: 'finalBearingDeg',   kind: 'bearing' },
  radial:            { key: 'marshalRadialDeg',  kind: 'bearing' },
  rampTime:          { key: 'rampTimeUtc',       kind: 'time' },
  firstFix:          { key: 'firstFixDme',       kind: 'int', min: 10, max: 40 },
  ceiling:           { key: 'ceilingFt',         kind: 'num', min: 0, max: 60000, round: 0 },
  visibility:        { key: 'visibilityNm',      kind: 'num', min: 0, max: 99, round: 1 },
  windOverDeck:      { key: 'windOverDeckKt',    kind: 'num', min: 0, max: 99, round: 0 },
  altimeter:         { key: 'altimeterInHg',     kind: 'num', min: ALTIMETER_MIN_INHG, max: ALTIMETER_MAX_INHG, round: 2 },
  tankerSide:        { key: 'tankerSideNumber',  kind: 'text' },
  tankerAltitude:    { key: 'tankerAltitudeFt',  kind: 'num', min: 500, max: 40000, round: 0 },
  tankerGive:        { key: 'tankerGiveKlb',     kind: 'num', min: 0, max: 99, round: 1 },
  tankerPatternSide: { key: 'tankerPatternSide', kind: 'side' },
  tankerOnStation:   { key: 'tankerOnStation',   kind: 'bool' },
});
/** `case` is the one field with its own record (recovery-case.js); the op names it too. */
const CASE_FIELD = 'case';
const FIELD_NAMES = Object.freeze([...Object.keys(FIELDS), CASE_FIELD]);
const OVERRIDE_KEYS = Object.freeze(Object.values(FIELDS).map(f => f.key));

function _fail(detail) { return { ok: false, reason: 'VALIDATION_ERROR', detail }; }
function _finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function _isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

function emptyOverrides() { return Object.fromEntries(OVERRIDE_KEYS.map(k => [k, null])); }

function _storable(spec, v) {
  switch (spec.kind) {
    case 'bearing': return normDeg(v) != null && v >= 0 && v <= 360 ? normDeg(v) : undefined;
    case 'time': return _finite(v) ? v : undefined;
    case 'int': return Number.isInteger(v) && v >= spec.min && v <= spec.max ? v : undefined;
    case 'num': return _finite(v) && v >= spec.min && v <= spec.max ? v : undefined;
    case 'text': return typeof v === 'string' && /^[A-Za-z0-9]{1,8}$/.test(v) ? v.toUpperCase() : undefined;
    case 'side': return PATTERN_SIDES.includes(v) ? v : undefined;
    case 'bool': return typeof v === 'boolean' ? v : undefined;
    default: return undefined;
  }
}

/** Restore path: never refuses. A stored value that does not check is dropped (the automatic value applies). */
function normalizeOverrides(raw) {
  const out = emptyOverrides();
  if (!_isObj(raw)) return out;
  for (const spec of Object.values(FIELDS)) {
    const v = _storable(spec, raw[spec.key]);
    if (v !== undefined) out[spec.key] = v;
  }
  return out;
}

/**
 * What a controller typed → the value to store. `value === null` (or '') clears the override.
 *  bearing   a MAGNETIC bearing, converted to true with `variationDeg`; refused when the variation at the ship is not known
 *  time      a Zulu HHMM, put on the mission clock's day
 *  num / int a number or a numeric string
 * @returns {{ok:true, key:string, stored:any}|{ok:false, reason:string, detail:string}}
 */
function validateField(field, value, { variationDeg = null, now = null } = {}) {
  const spec = Object.prototype.hasOwnProperty.call(FIELDS, field) ? FIELDS[field] : null;
  if (!spec) return _fail(`unknown carrier state field '${field}' — one of ${FIELD_NAMES.join(', ')}`);
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return { ok: true, key: spec.key, stored: null };
  const label = field.replace(/([A-Z])/g, ' $1').toLowerCase();
  let v = value;
  switch (spec.kind) {
    case 'bearing': {
      const mag = typeof v === 'string' ? Number(v.trim()) : v;
      if (!_finite(mag) || mag < 0 || mag > 360) return _fail(`the ${label} must be a magnetic bearing, 0 to 360`);
      if (!_finite(variationDeg)) return _fail(`the magnetic variation at the ship is not known, so a magnetic ${label} cannot be converted`);
      return { ok: true, key: spec.key, stored: normDeg(mag + variationDeg) };
    }
    case 'time': {
      const at = resolveZuluHhmm(v, now);
      if (at == null) return _fail(`the ${label} must be a Zulu time, HHMM (not ${JSON.stringify(value)})`);
      return { ok: true, key: spec.key, stored: at };
    }
    case 'int': case 'num': {
      if (typeof v === 'string') v = Number(v.trim());
      if (!_finite(v)) return _fail(`the ${label} must be a number`);
      if (spec.kind === 'int') v = Math.round(v);
      else if (spec.round != null) v = Math.round(v * 10 ** spec.round) / 10 ** spec.round;
      if (v < spec.min || v > spec.max) return _fail(`the ${label} must be from ${spec.min} to ${spec.max}`);
      return { ok: true, key: spec.key, stored: v };
    }
    case 'text': {
      const s = _storable(spec, typeof v === 'string' ? v.trim() : v);
      if (s === undefined) return _fail(`the ${label} must be 1 to 8 letters or digits`);
      return { ok: true, key: spec.key, stored: s };
    }
    case 'side': {
      const s = _storable(spec, v);
      if (s === undefined) return _fail(`the ${label} must be port or stbd`);
      return { ok: true, key: spec.key, stored: s };
    }
    case 'bool': {
      if (typeof v !== 'boolean') return _fail(`the ${label} must be true or false`);
      return { ok: true, key: spec.key, stored: v };
    }
    default: return _fail(`unknown field kind for ${field}`);
  }
}

/**
 * Wind over deck, knots: the wind the deck feels, the air's velocity relative to the ship (wind vector minus ship vector).
 * Wind dead ahead is the wind plus the ship's speed; a wind from astern at the ship's speed is none. Whole knots.
 * Unknown wind or ship → null.
 * @param {{windFromDeg:number, windKt:number}|null} wind  DCS wind at the ship, direction it blows FROM (true)
 * @param {{headingDeg:number|null, speedKt:number|null}|null} ship
 */
function windOverDeckKt(wind, ship) {
  if (!wind || !ship || !_finite(wind.windFromDeg) || !_finite(wind.windKt) || !_finite(ship.headingDeg) || !_finite(ship.speedKt)) return null;
  const rad = Math.PI / 180;
  // Air velocity (towards): opposite the direction it blows from. Ship velocity: along its heading.
  const ax = wind.windKt * Math.sin((wind.windFromDeg + 180) * rad);
  const ay = wind.windKt * Math.cos((wind.windFromDeg + 180) * rad);
  const sx = ship.speedKt * Math.sin(ship.headingDeg * rad);
  const sy = ship.speedKt * Math.cos(ship.headingDeg * rad);
  return Math.round(Math.hypot(ax - sx, ay - sy));
}

function _entry(value, source, override, dflt, extra = {}) {
  return { value, source, override, default: dflt, ...extra };
}

/** One scalar: the override wins; else the automatic value (`auto`, `autoSource`); else none. */
function _scalar(override, auto, autoSource) {
  if (override != null) return _entry(override, 'override', override, auto);
  if (auto != null) return _entry(auto, autoSource, null, auto);
  return _entry(null, 'none', null, null);
}

/**
 * The whole state, resolved. Pure.
 * @param {object} args
 * @param {object} args.overrides      the stored overrides (normalizeOverrides)
 * @param {object} args.recoveryCase   the Case record ({ value, setBy })
 * @param {object|null} args.shipState the banner (DCS facts), or null
 * @param {object|null} args.hull      the hull config (angledDeckDeg)
 * @param {object|null} args.shipWind  { windFromDeg, windKt } at the ship, or null
 * @param {object} args.tuning         recovery-tuning.js
 * @param {number|null} args.variationDeg magnetic variation at the ship, for `display`
 */
function resolveState({ overrides, recoveryCase, shipState = null, hull = null, shipWind = null, tuning, variationDeg = null }) {
  const o = overrides || emptyOverrides();
  const ship = shipState && shipState.found ? shipState : null;
  const shipRef = ship && ship.headingRef ? ship.headingRef : null; // 'TRUE' | 'GRID'
  // `display` is the value in force as a controller reads it (magnetic, H15); `defaultDisplay` the automatic one beside an override.
  const bearing = (entry, ref) => ({
    ...entry, ref: ref || null,
    display: displayBearing(entry.value, { ref: ref || 'TRUE', magneticVariationDeg: variationDeg }),
    defaultDisplay: displayBearing(entry.default, { ref: shipRef || 'TRUE', magneticVariationDeg: variationDeg }),
  });

  // BRC: the ship's heading from DCS (whole degrees), unless typed.
  const brcAuto = ship && _finite(ship.brcDeg) ? ship.brcDeg : null;
  const brcE = _scalar(o.brcDeg, brcAuto, 'dcs');
  const brcRef = o.brcDeg != null ? 'TRUE' : shipRef;
  const brc = bearing(brcE, brcRef);

  // Final bearing: BRC less the angled deck, unless typed.
  const angled = hull && _finite(hull.angledDeckDeg) ? hull.angledDeckDeg : null;
  const finalAuto = computeFinalBearing(brc.value, angled);
  const finalE = _scalar(o.finalBearingDeg, finalAuto, 'default');
  const finalRef = o.finalBearingDeg != null ? 'TRUE' : brcRef;
  const finalBearing = bearing(finalE, finalRef);

  // Marshal radial: the reciprocal of the final bearing (decisions H27), unless typed.
  const radialAuto = reciprocal(finalBearing.value);
  const radialE = _scalar(o.marshalRadialDeg, radialAuto, 'default');
  const radialRef = o.marshalRadialDeg != null ? 'TRUE' : finalRef;
  const radial = bearing(radialE, radialRef);

  const firstFix = _scalar(o.firstFixDme, tuning.firstFixDme, 'default');
  const rampTime = _scalar(o.rampTimeUtc, null, 'default');

  const wod = windOverDeckKt(shipWind, ship);
  const altAuto = shipState && _finite(shipState.altimeterInHg) ? shipState.altimeterInHg : null; // the theater's pressure, with or without the ship
  const weather = {
    ceiling: _scalar(o.ceilingFt, null, 'dcs'),
    visibility: _scalar(o.visibilityNm, null, 'dcs'),
    windOverDeck: _scalar(o.windOverDeckKt, wod, 'dcs'),
    altimeter: _scalar(o.altimeterInHg, altAuto, 'dcs'),
  };

  const tanker = {
    sideNumber: _scalar(o.tankerSideNumber, null, 'default'),
    altitude: _scalar(o.tankerAltitudeFt, tuning.tanker.altitudeFt, 'default'),
    give: _scalar(o.tankerGiveKlb, null, 'default'),
    patternSide: _scalar(o.tankerPatternSide, tuning.tanker.patternSide, 'default'),
    onStation: _scalar(o.tankerOnStation, false, 'default'),
  };

  const caseValue = recoveryCase ? recoveryCase.value : null;
  const caseE = recoveryCase && recoveryCase.setBy != null
    ? _entry(caseValue, 'override', caseValue, 'III')
    : _entry(caseValue, 'default', null, 'III');

  return { case: caseE, brc, finalBearing, radial, firstFix, rampTime, weather, tanker };
}

/**
 * What the Marshal stack's derivation reads (marshal-stack.js deriveEntry): the resolved values it needs, plainly.
 * Bearings are TRUE (or GRID when the ship's heading could not be made true, and then labelled so by `ref`).
 */
function recoveryInputs(state, tuning) {
  return {
    caseValue: state.case.value,
    rampTimeUtc: state.rampTime.value,
    finalBearingDeg: state.finalBearing.value,
    marshalRadialDeg: state.radial.value,
    marshalRadialSource: state.radial.value == null ? null : (state.radial.source === 'override' ? 'SET' : 'FINAL_BEARING'),
    firstFixDme: state.firstFix.value,
    fixToRampMs: tuning.fixToRampMs,
    pushSpacingMs: tuning.pushSpacingMs,
  };
}

module.exports = {
  FIELDS, FIELD_NAMES, CASE_FIELD, OVERRIDE_KEYS, ALTIMETER_MIN_INHG, ALTIMETER_MAX_INHG,
  emptyOverrides, normalizeOverrides, validateField, windOverDeckKt, resolveState, recoveryInputs,
};
