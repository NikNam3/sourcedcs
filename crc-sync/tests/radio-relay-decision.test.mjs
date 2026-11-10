import { test } from 'node:test';
import assert from 'node:assert/strict';
import networksMod from '../src/radio/link-networks.js';
import decisionMod from '../src/radio/relay-decision.js';
import poolMod from '../src/radio/relay-pool.js';
import packetMod from '../src/radio/srs/voice-packet.js';

// docs/adr/0160: the relay's networks (union-find over every session's groups), what it re-sends and where, and the
// split of its channels over SRS connections of 11 radios.

const { buildNetworks, indexNetworks, allChannels } = networksMod;
const { decideRelay, segmentKey, CHECKS, RELAY_UNIT_ID } = decisionMod;
const { splitChannels, MAX_CONNECTIONS } = poolMod;
const { encodeVoicePacket, decodeVoicePacket } = packetMod;

const F1 = '251000:AM', F2 = '122100:AM', F3 = '305500:AM', F4 = '30025:FM', G = '243000:AM';
const RELAY = 'R'.repeat(22), RELAY2 = 'S'.repeat(22), PILOT = 'p'.repeat(22), CTRL = 'c'.repeat(22);
const hz = (key) => Number(key.split(':')[0]) * 1000;
const mod = (key) => (key.endsWith(':FM') ? 1 : 0);

function packet(keys, o = {}) {
  return {
    audio: Buffer.from([0xfc, 1, 2, 3]), frequencies: keys.map(hz), modulations: keys.map(mod), encryptions: keys.map(() => 0),
    unitId: 77, packetNumber: 42, retransmissionCount: 0, originalGuid: o.guid || PILOT, guid: o.guid || PILOT, ...o,
  };
}
function ctxOf(groupLists, extra = {}) {
  const networks = buildNetworks(groupLists);
  return { ownGuids: new Set([RELAY, RELAY2]), sendGuid: RELAY, networks, index: indexNetworks(networks), ...extra };
}
const keysOf = (out) => out.frequencies.map((f, i) => segmentKey(f, out.modulations[i]));

test('overlapping groups of two controllers merge: A {F1,F2} + B {F2,F3} is one network {F1,F2,F3}', () => {
  const n = buildNetworks([[{ id: 'a', channels: [F1, F2] }], [{ id: 'b', channels: [F3, F2] }]]);
  assert.deepEqual(n, [{ channels: [F2, F1, F3].sort() }]);
  assert.deepEqual(allChannels(n), [F2, F1, F3].sort());
});

test('a network needs two channels; separate groups stay separate; a chain merges transitively', () => {
  assert.deepEqual(buildNetworks([[{ id: 'solo', channels: [F1] }], [{ id: 'x', channels: [F1, F1] }]]), []);
  assert.deepEqual(buildNetworks([[{ id: 'a', channels: [F1, F2] }, { id: 'b', channels: [F3, F4] }]]).length, 2);
  const chain = buildNetworks([[{ id: 'a', channels: [F1, F2] }], [{ id: 'b', channels: [F3, F4] }], [{ id: 'c', channels: [F2, F3] }]]);
  assert.deepEqual(chain, [{ channels: [F1, F2, F3, F4].sort() }]);
  assert.deepEqual(buildNetworks([[{ id: 'bad', channels: [F1, 'nope', 5] }]]), []);
});

test('a pilot on one frequency of a network is re-sent on the rest, as one packet', () => {
  const d = decideRelay(packet([F1]), ctxOf([[{ id: 'a', channels: [F1, F2] }], [{ id: 'b', channels: [F2, F3] }]]));
  assert.equal(d.relay, true);
  assert.deepEqual(keysOf(d.out).sort(), [F2, F3].sort());
  assert.deepEqual(d.out.encryptions, [0, 0]);
  assert.equal(d.out.guid, RELAY);
  assert.equal(d.out.originalGuid, PILOT);
  assert.equal(d.out.packetNumber, 42);
  assert.equal(d.out.retransmissionCount, 1);
  assert.equal(d.out.unitId, RELAY_UNIT_ID);
  assert.deepEqual([...d.out.audio], [0xfc, 1, 2, 3]);
});

test('a controller\'s own multi-frequency packet gets only the network\'s missing channels (H186 ruling 2)', () => {
  const d = decideRelay(packet([F1, F2], { guid: CTRL }), ctxOf([[{ id: 'a', channels: [F1, F2] }], [{ id: 'b', channels: [F2, F3] }]]));
  assert.equal(d.relay, true);
  assert.deepEqual(keysOf(d.out), [F3]);
  assert.equal(d.out.originalGuid, CTRL);
  const whole = decideRelay(packet([F1, F2, F3], { guid: CTRL }), ctxOf([[{ id: 'a', channels: [F1, F2, F3] }]]));
  assert.deepEqual(whole, { relay: false, reason: 'no-target' }, 'nothing missing, nothing sent');
});

test('a packet on channels of two networks goes to the union of both', () => {
  const d = decideRelay(packet([F1, F3], { guid: CTRL }), ctxOf([[{ id: 'a', channels: [F1, F2] }, { id: 'b', channels: [F3, F4] }]]));
  assert.deepEqual(keysOf(d.out).sort(), [F2, F4].sort());
  assert.deepEqual(d.out.modulations.sort(), [0, 1]);
});

test('dropped: intercom, no network, encrypted source, the modulation is the target\'s', () => {
  const ctx = ctxOf([[{ id: 'a', channels: [F1, F2] }]]);
  assert.equal(decideRelay({ ...packet([F1]), modulations: [2] }, ctx).reason, 'intercom');
  assert.equal(decideRelay({ ...packet([F1, F2]), modulations: [0, 2] }, ctx).reason, 'intercom');
  assert.equal(decideRelay(packet([G]), ctx).reason, 'no-target');
  assert.equal(decideRelay({ ...packet([F1]), encryptions: [1] }, ctx).reason, 'no-target');
  assert.equal(decideRelay({ ...packet([F1]), modulations: [1] }, ctx).reason, 'no-target', '251.000 FM is another channel');
});

test('each loop check holds on its own: OWN with RELAYED off, RELAYED with OWN off', () => {
  const ctx = ctxOf([[{ id: 'a', channels: [F1, F2] }]]);
  const out = decideRelay(packet([F1]), ctx).out;
  // the relay's own output, back from the server on another of its connections (count intact)
  assert.equal(decideRelay(out, { ...ctx, disabled: new Set([CHECKS.RELAYED]) }).reason, CHECKS.OWN);
  // a server that resets the count: OWN alone closes the loop
  assert.equal(decideRelay({ ...out, retransmissionCount: 0 }, { ...ctx, disabled: new Set([CHECKS.RELAYED]) }).reason, CHECKS.OWN);
  // a foreign relay's output (another GUID): RELAYED alone closes the loop
  assert.equal(decideRelay({ ...out, guid: 'x'.repeat(22) }, { ...ctx, disabled: new Set([CHECKS.OWN]) }).reason, CHECKS.RELAYED);
  assert.equal(decideRelay(out, { ...ctx, disabled: new Set([CHECKS.OWN]) }).reason, CHECKS.RELAYED);
  // with both off it would loop: the checks are what stops it
  assert.equal(decideRelay(out, { ...ctx, disabled: new Set([CHECKS.OWN, CHECKS.RELAYED]) }).relay, true);
});

test('the round trip: the relay\'s output, encoded and fed back in, sends nothing', () => {
  const ctx = ctxOf([[{ id: 'a', channels: [F1, F2] }], [{ id: 'b', channels: [F2, F3] }]]);
  const first = decideRelay(decodeVoicePacket(encodeVoicePacket(packet([F1]))), ctx);
  assert.equal(first.relay, true);
  const back = decodeVoicePacket(encodeVoicePacket(first.out));
  assert.equal(back.guid, RELAY);
  assert.equal(back.retransmissionCount, 1);
  assert.equal(decideRelay(back, ctx).relay, false);
  assert.equal(decideRelay(back, { ...ctx, sendGuid: RELAY2 }).relay, false, 'heard on another pool connection');
});

test('the split: 11 channels per connection, stable, and closed when empty', () => {
  const ch = Array.from({ length: 25 }, (_, i) => `${251000 + i * 25}:AM`).sort();
  const a = splitChannels([], ch);
  assert.deepEqual(a.split.map(s => s.length), [11, 11, 3]);
  assert.deepEqual(a.split.flat().sort(), ch);
  assert.deepEqual(a.untuned, []);
  // one channel of the first connection goes: nothing moves, the new one fills the gap
  const fewer = ch.filter(c => c !== a.split[0][0]);
  const extra = '399000:AM';
  const b = splitChannels(a.split, [...fewer, extra].sort());
  assert.deepEqual(b.split[1], a.split[1], 'the second connection is not retuned');
  assert.ok(b.split[0].includes(extra));
  // everything on the second goes: its slot is empty (closed)
  const c = splitChannels(a.split, ch.filter(x => !a.split[1].includes(x)));
  assert.deepEqual(c.split[1], []);
  // past the connection limit
  const many = Array.from({ length: MAX_CONNECTIONS * 11 + 2 }, (_, i) => `${200000 + i * 25}:AM`).sort();
  assert.equal(splitChannels([], many).untuned.length, 2);
});
