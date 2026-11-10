// The per-Position field lists (strip-fields.js, docs/adr/0056) and the rules
// they were written to. Each rule came from a controller reading the Strip:
// a field a Position never uses costs Strip height on every flight.
// Reachability — everything left off is still in the expanded view — is held
// by efsp-ui-reachability.test.mjs, per (strip type, Position).

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCK_MAPS } from '../app/public/js/panels/efsp/strip-template.js';
import { COMPACT_BLOCKS_BY_POSITION, compactBlocksFor, fieldSpanFor, MTR_BLOCKS_BY_POSITION, leadingFlightName, isCarrierStrip, CASE_I_HIDDEN_BLOCKS } from '../app/public/js/panels/efsp/strip-fields.js';
import { hasMtrData, mtrLostCommsAdvisory } from '../app/public/js/panels/efsp/mtr-advisory.js';
import { setAirportSurfacePositions } from '../app/public/js/airport-surface.js';

const everyList = () => Object.entries(COMPACT_BLOCKS_BY_POSITION)
  .flatMap(([stripType, byPos]) => Object.entries(byPos).map(([positionId, list]) => ({ stripType, positionId, list })));

test('every field a Position shows is a Block its strip type actually has', () => {
  for (const { stripType, positionId, list } of everyList()) {
    const missing = list.filter(id => !(id in BLOCK_MAPS[stripType]));
    assert.deepEqual(Array.from(missing), [], `${stripType} at ${positionId}`);
  }
});

test('TYPE already carries the aircraft and wake, so neither gets a field of its own', () => {
  for (const { stripType, positionId, list } of everyList()) {
    assert.ok(list.includes('3'), `${stripType} at ${positionId} has no TYPE`);
    assert.equal(list.includes('3A') || list.includes('3B'), false, `${stripType} at ${positionId}`);
  }
});

test('CID and TAIL are on no Strip', () => {
  for (const { stripType, positionId, list } of everyList()) {
    assert.equal(list.includes('4') || list.includes('3C'), false, `${stripType} at ${positionId}`);
  }
});

test('HOOK is Tower\'s alone', () => {
  for (const { stripType, positionId, list } of everyList()) {
    if (positionId === 'LC') continue;
    assert.equal(list.includes('3F'), false, `${stripType} at ${positionId}`);
  }
});

test('ORDNANCE: always on Tower\'s face; on APP, CTR and the tactical Positions only once it is not CLEAN (H55, S-L12)', () => {
  // decisions.md H55 and S-L12 (crc-sync's docs/adr/0069), after H51's MTR
  // precedent: a field that is almost always CLEAN earns its place on the face
  // only while it says something. Everywhere else it is in the expanded view.
  const flightData = (ordnanceState) => ({ military: { ordnanceState } });
  for (const { stripType, positionId, list } of everyList()) {
    assert.equal(list.includes('3G'), positionId === 'LC' || (positionId === 'OPS' && stripType === 'DEPARTURE'), `static list ${stripType} at ${positionId}`);
  }
  const whenSet = [
    ...['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT'].flatMap(stripType => ['AP', 'CTR'].map(p => [stripType, p])),
    ...['TAC_C2', 'AIC', 'GCI', 'JTAC'].map(p => ['MISSION', p]),
  ];
  for (const [stripType, positionId] of whenSet) {
    for (const quiet of [undefined, null, { military: null }, flightData('CLEAN'), flightData(null), flightData('')]) {
      assert.equal(compactBlocksFor(stripType, positionId, quiet).includes('3G'), false, `${stripType} at ${positionId}, ${JSON.stringify(quiet)}`);
    }
    for (const state of ['HUNG', 'LOADED', 'EXPENDED']) {
      assert.ok(compactBlocksFor(stripType, positionId, flightData(state)).includes('3G'), `${stripType} at ${positionId}, ${state}`);
    }
  }
  for (const stripType of ['DEPARTURE', 'ARRIVAL']) {
    assert.ok(compactBlocksFor(stripType, 'LC', flightData('CLEAN')).includes('3G'), `${stripType} at TWR, CLEAN`);
    assert.ok(compactBlocksFor(stripType, 'LC').includes('3G'), `${stripType} at TWR, no FDR`);
  }
  // UI-A U1: OPS records the load state, so a DEPARTURE at OPS carries it always.
  assert.ok(compactBlocksFor('DEPARTURE', 'OPS', flightData('CLEAN')).includes('3G'), 'DEPARTURE at OPS, CLEAN');
  for (const positionId of ['OPS', 'CD', 'GC']) {
    for (const stripType of ['DEPARTURE', 'ARRIVAL']) {
      if (positionId === 'OPS' && stripType === 'DEPARTURE') continue;
      assert.equal(compactBlocksFor(stripType, positionId, flightData('HUNG')).includes('3G'), false, `${stripType} at ${positionId}`);
    }
  }
});

test('a set ORDNANCE goes before the MTR group, which starts its own row', () => {
  const list = compactBlocksFor('ARRIVAL', 'AP', { military: { ordnanceState: 'HUNG', mtr: { designator: 'IR107' } } });
  assert.ok(list.includes('9G-MTR'), 'MTR group drawn');
  assert.ok(list.indexOf('3G') < list.indexOf('9G-MTR'));
});

test('a runway field only on the airfield Positions', () => {
  // The Block that is the runway differs by strip type: 8A on DEPARTURE, 8B on ARRIVAL.
  const runwayBlock = { DEPARTURE: '8A', ARRIVAL: '8B' };
  for (const { stripType, positionId, list } of everyList()) {
    const rwy = runwayBlock[stripType];
    if (!rwy || ['OPS', 'CD', 'GC', 'LC', 'AP', 'SFA'].includes(positionId)) continue;
    assert.equal(list.includes(rwy), false, `${stripType} at ${positionId} shows a runway`);
  }
});

test('FREQ only where a controller works more than one frequency', () => {
  for (const { stripType, positionId, list } of everyList()) {
    if (['OPS', 'CD', 'GC', 'LC'].includes(positionId)) {
      assert.equal(list.includes('22'), false, `${stripType} at ${positionId} sits on one frequency`);
    }
  }
  assert.ok(compactBlocksFor('DEPARTURE', 'AP').includes('22'));
  assert.ok(compactBlocksFor('DEPARTURE', 'CTR').includes('22'));
});

test('STATE is on no Strip — the tab header says it', () => {
  for (const stripType of Object.keys(BLOCK_MAPS)) {
    for (const positionId of [...Object.keys(COMPACT_BLOCKS_BY_POSITION[stripType] || {}), undefined]) {
      const list = compactBlocksFor(stripType, positionId);
      assert.equal(list.includes('25') || list.includes('M25'), false, `${stripType} at ${positionId}`);
    }
  }
});

test('a Position no list names falls back to its strip type, filtered to the strip type\'s Blocks', () => {
  const list = compactBlocksFor('ARRIVAL', 'NOBODY');
  assert.ok(list.includes('9A-VECTOR'));
  assert.equal(list.some(id => !(id in BLOCK_MAPS.ARRIVAL)), false);
});

// ── §9.4 MTR group (crc-sync's docs/adr/0062) ────────────────────────────────

const everyMtrList = () => Object.entries(MTR_BLOCKS_BY_POSITION)
  .flatMap(([stripType, byPos]) => Object.entries(byPos).map(([positionId, list]) => ({ stripType, positionId, list })));
const flightDataWithMtr = (mtr) => ({ military: { mtr }, clearance: { altitude: { entries: [] } } });

test('every MTR list names Blocks its strip type has, and only 9G-*/9H-* ids', () => {
  for (const { stripType, positionId, list } of everyMtrList()) {
    for (const id of list) {
      assert.ok(id in BLOCK_MAPS[stripType], `${stripType} at ${positionId}: ${id}`);
      assert.match(id, /^9[GH]-/, `${stripType} at ${positionId}: ${id}`);
    }
  }
});

test('every MTR list starts with 9G-MTR — the CSS row start keys on it', () => {
  for (const { stripType, positionId, list } of everyMtrList()) assert.equal(list[0], '9G-MTR', `${stripType} at ${positionId}`);
});

test('M11 is prominent: the exit fix and estimate come before the entry fields', () => {
  for (const { stripType, positionId, list } of everyMtrList()) {
    if (!list.includes('9G-ENTRY')) continue;
    for (const m11 of ['9H-EXIT', '9H-TIME']) {
      if (!list.includes(m11)) continue;
      assert.ok(list.indexOf(m11) < list.indexOf('9G-ENTRY') && list.indexOf(m11) < list.indexOf('9G-TIME'), `${stripType} at ${positionId}`);
    }
  }
});

test('GC, LC and MISSION get no MTR group', () => {
  for (const stripType of Object.keys(MTR_BLOCKS_BY_POSITION)) {
    assert.equal(MTR_BLOCKS_BY_POSITION[stripType].GC, undefined, `${stripType} GND`);
    assert.equal(MTR_BLOCKS_BY_POSITION[stripType].LC, undefined, `${stripType} TWR`);
  }
  assert.equal(MTR_BLOCKS_BY_POSITION.MISSION, undefined);
});

test('compactBlocksFor without flight data, or with one that has no MTR, is exactly what it was', () => {
  const noMtr = { ...flightDataWithMtr({ designator: null, exitFix: '' }), clearance: { altitude: { entries: [{ status: 'ACTIVE', value: 24000 }] } } };
  for (const { stripType, positionId } of everyList()) {
    assert.deepEqual(Array.from(compactBlocksFor(stripType, positionId, noMtr)), Array.from(compactBlocksFor(stripType, positionId)), `${stripType} at ${positionId}`);
    assert.equal(compactBlocksFor(stripType, positionId).some(id => /^9[GH]-/.test(id)), false);
  }
});

test('any one MTR field brings the group — the trigger is not the designator', () => {
  const list = Array.from(compactBlocksFor('DEPARTURE', 'CTR', flightDataWithMtr({ exitFix: 'F' })));
  assert.deepEqual(list.slice(-MTR_BLOCKS_BY_POSITION.DEPARTURE.CTR.length), Array.from(MTR_BLOCKS_BY_POSITION.DEPARTURE.CTR));
  assert.deepEqual(Array.from(compactBlocksFor('DEPARTURE', 'LC', flightDataWithMtr({ exitFix: 'F' }))), Array.from(compactBlocksFor('DEPARTURE', 'LC')));
});

test('hasMtrData: false for nothing, true for any one value', () => {
  for (const flightData of [null, {}, { military: null }, flightDataWithMtr({}), flightDataWithMtr({ designator: null, exitFix: '', exitEstimateUtc: null })]) {
    assert.equal(hasMtrData(flightData), false, JSON.stringify(flightData));
  }
  for (const key of ['designator', 'entryFix', 'entryTimeUtc', 'exitFix', 'exitEstimateUtc', 'requestedAltitudeAfterExit']) {
    assert.equal(hasMtrData(flightDataWithMtr({ [key]: key.endsWith('Utc') ? 1466519520000 : 'X' })), true, key);
  }
});

test('mtrLostCommsAdvisory states the rule, shows the ACTIVE ALT, admits the missing half, never reads 9H-ALT', () => {
  assert.equal(mtrLostCommsAdvisory(flightDataWithMtr({})), null);
  const flightData = {
    military: { mtr: { designator: 'IR107', requestedAltitudeAfterExit: 'FL230' } },
    clearance: { altitude: { entries: [{ value: 'FL120', status: 'SUPERSEDED' }, { value: 'FL180', status: 'ACTIVE' }] } },
  };
  const text = mtrLostCommsAdvisory(flightData);
  assert.match(text, /§9\.4/);
  assert.match(text, /FL180/);
  assert.match(text, /not available in this system/);
  assert.doesNotMatch(text, /FL230|FL120/);
  assert.match(mtrLostCommsAdvisory(flightDataWithMtr({ exitFix: 'E' })), /none posted \(ALT is empty\)/);
});

// §9.6 alert status (crc-sync docs/adr/0070, decisions.md H56).
test('ALERT (14E) is on OPS, CD, GC and LC — the ground Positions — and nowhere else', () => {
  for (const { stripType, positionId, list } of everyList()) {
    const expected = stripType === 'DEPARTURE' && ['OPS', 'CD', 'GC', 'LC'].includes(positionId);
    assert.equal(list.includes('14E'), expected, `${stripType} at ${positionId}`);
  }
  assert.equal(BLOCK_MAPS.ARRIVAL['14E'], undefined);
  assert.equal(BLOCK_MAPS.OVERFLIGHT['14E'], undefined);
  assert.equal(BLOCK_MAPS.DEPARTURE['14E'].label, 'ALERT');
});

// crc-sync docs/adr/0156: a carrier Strip carries only what its controller needs, the side number leading; the callsign is never
// on its face; a Case I flight shows no squawk, EAT or assignments.
test('carrier Strips: the ADR 0156 Blocks, side number first, no callsign on the face', () => {
  assert.deepEqual(compactBlocksFor('CV_LAUNCH', 'CV_PRIFLY', null), ['C18', 'C2', 'C20', '5', '9A-VECTOR', '9A-SPEED', '7A']);
  assert.deepEqual(compactBlocksFor('CV_RECOVERY', 'CV_MARSHAL', null), ['C18', 'C2', 'C12', 'C7', 'C8', '5', '9A-VECTOR', '9A-SPEED', '7A']);
  assert.deepEqual(compactBlocksFor('FINAL', 'PAR', null), ['C1', 'C2', '9A-VECTOR', '7A'], 'PAR keeps its talk-down');
  assert.deepEqual([...CASE_I_HIDDEN_BLOCKS].sort(), ['5', '7A', '9A-SPEED', '9A-VECTOR', 'C8']);
  assert.equal(fieldSpanFor('C18', true), fieldSpanFor('C1'), 'the side number takes the callsign\'s width');
  assert.equal(isCarrierStrip({ stripType: 'CV_RECOVERY' }), true);
  assert.equal(isCarrierStrip({ stripType: 'FINAL' }), false);
  // handed to the Marshal from CTR with no side number: the callsign leads until one is typed
  const handed = { identity: { callsign: 'VIPER11' }, military: { carrier: { sideNumber: null } } };
  assert.equal(compactBlocksFor('CV_RECOVERY', 'CV_MARSHAL', handed)[0], 'C1');
  assert.equal(compactBlocksFor('CV_RECOVERY', 'CV_MARSHAL', { ...handed, military: { carrier: { sideNumber: '301' } } })[0], 'C18');
});

test('a Case I carrier flight: no squawk, no EAT, no heading, speed or altitude on its face', async () => {
  const cs = await import('../app/public/js/panels/efsp/carrier-state.js');
  cs.applyEfspCarrierSnapshot({ carriers: [{ hullId: 'CVN-72', recoveryCase: { value: 'III' }, derived: { MAIN: [], CASE_I: [{ flightDataId: 'f1', caseValue: 'I' }] } }] });
  const strip = { stripType: 'CV_RECOVERY', state: 'STACK', flightDataId: 'f1', ownerPositionId: 'CV_MARSHAL' };
  assert.deepEqual(compactBlocksFor('CV_RECOVERY', 'CV_MARSHAL', null, strip), ['C18', 'C2', 'C12', 'C7']);
  const iii = { ...strip, flightDataId: 'f2' };
  assert.equal(compactBlocksFor('CV_RECOVERY', 'CV_MARSHAL', null, iii).includes('9A-VECTOR'), true, 'not in the Case I stack: the ship\'s Case (III)');
  cs._resetEfspCarrierStateForTest();
});

test('leadingFlightName (H124): a carrier Strip is named by its side number, else the callsign; any other Strip by the callsign', () => {
  const fd = (side) => ({ identity: { callsign: 'NAVY 1' }, military: { carrier: { sideNumber: side } } });
  assert.equal(leadingFlightName({ stripType: 'CV_RECOVERY' }, fd(' 204 ')), '204');
  assert.equal(leadingFlightName({ stripType: 'CV_LAUNCH' }, fd('  ')), 'NAVY 1', 'no side number: the callsign');
  assert.equal(leadingFlightName({ stripType: 'FINAL', ownerPositionId: 'PAR' }, fd('205')), 'NAVY 1');
  assert.equal(leadingFlightName(null, fd('205')), 'NAVY 1');
  assert.equal(leadingFlightName({ stripType: 'CV_RECOVERY' }, null), '');
});

test('a VFR strip shows callsign, type, code, VFR/ALT, HDG, SPEED, and RWY at an airport-surface Position or once set', () => {
  setAirportSurfacePositions({ INCIRLIK: ['GC', 'LC'] });
  try {
    assert.deepEqual(Array.from(compactBlocksFor('VFR', 'LC', null)), ['1', '3', '5', '7A', '9A-VECTOR', '9A-SPEED', '8A']);
    assert.deepEqual(Array.from(compactBlocksFor('VFR', 'AP', null)), ['1', '3', '5', '7A', '9A-VECTOR', '9A-SPEED']);
    assert.ok(compactBlocksFor('VFR', 'AP', { filed: { departureRunway: '23' } }).includes('8A'), 'a set runway is shown');
    for (const id of compactBlocksFor('VFR', 'LC', null)) assert.ok(BLOCK_MAPS.VFR[id], id);
    // Nothing that does not apply to a VFR: no route, destination, release, void, clearance steps.
    for (const id of ['9', '8B', '14A', '14D', '21', '10']) assert.equal(BLOCK_MAPS.VFR[id], undefined, id);
  } finally { setAirportSurfacePositions({}); }
});

// Lane U-STRIP-ATIS (human 2026-11-10): the ATIS code (Block 10) is on every ARRIVAL Strip's face, whichever Position
// holds it, and on a DEPARTURE at GC and LC (CD already had it). Same flight data field on both strip types.
test('ATIS (10) is on every ARRIVAL face and on a DEPARTURE at CD, GC and LC', () => {
  assert.deepEqual(BLOCK_MAPS.ARRIVAL['10'].target, BLOCK_MAPS.DEPARTURE['10'].target);
  assert.equal(BLOCK_MAPS.ARRIVAL['10'].label, 'ATIS');
  for (const positionId of [...Object.keys(COMPACT_BLOCKS_BY_POSITION.ARRIVAL), 'NOLIST', null]) {
    assert.ok(compactBlocksFor('ARRIVAL', positionId, null).includes('10'), `ARRIVAL at ${positionId}`);
  }
  for (const positionId of ['CD', 'GC', 'LC']) {
    assert.ok(compactBlocksFor('DEPARTURE', positionId, null).includes('10'), `DEPARTURE at ${positionId}`);
  }
  for (const positionId of ['OPS', 'AP', 'CTR']) {
    assert.equal(compactBlocksFor('DEPARTURE', positionId, null).includes('10'), false, `DEPARTURE at ${positionId}`);
  }
});
