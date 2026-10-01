'use strict';

const { VERSION, liveStamped } = require('../frames');
const permission = require('../../permission');
const readScope = require('../../read-scope');

/**
 * Correlation ops (BindTrack/UnbindTrack) — a THIRD dispatch path, for the
 * same reason _handleAirspaceMutation is a second one: this targets an FDR.
 * There is no stripId, no Strip baseRev and no Strip-owner check, because no
 * Position owns an FDR.
 *
 * Guide §6.6 rule 1's top rung is "explicit controller binding", and this is
 * its wire surface. It is the way out of every ambiguity the sweep reports,
 * and the only way to correlate an aircraft with its transponder off and a
 * callsign nothing matches.
 */
module.exports = {
  type: 'efsp-correlation-mutation',
  ackType: 'efsp-correlation-ack',
  deltaType: 'efsp-correlation-delta',
  replayKind: 'correlation',
  snapshotKey: 'correlations',
  subject: (msg) => ({ fdrId: msg.fdrId }),
  store: (ctx) => ctx.correlationStore,
  noStore: 'no correlation store',

  // The same session binding the other two dispatch paths carry
  // (docs/adr/0029), for the same reason: actingPositionId arrives as an
  // untrusted client claim. This is now the THIRD place that check appears,
  // and a new dispatch path is exactly where it gets forgotten and the hole
  // reopens — _handleAirspaceMutation's own comment says so, and it was right
  // twice.
  //
  // "Primary somewhere" is the right gate here rather than at a particular
  // Facility: no Position owns an FDR, and a correlation is not a clearance.
  // Any Primary may bind, whichever Facility holds a Strip for that flight —
  // the FDR is already shared theater-wide (docs/adr/0013), and refusing would
  // mean a controller who can see the contact cannot tell the system what they
  // see. The binding records boundBy/boundPositionId, so the audit says who.
  gate: 'primary-somewhere',
  notHolding: (msg) => `you are not Primary at ${msg.actingPositionId} — select it before binding a contact`,

  // Refused by class, not by table: a range Position is the using agency, has
  // no flights to identify (§4.1 rule 2) and, under docs/adr/0042, no scope on
  // which to have seen anything.
  permit: (ctx, msg) => permission.canCorrelate(msg.actingPositionId) ? null
    : { reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} works no flights, so it identifies no contacts` },

  apply: (ctx, session, msg) => ctx.correlationStore.apply(
    { clientMutationId: msg.clientMutationId, fdrId: msg.fdrId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  ),
  rememberId: (result, msg) => msg.fdrId,
  fromCached: (ctx, cached) => ({ ...cached, correlation: ctx.correlationStore.getCorrelation(cached.id) }),
  ack: (result, ctx) => ({
    correlation: result.correlation, reason: result.reason, detail: result.detail,
    correlationSeq: ctx.correlationStore.currentSeq,
  }),

  // Its own delta type with its own seq, like efsp-airspace-delta and
  // deliberately NOT a section of efsp-board-delta: a correlation is not a
  // Strip and rides no Board's sequence.
  broadcasts: (result, ctx) => ({
    primary: {
      version: VERSION, type: 'efsp-correlation-delta',
      correlationSeq: ctx.correlationStore.currentSeq,
      correlations: { updated: [result.correlation] },
    },
  }),

  // Correlation records, one per live FDR and sent whole for the same reason
  // fdrs are: cheap enough at this scale that a second ring buffer would
  // cost more than it saved (_handleResync's own stated reasoning). There is
  // deliberately no correlation branch in efsp-resync either — a reconnecting
  // client gets these in its snapshot and a fresh reconcile delta within a
  // second, so §5.6's "two paths only" holds.
  snapshot: (ctx) => ctx.correlationStore ? ctx.correlationStore.getAll() : [],

  /** What an owned session is sent of an efsp-correlation-delta (docs/adr/0080). */
  filter: (ctx, scope, msg) => readScope.filterCorrelationDelta(msg, scope, readScope.visibleFdrIdsOf(scope, liveStamped(ctx))),
};
