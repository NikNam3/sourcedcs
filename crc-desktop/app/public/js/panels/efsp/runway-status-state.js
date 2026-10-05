'use strict';


// The runway-status records the client holds, one per Facility (DESK-SPLIT, split out of efsp-state.js; crc-sync docs/adr/0061).

const efspRunwayStatuses = new Map(); // facilityId -> runway-status record (crc-sync docs/adr/0061)

export function _replaceRunwayStatuses(list) {
  efspRunwayStatuses.clear();
  for (const r of list || []) efspRunwayStatuses.set(r.facilityId, r);
}

/**
 * An efsp-runway-status-delta (guide §9.7, crc-sync docs/adr/0061) — its own
 * message type on its own seq, like MARSA and airspace: a runway is not a
 * Strip and rides no Board's sequence. One record per Facility, sent whole, so
 * a delta simply replaces it (docs/adr/0068).
 */
export function applyEfspRunwayStatusDelta(msg) {
  for (const r of (msg && msg.runwayStatuses && msg.runwayStatuses.updated) || []) {
    if (r && r.facilityId) efspRunwayStatuses.set(r.facilityId, r);
  }
}

/** The Facility's runway-status record exactly as the server sent it, or null (L12/L13 read this — do not rename). */
export function getEfspRunwayStatus(facilityId) { return efspRunwayStatuses.get(facilityId) || null; }

export function getAllEfspRunwayStatuses() { return [...efspRunwayStatuses.values()]; }

export function _resetRunwayStatusState() { efspRunwayStatuses.clear(); }
