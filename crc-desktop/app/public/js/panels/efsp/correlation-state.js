'use strict';
import { getAllEfspStrips } from './board-data.js';

// The Strip <-> surveillance contact correlation records the client holds (DESK-SPLIT, split out of efsp-state.js).

// WP5 (crc-sync's docs/adr/0045) — flightDataId -> the correlation record: which
// surveillance contact this airframe is, on what evidence, and any warning.
//
// Keyed by flightDataId, not stripId, and that is the point. One flight data legitimately has
// several Strips — per-Facility replicas, a TOFI MISSION Strip, an arrival
// converted in place — and they are all one airframe. A per-Strip correlation
// would let two of them disagree about which contact it is, which is the
// identity-reconciliation defect the subsystem exists to prevent.
const efspCorrelations = new Map();

// The correlation rate, as the server last reported it (guide §6.6 rule 6).
let efspCorrelationStats = null;

export function _replaceCorrelations(list) {
  efspCorrelations.clear();
  for (const r of list || []) efspCorrelations.set(r.flightDataId, r);
}

/**
 * An efsp-correlation-delta — its own message type with its own seq, like the
 * airspace delta. Changed records only, once per server reconcile tick.
 *
 * Note what does NOT need to happen here: clearing a warning. The record
 * arrives whole, so a retracted warning simply comes back as `warning: null`.
 * Obligations clear the same way in spirit: the next efsp-alerts omits them.
 */
export function applyEfspCorrelationDelta(msg) {
  for (const r of (msg.correlations && msg.correlations.updated) || []) {
    efspCorrelations.set(r.flightDataId, r);
  }
  if (msg.stats) efspCorrelationStats = msg.stats;
}

export function getEfspCorrelation(flightDataId) { return efspCorrelations.get(flightDataId) || null; }

export function getAllEfspCorrelations() { return [...efspCorrelations.values()]; }

export function getEfspCorrelationStats() { return efspCorrelationStats; }

/** The correlation for whichever airframe this Strip is about. */
export function getEfspCorrelationForStrip(strip) {
  return strip ? getEfspCorrelation(strip.flightDataId) : null;
}

/** The contact this Strip is bound to, or null. What the map highlight reads. */
export function correlatedTrackIdForStrip(strip) {
  const record = getEfspCorrelationForStrip(strip);
  return record && record.trackId ? record.trackId : null;
}

/**
 * The reverse lookup, for a click on the map: which live Strips are about the
 * airframe this contact is?
 *
 * A linear walk rather than a maintained index — the same reasoning
 * otherLiveStripsForFlightData already documents, and the Strip count is in the tens.
 * Returns several when one flight data has several Strips, which is the ordinary case
 * after a cross-Facility handoff.
 */
export function stripIdsForTrackId(trackId) {
  const wanted = String(trackId);
  const flightDataIds = new Set();
  for (const record of efspCorrelations.values()) {
    if (record.trackId === wanted) flightDataIds.add(record.flightDataId);
  }
  if (flightDataIds.size === 0) return [];
  return getAllEfspStrips()
    .filter(s => s.state !== 'DROPPED' && flightDataIds.has(s.flightDataId))
    .map(s => s.stripId);
}

export function _resetCorrelationState() { efspCorrelations.clear(); efspCorrelationStats = null; }
