'use strict';

// UI-A follow-up: the pure halves of the U1-U8 / S-L15 / S-L16 client fixes.

const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(globalThis, require('../app/public/js/panels/efsp/time-chains.js'));
globalThis.cachedStereoRoutesClient = () => [];
const tpl = require('../app/public/js/panels/efsp/strip-template.js');
const fields = require('../app/public/js/panels/efsp/strip-fields.js');
Object.assign(globalThis, tpl, fields);

test('U4: TYPE (3) is redirected to the aircraft type (3A) and carries its current value', () => {
  const fdr = { identity: { aircraftType: 'F16C', flightSize: 2 } };
  assert.deepEqual(tpl.editRedirectFor('3', 'DEPARTURE', fdr), { blockId: '3A', value: 'F16C' });
  assert.deepEqual(tpl.editRedirectFor('3', 'ARRIVAL', null), { blockId: '3A', value: '' });
  assert.equal(tpl.editRedirectFor('3', 'MISSION', fdr), null, 'a mission line has no 3A');
  assert.equal(tpl.editRedirectFor('5', 'DEPARTURE', fdr), null);
  assert.equal(tpl.isBlockEditable('3'), false, 'the composite itself is still not a write target');
});

test('U5: RELEASE (14A) is on a departure at APP and CTR, labelled RELEASE', () => {
  for (const p of ['APP', 'CTR']) assert.ok(fields.compactBlocksFor('DEPARTURE', p).includes('14A'), p);
  assert.equal(tpl.blockLabelFor('14A', 'DEPARTURE'), 'RELEASE');
});

test('U3: the IFR field says what it is', () => {
  assert.equal(tpl.blockLabelFor('IFR', 'DEPARTURE'), 'KEEP IFR');
  assert.match(tpl.blockTitleFor('IFR', null), /TOFI/);
});
