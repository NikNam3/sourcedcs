'use strict';
// Which received packets the relay re-sends, and where (ADR 0158 §4 as amended by ADR 0159). Pure apart from the run
// table it is handed (relay-seen.js). Inputs: the link groups, the relay leases this client holds, the PTT state and
// the packet.
//
// A pilot transmitting on one frequency of a link group is heard on the group's other frequencies: the client holding
// those frequencies' relay leases re-sends the same Opus frame, as ONE packet carrying every target frequency (so a
// listener tuned to two of them hears it once), with the pilot's `originalGuid` and packet number, our `guid`, the
// fixed RELAY_UNIT_ID and `retransmissionCount + 1`. The SRS server must have RETRANSMISSION_NODE_LIMIT >= 1 (H184),
// or it drops every relayed packet.
//
// Dropped, never re-sent, when any of these holds. Each check closes the loop on its own (the tests disable each in
// turn):
//   1 OWN       the sender `guid` is ours: our own transmission, or our own relay output coming back.
//   2 RELAYED   `retransmissionCount` >= 1: already a relay, so relays never chain (one hop).
//   3 WAY_BACK  `originalGuid` is ours, or the packet is a copy of a known run arriving another way (relay-seen.js).
//   4 PTT       our PTT is down on that group: our voice already goes out on all of it.
// Also dropped: an intercom packet (H183), a packet on no frequency of a linked group, a group whose source channel
// is receive-only (an Observer's radio), and when no target is left (no other frequency, none leased to us, or only
// receive-only ones).

const { Modulation } = require('./sync-message');
const { MATCH_TOLERANCE_HZ } = require('./radio-slots');

/** The unit id on every relayed packet: never the pilot's, never the intercom unit we joined (H183). */
const RELAY_UNIT_ID = 1;

const CHECKS = Object.freeze({ OWN: 'own', RELAYED: 'relayed', WAY_BACK: 'way-back', PTT: 'ptt' });

const hits = (ch, hz, modulation) => Math.abs(ch.hz - hz) < MATCH_TOLERANCE_HZ && ch.modulation === modulation;

/** The packet's clear (unencrypted) segments as [{hz, modulation}]. */
function segmentsOf(p) {
  const out = [];
  for (let i = 0; i < p.frequencies.length; i++) {
    if (p.encryptions && p.encryptions[i]) continue;
    out.push({ hz: p.frequencies[i], modulation: p.modulations[i] });
  }
  return out;
}

/**
 * @param {object} packet a decoded voice packet (voice-packet.js)
 * @param {object} ctx
 * @param {string} ctx.ourGuid
 * @param {Array<{id:string, channels:Array<{key:string, hz:number, modulation:number, receiveOnly?:boolean}>}>} ctx.groups
 * @param {Set<string>} ctx.leases the channel keys this client holds the relay lease for
 * @param {Array<{hz:number, modulation:number}>} ctx.pttChannels what our PTT is transmitting on now (empty when up)
 * @param {{observe:Function}} ctx.seen relay-seen.js
 * @param {number} ctx.now wall-clock ms
 * @param {Set<string>} [ctx.disabled] CHECKS turned off: tests only, to prove each check closes the loop alone
 * @returns {{relay:false, reason:string} | {relay:true, out:object}}
 */
function decideRelay(packet, ctx) {
  const off = ctx.disabled || new Set();
  const drop = (reason) => ({ relay: false, reason });
  if (packet.modulations.includes(Modulation.INTERCOM)) return drop('intercom');
  if (!off.has(CHECKS.OWN) && packet.guid === ctx.ourGuid) return drop(CHECKS.OWN);
  if (!off.has(CHECKS.RELAYED) && packet.retransmissionCount >= 1) return drop(CHECKS.RELAYED);
  if (!off.has(CHECKS.WAY_BACK) && packet.originalGuid === ctx.ourGuid) return drop(CHECKS.WAY_BACK);

  const segs = segmentsOf(packet);
  const sources = [];
  for (const g of ctx.groups) {
    const heard = g.channels.filter(ch => segs.some(s => hits(ch, s.hz, s.modulation)));
    if (heard.length) sources.push({ group: g, heard });
  }
  if (!sources.length) return drop('not-linked');
  const heardKeys = sources.flatMap(s => s.heard.map(ch => ch.key));

  // The run is noted before the PTT and lease checks: the way a transmission came in does not depend on them.
  const way = ctx.seen.observe(packet.originalGuid, packet.guid, heardKeys, ctx.now);
  if (!off.has(CHECKS.WAY_BACK) && way === 'copy') return drop(CHECKS.WAY_BACK);

  const targets = [];
  let pttBlocked = false;
  for (const { group, heard } of sources) {
    if (heard.some(ch => ch.receiveOnly)) continue; // an Observer's radio is never a source
    if (!off.has(CHECKS.PTT) && group.channels.some(ch => ctx.pttChannels.some(t => hits(ch, t.hz, t.modulation)))) { pttBlocked = true; continue; }
    for (const ch of group.channels) {
      if (ch.receiveOnly || heardKeys.includes(ch.key) || !ctx.leases.has(ch.key)) continue;
      if (segs.some(s => hits(ch, s.hz, s.modulation))) continue; // the pilot already transmits on it
      if (!targets.some(t => t.key === ch.key)) targets.push(ch);
    }
  }
  if (!targets.length) return drop(pttBlocked ? CHECKS.PTT : 'no-target');
  return {
    relay: true,
    out: {
      audio: packet.audio,
      frequencies: targets.map(t => t.hz),
      modulations: targets.map(t => t.modulation),
      encryptions: targets.map(() => 0),
      unitId: RELAY_UNIT_ID,
      packetNumber: packet.packetNumber,
      retransmissionCount: packet.retransmissionCount + 1,
      originalGuid: packet.originalGuid,
      guid: ctx.ourGuid,
    },
  };
}

module.exports = { decideRelay, RELAY_UNIT_ID, CHECKS };
