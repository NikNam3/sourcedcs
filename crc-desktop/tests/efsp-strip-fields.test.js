'use strict';

// The per-Position field lists (strip-fields.js, docs/adr/0056) and the rules
// they were written to. Each rule came from a controller reading the Strip:
// a field a Position never uses costs Strip height on every flight.
// Reachability — everything left off is still in the expanded view — is held
// by efsp-ui-reachability.test.js, per (Role, Position).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
for (const file of ['strip-template.js', 'strip-fields.js']) {
  vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
}
const { COMPACT_BLOCKS_BY_POSITION, compactBlocksFor } = sandbox.module.exports;
const BLOCK_MAPS = vm.runInContext('BLOCK_MAPS', sandbox);

const everyList = () => Object.entries(COMPACT_BLOCKS_BY_POSITION)
  .flatMap(([role, byPos]) => Object.entries(byPos).map(([positionId, list]) => ({ role, positionId, list })));

test('every field a Position shows is a Block its Role actually has', () => {
  for (const { role, positionId, list } of everyList()) {
    const missing = list.filter(id => !(id in BLOCK_MAPS[role]));
    assert.deepEqual(Array.from(missing), [], `${role} at ${positionId}`);
  }
});

test('TYPE already carries the aircraft and wake, so neither gets a field of its own', () => {
  for (const { role, positionId, list } of everyList()) {
    assert.ok(list.includes('3'), `${role} at ${positionId} has no TYPE`);
    assert.equal(list.includes('3A') || list.includes('3B'), false, `${role} at ${positionId}`);
  }
});

test('CID and TAIL are on no Strip', () => {
  for (const { role, positionId, list } of everyList()) {
    assert.equal(list.includes('4') || list.includes('3C'), false, `${role} at ${positionId}`);
  }
});

test('HOOK is Tower\'s alone', () => {
  for (const { role, positionId, list } of everyList()) {
    if (positionId === 'TWR') continue;
    assert.equal(list.includes('3F'), false, `${role} at ${positionId}`);
  }
});

test('ORDNANCE: always on Tower\'s face; on APP, CTR and the tactical Positions only once it is not CLEAN (H55, S-L12)', () => {
  // decisions.md H55 and S-L12 (crc-sync's docs/adr/0069), after H51's MTR
  // precedent: a field that is almost always CLEAN earns its place on the face
  // only while it says something. Everywhere else it is in the expanded view.
  const fdr = (ordnanceState) => ({ military: { ordnanceState } });
  for (const { role, positionId, list } of everyList()) {
    assert.equal(list.includes('3G'), positionId === 'TWR' || (positionId === 'OPS' && role === 'DEPARTURE'), `static list ${role} at ${positionId}`);
  }
  const whenSet = [
    ...['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT'].flatMap(role => ['APP', 'CTR'].map(p => [role, p])),
    ...['TAC_C2', 'AIC', 'GCI', 'JTAC'].map(p => ['MISSION', p]),
  ];
  for (const [role, positionId] of whenSet) {
    for (const quiet of [undefined, null, { military: null }, fdr('CLEAN'), fdr(null), fdr('')]) {
      assert.equal(compactBlocksFor(role, positionId, quiet).includes('3G'), false, `${role} at ${positionId}, ${JSON.stringify(quiet)}`);
    }
    for (const state of ['HUNG', 'LOADED', 'EXPENDED']) {
      assert.ok(compactBlocksFor(role, positionId, fdr(state)).includes('3G'), `${role} at ${positionId}, ${state}`);
    }
  }
  for (const role of ['DEPARTURE', 'ARRIVAL']) {
    assert.ok(compactBlocksFor(role, 'TWR', fdr('CLEAN')).includes('3G'), `${role} at TWR, CLEAN`);
    assert.ok(compactBlocksFor(role, 'TWR').includes('3G'), `${role} at TWR, no FDR`);
  }
  // UI-A U1: OPS records the load state, so a DEPARTURE at OPS carries it always.
  assert.ok(compactBlocksFor('DEPARTURE', 'OPS', fdr('CLEAN')).includes('3G'), 'DEPARTURE at OPS, CLEAN');
  for (const positionId of ['OPS', 'CD', 'GND']) {
    for (const role of ['DEPARTURE', 'ARRIVAL']) {
      if (positionId === 'OPS' && role === 'DEPARTURE') continue;
      assert.equal(compactBlocksFor(role, positionId, fdr('HUNG')).includes('3G'), false, `${role} at ${positionId}`);
    }
  }
});

test('a set ORDNANCE goes before the MTR group, which starts its own row', () => {
  const list = compactBlocksFor('ARRIVAL', 'APP', { military: { ordnanceState: 'HUNG', mtr: { designator: 'IR107' } } });
  assert.ok(list.includes('9G-MTR'), 'MTR group drawn');
  assert.ok(list.indexOf('3G') < list.indexOf('9G-MTR'));
});

test('a runway field only on the airfield Positions', () => {
  // The Block that is the runway differs by Role: 8A on DEPARTURE, 8B on ARRIVAL.
  const runwayBlock = { DEPARTURE: '8A', ARRIVAL: '8B' };
  for (const { role, positionId, list } of everyList()) {
    const rwy = runwayBlock[role];
    if (!rwy || ['OPS', 'CD', 'GND', 'TWR', 'APP', 'SFA'].includes(positionId)) continue;
    assert.equal(list.includes(rwy), false, `${role} at ${positionId} shows a runway`);
  }
});

test('FREQ only where a controller works more than one frequency', () => {
  for (const { role, positionId, list } of everyList()) {
    if (['OPS', 'CD', 'GND', 'TWR'].includes(positionId)) {
      assert.equal(list.includes('22'), false, `${role} at ${positionId} sits on one frequency`);
    }
  }
  assert.ok(compactBlocksFor('DEPARTURE', 'APP').includes('22'));
  assert.ok(compactBlocksFor('DEPARTURE', 'CTR').includes('22'));
});

test('STATE is on no Strip — the tab header says it', () => {
  for (const role of Object.keys(BLOCK_MAPS)) {
    for (const positionId of [...Object.keys(COMPACT_BLOCKS_BY_POSITION[role] || {}), undefined]) {
      const list = compactBlocksFor(role, positionId);
      assert.equal(list.includes('25') || list.includes('M25'), false, `${role} at ${positionId}`);
    }
  }
});

test('a Position no list names falls back to its Role, filtered to the Role\'s Blocks', () => {
  const list = compactBlocksFor('ARRIVAL', 'NOBODY');
  assert.ok(list.includes('9A-VECTOR'));
  assert.equal(list.some(id => !(id in BLOCK_MAPS.ARRIVAL)), false);
});

// ── §9.4 MTR group (crc-sync's docs/adr/0062) ────────────────────────────────

const { MTR_BLOCKS_BY_POSITION, hasMtrData, mtrLostCommsAdvisory } = sandbox.module.exports;
const everyMtrList = () => Object.entries(MTR_BLOCKS_BY_POSITION)
  .flatMap(([role, byPos]) => Object.entries(byPos).map(([positionId, list]) => ({ role, positionId, list })));
const fdrWithMtr = (mtr) => ({ military: { mtr }, clearance: { altitude: { entries: [] } } });

test('every MTR list names Blocks its Role has, and only 9G-*/9H-* ids', () => {
  for (const { role, positionId, list } of everyMtrList()) {
    for (const id of list) {
      assert.ok(id in BLOCK_MAPS[role], `${role} at ${positionId}: ${id}`);
      assert.match(id, /^9[GH]-/, `${role} at ${positionId}: ${id}`);
    }
  }
});

test('every MTR list starts with 9G-MTR — the CSS row start keys on it', () => {
  for (const { role, positionId, list } of everyMtrList()) assert.equal(list[0], '9G-MTR', `${role} at ${positionId}`);
});

test('M11 is prominent: the exit fix and estimate come before the entry fields', () => {
  for (const { role, positionId, list } of everyMtrList()) {
    if (!list.includes('9G-ENTRY')) continue;
    for (const m11 of ['9H-EXIT', '9H-TIME']) {
      if (!list.includes(m11)) continue;
      assert.ok(list.indexOf(m11) < list.indexOf('9G-ENTRY') && list.indexOf(m11) < list.indexOf('9G-TIME'), `${role} at ${positionId}`);
    }
  }
});

test('GND, TWR and MISSION get no MTR group', () => {
  for (const role of Object.keys(MTR_BLOCKS_BY_POSITION)) {
    assert.equal(MTR_BLOCKS_BY_POSITION[role].GND, undefined, `${role} GND`);
    assert.equal(MTR_BLOCKS_BY_POSITION[role].TWR, undefined, `${role} TWR`);
  }
  assert.equal(MTR_BLOCKS_BY_POSITION.MISSION, undefined);
});

test('compactBlocksFor without an FDR, or with one that has no MTR, is exactly what it was', () => {
  const noMtr = fdrWithMtr({ designator: null, exitFix: '' });
  for (const { role, positionId } of everyList()) {
    assert.deepEqual(Array.from(compactBlocksFor(role, positionId, noMtr)), Array.from(compactBlocksFor(role, positionId)), `${role} at ${positionId}`);
    assert.equal(compactBlocksFor(role, positionId).some(id => /^9[GH]-/.test(id)), false);
  }
});

test('any one MTR field brings the group — the trigger is not the designator', () => {
  const list = Array.from(compactBlocksFor('DEPARTURE', 'CTR', fdrWithMtr({ exitFix: 'F' })));
  assert.deepEqual(list.slice(-MTR_BLOCKS_BY_POSITION.DEPARTURE.CTR.length), Array.from(MTR_BLOCKS_BY_POSITION.DEPARTURE.CTR));
  assert.deepEqual(Array.from(compactBlocksFor('DEPARTURE', 'TWR', fdrWithMtr({ exitFix: 'F' }))), Array.from(compactBlocksFor('DEPARTURE', 'TWR')));
});

test('hasMtrData: false for nothing, true for any one value', () => {
  for (const fdr of [null, {}, { military: null }, fdrWithMtr({}), fdrWithMtr({ designator: null, exitFix: '', exitEstimateUtc: null })]) {
    assert.equal(hasMtrData(fdr), false, JSON.stringify(fdr));
  }
  for (const key of ['designator', 'entryFix', 'entryTimeUtc', 'exitFix', 'exitEstimateUtc', 'requestedAltitudeAfterExit']) {
    assert.equal(hasMtrData(fdrWithMtr({ [key]: key.endsWith('Utc') ? 1466519520000 : 'X' })), true, key);
  }
});

test('mtrLostCommsAdvisory states the rule, shows the ACTIVE ALT, admits the missing half, never reads 9H-ALT', () => {
  assert.equal(mtrLostCommsAdvisory(fdrWithMtr({})), null);
  const fdr = {
    military: { mtr: { designator: 'IR107', requestedAltitudeAfterExit: 'FL230' } },
    clearance: { altitude: { entries: [{ value: 'FL120', status: 'SUPERSEDED' }, { value: 'FL180', status: 'ACTIVE' }] } },
  };
  const text = mtrLostCommsAdvisory(fdr);
  assert.match(text, /§9\.4/);
  assert.match(text, /FL180/);
  assert.match(text, /not available in this system/);
  assert.doesNotMatch(text, /FL230|FL120/);
  assert.match(mtrLostCommsAdvisory(fdrWithMtr({ exitFix: 'E' })), /none posted \(ALT is empty\)/);
});

// §9.6 alert status (crc-sync docs/adr/0070, decisions.md H56).
test('ALERT (14E) is on OPS, CD, GND and TWR — the ground Positions — and nowhere else', () => {
  for (const { role, positionId, list } of everyList()) {
    const expected = role === 'DEPARTURE' && ['OPS', 'CD', 'GND', 'TWR'].includes(positionId);
    assert.equal(list.includes('14E'), expected, `${role} at ${positionId}`);
  }
  assert.equal(BLOCK_MAPS.ARRIVAL['14E'], undefined);
  assert.equal(BLOCK_MAPS.OVERFLIGHT['14E'], undefined);
  assert.equal(BLOCK_MAPS.DEPARTURE['14E'].label, 'ALERT');
});
