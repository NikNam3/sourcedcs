'use strict';
import { diffDefinitions } from './airspace-validate.js';
import { getAllEfspStrips } from './board-data.js';

// The airspace records the client holds, and the edit log of each (DESK-SPLIT, split out of efsp-state.js).

// The RANGE slice — airspaceId -> the airspace record (state, window, pending
// request, history, plus its static definition). Theater-wide rather than
// per-Facility: an airspace names its controlling Facility rather than being
// replicated into each one.
export const efspAirspaces = new Map();

// The definition edits THIS window has seen arrive (airspaceId -> [{ defRev, at, by, changes: [{ field, from, to }] }],
// oldest first, bounded). crc-sync keeps the full trail (`definitionHistory`) but does not put it on the wire (its record
// view strips it), so the History view shows what this window watched change, and says so; the Mutation log has the rest.
export const efspAirspaceEdits = new Map();

const AIRSPACE_EDIT_LOG_CAP = 50;

/** A record arrived over `previous`: when its definition revision moved, log the edit (what changed, when, by whom). */
function _noteAirspaceEdit(previous, next) {
  if (!previous || !(next.defRev > previous.defRev)) return;
  const log = efspAirspaceEdits.get(next.airspaceId) || [];
  log.push({ defRev: next.defRev, at: next.updatedAt, by: next.updatedBy || null, missed: next.defRev - previous.defRev - 1,
    changes: diffDefinitions(previous.definition, next.definition) });
  while (log.length > AIRSPACE_EDIT_LOG_CAP) log.shift();
  efspAirspaceEdits.set(next.airspaceId, log);
}

export function _replaceAirspaces(list) {
  const held = new Map(efspAirspaces);
  efspAirspaces.clear();
  for (const a of list || []) {
    _noteAirspaceEdit(held.get(a.airspaceId), a);
    efspAirspaces.set(a.airspaceId, a);
  }
  for (const id of [...efspAirspaceEdits.keys()]) if (!efspAirspaces.has(id)) efspAirspaceEdits.delete(id);
}

/** An efsp-airspace-delta — its own message type, since airspaces are not Strips and ride no Board's seq. */
export function applyEfspAirspaceDelta(msg) {
  for (const a of (msg.airspaces && msg.airspaces.updated) || []) {
    _noteAirspaceEdit(efspAirspaces.get(a.airspaceId), a);
    efspAirspaces.set(a.airspaceId, a);
  }
  // A deleted airspace (ADR 0098 §8): gone from every client, with the edits this window kept for it.
  for (const id of (msg.airspaces && msg.airspaces.removed) || []) {
    efspAirspaces.delete(id);
    efspAirspaceEdits.delete(id);
  }
}

/** The definition edits this window has seen for an airspace, oldest first. */
export function getEfspAirspaceEdits(airspaceId) { return [...(efspAirspaceEdits.get(airspaceId) || [])]; }

export function getEfspAirspace(airspaceId) { return efspAirspaces.get(airspaceId) || null; }

export function getAllEfspAirspaces() { return [...efspAirspaces.values()]; }

/** Live Strips approved into this airspace — what a range controller sees of the flights in their block, read-only. */
export function stripsInAirspace(airspaceId) {
  return getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.airspaceEntry && s.airspaceEntry.airspaceId === airspaceId);
}

export function _resetAirspaceState() { efspAirspaces.clear(); efspAirspaceEdits.clear(); }
