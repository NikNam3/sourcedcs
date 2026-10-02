'use strict';

const { VERSION } = require('../frames');

/**
 * Airspace ops: the six state ops (schedule/request/approve/deny/release/return), DelayActivation for a ROUTE, and the
 * registry's definition ops (Create, Edit, Delete, Import; docs/adr/0098 §4). A SEPARATE dispatch path from
 * _handleMutation, because they target an airspace rather than a Strip. `applyMutation` is built on mutation.stripId,
 * the Strip's baseRev and the Strip-owner check, none of which mean anything for a record that no Position owns and
 * no Board holds.
 *
 * Guide §4.1 rule 2: the `RANGE` Position "works no Strips. It owns airspace state". This is the wire surface for that.
 *
 * Two callers share this one skeleton pass (persistence, replay and broadcast happen once, here): a controller's
 * session (the gate: signed on to `actingPositionId`) and the HTTP service path (`efsp.applyAsService`, ADR 0098 §9),
 * whose session carries a `servicePrincipal` the server itself set, never the wire.
 */
const theaterOf = (ctx, msg) => (msg && typeof msg.theater === 'string' && msg.theater) || ctx.airspaceStore.currentTheater();

module.exports = {
  type: 'efsp-airspace-mutation',
  ackType: 'efsp-airspace-ack',
  deltaType: 'efsp-airspace-delta',
  replayKind: 'airspace',
  snapshotKey: 'airspaces',
  subject: (msg) => ({ airspaceId: msg.airspaceId }),
  // The service principals the skeleton lets past the session binding (wire/skeleton.js `_gate`).
  servicePrincipals: ['SQUADRON_ADMIN'],
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
  // signed on to either end without letting them claim a Position they are not signed on to.
  gate: 'primary-somewhere',
  notHolding: (msg) => `you are not Primary at ${msg.actingPositionId} — select it before acting on airspace`,

  apply: (ctx, session, msg) => {
    const sp = session && session.servicePrincipal;
    const actor = sp
      ? { service: sp.service, via: 'WEB', controllerId: sp.sub, actorName: sp.name, positionId: null }
      : { positionId: msg.actingPositionId, via: 'PANEL', controllerId: session.controllerId };
    return ctx.airspaceStore.apply({
      clientMutationId: msg.clientMutationId, airspaceId: msg.airspaceId, baseRev: msg.baseRev, baseDefRev: msg.baseDefRev,
      op: msg.op, ...(sp ? { theater: msg.theater } : {}),
    }, actor);
  },
  // The replay cache keeps compact records, and `id` is the one free slot: it holds the record's address (theater and
  // id) AND the extra ack fields, so a retried POST gets back the same `conflicts`, `occupied`, `staleEntries`,
  // `created`/`skipped`, `removed` and `effectiveAtRestart`, with the record as it is NOW (docs/adr/0081; QA-AIRSP2SA-2).
  rememberId: (result, msg) => ({
    airspaceId: msg.airspaceId, theater: result.theater,
    extra: Object.fromEntries(['occupied', 'staleEntries', 'conflicts', 'blockers', 'created', 'skipped', 'removed', 'effectiveAtRestart']
      .filter(k => result[k] !== undefined).map(k => [k, result[k]])),
  }),
  fromCached: (ctx, cached) => {
    const { airspaceId, theater, extra } = cached.id || {};
    return { ...cached, ...(extra || {}), theater, airspace: extra && extra.removed ? null : ctx.airspaceStore.getAirspace(airspaceId, theater) };
  },
  // The ack (pinned by tests/airspace-ack-contract.test.mjs, which sourcedcs-web and 2S-B read from): the record
  // (null after a delete), the refusal's reason/detail, and what the op adds: `conflicts` [{field, base, theirs}] on a
  // STALE_REV edit, `blockers` on a refused delete, `warning`/`occupied`/`staleEntries` on an edit or release of a
  // working AREA, `created`/`skipped` on an import, `removed` on a delete, `effectiveAtRestart` on a usingPositionId change.
  ack: (result, ctx) => ({
    airspace: result.airspace, reason: result.reason, detail: result.detail,
    warning: result.warning, occupied: result.occupied, staleEntries: result.staleEntries,
    conflicts: result.conflicts, blockers: result.blockers,
    created: result.created, skipped: result.skipped, removed: result.removed,
    effectiveAtRestart: result.effectiveAtRestart, theater: result.theater,
    airspaceSeq: ctx.airspaceStore.currentSeq, airspaceEpoch: ctx.airspaceStore.epoch,
  }),

  // Broadcast to everyone, not just the two parties: an airspace going active
  // changes what every controller in the theater is looking at, and the
  // client filters by what it holds rather than the server pre-filtering
  // (matching every other EFSP broadcast).
  broadcasts: (result, ctx) => {
    // Only the CURRENT theater's controllers see its list change (ADR 0098 §2): an edit to another theater, from the
    // web, is persisted and acked but has nobody on this mission to tell.
    if (result.theater !== ctx.airspaceStore.currentTheater()) return {};
    const updated = result.updated || (result.airspace ? [result.airspace] : []);
    const removed = result.removed ? [result.removed] : [];
    if (!updated.length && !removed.length) return {};
    return {
      primary: {
        version: VERSION, type: 'efsp-airspace-delta',
        airspaceSeq: ctx.airspaceStore.currentSeq, airspaceEpoch: ctx.airspaceStore.epoch,
        airspaces: { updated, ...(removed.length ? { removed } : {}) },
      },
    };
  },

  // The airspace board (guide §4.2 — "not a strip rack"), sent whole: the list is small and every controller's
  // board shows the same set: the loaded mission's theater only (ADR 0098 §2).
  snapshot: (ctx) => ctx.airspaceStore ? ctx.airspaceStore.getAll() : [],
};
