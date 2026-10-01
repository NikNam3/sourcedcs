'use strict';

const { sfaDelta } = require('../frames');

/**
 * The SFA rotation record (guide §4.7, docs/adr/0075, 0093): which Position is on
 * which frequency. An EIGHTH dispatch path for the carrier's reason: the record
 * is about the approach, not a Strip, so there is no stripId and no Strip-owner
 * check. Authority is permission.js's capability table narrowed by config's
 * jurisdiction, inside the store, plus the session binding every dispatch path
 * carries (docs/adr/0029): Primary at the acting Position, at its Facility.
 * One delta carrying the whole record, ADR 0064 B6's shape.
 *
 * Skeleton deviations: gate refusals are NOT marked `unaudited` (`unauditedGates: false`, finding F1); it persists and
 * broadcasts only when the op `changed` the record (`persistWhen`, and `broadcasts` returning no slot otherwise).
 */
module.exports = {
  type: 'efsp-sfa-mutation',
  ackType: 'efsp-sfa-ack',
  deltaType: 'efsp-sfa-delta',
  replayKind: 'sfa',
  snapshotKey: 'sfaRotation',
  unauditedGates: false,
  subject: (msg) => ({ rackId: msg.op && msg.op.rackId }),
  store: (ctx) => ctx.sfaStore,
  noStore: 'no SFA in this crc-sync',

  gate: 'primary-at-facility',
  facilityOf: (ctx) => ctx.facilityConfig.DEFAULT_FACILITY_ID,
  notHolding: (msg) => `you are not Primary at ${msg.actingPositionId} — select it before rotating the SFA frequencies`,

  apply: (ctx, session, msg) => ctx.sfaStore.apply({ clientMutationId: msg.clientMutationId, baseRev: msg.baseRev, op: msg.op }, msg.actingPositionId, session.controllerId),
  rememberId: () => null,
  persistWhen: (result) => result.ok && result.changed,
  fromCached: (ctx, cached) => cached,
  ack: (result, ctx) => ({ sfaRotation: ctx.sfaStore.view(), reason: result.reason, detail: result.detail, sfaSeq: ctx.sfaStore.currentSeq }),
  broadcasts: (result, ctx) => (result.changed ? { sfa: sfaDelta(ctx.sfaStore) } : {}),

  // Who is on which SFA frequency (docs/adr/0075, 0093), sent whole; null where
  // this crc-sync has no SFA. No efsp-resync branch, as for the carrier.
  snapshot: (ctx) => ctx.sfaStore ? ctx.sfaStore.view() : null,
};
