'use strict';

const { boardDelta, marsaDelta, liveStamped } = require('../frames');
const readScope = require('../../read-scope');

/**
 * The flights a MARSA op names in its own body — the participants of a
 * declaration, or the one flight being added or removed. Echoed on the ack so a
 * refusal can be attributed even when it never reached the store and so has no
 * relation to carry back (see subjectOf in the skeleton).
 */
function marsaFlightDataIds(op) {
  if (!op) return undefined;
  if (Array.isArray(op.participants)) return op.participants.map(String).filter(Boolean);
  if (op.flightDataId) return [String(op.flightDataId)];
  return undefined;
}

/** Whether `positionId` owns a live Strip of one of `flightDataIds`, at any Facility. */
function holdsParticipantStrip(ctx, positionId, flightDataIds) {
  const wanted = new Set(flightDataIds || []);
  for (const facilityId of ctx.facilityConfig.getFacilityIds()) {
    let board = null;
    try { board = ctx.boardStoreFor(facilityId); } catch { board = null; }
    if (!board) continue;
    for (const s of board.getAll()) {
      if (s.state !== 'DROPPED' && wanted.has(s.flightDataId) && s.ownerPositionId === positionId) return true;
    }
  }
  return false;
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
  subject: (msg) => ({ marsaId: msg.marsaId, flightDataIds: marsaFlightDataIds(msg.op) }),
  store: (ctx) => ctx.marsaStore,
  noStore: 'no MARSA store',

  // The same session binding the other three dispatch paths carry
  // (docs/adr/0029). This is now the FOURTH place the check appears, and
  // the airspace family's comment (airspace.js) — "A new dispatch path is exactly where
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
  permit: (ctx, msg) => {
    if (!ctx.permission.canDeclareMarsa(msg.actingPositionId)) {
      return { reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} works no flights, so it declares no MARSA` };
    }
    // docs/adr/0118 (T14, H134 LT-RQ15 a): a void notice is acknowledged by a controller holding one of the Strips it is on.
    if (msg.op && msg.op.kind === 'AcknowledgeVoid') {
      const relation = ctx.marsaStore && ctx.marsaStore.getRelation(msg.marsaId);
      if (relation && !holdsParticipantStrip(ctx, msg.actingPositionId, relation.participants)) {
        return { reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} holds none of these Strips: the controller holding one acknowledges the void` };
      }
    }
    return null;
  },

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
    marsaSeq: ctx.marsaStore.currentSeq, marsaEpoch: ctx.marsaStore.epoch,
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
    // ending, voiding or leaving a relation writes ATC back. Those are flight data
    // writes, and a flight data rides an efsp-board-delta — the marsa-delta above
    // carries the RELATION and nothing else. So SEP REG stayed blank on every
    // already-connected page and only a reconnect ever showed the truth: guide
    // §4.8.3's "they inherit a lie", in the direction it warns about
    // (docs/ui-findings/lane1.md F-111). marsa-store.js journals the writes; this
    // is where they reach the wire.
    //
    // A board-delta with no Strips in it, because none changed. It is stamped
    // with the default Facility's own boardSeq, unchanged for the same reason —
    // flightDataList are shared theater-wide (docs/adr/0013) and are not Facility-scoped,
    // so there is no per-Facility delta to send N of.
    const regimeFlightDataList = result.flightDataList || [];
    if (regimeFlightDataList.length > 0) {
      const facilityId = ctx.facilityConfig.DEFAULT_FACILITY_ID;
      const boardStore = ctx.boardStoreFor(facilityId);
      out.primary = boardDelta(ctx, boardStore, facilityId, { updated: [], gone: [] }, regimeFlightDataList);
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
  filter: (ctx, scope, msg) => readScope.filterMarsaDelta(msg, scope, readScope.visibleFlightDataIdsOf(scope, liveStamped(ctx))),
};
