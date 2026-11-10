import { test } from 'node:test';
import assert from 'node:assert/strict';
import AtisStore from '../src/atis-store.js';

test('canStart allows an unheld frequency', () => {
  const store = new AtisStore();
  assert.equal(store.canStart(251000000, 'owner-a'), true);
});

test('canStart allows the same owner to renew, rejects a different owner', () => {
  const store = new AtisStore();
  store.start(251000000, 'owner-a', {});
  assert.equal(store.canStart(251000000, 'owner-a'), true);
  assert.equal(store.canStart(251000000, 'owner-b'), false);
});

test('canStart allows a different owner to take over once the entry and the presence are stale', () => {
  const store = new AtisStore(10, 10); // 10ms in-flight and presence TTLs for the test
  store.start(251000000, 'owner-a', {});
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(store.canStart(251000000, 'owner-b'), true);
      resolve();
    }, 20);
  });
});

test('stop clears the entry and cancels the call handle, but only for the owning client', () => {
  const store = new AtisStore();
  let cancelled = false;
  const call = { cancel: () => { cancelled = true; } };
  store.start(251000000, 'owner-a', call);

  assert.equal(store.stop(251000000, 'owner-b'), false, 'a non-owner cannot stop another client\'s loop');
  assert.equal(cancelled, false);
  assert.equal(store.canStart(251000000, 'owner-b'), false, 'entry must still be held after a rejected stop');

  assert.equal(store.stop(251000000, 'owner-a'), true);
  assert.equal(cancelled, true);
  assert.equal(store.canStart(251000000, 'owner-b'), true, 'frequency is free once the real owner stops it');
});

test('finish only clears the entry if it is still the same in-flight call', () => {
  const store = new AtisStore();
  const staleCall = {};
  const currentCall = {};
  store.start(251000000, 'owner-a', staleCall);
  store.start(251000000, 'owner-a', currentCall); // a same-owner retry superseded the first call

  store.finish(251000000, staleCall); // late settle of the superseded call
  assert.equal(store.canStart(251000000, 'owner-b'), false, 'the current call\'s entry must survive a stale finish()');

  store.finish(251000000, currentCall);
  assert.equal(store.canStart(251000000, 'owner-a'), true, 'the owner\'s next tick may start');
  assert.equal(store.canStart(251000000, 'owner-b'), false, 'another owner is refused through the loop\'s pause');
  store.stop(251000000, 'owner-a');
  assert.equal(store.canStart(251000000, 'owner-b'), true, 'free once the owner stops');
});

test('getActive reports a loop as in-use through finish() — not just while a call is in flight', () => {
  const store = new AtisStore();
  const call = {};
  store.start(251000000, 'owner-a', call);
  assert.deepEqual(store.getActive(), [{ frequency: 251000000, ownerId: 'owner-a' }]);

  store.finish(251000000, call); // one loop iteration's transmission finished playing
  assert.deepEqual(store.getActive(), [{ frequency: 251000000, ownerId: 'owner-a' }],
    'still in use during the pause before the loop\'s next call');
});

test('getActive clears once stop() is called, even mid-pause with no in-flight call', () => {
  const store = new AtisStore();
  const call = {};
  store.start(251000000, 'owner-a', call);
  store.finish(251000000, call); // now in the pause between calls — _byFreq is empty

  assert.equal(store.stop(251000000, 'owner-a'), false, 'no in-flight call to cancel, so stop() itself reports nothing to stop');
  assert.deepEqual(store.getActive(), [], 'but presence is still cleared immediately');
});

test('getActive prunes an entry once presenceTtlMs lapses without a fresh start/finish', () => {
  const store = new AtisStore(8000, 10); // 10ms presence TTL for the test
  store.start(251000000, 'owner-a', {});
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.deepEqual(store.getActive(), []);
      resolve();
    }, 20);
  });
});

test('firstRefused names the first frequency another owner holds, or null when all are free (docs/adr/0158 §5)', () => {
  const store = new AtisStore();
  store.start(121500000, 'owner-a', {});
  assert.equal(store.firstRefused([251000000, 121500000], 'owner-b'), 121500000);
  assert.equal(store.firstRefused([251000000, 121500000], 'owner-a'), null, 'its own frequencies never refuse it');
  assert.equal(store.firstRefused([251000000], 'owner-b'), null);
});
