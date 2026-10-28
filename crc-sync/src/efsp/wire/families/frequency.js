'use strict';

const { frequencyDelta } = require('../frames');
const { rowMatchesOp } = require('../../frequency-table');

const facilityOf = (ctx, msg) => msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
const opOf = (msg) => (msg.op && typeof msg.op === 'object' ? msg.op : {});

/**
 * The runtime frequency table (docs/adr/0131, H154): SetFrequency / ResetFrequency / AddFrequency / RemoveFrequency on one
 * Position frequency or one SFA pool frequency of a Facility (docs/adr/0138). The gate is "Primary somewhere"
 * (correlation's); the table then refuses a Facility that is not the acting Position's (FACILITY_MISMATCH, docs/adr/0138,
 * H156 FQ-Q2 b), audited by the store.
 *
 * Skeleton deviations: the table writes its own state file (`persistWhen` never asks for the Board's), and the delta
 * carries the Facility's whole table, so every client redraws from it.
 */
module.exports = {
  type: 'efsp-frequency-mutation',
  ackType: 'efsp-frequency-ack',
  deltaType: 'efsp-frequency-delta',
  replayKind: 'frequency',
  snapshotKey: 'frequencies',
  subject: (msg) => ({ facilityId: msg.facilityId, positionId: opOf(msg).positionId, label: opOf(msg).label, rackId: opOf(msg).rackId }),
  head: (ctx, msg) => ({ facilityId: facilityOf(ctx, msg) }),
  store: (ctx) => ctx.frequencyTable,
  noStore: 'no frequency table',

  gate: 'primary-somewhere',
  notHolding: (msg) => `you are not Primary at ${msg.actingPositionId} — sign on to a Position before setting frequencies`,

  apply: (ctx, session, msg) => ctx.frequencyTable.apply(
    { clientMutationId: msg.clientMutationId, facilityId: facilityOf(ctx, msg), op: opOf(msg) },
    msg.actingPositionId, session.controllerId,
  ),
  rememberId: (result, msg, ctx) => facilityOf(ctx, msg),
  fromCached: (ctx, cached, msg) => ({ ...cached, row: ctx.frequencyTable.rowsFor(cached.id).find(r => rowMatchesOp(r, opOf(msg))) || null }),
  persistWhen: () => false,
  ack: (result) => ({ row: result.row || null, changed: result.ok ? result.changed : undefined, reason: result.reason, detail: result.detail }),
  broadcasts: (result, ctx, msg) => ({ primary: frequencyDelta(ctx.frequencyTable, facilityOf(ctx, msg)) }),

  snapshot: (ctx) => (ctx.frequencyTable ? ctx.frequencyTable.getAll() : []),
};
