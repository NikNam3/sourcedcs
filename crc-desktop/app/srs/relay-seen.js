'use strict';
// The relay's run table (ADR 0159, which re-specifies ADR 0158 §4 check 3). SRS has no per-transmission id: a packet
// carries only `OriginalClientGuid` (the pilot) and `Guid` (who sent this datagram). So a transmission is a *run*: the
// packets of one `originalGuid` with no gap longer than RUN_GAP_MS between two of them (SRS's own 450 ms receive
// timeout). For each run the table remembers the way its first packet came in: the sender `guid` and the channels it
// was heard on. The rest of the run is relayed only when it comes in the same way. The same original arriving any other
// way, while the run lasts, is a copy coming back (another relay's output, or our own through a server that reset the
// count) and is dropped.
//
// Entries are forgotten KEEP_MS after their last packet. Times come from the caller (an injected wall clock): this is
// housekeeping, not an EFSP fact.

/** Two packets of one original further apart than this belong to two transmissions (SRS's RX timeout, 450 ms). */
const RUN_GAP_MS = 450;
/** How long a run is remembered after its last packet (ADR 0158 §4: 30 s). */
const KEEP_MS = 30_000;

/** The way a packet came in: its sender and its channels, in a fixed order. */
const wayOf = (guid, channelKeys) => `${guid}|${[...channelKeys].sort().join(',')}`;

/**
 * @param {{gapMs?:number, keepMs?:number}} [o]
 */
function createRelaySeen(o = {}) {
  const gapMs = o.gapMs ?? RUN_GAP_MS;
  const keepMs = o.keepMs ?? KEEP_MS;
  const runs = new Map(); // originalGuid -> { way, lastAt }

  function prune(now) {
    for (const [k, r] of runs) if (now - r.lastAt > keepMs) runs.delete(k);
  }

  return {
    /**
     * Notes a packet of `originalGuid` that came in from `guid` on `channelKeys`, and says whether it is the run's own
     * way. A packet that starts a run (none known, or the last one more than the gap ago) sets the way and is `entry`.
     * One that comes the run's way is `entry` and keeps the run alive. Any other is `copy`; it does not keep the run
     * alive, so a copy can never hold a run open by itself.
     * @returns {'entry'|'copy'}
     */
    observe(originalGuid, guid, channelKeys, now) {
      const way = wayOf(guid, channelKeys);
      const run = runs.get(originalGuid);
      if (!run || now - run.lastAt > gapMs) {
        runs.set(originalGuid, { way, lastAt: now });
        if (runs.size > 64) prune(now);
        return 'entry';
      }
      if (run.way !== way) return 'copy';
      run.lastAt = now;
      return 'entry';
    },
    prune,
    size: () => runs.size,
  };
}

module.exports = { createRelaySeen, RUN_GAP_MS, KEEP_MS };
