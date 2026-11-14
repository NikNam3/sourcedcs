import { test } from 'node:test';
import assert from 'node:assert/strict';
import SrsClient from '../src/srs-client.js';

/* Exercises _applyClient/getTransponder directly, without ever calling
   .connect() -- no real TCP socket involved. */

function radioUpdate(name, mode3, status) {
  return { Name: name, RadioInfo: { IFF: { mode3, status } } };
}

test('ident latch holds squawkStatus=2 for a grace period after the pulse', () => {
  const c = new SrsClient();
  c._applyClient(radioUpdate('Pilot', 1234, 2));
  assert.equal(c.getTransponder('Pilot').squawkStatus, 2);
});

test('ident latch clears on its own once expired, even with no further SRS message', () => {
  // Regression: getTransponder is polled once per gRPC tick, far more often
  // than SRS pushes radio-state updates (event-driven, only on change). If
  // the ident pulse was the last message SRS ever sent for this client, the
  // flash must still clear after the grace period on read, not stay stuck
  // until the pilot recycles the transponder to force a new message.
  const c = new SrsClient();
  c._applyClient(radioUpdate('Pilot', 1234, 2));
  assert.equal(c.getTransponder('Pilot').squawkStatus, 2);

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000; // past the 5s latch window
    assert.equal(c.getTransponder('Pilot').squawkStatus, 1);
    // And it stays cleared on a subsequent read.
    assert.equal(c.getTransponder('Pilot').squawkStatus, 1);
  } finally {
    Date.now = realNow;
  }
});

test('a repeated ident message keeps refreshing the latch instead of expiring mid-hold', () => {
  const c = new SrsClient();
  c._applyClient(radioUpdate('Pilot', 1234, 2));

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 4000; // still within the first latch window
    c._applyClient(radioUpdate('Pilot', 1234, 2)); // pilot still holding ident
    assert.equal(c.getTransponder('Pilot').squawkStatus, 2);

    Date.now = () => realNow() + 8000; // 4s past the *refreshed* latch, not the original
    assert.equal(c.getTransponder('Pilot').squawkStatus, 2);

    Date.now = () => realNow() + 9001; // now past the refreshed 5s window
    assert.equal(c.getTransponder('Pilot').squawkStatus, 1);
  } finally {
    Date.now = realNow;
  }
});

test('a normal (non-ident) status update is still latched to 2 within the grace period, but clears once it expires', () => {
  const c = new SrsClient();
  c._applyClient(radioUpdate('Pilot', 1234, 2));
  c._applyClient(radioUpdate('Pilot', 1234, 1)); // real status already back to normal
  assert.equal(c.getTransponder('Pilot').squawkStatus, 2, 'grace period keeps the flash visible briefly');

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000;
    c._applyClient(radioUpdate('Pilot', 1234, 1));
    assert.equal(c.getTransponder('Pilot').squawkStatus, 1);
  } finally {
    Date.now = realNow;
  }
});

test('getTransponder for an unknown player returns null', () => {
  const c = new SrsClient();
  assert.equal(c.getTransponder('Nobody'), null);
});

// Multicrew (seen on prod, an F-14 with pilot and RIO): both crew run SRS, both report the same unit, and the RIO's
// radio updates carry the pilot's name, with the transponder reported off. The pilot's code must survive the RIO's update.
function crewUpdate(guid, name, seat, mode3, status) {
  return { ClientGuid: guid, Name: name, Seat: seat, RadioInfo: { unitId: 16777480, IFF: { mode3, status } } };
}

test('a multicrew back-seater reporting the transponder off under the pilot\'s name does not wipe the pilot\'s code', () => {
  const c = new SrsClient();
  c._handleMsg({ MsgType: 3, Client: crewUpdate('pilot', 'TRIDENT 140', 0, 1234, 1) });
  c._handleMsg({ MsgType: 3, Client: crewUpdate('rio', 'TRIDENT 140', 1, -1, 0) });
  const t = c.getTransponder('TRIDENT 140');
  assert.equal(t.squawk, 1234);
  assert.equal(t.squawkStatus, 1);
});

test('the crew\'s transponder reads on when the back seat\'s client is the one that reports it on', () => {
  const c = new SrsClient();
  c._handleMsg({ MsgType: 3, Client: crewUpdate('pilot', 'TRIDENT 140', 0, -1, 0) });
  c._handleMsg({ MsgType: 3, Client: crewUpdate('rio', 'TRIDENT 140', 1, 1234, 1) });
  assert.equal(c.getTransponder('TRIDENT 140').squawk, 1234);
});

test('with every crew client reporting off, the transponder is off', () => {
  const c = new SrsClient();
  c._handleMsg({ MsgType: 3, Client: crewUpdate('pilot', 'TRIDENT 140', 0, 1234, 1) });
  c._handleMsg({ MsgType: 3, Client: crewUpdate('rio', 'TRIDENT 140', 1, -1, 0) });
  c._handleMsg({ MsgType: 3, Client: crewUpdate('pilot', 'TRIDENT 140', 0, 1234, 0) });
  assert.equal(c.getTransponder('TRIDENT 140').squawkStatus, 0);
});

test('a back-seater disconnecting does not delete the pilot\'s code (disconnect is by client, not by name)', () => {
  const c = new SrsClient();
  c._handleMsg({ MsgType: 3, Client: crewUpdate('pilot', 'TRIDENT 140', 0, 1234, 1) });
  c._handleMsg({ MsgType: 3, Client: crewUpdate('rio', 'TRIDENT 140', 1, -1, 0) });
  c._handleMsg({ MsgType: 5, Client: { ClientGuid: 'rio', Name: '[SRC-BA] Sirenhead' } });
  assert.equal(c.getTransponder('TRIDENT 140').squawk, 1234);
  c._handleMsg({ MsgType: 5, Client: { ClientGuid: 'pilot', Name: 'TRIDENT 140' } });
  assert.equal(c.getTransponder('TRIDENT 140'), null);
});

test('a client whose later updates carry a new name no longer answers for its old one', () => {
  const c = new SrsClient();
  c._handleMsg({ MsgType: 3, Client: { ClientGuid: 'g1', Name: 'Old', Seat: 0, RadioInfo: { IFF: { mode3: 1234, status: 1 } } } });
  c._handleMsg({ MsgType: 3, Client: { ClientGuid: 'g1', Name: 'New', Seat: 0, RadioInfo: { IFF: { mode3: 1234, status: 1 } } } });
  assert.equal(c.getTransponder('Old'), null);
  assert.equal(c.getTransponder('New').squawk, 1234);
});

test('an UPDATE without RadioInfo (SRS 2.4 sends these between radio updates) leaves the code alone', () => {
  const c = new SrsClient();
  c._handleMsg({ MsgType: 3, Client: crewUpdate('pilot', 'TRIDENT 140', 0, 1234, 1) });
  c._handleMsg({ MsgType: 0, Client: { ClientGuid: 'pilot', Name: 'TRIDENT 140', Seat: 0 } });
  assert.equal(c.getTransponder('TRIDENT 140').squawk, 1234);
});
