// The Bay descriptor crc-sync puts on the snapshot (facility-config.js's
// getAllBays) vs the fields the Strip panel reads off a Bay (bay-view.js,
// efsp-panel.js, efsp-state.js). Descriptors are config, never hand-copied, but
// the FIELD NAMES are an unwritten contract: rename `impliesState` server-side and
// every Bay silently implies nothing (docs/wip/PARITY.md, D-9 "stripe/Bay descriptors").
// Reads the current server data; independent of nla.js / block-map.js / permission.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readClient } from './helpers/mirror-source.mjs';

const require = createRequire(import.meta.url);
const facilities = require('../../crc-sync/src/efsp/facility-config.js');
const nla = require('../../crc-sync/src/efsp/nla.js');

const JS_DIR = path.join(import.meta.dirname, '../app/public/js');
const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walkJs(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
// Every client file under panels/efsp/, recursively (ESM-2a: bay-view.js's features live in bay/**).
const CLIENT_FILES = walkJs(path.join(JS_DIR, 'panels/efsp')).map(f => path.relative(JS_DIR, f).split(path.sep).join('/'));
// `bay.rackId` is the {bayId, rackId} landing spot _handBackBayFor builds, not a descriptor.
// `bay.withOthers` marks the client-synthesised "with AIC/JTAC" tab Bay (UI-A, efsp-panel.js), which has no server descriptor.
const NOT_DESCRIPTOR_FIELDS = new Set(['rackId', 'withOthers']);

const allBays = () => facilities.getFacilityIds().flatMap(f => facilities.getAllBays(f));

// Files that always handle every Bay (the strict set, as before ESM-2a/2b: bay-view.js with bay/**, efsp-panel.js with panel/**, and the state files).
// Other files under panels/efsp/ read flags only some Bays carry (bay-views.js's `view`), so those need at least one Bay with the field.
const isStrict = (f) => /^panels\/efsp\/(bay-view|efsp-panel|efsp-state|efsp-arrivals|strip-drag)\.js$|^panels\/efsp\/(bay|panel)\//.test(f);
const readsOf = (files) => new Set(files.flatMap(f => [...readClient(f).matchAll(/\bbay\.([A-Za-z_]\w*)/g)].map(m => m[1])).filter(n => !NOT_DESCRIPTOR_FIELDS.has(n)));

test('every field the client reads off a `bay` is on the server\'s Bay descriptor', () => {
  assert.ok(CLIENT_FILES.length >= 30, `scan found only ${CLIENT_FILES.length} files`);
  const strict = readsOf(CLIENT_FILES.filter(isStrict));
  const loose = readsOf(CLIENT_FILES.filter(f => !isStrict(f)));
  assert.ok(strict.size >= 3, `scan found ${[...strict]}`);
  assert.ok(loose.has('view'), 'the loose scan reads bay-views.js\'s bay.view');
  const bays = allBays();
  assert.ok(bays.length > 20);
  for (const field of strict) {
    for (const b of bays) assert.ok(field in b, `client reads bay.${field} but Bay ${b.bayId} has no such field`);
  }
  for (const field of loose) assert.ok(bays.some(b => field in b), `client reads bay.${field} but no Bay has such a field`);
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
