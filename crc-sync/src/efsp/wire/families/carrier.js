'use strict';

const { carrierDelta } = require('../frames');

/**
 * Carrier ops (docs/adr/0074; guide §9.12): the recovery Case, the Marshal
 * stack and the altimeter. A SEVENTH dispatch path, for the reason the MARSA one
 * exists: the record targets a SHIP, not a Strip, so there is no stripId, no
 * Strip baseRev and no Strip-owner check. Authority is permission.js's
 * one-parameter predicates inside the store (PriFly owns the Case, the Marshal
 * the stack), plus the session binding every dispatch path carries
 * (docs/adr/0029): the session must be PRIMARY at the acting Position, at the
 * CARRIER Facility, since a hull has exactly one Facility.
 *
 * Skeleton deviation: its gate refusals are NOT marked `unaudited` (`unauditedGates: false`), as before the refactor
 * (docs/wip/WIRE.md finding F1).
 */
module.exports = {
  type: 'efsp-carrier-mutation',
  ackType: 'efsp-carrier-ack',
  deltaType: 'efsp-carrier-delta',
  replayKind: 'carrier',
  snapshotKey: 'carriers',
  unauditedGates: false,
  subject: (msg) => ({ hullId: msg.hullId }),
  store: (ctx) => ctx.carrierStore,
  noStore: 'no carrier store',

  gate: 'primary-at-facility',
  facilityOf: () => 'CARRIER',
  notHolding: (msg) => `you are not Primary at ${msg.actingPositionId} — select it before acting on the carrier`,

  apply: (ctx, session, msg) => ctx.carrierStore.apply({ clientMutationId: msg.clientMutationId, hullId: msg.hullId, baseRev: msg.baseRev, op: msg.op }, msg.actingPositionId, session.controllerId),
  rememberId: (result, msg) => msg.hullId || null,
  // The Case and the stack decide every carrier Strip's NLA (Commence or To
  // pattern, and which lane): re-state the ones whose status moved, as
  // the sweep does for a clock-driven change (nla-status-monitor.js).
  after: (ctx) => { if (ctx.nlaStatusMonitor) ctx.nlaStatusMonitor.tick(); },
  fromCached: (ctx, cached) => cached,
  ack: (result, ctx, msg) => ({
    carrier: ctx.carrierStore.view(msg.hullId || undefined), reason: result.reason, detail: result.detail,
    changed: result.ok ? result.changed : undefined, carrierSeq: ctx.carrierStore.currentSeq,
  }),
  // One delta carrying the whole hull record: a Case change reaches every
  // client as ONE message and each re-renders every carrier Strip from it
  // (WP7A bullet 3, "at once").
  broadcasts: (result, ctx) => ({ carrier: carrierDelta(ctx.carrierStore) }),

  // The carrier's hull record(s) with the derived stack and the banner
  // (docs/adr/0074), sent whole; no efsp-resync branch, as for MARSA.
  snapshot: (ctx) => ctx.carrierStore ? ctx.carrierStore.getAll() : [],
};
