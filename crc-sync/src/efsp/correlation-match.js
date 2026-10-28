'use strict';

// The correlation key ladder (EFSPImplementationGuide.md §6.6 rule 1, as cut by
// docs/adr/0142):
//
//   explicit controller binding -> Mode 3/A beacon code
//
// There is no callsign rung, exact or fuzzy (H165): a flight correlates on the
// code its transponder is sending, or because a controller bound it. A Strip
// whose flight has neither is NO TRK, and the controller fixes it by entering
// the contact's code into the Strip, or by binding.
//
// Pure, and tested on its own (tests/efsp-correlation-match.test.mjs).
//
// The evidence is what the aircraft itself gives, never what a controller sees
// on the scope: the beacon rung matches the code the transponder is SENDING
// (surveillance/transponder.js, injected as `beaconOf`), nothing when it is
// off. An AI aircraft's synthetic code counts (docs/adr/0142): a controller can
// read it off the scope and type it into the Strip's code, and the Strip then
// correlates on it like any other code.

const GROUND_UNIT = 3; // DCS unit category (grpc-client.js)

/**
 * Per-tick lookup tables over the live tracks, built once rather than
 * re-scanned per flight data — this is what keeps the reconciler O(tracks + flightDataList).
 *
 * `byBeacon` is one-to-MANY on purpose. A duplicate beacon code is structural
 * and explicitly accepted (§3.10.2 rule 7: "duplicate codes raise an alert,
 * never a hard block"), so collapsing it to one entry would silently pick a
 * winner. Ambiguity is an outcome the reconciler reports, not something to
 * hide here.
 */
function buildTrackIndices(tracks, beaconOf) {
  const byBeacon = new Map(); // '0041' -> [trackId]
  const byId = new Map();     // trackId -> track

  for (const track of tracks || []) {
    const id = String(track.id);
    byId.set(id, track);
    // A ground vehicle is never a flight's contact (docs/adr/0121: nobody is
    // shown one), so the beacon rung may not match it.
    if (track.category === GROUND_UNIT) continue;

    const beacon = beaconOf(track);
    if (beacon) {
      const list = byBeacon.get(beacon);
      if (list) list.push(id); else byBeacon.set(beacon, [id]);
    }
  }

  return { byBeacon, byId };
}

module.exports = { buildTrackIndices };
