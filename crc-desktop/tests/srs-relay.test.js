// The linked-frequency relay (app/srs/relay.js, relay-seen.js, relay-path.js; ADR 0158 §4 as amended by ADR 0159).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideRelay, RELAY_UNIT_ID, CHECKS } = require('../app/srs/relay');
const { createRelaySeen, RUN_GAP_MS } = require('../app/srs/relay-seen');
const { createRelayPath, channelKey, normaliseGroups } = require('../app/srs/relay-path');
const { encodeVoicePacket, decodeVoicePacket } = require('../app/srs/voice-packet');
const { Modulation } = require('../app/srs/sync-message');

const US = 'US000000000000000000xx';
const PILOT = 'PILOT00000000000000000';
const PILOT2 = 'PILOT20000000000000000';
const OTHER = 'OTHERRELAY000000000000';
const AM = Modulation.AM;
const F1 = 251e6, F2 = 122.1e6, F3 = 305.5e6;
const ch = (hz) => ({ key: channelKey(hz / 1e6, 'AM'), hz, modulation: AM });
const K1 = ch(F1).key, K2 = ch(F2).key, K3 = ch(F3).key;

function pkt(over = {}) {
  return {
    audio: Buffer.from([1, 2, 3]), frequencies: [F1], modulations: [AM], encryptions: [0], unitId: 7,
    packetNumber: 1, retransmissionCount: 0, originalGuid: PILOT, guid: PILOT, ...over,
  };
}

function ctxOf(over = {}) {
  return {
    ourGuid: US, groups: [{ id: 'AUTO', channels: [ch(F1), ch(F2)] }], leases: new Set([K1, K2]), pttChannels: [],
    seen: createRelaySeen(), now: 0, ...over,
  };
}

/** The relayed packet as it comes back off the air (the server forwards the bytes unchanged). */
const onAir = (out, over = {}) => ({ ...decodeVoicePacket(encodeVoicePacket(out)), ...over });

test('a pilot on one frequency is relayed onto the other, with the pilot as original and us as sender', () => {
  const d = decideRelay(pkt({ packetNumber: 42 }), ctxOf());
  assert.equal(d.relay, true);
  assert.deepEqual(d.out.frequencies, [F2]);
  assert.equal(d.out.originalGuid, PILOT);
  assert.equal(d.out.guid, US);
  assert.equal(d.out.unitId, RELAY_UNIT_ID);
  assert.notEqual(d.out.unitId, 7, 'never the pilot\'s unit id');
  assert.equal(d.out.packetNumber, 42);
  assert.equal(d.out.retransmissionCount, 1, 'RetransmissionCount + 1 (H184)');
  assert.deepEqual([...d.out.audio], [1, 2, 3]);
});

test('the relay sends one packet carrying every other frequency of the group', () => {
  const d = decideRelay(pkt(), ctxOf({ groups: [{ id: 'G1', channels: [ch(F1), ch(F2), ch(F3)] }], leases: new Set([K1, K2, K3]) }));
  assert.deepEqual(d.out.frequencies, [F2, F3]);
});

test('the round trip: our relay output fed back in is never sent again', () => {
  const ctx = ctxOf();
  const d = decideRelay(pkt(), ctx);
  assert.equal(d.relay, true);
  const back = decideRelay(onAir(d.out), ctx);
  assert.equal(back.relay, false);
});

// What could come back to us: our relay output, our own transmission, another relay's copy of the same run (whose count
// a server might have reset), and our output re-relayed by another relay.
function loopCases(ctx) {
  const first = decideRelay(pkt(), ctx);
  assert.equal(first.relay, true);
  return {
    ourOutput: onAir(first.out),
    ourOutputCountReset: onAir(first.out, { retransmissionCount: 0 }),
    ourTransmission: pkt({ originalGuid: US, guid: US, frequencies: [F2] }),
    otherRelayCopy: pkt({ guid: OTHER, frequencies: [F2], retransmissionCount: 1 }),
    otherRelayCopyCountReset: pkt({ guid: OTHER, frequencies: [F2], retransmissionCount: 0 }),
    ourTransmissionViaOther: pkt({ originalGuid: US, guid: OTHER, frequencies: [F1], retransmissionCount: 0 }),
  };
}

for (const check of Object.values(CHECKS)) {
  test(`with check ${check} disabled the loop stays closed`, () => {
    const ctx = ctxOf({ disabled: new Set([check]) });
    const cases = loopCases(ctx);
    for (const [name, p] of Object.entries(cases)) {
      const d = decideRelay(p, { ...ctx, now: 20 });
      // With the count check off, a reset count is caught by the run table; with the run table off, by the count or sender.
      if (check === CHECKS.WAY_BACK && (name === 'otherRelayCopyCountReset' || name === 'ourTransmissionViaOther')) continue;
      assert.equal(d.relay, false, `${name} was relayed`);
    }
  });
}

test('check 1 alone: a packet whose sender is us is dropped', () => {
  const ctx = ctxOf({ disabled: new Set([CHECKS.RELAYED, CHECKS.WAY_BACK, CHECKS.PTT]) });
  assert.deepEqual(decideRelay(pkt({ guid: US, originalGuid: PILOT }), ctx), { relay: false, reason: CHECKS.OWN });
});

test('check 2 alone: a packet already relayed is dropped', () => {
  const ctx = ctxOf({ disabled: new Set([CHECKS.OWN, CHECKS.WAY_BACK, CHECKS.PTT]) });
  assert.deepEqual(decideRelay(pkt({ guid: OTHER, retransmissionCount: 1 }), ctx), { relay: false, reason: CHECKS.RELAYED });
});

test('check 3 alone: our own original, and a known run arriving another way, are dropped', () => {
  const ctx = ctxOf({ disabled: new Set([CHECKS.OWN, CHECKS.RELAYED, CHECKS.PTT]) });
  assert.deepEqual(decideRelay(pkt({ originalGuid: US, guid: OTHER }), ctx), { relay: false, reason: CHECKS.WAY_BACK });
  assert.equal(decideRelay(pkt(), ctx).relay, true);
  // the same run from another sender on the other frequency, count reset: a copy coming back
  assert.deepEqual(decideRelay(pkt({ guid: OTHER, frequencies: [F2], packetNumber: 1 }), { ...ctx, now: 30 }), { relay: false, reason: CHECKS.WAY_BACK });
  // the pilot's own next packet the entry way still goes through
  assert.equal(decideRelay(pkt({ packetNumber: 2 }), { ...ctx, now: 40 }).relay, true);
});

test('check 4 alone: nothing is relayed into a group our PTT is down on', () => {
  const ctx = ctxOf({ disabled: new Set([CHECKS.OWN, CHECKS.RELAYED, CHECKS.WAY_BACK]), pttChannels: [{ hz: F2, modulation: AM }] });
  assert.deepEqual(decideRelay(pkt(), ctx), { relay: false, reason: CHECKS.PTT });
  // PTT on another group does not block this one
  assert.equal(decideRelay(pkt(), { ...ctx, pttChannels: [{ hz: F3, modulation: AM }] }).relay, true);
});

test('a run ends after the gap: a new transmission may come in another way', () => {
  const ctx = ctxOf();
  assert.equal(decideRelay(pkt(), ctx).relay, true);
  const otherWay = pkt({ frequencies: [F2], packetNumber: 1 });
  assert.equal(decideRelay(otherWay, { ...ctx, now: 100 }).relay, false, 'inside the run: a copy');
  const d = decideRelay(otherWay, { ...ctx, now: 100 + RUN_GAP_MS + 1 });
  assert.equal(d.relay, true, 'the pilot keyed again on the other frequency');
  assert.deepEqual(d.out.frequencies, [F1]);
});

test('never the intercom, never an unlinked frequency, never a frequency we hold no lease for', () => {
  assert.equal(decideRelay(pkt({ modulations: [Modulation.INTERCOM] }), ctxOf()).reason, 'intercom');
  assert.equal(decideRelay(pkt({ frequencies: [F3] }), ctxOf()).reason, 'not-linked');
  assert.equal(decideRelay(pkt(), ctxOf({ leases: new Set([K1]) })).reason, 'no-target');
  assert.equal(decideRelay(pkt({ encryptions: [1] }), ctxOf()).reason, 'not-linked', 'an encrypted segment is not heard');
});

test('a receive-only radio is never a source and never a target', () => {
  const ro = (c) => ({ ...c, receiveOnly: true });
  assert.equal(decideRelay(pkt(), ctxOf({ groups: [{ id: 'G', channels: [ro(ch(F1)), ch(F2)] }] })).relay, false);
  const g3 = [{ id: 'G', channels: [ch(F1), ro(ch(F2)), ch(F3)] }];
  const d = decideRelay(pkt(), ctxOf({ groups: g3, leases: new Set([K1, K2, K3]) }));
  assert.deepEqual(d.out.frequencies, [F3]);
});

test('normaliseGroups: AM/FM only, keys in kHz, a group needs two channels', () => {
  const g = normaliseGroups([
    { id: 'A', channels: [{ mhz: 251, modulation: 'AM' }, { mhz: 122.1, modulation: 'AM' }, { mhz: 100, modulation: 'INTERCOM' }] },
    { id: 'B', channels: [{ mhz: 243, modulation: 'AM' }] },
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].channels.map(c => c.key), ['251000:AM', '122100:AM']);
  assert.equal(channelKey(100, 'INTERCOM'), null);
});

test('a 200-packet transmission is relayed in full, through the relay path', () => {
  const sent = [];
  let t = 0;
  const path = createRelayPath({ guid: US, send: (b) => { sent.push(decodeVoicePacket(b)); return true; }, pttChannels: () => [], now: () => t });
  path.setLinkGroups([{ id: 'AUTO', channels: [{ mhz: 251, modulation: 'AM' }, { mhz: 122.1, modulation: 'AM' }] }]);
  path.setRelayLeases(['251000:AM', '122100:AM']);
  for (let n = 1; n <= 200; n++) { t = n * 40; path.onPacket(pkt({ packetNumber: n })); }
  assert.equal(sent.length, 200);
  assert.deepEqual(sent.map(p => p.packetNumber), Array.from({ length: 200 }, (_, i) => i + 1));
  assert.equal(path.relayedPackets(), 200);
});

// A small SRS network: the server forwards a packet to every other client tuned to any of its frequencies, and drops a
// packet whose count is above RETRANSMISSION_NODE_LIMIT (1, H184). Optionally it resets the count (a hostile server).
// Delivery is breadth first: an original reaches every client before a relay's copy of it, which needs one more hop.
function air({ relays, listeners, resetCount = false }) {
  let onAirCount = 0;
  const heard = new Map(listeners.map(l => [l.name, 0]));
  function send(from0, packet0) {
    const queue = [[from0, packet0]];
    while (queue.length) {
      const [from, packet] = queue.shift();
      if (packet.retransmissionCount > 1) continue;
      onAirCount++;
      assert.ok(onAirCount < 1e5, 'the packets on the air never stop: a loop');
      const p = resetCount ? { ...packet, retransmissionCount: 0 } : packet;
      const tuned = (set) => p.frequencies.some(f => set.includes(f));
      for (const l of listeners) if (l.name !== from && tuned(l.tuned)) heard.set(l.name, heard.get(l.name) + 1);
      for (const r of relays) {
        if (r.guid === from || !tuned(r.tuned)) continue;
        const d = decideRelay(p, { ourGuid: r.guid, groups: r.groups, leases: r.leases, pttChannels: [], seen: r.seen, now: r.now });
        if (d.relay) queue.push([r.guid, d.out]);
      }
    }
  }
  return { send, onAir: () => onAirCount, heard };
}

function relay(guid, freqs, leased) {
  return { guid, tuned: freqs, groups: [{ id: 'G', channels: freqs.map(ch) }], leases: new Set(leased.map(f => ch(f).key)), seen: createRelaySeen(), now: 0 };
}

for (const resetCount of [false, true]) {
  test(`two relays sharing a frequency: the packets on the air do not multiply${resetCount ? ' (server resets the count)' : ''}`, () => {
    // Both link 251.000 and 122.100; crc-sync gave 122.100 to A and 251.000 to B.
    const A = relay('RELAYA0000000000000000', [F1, F2], [F2]);
    const B = relay('RELAYB0000000000000000', [F1, F2], [F1]);
    const listeners = [{ name: 'on251', tuned: [F1] }, { name: 'on122', tuned: [F2] }, { name: 'onBoth', tuned: [F1, F2] }];
    const net = air({ relays: [A, B], listeners, resetCount });
    for (let n = 1; n <= 200; n++) {
      A.now = B.now = n * 40;
      const before = net.onAir();
      net.send(PILOT, pkt({ packetNumber: n }));
      assert.equal(net.onAir() - before, 2, `packet ${n}: the pilot's and one relay copy`);
    }
    assert.equal(net.heard.get('on122'), 200, 'the pilot on 251.000 is heard on 122.100, every packet, once');
    assert.equal(net.heard.get('on251'), 200);
    // Then a second pilot on 122.100: B holds 251.000 and relays it there.
    for (let n = 1; n <= 50; n++) {
      A.now = B.now = 20000 + n * 40;
      const before = net.onAir();
      net.send(PILOT2, pkt({ originalGuid: PILOT2, guid: PILOT2, frequencies: [F2], packetNumber: n }));
      assert.equal(net.onAir() - before, 2);
    }
  });
}

test('three frequencies, two relays with overlapping groups: still one copy per packet', () => {
  const A = relay('RELAYA0000000000000000', [F1, F2, F3], [F1, F2]);
  const B = relay('RELAYB0000000000000000', [F2, F3], [F3]);
  const net = air({ relays: [A, B], listeners: [{ name: 'on305', tuned: [F3] }, { name: 'on122', tuned: [F2] }], resetCount: true });
  for (let n = 1; n <= 100; n++) {
    A.now = B.now = n * 40;
    const before = net.onAir();
    net.send(PILOT, pkt({ packetNumber: n }));
    assert.ok(net.onAir() - before <= 3, `packet ${n}: ${net.onAir() - before} on the air`);
  }
  assert.equal(net.heard.get('on122'), 100);
});
