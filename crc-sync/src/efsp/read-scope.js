'use strict';

// What a session is SENT of the flights (docs/adr/0080, decisions.md H40/H59).
//
// ADR 0059 says the wire carries only what a session's own sensors know. H40
// applies the same idea to Strips: a JTAC is sent only the Strips it has been
// handed. Everything else in a message (Positions, Bays, airspaces, field
// state, config) is not a flight and goes to everybody as before.
//
// Pure: no requires, no stores. The caller says which Positions a session holds
// and how each Position reads (permission.js's table), and hands over the sets
// of flights that are visible; this module only computes the scope and filters
// messages by it. A session whose scope is 'ALL' is never touched (the caller
// sends the same message object).

const ALL = 'ALL';
const OWNED = 'OWNED';

/**
 * @param {Array<{facilityId:string, positionId:string}>} held every Position the session holds, at every Facility
 * @param {(positionId:string) => 'ALL'|'OWNED'} readScopeFor
 * @returns {{kind:'ALL'}|{kind:'OWNED', own:Map<string, Set<string>>}}
 *   ALL when the session holds nothing (H58: an unassigned session sees the whole Board, as today) or any Position that reads ALL.
 */
function scopeOf(held, readScopeFor) {
  if (!held || held.length === 0) return { kind: ALL };
  if (held.some(h => readScopeFor(h.positionId) !== OWNED)) return { kind: ALL };
  const own = new Map();
  for (const { facilityId, positionId } of held) {
    if (!own.has(facilityId)) own.set(facilityId, new Set());
    own.get(facilityId).add(positionId);
  }
  return { kind: OWNED, own };
}

/** A string that changes exactly when what the session may see changes. */
function scopeKey(scope) {
  if (scope.kind === ALL) return ALL;
  const parts = [];
  for (const [facilityId, ids] of scope.own) for (const id of ids) parts.push(`${facilityId}/${id}`);
  return `${OWNED}:${parts.sort().join(',')}`;
}

function isOwned(scope) { return scope.kind === OWNED; }

/** Does the session own this Strip? `facilityId` defaults to the Strip's own stamp. */
function isStripVisible(scope, strip, facilityId) {
  if (scope.kind === ALL) return true;
  if (!strip) return false;
  const ids = scope.own.get(facilityId || strip.facilityId);
  return !!ids && ids.has(strip.ownerPositionId);
}

/** The FDRs of the Strips a scope can see, from `strips` (each stamped with facilityId). */
function visibleFdrIdsOf(scope, strips) {
  const out = new Set();
  for (const s of strips) if (isStripVisible(scope, s) && s.fdrId) out.add(s.fdrId);
  return out;
}

/** efsp-snapshot: flights filtered, everything else as it was. Returns a new object; never mutates `msg`. */
function filterSnapshot(msg, scope) {
  if (scope.kind === ALL) return msg;
  const strips = (msg.strips || []).filter(s => isStripVisible(scope, s));
  const fdrIds = new Set(strips.map(s => s.fdrId));
  return {
    ...msg,
    strips,
    fdrs: (msg.fdrs || []).filter(f => fdrIds.has(f.fdrId)),
    correlations: (msg.correlations || []).filter(c => fdrIds.has(c.fdrId)),
    marsa: (msg.marsa || []).filter(r => (r.participants || []).some(id => fdrIds.has(id))),
  };
}

/**
 * efsp-board-delta. Stateless: every updated Strip the scope cannot see goes
 * into `strips.gone`, so a Strip that was handed away disappears on the next
 * delta without any per-session memory (an unknown id in `gone` is a no-op on
 * the client). The message is always returned, even empty, so `boardSeq` stays
 * continuous (a skipped delta would make the next resync look like a gap).
 * A Strip that has just BECOME visible (handed to this session) arrives as one
 * updated Strip, and its FDR was filtered out of every delta until now, so the
 * FDR of every visible updated Strip rides along (`fdrOf` supplies it). Without
 * that a handed line drew with a blank callsign.
 * @param {Set<string>} fdrIds the FDRs of every Strip the scope can see now, on every Board
 * @param {(fdrId:string) => object|null} [fdrOf]
 */
function filterBoardDelta(msg, scope, fdrIds, fdrOf = () => null) {
  if (scope.kind === ALL) return msg;
  const strips = msg.strips || {};
  const updated = [];
  const gone = [...(strips.gone || [])];
  for (const s of strips.updated || []) {
    if (isStripVisible(scope, s, s.facilityId || msg.facilityId)) updated.push(s);
    else gone.push(s.stripId);
  }
  const fdrs = msg.fdrs || {};
  const fdrsUpdated = (fdrs.updated || []).filter(f => fdrIds.has(f.fdrId));
  const have = new Set(fdrsUpdated.map(f => f.fdrId));
  for (const s of updated) {
    if (!s.fdrId || have.has(s.fdrId)) continue;
    const fdr = fdrOf(s.fdrId);
    if (fdr) { fdrsUpdated.push(fdr); have.add(s.fdrId); }
  }
  return {
    ...msg,
    strips: { ...strips, updated, gone },
    fdrs: { ...fdrs, updated: fdrsUpdated },
  };
}

/** efsp-correlation-delta: the visible flights' records, or null when none is left. */
function filterCorrelationDelta(msg, scope, fdrIds) {
  if (scope.kind === ALL) return msg;
  const updated = ((msg.correlations || {}).updated || []).filter(c => fdrIds.has(c.fdrId));
  return updated.length ? { ...msg, correlations: { ...msg.correlations, updated } } : null;
}

/** efsp-marsa-delta: relations with a visible participant, or null when none is left. */
function filterMarsaDelta(msg, scope, fdrIds) {
  if (scope.kind === ALL) return msg;
  const updated = ((msg.marsa || {}).updated || []).filter(r => (r.participants || []).some(id => fdrIds.has(id)));
  return updated.length ? { ...msg, marsa: { ...msg.marsa, updated } } : null;
}

/**
 * efsp-alerts: conformance (by fdrId) and obligations (by Facility and Strip)
 * for visible flights only. `stca` is scoped per session elsewhere (ATC only).
 * @param {(facilityId:string, stripId:string) => boolean} stripVisible
 */
function filterAlerts(msg, scope, fdrIds, stripVisible) {
  if (scope.kind === ALL) return msg;
  return {
    ...msg,
    conformance: (msg.conformance || []).filter(a => fdrIds.has(a.fdrId)),
    obligations: (msg.obligations || []).filter(o => stripVisible(o.facilityId, o.stripId)),
  };
}

module.exports = {
  ALL, OWNED, scopeOf, scopeKey, isOwned, isStripVisible, visibleFdrIdsOf,
  filterSnapshot, filterBoardDelta, filterCorrelationDelta, filterMarsaDelta, filterAlerts,
};
