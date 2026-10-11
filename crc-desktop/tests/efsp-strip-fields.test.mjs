// The per-Position field lists (strip-fields.js, docs/adr/0056) and the rules
// they were written to. Each rule came from a controller reading the Strip:
// a field a Position never uses costs Strip height on every flight.
// Reachability — everything left off is still in the expanded view — is held
// by efsp-ui-reachability.test.mjs, per (strip type, Position).

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCK_MAPS } from '../app/public/js/panels/efsp/strip-template.js';
import { COMPACT_BLOCKS_BY_POSITION, compactBlocksFor, fieldSpanFor, MTR_BLOCKS_BY_POSITION, leadingFlightName, sideNumberLeads } from '../app/public/js/panels/efsp/strip-fields.js';
import { hasMtrData, mtrLostCommsAdvisory } from '../app/public/js/panels/efsp/mtr-advisory.js';

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
  const noMtr = flightDataWithMtr({ designator: null, exitFix: '' });
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

// H122 (H117, crc-sync docs/adr/0114): on a carrier Strip the side number and the callsign swap places.
const CARRIER_OWNER = { MARSHAL: 'CV_MARSHAL', FINAL: 'CV_APP1', PATTERN: 'CV_PRIFLY' };

test('a carrier Strip with a side number leads with it in the callsign\'s slot and width; the callsign takes SIDE\'s', () => {
  const withSide = { military: { carrier: { sideNumber: '104' } } };
  for (const stripType of ['MARSHAL', 'FINAL']) {
    const owner = CARRIER_OWNER[stripType];
    const plain = compactBlocksFor(stripType, owner, null);
    const swapped = compactBlocksFor(stripType, owner, withSide);
    assert.equal(swapped[plain.indexOf('C1')], 'C18', stripType);
    assert.equal(swapped[plain.indexOf('C18')], 'C1', stripType);
    assert.deepEqual([...swapped].sort(), [...plain].sort(), `${stripType}: the same fields, only two moved`);
    assert.equal(sideNumberLeads(stripType, owner, withSide), true);
  }
  assert.equal(fieldSpanFor('C18', true), fieldSpanFor('C1'));
  assert.equal(fieldSpanFor('C1', true), fieldSpanFor('C18'));
  assert.equal(fieldSpanFor('C1'), 2);
  assert.equal(fieldSpanFor('C18'), 1);
});

test('every carrier strip type has a side number Block, so every carrier Strip can swap', () => {
  for (const stripType of Object.keys(CARRIER_OWNER)) {
    assert.ok(BLOCK_MAPS[stripType].C1 && BLOCK_MAPS[stripType].C18, stripType);
    assert.equal(sideNumberLeads(stripType, CARRIER_OWNER[stripType], { military: { carrier: { sideNumber: '104' } } }), true, stripType);
  }
});

test('a carrier PATTERN Strip: SIDE only on the face once it leads, then first; the callsign after TYPE', () => {
  const withSide = { military: { carrier: { sideNumber: '104' } } };
  assert.deepEqual(compactBlocksFor('PATTERN', 'CV_PRIFLY', null), ['C1', 'C2', 'C24']);
  assert.deepEqual(compactBlocksFor('PATTERN', 'CV_PRIFLY', withSide), ['C18', 'C2', 'C1', 'C24']);
});

test('no side number yet: the callsign keeps the big slot; non-carrier Strips and Incirlik\'s FINAL/PATTERN never swap', () => {
  for (const fd of [null, {}, { military: { carrier: {} } }, { military: { carrier: { sideNumber: '  ' } } }]) {
    for (const stripType of Object.keys(CARRIER_OWNER)) {
      assert.equal(sideNumberLeads(stripType, CARRIER_OWNER[stripType], fd), false, stripType);
      assert.equal(compactBlocksFor(stripType, CARRIER_OWNER[stripType], fd)[0], 'C1', stripType);
    }
  }
  const withSide = { military: { carrier: { sideNumber: '104' } } };
  for (const stripType of ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT', 'MISSION']) {
    assert.equal(sideNumberLeads(stripType, 'AP', withSide), false, stripType);
  }
  // PAR (FINAL) and RSU (PATTERN) are Incirlik's: the same strip types, not carrier Strips.
  assert.equal(sideNumberLeads('FINAL', 'PAR', withSide), false);
  assert.deepEqual(compactBlocksFor('FINAL', 'PAR', withSide), compactBlocksFor('FINAL', 'PAR', null));
  assert.equal(sideNumberLeads('PATTERN', 'RSU', withSide), false);
  assert.deepEqual(compactBlocksFor('PATTERN', 'RSU', withSide), ['C1', 'C2', 'C24']);
});

test('leadingFlightName (H124): a carrier Strip is named by its side number once typed, else the callsign; Incirlik by the callsign', () => {
  const fd = (side) => ({ identity: { callsign: 'NAVY 1' }, military: { carrier: { sideNumber: side } } });
  assert.equal(leadingFlightName({ stripType: 'PATTERN', ownerPositionId: 'CV_PRIFLY' }, fd('203')), '203');
  assert.equal(leadingFlightName({ stripType: 'MARSHAL', ownerPositionId: 'CV_MARSHAL' }, fd(' 204 ')), '204');
  assert.equal(leadingFlightName({ stripType: 'FINAL', ownerPositionId: 'CV_APP1' }, fd('205')), '205');
  assert.equal(leadingFlightName({ stripType: 'FINAL', ownerPositionId: 'CV_APP1' }, fd('  ')), 'NAVY 1', 'no side number yet');
  assert.equal(leadingFlightName({ stripType: 'FINAL', ownerPositionId: 'PAR' }, fd('205')), 'NAVY 1', 'Incirlik PAR: callsign');
  assert.equal(leadingFlightName({ stripType: 'PATTERN', ownerPositionId: 'RSU' }, fd('205')), 'NAVY 1', 'Incirlik RSU: callsign');
  assert.equal(leadingFlightName(null, fd('205')), 'NAVY 1');
  assert.equal(leadingFlightName({ stripType: 'FINAL', ownerPositionId: 'CV_APP1' }, null), '');
});
