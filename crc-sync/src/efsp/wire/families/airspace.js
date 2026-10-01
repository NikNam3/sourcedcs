'use strict';

const { VERSION } = require('../frames');

/**
 * Airspace ops (schedule/request/approve/release/return) — a SEPARATE
 * dispatch path from _handleMutation, because they target an airspace rather
 * than a Strip. `applyMutation` is built on mutation.stripId, the Strip's
 * baseRev and the Strip-owner check, none of which mean anything for a
 * record that no Position owns and no Board holds.
 *
 * Guide §4.1 rule 2: the `RANGE` Position "works no Strips. It owns airspace
 * state". This is the wire surface for that.
 */
module.exports = {
  type: 'efsp-airspace-mutation',
  ackType: 'efsp-airspace-ack',
  deltaType: 'efsp-airspace-delta',
  replayKind: 'airspace',
  snapshotKey: 'airspaces',
  subject: (msg) => ({ airspaceId: msg.airspaceId }),
  store: (ctx) => ctx.airspaceStore,
  noStore: 'no airspace store',

  // The same session binding _handleMutation carries (docs/adr/0029), for the
  // same reason: actingPositionId arrives as an untrusted client claim, and
  // the airspace store's whole authority model — who may approve activation,
  // who may release — is evaluated against it. A new dispatch path is exactly
  // where that check gets forgotten and the hole reopens.
  //
  // Which Facility's PositionStore to ask is the airspace's own controlling
  // Facility, or RANGES for the using side; checking both covers a controller
  // holding either end without letting them claim a Position they don't hold.
  gate: 'primary-somewhere',
  notHolding: (msg) => `you are not Primary at ${msg.actingPositionId} — select it before acting on airspace`,

  apply: (ctx, session, msg) => ctx.airspaceStore.apply(
    { clientMutationId: msg.clientMutationId, airspaceId: msg.airspaceId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  ),
  rememberId: (result, msg) => msg.airspaceId,
  fromCached: (ctx, cached) => ({ ...cached, airspace: ctx.airspaceStore.getAirspace(cached.id) }),
  ack: (result, ctx) => ({
    airspace: result.airspace, reason: result.reason, detail: result.detail,
    warning: result.warning, occupied: result.occupied,
    airspaceSeq: ctx.airspaceStore.currentSeq,
  }),

  // Broadcast to everyone, not just the two parties: an airspace going active
  // changes what every controller in the theater is looking at, and the
  // client filters by what it holds rather than the server pre-filtering
  // (matching every other EFSP broadcast).
  broadcasts: (result, ctx) => ({
    primary: {
      version: VERSION, type: 'efsp-airspace-delta',
      airspaceSeq: ctx.airspaceStore.currentSeq,
      airspaces: { updated: [result.airspace] },
    },
  }),

  // The airspace board (guide §4.2 — "not a strip rack"), sent whole: the
  // list is small, static in size, and every controller's board shows the
  // same theater-wide set.
  snapshot: (ctx) => ctx.airspaceStore ? ctx.airspaceStore.getAll() : [],
};
