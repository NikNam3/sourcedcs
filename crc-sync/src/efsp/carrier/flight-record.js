'use strict';

// The carrier fields of a FLIGHT, and the marshal message (guide §9.12,
// docs/adr/0064).
//
// The design point: EEAT survives launch → recovery because it is on the
// flight, not on a Strip. §9.12 rule 7: "EEAT is issued before launch as the
// lost-comms fallback and MUST survive from the departure Strip through to
// recovery. It is the field most likely to be missed." One flight's flight data spans the
// flight's whole life; its Strips come and go (the launch Strip is dropped,
// the recovery Strip is a new one on the same flightDataId, replicas per Facility —
// docs/adr/0013). An EEAT held on a Strip dies with the launch Strip.
//
// So these fields live on the flight data, in docs/adr/0052's single military
// namespace, as one sub-object: `flightData.military.carrier` (the way §9.4's MTR
// fields are `flightData.military.mtr`). Round-1 question Q63, supervisor default
// (a). flight-data-store.js's `setCarrier` writes it on first use (it is not in
// defaultMilitary()); this module defines the
// shape, the validators and the restore normaliser.
//
// Provenance:
//   §9.12 (binding)  — EEAT survives launch → recovery (rule 7); store the
//                      approach BUTTON, never a frequency (rule 6); the
//                      marshal message's sixteen fields in their order.
//   decisions H31    — approach buttons: a validated integer, no defaults.
//   comm card        — approach types and the button rule are config/comm-card.json (R3-53, DATA-3), [SOURCE-DEFINED]
//                      until the squadron fills it in; the fuel
//                      sanity bound; BINGO_FIELD_MAX_LEN is an engineering
//                      bound, not a rule.
//
// FUEL/LOW STATE is `lowStateLb` here, not guide M17 `military.fuelState`:
// §6.4 defines M17 as "fuel state / playtime remaining" (endurance, a TIME,
// per DD-175), where the carrier low state is pounds of fuel. Two units, two
// fields — docs/adr/0064 records it.

const { displayBearing } = require('./ship-state');

const { loadCommCard } = require('../../comm-card');

// Read on first use (a bad file stops start-up: the carrier store validates a field then), not when this file is required (P5).
let _commCard = null;
function commCard() { return _commCard || (_commCard = loadCommCard()); }
/** The approach types the comm card lists. */
function approachTypes() { return Object.freeze([...commCard().approachTypes]); }
const FUEL_MAX_LB = 100000; // [SOURCE-DEFINED] sanity bound
const BINGO_FIELD_MAX_LEN = 32; // engineering bound on the typed field, not a rule

const APPROACH_TURNS_NM = Object.freeze([4, 6, 8]); // decisions H118: "the assigned approach turn (4, 6 or 8 nm)"
const RULE_6 = 'store the approach button, not a frequency (§9.12 rule 6)';

function defaultCarrierFlight() {
  return {
    eeatUtc: null,        // epoch ms, mission Zulu (decisions H11) — issued before launch (§9.12 rule 7)
    approachType: null,   // one of approachTypes()
    approachButton: null, // integer — a BUTTON, never a frequency (§9.12 rule 6)
    bingoField: null,     // ICAO or name
    bingoFuelLb: null,    // integer lb
    lowStateLb: null,     // integer lb — the marshal message's FUEL/LOW STATE
    sideNumber: null,     // the aircraft's side number (modex), 1-8 letters or digits: how the carrier regime names it (docs/adr/0114, H117)
    approachTurnNm: null, // the DME at which this flight turns onto final after a bolter or waveoff: 4, 6 or 8 (H118)
  };
}

const CARRIER_FLIGHT_FIELDS = Object.freeze(Object.keys(defaultCarrierFlight()));

function _fail(detail) {
  return { ok: false, reason: 'VALIDATION_ERROR', detail };
}

function _isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The button rule is the comm card's: while `approachButtons.buttons` is empty any integer in min..max (H31, no
 * defaults until the squadron supplies its buttons); once it lists some, membership in `buttons[].button`.
 */
function _validateButton(value, card = commCard()) {
  const { min, max, buttons } = card.approachButtons;
  const listed = buttons.map((e) => e.button);
  const rule = listed.length
    ? `one of ${listed.join(', ')} (the squadron's list, config/comm-card.json approachButtons.buttons)`
    : `an integer ${min}..${max} (config/comm-card.json approachButtons min/max)`;
  let v = value;
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^\d+$/.test(t)) v = Number(t);
    else if (/^\d+[.,]\d*$/.test(t)) return _fail(`'${value}' looks like a frequency — ${RULE_6}`);
    else return _fail(`approachButton must be ${rule}`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return _fail(`approachButton must be ${rule}`);
  if (!Number.isInteger(v) || v >= 100) return _fail(`${value} looks like a frequency — ${RULE_6}`);
  if (listed.length ? !listed.includes(v) : (v < min || v > max)) return _fail(`approachButton must be ${rule}`);
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
function validateCarrierFlightField(field, value, card = commCard()) {
  if (!CARRIER_FLIGHT_FIELDS.includes(field)) return _fail(`unknown carrier field '${field}'`);
  if (value === null) return { ok: true, value: null };
  switch (field) {
    case 'eeatUtc':
      if (typeof value !== 'number' || !Number.isFinite(value)) return _fail('eeatUtc must be epoch ms (mission Zulu)');
      return { ok: true, value };
    case 'approachType': {
      const t = typeof value === 'string' ? value.trim().toUpperCase() : null;
      if (!card.approachTypes.includes(t)) return _fail(`approachType must be one of ${card.approachTypes.join(', ')} (config/comm-card.json approachTypes)`);
      return { ok: true, value: t };
    }
    case 'approachButton':
      return _validateButton(value, card);
    case 'bingoField': {
      const t = typeof value === 'string' ? value.trim().toUpperCase() : '';
      if (!t) return _fail('bingoField must be an airfield ICAO code or name');
      if (t.length > BINGO_FIELD_MAX_LEN) return _fail(`bingoField is longer than ${BINGO_FIELD_MAX_LEN} characters`);
      return { ok: true, value: t };
    }
    case 'bingoFuelLb':
    case 'lowStateLb':
      return _validateFuel(field, value);
    case 'approachTurnNm': {
      const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
      if (!APPROACH_TURNS_NM.includes(n)) return _fail(`approachTurnNm must be one of ${APPROACH_TURNS_NM.join(', ')} (the assigned approach turn, nm DME)`);
      return { ok: true, value: n };
    }
    case 'sideNumber': {
      const t = typeof value === 'number' ? String(value) : (typeof value === 'string' ? value.trim() : '');
      if (!/^[A-Za-z0-9]{1,8}$/.test(t)) return _fail('sideNumber must be 1 to 8 letters or digits');
      return { ok: true, value: t.toUpperCase() };
    }
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
 * Restore path, and the read path for flight data that has no carrier
 * namespace yet: a missing namespace or key becomes its default (§12's "present and
 * unpopulated" promise — flight-data-store.js's ensureMilitary reasoning); an invalid
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

/** The carrier record of flight data, wherever it is in its life. */
function carrierFlightOf(flightData) {
  return normalizeCarrierFlight(_isObj(flightData) && _isObj(flightData.military) ? flightData.military.carrier : null);
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
 * @param {object} args.flightData        the flight data; carrier fields are read from flightData.military.carrier
 * @param {object} [args.derived]  marshal-stack.deriveEntry() for this flight, or null
 * @param {string} [args.caseValue] the recovery Case (the record's value)
 * @param {object} [args.shipState]
 * @param {object} [args.state]    the resolved carrier state (carrier-state.js, ADR 0113): the altimeter in force and the
 *                                 ship's weather come from it, overrides included; without it the banner's altimeter is used
 * @param {*}      [args.shipWx]   overrides the weather built from `state`
 * @param {number} [args.magneticVariationDeg]
 */
function marshalMessage({ flightData = null, derived = null, caseValue = null, shipState = null, state = null, shipWx = null, magneticVariationDeg = null } = {}) {
  const identity = _isObj(flightData) && _isObj(flightData.identity) ? flightData.identity : {};
  const c = carrierFlightOf(flightData);
  const d = _isObj(derived) ? derived : {};
  const s = _isObj(shipState) ? shipState : {};
  const ref = s.headingRef === 'GRID' ? 'GRID' : 'TRUE';
  const wx = _isObj(state) && _isObj(state.weather) ? state.weather : null;
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
    altimeter: (wx ? wx.altimeter.value : s.altimeterInHg) ?? null,
    shipWx: shipWx ?? (wx ? { ceilingFt: wx.ceiling.value, visibilityNm: wx.visibility.value, windOverDeckKt: wx.windOverDeck.value } : null),
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
  APPROACH_TURNS_NM,
  approachTypes,
  CARRIER_FLIGHT_FIELDS,
  MARSHAL_MESSAGE_FIELDS,
  defaultCarrierFlight,
  validateCarrierFlightField,
  setCarrierFlightField,
  normalizeCarrierFlight,
  carrierFlightOf,
  marshalMessage,
};
