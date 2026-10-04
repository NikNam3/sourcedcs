'use strict';


// What the monitors say is wrong right now: obligations, conformance, surveillance hints, TOFI regime and conflicts, all sent whole by efsp-alerts (DESK-SPLIT, split out of efsp-state.js).

// §4.6.1's timed forwarding obligations (docs/adr/0021, 0067) — stripId ->
// every obligation due on it right now. Full state from efsp-alerts, like
// conformance: one that is no longer due is simply not in the next message.
const efspObligations = new Map(); // stripId -> [{ facilityId, stripId, obligationType, severity, dueAt, since }]

// docs/adr/0058 — what crc-sync's conformance and conflict monitors say is
// WRONG right now. Sent whole on every change (efsp-alerts), so a flight that
// conforms again simply is not in the next message.
const efspConformance = new Map(); // flightDataId -> [{ kind, assigned, actual?, altFt?, fpm?, deviationFt?, since }]

// docs/adr/0076 (crc-sync) — surveillance informs, the controller advances: the
// suggestion chip and the staleness indication, stripId -> hints. Full state in
// efsp-alerts, so one that no longer applies is simply not in the next message.
const efspSurveillanceHints = new Map(); // stripId -> [{ kind: 'AIRBORNE_ADVANCE'|'STALE', stripState, toState?, since, afterSec? }]

const efspTofiRegime = new Map(); // flightDataId -> { kind: 'REGIME_OUTSIDE_AIRSPACE'|'AWAITING_ENTRY_UNKNOWN', since } (crc-sync docs/adr/0102)

let efspConflicts = [];            // [{ id, a, b, aCallsign, bCallsign, timeToCpaSec, minNm, vertFt, aAt, bAt }]

/**
 * The one obligation a Strip's badge shows: OVERDUE before WARNING, then the
 * earliest dueAt. null when nothing is due. See getEfspObligations for all.
 */
export function getEfspObligation(stripId) {
  const list = efspObligations.get(stripId);
  if (!list || !list.length) return null;
  return list.slice().sort((a, b) =>
    ((b.severity === 'OVERDUE') - (a.severity === 'OVERDUE')) || (a.dueAt - b.dueAt))[0];
}

/** Every obligation due on this Strip right now; [] when none. */
export function getEfspObligations(stripId) { return efspObligations.get(stripId) || []; }

/** Applies an efsp-alerts message: the complete current conformance, conflict and obligation picture. */
export function applyEfspAlerts(msg) {
  efspConformance.clear();
  for (const r of (msg && msg.conformance) || []) if (r.alerts && r.alerts.length) efspConformance.set(r.flightDataId, r.alerts);
  efspConflicts = (msg && msg.conflictAlert) || [];
  efspTofiRegime.clear();
  for (const r of (msg && msg.tofiRegime) || []) efspTofiRegime.set(r.flightDataId, r);
  efspSurveillanceHints.clear();
  for (const h of (msg && msg.surveillance) || []) {
    if (!efspSurveillanceHints.has(h.stripId)) efspSurveillanceHints.set(h.stripId, []);
    efspSurveillanceHints.get(h.stripId).push(h);
  }
  efspObligations.clear();
  for (const o of (msg && msg.obligations) || []) {
    if (!efspObligations.has(o.stripId)) efspObligations.set(o.stripId, []);
    efspObligations.get(o.stripId).push(o);
  }
}

/**
 * The surveillance hints standing on this Strip right now (docs/adr/0076).
 * A hint written against another state of the Strip is stale itself — the
 * Strip moved since the server looked — and is not returned.
 */
export function surveillanceHintsForStrip(strip) {
  if (!strip) return [];
  return (efspSurveillanceHints.get(strip.stripId) || []).filter(h => h.stripState === strip.state);
}

/** What is wrong with this flight's conformance right now; [] when it conforms. */
export function conformanceAlertsForFlightData(flightDataId) { return efspConformance.get(flightDataId) || []; }

/** The TOFI regime alert standing on this flight ({ kind, since }), or null (crc-sync docs/adr/0102). */
export function tofiRegimeAlertForFlightData(flightDataId) { return efspTofiRegime.get(flightDataId) || null; }

/** Every current short-term conflict. */
export function getAllEfspConflicts() { return efspConflicts; }

/** The conflicts this track is in, each seen from its side: { other, otherCallsign, timeToCpaSec, minNm, vertFt, id }. */
export function conflictAlertsForTrack(trackId) {
  if (trackId == null) return [];
  const id = String(trackId);
  return efspConflicts.filter(c => c.a === id || c.b === id).map(c => ({
    id: c.id,
    other: c.a === id ? c.b : c.a,
    otherCallsign: c.a === id ? c.bCallsign : c.aCallsign,
    timeToCpaSec: c.timeToCpaSec, minNm: c.minNm, vertFt: c.vertFt,
  }));
}

export function _resetAlertsState() {
  efspObligations.clear();
  efspSurveillanceHints.clear();
  efspConformance.clear();
  efspTofiRegime.clear();
  efspConflicts = [];
}
