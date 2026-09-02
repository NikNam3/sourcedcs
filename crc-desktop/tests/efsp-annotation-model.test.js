'use strict';

/* Unit tests for the pure client-side annotation supersession model
   (annotation-editor.js), mirroring board-store.js's server-side rules —
   append-only, SUPERSEDED on amendment, STRUCK only via confirmVacated. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyAnnotationLocally } = require('../app/public/js/panels/efsp/annotation-editor.js');

test('first amendment on an empty annotations object creates one ACTIVE entry', () => {
  const result = applyAnnotationLocally({}, '11', '250', false);
  assert.equal(result['11'].entries.length, 1);
  assert.equal(result['11'].entries[0].value, '250');
  assert.equal(result['11'].entries[0].status, 'ACTIVE');
});

test('a second amendment marks the prior entry SUPERSEDED, never STRUCK, and appends a new ACTIVE one', () => {
  const first = applyAnnotationLocally({}, '11', '250', false);
  const second = applyAnnotationLocally(first, '11', '270', false);

  assert.equal(second['11'].entries.length, 2);
  assert.equal(second['11'].entries[0].status, 'SUPERSEDED');
  assert.equal(second['11'].entries[0].value, '250');
  assert.equal(second['11'].entries[1].status, 'ACTIVE');
  assert.equal(second['11'].entries[1].value, '270');
});

test('confirmVacated marks the active entry STRUCK and appends nothing new', () => {
  const first = applyAnnotationLocally({}, '7', '250', false);
  const struck = applyAnnotationLocally(first, '7', null, true);

  assert.equal(struck['7'].entries.length, 1);
  assert.equal(struck['7'].entries[0].status, 'STRUCK');
  assert.equal(struck['7'].entries[0].value, '250');
});

test('confirmVacated with no ACTIVE entry present returns null (nothing to strike)', () => {
  assert.equal(applyAnnotationLocally({}, '7', null, true), null);
});

test('does not mutate the input annotations object (pure)', () => {
  const before = { '11': { blockId: '11', entries: [{ value: '250', status: 'ACTIVE' }] } };
  const beforeCopy = JSON.parse(JSON.stringify(before));
  applyAnnotationLocally(before, '11', '270', false);
  assert.deepEqual(before, beforeCopy);
});

test('amending one Block leaves other Blocks\' annotations untouched', () => {
  const before = { '11': { blockId: '11', entries: [{ value: 'A', status: 'ACTIVE' }] } };
  const after = applyAnnotationLocally(before, '24', 'B', false);
  assert.deepEqual(after['11'], before['11']);
  assert.equal(after['24'].entries[0].value, 'B');
});
