'use strict';

// What counts as a Strip ARRIVING in a controller's Bay, and how long it stays
// marked (efsp-arrivals.js, docs/adr/0057). The rendering half — the tab
// counts, the arrivals line, the Strip's amber edge and single flash — is in
// efsp-ui-reachability.test.js and the Playwright specs.

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../app/public/js/panels/efsp/efsp-arrivals.js');

const ME = 'c-me';
const OTHER = 'c-other';

function strip(over) {
  return {
    stripId: 's1', fdrId: 'f1', role: 'DEPARTURE', state: 'RUNWAY_QUEUE',
    ownerPositionId: 'TWR', bayId: 'twr-runway-queue', updatedBy: OTHER,
    coordination: null, tofiCoordination: null, ...over,
  };
}
const ctx = (over = {}) => ({
  heldPositions: ['TWR'], myControllerIds: [ME], visibleBayId: 'twr-airborne', now: 1000,
  callsignOf: () => 'VIPER11', ...over,
});
const was = (bayId, ownerPositionId) => new Map([['s1', { bayId, ownerPositionId }]]);

test.beforeEach(() => A._resetEfspArrivalsForTest());

test('a Strip another controller hands to one of my Positions is an arrival, and says who from', () => {
  const found = A.noteEfspArrivals(was('gnd-taxi-out', 'GND'), [strip()], ctx());
  assert.equal(found.length, 1);
  assert.equal(found[0].from, 'GND');
  assert.equal(found[0].bayId, 'twr-runway-queue');
  assert.equal(A.unseenEfspArrivalsInBay('twr-runway-queue'), 1, 'it landed out of view');
  assert.equal(A.unseenEfspArrivalsForPosition('TWR'), 1);
  assert.deepEqual(A.efspArrivalLog().map(e => e.callsign), ['VIPER11']);
});

test('an arrival in the Bay on screen is not unseen and is not listed on the arrivals line', () => {
  A.noteEfspArrivals(was('gnd-taxi-out', 'GND'), [strip()], ctx({ visibleBayId: 'twr-runway-queue' }));
  assert.ok(A.efspArrivalFor('s1', 1000), 'the Strip itself is still marked');
  assert.equal(A.unseenEfspArrivalsInBay('twr-runway-queue'), 0);
  assert.deepEqual(A.efspArrivalLog(), []);
});

test('the controller\'s own move into another Bay IS an arrival — across Positions, and within one', () => {
  // Handed from my GND to my TWR: working several Positions is exactly when a
  // Strip goes somewhere you are not looking.
  const across = A.noteEfspArrivals(was('gnd-taxi-out', 'GND'), [strip({ updatedBy: ME })],
    ctx({ heldPositions: ['GND', 'TWR'] }));
  assert.equal(across.length, 1);
  assert.equal(across[0].from, 'GND');

  // Between two Bays of the same Position.
  A._resetEfspArrivalsForTest();
  const within = A.noteEfspArrivals(was('twr-runway-queue', 'TWR'), [strip({ bayId: 'twr-airborne', updatedBy: ME })], ctx({ visibleBayId: null }));
  assert.equal(within.length, 1);
  assert.equal(within[0].from, 'twr-runway-queue', 'same Position, so the Bay it came from');
});

test('a Strip this controller just created is not an arrival; one somebody else created is', () => {
  assert.equal(A.noteEfspArrivals(new Map(), [strip({ updatedBy: ME })], ctx()).length, 0);
  assert.equal(A.noteEfspArrivals(new Map(), [strip({ stripId: 's2', updatedBy: OTHER })], ctx()).length, 1);
});

test('a Strip that changed without moving is not an arrival', () => {
  assert.equal(A.noteEfspArrivals(was('twr-runway-queue', 'TWR'), [strip()], ctx()).length, 0);
});

test('a Strip landing at a Position I do not hold is not mine to be told about', () => {
  assert.equal(A.noteEfspArrivals(was('gnd-taxi-out', 'GND'), [strip({ ownerPositionId: 'APP', bayId: 'app-departures' })], ctx()).length, 0);
});

test('a coordination replica is an arrival, from the Position that proposed it', () => {
  const replica = strip({
    stripId: 's1', ownerPositionId: 'CTR', bayId: 'ctr-app-coordination',
    coordination: { primitive: 'HANDOFF', state: 'PROPOSED', peerPositionId: 'APP' },
  });
  const found = A.noteEfspArrivals(new Map(), [replica], ctx({ heldPositions: ['CTR'] }));
  assert.equal(found.length, 1);
  assert.equal(found[0].from, 'APP');
});

test('UI-A U2: a replica minted for a proposal my own controller made is still an arrival (one person on APP and CTR)', () => {
  const replica = strip({
    ownerPositionId: 'CTR', bayId: 'ctr-app-coordination', updatedBy: ME,
    coordination: { primitive: 'HANDOFF', state: 'PROPOSED', peerPositionId: 'APP', mintedForCoordination: true },
  });
  const found = A.noteEfspArrivals(new Map(), [replica], ctx({ heldPositions: ['APP', 'CTR'] }));
  assert.equal(found.length, 1);
  assert.equal(found[0].from, 'APP');
  // ...while an ordinary Strip I made myself stays quiet.
  assert.equal(A.noteEfspArrivals(new Map(), [strip({ stripId: 's9', updatedBy: ME })], ctx()).length, 0);
});

test('the flash is consumed exactly once, and the edge fades 30 s after it was first seen', () => {
  A.noteEfspArrivals(was('gnd-taxi-out', 'GND'), [strip()], ctx());
  assert.ok(A.efspArrivalFor('s1', 999999), 'an unseen arrival does not fade while nobody has looked');
  assert.equal(A.consumeEfspArrivalFlash('s1', 5000), true, 'first build on screen flashes');
  assert.equal(A.consumeEfspArrivalFlash('s1', 5100), false, 'any later build does not replay it');
  assert.equal(A.unseenEfspArrivalsInBay('twr-runway-queue'), 0, 'seeing the Strip is seeing the Bay');
  assert.ok(A.efspArrivalFor('s1', 5000 + A.ARRIVAL_FRESH_MS - 1));
  assert.equal(A.efspArrivalFor('s1', 5000 + A.ARRIVAL_FRESH_MS), null);
  assert.equal(A.nextEfspArrivalExpiry(5000), 5000 + A.ARRIVAL_FRESH_MS);
});

test('touching the Strip clears it; opening the Bay clears the tab and the line but not the Strip', () => {
  A.noteEfspArrivals(was('gnd-taxi-out', 'GND'), [strip()], ctx());
  A.markEfspBaySeen('twr-runway-queue');
  assert.equal(A.unseenEfspArrivalsInBay('twr-runway-queue'), 0);
  assert.deepEqual(A.efspArrivalLog(), []);
  assert.ok(A.efspArrivalFor('s1', 1000), 'which Strip is new still shows until it is touched');
  A.clearEfspArrival('s1');
  assert.equal(A.efspArrivalFor('s1', 1000), null);
});

test('a Strip that moves on, or is dropped, stops being new here', () => {
  A.noteEfspArrivals(was('gnd-taxi-out', 'GND'), [strip()], ctx());
  // It moves on: the arrival in the first Bay is gone (and a new one is noted where it went).
  A.noteEfspArrivals(was('twr-runway-queue', 'TWR'), [strip({ bayId: 'twr-airborne', updatedBy: ME })], ctx());
  assert.equal(A.efspArrivalFor('s1', 1000).bayId, 'twr-airborne');
  A.clearEfspArrival('s1');

  A.noteEfspArrivals(was('gnd-taxi-out', 'GND'), [strip()], ctx());
  A.forgetEfspArrivals(['s1']);
  assert.equal(A.efspArrivalFor('s1', 1000), null);
});

test('the arrivals line lists the newest three, newest first', () => {
  for (let i = 0; i < 5; i++) {
    A.noteEfspArrivals(new Map([[`s${i}`, { bayId: 'gnd-taxi-out', ownerPositionId: 'GND' }]]),
      [strip({ stripId: `s${i}` })], ctx({ now: 1000 + i, callsignOf: s => s.stripId }));
  }
  assert.deepEqual(A.efspArrivalLog().map(e => e.callsign), ['s4', 's3', 's2']);
});
