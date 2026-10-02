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
 * stack entry of a carrier Strip, and the proposer's Strip on the peer Board when this Strip is a replica (U7).
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
  const link = strip.coordination;
  if (link && link.mintedForCoordination && link.peerFacilityId && link.peerStripId) {
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
