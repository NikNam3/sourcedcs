'use strict';
import { applyEfspCarrierSnapshot } from './carrier-state.js';
import { applyEfspSfaSnapshot } from './sfa-state.js';
import { diffDefinitions } from './airspace-validate.js';
import {
  adoptCursor, boardCursorName, clearCursors, epochMoved, getCursor, replaceCursor, resyncPositionOf, storeCursorName, storeFrameGap
} from './sync-cursor.js';

// Client-side mirror of the EFSP Board — plain module-level Maps, matching
// app.js's existing style (tracks/history/settings are also plain globals,
// not a framework store). Owns the local copy of Strips/flight data/Positions,
// applying snapshot/delta/ack messages from crc-sync, and the pending-
// mutation tracker that lets an unacknowledged Mutation be replayed against
// a fresh baseline after reconnect (guide §5.6.3) instead of silently lost
// (the guide's own words: "the worst failure mode in the system").
//
// An ES module: the browser and node:test both import it directly, no build step.

export const efspStrips = new Map();     // stripId -> Strip
export const efspFlightDataList = new Map();       // flightDataId -> FlightDataRecord
const efspPositions = new Map();  // positionId -> PositionStaffing
let efspFacility = null;
// Board sync position, per Facility (docs/adr/0081): the cursor `board:<facilityId>` in sync-cursor.js, the same
// bookkeeping the stores use.
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
// clientMutationId -> when it was sent (this client's wall clock), for the CreateStrip resend window below.
const efspPendingSentAt = new Map();

// How long after its send a pending CreateStrip may still be re-sent after a reconnect. A CreateStrip has no Strip
// to rebase against, so a resend is safe only while crc-sync can still answer its clientMutationId from the replay
// cache. A running crc-sync keeps the last 5000 cmids, but across a RESTART only the last
// REPLAY_PERSIST_WINDOW_MS (10 min, crc-sync/src/efsp/sync/replay-cache.js) survive in the Board snapshot. The
// send precedes the apply, so a send younger than the window is always inside it; one minute of margin. Older
// than this, the form hears CONNECTION_LOST and the controller checks the Board: re-sending could create the Strip
// twice. tests/create-strip-resend-window.test.mjs keeps it under the server's window.
export const CREATE_STRIP_RESEND_WINDOW_MS = 9 * 60 * 1000;

// §4.6.1's timed forwarding obligations (docs/adr/0021, 0067) — stripId ->
// every obligation due on it right now. Full state from efsp-alerts, like
// conformance: one that is no longer due is simply not in the next message.
const efspObligations = new Map(); // stripId -> [{ facilityId, stripId, obligationType, severity, dueAt, since }]

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
const efspRunwayStatuses = new Map(); // facilityId -> runway-status record (crc-sync docs/adr/0061)

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

export function applyEfspSnapshot(msg) {
  efspStrips.clear();
  efspFlightDataList.clear();
  efspPositions.clear();
  for (const s of msg.strips || []) efspStrips.set(s.stripId, s);
  for (const f of msg.flightDataList || []) efspFlightDataList.set(f.flightDataId, f);
  for (const p of msg.positions || []) efspPositions.set(p.positionId, p);
  efspFacility = (msg.facilities || [])[0] || null; // the default Facility comes first (crc-sync docs/adr/0104)
  clearCursors(); // a snapshot replaces every position, the Boards' and the stores' (named below)
  for (const [f, seq] of Object.entries(msg.boardSeqByFacility || {})) adoptCursor(boardCursorName(f), { seq });
  for (const [f, epoch] of Object.entries(msg.boardEpochByFacility || {})) adoptCursor(boardCursorName(f), { epoch });
  efspBays = msg.bays || [];
  efspAitAuthorizedByFacility = msg.aitAuthorizedByFacility || {};
  efspPositionLetters = msg.positionLetters || {};
  // A snapshot after a reconnect can carry edits made while this window was away: log them against what it last held.
  _replaceAirspaces(msg.airspaces);
  _replaceCorrelations(msg.correlations);
  _replaceMarsa(msg.marsa);
  _replaceRunwayStatuses(msg.runwayStatuses);
  // crc-sync's docs/adr/0074 — the carrier's hull record (carrier-state.js).
  applyEfspCarrierSnapshot(msg);
  // crc-sync's docs/adr/0093 — who is on which SFA frequency (sfa-state.js).
  applyEfspSfaSnapshot(msg);
  _adoptSnapshotStoreSyncs(msg);
}

function _replaceAirspaces(list) {
  const held = new Map(efspAirspaces);
  efspAirspaces.clear();
  for (const a of list || []) {
    _noteAirspaceEdit(held.get(a.airspaceId), a);
    efspAirspaces.set(a.airspaceId, a);
  }
  for (const id of [...efspAirspaceEdits.keys()]) if (!efspAirspaces.has(id)) efspAirspaceEdits.delete(id);
}
function _replaceCorrelations(list) {
  efspCorrelations.clear();
  for (const r of list || []) efspCorrelations.set(r.flightDataId, r);
}
function _replaceMarsa(list) {
  efspMarsa.clear();
  for (const r of list || []) efspMarsa.set(r.marsaId, r);
}
function _replaceRunwayStatuses(list) {
  efspRunwayStatuses.clear();
  for (const r of list || []) efspRunwayStatuses.set(r.facilityId, r);
}

// Store sync (crc-sync docs/adr/0106): the six stores outside the Board each count changes with a seq inside one
// lifetime (epoch), exactly as a Board does, and are cursors `store:<key>` in sync-cursor.js. `key` is the snapshot
// key (also the heartbeat's and the resync's); `gapFromDeltas` is the server's declaration that a delta moves seq by
// exactly one change (stores.js `sync`), so a jump from deltas alone is a lost delta; the others are caught by the
// heartbeat. `replace` swaps that store's whole client state for a slice (what the full snapshot carries under `key`).
// The family's panel registers how it redraws after that (efsp-message-registry.js `registerEfspStoreRedraw`).
export const STORE_SYNC = [
  { key: 'airspaces', seqKey: 'airspaceSeq', epochKey: 'airspaceEpoch', gapFromDeltas: true, replace: _replaceAirspaces },
  { key: 'correlations', seqKey: 'correlationSeq', epochKey: 'correlationEpoch', gapFromDeltas: false, replace: _replaceCorrelations },
  { key: 'marsa', seqKey: 'marsaSeq', epochKey: 'marsaEpoch', gapFromDeltas: false, replace: _replaceMarsa },
  { key: 'runwayStatuses', seqKey: 'runwayStatusSeq', epochKey: 'runwayStatusEpoch', gapFromDeltas: true, replace: _replaceRunwayStatuses },
  { key: 'carriers', seqKey: 'carrierSeq', epochKey: 'carrierEpoch', gapFromDeltas: false, replace: (l) => applyEfspCarrierSnapshot({ carriers: l }) },
  { key: 'sfaRotation', seqKey: 'sfaSeq', epochKey: 'sfaEpoch', gapFromDeltas: true, replace: (v) => applyEfspSfaSnapshot({ sfaRotation: v }) },
];

function _adoptSnapshotStoreSyncs(msg) {
  for (const { key } of STORE_SYNC) {
    const seq = (msg.storeSeqs || {})[key];
    const epoch = (msg.storeEpochs || {})[key];
    if (Number.isFinite(seq) && epoch !== undefined) adoptCursor(storeCursorName(key), { seq, epoch });
  }
}

/** Where this client stands in one store: `{ seq, epoch }`, or null before a snapshot named it. */
export function getEfspStoreSync(key) { return getCursor(storeCursorName(key)); }

/**
 * Every cursor a frame contradicts, by name (`board:<facilityId>`, `store:<key>`): a delta or ack from another Board
 * lifetime or another store lifetime, or a store delta that skipped a seq. Ask BEFORE applying it. A store position
 * is adopted here when the frame is the next one (see `storeFrameGap`); a Board's is adopted by the delta/ack itself.
 * @returns {string[]} the cursor names to resync
 */
export function efspFrameGapsOf(msg) {
  const out = [];
  const board = efspEpochChangeOf(msg);
  if (board) out.push(boardCursorName(board));
  for (const d of STORE_SYNC) {
    if (storeFrameGap(storeCursorName(d.key), { seq: msg[d.seqKey], epoch: msg[d.epochKey], gapFromDeltas: d.gapFromDeltas })) out.push(storeCursorName(d.key));
  }
  return out;
}

/**
 * An efsp-resync-reply's `stores: { [key]: { seq, epoch, slice } }`: each named store's client state is replaced by its
 * slice and its position adopted. Returns the keys replaced, for the caller to redraw.
 */
export function applyEfspStoreSlices(stores) {
  const done = [];
  for (const d of STORE_SYNC) {
    const r = stores && stores[d.key];
    if (!r || !Number.isFinite(r.seq)) continue;
    d.replace(r.slice);
    replaceCursor(storeCursorName(d.key), { seq: r.seq, epoch: r.epoch });
    done.push(d.key);
  }
  return done;
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

function _boardFacilityOf(msg) { return msg.facilityId || efspFacility || null; }

function _adoptBoardSeq(msg) {
  if (!Number.isFinite(msg.boardSeq)) return;
  const facilityId = _boardFacilityOf(msg);
  if (!facilityId || epochMoved(boardCursorName(facilityId), msg.boardEpoch)) return;
  adoptCursor(boardCursorName(facilityId), { seq: msg.boardSeq, epoch: msg.boardEpoch });
}

/** The Facility whose Board lifetime a delta/ack contradicts (the server restarted or restored: our seq names a Board that no longer exists), or null. Ask BEFORE applying it. */
export function efspEpochChangeOf(msg) {
  const facilityId = _boardFacilityOf(msg);
  return facilityId && epochMoved(boardCursorName(facilityId), msg.boardEpoch) ? facilityId : null;
}

/** What an efsp-resync for this Facility must say: where we are. null when we hold no Board for it. */
export function efspResyncPositionFor(facilityId) { return resyncPositionOf(boardCursorName(facilityId)); }

export function applyEfspDelta(msg) {
  for (const s of (msg.strips && msg.strips.updated) || []) efspStrips.set(s.stripId, s);
  for (const id of (msg.strips && msg.strips.gone) || []) efspStrips.delete(id);
  for (const f of (msg.flightDataList && msg.flightDataList.updated) || []) efspFlightDataList.set(f.flightDataId, f);
  for (const id of (msg.flightDataList && msg.flightDataList.gone) || []) efspFlightDataList.delete(id); // archived (docs/adr/0082)
  for (const p of (msg.positions && msg.positions.updated) || []) efspPositions.set(p.positionId, p);
  _adoptBoardSeq(msg);
}

/**
 * Applies an efsp-mutation-ack. The server includes the current Strip/flight data
 * on BOTH success and rejection (the Board always returns the
 * authoritative current state) — apply it either way, so a rejected
 * optimistic edit snaps back to server truth rather than lingering.
 *
 * `pending` is the original efsp-mutation message this ack answers, handed
 * back rather than just dropped. An ack says only "no, STALE_REV" — which
 * Strip and which typed value it refused live in the request, and nowhere
 * else (docs/ui-findings F-103/F-207: "a refusal does not say which Strip it
 * was about"). The entry is still deleted here exactly as before; the caller
 * gets the last look at it.
 * @returns {{wasPending:boolean, pending:?object, ok:boolean, reason?:string, detail?:string, warnings:object[], attestation?:{with:string, needs:string[]}}}
 */
export function applyEfspMutationAck(msg) {
  const pending = efspPendingMutations.get(msg.clientMutationId) || null;
  efspPendingMutations.delete(msg.clientMutationId);
  efspPendingSentAt.delete(msg.clientMutationId);
  if (msg.strip) efspStrips.set(msg.strip.stripId, msg.strip);
  if (msg.flightData) efspFlightDataList.set(msg.flightData.flightDataId, msg.flightData);
  // The ack's boardSeq is deliberately NOT adopted: its broadcast delta (same
  // seq) is what moves our position, so a delta lost after its ack still shows
  // up as a gap at the next heartbeat (docs/adr/0081). A refusal or a replay has
  // no delta at all and changes nothing.
  return { wasPending: !!pending, pending, ok: !!msg.ok, reason: msg.reason, detail: msg.detail, warnings: msg.warnings || [], attestation: msg.attestation };
}

/** Registers a just-sent efsp-mutation message as pending its ack. */
export function registerPendingMutation(msg, sentAt = Date.now()) {
  efspPendingMutations.set(msg.clientMutationId, msg);
  efspPendingSentAt.set(msg.clientMutationId, sentAt);
}

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

export function getPendingMutations() {
  return [...efspPendingMutations.values()];
}

/**
 * Rebuilds a pending mutation's baseRev against the CURRENT local Strip
 * (post-reconnect, after a fresh snapshot/delta has landed) — the concrete
 * "rebase" step of §5.6.3's replay. Returns null for an unknown id, or if
 * the target Strip no longer exists locally at all (caller should surface that distinctly,
 * not silently drop the mutation).
 */
export function rebaseForResend(clientMutationId, now = Date.now()) {
  const original = efspPendingMutations.get(clientMutationId);
  if (!original) return null;
  // A CreateStrip has no target Strip and no baseRev, so there is nothing to rebase: it is re-sent as it was, with the
  // same clientMutationId. That is safe only while crc-sync's replay cache still holds that cmid: it answers one it
  // already applied with the original outcome (`replayed: true`) and applies one it never saw fresh, so a lost ack
  // neither duplicates the Strip nor loses it (BoardStore.applyMutation, docs/adr/0081). Past
  // CREATE_STRIP_RESEND_WINDOW_MS a restart may have dropped the cmid, so it is not re-sent (null: the caller's
  // orphan path answers CONNECTION_LOST).
  if (!original.stripId) {
    const sentAt = efspPendingSentAt.get(clientMutationId);
    return sentAt !== undefined && now - sentAt < CREATE_STRIP_RESEND_WINDOW_MS ? { ...original } : null;
  }
  const current = efspStrips.get(original.stripId);
  if (!current) return null;
  return { ...original, baseRev: current.rev };
}

export function getEfspStrip(stripId) { return efspStrips.get(stripId) || null; }
export function getEfspFlightData(flightDataId) { return efspFlightDataList.get(flightDataId) || null; }
export function getEfspPosition(positionId) { return efspPositions.get(positionId) || null; }
export function getAllEfspStrips() { return [...efspStrips.values()]; }
export function getAllEfspPositions() { return [...efspPositions.values()]; }
/** The Board epoch (lifetime) this client holds for a Facility, or undefined. */
export function getEfspBoardEpoch(facilityId) { const c = getCursor(boardCursorName(facilityId)); return c ? c.epoch : undefined; }
export function getEfspFacility() { return efspFacility; }
export function getEfspBays() { return efspBays; }
export function isAitAuthorizedFor(facilityId) { return !!efspAitAuthorizedByFacility[facilityId]; }

/** The ATC-scope letter for a Position (docs/adr/0088), searched across Facilities; null when none is configured. */
export function getEfspPositionLetter(positionId) {
  for (const letters of Object.values(efspPositionLetters)) {
    if (letters && Object.prototype.hasOwnProperty.call(letters, positionId)) return letters[positionId];
  }
  return null;
}

/**
 * Other live Strips sharing this flight data, excluding one by id.
 *
 * One flight legitimately has several Strips: every cross-Facility exchange
 * mints a replica rather than moving the original (guide §4.6), and TOFI
 * binds a MISSION Strip to the same flight data too. Each holder retires its own on
 * its own schedule, so a sender-side Strip routinely outlives its usefulness
 * with nothing on screen saying another one exists. This feeds the indicator
 * that says so. Purely client-local — the snapshot already carries every
 * Facility's Strips, so no server support is needed.
 */
export function otherLiveStripsForFlightData(flightDataId, exceptStripId) {
  if (!flightDataId) return [];
  return getAllEfspStrips().filter(s => s.flightDataId === flightDataId && s.stripId !== exceptStripId && s.state !== 'DROPPED');
}

/** Live Strips whose flight data carries this callsign — the duplicate-origination check (§3.6). */
export function liveStripsForCallsign(callsign) {
  const target = (callsign || '').trim().toUpperCase();
  if (!target) return [];
  return getAllEfspStrips().filter((s) => {
    if (s.state === 'DROPPED') return false;
    const flightData = getEfspFlightData(s.flightDataId);
    return !!(flightData && flightData.identity && (flightData.identity.callsign || '').toUpperCase() === target);
  });
}

/** Strips currently placed in a Bay/Rack, in order, excluding DROPPED — mirrors crc-sync's board-store.js getRack() exactly. */
export function getEfspRack(bayId, rackId) {
  return getAllEfspStrips()
    .filter(s => s.bayId === bayId && s.rackId === rackId && s.state !== 'DROPPED')
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : (a.stripId < b.stripId ? -1 : 1)));
}

/**
 * Client-local search (guide §4.3 rule 2, defect D2 — "the longest
 * ground-control dwells occurred searching the Pending bay"). Deliberately
 * NOT a server concept: search results are a second VIEW onto the same
 * live Strip objects, still in their real Bay/Rack (no re-parenting) —
 * matches efsp-panel.js's existing precedent that "which Bay is
 * in view" is per-controller local state, not Board state. Matches
 * callsign or beacon code, case-insensitive substring. Excludes DROPPED,
 * same as getEfspRack.
 */
export function searchEfspStrips(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return getAllEfspStrips().filter((s) => {
    if (s.state === 'DROPPED') return false;
    const flightData = getEfspFlightData(s.flightDataId);
    const callsign = (flightData && flightData.identity && flightData.identity.callsign) || '';
    const beacon = (flightData && flightData.identity && flightData.identity.beaconAssigned) || '';
    return callsign.toLowerCase().includes(q) || beacon.toLowerCase().includes(q);
  });
}

// UI-A (S-L23 finding): a controller holding TAC_C2 and not AIC/JTAC cannot see the lines TAC_C2 has
// handed down, so cannot answer CTR's TOFI exit on one (the server lets TAC_C2 answer for AIC,
// ADR 0080; the panel had nowhere to show the line). The Position tab gets one client-local
// pseudo-Bay, "WITH AIC/JTAC", listing those lines. Like the search Bay it is not Board state and
// not a destination: nothing can be dropped on it.
export const LINES_WITH_OTHERS = { TAC_C2: ['AIC', 'JTAC'] };

export function withOthersBayId(positionId) { return `${positionId}-with`; }
export function isWithOthersBayId(bayId) { return typeof bayId === 'string' && bayId.endsWith('-with'); }

/** Live MISSION lines held by the Positions `positionId` has handed lines to, newest first. */
export function efspLinesWithOthers(positionId) {
  const owners = LINES_WITH_OTHERS[positionId];
  if (!owners) return [];
  return getAllEfspStrips()
    .filter(s => s.stripType === 'MISSION' && s.state !== 'DROPPED' && owners.includes(s.ownerPositionId))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Test-only reset — this module holds top-level mutable state (matching
// app.js's own plain-globals style), so tests need a way to isolate runs.
export function _resetEfspStateForTest() {
  efspStrips.clear();
  efspFlightDataList.clear();
  efspPositions.clear();
  efspPendingMutations.clear();
  efspPendingSentAt.clear();
  efspObligations.clear();
  efspSurveillanceHints.clear();
  efspCorrelations.clear();
  efspCorrelationStats = null;
  efspMarsa.clear();
  efspAirspaces.clear();
  efspAirspaceEdits.clear();
  efspRunwayStatuses.clear();
  efspConformance.clear();
  efspTofiRegime.clear();
  efspConflicts = [];
  efspFacility = null;
  clearCursors();
  efspBays = [];
  efspAitAuthorizedByFacility = {};
  efspPositionLetters = {};
}

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
