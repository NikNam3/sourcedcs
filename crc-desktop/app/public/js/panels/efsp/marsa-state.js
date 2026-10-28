'use strict';
import { getAllEfspStrips } from './board-data.js';

// The MARSA relations the client holds (DESK-SPLIT, split out of efsp-state.js).

// WP6 (crc-sync's docs/adr/0051) — marsaId -> the MARSA relation: which
// flights have declared that military authority is separating them, on whose
// declaration, and whether it is still standing.
//
// Keyed by marsaId with flightDataId PARTICIPANTS, which is what makes §9.2's "model
// it as an edge, not a flag" real on this side too. A per-Strip flag could not
// say who else is in the relation, and two Strips of one airframe could carry
// different answers. Finished relations stay in the Map on purpose: a VOIDED
// one is the alert §9.2 rule 2 requires, and dropping it would erase the
// warning for whoever just reconnected.
const efspMarsa = new Map();

export function _replaceMarsa(list) {
  efspMarsa.clear();
  for (const r of list || []) efspMarsa.set(r.marsaId, r);
}

/**
 * An efsp-marsa-delta — its own message type with its own seq, like the
 * airspace and correlation deltas. A relation is not a Strip and rides no
 * Board's sequence.
 *
 * The record arrives whole, so a void needs nothing cleared here: `voidedBy`
 * simply comes back set, and a relation that a controller later re-declares is
 * a different record with a different marsaId. That is docs/adr/0045's shape,
 * and obligations now clear themselves too (full state in efsp-alerts).
 */
export function applyEfspMarsaDelta(msg) {
  for (const r of (msg.marsa && msg.marsa.updated) || []) efspMarsa.set(r.marsaId, r);
}

export function getEfspMarsa(marsaId) { return efspMarsa.get(marsaId) || null; }

export function getAllEfspMarsa() { return [...efspMarsa.values()]; }

/** The ACTIVE relation this flight is in, or null. At most one — crc-sync enforces it. */
export function activeMarsaForFlightData(flightDataId) {
  if (!flightDataId) return null;
  for (const relation of efspMarsa.values()) {
    if (relation.state === 'ACTIVE' && relation.participants.includes(flightDataId)) return relation;
  }
  return null;
}

/**
 * The relation this Strip should render: the ACTIVE one if there is one, else
 * the most recently finished one this flight was in.
 *
 * Showing a finished relation is the point rather than clutter. §9.2 rule 2
 * requires a void to "alert every participant Strip", and the void is exactly
 * the moment the relation stops being ACTIVE — a badge that only rendered live
 * relations would make the alert vanish at the instant it is raised.
 */
export function marsaForStrip(strip) {
  if (!strip) return null;
  const active = activeMarsaForFlightData(strip.flightDataId);
  if (active) return active;
  let latest = null;
  for (const relation of efspMarsa.values()) {
    if (!relation.participants.includes(strip.flightDataId)) continue;
    if (!latest || (relation.endedAt || 0) > (latest.endedAt || 0)) latest = relation;
  }
  return latest;
}

/**
 * The other live Strips in this flight's ACTIVE relation — §9.2 rule 5:
 * "selecting one participant MUST highlight the others."
 *
 * A linear walk rather than a maintained index, the same reasoning
 * otherLiveStripsForFlightData and stripIdsForTrackId already document: the Strip
 * count is in the tens, and a relation has a handful of participants. Returns
 * every Strip of every participant, which is right — one participant worked by
 * two Facilities has two Strips and both are in the relation.
 */
export function marsaParticipantStripIds(strip) {
  const relation = strip ? activeMarsaForFlightData(strip.flightDataId) : null;
  if (!relation) return [];
  const others = new Set(relation.participants.filter(id => id !== strip.flightDataId));
  if (others.size === 0) return [];
  return getAllEfspStrips()
    .filter(s => s.state !== 'DROPPED' && others.has(s.flightDataId))
    .map(s => s.stripId);
}

export function _resetMarsaState() { efspMarsa.clear(); }
