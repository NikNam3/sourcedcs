import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* Block 3, the aircraft data (live test T7, decisions.md H134 LT-RQ1 c / LT-RQ2 b).
 *
 * The controller types Block 3 as one field in ICAO order, `[count/]TYPE[/WAKE]` (`F16/M`, `2/F16/M`); the wake is
 * the ICAO category L/M/H/J, derived from the type where aircraft-data.js's table has it, and a typed one overrides.
 * `M/F16` (the wake first) is read the same way. A type that is not a designator shape is refused. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-aircraft-data-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { parseAircraftData, wakeCategoryForType, normalizeAircraftType, normalizeWakeCategory, WAKE_BY_TYPE, WAKE_CATEGORIES } =
  await import('../src/efsp/aircraft-data.js');
const { createEfsp } = await import('../src/efsp/index.js');
const { freshEfsp, act, mustAct } = await import('./helpers/efsp-scenario.mjs');

// ── the parser ──────────────────────────────────────────────────────────────

test('Block 3 parses TYPE, TYPE/WAKE, count/TYPE/WAKE, in any case', () => {
  assert.deepEqual(parseAircraftData('F16'), { ok: true, count: 1, type: 'F16', wake: '' });
  assert.deepEqual(parseAircraftData('f16/m'), { ok: true, count: 1, type: 'F16', wake: 'M' });
  assert.deepEqual(parseAircraftData('2/F16/M'), { ok: true, count: 2, type: 'F16', wake: 'M' });
  assert.deepEqual(parseAircraftData(' 4 / K35R / H '), { ok: true, count: 4, type: 'K35R', wake: 'H' });
  assert.deepEqual(parseAircraftData('2/F16'), { ok: true, count: 2, type: 'F16', wake: '' });
});

test('the wake typed first (M/F16) is read as type F16, wake M: a single letter is never a designator', () => {
  assert.deepEqual(parseAircraftData('M/F16'), { ok: true, count: 1, type: 'F16', wake: 'M' });
  assert.deepEqual(parseAircraftData('2/H/B763'), { ok: true, count: 2, type: 'B763', wake: 'H' });
});

test('a type that is not a designator shape is refused, and the refusal says the shape', () => {
  for (const bad of ['F-16', 'F16C_50', '16', 'VIPER11', 'FA-18C']) {
    const r = parseAircraftData(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.detail, /designator|Block 3 is TYPE\/WAKE/, bad);
  }
  assert.match(parseAircraftData('F-16').detail, /not an aircraft type designator: a type designator is 2 to 4 letters or digits/);
});

test('a wake that is not L, M, H or J is refused (the FAA CWT letters are not taken)', () => {
  for (const bad of ['F16/D', 'F16/G', 'G/F16']) {
    const r = parseAircraftData(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.detail, /is not a wake category: the wake category is L, M, H or J/, bad);
  }
});

test('no leading slant, no empty part, no equipment suffix, a count of 1 to 99', () => {
  assert.equal(parseAircraftData('/F16').ok, false, 'no leading slant');
  assert.equal(parseAircraftData('F16//M').ok, false);
  assert.equal(parseAircraftData('').ok, false);
  assert.equal(parseAircraftData('2/').ok, false);
  const suffix = parseAircraftData('F16/M/G');
  assert.equal(suffix.ok, false);
  assert.match(suffix.detail, /equipment suffix comes from the equipment codes/);
  assert.equal(parseAircraftData('0/F16').ok, false);
  assert.equal(parseAircraftData('100/F16').ok, false);
  assert.equal(parseAircraftData('F16/F15').ok, false, 'two types');
});

test('the wake table: ICAO letters only, the quoted JO 7360.1K rows as quoted', () => {
  for (const [type, wake] of Object.entries(WAKE_BY_TYPE)) {
    assert.ok(WAKE_CATEGORIES.includes(wake), type);
    assert.match(type, /^[A-Z][A-Z0-9]{1,3}$/, `${type} is a designator shape`);
  }
  assert.deepEqual(['F16', 'K35R', 'B763', 'C130', 'T38', 'A10'].map(wakeCategoryForType), ['M', 'H', 'H', 'M', 'L', 'M']);
  assert.equal(wakeCategoryForType('f16'), 'M');
  assert.equal(wakeCategoryForType('ZZZ9'), '');
  assert.equal(wakeCategoryForType(null), '');
});

test('3A and 3B normalise on their own', () => {
  assert.deepEqual(normalizeAircraftType(' k35r '), { ok: true, value: 'K35R' });
  assert.deepEqual(normalizeAircraftType(''), { ok: true, value: '' });
  assert.equal(normalizeAircraftType('M/F16').ok, false);
  assert.deepEqual(normalizeWakeCategory('h'), { ok: true, value: 'H' });
  assert.deepEqual(normalizeWakeCategory(''), { ok: true, value: '' });
  assert.equal(normalizeWakeCategory('D').ok, false);
});

// ── through the Board ──────────────────────────────────────────────────────

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK' };

function setup(flightData = {}) {
  const { efsp, c } = freshEfsp(createEfsp, ATC);
  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE',
    flightData: { callsign: 'VIPER1', aircraftType: 'F16', departureAirport: 'LTAG', destinationAirport: 'LTAG', ...flightData },
  });
  const fd = () => efsp.flightDataStore.getFlightData(strip.flightDataId);
  return { efsp, c, strip, fd };
}

test('a new Strip takes its wake from the type; a plan\'s ICAO wake is kept; a non-ICAO one is replaced', () => {
  let { fd } = setup();
  assert.equal(fd().identity.wakeCategory, 'M');
  assert.equal(fd().provenance['identity.wakeCategory'], 'COMPUTER_GENERATED');
  ({ fd } = setup({ aircraftType: 'F16', wakeCategory: 'h' }));
  assert.equal(fd().identity.wakeCategory, 'H', 'the DD-1801 WTC wins');
  assert.equal(fd().provenance['identity.wakeCategory'], undefined);
  ({ fd } = setup({ aircraftType: 'F16', wakeCategory: 'D' }));
  assert.equal(fd().identity.wakeCategory, 'M');
  ({ fd } = setup({ aircraftType: 'ZZZ9' }));
  assert.equal(fd().identity.wakeCategory, '', 'no row, no wake: nothing made up');
});

test('SetBlock 3 writes count, type and wake together; with no wake typed the type gives it', () => {
  const { efsp, c, strip, fd } = setup();
  let s = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId: '3', value: '2/K35R' });
  assert.deepEqual([fd().identity.flightSize, fd().identity.aircraftType, fd().identity.wakeCategory], [2, 'K35R', 'H']);
  assert.equal(fd().provenance['identity.wakeCategory'], 'COMPUTER_GENERATED');
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'SetBlock', blockId: '3', value: 'm/f16' });
  assert.deepEqual([fd().identity.flightSize, fd().identity.aircraftType, fd().identity.wakeCategory], [1, 'F16', 'M']);
  assert.equal(fd().provenance['identity.wakeCategory'], 'CONTROLLER_ENTERED', 'a typed wake is the override');
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'SetBlock', blockId: '3', value: 'F16/H' });
  assert.equal(fd().identity.wakeCategory, 'H', 'the controller may override the table');
});

test('SetBlock 3 with a bad type is refused and leaves the flight data as it was', () => {
  const { efsp, c, strip, fd } = setup();
  const rev = fd().rev;
  const ack = act(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId: '3', value: 'F-16C' });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'VALIDATION_ERROR');
  assert.match(ack.detail, /not an aircraft type designator/);
  assert.equal(fd().rev, rev);
  assert.equal(fd().identity.aircraftType, 'F16');
});

test('3A re-derives the wake for the new type; 3B is the override and takes only L/M/H/J', () => {
  const { efsp, c, strip, fd } = setup();
  let s = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId: '3B', value: 'l' });
  assert.equal(fd().identity.wakeCategory, 'L');
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'SetBlock', blockId: '3A', value: 'c17' });
  assert.deepEqual([fd().identity.aircraftType, fd().identity.wakeCategory], ['C17', 'H']);
  const bad = act(efsp, c.OPS, 'OPS', s, { kind: 'SetBlock', blockId: '3B', value: 'D' });
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /L, M, H or J/);
  const badType = act(efsp, c.OPS, 'OPS', s, { kind: 'SetBlock', blockId: '3A', value: 'F-16' });
  assert.equal(badType.ok, false);
});

// S-ARCH-53: an ATO's or a DD-1801's type name becomes the ICAO Doc 8643 designator where it enters.
test('designatorFor: military names map to their Doc 8643 designator, designators stay, the unknown is kept as given', async () => {
  const { designatorFor, wakeCategoryForType } = await import('../src/efsp/aircraft-data.js');
  const cases = {
    'F-16C': 'F16', 'F-16CM': 'F16', 'F/A-18C': 'F18H', 'FA-18C': 'F18H', 'F/A-18E': 'F18S', 'F-15E': 'F15', 'F-15C': 'F15',
    'KC-135R': 'K35R', KC135: 'K35R', 'C-130J': 'C130', 'E-3A': 'E3TF', E3: 'E3TF', 'A-10C': 'A10', 'AV-8B': 'HAR',
    'Su-33': 'SU27', 'JF-17': 'FC1', 'MiG-29S': 'MG29', 'Tu-95': 'TU95', 'Il-78': 'IL76', 'AH-64D': 'H64',
    F16: 'F16', B738: 'B738', ' f16 ': 'F16', '': '', 'F-16C BLOCK 99': 'F-16C BLOCK 99',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(designatorFor(from), to, from);
  assert.equal(designatorFor(null), '');
  assert.equal(wakeCategoryForType(designatorFor('F-16C')), 'M');
});

test('the wake table and the name map hold only designator shapes, and every mapped designator has a wake', async () => {
  const { WAKE_BY_TYPE, DESIGNATOR_BY_NAME, isDesignatorShape, isWakeCategory } = await import('../src/efsp/aircraft-data.js');
  for (const [d, w] of Object.entries(WAKE_BY_TYPE)) {
    assert.ok(isDesignatorShape(d), d);
    assert.ok(isWakeCategory(w), `${d}: ${w}`);
  }
  // Checked against ICAO Doc 8643 on 2026-10-16: F15E, F18, SU30, SU33, JF17, C5, IL78, T95 and T45 are not designators.
  for (const gone of ['F15E', 'F18', 'SU30', 'SU33', 'JF17', 'C5', 'IL78', 'T95', 'T45']) assert.equal(WAKE_BY_TYPE[gone], undefined, gone);
  for (const [name, d] of Object.entries(DESIGNATOR_BY_NAME)) {
    assert.ok(WAKE_BY_TYPE[d], `${name} -> ${d} has no wake row`);
    assert.equal(WAKE_BY_TYPE[name], undefined, `${name} is a designator itself`);
  }
});
