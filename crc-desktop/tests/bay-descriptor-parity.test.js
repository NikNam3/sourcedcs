'use strict';

// The Bay descriptor crc-sync puts on the snapshot (facility-config.js's
// getAllBays) vs the fields the Strip panel reads off a Bay (bay-view.js,
// efsp-panel.js, efsp-state.js). Descriptors are config, never hand-copied, but
// the FIELD NAMES are an unwritten contract: rename `impliesState` server-side and
// every Bay silently implies nothing (docs/wip/PARITY.md, D-9 "stripe/Bay descriptors").
// Reads the current server data; independent of nla.js / block-map.js / permission.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readClient } = require('./helpers/mirror-source.js');

const facilities = require('../../crc-sync/src/efsp/facility-config.js');
const nla = require('../../crc-sync/src/efsp/nla.js');

const CLIENT_FILES = ['bay-view.js', 'efsp-panel.js', 'efsp-state.js', 'efsp-arrivals.js', 'strip-drag.js'].map(f => 'panels/efsp/' + f);
// `bay.rackId` is the {bayId, rackId} landing spot _handBackBayFor builds, not a descriptor.
const NOT_DESCRIPTOR_FIELDS = new Set(['rackId']);

const allBays = () => facilities.getFacilityIds().flatMap(f => facilities.getAllBays(f));

test('every field the client reads off a `bay` is on the server\'s Bay descriptor', () => {
  const read = new Set();
  for (const f of CLIENT_FILES) for (const m of readClient(f).matchAll(/\bbay\.([A-Za-z_]\w*)/g)) read.add(m[1]);
  for (const f of NOT_DESCRIPTOR_FIELDS) read.delete(f);
  assert.ok(read.size >= 3, `scan found ${[...read]}`);
  const bays = allBays();
  assert.ok(bays.length > 20);
  for (const field of read) {
    for (const b of bays) assert.ok(field in b, `client reads bay.${field} but Bay ${b.bayId} has no such field`);
  }
});

test('every Bay descriptor has the fields the panel keys on, and an impliesState that is a real state of some Role', () => {
  const allStates = new Set(Object.values(nla.STATES_BY_ROLE).flat());
  for (const b of allBays()) {
    for (const f of ['bayId', 'positionId', 'facilityId', 'rackIds']) assert.ok(b[f], `${b.bayId}.${f}`);
    assert.ok(Array.isArray(b.rackIds) && b.rackIds.length >= 1, `${b.bayId}.rackIds`);
    if (b.impliesState) assert.ok(allStates.has(b.impliesState), `${b.bayId} implies ${b.impliesState}, not a state in nla.js`);
  }
});

test('every Bay belongs to a Position of its own Facility', () => {
  for (const f of facilities.getFacilityIds()) {
    const positions = new Set(facilities.getPositionSet(f));
    for (const b of facilities.getAllBays(f)) {
      assert.equal(b.facilityId, f, b.bayId);
      assert.ok(positions.has(b.positionId), `${b.bayId} belongs to ${b.positionId}, not a Position of ${f}`);
    }
  }
});
