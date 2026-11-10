'use strict';

// What the relay re-sends, and where (docs/adr/0160). Pure.
//
// A received packet's channels are its clear (unencrypted) AM and FM segments. Its targets are every channel of every
// network one of those channels is in, minus the packet's own channels. So a pilot's single-frequency packet goes out
// on the rest of its network, and a controller's packet, which already carries the controller's own group, gets the
// network's missing channels added (H186 ruling 2).
//
// Dropped, never re-sent, when any of these holds:
//   OWN        the sender `guid` is one of the relay's own connections: its own output coming back;
//   RELAYED    `retransmissionCount` >= 1: already a relay, so the chain is one hop (H184: the server allows 1);
//   intercom   any segment is INTERCOM (H183: never relayed);
//   no-target  nothing is left to send on.
// OWN and RELAYED each close the loop on their own; the tests disable each in turn.
//
// The relayed packet is ONE packet carrying only the targets (a listener tuned to two of them hears it once). It keeps
// the Opus bytes, the packet number and `originalGuid`; it takes the sending connection's `guid`, the received count
// + 1 and the fixed RELAY_UNIT_ID; each segment has its target's modulation and encryption 0.

const { Modulation } = require('./srs/sync-message');

/** The unit id on every relayed packet: never a pilot's (ADR 0159 §1). */
const RELAY_UNIT_ID = 1;

const CHECKS = Object.freeze({ OWN: 'own', RELAYED: 'relayed' });

const MODULATION_NAME = Object.freeze({ [Modulation.AM]: 'AM', [Modulation.FM]: 'FM' });
const MODULATION_OF = Object.freeze({ AM: Modulation.AM, FM: Modulation.FM });

/** "251000:AM" for a segment of 251 000 000 Hz AM; null for a modulation the relay never carries. */
function segmentKey(hz, modulation) {
  const name = MODULATION_NAME[modulation];
  const khz = Math.round(Number(hz) / 1000);
  return name && khz > 0 ? `${khz}:${name}` : null;
}

/** {hz, modulation} for a channel key. */
function channelOf(key) {
  const [khz, mod] = key.split(':');
  return { hz: Number(khz) * 1000, modulation: MODULATION_OF[mod] };
}

/**
 * @param {object} packet a decoded voice packet (srs/voice-packet.js)
 * @param {object} ctx
 * @param {Set<string>} ctx.ownGuids the GUIDs of every relay connection
 * @param {string} ctx.sendGuid the GUID the relayed packet goes out with (the connection that sends it)
 * @param {Array<{channels:string[]}>} ctx.networks link-networks.js buildNetworks
 * @param {Map<string, number>} ctx.index link-networks.js indexNetworks(networks)
 * @param {Set<string>} [ctx.disabled] CHECKS turned off: tests only
 * @returns {{relay:false, reason:string} | {relay:true, out:object, targets:string[]}}
 */
function decideRelay(packet, ctx) {
  const off = ctx.disabled || new Set();
  const drop = (reason) => ({ relay: false, reason });
  if (!off.has(CHECKS.OWN) && ctx.ownGuids.has(packet.guid)) return drop(CHECKS.OWN);
  if (!off.has(CHECKS.RELAYED) && packet.retransmissionCount >= 1) return drop(CHECKS.RELAYED);
  if (packet.modulations.includes(Modulation.INTERCOM)) return drop('intercom');

  const own = new Set();
  for (let i = 0; i < packet.frequencies.length; i++) {
    const key = segmentKey(packet.frequencies[i], packet.modulations[i]);
    if (key) own.add(key); // the packet already carries it, encrypted or not: never a target
  }
  const networks = new Set();
  for (let i = 0; i < packet.frequencies.length; i++) {
    if (packet.encryptions && packet.encryptions[i]) continue; // encrypted audio is not relayed (ADR 0159 D10)
    const n = ctx.index.get(segmentKey(packet.frequencies[i], packet.modulations[i]));
    if (n !== undefined) networks.add(n);
  }
  const targets = [];
  for (const n of [...networks].sort((a, b) => a - b)) {
    for (const c of ctx.networks[n].channels) if (!own.has(c) && !targets.includes(c)) targets.push(c);
  }
  if (!targets.length) return drop('no-target');

  const channels = targets.map(channelOf);
  return {
    relay: true,
    targets,
    out: {
      audio: packet.audio,
      frequencies: channels.map(c => c.hz),
      modulations: channels.map(c => c.modulation),
      encryptions: channels.map(() => 0),
      unitId: RELAY_UNIT_ID,
      packetNumber: packet.packetNumber,
      retransmissionCount: packet.retransmissionCount + 1,
      originalGuid: packet.originalGuid,
      guid: ctx.sendGuid,
    },
  };
}

module.exports = { decideRelay, segmentKey, channelOf, RELAY_UNIT_ID, CHECKS };
