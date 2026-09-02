'use strict';

// Client-side mirror of the EFSP Board — plain module-level Maps, matching
// app.js's existing style (tracks/history/settings are also plain globals,
// not a framework store). Owns the local copy of Strips/FDRs/Positions,
// applying snapshot/delta/ack messages from crc-sync, and the pending-
// mutation tracker that lets an unacknowledged Mutation be replayed against
// a fresh baseline after reconnect (guide §5.6.3) instead of silently lost
// (the guide's own words: "the worst failure mode in the system").
//
// Guarded module.exports at the end (same pattern as los.js) so this file
// works unmodified as a plain <script> global in the browser AND as a
// require()-able module for node:test — no build step either way.

const efspStrips = new Map();     // stripId -> Strip
const efspFdrs = new Map();       // fdrId -> FlightDataRecord
const efspPositions = new Map();  // positionId -> PositionOccupancy
let efspBoardSeq = 0;
let efspFacility = null;
let efspBays = [];

// clientMutationId -> the original efsp-mutation message sent, kept until
// its ack arrives — replayed against a fresh baseline on reconnect (§5.6.3).
const efspPendingMutations = new Map();

function applyEfspSnapshot(msg) {
  efspStrips.clear();
  efspFdrs.clear();
  efspPositions.clear();
  for (const s of msg.strips || []) efspStrips.set(s.stripId, s);
  for (const f of msg.fdrs || []) efspFdrs.set(f.fdrId, f);
  for (const p of msg.positions || []) efspPositions.set(p.positionId, p);
  efspBoardSeq = msg.boardSeq;
  efspFacility = msg.facility;
  efspBays = msg.bays || [];
}

function applyEfspDelta(msg) {
  for (const s of (msg.strips && msg.strips.updated) || []) efspStrips.set(s.stripId, s);
  for (const id of (msg.strips && msg.strips.gone) || []) efspStrips.delete(id);
  for (const f of (msg.fdrs && msg.fdrs.updated) || []) efspFdrs.set(f.fdrId, f);
  for (const p of (msg.positions && msg.positions.updated) || []) efspPositions.set(p.positionId, p);
  if (Number.isFinite(msg.boardSeq)) efspBoardSeq = msg.boardSeq;
}

/**
 * Applies an efsp-mutation-ack. The server includes the current Strip/FDR
 * on BOTH success and rejection (board-store.js always returns the
 * authoritative current state) — apply it either way, so a rejected
 * optimistic edit snaps back to server truth rather than lingering.
 * @returns {{wasPending:boolean, ok:boolean, reason?:string, detail?:string, warning?:string}}
 */
function applyEfspMutationAck(msg) {
  const wasPending = efspPendingMutations.has(msg.clientMutationId);
  efspPendingMutations.delete(msg.clientMutationId);
  if (msg.strip) efspStrips.set(msg.strip.stripId, msg.strip);
  if (msg.fdr) efspFdrs.set(msg.fdr.fdrId, msg.fdr);
  if (Number.isFinite(msg.boardSeq)) efspBoardSeq = msg.boardSeq;
  return { wasPending, ok: !!msg.ok, reason: msg.reason, detail: msg.detail, warning: msg.warning };
}

/** Registers a just-sent efsp-mutation message as pending its ack. */
function registerPendingMutation(msg) {
  efspPendingMutations.set(msg.clientMutationId, msg);
}

function getPendingMutations() {
  return [...efspPendingMutations.values()];
}

/**
 * Rebuilds a pending mutation's baseRev against the CURRENT local Strip
 * (post-reconnect, after a fresh snapshot/delta has landed) — the concrete
 * "rebase" step of §5.6.3's replay. Returns null if the target Strip no
 * longer exists locally at all (caller should surface that distinctly,
 * not silently drop the mutation).
 */
function rebaseForResend(clientMutationId) {
  const original = efspPendingMutations.get(clientMutationId);
  if (!original || !original.stripId) return null; // CreateStrip has no stripId/baseRev to rebase
  const current = efspStrips.get(original.stripId);
  if (!current) return null;
  return { ...original, baseRev: current.rev };
}

function getEfspStrip(stripId) { return efspStrips.get(stripId) || null; }
function getEfspFdr(fdrId) { return efspFdrs.get(fdrId) || null; }
function getEfspPosition(positionId) { return efspPositions.get(positionId) || null; }
function getAllEfspStrips() { return [...efspStrips.values()]; }
function getAllEfspPositions() { return [...efspPositions.values()]; }
function getEfspBoardSeq() { return efspBoardSeq; }
function getEfspFacility() { return efspFacility; }
function getEfspBays() { return efspBays; }

/** Strips currently placed in a Bay/Rack, in order, excluding DROPPED — mirrors board-store.js's getRack() exactly. */
function getEfspRack(bayId, rackId) {
  return getAllEfspStrips()
    .filter(s => s.bayId === bayId && s.rackId === rackId && s.state !== 'DROPPED')
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : (a.stripId < b.stripId ? -1 : 1)));
}

/**
 * Client-local search (guide §4.3 rule 2, defect D2 — "the longest
 * ground-control dwells occurred searching the Pending bay"). Deliberately
 * NOT a server concept: search results are a second VIEW onto the same
 * live Strip objects, still in their real Bay/Rack (no re-parenting) —
 * matches board.js/efsp-panel.js's existing precedent that "which Bay is
 * in view" is per-controller local state, not Board state. Matches
 * callsign or beacon code, case-insensitive substring. Excludes DROPPED,
 * same as getEfspRack.
 */
function searchEfspStrips(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return getAllEfspStrips().filter((s) => {
    if (s.state === 'DROPPED') return false;
    const fdr = getEfspFdr(s.fdrId);
    const callsign = (fdr && fdr.identity && fdr.identity.callsign) || '';
    const beacon = (fdr && fdr.identity && fdr.identity.beaconAssigned) || '';
    return callsign.toLowerCase().includes(q) || beacon.toLowerCase().includes(q);
  });
}

// Test-only reset — this module holds top-level mutable state (matching
// app.js's own plain-globals style), so tests need a way to isolate runs.
function _resetEfspStateForTest() {
  efspStrips.clear();
  efspFdrs.clear();
  efspPositions.clear();
  efspPendingMutations.clear();
  efspBoardSeq = 0;
  efspFacility = null;
  efspBays = [];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    applyEfspSnapshot, applyEfspDelta, applyEfspMutationAck,
    registerPendingMutation, getPendingMutations, rebaseForResend,
    getEfspStrip, getEfspFdr, getEfspPosition, getAllEfspStrips, getAllEfspPositions,
    getEfspRack, searchEfspStrips, getEfspBoardSeq, getEfspFacility, getEfspBays,
    _resetEfspStateForTest,
  };
}
