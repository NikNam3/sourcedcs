import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIELDS, FIELD_NAMES, OVERRIDE_KEYS, emptyOverrides, normalizeOverrides, validateField, windOverDeckKt, resolveState, recoveryInputs,
} from '../src/efsp/carrier/carrier-state.js';
import { loadRecoveryTuning } from '../src/efsp/carrier/recovery-tuning.js';
import { buildShipState } from '../src/efsp/carrier/ship-state.js';
import { initialRecoveryCase, clearCase, setCase } from '../src/efsp/carrier/recovery-case.js';
import { getDefaultHull } from '../src/efsp/carrier/hull-config.js';

// The carrier state (docs/adr/0113): every value with a source and an optional override. Pure.

const HULL = Object.freeze(getDefaultHull());
const TUNING = loadRecoveryTuning();
const NOW = Date.UTC(2026, 9, 8, 20, 0, 0);
const ship = (o = {}) => buildShipState({
  hull: HULL, now: NOW, weatherPa: 101325, gridConvergenceDeg: 0,
  track: { id: 1, name: 'UNION', type: 'CVN_72', category: 4, heading: 346, groundSpeed: 8, lat: 36, lon: 34, ...o },
});
const resolve = (over = {}, extra = {}) => resolveState({
  overrides: { ...emptyOverrides(), ...over }, recoveryCase: initialRecoveryCase(), shipState: ship(), hull: HULL,
  shipWind: null, tuning: TUNING, variationDeg: 5, ...extra,
});

test('the shipped recovery tuning is the JSON: first fix 21 DME, one-minute spacing, six minutes fix-to-ramp', () => {
  assert.equal(TUNING.firstFixDme, 21);
  assert.equal(TUNING.pushSpacingMs, 60_000);
  assert.equal(TUNING.fixToRampMs, 360_000);
  assert.deepEqual({ ...TUNING.tanker }, { altitudeFt: 6000, patternSide: 'port' });
});

test('defaults: BRC from DCS, final bearing BRC less the angled deck, radial the reciprocal, each with its source', () => {
  const st = resolve();
  assert.deepEqual([st.brc.value, st.brc.source, st.brc.override], [346, 'dcs', null]);
  assert.deepEqual([st.finalBearing.value, st.finalBearing.source], [337, 'default']);
  assert.deepEqual([st.radial.value, st.radial.source], [157, 'default']);
  assert.deepEqual([st.firstFix.value, st.firstFix.source], [21, 'default']);
  assert.deepEqual([st.case.value, st.case.source], ['III', 'default']);
  assert.deepEqual(st.radial.display, { value: 152, ref: 'M' }, 'headings are magnetic at display (H15)');
  assert.equal(st.weather.altimeter.source, 'dcs');
  assert.equal(st.weather.altimeter.value, 29.92);
});

test('values with nothing behind them say so: ramp time, ceiling, visibility, tanker side number and give are source none', () => {
  const st = resolve();
  for (const e of [st.rampTime, st.weather.ceiling, st.weather.visibility, st.tanker.sideNumber, st.tanker.give]) {
    assert.deepEqual([e.value, e.source], [null, 'none']);
  }
  assert.deepEqual([st.tanker.altitude.value, st.tanker.altitude.source], [6000, 'default']);
  assert.deepEqual([st.tanker.patternSide.value, st.tanker.onStation.value], ['port', false]);
});

test('an override wins and keeps the automatic value beside it; the values derived from it follow', () => {
  const st = resolve({ brcDeg: 100 });
  assert.deepEqual([st.brc.value, st.brc.source, st.brc.override, st.brc.default], [100, 'override', 100, 346]);
  assert.equal(st.finalBearing.value, 91, 'final bearing follows an overridden BRC');
  assert.equal(st.finalBearing.source, 'default');
  assert.equal(st.radial.value, 271);
  const both = resolve({ brcDeg: 100, finalBearingDeg: 120 });
  assert.deepEqual([both.finalBearing.value, both.finalBearing.source, both.radial.value], [120, 'override', 300]);
  const radial = resolve({ marshalRadialDeg: 150 });
  assert.deepEqual([radial.radial.value, radial.radial.source], [150, 'override']);
  assert.equal(recoveryInputs(radial, TUNING).marshalRadialSource, 'SET');
  assert.equal(recoveryInputs(resolve(), TUNING).marshalRadialSource, 'FINAL_BEARING');
});

test('no ship and nothing typed: no BRC, no final bearing, no radial; a typed BRC alone is enough', () => {
  const none = resolve({}, { shipState: buildShipState({ hull: HULL, track: null, now: NOW, weatherPa: 101325 }) });
  assert.deepEqual([none.brc.value, none.brc.source, none.finalBearing.value, none.radial.value], [null, 'none', null, null]);
  assert.equal(none.weather.altimeter.value, 29.92, 'the theater pressure needs no ship');
  const typed = resolve({ brcDeg: 90 }, { shipState: null });
  assert.deepEqual([typed.brc.value, typed.finalBearing.value, typed.radial.value], [90, 81, 261]);
});

test('a GRID heading stays GRID until a controller types a true one', () => {
  const grid = resolve({}, { shipState: buildShipState({ hull: HULL, now: NOW, track: { id: 1, name: 'UNION', category: 4, heading: 346, groundSpeed: 8, lat: 36, lon: 34 } }) });
  assert.equal(grid.brc.ref, 'GRID');
  assert.equal(grid.brc.display.ref, 'G');
  assert.equal(grid.radial.ref, 'GRID');
  const typed = resolve({ brcDeg: 100 }, { shipState: buildShipState({ hull: HULL, now: NOW, track: { id: 1, name: 'UNION', category: 4, heading: 346, groundSpeed: 8, lat: 36, lon: 34 } }) });
  assert.equal(typed.brc.ref, 'TRUE');
});

test('wind over deck is the wind plus the ship speed head-on, less from astern, and a crosswind is the hypotenuse', () => {
  const s = { headingDeg: 346, speedKt: 20 };
  assert.equal(windOverDeckKt({ windFromDeg: 346, windKt: 10 }, s), 30, 'wind dead ahead adds');
  assert.equal(windOverDeckKt({ windFromDeg: 166, windKt: 10 }, s), 10, 'from astern the ship outruns half of it');
  assert.equal(windOverDeckKt({ windFromDeg: 76, windKt: 15 }, s), 25, 'a 15 kt crosswind on 20 kt of ship is 25');
  assert.equal(windOverDeckKt(null, s), null);
  assert.equal(windOverDeckKt({ windFromDeg: 0, windKt: 5 }, { headingDeg: null, speedKt: 5 }), null);
  const st = resolve({}, { shipWind: { windFromDeg: 346, windKt: 10 } });
  assert.equal(st.weather.windOverDeck.source, 'dcs');
  assert.equal(st.weather.windOverDeck.value, 26, '10 kt of wind + 8 m/s (the banner rounds it to 16 kt) of ship');
  assert.equal(resolve({ windOverDeckKt: 31 }, { shipWind: { windFromDeg: 346, windKt: 10 } }).weather.windOverDeck.source, 'override');
});

test('the Case is an override once somebody set it, the default again once cleared', () => {
  const set = setCase(initialRecoveryCase(), 'II', { by: 'u1', at: NOW });
  assert.equal(resolve({}, { recoveryCase: set.case }).case.source, 'override');
  const cleared = clearCase(set.case, { by: 'u1', at: NOW });
  assert.equal(cleared.ok, true);
  assert.deepEqual([cleared.case.value, cleared.case.setBy, cleared.case.history.length], ['III', null, 2]);
  assert.equal(resolve({}, { recoveryCase: cleared.case }).case.source, 'default');
  assert.equal(clearCase(initialRecoveryCase(), { at: NOW }).ok, false, 'already the default');
});

test('validateField: a typed bearing is magnetic and becomes true; the variation must be known', () => {
  const v = validateField('brc', '341', { variationDeg: 5 });
  assert.deepEqual([v.ok, v.key, v.stored], [true, 'brcDeg', 346]);
  assert.equal(validateField('radial', 360, { variationDeg: 5 }).stored, 5);
  assert.equal(validateField('brc', 341, { variationDeg: null }).ok, false);
  assert.match(validateField('brc', 341, { variationDeg: null }).detail, /magnetic variation/);
  for (const bad of [-1, 361, 'abc', NaN]) assert.equal(validateField('finalBearing', bad, { variationDeg: 5 }).ok, false, String(bad));
});

test('validateField: empty or null clears; a Zulu HHMM goes on the mission day; numbers are bounded and rounded', () => {
  for (const f of Object.keys(FIELDS)) assert.deepEqual([validateField(f, null).ok, validateField(f, null).stored, validateField(f, '').stored], [true, null, null], f);
  const t = validateField('rampTime', '2040', { now: NOW });
  assert.equal(t.stored, Date.UTC(2026, 9, 8, 20, 40));
  assert.equal(validateField('rampTime', '2560', { now: NOW }).ok, false);
  assert.equal(validateField('altimeter', '29.876').stored, 29.88);
  assert.equal(validateField('altimeter', 35).ok, false);
  assert.equal(validateField('firstFix', 25).stored, 25);
  assert.equal(validateField('firstFix', 9).ok, false);
  assert.equal(validateField('ceiling', 800.4).stored, 800);
  assert.equal(validateField('ceiling', -1).ok, false);
  assert.equal(validateField('visibility', '3.25').stored, 3.3);
  assert.equal(validateField('tankerSide', ' ab701 ').stored, 'AB701');
  assert.equal(validateField('tankerSide', 'no way!').ok, false);
  assert.equal(validateField('tankerPatternSide', 'stbd').stored, 'stbd');
  assert.equal(validateField('tankerPatternSide', 'left').ok, false);
  assert.equal(validateField('tankerOnStation', true).stored, true);
  assert.equal(validateField('tankerOnStation', 'yes').ok, false);
  assert.equal(validateField('tankerGive', 4).stored, 4);
  assert.equal(validateField('nonsense', 1).ok, false);
});

test('every editable field has its own override key, and normalizeOverrides keeps only what checks', () => {
  assert.equal(new Set(OVERRIDE_KEYS).size, Object.keys(FIELDS).length);
  assert.ok(FIELD_NAMES.includes('case'));
  const n = normalizeOverrides({ brcDeg: 100, firstFixDme: 3, altimeterInHg: 99, tankerPatternSide: 'stbd', rampTimeUtc: 'x', junk: 1 });
  assert.deepEqual([n.brcDeg, n.firstFixDme, n.altimeterInHg, n.tankerPatternSide, n.rampTimeUtc], [100, null, null, 'stbd', null]);
  assert.equal('junk' in n, false);
  assert.deepEqual(normalizeOverrides(null), emptyOverrides());
});
