'use strict';

// The carrier fields of a FLIGHT, and the marshal message (guide §9.12,
// docs/adr/0064).
//
// The design point: EEAT survives launch → recovery because it is on the
// flight, not on a Strip. §9.12 rule 7: "EEAT is issued before launch as the
// lost-comms fallback and MUST survive from the departure Strip through to
// recovery. It is the field most likely to be missed." One FDR spans the
// flight's whole life; its Strips come and go (the launch Strip is dropped,
// the recovery Strip is a new one on the same fdrId, replicas per Facility —
// docs/adr/0013). An EEAT held on a Strip dies with the launch Strip.
//
// So these fields live on the FDR, in docs/adr/0052's single military
// namespace, as one sub-object: `fdr.military.carrier` (the way §9.4's MTR
// fields are `fdr.military.mtr`). Round-1 question Q63, supervisor default
// (a). L17 adds it to fdr-store.js's defaultMilitary(); this module defines the
// shape, the validators and the restore normaliser.
//
// Provenance:
//   §9.12 (binding)  — EEAT survives launch → recovery (rule 7); store the
//                      approach BUTTON, never a frequency (rule 6); the
//                      marshal message's sixteen fields in their order.
//   decisions H31    — approach buttons: a validated integer, no defaults.
//   [SOURCE-DEFINED] — APPROACH_TYPES (L4 briefing Q7); the button range
//                      1..20 (the common DCS radio preset range); the fuel
//                      sanity bound.
//
// FUEL/LOW STATE is `lowStateLb` here, not guide M17 `military.fuelState`:
// §6.4 defines M17 as "fuel state / playtime remaining" (endurance, a TIME,
// per DD-175), where the carrier low state is pounds of fuel. Two units, two
// fields — docs/adr/0064 records it.

const { displayBearing } = require('./ship-state');

const APPROACH_TYPES = Object.freeze(['TACAN', 'ICLS', 'ACLS', 'PAR', 'VISUAL']); // [SOURCE-DEFINED]
const APPROACH_BUTTON_MIN = 1; // [SOURCE-DEFINED]
const APPROACH_BUTTON_MAX = 20; // [SOURCE-DEFINED]
const FUEL_MAX_LB = 100000; // [SOURCE-DEFINED] sanity bound
const BINGO_FIELD_MAX_LEN = 32;

const RULE_6 = 'store the approach button, not a frequency (§9.12 rule 6)';

function defaultCarrierFlight() {
  return {
    eeatUtc: null,        // epoch ms, mission Zulu (decisions H11) — issued before launch (§9.12 rule 7)
    approachType: null,   // one of APPROACH_TYPES
    approachButton: null, // integer — a BUTTON, never a frequency (§9.12 rule 6)
    bingoField: null,     // ICAO or name
    bingoFuelLb: null,    // integer lb
    lowStateLb: null,     // integer lb — the marshal message's FUEL/LOW STATE
  };
}

const CARRIER_FLIGHT_FIELDS = Object.freeze(Object.keys(defaultCarrierFlight()));

function _fail(detail) {
  return { ok: false, reason: 'VALIDATION_ERROR', detail };
}

function _isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function _validateButton(value) {
  let v = value;
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^\d+$/.test(t)) v = Number(t);
    else if (/^\d+[.,]\d*$/.test(t)) return _fail(`'${value}' looks like a frequency — ${RULE_6}`);
    else return _fail(`approachButton must be an integer ${APPROACH_BUTTON_MIN}..${APPROACH_BUTTON_MAX}`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return _fail(`approachButton must be an integer ${APPROACH_BUTTON_MIN}..${APPROACH_BUTTON_MAX}`);
  if (!Number.isInteger(v) || v >= 100) return _fail(`${value} looks like a frequency — ${RULE_6}`);
  if (v < APPROACH_BUTTON_MIN || v > APPROACH_BUTTON_MAX) {
    return _fail(`approachButton must be an integer ${APPROACH_BUTTON_MIN}..${APPROACH_BUTTON_MAX} [SOURCE-DEFINED range]`);
  }
  return { ok: true, value: v };
}

function _validateFuel(field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return _fail(`${field} must be a number of pounds`);
  if (value < 0) return _fail(`${field} cannot be negative`);
  if (value > FUEL_MAX_LB) return _fail(`${field} above ${FUEL_MAX_LB} lb is not a fuel state`);
  return { ok: true, value: Math.round(value) };
}

/**
 * Validate and normalise one field. `null` always clears.
 * @returns {{ok:true, value:any} | {ok:false, reason:'VALIDATION_ERROR', detail:string}}
 */
function validateCarrierFlightField(field, value) {
  if (!CARRIER_FLIGHT_FIELDS.includes(field)) return _fail(`unknown carrier field '${field}'`);
  if (value === null) return { ok: true, value: null };
  switch (field) {
    case 'eeatUtc':
      if (typeof value !== 'number' || !Number.isFinite(value)) return _fail('eeatUtc must be epoch ms (mission Zulu)');
      return { ok: true, value };
    case 'approachType': {
      const t = typeof value === 'string' ? value.trim().toUpperCase() : null;
      if (!APPROACH_TYPES.includes(t)) return _fail(`approachType must be one of ${APPROACH_TYPES.join(', ')}`);
      return { ok: true, value: t };
    }
    case 'approachButton':
      return _validateButton(value);
    case 'bingoField': {
      const t = typeof value === 'string' ? value.trim().toUpperCase() : '';
      if (!t) return _fail('bingoField must be an airfield ICAO code or name');
      if (t.length > BINGO_FIELD_MAX_LEN) return _fail(`bingoField is longer than ${BINGO_FIELD_MAX_LEN} characters`);
      return { ok: true, value: t };
    }
    case 'bingoFuelLb':
    case 'lowStateLb':
      return _validateFuel(field, value);
    default:
      return _fail(`unknown carrier field '${field}'`);
  }
}

/** → { ok, flight } — a new object; the input is untouched. */
function setCarrierFlightField(flight, field, value) {
  const v = validateCarrierFlightField(field, value);
  if (!v.ok) return v;
  const base = normalizeCarrierFlight(flight);
  return { ok: true, flight: { ...base, [field]: v.value } };
}

/**
 * Restore path, and the read path for an FDR from before L17 wired this in:
 * a missing namespace or key becomes its default (§12's "present and
 * unpopulated" promise — fdr-store.js's ensureMilitary reasoning); an invalid
 * value becomes null; unknown keys are dropped. A valid set EEAT is never
 * cleared.
 */
function normalizeCarrierFlight(raw) {
  const out = defaultCarrierFlight();
  if (!_isObj(raw)) return out;
  for (const f of CARRIER_FLIGHT_FIELDS) {
    if (raw[f] == null) continue;
    const v = validateCarrierFlightField(f, raw[f]);
    if (v.ok) out[f] = v.value;
  }
  return out;
}

/** The carrier record of an FDR, wherever it is in its life. */
function carrierFlightOf(fdr) {
  return normalizeCarrierFlight(_isObj(fdr) && _isObj(fdr.military) ? fdr.military.carrier : null);
}

// §9.12's order, exactly.
const MARSHAL_MESSAGE_FIELDS = Object.freeze([
  Object.freeze({ key: 'callsign', label: 'CALLSIGN' }),
  Object.freeze({ key: 'type', label: 'TYPE' }),
  Object.freeze({ key: 'case', label: 'CASE' }),
  Object.freeze({ key: 'approachType', label: 'APPROACH TYPE' }),
  Object.freeze({ key: 'marshalRadial', label: 'MARSHAL RADIAL' }),
  Object.freeze({ key: 'marshalDme', label: 'MARSHAL DME' }),
  Object.freeze({ key: 'angels', label: 'ANGELS' }),
  Object.freeze({ key: 'eatPush', label: 'EAT/PUSH' }),
  Object.freeze({ key: 'expectedFinalBearing', label: 'EXPECTED FINAL BEARING' }),
  Object.freeze({ key: 'approachButton', label: 'APPROACH BUTTON' }),
  Object.freeze({ key: 'altimeter', label: 'ALTIMETER' }),
  Object.freeze({ key: 'shipWx', label: 'SHIP WX' }),
  Object.freeze({ key: 'fuelLowState', label: 'FUEL/LOW STATE' }),
  Object.freeze({ key: 'bingoField', label: 'BINGO FIELD' }),
  Object.freeze({ key: 'bingoFuel', label: 'BINGO FUEL' }),
  Object.freeze({ key: 'eeat', label: 'EEAT' }),
]);

/**
 * The marshal message, as an ordered list in EXACTLY §9.12's order. A missing
 * value is null, never omitted — the controller must SEE that EEAT is blank.
 *
 * Bearings (radial, final bearing) carry `value` in the reference they were
 * computed in (degrees true, or grid when no convergence was known) and
 * `display` from ship-state.displayBearing — magnetic when a variation is
 * given (decisions H15).
 *
 * @param {object} args
 * @param {object} args.fdr        the FDR; carrier fields are read from fdr.military.carrier
 * @param {object} [args.derived]  marshal-stack.deriveEntry() for this flight, or null
 * @param {string} [args.caseValue] the recovery Case (the record's value)
 * @param {object} [args.shipState]
 * @param {*}      [args.shipWx]   whatever L17 sources; null when unknown
 * @param {number} [args.magneticVariationDeg]
 */
function marshalMessage({ fdr = null, derived = null, caseValue = null, shipState = null, shipWx = null, magneticVariationDeg = null } = {}) {
  const identity = _isObj(fdr) && _isObj(fdr.identity) ? fdr.identity : {};
  const c = carrierFlightOf(fdr);
  const d = _isObj(derived) ? derived : {};
  const s = _isObj(shipState) ? shipState : {};
  const ref = s.headingRef === 'GRID' ? 'GRID' : 'TRUE';
  const values = {
    callsign: identity.callsign ?? null,
    type: identity.aircraftType ?? null,
    case: caseValue ?? d.caseValue ?? null,
    approachType: c.approachType,
    marshalRadial: d.marshalRadialDeg ?? null,
    marshalDme: d.marshalDme ?? null,
    angels: d.angels ?? null,
    eatPush: d.pushTimeUtc ?? null,
    expectedFinalBearing: d.expectedFinalBearingDeg ?? s.finalBearingDeg ?? null,
    approachButton: c.approachButton,
    altimeter: s.altimeterInHg ?? null,
    shipWx: shipWx ?? null,
    fuelLowState: c.lowStateLb,
    bingoField: c.bingoField,
    bingoFuel: c.bingoFuelLb,
    eeat: c.eeatUtc,
  };
  return MARSHAL_MESSAGE_FIELDS.map(({ key, label }) => {
    const item = { key, label, value: values[key] };
    if (key === 'marshalRadial' || key === 'expectedFinalBearing') {
      item.display = displayBearing(values[key], { ref, magneticVariationDeg });
    }
    return item;
  });
}

module.exports = {
  APPROACH_TYPES,
  APPROACH_BUTTON_MIN,
  APPROACH_BUTTON_MAX,
  CARRIER_FLIGHT_FIELDS,
  MARSHAL_MESSAGE_FIELDS,
  defaultCarrierFlight,
  validateCarrierFlightField,
  setCarrierFlightField,
  normalizeCarrierFlight,
  carrierFlightOf,
  marshalMessage,
};
