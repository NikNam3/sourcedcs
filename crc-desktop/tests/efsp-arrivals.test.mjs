
// What counts as a Strip ARRIVING in a controller's Bay, and how long it stays
// marked (efsp-arrivals.js, docs/adr/0057). The rendering half — the tab
// counts, the arrivals line, the Strip's amber edge and single flash — is in
// efsp-ui-reachability.test.mjs and the Playwright specs.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../app/public/js/panels/efsp/efsp-arrivals.js';

const ME = 'c-me';
const OTHER = 'c-other';

function strip(over) {
  return {
    stripId: 's1', flightDataId: 'f1', stripType: 'DEPARTURE', state: 'RUNWAY_QUEUE',
    ownerPositionId: 'LC', bayId: 'lc-runway-queue', updatedBy: OTHER,
    coordination: null, tofiCoordination: null, ...over,
  };
}
const ctx = (over = {}) => ({
  signedOnPositions: ['LC'], myControllerIds: [ME], visibleBayId: 'lc-airborne', now: 1000,
  callsignOf: () => 'VIPER11', ...over,
});
const was = (bayId, ownerPositionId) => new Map([['s1', { bayId, ownerPositionId }]]);

test.beforeEach(() => A._resetEfspArrivalsForTest());

test('a Strip another controller hands to one of my Positions is an arrival, and says who from', () => {
  const found = A.noteEfspArrivals(was('gc-taxi-out', 'GC'), [strip()], ctx());
  assert.equal(found.length, 1);
  assert.equal(found[0].from, 'GC');
  assert.equal(found[0].bayId, 'lc-runway-queue');
  assert.equal(A.unseenEfspArrivalsInBay('lc-runway-queue'), 1, 'it landed out of view');
  assert.equal(A.unseenEfspArrivalsForPosition('LC'), 1);
  assert.deepEqual(A.efspArrivalLog().map(e => e.callsign), ['VIPER11']);
});

test('an arrival in the Bay on screen is not unseen and is not listed on the arrivals line', () => {
  A.noteEfspArrivals(was('gc-taxi-out', 'GC'), [strip()], ctx({ visibleBayId: 'lc-runway-queue' }));
  assert.ok(A.efspArrivalFor('s1', 1000), 'the Strip itself is still marked');
  assert.equal(A.unseenEfspArrivalsInBay('lc-runway-queue'), 0);
  assert.deepEqual(A.efspArrivalLog(), []);
});

test('the controller\'s own move into another Bay IS an arrival — across Positions, and within one', () => {
  // Handed from my GC to my LC: working several Positions is exactly when a
  // Strip goes somewhere you are not looking.
  const across = A.noteEfspArrivals(was('gc-taxi-out', 'GC'), [strip({ updatedBy: ME })],
    ctx({ signedOnPositions: ['GC', 'LC'] }));
  assert.equal(across.length, 1);
  assert.equal(across[0].from, 'GC');

  // Between two Bays of the same Position.
  A._resetEfspArrivalsForTest();
  const within = A.noteEfspArrivals(was('lc-runway-queue', 'LC'), [strip({ bayId: 'lc-airborne', updatedBy: ME })], ctx({ visibleBayId: null }));
  assert.equal(within.length, 1);
  assert.equal(within[0].from, 'lc-runway-queue', 'same Position, so the Bay it came from');
});

test('a Strip this controller just created is not an arrival in the Bay in view; out of view it is; one somebody else created always is', () => {
  assert.equal(A.noteEfspArrivals(new Map(), [strip({ updatedBy: ME })], ctx({ visibleBayId: 'lc-runway-queue' })).length, 0);
  const mineOutOfView = A.noteEfspArrivals(new Map(), [strip({ stripId: 's3', updatedBy: ME })], ctx());
  assert.equal(mineOutOfView.length, 1, 'made into a Bay out of view: the controller did not see where it went');
  assert.equal(mineOutOfView[0].bayUnseen, true);
  assert.equal(mineOutOfView[0].from, 'you', 'your own new Strip is not "from another controller"');
  assert.equal(A.noteEfspArrivals(new Map(), [strip({ stripId: 's2', updatedBy: OTHER })], ctx()).length, 1);
});

test('a Strip that changed without moving is not an arrival', () => {
  assert.equal(A.noteEfspArrivals(was('lc-runway-queue', 'LC'), [strip()], ctx()).length, 0);
});

test('a Strip landing at a Position I do not hold is not mine to be told about', () => {
  assert.equal(A.noteEfspArrivals(was('gc-taxi-out', 'GC'), [strip({ ownerPositionId: 'AP', bayId: 'ap-departures' })], ctx()).length, 0);
});

test('a coordination replica is an arrival, from the Position that proposed it', () => {
  const replica = strip({
    stripId: 's1', ownerPositionId: 'CTR', bayId: 'ctr-ap-coordination',
    coordination: { primitive: 'HANDOFF', state: 'INITIATED', peerPositionId: 'AP' },
  });
  const found = A.noteEfspArrivals(new Map(), [replica], ctx({ signedOnPositions: ['CTR'] }));
  assert.equal(found.length, 1);
  assert.equal(found[0].from, 'AP');
});

test('UI-A U2: a replica minted for a proposal my own controller made is still an arrival (one person on AP and CTR)', () => {
  const replica = strip({
    ownerPositionId: 'CTR', bayId: 'ctr-ap-coordination', updatedBy: ME,
    coordination: { primitive: 'HANDOFF', state: 'INITIATED', peerPositionId: 'AP', mintedForCoordination: true },
  });
  const found = A.noteEfspArrivals(new Map(), [replica], ctx({ signedOnPositions: ['AP', 'CTR'] }));
  assert.equal(found.length, 1);
  assert.equal(found[0].from, 'AP');
  // ...while an ordinary Strip I made myself into the Bay in view stays quiet.
  assert.equal(A.noteEfspArrivals(new Map(), [strip({ stripId: 's9', updatedBy: ME })], ctx({ visibleBayId: 'lc-runway-queue' })).length, 0);
});

test('the flash is consumed exactly once, and the edge fades 30 s after it was first seen', () => {
  A.noteEfspArrivals(was('gc-taxi-out', 'GC'), [strip()], ctx());
  assert.ok(A.efspArrivalFor('s1', 999999), 'an unseen arrival does not fade while nobody has looked');
  assert.equal(A.consumeEfspArrivalFlash('s1', 5000), true, 'first build on screen flashes');
  assert.equal(A.consumeEfspArrivalFlash('s1', 5100), false, 'any later build does not replay it');
  assert.equal(A.unseenEfspArrivalsInBay('lc-runway-queue'), 0, 'seeing the Strip is seeing the Bay');
  assert.ok(A.efspArrivalFor('s1', 5000 + A.ARRIVAL_FRESH_MS - 1));
  assert.equal(A.efspArrivalFor('s1', 5000 + A.ARRIVAL_FRESH_MS), null);
  assert.equal(A.nextEfspArrivalExpiry(5000), 5000 + A.ARRIVAL_FRESH_MS);
});

test('touching the Strip clears it; opening the Bay clears the tab and the line but not the Strip', () => {
  A.noteEfspArrivals(was('gc-taxi-out', 'GC'), [strip()], ctx());
  A.markEfspBaySeen('lc-runway-queue');
  assert.equal(A.unseenEfspArrivalsInBay('lc-runway-queue'), 0);
  assert.deepEqual(A.efspArrivalLog(), []);
  assert.ok(A.efspArrivalFor('s1', 1000), 'which Strip is new still shows until it is touched');
  A.clearEfspArrival('s1');
  assert.equal(A.efspArrivalFor('s1', 1000), null);
});

test('a Strip that moves on, or is dropped, stops being new here', () => {
  A.noteEfspArrivals(was('gc-taxi-out', 'GC'), [strip()], ctx());
  // It moves on: the arrival in the first Bay is gone (and a new one is noted where it went).
  A.noteEfspArrivals(was('lc-runway-queue', 'LC'), [strip({ bayId: 'lc-airborne', updatedBy: ME })], ctx());
  assert.equal(A.efspArrivalFor('s1', 1000).bayId, 'lc-airborne');
  A.clearEfspArrival('s1');

  A.noteEfspArrivals(was('gc-taxi-out', 'GC'), [strip()], ctx());
  A.forgetEfspArrivals(['s1']);
  assert.equal(A.efspArrivalFor('s1', 1000), null);
});

test('the arrivals line lists the newest three, newest first', () => {
  for (let i = 0; i < 5; i++) {
    A.noteEfspArrivals(new Map([[`s${i}`, { bayId: 'gc-taxi-out', ownerPositionId: 'GC' }]]),
      [strip({ stripId: `s${i}` })], ctx({ now: 1000 + i, callsignOf: s => s.stripId }));
  }
  assert.deepEqual(A.efspArrivalLog().map(e => e.callsign), ['s4', 's3', 's2']);
});
