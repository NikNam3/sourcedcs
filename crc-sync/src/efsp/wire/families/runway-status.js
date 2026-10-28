'use strict';

const { runwayStatusDelta } = require('../frames');

const facilityOf = (ctx, msg) => msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;

/**
 * Runway status (guide §9.7, docs/adr/0061) — its own dispatch path, since a
 * runway is not a Strip and rides no Board's sequence.
 *
 * The session binding (docs/adr/0029) is PER FACILITY, copied from
 * _handleMutation — this is the fifth dispatch path to carry it, and the one
 * where "Primary somewhere" (airspace, correlation, MARSA) would be wrong: a
 * field has exactly one Facility, and OPS at INCIRLIK must not suspend a runway
 * anywhere else.
 *
 * A refusal made here, before the store (no store, NOT_HOLDING_POSITION), is
 * marked `unaudited` so the metrics tap writes it (docs/adr/0083); the store
 * audits from its door onward (decisions.md S-R2-5).
 *
 * Skeleton deviations: every ack (and refusal) carries `facilityId`, and a refusal also the current `runwayStatus` and
 * `runwayStatusSeq`; a successful op re-states the NLA of Strips the op never touched (`after`).
 */
module.exports = {
  type: 'efsp-runway-status-mutation',
  ackType: 'efsp-runway-status-ack',
  deltaType: 'efsp-runway-status-delta',
  replayKind: 'runwayStatus',
  snapshotKey: 'runwayStatuses',
  subject: (msg) => ({ facilityId: msg.facilityId, runwayId: msg.op && msg.op.runwayId }),
  head: (ctx, msg) => ({ facilityId: facilityOf(ctx, msg) }),
  refusalTail: (ctx, msg) => {
    const store = ctx.runwayStatusStore;
    return { runwayStatus: store ? store.getRunwayStatus(facilityOf(ctx, msg)) : null, runwayStatusSeq: store ? store.currentSeq : undefined, runwayStatusEpoch: store ? store.epoch : undefined };
  },
  store: (ctx) => ctx.runwayStatusStore,
  noStore: 'no runway-status store',

  gate: 'primary-at-facility',
  facilityOf,
  notHolding: (msg, facilityId) => `you are not Primary at ${msg.actingPositionId} at ${facilityId} — select it before acting on the field`,

  // The permission table (and every refusal) is checked inside apply(), so a
  // PERMISSION_DENIED is audited like any other outcome.
  apply: (ctx, session, msg) => {
    const op = msg.op && typeof msg.op === 'object' ? msg.op : {};
    return ctx.runwayStatusStore.apply(
      { clientMutationId: msg.clientMutationId, facilityId: facilityOf(ctx, msg), baseRev: msg.baseRev, op },
      msg.actingPositionId, session.controllerId,
    );
  },
  rememberId: (result, msg, ctx) => facilityOf(ctx, msg),
  fromCached: (ctx, cached) => ({ ...cached, runwayStatus: ctx.runwayStatusStore.getRunwayStatus(cached.id) }),
  after: (ctx) => {
    // A runway's status moves the `nla` stamp of Strips this op never touched
    // — every Strip queued for, or landing on, that runway — the same problem
    // _handleSetPositions has. The monitor re-stamps only the Strips whose
    // status actually changed and sends them on the ordinary board-delta
    // (server.js wires its onDelta), so "the reason shown" reaches every
    // controller now rather than on the next 15 s sweep.
    if (ctx.nlaStatusMonitor) ctx.nlaStatusMonitor.tick();
  },
  ack: (result, ctx) => ({
    runwayStatus: result.runwayStatus, reason: result.reason, detail: result.detail,
    runwayStatusSeq: ctx.runwayStatusStore.currentSeq, runwayStatusEpoch: ctx.runwayStatusStore.epoch,
  }),
  broadcasts: (result, ctx) => ({ primary: runwayStatusDelta(ctx.runwayStatusStore, [result.runwayStatus]) }),

  // Runway status (§9.7, docs/adr/0061), one record per Facility with runways,
  // sent whole. No efsp-resync branch, matching airspace, correlation and
  // MARSA: a reconnecting controller gets the current runway status here —
  // which is the point of rule 5's own sequence (a reconnect after a
  // suspension must not show an OPEN runway).
  snapshot: (ctx) => ctx.runwayStatusStore ? ctx.runwayStatusStore.getAll() : [],
};
