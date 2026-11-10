import { test } from 'node:test';
import assert from 'node:assert/strict';
import AtisStore from '../src/atis-store.js';
import { createAtisTransmitHandler, parseFrequencies } from '../src/atis-transmit.js';

// docs/adr/0158 §5: POST /api/atis-transmit on one or two frequencies, one SRS Transmit each, ownership per frequency.

const UHF = 251000000;
const VHF = 121500000;

/** A grpc-client stand-in: each transmitAtis returns a call whose promise the test settles by hand. */
function fakeGrpc() {
  const sent = [];
  return {
    sent,
    transmitAtis(opts) {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      const call = { cancelled: false, cancel() { this.cancelled = true; } };
      sent.push({ opts, call, resolve, reject });
      return { call, promise };
    },
  };
}

function fakeRes() {
  let done;
  const settled = new Promise(r => { done = r; });
  const res = {
    statusCode: 200, body: undefined, settled,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; done(); return this; },
  };
  return res;
}

function setup() {
  const atisStore = new AtisStore();
  const grpc = fakeGrpc();
  const broadcasts = [];
  const wsHub = { setAtisActive: (l) => broadcasts.push(l) };
  const handler = createAtisTransmitHandler({ atisStore, grpcClient: grpc, wsHub });
  const post = (body) => { const res = fakeRes(); handler({ body }, res); return res; };
  return { atisStore, grpc, broadcasts, post };
}

const tick = (ownerId, frequencies) => ({ ownerId, frequencies, ssml: 'This is ATIS', coalition: 3, position: { lat: 1, lon: 2, alt: 3 } });

test('parseFrequencies takes one or two distinct whole-Hz frequencies', () => {
  assert.deepEqual(parseFrequencies([UHF]), { frequencies: [UHF] });
  assert.deepEqual(parseFrequencies([UHF, VHF]), { frequencies: [UHF, VHF] });
  for (const bad of [undefined, [], [UHF, VHF, 243000000], [UHF, UHF], [0], [-1], [251.5], ['x'], UHF]) {
    assert.ok('error' in parseFrequencies(bad), `refused: ${JSON.stringify(bad)}`);
  }
});

test('a request without ownerId or with bad frequencies is a 400 and transmits nothing', () => {
  const { grpc, post } = setup();
  assert.equal(post({ frequencies: [UHF] }).statusCode, 400);
  assert.equal(post({ ownerId: 'a', frequency: UHF }).statusCode, 400, 'the single `frequency` field is gone');
  assert.equal(post({ ownerId: 'a', frequencies: [UHF, UHF] }).statusCode, 400);
  assert.equal(grpc.sent.length, 0);
});

test('two frequencies start two concurrent transmits and the answer waits for both', async () => {
  const { atisStore, grpc, broadcasts, post } = setup();
  const res = post(tick('a', [UHF, VHF]));
  assert.deepEqual(grpc.sent.map(s => s.opts.frequency), [UHF, VHF], 'both started before either finished');
  assert.equal(grpc.sent[0].opts.ssml, 'This is ATIS');
  assert.deepEqual(grpc.sent[1].opts.position, { lat: 1, lon: 2, alt: 3 });
  assert.deepEqual(broadcasts.at(-1), [{ frequency: UHF, ownerId: 'a' }, { frequency: VHF, ownerId: 'a' }], 'atisActive lists both');

  grpc.sent[0].resolve({ duration_ms: 4000 });
  await new Promise(r => setImmediate(r));
  assert.equal(res.body, undefined, 'no answer while the VHF call still plays');

  grpc.sent[1].resolve({ duration_ms: 6000 });
  await res.settled;
  assert.deepEqual(res.body, { ok: true, duration_ms: 6000 });
  assert.equal(atisStore.firstRefused([UHF, VHF], 'b'), null, 'both in-flight entries cleared once they finished');
});

test('a second client is refused on either frequency, and nothing of its start happens', () => {
  const { grpc, post } = setup();
  post(tick('a', [UHF, VHF]));
  const before = grpc.sent.length;

  const onVhf = post(tick('b', [VHF]));
  assert.equal(onVhf.statusCode, 409);
  assert.equal(onVhf.body.frequency, VHF);
  assert.equal(onVhf.body.reason, 'in-use');
  assert.match(onVhf.body.error, /121\.500/);

  const both = post(tick('b', [243000000, UHF]));
  assert.equal(both.statusCode, 409);
  assert.equal(both.body.frequency, UHF, 'says which frequency refused it');
  assert.equal(grpc.sent.length, before, 'the free frequency was not started either');
});

test('the same owner may start its next tick on both frequencies', () => {
  const { grpc, post } = setup();
  post(tick('a', [UHF, VHF]));
  const again = post(tick('a', [UHF, VHF]));
  assert.equal(again.statusCode, 200);
  assert.equal(grpc.sent.length, 4);
});

test('one failed frequency fails the tick with which one and why', async () => {
  const { grpc, post } = setup();
  const res = post(tick('a', [UHF, VHF]));
  grpc.sent[0].resolve({ duration_ms: 1 });
  grpc.sent[1].reject(new Error('SRS refused'));
  await res.settled;
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body.frequencies, [VHF]);
  assert.match(res.body.error, /121\.500: SRS refused/);
});

test('stop cancels both in-flight calls and clears both from atisActive', () => {
  const { atisStore, grpc, broadcasts, post } = setup();
  post(tick('a', [UHF, VHF]));
  const res = post({ stop: true, ownerId: 'a', frequencies: [UHF, VHF] });
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(grpc.sent.map(s => s.call.cancelled), [true, true]);
  assert.deepEqual(broadcasts.at(-1), []);
  assert.deepEqual(atisStore.getActive(), []);
});

test('a stop from another client releases nothing', () => {
  const { atisStore, grpc, post } = setup();
  post(tick('a', [UHF, VHF]));
  post({ stop: true, ownerId: 'b', frequencies: [UHF, VHF] });
  assert.deepEqual(grpc.sent.map(s => s.call.cancelled), [false, false]);
  assert.equal(atisStore.getActive().length, 2);
});
