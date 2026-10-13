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
 * @param {Array<{facilityId:string, positionId:string}>} signedOn every Position the session holds, at every Facility
 * @param {(positionId:string) => 'ALL'|'OWNED'} readScopeFor
 * @returns {{kind:'ALL'}|{kind:'OWNED', own:Map<string, Set<string>>}}
 *   ALL when the session holds nothing (H58: an unassigned session sees the whole Board, as today) or any Position that reads ALL.
 */
function scopeOf(signedOn, readScopeFor) {
  if (!signedOn || signedOn.length === 0) return { kind: ALL };
  if (signedOn.some(h => readScopeFor(h.positionId) !== OWNED)) return { kind: ALL };
  const own = new Map();
  for (const { facilityId, positionId } of signedOn) {
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

/** The flight data of the Strips a scope can see, from `strips` (each stamped with facilityId). */
function visibleFlightDataIdsOf(scope, strips) {
  const out = new Set();
  for (const s of strips) if (isStripVisible(scope, s) && s.flightDataId) out.add(s.flightDataId);
  return out;
}

/** efsp-snapshot: flights filtered, everything else as it was. Returns a new object; never mutates `msg`. */
function filterSnapshot(msg, scope) {
  if (scope.kind === ALL) return msg;
  const strips = (msg.strips || []).filter(s => isStripVisible(scope, s));
  const flightDataIds = new Set(strips.map(s => s.flightDataId));
  return {
    ...msg,
    strips,
    flightDataList: (msg.flightDataList || []).filter(f => flightDataIds.has(f.flightDataId)),
    correlations: (msg.correlations || []).filter(c => flightDataIds.has(c.flightDataId)),
    marsa: (msg.marsa || []).filter(r => (r.participants || []).some(id => flightDataIds.has(id))),
  };
}

/**
 * efsp-board-delta. Stateless: every updated Strip the scope cannot see goes
 * into `strips.gone`, so a Strip that was handed away disappears on the next
 * delta without any per-session memory (an unknown id in `gone` is a no-op on
 * the client). The message is always returned, even empty, so `boardSeq` stays
 * continuous (a skipped delta would make the next resync look like a gap).
 * A Strip that has just BECOME visible (handed to this session) arrives as one
 * updated Strip, and its flight data was filtered out of every delta until now, so the
 * Flight data of every visible updated Strip rides along (`flightDataOf` supplies it). Without
 * that a handed line drew with a blank callsign.
 * @param {Set<string>} flightDataIds the flight data of every Strip the scope can see now, on every Board
 * @param {(flightDataId:string) => object|null} [flightDataOf]
 */
function filterBoardDelta(msg, scope, flightDataIds, flightDataOf = () => null) {
  if (scope.kind === ALL) return msg;
  const strips = msg.strips || {};
  const updated = [];
  const gone = [...(strips.gone || [])];
  for (const s of strips.updated || []) {
    if (isStripVisible(scope, s, s.facilityId || msg.facilityId)) updated.push(s);
    else gone.push(s.stripId);
  }
  const flightDataList = msg.flightDataList || {};
  const flightDataListUpdated = (flightDataList.updated || []).filter(f => flightDataIds.has(f.flightDataId));
  const have = new Set(flightDataListUpdated.map(f => f.flightDataId));
  for (const s of updated) {
    if (!s.flightDataId || have.has(s.flightDataId)) continue;
    const flightData = flightDataOf(s.flightDataId);
    if (flightData) { flightDataListUpdated.push(flightData); have.add(s.flightDataId); }
  }
  return {
    ...msg,
    strips: { ...strips, updated, gone },
    flightDataList: { ...flightDataList, updated: flightDataListUpdated },
  };
}

/**
 * efsp-correlation-delta: the visible flights' records. Always returned, even empty, so `correlationSeq` stays
 * continuous for the session (docs/adr/0106: the same reason as filterBoardDelta).
 */
function filterCorrelationDelta(msg, scope, flightDataIds) {
  if (scope.kind === ALL) return msg;
  const updated = ((msg.correlations || {}).updated || []).filter(c => flightDataIds.has(c.flightDataId));
  return { ...msg, correlations: { ...msg.correlations, updated } };
}

/** efsp-marsa-delta: relations with a visible participant; always returned, even empty (docs/adr/0106), as for correlations. */
function filterMarsaDelta(msg, scope, flightDataIds) {
  if (scope.kind === ALL) return msg;
  const updated = ((msg.marsa || {}).updated || []).filter(r => (r.participants || []).some(id => flightDataIds.has(id)));
  return { ...msg, marsa: { ...msg.marsa, updated } };
}

/**
 * efsp-alerts: conformance (by flightDataId), obligations and surveillance hints (by Facility and Strip)
 * for visible flights only. `conflictAlert` is scoped per session elsewhere (ATC only).
 * @param {(facilityId:string, stripId:string) => boolean} stripVisible
 */
function filterAlerts(msg, scope, flightDataIds, stripVisible) {
  if (scope.kind === ALL) return msg;
  return {
    ...msg,
    conformance: (msg.conformance || []).filter(a => flightDataIds.has(a.flightDataId)),
    tofiRegime: (msg.tofiRegime || []).filter(a => flightDataIds.has(a.flightDataId)),
    // docs/adr/0119: already per Position (the hub); a flight's alert also only where the flight is visible.
    airspaceEntry: (msg.airspaceEntry || []).filter(a => !a.flightDataId || flightDataIds.has(a.flightDataId)),
    obligations: (msg.obligations || []).filter(o => stripVisible(o.facilityId, o.stripId)),
    surveillance: (msg.surveillance || []).filter(h => stripVisible(h.facilityId, h.stripId)),
  };
}

module.exports = {
  ALL, OWNED, scopeOf, scopeKey, isOwned, isStripVisible, visibleFlightDataIdsOf,
  filterSnapshot, filterBoardDelta, filterCorrelationDelta, filterMarsaDelta, filterAlerts,
};
