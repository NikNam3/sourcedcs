'use strict';
// One copy of each transmission's packet reaches the renderer (docs/adr/0160). crc-sync's relay re-sends a pilot on the
// other frequencies of the pilot's network, keeping the pilot's `originalGuid` and packet number; a controller tuned to
// two of them gets the pilot's packet and the relay's copy, and without this would hear the pilot twice, a moment
// apart. The first to arrive plays; a later packet of the same original and number within KEEP_MS is dropped.
// Times come from the caller's wall clock (housekeeping, lane rule 5).

const KEEP_MS = 2_000;

/** @param {{keepMs?:number}} [o] */
function createRxDedupe(o = {}) {
  const keepMs = o.keepMs ?? KEEP_MS;
  const seen = new Map(); // `${originalGuid}|${packetNumber}` -> at

  return {
    /** @returns {boolean} true for the first copy */
    first(packet, now) {
      const key = `${packet.originalGuid}|${packet.packetNumber}`;
      const at = seen.get(key);
      if (at !== undefined && now - at <= keepMs) return false;
      seen.set(key, now);
      if (seen.size > 512) for (const [k, v] of seen) if (now - v > keepMs) seen.delete(k);
      return true;
    },
    size: () => seen.size,
  };
}

module.exports = { createRxDedupe, KEEP_MS };
