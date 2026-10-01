'use strict';

const { newFlags } = require('../strip-util');

/**
 * docs/adr/0023 — converts a DEPARTURE Strip at its HANDED_OFF terminus
 * into an ARRIVAL Strip IN PLACE: same stripId, same fdrId, throughout.
 * A deliberate departure from guide §3.6's turnaround rule ("an ARRIVAL
 * Strip that reaches DROPPED and a later DEPARTURE Strip for the same
 * airframe are separate Strips referencing separate FDRs") — chosen
 * explicitly over spawning a second Strip/FDR pair (the first version of
 * this feature) after live testing found the two-Strip approach left a
 * stale departure Strip behind and required copying every field by hand
 * (route, altitude, remarks, identity, beacon code — the last of which
 * can't even be copied cleanly, since fdr-store.js's createFdr always
 * auto-allocates a fresh code). Reusing the same FDR makes every one of
 * those problems structurally impossible: there is nothing to copy,
 * because nothing new was created.
 *
 * Annotations/flags/coordination all reset to their fresh-Strip defaults —
 * none of them carry a meaning that survives a role change (a DEPARTURE-
 * phase annotation note, an old coordination link that already resolved,
 * an attention flag from the outbound leg). The correlation is the one
 * thing that does survive, and used to be reset here in error — see the
 * comment at the reset site below, and docs/adr/0045. And
 * this Strip's `role`-scoped Block Map, EfspState set and NLA table all
 * genuinely change underneath it, so starting those fields clean avoids
 * carrying over state that no longer means what it used to.
 */
function _applyConvertToArrival(ctx, strip, by, actingPositionId) {
  if (strip.role !== 'DEPARTURE' || strip.state !== 'HANDED_OFF') {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'only a DEPARTURE Strip at HANDED_OFF can be converted to ARRIVAL', strip };
  }
  // Role-scoped, same two-tier permission shape _applyCreateStrip uses —
  // the coarse canMutate('ConvertToArrival') gate already applied in
  // _dispatch restricts this to APP/CTR; this is the fine-grained half,
  // reusing canCreateStripRole's existing ARRIVAL-origination check
  // rather than a parallel table that would only ever say the same thing.
  if (ctx.rules.canCreateStripRole && !ctx.rules.canCreateStripRole(actingPositionId, 'ARRIVAL')) {
    return { ok: false, reason: 'PERMISSION_DENIED', strip };
  }
  // The conversion nulls both coordination records wholesale below, so an
  // unresolved link has to be refused here rather than silently discarded.
  // Exactly the guard set _applyDropStrip uses, and asymmetric for the same
  // reason: an ACTIVE *coordination* link is the normal condition of a
  // Strip that has been handed off and accepted — jurisdiction moved, the
  // exchange is finished, and converting for the return leg is precisely
  // what CTR does next — whereas an ACTIVE *TOFI* link means tactical
  // control is live right now (docs/adr/0025: jurisdiction never transfers,
  // so the exchange stays open for its whole duration).
  //
  // Found by an end-to-end scenario trace, and reachable precisely because
  // TOFI never changes the ATC-side Strip's own state: it sits at
  // DEPARTURE/HANDED_OFF throughout, which is this op's entry condition. So
  // "Convert to Arrival" was live mid-exchange — against a PROPOSED link it
  // orphaned a replica that would wait forever for a response, and against
  // an ACTIVE TOFI it ended tactical control with no notification to the
  // MRU side at all.
  if (strip.coordination && strip.coordination.state === 'PROPOSED') {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot convert a Strip with an open coordination proposal — accept, reject, or wait for a response first', strip };
  }
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED') {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot convert a Strip with an open TOFI proposal — accept, reject, or wait for a response first', strip };
  }
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot convert a Strip under active tactical control — complete a TOFI exit first', strip };
  }
  const targetBay = ctx.rules.bayForImpliedState ? ctx.rules.bayForImpliedState(strip.ownerPositionId, 'INBOUND') : null;
  if (!targetBay) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `no ARRIVAL Bay configured for ${strip.ownerPositionId}`, strip };
  }

  // Bug found in live testing: DEPARTURE and ARRIVAL read DIFFERENT FDR
  // fields for the same underlying idea — DEPARTURE's Block 8 is
  // filed.departureAirport, ARRIVAL's Block 8 is filed.originAirport
  // (block-map.js). Converting in place never touches the FDR otherwise
  // (that's the whole point — same FDR throughout), so originAirport
  // stayed permanently blank even though departureAirport still held the
  // right value right next to it. The flight's real point of origin
  // doesn't change just because it's airborne — for a sortie that
  // departed Incirlik and never actually landed anywhere else, the
  // departure record's own departureAirport IS the honest answer to
  // "where is this arrival coming from." destinationAirport needs no
  // equivalent remap — ARRIVAL has no "destination" field at all, since
  // this Facility itself is the implicit destination.
  //
  // Block 7 is deliberately NOT remapped the same way: DEPARTURE's is
  // filed.requestedAltitude (what was filed), ARRIVAL's is annotation-
  // routed (guide §3.7's append-only sequence of ATC-ASSIGNED altitude
  // clearances during descent) — genuinely different concepts, not two
  // field names for the same fact. Seeding it from the filed altitude
  // would misrepresent a filed value as an issued clearance; leaving it
  // blank for the controller to actively assign is correct, not a gap.
  const fdr = ctx.fdrStore.getFdr(strip.fdrId);
  let updatedFdr = fdr;
  if (fdr && fdr.filed.departureAirport) {
    // Captured so it can ride in this method's own return value below —
    // without it, efsp-ws.js's ack/broadcast has no fdr to include
    // (mirrors _applySetBlock's own result.fdr pattern), and a connected
    // client would never actually see originAirport update at all.
    const fdrResult = ctx.fdrStore.setField(strip.fdrId, 'filed.originAirport', fdr.filed.departureAirport, { by });
    if (fdrResult.ok) updatedFdr = fdrResult.fdr;
  }

  strip.role = 'ARRIVAL';
  strip.state = 'INBOUND';
  strip.bayId = targetBay.bayId;
  strip.rackId = ctx.placement.placementRack(strip, targetBay);
  strip.orderKey = ctx.placement.resolveOrderKey(targetBay.bayId, strip.rackId, null, null, strip.stripId);
  // The departure leg's annotations are ARCHIVED, not erased. Clearing the
  // live set is right — a DEPARTURE Strip's Block 9A means something
  // different on an ARRIVAL, so carrying the values across would mislabel
  // them — but erasing them outright destroyed controller-entered data on
  // one click, with no undo (ConvertToArrival records no NLA history, so
  // §3.5 rule 5's window does not cover it). The append-only annotation
  // model exists because JO 7110.65 ¶2-3-1 forbids erasing an item; a role
  // change is not an exception to that.
  //
  // Kept on the Strip rather than left to the Mutation log: the log has it
  // either way, but a controller asking "what did Ground tell them before
  // they went out" is looking at the Strip, not reading a JSONL file.
  strip.previousLeg = {
    role: 'DEPARTURE',
    annotations: strip.annotations,
    flags: strip.flags,
    convertedAt: ctx.clock.now(),
    convertedBy: by || null,
  };
  strip.annotations = {};
  strip.flags = newFlags();
  strip.coordination = null;
  strip.tofiCoordination = null;
  // The correlation is deliberately NOT reset, and the line that used to do
  // it here was wrong even while it was inert (docs/adr/0045). This fires on
  // the same stripId, the same fdrId, the same airframe — still airborne,
  // still squawking the code docs/adr/0023 went out of its way to keep. It
  // threw away a correct binding for the one aircraft that certainly has
  // one, which is §6.6 rule 3's silent break reached through a role change
  // instead of a track-id change. Under the fdrId key there is nothing here
  // to reset: the correlation is a fact about the airframe, and the airframe
  // did not change legs — the paperwork did.
  ctx.state.bump(strip, by);
  return { ok: true, strip, fdr: updatedFdr };
}

// docs/adr/0023 — converts this Strip's role IN PLACE, same Strip/
// FDR throughout, for a returning flight at the same Facility.
module.exports = {
  kind: 'ConvertToArrival',
  apply: (ctx, strip, op, meta) => _applyConvertToArrival(ctx, strip, meta.by, meta.actingPositionId),
};
