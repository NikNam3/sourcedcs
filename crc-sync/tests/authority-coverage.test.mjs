import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Plan §9 point 8 (AUTH): capability rows are keyed by Position id in the authority registry (doctrine, in
// code, H88), and the facility JSON lists which Positions a Facility has (data). This holds the two to each
// other: every Position a shipped Facility lists has a registered family, and every registered Position is
// listed by some Facility. A test, not a start-up check, while index.js is DATA-1's (BACKCOMPAT makes it loud).
// A using-agency (range) Position is refused by class (authority/classes.js) and needs no family.

const require = createRequire(import.meta.url);
const facilityConfig = require('../src/efsp/facility-config.js').createFacilityConfig();
const authority = require('../src/efsp/authority');
const { NO_STRIP_OP_CLASSES } = require('../src/efsp/authority/classes.js');

const configured = () => facilityConfig.getFacilityIds().flatMap(f => facilityConfig.getPositionSet(f).map(p => ({ f, p })))
  .filter(({ p }) => !NO_STRIP_OP_CLASSES.has(facilityConfig.getPositionClass(p)));

test('every Position a shipped Facility lists has a registered Position family', () => {
  const rows = configured();
  assert.ok(rows.length >= 16, `found ${rows.length}`);
  for (const { f, p } of rows) assert.ok(authority.positionFamilyOf(p), `${f}/${p} has no Position family in authority/`);
});

test('every registered Position id appears in some shipped Facility', () => {
  const listed = new Set(configured().map(r => r.p));
  for (const p of authority.positionIds()) assert.ok(listed.has(p), `${p} (${authority.positionFamilyOf(p)}) is in no Facility`);
});
