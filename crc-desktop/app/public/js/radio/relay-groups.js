// What this session asks crc-sync's relay to link (pure, a leaf; docs/adr/0160): the radio set's link groups as
// channel keys, and which of them the relay is relaying.
//
// A channel is a frequency and a modulation, keyed "251000:AM" (integer kHz), the key crc-sync's radio/link-networks.js
// reads. Left out: the intercom (H183, never relayed), every channel a radio of the set has receive-only (an Observer's
// radio is never relayed either way), and unlinked radios. A group left with fewer than two channels links nothing.

const RELAYABLE = new Set(['AM', 'FM']);

/** "251000:AM", or null for a channel the relay never carries. */
export function channelKey(mhz, modulation) {
  const mod = String(modulation || 'AM').toUpperCase();
  const khz = Math.round(Number(mhz) * 1000);
  if (!(khz > 0) || !RELAYABLE.has(mod)) return null;
  return `${khz}:${mod}`;
}

/**
 * @param {{radios:Array<{id:string, mhz:number|null, modulation?:string, groupId?:string|null, receiveOnly?:boolean}>,
 *   groups:Array<{id:string}>}} set radio-set.js's output
 * @returns {Array<{id:string, channels:string[]}>} the groups to send, each with its channel keys sorted
 */
export function relayGroupsOf(set) {
  const radios = (set && set.radios) || [];
  const receiveOnly = new Set(radios.filter(r => r.receiveOnly).map(r => channelKey(r.mhz, r.modulation)).filter(Boolean));
  const out = [];
  for (const g of (set && set.groups) || []) {
    const channels = new Set();
    for (const r of radios) {
      if (r.groupId !== g.id) continue;
      const key = channelKey(r.mhz, r.modulation);
      if (key && !receiveOnly.has(key)) channels.add(key);
    }
    if (channels.size >= 2) out.push({ id: g.id, channels: [...channels].sort() });
  }
  return out;
}

/**
 * The ids of the groups crc-sync relays: the relay is connected and one of the group's channels is in a network it
 * reported for this session (`radio-relay-status`).
 * @param {Array<{id:string, channels:string[]}>} groups relayGroupsOf
 * @param {{networks:Array<{channels:string[]}>, connected:boolean}|null} status
 */
export function relayingGroupIds(groups, status) {
  if (!status || !status.connected) return [];
  const relayed = new Set((status.networks || []).flatMap(n => n.channels));
  return (groups || []).filter(g => g.channels.some(c => relayed.has(c))).map(g => g.id);
}

/** The panel's one amber line when the relay is down for this session's networks, else null. */
export function relayDownNote(status) {
  if (!status || status.connected || !(status.networks || []).length) return null;
  return `relay down: ${status.error || 'not connected to SRS'}`;
}
