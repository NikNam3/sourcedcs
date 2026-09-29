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

test('HOOK and ORDNANCE are Tower\'s alone', () => {
  for (const { role, positionId, list } of everyList()) {
    if (positionId === 'TWR') continue;
    assert.equal(list.includes('3F') || list.includes('3G'), false, `${role} at ${positionId}`);
  }
});

test('a runway field only on the airfield Positions', () => {
  // The Block that is the runway differs by Role: 8A on DEPARTURE, 8B on ARRIVAL.
  const runwayBlock = { DEPARTURE: '8A', ARRIVAL: '8B' };
  for (const { role, positionId, list } of everyList()) {
    const rwy = runwayBlock[role];
    if (!rwy || ['OPS', 'CD', 'GND', 'TWR', 'APP'].includes(positionId)) continue;
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
