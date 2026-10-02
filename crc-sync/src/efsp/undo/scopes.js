'use strict';

// The undo scopes the Board's op modules share (docs/adr/0100 §1, §3). Each op module's `undo.scope` builds its
// Scope from these; a module whose op writes more says so in its own declaration. `ctx` is the Board's StripOps.
// Over-declaring is safe (more is captured and more later changes are attributed); under-declaring makes the action
// not undoable (the history's scope-escape check), never half-restored.

/** The Strip itself and its flight data. */
function stripScope(ctx, strip) {
  return {
    strips: [{ facilityId: ctx.rules.facilityId, stripId: strip.stripId }],
    flightData: strip.flightDataId ? [strip.flightDataId] : [],
  };
}

/**
 * What a retirement (StripOps#retire, the one path to DROPPED) may write: the Strip, its flight data and code, every
 * ACTIVE MARSA relation of the flight and each participant's flight data (the regime goes back to ATC), the carrier
 * stack entry of a carrier Strip, and the peer Board's Strip of a coordination exchange (U7, docs/adr/0101).
 */
function retireScope(ctx, strip) {
  const scope = stripScope(ctx, strip);
  const flightData = strip.flightDataId ? ctx.flightDataStore.getFlightData(strip.flightDataId) : null;
  scope.codes = flightData && flightData.identity && flightData.identity.beaconAssigned ? [flightData.identity.beaconAssigned] : [];
  if (strip.flightDataId) {
    scope.marsa = [{ flightDataId: strip.flightDataId }];
    const relation = ctx.rules.activeMarsaFor(strip.flightDataId);
    if (relation) for (const id of relation.participants || []) scope.flightData.push(id);
  }
  if (['MARSHAL', 'FINAL', 'PATTERN'].includes(strip.stripType)) scope.carrier = [{ flightDataId: strip.flightDataId }];
  // The peer's Strip of a live exchange: a replica that ends takes the proposer's link with it (U7), and a proposer that
  // ends while it still holds communications or control hands them to the replica (docs/adr/0101 TRANSFERRING_RETIRED).
  const link = strip.coordination;
  if (link && link.peerFacilityId && link.peerStripId && (link.mintedForCoordination || link.state === 'INITIATED' || link.state === 'ACTIVE')) {
    scope.strips.push({ facilityId: link.peerFacilityId, stripId: link.peerStripId });
  }
  return scope;
}

/** A union of Scopes (the history de-duplicates). */
function union(...scopes) {
  const out = { strips: [], flightData: [], codes: [], carrier: [], marsa: [] };
  for (const s of scopes) {
    if (!s) continue;
    for (const k of Object.keys(out)) out[k].push(...(s[k] || []));
  }
  return out;
}

/** The callsign a label names, or the Strip id. */
function callsignOf(ctx, strip) {
  const flightData = strip && strip.flightDataId ? ctx.flightDataStore.getFlightData(strip.flightDataId) : null;
  return (flightData && flightData.identity && flightData.identity.callsign) || (strip && strip.stripId) || '';
}

module.exports = { stripScope, retireScope, union, callsignOf };
