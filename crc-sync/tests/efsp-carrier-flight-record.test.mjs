import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROACH_TYPES, CARRIER_FLIGHT_FIELDS, MARSHAL_MESSAGE_FIELDS,
  defaultCarrierFlight, validateCarrierFlightField, setCarrierFlightField, normalizeCarrierFlight,
  carrierFlightOf, marshalMessage,
} from '../src/efsp/carrier/flight-record.js';
import { deriveEntry } from '../src/efsp/carrier/marshal-stack.js';

// Guide §9.12 rules 6 and 7, and the marshal message. docs/adr/0064.

const T = Date.UTC(2026, 8, 30, 13, 45, 0);

test('defaults: every field present and null', () => {
  assert.deepEqual(defaultCarrierFlight(), {
    eeatUtc: null, approachType: null, approachButton: null, bingoField: null, bingoFuelLb: null, lowStateLb: null,
  });
  assert.deepEqual([...CARRIER_FLIGHT_FIELDS], Object.keys(defaultCarrierFlight()));
  assert.notEqual(defaultCarrierFlight(), defaultCarrierFlight(), 'a fresh object each time');
  assert.deepEqual([...APPROACH_TYPES], ['TACAN', 'ICLS', 'ACLS', 'PAR', 'VISUAL']);
});

test('validators accept and normalise good values', () => {
  assert.deepEqual(validateCarrierFlightField('eeatUtc', T), { ok: true, value: T });
  assert.deepEqual(validateCarrierFlightField('approachType', ' icls '), { ok: true, value: 'ICLS' });
  assert.deepEqual(validateCarrierFlightField('approachButton', 15), { ok: true, value: 15 });
  assert.deepEqual(validateCarrierFlightField('approachButton', '3'), { ok: true, value: 3 });
  assert.deepEqual(validateCarrierFlightField('bingoField', 'lcra'), { ok: true, value: 'LCRA' });
  assert.deepEqual(validateCarrierFlightField('bingoFuelLb', 4500.4), { ok: true, value: 4500 });
  assert.deepEqual(validateCarrierFlightField('lowStateLb', 6200), { ok: true, value: 6200 });
  for (const f of CARRIER_FLIGHT_FIELDS) assert.deepEqual(validateCarrierFlightField(f, null), { ok: true, value: null });
});

test('validators refuse bad values', () => {
  const bad = [
    ['nope', 1],
    ['eeatUtc', 'soon'],
    ['eeatUtc', NaN],
    ['approachType', 'ILS'],
    ['approachButton', 0],
    ['approachButton', 21],
    ['approachButton', 'x'],
    ['bingoField', '   '],
    ['bingoField', 'X'.repeat(40)],
    ['bingoFuelLb', -1],
    ['lowStateLb', -100],
    ['lowStateLb', '6000'],
  ];
  for (const [f, v] of bad) {
    const r = validateCarrierFlightField(f, v);
    assert.equal(r.ok, false, `${f}=${v}`);
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
});

test('a frequency-shaped approach button is refused with the §9.12 rule 6 message', () => {
  for (const v of [250.3, '251.000', '264,0', 251, 305]) {
    const r = validateCarrierFlightField('approachButton', v);
    assert.equal(r.ok, false, String(v));
    assert.match(r.detail, /store the approach button, not a frequency \(§9\.12 rule 6\)/);
  }
});

test('setCarrierFlightField returns a new object and leaves the input alone', () => {
  const a = Object.freeze(defaultCarrierFlight());
  const r = setCarrierFlightField(a, 'eeatUtc', T);
  assert.equal(r.ok, true);
  assert.equal(r.flight.eeatUtc, T);
  assert.equal(a.eeatUtc, null);
  assert.equal(setCarrierFlightField(a, 'approachButton', 250.3).ok, false);
});

test('normalizeCarrierFlight: missing → defaults; a set EEAT survives; junk dropped', () => {
  assert.deepEqual(normalizeCarrierFlight(undefined), defaultCarrierFlight());
  assert.deepEqual(normalizeCarrierFlight(null), defaultCarrierFlight());
  const n = normalizeCarrierFlight({ eeatUtc: T, approachButton: 999, junk: true });
  assert.equal(n.eeatUtc, T);
  assert.equal(n.approachButton, null);
  assert.equal('junk' in n, false);
  assert.deepEqual(normalizeCarrierFlight(normalizeCarrierFlight(n)), n, 'idempotent');
});

test('carrierFlightOf reads fdr.military.carrier; an FDR from before L17 reads as defaults', () => {
  assert.deepEqual(carrierFlightOf({ military: null }), defaultCarrierFlight());
  assert.deepEqual(carrierFlightOf({}), defaultCarrierFlight());
  assert.equal(carrierFlightOf({ military: { carrier: { eeatUtc: T } } }).eeatUtc, T);
});

test('marshalMessage: the sixteen fields in §9.12 order; blanks are null, not missing', () => {
  const labels = marshalMessage({ fdr: {} }).map((x) => x.label);
  assert.deepEqual(labels, [
    'CALLSIGN', 'TYPE', 'CASE', 'APPROACH TYPE', 'MARSHAL RADIAL', 'MARSHAL DME', 'ANGELS', 'EAT/PUSH',
    'EXPECTED FINAL BEARING', 'APPROACH BUTTON', 'ALTIMETER', 'SHIP WX', 'FUEL/LOW STATE', 'BINGO FIELD',
    'BINGO FUEL', 'EEAT',
  ]);
  assert.equal(MARSHAL_MESSAGE_FIELDS.length, 16);
  for (const item of marshalMessage({ fdr: {} })) {
    assert.ok('value' in item, item.key);
    assert.equal(item.value, null, item.key);
  }
  assert.equal(marshalMessage().length, 16, 'never throws on no input');
});

test('marshalMessage fills from FDR, derivation and ship state; bearings display magnetic', () => {
  const fdr = {
    identity: { callsign: 'HORNET 11', aircraftType: 'FA18C' },
    military: { carrier: { eeatUtc: T, approachType: 'ICLS', approachButton: 15, bingoField: 'LCRA', bingoFuelLb: 4500, lowStateLb: 7200 } },
  };
  const shipState = { finalBearingDeg: 115, altimeterInHg: 29.92, headingRef: 'TRUE' };
  const derived = deriveEntry({ fdrId: 'f', stackIndex: 2, status: 'HOLDING', caseIAngels: null },
    { caseValue: 'III', charlieTimeUtc: T + 3_600_000, shipState });
  const m = Object.fromEntries(marshalMessage({ fdr, derived, caseValue: 'III', shipState, magneticVariationDeg: 5 }).map((x) => [x.key, x]));
  assert.equal(m.callsign.value, 'HORNET 11');
  assert.equal(m.type.value, 'FA18C');
  assert.equal(m.case.value, 'III');
  assert.equal(m.marshalRadial.value, 295);
  assert.deepEqual(m.marshalRadial.display, { value: 290, ref: 'M' });
  assert.equal(m.marshalDme.value, 23);
  assert.equal(m.angels.value, 8);
  assert.equal(m.eatPush.value, T + 3_600_000 + 120_000);
  assert.equal(m.expectedFinalBearing.value, 115);
  assert.deepEqual(m.expectedFinalBearing.display, { value: 110, ref: 'M' });
  assert.equal(m.approachButton.value, 15);
  assert.equal(m.altimeter.value, 29.92);
  assert.equal(m.fuelLowState.value, 7200);
  assert.equal(m.bingoField.value, 'LCRA');
  assert.equal(m.bingoFuel.value, 4500);
  assert.equal(m.eeat.value, T);
});
