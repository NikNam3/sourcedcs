/* An assigned altitude limit on the client (crc-sync's docs/adr/0163): crc-sync sends "<080" / ">FL240" as an
 * altitude block with one open end and the canonical text as the entry's value. The strip, the data block, the track
 * panel and the label menu all show that text; the alerts say "at or below" / "at or above".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import * as LIM from '../app/public/js/altitude-limit.js';
import * as A from '../app/public/js/atc-scope.js';
import * as L from '../app/public/js/track-label.js';
import * as F from '../app/public/js/panels/efsp/formation-rules.js';
import { settings } from '../app/public/js/settings.js';

settings.transitionAltFt = 18000;

const AOB = { lowFt: null, highFt: 8000 };
const AOA = { lowFt: 24000, highFt: null };
const flight = (value, block) => ({ clearance: { altitude: { entries: [{ status: 'ACTIVE', value, parsed: null, block }] }, heading: { entries: [] } } });

test('altitude-limit.js tells a limit from a block and says its words', () => {
  assert.equal(LIM.isAltitudeLimit(AOB), true);
  assert.equal(LIM.isAltitudeLimit(AOA), true);
  assert.equal(LIM.isAltitudeLimit({ lowFt: 22000, highFt: 24000 }), false);
  assert.equal(LIM.isAltitudeLimit(null), false);
  assert.equal(LIM.limitFt(AOB), 8000);
  assert.equal(LIM.limitFt(AOA), 24000);
  assert.equal(LIM.limitWords(AOB), 'at or below ');
  assert.equal(LIM.limitWords(AOA), 'at or above ');
  assert.equal(LIM.limitWords({ lowFt: 22000, highFt: 24000 }), '');
  assert.equal(LIM.limitWords(undefined), '');
});

test('the data block shows the strip\'s text, with an arrow only past the limit', () => {
  const a = A.atcAssigned(flight('<080', AOB));
  assert.deepEqual([a.altFt, a.altText], [null, '<080']);
  assert.equal(L.atcAssignedText(a, 5000), '<080', 'below the limit: conforming, no arrow');
  assert.equal(L.atcAssignedText(a, 8100), '<080', 'inside the slack');
  assert.equal(L.atcAssignedText(a, 9000), '<080↓');
  const b = A.atcAssigned(flight('>FL240', AOA));
  assert.equal(L.atcAssignedText(b, 30000), '>FL240');
  assert.equal(L.atcAssignedText({ ...b, hdg: 90 }, 20000), '>FL240↑ H090');
  // Without the text (an older frame), the feet are written as the track panel writes an altitude.
  assert.equal(L.atcAssignedText({ altFt: null, altBlock: AOA, hdg: null }, 30000), '>FL240');
});

test('assignedBlockText keeps the typed text for a limit and the block form for a block', () => {
  assert.equal(L.assignedBlockText(AOB, '<080'), '<080');
  assert.equal(L.assignedBlockText(AOB), '<8,000');
  assert.equal(L.assignedBlockText(AOA, '>FL240'), '>FL240');
  assert.equal(L.assignedBlockText({ lowFt: 22000, highFt: 24000 }, 'FL220-FL240'), 'FL220-FL240');
});

test('a formation split takes a limit as its altitude assignment', () => {
  assert.deepEqual(F.parseAssignmentValue('ALTITUDE', '<080'), { kind: 'ALTITUDE', value: '<080' });
  assert.deepEqual(F.parseAssignmentValue('ALTITUDE', '>FL240'), { kind: 'ALTITUDE', value: '>FL240' });
  assert.equal(F.parseAssignmentValue('ALTITUDE', '<<080'), null);
  assert.deepEqual(F.parseAssignmentToken('<A080'), { kind: 'ALTITUDE', value: '<A080' });
  assert.deepEqual(F.parseAssignmentToken('>FL240'), { kind: 'ALTITUDE', value: '>FL240' });
});
