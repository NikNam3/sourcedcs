'use strict';

/* The airspace board's action gating — which buttons a controller is offered
   for an airspace, given what they hold and where the airspace is in its
   lifecycle. Proactive only: airspace-store.js decides, and this exists so a
   controller is never offered something that will be refused. That makes it
   a mirror, and a mirror that drifts is worse than none — hence these. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { airspaceActionsFor } = require('../app/public/js/panels/efsp/airspace-panel.js');

/** A range with a control tower of its own: a real using agency, distinct from the controlling one. */
function range(state, extra = {}) {
  return {
    airspaceId: 'RANGE-1', state, pendingRequest: null, window: null, rev: 1,
    definition: {
      airspaceId: 'RANGE-1', name: 'Test Range', type: 'RANGE',
      controllingPositionId: 'APP', usingPositionId: 'RANGE_CTL', controlFrequencyMhz: 283.5,
    },
    ...extra,
  };
}

/** An ordinary MOA: no control of its own, owned by the Center that owns the airspace it sits in. */
function moa(state, extra = {}) {
  return {
    airspaceId: 'MOA-1', state, pendingRequest: null, window: null, rev: 1,
    definition: {
      airspaceId: 'MOA-1', name: 'Test MOA', type: 'MOA',
      controllingPositionId: 'CTR', workingFrequencyMhz: 134.25,
    },
    ...extra,
  };
}

const kinds = (airspace, held) => airspaceActionsFor(airspace, held).map(a => a.kind);

test('a controller holding neither side is offered nothing at all', () => {
  assert.deepEqual(kinds(range('RETURNED'), ['TWR']), []);
  assert.deepEqual(kinds(range('SCHEDULED', { pendingRequest: { requestedPositionId: 'RANGE_CTL' } }), ['GND']), []);
  assert.deepEqual(kinds(moa('ACTIVE'), ['OPS']), []);
});

test('the using agency schedules, asks and releases — and is never offered approval of its own request', () => {
  assert.deepEqual(kinds(range('RETURNED'), ['RANGE_CTL']), ['ScheduleAirspace']);
  assert.deepEqual(kinds(range('SCHEDULED'), ['RANGE_CTL']), ['RequestActivation']);
  assert.deepEqual(kinds(range('ACTIVE'), ['RANGE_CTL']), ['ReleaseAirspace']);
  // §9.11's whole point: the using agency does not activate its own airspace.
  const pending = range('SCHEDULED', { pendingRequest: { requestedPositionId: 'RANGE_CTL' } });
  assert.equal(kinds(pending, ['RANGE_CTL']).includes('ApproveActivation'), false);
});

test('the controlling agency approves, denies and takes back', () => {
  const pending = range('SCHEDULED', { pendingRequest: { requestedPositionId: 'RANGE_CTL' } });
  assert.deepEqual(kinds(pending, ['APP']).sort(), ['ApproveActivation', 'DenyActivation', 'ReturnAirspace'].sort());
  assert.deepEqual(kinds(range('RELEASED'), ['APP']), ['ReturnAirspace']);
});

test('approval is not offered until the using agency has actually asked', () => {
  assert.equal(kinds(range('SCHEDULED'), ['APP']).includes('ApproveActivation'), false);
  assert.equal(kinds(range('SCHEDULED'), ['APP']).includes('ReturnAirspace'), true, 'but it can still be cancelled');
});

test('a MOA with no control of its own is run entirely by its controlling Position', () => {
  // There is no second party to ask, so the request step does not exist and
  // approval is offered directly. This is the common case, not an exception.
  assert.deepEqual(kinds(moa('RETURNED'), ['CTR']), ['ScheduleAirspace']);
  const scheduled = kinds(moa('SCHEDULED'), ['CTR']);
  assert.equal(scheduled.includes('RequestActivation'), false, 'nobody to ask');
  assert.equal(scheduled.includes('ApproveActivation'), true);
  assert.deepEqual(kinds(moa('ACTIVE'), ['CTR']), ['ReleaseAirspace']);
  assert.deepEqual(kinds(moa('RELEASED'), ['CTR']), ['ReturnAirspace']);
});

test('one controller holding both sides is offered both halves — the dialogue collapses, the steps do not', () => {
  // §4.8.3: "the state change is mandatory and unconditional. Only the
  // two-party dialogue collapses."
  const pending = range('SCHEDULED', { pendingRequest: { requestedPositionId: 'RANGE_CTL' } });
  const offered = kinds(pending, ['RANGE_CTL', 'APP']);
  assert.equal(offered.includes('ApproveActivation'), true);
  assert.equal(offered.includes('DenyActivation'), true);
});

test('an active airspace is never offered a direct return — it has to be released first', () => {
  assert.equal(kinds(range('ACTIVE'), ['APP']).includes('ReturnAirspace'), false);
  assert.deepEqual(kinds(range('ACTIVE'), ['APP']), []);
});

test('every offered action names the Position to act as, so a combined controller sends the right one', () => {
  const pending = range('SCHEDULED', { pendingRequest: { requestedPositionId: 'RANGE_CTL' } });
  for (const action of airspaceActionsFor(pending, ['RANGE_CTL', 'APP'])) {
    assert.ok(action.positionId, action.kind);
    assert.ok(action.label, action.kind);
  }
  assert.equal(airspaceActionsFor(range('RETURNED'), ['RANGE_CTL'])[0].positionId, 'RANGE_CTL');
  assert.equal(airspaceActionsFor(range('RELEASED'), ['APP'])[0].positionId, 'APP');
});

test('missing or empty inputs are tolerated rather than thrown on', () => {
  assert.deepEqual(airspaceActionsFor(range('RETURNED'), []), []);
  assert.deepEqual(airspaceActionsFor(range('RETURNED'), undefined), []);
  assert.deepEqual(airspaceActionsFor({ state: 'RETURNED' }, ['APP']), []);
});
