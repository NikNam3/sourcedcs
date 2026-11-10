// What the relay may link (pure, a leaf; ADR 0158 §4, ADR 0159): the radio set's link groups as relay channels, and
// the channel keys whose relay leases this client asks crc-sync for.
//
// A channel is a frequency and a modulation, keyed "251000:AM" (integer kHz), the same key the local server's
// relay-path.js and crc-sync's radio/relay-leases.js use. Only AM and FM are relayed; the intercom never is (H183). A
// channel that any radio of the set has receive-only (an Observer's Position radio) is marked so: it is never a source
// and never a target, and its lease is not asked for. A group with fewer than two channels has nothing to relay.

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
 *   groups:Array<{id:string, radioIds:string[]}>}} set radio-set.js's output
 * @returns {Array<{id:string, channels:Array<{key:string, mhz:number, modulation:string, receiveOnly:boolean}>}>}
 */
export function relayGroupsOf(set) {
  const radios = (set && set.radios) || [];
  const receiveOnly = new Set(radios.filter(r => r.receiveOnly).map(r => channelKey(r.mhz, r.modulation)).filter(Boolean));
  const out = [];
  for (const g of (set && set.groups) || []) {
    const channels = [];
    for (const r of radios) {
      if (r.groupId !== g.id) continue;
      const key = channelKey(r.mhz, r.modulation);
      if (!key || channels.some(c => c.key === key)) continue;
      channels.push({ key, mhz: r.mhz, modulation: String(r.modulation || 'AM').toUpperCase(), receiveOnly: receiveOnly.has(key) });
    }
    if (channels.length >= 2) out.push({ id: g.id, channels });
  }
  return out;
}

/** The channel keys to claim relay leases for: every relayable channel of every group, sorted. */
export function leaseKeysOf(groups) {
  const keys = new Set();
  for (const g of groups || []) for (const c of g.channels) if (!c.receiveOnly) keys.add(c.key);
  return [...keys].sort();
}

/** The ids of the groups this client relays for: a group with a channel whose lease it holds. */
export function relayingGroupIds(groups, held) {
  const h = new Set(held || []);
  return (groups || []).filter(g => g.channels.some(c => h.has(c.key))).map(g => g.id);
}
