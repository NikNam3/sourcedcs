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
// WP4A gap-closure (docs/adr/0022) — facilityId -> is AIT authorized (a
// written directive on file) there. Lets bay-view.js disable the AIT
// option proactively instead of letting a PROPOSE submit-and-silently-fail
// against the server-side check.
let efspAitAuthorizedByFacility = {};
// crc-sync's docs/adr/0088 — facilityId -> { positionId -> the one character
// an ATC scope draws on a contact that Position owns }. Config, so it rides
// the snapshot only.
let efspPositionLetters = {};

// clientMutationId -> the original efsp-mutation message sent, kept until
// its ack arrives — replayed against a fresh baseline on reconnect (§5.6.3).
const efspPendingMutations = new Map();

// §4.6.1's timed forwarding obligations (docs/adr/0021, 0067) — stripId ->
// every obligation due on it right now. Full state from efsp-alerts, like
// conformance: one that is no longer due is simply not in the next message.
const efspObligations = new Map(); // stripId -> [{ facilityId, stripId, obligationType, severity, dueAt, since }]

// The RANGE slice — airspaceId -> the airspace record (state, window, pending
// request, history, plus its static definition). Theater-wide rather than
// per-Facility: an airspace names its controlling Facility rather than being
// replicated into each one.
const efspAirspaces = new Map();

// WP5 (crc-sync's docs/adr/0045) — fdrId -> the correlation record: which
// surveillance contact this airframe is, on what evidence, and any warning.
//
// Keyed by fdrId, not stripId, and that is the point. One FDR legitimately has
// several Strips — per-Facility replicas, a TOFI MISSION Strip, an arrival
// converted in place — and they are all one airframe. A per-Strip correlation
// would let two of them disagree about which contact it is, which is the
// identity-reconciliation defect the subsystem exists to prevent.
const efspCorrelations = new Map();
// The correlation rate, as the server last reported it (guide §6.6 rule 6).
let efspCorrelationStats = null;

// WP6 (crc-sync's docs/adr/0051) — marsaId -> the MARSA relation: which
// flights have declared that military authority is separating them, on whose
// declaration, and whether it is still standing.
//
// Keyed by marsaId with fdrId PARTICIPANTS, which is what makes §9.2's "model
// it as an edge, not a flag" real on this side too. A per-Strip flag could not
// say who else is in the relation, and two Strips of one airframe could carry
// different answers. Finished relations stay in the Map on purpose: a VOIDED
// one is the alert §9.2 rule 2 requires, and dropping it would erase the
// warning for whoever just reconnected.
const efspMarsa = new Map();
const efspFieldStates = new Map(); // facilityId -> field-state record (crc-sync docs/adr/0061)

// docs/adr/0058 — what crc-sync's conformance and conflict monitors say is
// WRONG right now. Sent whole on every change (efsp-alerts), so a flight that
// conforms again simply is not in the next message.
const efspConformance = new Map(); // fdrId -> [{ kind, assigned, actual?, altFt?, fpm?, deviationFt?, since }]
let efspConflicts = [];            // [{ id, a, b, aCallsign, bCallsign, timeToCpaSec, minNm, vertFt, aAt, bAt }]

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
  efspAitAuthorizedByFacility = msg.aitAuthorizedByFacility || {};
  efspPositionLetters = msg.positionLetters || {};
  efspAirspaces.clear();
  for (const a of msg.airspaces || []) efspAirspaces.set(a.airspaceId, a);
  efspCorrelations.clear();
  for (const r of msg.correlations || []) efspCorrelations.set(r.fdrId, r);
  efspMarsa.clear();
  for (const r of msg.marsa || []) efspMarsa.set(r.marsaId, r);
  efspFieldStates.clear();
  for (const r of msg.fieldStates || []) efspFieldStates.set(r.facilityId, r);
  // crc-sync's docs/adr/0074 — the carrier's hull record (carrier-state.js).
  if (typeof applyEfspCarrierSnapshot === 'function') applyEfspCarrierSnapshot(msg);
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
function applyEfspMarsaDelta(msg) {
  for (const r of (msg.marsa && msg.marsa.updated) || []) efspMarsa.set(r.marsaId, r);
}

function getEfspMarsa(marsaId) { return efspMarsa.get(marsaId) || null; }
function getAllEfspMarsa() { return [...efspMarsa.values()]; }

/** The ACTIVE relation this flight is in, or null. At most one — crc-sync enforces it. */
function activeMarsaForFdr(fdrId) {
  if (!fdrId) return null;
  for (const relation of efspMarsa.values()) {
    if (relation.state === 'ACTIVE' && relation.participants.includes(fdrId)) return relation;
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
function marsaForStrip(strip) {
  if (!strip) return null;
  const active = activeMarsaForFdr(strip.fdrId);
  if (active) return active;
  let latest = null;
  for (const relation of efspMarsa.values()) {
    if (!relation.participants.includes(strip.fdrId)) continue;
    if (!latest || (relation.endedAt || 0) > (latest.endedAt || 0)) latest = relation;
  }
  return latest;
}

/**
 * The other live Strips in this flight's ACTIVE relation — §9.2 rule 5:
 * "selecting one participant MUST highlight the others."
 *
 * A linear walk rather than a maintained index, the same reasoning
 * otherLiveStripsForFdr and stripIdsForTrackId already document: the Strip
 * count is in the tens, and a relation has a handful of participants. Returns
 * every Strip of every participant, which is right — one participant worked by
 * two Facilities has two Strips and both are in the relation.
 */
function marsaParticipantStripIds(strip) {
  const relation = strip ? activeMarsaForFdr(strip.fdrId) : null;
  if (!relation) return [];
  const others = new Set(relation.participants.filter(id => id !== strip.fdrId));
  if (others.size === 0) return [];
  return getAllEfspStrips()
    .filter(s => s.state !== 'DROPPED' && others.has(s.fdrId))
    .map(s => s.stripId);
}

/**
 * An efsp-field-state-delta (guide §9.7, crc-sync docs/adr/0061) — its own
 * message type on its own seq, like MARSA and airspace: a runway is not a
 * Strip and rides no Board's sequence. One record per Facility, sent whole, so
 * a delta simply replaces it (docs/adr/0068).
 */
function applyEfspFieldStateDelta(msg) {
  for (const r of (msg && msg.fieldStates && msg.fieldStates.updated) || []) {
    if (r && r.facilityId) efspFieldStates.set(r.facilityId, r);
  }
}

/** The Facility's field-state record exactly as the server sent it, or null (L12/L13 read this — do not rename). */
function getEfspFieldState(facilityId) { return efspFieldStates.get(facilityId) || null; }
function getAllEfspFieldStates() { return [...efspFieldStates.values()]; }

/**
 * An efsp-correlation-delta — its own message type with its own seq, like the
 * airspace delta. Changed records only, once per server reconcile tick.
 *
 * Note what does NOT need to happen here: clearing a warning. The record
 * arrives whole, so a retracted warning simply comes back as `warning: null`.
 * Obligations clear the same way in spirit: the next efsp-alerts omits them.
 */
function applyEfspCorrelationDelta(msg) {
  for (const r of (msg.correlations && msg.correlations.updated) || []) {
    efspCorrelations.set(r.fdrId, r);
  }
  if (msg.stats) efspCorrelationStats = msg.stats;
}

function getEfspCorrelation(fdrId) { return efspCorrelations.get(fdrId) || null; }
function getAllEfspCorrelations() { return [...efspCorrelations.values()]; }
function getEfspCorrelationStats() { return efspCorrelationStats; }

/** The correlation for whichever airframe this Strip is about. */
function getEfspCorrelationForStrip(strip) {
  return strip ? getEfspCorrelation(strip.fdrId) : null;
}

/** The contact this Strip is bound to, or null. What the map highlight reads. */
function correlatedTrackIdForStrip(strip) {
  const record = getEfspCorrelationForStrip(strip);
  return record && record.trackId ? record.trackId : null;
}

/**
 * The reverse lookup, for a click on the map: which live Strips are about the
 * airframe this contact is?
 *
 * A linear walk rather than a maintained index — the same reasoning
 * otherLiveStripsForFdr already documents, and the Strip count is in the tens.
 * Returns several when one FDR has several Strips, which is the ordinary case
 * after a cross-Facility handoff.
 */
function stripIdsForTrackId(trackId) {
  const wanted = String(trackId);
  const fdrIds = new Set();
  for (const record of efspCorrelations.values()) {
    if (record.trackId === wanted) fdrIds.add(record.fdrId);
  }
  if (fdrIds.size === 0) return [];
  return getAllEfspStrips()
    .filter(s => s.state !== 'DROPPED' && fdrIds.has(s.fdrId))
    .map(s => s.stripId);
}

/** An efsp-airspace-delta — its own message type, since airspaces are not Strips and ride no Board's seq. */
function applyEfspAirspaceDelta(msg) {
  for (const a of (msg.airspaces && msg.airspaces.updated) || []) efspAirspaces.set(a.airspaceId, a);
}

function getEfspAirspace(airspaceId) { return efspAirspaces.get(airspaceId) || null; }
function getAllEfspAirspaces() { return [...efspAirspaces.values()]; }

/** Live Strips approved into this airspace — what a range controller sees of the flights in their block, read-only. */
function stripsInAirspace(airspaceId) {
  return getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.airspaceEntry && s.airspaceEntry.airspaceId === airspaceId);
}

function applyEfspDelta(msg) {
  for (const s of (msg.strips && msg.strips.updated) || []) efspStrips.set(s.stripId, s);
  for (const id of (msg.strips && msg.strips.gone) || []) efspStrips.delete(id);
  for (const f of (msg.fdrs && msg.fdrs.updated) || []) efspFdrs.set(f.fdrId, f);
  for (const id of (msg.fdrs && msg.fdrs.gone) || []) efspFdrs.delete(id); // archived (docs/adr/0082)
  for (const p of (msg.positions && msg.positions.updated) || []) efspPositions.set(p.positionId, p);
  if (Number.isFinite(msg.boardSeq)) efspBoardSeq = msg.boardSeq;
}

/**
 * Applies an efsp-mutation-ack. The server includes the current Strip/FDR
 * on BOTH success and rejection (board-store.js always returns the
 * authoritative current state) — apply it either way, so a rejected
 * optimistic edit snaps back to server truth rather than lingering.
 *
 * `pending` is the original efsp-mutation message this ack answers, handed
 * back rather than just dropped. An ack says only "no, STALE_REV" — which
 * Strip and which typed value it refused live in the request, and nowhere
 * else (docs/ui-findings F-103/F-207: "a refusal does not say which Strip it
 * was about"). The entry is still deleted here exactly as before; the caller
 * gets the last look at it.
 * @returns {{wasPending:boolean, pending:?object, ok:boolean, reason?:string, detail?:string, warning?:string}}
 */
function applyEfspMutationAck(msg) {
  const pending = efspPendingMutations.get(msg.clientMutationId) || null;
  efspPendingMutations.delete(msg.clientMutationId);
  if (msg.strip) efspStrips.set(msg.strip.stripId, msg.strip);
  if (msg.fdr) efspFdrs.set(msg.fdr.fdrId, msg.fdr);
  if (Number.isFinite(msg.boardSeq)) efspBoardSeq = msg.boardSeq;
  return { wasPending: !!pending, pending, ok: !!msg.ok, reason: msg.reason, detail: msg.detail, warning: msg.warning };
}

/** Registers a just-sent efsp-mutation message as pending its ack. */
function registerPendingMutation(msg) {
  efspPendingMutations.set(msg.clientMutationId, msg);
}

/**
 * The one obligation a Strip's badge shows: OVERDUE before WARNING, then the
 * earliest dueAt. null when nothing is due. See getEfspObligations for all.
 */
function getEfspObligation(stripId) {
  const list = efspObligations.get(stripId);
  if (!list || !list.length) return null;
  return list.slice().sort((a, b) =>
    ((b.severity === 'OVERDUE') - (a.severity === 'OVERDUE')) || (a.dueAt - b.dueAt))[0];
}

/** Every obligation due on this Strip right now; [] when none. */
function getEfspObligations(stripId) { return efspObligations.get(stripId) || []; }

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
function isAitAuthorizedFor(facilityId) { return !!efspAitAuthorizedByFacility[facilityId]; }

/** The ATC-scope letter for a Position (docs/adr/0088), searched across Facilities; null when none is configured. */
function getEfspPositionLetter(positionId) {
  for (const letters of Object.values(efspPositionLetters)) {
    if (letters && Object.prototype.hasOwnProperty.call(letters, positionId)) return letters[positionId];
  }
  return null;
}

/**
 * Other live Strips sharing this FDR, excluding one by id.
 *
 * One flight legitimately has several Strips: every cross-Facility exchange
 * mints a replica rather than moving the original (guide §4.6), and TOFI
 * binds a MISSION Strip to the same FDR too. Each holder retires its own on
 * its own schedule, so a sender-side Strip routinely outlives its usefulness
 * with nothing on screen saying another one exists. This feeds the indicator
 * that says so. Purely client-local — the snapshot already carries every
 * Facility's Strips, so no server support is needed.
 */
function otherLiveStripsForFdr(fdrId, exceptStripId) {
  if (!fdrId) return [];
  return getAllEfspStrips().filter(s => s.fdrId === fdrId && s.stripId !== exceptStripId && s.state !== 'DROPPED');
}

/** Live Strips whose FDR carries this callsign — the duplicate-origination check (§3.6). */
function liveStripsForCallsign(callsign) {
  const target = (callsign || '').trim().toUpperCase();
  if (!target) return [];
  return getAllEfspStrips().filter((s) => {
    if (s.state === 'DROPPED') return false;
    const fdr = getEfspFdr(s.fdrId);
    return !!(fdr && fdr.identity && (fdr.identity.callsign || '').toUpperCase() === target);
  });
}

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
  efspObligations.clear();
  efspCorrelations.clear();
  efspCorrelationStats = null;
  efspMarsa.clear();
  efspFieldStates.clear();
  efspConformance.clear();
  efspConflicts = [];
  efspBoardSeq = 0;
  efspFacility = null;
  efspBays = [];
  efspAitAuthorizedByFacility = {};
  efspPositionLetters = {};
}

/** Applies an efsp-alerts message: the complete current conformance, conflict and obligation picture. */
function applyEfspAlerts(msg) {
  efspConformance.clear();
  for (const r of (msg && msg.conformance) || []) if (r.alerts && r.alerts.length) efspConformance.set(r.fdrId, r.alerts);
  efspConflicts = (msg && msg.stca) || [];
  efspObligations.clear();
  for (const o of (msg && msg.obligations) || []) {
    if (!efspObligations.has(o.stripId)) efspObligations.set(o.stripId, []);
    efspObligations.get(o.stripId).push(o);
  }
}

/** What is wrong with this flight's conformance right now; [] when it conforms. */
function conformanceAlertsForFdr(fdrId) { return efspConformance.get(fdrId) || []; }

/** Every current short-term conflict. */
function getAllEfspConflicts() { return efspConflicts; }

/** The conflicts this track is in, each seen from its side: { other, otherCallsign, timeToCpaSec, minNm, vertFt, id }. */
function stcaConflictsForTrack(trackId) {
  if (trackId == null) return [];
  const id = String(trackId);
  return efspConflicts.filter(c => c.a === id || c.b === id).map(c => ({
    id: c.id,
    other: c.a === id ? c.b : c.a,
    otherCallsign: c.a === id ? c.bCallsign : c.aCallsign,
    timeToCpaSec: c.timeToCpaSec, minNm: c.minNm, vertFt: c.vertFt,
  }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    applyEfspSnapshot, applyEfspDelta, applyEfspMutationAck,
    registerPendingMutation, getPendingMutations, rebaseForResend,
    getEfspStrip, getEfspFdr, getEfspPosition, getAllEfspStrips, getAllEfspPositions,
    otherLiveStripsForFdr, liveStripsForCallsign,
    applyEfspAirspaceDelta, getEfspAirspace, getAllEfspAirspaces, stripsInAirspace,
    applyEfspCorrelationDelta, getEfspCorrelation, getAllEfspCorrelations,
    getEfspCorrelationForStrip, correlatedTrackIdForStrip, stripIdsForTrackId,
    getEfspCorrelationStats,
    applyEfspMarsaDelta, getEfspMarsa, getAllEfspMarsa,
    applyEfspAlerts, conformanceAlertsForFdr, getAllEfspConflicts, stcaConflictsForTrack,
    activeMarsaForFdr, marsaForStrip, marsaParticipantStripIds,
    getEfspRack, searchEfspStrips, getEfspBoardSeq, getEfspFacility, getEfspBays,
    isAitAuthorizedFor, getEfspPositionLetter,
    getEfspObligation, getEfspObligations,
    _resetEfspStateForTest,
    applyEfspFieldStateDelta, getEfspFieldState, getAllEfspFieldStates,
  };
}
