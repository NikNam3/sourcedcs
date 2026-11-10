'use strict';

// The relay's networks (docs/adr/0160, H186 ruling 2). Pure.
//
// Every crc-desktop session tells crc-sync its link groups, whole each time: [{id, channels:['251000:AM', ...]}]. The
// groups of every session are merged by shared channel (union-find): two groups that share one channel are one network,
// whoever made them. A network has at least two channels; a group whose channels nobody else links and that has only
// one is no network. Every channel of a network hears every other (relay-decision.js).
//
// A channel is a frequency and a modulation, "<kHz>:<AM|FM>" (ADR 0159 §3, the client's relay-groups.js channelKey).

/** A channel key: integer kHz (no leading zero, at most six digits) and AM or FM. */
const CHANNEL_KEY = /^[1-9]\d{0,5}:(AM|FM)$/;

const isChannelKey = (k) => typeof k === 'string' && CHANNEL_KEY.test(k);

/**
 * @param {Iterable<Array<{id:string, channels:string[]}>>} groupLists every session's groups
 * @returns {Array<{channels:string[]}>} the networks, each with its channels sorted, ordered by their first channel
 */
function buildNetworks(groupLists) {
  const parent = new Map();
  const find = (k) => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root);
    for (let n = k; parent.get(n) !== root;) { const next = parent.get(n); parent.set(n, root); n = next; }
    return root;
  };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };

  for (const groups of groupLists) {
    for (const g of groups || []) {
      const channels = [...new Set((g.channels || []).filter(isChannelKey))];
      if (channels.length < 2) continue; // one channel links nothing
      for (const c of channels) add(c);
      for (let i = 1; i < channels.length; i++) union(channels[0], channels[i]);
    }
  }

  const byRoot = new Map();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(k);
  }
  return [...byRoot.values()]
    .filter(cs => cs.length >= 2)
    .map(cs => ({ channels: cs.sort() }))
    .sort((a, b) => (a.channels[0] < b.channels[0] ? -1 : 1));
}

/** channel key -> its network's index in `networks`. */
function indexNetworks(networks) {
  const out = new Map();
  networks.forEach((n, i) => { for (const c of n.channels) out.set(c, i); });
  return out;
}

/** Every channel of every network, sorted. */
const allChannels = (networks) => networks.flatMap(n => n.channels).sort();

module.exports = { buildNetworks, indexNetworks, allChannels, isChannelKey, CHANNEL_KEY };
