'use strict';

// The relay leases (docs/adr/0158 §4, docs/adr/0159): which session relays onto which frequency. Pure and in memory; a
// restart drops every lease, and the clients claim again when they reconnect.
//
// If two controllers both linked the same frequencies, both would relay a pilot and every listener would hear double.
// So each frequency (a channel key, "251000:AM") is granted to ONE session: the first that asked. The others wait in
// the order they asked. A claim is declarative: it names every channel the session wants now, so a channel it no
// longer names (unlinked, the Position left, the radio retuned) is released by the same claim. A session that closes
// releases everything. A released channel passes to the next session waiting for it.
//
// Holders are opaque (the hub's session objects); the table never looks inside them.

/** At most this many channels per claim: SRS gives a client 11 radios. */
const MAX_CHANNELS = 11;
const CHANNEL_KEY = /^[1-9]\d{0,5}:(AM|FM)$/;

/** Null when `keys` is a valid claim, else why not. */
function claimProblem(keys) {
  if (!Array.isArray(keys)) return 'channels must be a list';
  if (keys.length > MAX_CHANNELS) return `at most ${MAX_CHANNELS} channels`;
  const bad = keys.find(k => typeof k !== 'string' || !CHANNEL_KEY.test(k));
  return bad === undefined ? null : `not a channel: ${JSON.stringify(bad)} (kHz:AM or kHz:FM)`;
}

function createRelayLeases() {
  const queues = new Map(); // channel key -> holders in the order they asked; [0] holds the lease

  /** The channels `holder` holds the lease for, sorted. */
  function heldBy(holder) {
    const out = [];
    for (const [key, q] of queues) if (q[0] === holder) out.push(key);
    return out.sort();
  }

  /** Runs `fn`, then returns every holder whose held set it changed. */
  function tracking(fn) {
    const before = new Map();
    for (const q of queues.values()) for (const h of q) if (!before.has(h)) before.set(h, heldBy(h).join(','));
    fn();
    const touched = new Set(before.keys());
    for (const q of queues.values()) for (const h of q) touched.add(h);
    return [...touched].filter(h => (before.get(h) ?? '') !== heldBy(h).join(','));
  }

  function leave(holder, key) {
    const q = queues.get(key);
    if (!q) return;
    const i = q.indexOf(holder);
    if (i >= 0) q.splice(i, 1);
    if (!q.length) queues.delete(key);
  }

  return {
    /**
     * `holder` wants exactly `keys` now. Returns the holders whose leases changed (the claimant among them when it
     * gained or lost one). Throws on an invalid claim: check claimProblem first.
     */
    claim(holder, keys) {
      const problem = claimProblem(keys);
      if (problem) throw new Error(problem);
      const want = new Set(keys);
      return tracking(() => {
        for (const [key, q] of [...queues]) if (!want.has(key) && q.includes(holder)) leave(holder, key);
        for (const key of want) {
          const q = queues.get(key) || [];
          if (!q.includes(holder)) q.push(holder);
          queues.set(key, q);
        }
      });
    },
    /** `holder` is gone: every lease it held passes on. Returns the holders whose leases changed. */
    release(holder) {
      return tracking(() => { for (const key of [...queues.keys()]) leave(holder, key); });
    },
    heldBy,
    holderOf: (key) => (queues.get(key) || [])[0] || null,
  };
}

module.exports = { createRelayLeases, claimProblem, MAX_CHANNELS };
