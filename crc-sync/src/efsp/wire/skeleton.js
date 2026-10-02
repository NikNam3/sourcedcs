'use strict';

// The one generic skeleton every wire family runs through (docs/wip/ARCH-plan.md §1.2): store present ->
// session binding (the gate) -> class check -> replay lookup -> apply -> remember -> persist on ok -> ack (with the
// family's `subject` fields) -> broadcasts, in SLOT_ORDER. A family (families/*.js) declares the parts that differ; a family
// whose shape does not fit declares `handle()` instead and says so in its own file.

const { VERSION } = require('./frames');
const families = require('./families');

const { SLOT_ORDER, orderSlots } = require('./slots');

/**
 * WHAT an op was about, echoed from the INBOUND message onto every ack —
 * success and refusal alike.
 *
 * F-103's defect ("a refusal does not say which Strip it was about") survived
 * on the correlation, MARSA and airspace paths. The panel attributes a refused
 * Strip op by recovering its pending Mutation, but those three op families are
 * not registered as pending client-side, so the only subject a refusal can have
 * is whatever the ack carries — and a rejection raised BEFORE the store was
 * consulted (NOT_HOLDING_POSITION, PERMISSION_DENIED, a missing store) carries
 * no record at all. So the reason landed on screen attached to nothing.
 *
 * Echoed rather than looked up, deliberately: a refusal that never reached a
 * store has nothing to look up, and the id the client needs is the id it sent.
 */
function subjectOf(msg) {
  if (msg.type === 'efsp-mutation') return { stripId: msg.stripId };
  const family = families.byType[msg.type];
  return family && family.subject ? family.subject(msg) : {};
}

function _isPrimarySomewhere(ctx, session, msg) {
  return ctx.facilityConfig.getFacilityIds().some((facilityId) => {
    const positionStore = ctx.positionStoreFor(facilityId);
    return positionStore && positionStore.primaryOf(msg.actingPositionId) === session.controllerId;
  });
}

/** Null when the session may act, else { reason, detail }. The session binding of docs/adr/0029, once, for every family. */
function _gate(family, ctx, session, msg) {
  // A service principal (the HTTP path, ADR 0098 §9) is set by server code on a pseudo-session, never by the wire; a
  // family names the principals it accepts, and any other principal is refused.
  if (session && session.servicePrincipal) {
    if (family.servicePrincipals && family.servicePrincipals.includes(session.servicePrincipal.service)) return null;
    return { reason: 'PERMISSION_DENIED', detail: `${session.servicePrincipal.service} may not use ${family.type}` };
  }
  if (typeof family.gate === 'function') return family.gate(ctx, session, msg);
  if (family.gate === 'primary-somewhere') {
    return _isPrimarySomewhere(ctx, session, msg) ? null : { reason: 'NOT_HOLDING_POSITION', detail: family.notHolding(msg) };
  }
  if (family.gate === 'primary-at-facility') {
    const facilityId = family.facilityOf(ctx, msg);
    const positionStore = ctx.positionStoreFor(facilityId);
    if (!positionStore || positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
      return { reason: 'NOT_HOLDING_POSITION', detail: family.notHolding(msg, facilityId) };
    }
    return null;
  }
  throw new Error(`wire family ${family.type}: unknown gate ${family.gate}`);
}

function _cachedOutcome(ctx, kind, msg) {
  return ctx.replayCache ? ctx.replayCache.get(kind, msg.clientMutationId) : null;
}
function _rememberOutcome(ctx, kind, msg, result, id) {
  if (ctx.replayCache) ctx.replayCache.set(kind, msg.clientMutationId, { ok: result.ok, reason: result.reason, detail: result.detail, warning: result.warning, id });
}

function run(family, ctx, session, msg, persist) {
  if (family.handle) return family.handle(ctx, session, msg, persist);

  const prefix = () => ({ version: VERSION, type: family.ackType, clientMutationId: msg.clientMutationId, ...family.subject(msg), ...(family.head ? family.head(ctx, msg) : {}) });
  // A refusal made here, before the store, is marked `unaudited` so the metrics tap writes it (docs/adr/0083).
  const refuse = (reason, detail) => ({
    ack: { ...prefix(), ok: false, reason, detail, ...(family.refusalTail ? family.refusalTail(ctx, msg) : {}) },
    broadcasts: orderSlots(null),
    ...(family.unauditedGates === false ? {} : { unaudited: true }),
  });

  const store = family.store(ctx);
  if (!store) return refuse('VALIDATION_ERROR', family.noStore);

  const denied = _gate(family, ctx, session, msg);
  if (denied) return refuse(denied.reason, denied.detail);
  const notPermitted = family.permit ? family.permit(ctx, msg) : null;
  if (notPermitted) return refuse(notPermitted.reason, notPermitted.detail);

  const cached = _cachedOutcome(ctx, family.replayKind, msg);
  if (cached) {
    const result = family.fromCached(ctx, cached, msg);
    return { ack: { ...prefix(), ok: result.ok, ...family.ack(result, ctx, msg) }, broadcasts: orderSlots(null) };
  }

  const result = family.apply(ctx, session, msg);
  _rememberOutcome(ctx, family.replayKind, msg, result, family.rememberId(result, msg, ctx));
  if (family.persistWhen ? family.persistWhen(result) : result.ok) persist();
  if (result.ok && family.after) family.after(ctx, result, msg);

  const ack = { ...prefix(), ok: result.ok, ...family.ack(result, ctx, msg) };
  if (!result.ok) return { ack, broadcasts: orderSlots(null) };
  return { ack, broadcasts: orderSlots(family.broadcasts(result, ctx, msg)) };
}

module.exports = { run, orderSlots, subjectOf, SLOT_ORDER };
