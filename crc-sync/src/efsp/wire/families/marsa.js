'use strict';

const { boardDelta, marsaDelta, liveStamped } = require('../frames');
const permission = require('../../permission');
const readScope = require('../../read-scope');

/**
 * The flights a MARSA op names in its own body — the participants of a
 * declaration, or the one flight being added or removed. Echoed on the ack so a
 * refusal can be attributed even when it never reached the store and so has no
 * relation to carry back (see subjectOf in the skeleton).
 */
function marsaFdrIds(op) {
  if (!op) return undefined;
  if (Array.isArray(op.participants)) return op.participants.map(String).filter(Boolean);
  if (op.fdrId) return [String(op.fdrId)];
  return undefined;
}

/**
 * MARSA ops (§9.2) — a FOURTH dispatch path, for the same reason the airspace
 * and correlation paths exist: this targets a relation BETWEEN flights. There
 * is no stripId, no Strip baseRev and no Strip-owner check, because no Position
 * owns a relation and none of its participants' Strips is privileged over the
 * others.
 */
module.exports = {
  type: 'efsp-marsa-mutation',
  ackType: 'efsp-marsa-ack',
  deltaType: 'efsp-marsa-delta',
  replayKind: 'marsa',
  snapshotKey: 'marsa',
  subject: (msg) => ({ marsaId: msg.marsaId, fdrIds: marsaFdrIds(msg.op) }),
  store: (ctx) => ctx.marsaStore,
  noStore: 'no MARSA store',

  // The same session binding the other three dispatch paths carry
  // (docs/adr/0029). This is now the FOURTH place the check appears, and
  // _handleAirspaceMutation's comment — "a new dispatch path is exactly where
  // that check gets forgotten and the hole reopens" — has now been right three
  // times. actingPositionId is an untrusted client claim.
  //
  // "Primary somewhere" rather than at a particular Facility, matching
  // correlation and for a stronger version of its reason: a relation's
  // participants may be worked by different Facilities at once (a tanker at
  // CENTER, a receiver at INCIRLIK), so there is no single Facility whose
  // PositionStore could be the right one to ask. The relation records
  // declaredBy/declaredPositionId, so the audit still says who.
  gate: 'primary-somewhere',
  notHolding: (msg) => `you are not Primary at ${msg.actingPositionId} — select it before acting on a MARSA relation`,

  // Refused by class, not by table — a range Position is the using agency and
  // works no Strips (§4.1 rule 2), so it has no flights to put into a relation.
  permit: (ctx, msg) => permission.canDeclareMarsa(msg.actingPositionId) ? null
    : { reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} works no flights, so it declares no MARSA` },

  // DeclareMarsa is the case that matters: a retried declaration minted a
  // second relation.
  apply: (ctx, session, msg) => ctx.marsaStore.apply(
    { clientMutationId: msg.clientMutationId, marsaId: msg.marsaId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  ),
  rememberId: (result, msg) => result.relation ? result.relation.marsaId : (msg.marsaId || null),
  fromCached: (ctx, cached) => ({ ...cached, relation: cached.id ? ctx.marsaStore.getRelation(cached.id) : undefined }),
  ack: (result, ctx) => ({
    marsa: result.relation, reason: result.reason, detail: result.detail,
    marsaSeq: ctx.marsaStore.currentSeq,
  }),

  // Broadcast to everyone rather than to the participants' owners, matching
  // every other EFSP broadcast: the client filters by what it holds. §9.2 rule
  // 5 requires the relation to render on EVERY participant Strip, and those
  // Strips can sit in different Facilities in front of different controllers —
  // pre-filtering server-side would mean working out that set here, twice
  // (once for the relation, once for its replicas), to save nothing.
  broadcasts: (result, ctx) => {
    const out = { marsa: marsaDelta(ctx.marsaStore, [result.relation]) };

    // Declaring writes `tofi.separationRegime` = MARSA on every participant, and
    // ending, voiding or leaving a relation writes ATC back. Those are FDR
    // writes, and an FDR rides an efsp-board-delta — the marsa-delta above
    // carries the RELATION and nothing else. So SEP REG stayed blank on every
    // already-connected page and only a reconnect ever showed the truth: guide
    // §4.8.3's "they inherit a lie", in the direction it warns about
    // (docs/ui-findings/lane1.md F-111). marsa-store.js journals the writes; this
    // is where they reach the wire.
    //
    // A board-delta with no Strips in it, because none changed. It is stamped
    // with the default Facility's own boardSeq, unchanged for the same reason —
    // fdrs are shared theater-wide (docs/adr/0013) and are not Facility-scoped,
    // so there is no per-Facility delta to send N of.
    const regimeFdrs = result.fdrs || [];
    if (regimeFdrs.length > 0) {
      const facilityId = ctx.facilityConfig.DEFAULT_FACILITY_ID;
      const boardStore = ctx.boardStoreFor(facilityId);
      out.primary = boardDelta(ctx, boardStore, facilityId, { updated: [], gone: [] }, regimeFdrs);
    }
    return out;
  },

  // MARSA relations (§9.2), sent whole for the same reason correlations are.
  // Finished ones ride along too: §9.2 rule 5 puts the relation on every
  // participant Strip, and a relation that was VOIDED by the interlock is
  // precisely the one a reconnecting controller most needs to see — dropping
  // it on reconnect would make the alert the rule requires disappear for the
  // one person who just missed it. No efsp-resync branch either, matching
  // correlation and airspace, so §5.6's "two paths only" holds.
  snapshot: (ctx) => ctx.marsaStore ? ctx.marsaStore.getAll() : [],

  /** What an owned session is sent of an efsp-marsa-delta (docs/adr/0080). */
  filter: (ctx, scope, msg) => readScope.filterMarsaDelta(msg, scope, readScope.visibleFdrIdsOf(scope, liveStamped(ctx))),
};
