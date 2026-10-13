'use strict';


// What the monitors say is wrong right now: obligations, conformance, surveillance hints, TOFI regime and conflicts, all sent whole by efsp-alerts (DESK-SPLIT, split out of efsp-state.js).

// §4.6.1's timed forwarding obligations (docs/adr/0021, 0067) — stripId ->
// every obligation due on it right now. Full state from efsp-alerts, like
// conformance: one that is no longer due is simply not in the next message.
const efspObligations = new Map(); // stripId -> [{ facilityId, stripId, obligationType, severity, dueAt, since }]

// docs/adr/0058 — what crc-sync's conformance and conflict monitors say is
// WRONG right now. Sent whole on every change (efsp-alerts), so a flight that
// conforms again simply is not in the next message.
const efspConformance = new Map(); // flightDataId -> [{ kind, assigned, actual?, altFt?, fpm?, deviationFt?, block?, tanker?, nm?, limitNm?, since }]

// docs/adr/0076 (crc-sync) — surveillance informs, the controller advances: the
// suggestion chip and the staleness indication, stripId -> hints. Full state in
// efsp-alerts, so one that no longer applies is simply not in the next message.
const efspSurveillanceHints = new Map(); // stripId -> [{ kind: 'AIRBORNE_ADVANCE'|'STALE', stripState, toState?, since, afterSec? }]

const efspTofiRegime = new Map(); // flightDataId -> { kind: 'REGIME_OUTSIDE_AIRSPACE'|'AWAITING_ENTRY_UNKNOWN', since } (crc-sync docs/adr/0102)

let efspConflicts = [];            // [{ id, kind: 'CA'|'MCI', a, b, aCallsign, bCallsign, intruder?, timeToCpaSec, minNm, vertFt, aAt, bAt }]

// crc-sync docs/adr/0119: an aircraft inside an ACTIVE airspace it may not be in. Only this session's (the airspace's
// controlling Position, or the Position working the flight); sent whole, so one that retracted is simply not there.
let efspAirspaceEntry = [];        // [{ id, kind: 'AIRSPACE_ENTRY', trackId, flightDataId|null, callsign, airspaceId, airspaceName, airspaceType, since }]

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
  efspAirspaceEntry = (msg && msg.airspaceEntry) || [];
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

/**
 * A refueling-block alert (crc-sync's docs/adr/0118) as a short tag and a sentence: the receiver left the block around the
 * tanker (±1,000 ft, within 3 NM) or is moving away from it. Null for any other alert.
 */
export function refuelingAlertText(a) {
  if (!a || a.tanker === undefined) return null;
  if (a.kind === 'TANKER_DISTANCE') {
    return { text: `AR ${a.nm} NM`, reason: `${a.nm} NM from the tanker ${a.tanker}: outside the ${a.limitNm} NM refueling block.` };
  }
  const below = a.block && a.altFt < a.block.lowFt;
  const off = a.block ? Math.abs(a.altFt - (below ? a.block.lowFt : a.block.highFt)) : Math.abs(a.deviationFt || 0);
  const where = `${off.toLocaleString('en-US')} ft ${below ? 'below' : 'above'} the refueling block with ${a.tanker}`;
  if (a.kind === 'WRONG_WAY') {
    return { text: `AR ${below ? '↓' : '↑'}`, reason: `${where}, ${a.fpm < 0 ? 'descending' : 'climbing'} away at ${Math.abs(a.fpm).toLocaleString('en-US')} ft/min.` };
  }
  if (a.kind === 'LEVEL_BUST') return { text: `AR ${below ? '−' : '+'}${off}`, reason: `${where}.` };
  return null;
}

/** The tag a conflict is shown with: `CA` or `MCI` (crc-sync's docs/adr/0118). */
export function conflictTag(c) { return c && c.kind === 'MCI' ? 'MCI' : 'CA'; }

/** The words for it: "Conflict Alert" or "Mode C Intruder". */
export function conflictName(c) { return c && c.kind === 'MCI' ? 'Mode C Intruder' : 'Conflict Alert'; }

/** Every current short-term conflict. */
export function getAllEfspConflicts() { return efspConflicts; }

/**
 * The conflicts this track is in, each seen from its side: { id, kind, other, otherCallsign, timeToCpaSec, minNm, vertFt }.
 * `kind` is 'CA' (two tracked aircraft) or 'MCI' (a Mode C intruder against a tracked one), crc-sync's docs/adr/0118.
 */
export function conflictAlertsForTrack(trackId) {
  if (trackId == null) return [];
  const id = String(trackId);
  return efspConflicts.filter(c => c.a === id || c.b === id).map(c => ({
    id: c.id,
    kind: c.kind === 'MCI' ? 'MCI' : 'CA',
    other: c.a === id ? c.b : c.a,
    otherCallsign: c.a === id ? c.bCallsign : c.aCallsign,
    timeToCpaSec: c.timeToCpaSec, minNm: c.minNm, vertFt: c.vertFt,
  }));
}

/** The airspace-entry alerts naming this track (crc-sync docs/adr/0119); [] when none. */
export function airspaceEntryAlertsForTrack(trackId) {
  if (trackId == null) return [];
  const id = String(trackId);
  return efspAirspaceEntry.filter(a => a.trackId === id);
}

/** The airspace-entry alerts standing on this flight; [] when none. */
export function airspaceEntryAlertsForFlightData(flightDataId) {
  if (!flightDataId) return [];
  return efspAirspaceEntry.filter(a => a.flightDataId === flightDataId);
}

/** "Airspace conflict R-7203", the P/CG term (AIRSPACE CONFLICT) and the airspace's name. */
export function airspaceEntryText(a) { return `Airspace conflict ${a.airspaceName || a.airspaceId}`; }

export function _resetAlertsState() {
  efspObligations.clear();
  efspSurveillanceHints.clear();
  efspConformance.clear();
  efspTofiRegime.clear();
  efspConflicts = [];
  efspAirspaceEntry = [];
}
