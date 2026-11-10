import { test } from 'node:test';
import assert from 'node:assert/strict';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';
import { fakeWs } from './helpers/ws.mjs';
import relayLeases from '../src/radio/relay-leases.js';
import relayWire from '../src/radio/relay-wire.js';

// docs/adr/0158 §4, docs/adr/0159: one relay lease per frequency, first come; released on close, unlink or unstaff (a
// claim that no longer names it); passed to the next claimant.

const { createRelayLeases, claimProblem } = relayLeases;
const { createRadioRelayWire, CLAIM } = relayWire;
const F1 = '251000:AM', F2 = '122100:AM', G = '243000:AM';

test('the first to claim a frequency holds it; the second waits', () => {
  const t = createRelayLeases();
  assert.deepEqual(t.claim('a', [F1, F2]), ['a']);
  assert.deepEqual(t.claim('b', [F2, G]), ['b']);
  assert.deepEqual(t.heldBy('a'), [F2, F1].sort());
  assert.deepEqual(t.heldBy('b'), [G]);
  assert.equal(t.holderOf(F2), 'a');
});

test('a claim that no longer names a frequency releases it, and it passes to the next claimant', () => {
  const t = createRelayLeases();
  t.claim('a', [F1, F2]);
  t.claim('b', [F2]);
  t.claim('c', [F2]);
  assert.deepEqual(t.claim('a', [F1]).sort(), ['a', 'b']);
  assert.equal(t.holderOf(F2), 'b');
  assert.deepEqual(t.release('b').sort(), ['b', 'c'], 'on close it passes on again, in claim order');
  assert.equal(t.holderOf(F2), 'c');
  assert.deepEqual(t.claim('c', []), ['c'], 'an empty claim releases everything');
  assert.equal(t.holderOf(F2), null);
});

test('claiming the same set again changes nothing; rejoining puts a session at the back', () => {
  const t = createRelayLeases();
  t.claim('a', [F1]);
  assert.deepEqual(t.claim('a', [F1]), []);
  t.claim('b', [F1]);
  t.claim('a', []);
  t.claim('a', [F1]);
  assert.equal(t.holderOf(F1), 'b');
});

test('a claim names channels as kHz:AM or kHz:FM, at most 11', () => {
  assert.equal(claimProblem([F1, '121500:FM']), null);
  assert.match(claimProblem('x'), /list/);
  assert.match(claimProblem(['251.000']), /not a channel/);
  assert.match(claimProblem(['100:INTERCOM']), /not a channel/);
  assert.match(claimProblem(Array.from({ length: 12 }, (_, i) => `${251000 + i}:AM`)), /at most 11/);
  assert.throws(() => createRelayLeases().claim('a', ['x']));
});

test('the wire: an ack and the claimant\'s leases; a refusal is VALIDATION_ERROR and moves nothing', () => {
  const w = createRadioRelayWire();
  const a = { controllerId: 'a' }, b = { controllerId: 'b' };
  assert.equal(w.handles(CLAIM), true);
  assert.equal(w.handles('efsp-mutation'), false);
  const out = w.handle(a, { type: CLAIM, clientMutationId: 'm1', channels: [F1, F2] });
  assert.deepEqual(out.map(o => [o.session, o.frame.type]), [[a, 'radio-relay-ack'], [a, 'radio-relay-leases']]);
  assert.deepEqual(out[0].frame, { version: 1, type: 'radio-relay-ack', clientMutationId: 'm1', ok: true });
  assert.deepEqual(out[1].frame.held, [F2, F1].sort());
  const refused = w.handle(b, { type: CLAIM, clientMutationId: 'm2', channels: ['nope'] });
  assert.equal(refused.length, 1);
  assert.equal(refused[0].frame.ok, false);
  assert.equal(refused[0].frame.reason, 'VALIDATION_ERROR');
  // b waits for F2; a unlinks it: b is told it holds it now (the grant)
  w.handle(b, { type: CLAIM, clientMutationId: 'm3', channels: [F2] });
  const moved = w.handle(a, { type: CLAIM, clientMutationId: 'm4', channels: [F1] });
  const toB = moved.filter(o => o.session === b);
  assert.deepEqual(toB.map(o => o.frame), [{ version: 1, type: 'radio-relay-leases', held: [F2] }]);
  // a closes: nobody waits for F1, so nobody is told
  assert.deepEqual(w.close(a), []);
  assert.equal(w.leases.holderOf(F1), null);
});

test('through the hub: a claim is answered to the claimant, a close passes the lease on at once', () => {
  const radioRelay = createRadioRelayWire();
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), radioRelay });
  const join = (id) => { const ws = fakeWs(); const s = { controllerId: id, who: id }; hub._sessions.set(ws, s); return { ws, s }; };
  const a = join('a'), b = join('b');
  hub._onMessage(a.ws, a.s, JSON.stringify({ version: 1, type: CLAIM, clientMutationId: 'x', channels: [F1] }));
  hub._onMessage(b.ws, b.s, JSON.stringify({ version: 1, type: CLAIM, clientMutationId: 'y', channels: [F1] }));
  assert.deepEqual(a.ws.of('radio-relay-leases').at(-1).held, [F1]);
  assert.deepEqual(b.ws.of('radio-relay-leases').at(-1).held, []);
  assert.equal(b.ws.of('radio-relay-ack')[0].ok, true);
  // a's socket closes (the hub's close handler)
  hub._sessions.delete(a.ws);
  hub._sendRadioRelay(radioRelay.close(a.s));
  assert.deepEqual(b.ws.of('radio-relay-leases').at(-1).held, [F1]);
});
