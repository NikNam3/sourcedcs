'use strict';
// The relay on the receive path (ADR 0158 §4, ADR 0159): every received voice packet is offered to relay.js, and what
// it decides to re-send goes out on the voice link. It holds the link groups and the leases the renderer last sent, and
// the run table. A pure decision per packet; this file only keeps the inputs and sends the answer.
//
// A channel is named on the wire (renderer, crc-sync's lease table) by `channelKey`: integer kHz and the modulation,
// e.g. "251000:AM". Only AM and FM are relayable; the intercom never is (H183).

const { Modulation } = require('./sync-message');
const { mhzToHz } = require('./radio-slots');
const { decideRelay } = require('./relay');
const { createRelaySeen } = require('./relay-seen');
const { encodeVoicePacket } = require('./voice-packet');

const RELAYABLE = Object.freeze({ AM: Modulation.AM, FM: Modulation.FM });

/** "251000:AM" for 251.000 MHz AM; null for anything that cannot be relayed. */
function channelKey(mhz, modulation) {
  const mod = String(modulation || 'AM').toUpperCase();
  const khz = Math.round(Number(mhz) * 1000);
  if (!(khz > 0) || RELAYABLE[mod] === undefined) return null;
  return `${khz}:${mod}`;
}

/**
 * The renderer's groups ([{id, channels:[{mhz, modulation, receiveOnly?}]}]) as relay.js reads them. A channel that is
 * not relayable is left out, and a group left with fewer than two channels has nothing to relay and is dropped.
 */
function normaliseGroups(groups) {
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || !Array.isArray(g.channels)) continue;
    const channels = [];
    for (const c of g.channels) {
      const key = c && channelKey(c.mhz, c.modulation);
      if (!key || channels.some(x => x.key === key)) continue;
      channels.push({ key, hz: mhzToHz(c.mhz), modulation: RELAYABLE[String(c.modulation || 'AM').toUpperCase()], receiveOnly: c.receiveOnly === true });
    }
    if (channels.length >= 2) out.push({ id: String(g.id), channels });
  }
  return out;
}

/**
 * @param {object} o
 * @param {string} o.guid this client's SRS GUID
 * @param {(buf:Buffer) => boolean} o.send the voice link's send
 * @param {() => Array<{hz:number, modulation:number}>} o.pttChannels what our PTT transmits on now (empty when up)
 * @param {() => number} [o.now] wall clock
 * @param {(msg:string) => void} [o.log]
 */
function createRelayPath(o) {
  const now = o.now || Date.now; // housekeeping only (lane rule 5): the run gap and the table's expiry
  const seen = createRelaySeen();
  let groups = [];
  let leases = new Set();
  let relayed = 0;

  return {
    setLinkGroups(next) { groups = normaliseGroups(next); },
    setRelayLeases(keys) { leases = new Set((Array.isArray(keys) ? keys : []).filter(k => typeof k === 'string')); },
    /** @returns {boolean} true when the packet was re-sent */
    onPacket(packet) {
      if (!groups.length || !leases.size) return false;
      const d = decideRelay(packet, { ourGuid: o.guid, groups, leases, pttChannels: o.pttChannels(), seen, now: now() });
      if (!d.relay) return false;
      if (!o.send(encodeVoicePacket(d.out))) return false;
      relayed++;
      return true;
    },
    relayedPackets: () => relayed,
  };
}

module.exports = { createRelayPath, channelKey, normaliseGroups };
