'use strict';
import { applyEfspCarrierSnapshot } from './carrier-state.js';
import { adoptCursor, boardCursorName, clearCursors, epochMoved, getCursor, replaceCursor, resyncPositionOf, storeCursorName, storeFrameGap } from './sync-cursor.js';
import { efspStrips, getAllEfspStrips } from './board-data.js';
import { _replaceAirspaces, _resetAirspaceState } from './airspace-state.js';
import { _replaceCorrelations, _resetCorrelationState } from './correlation-state.js';
import { _replaceMarsa, _resetMarsaState } from './marsa-state.js';
import { _replaceRunwayStatuses, _resetRunwayStatusState } from './runway-status-state.js';
import { _resetAlertsState } from './alerts-state.js';
import { setAirportSurfacePositions } from '../../airport-surface.js';
import { applyFrequencyDelta, getFrequencyRows, positionFrequenciesOf, replaceFrequencyRows, sfaPoolOf } from './frequency-state.js';

// The stores split out of this file (DESK-SPLIT) keep their public names here, so importers read them from one place.
export { efspStrips, getEfspStrip, getAllEfspStrips } from './board-data.js';
export { applyEfspMarsaDelta, getEfspMarsa, getAllEfspMarsa, activeMarsaForFlightData, marsaForStrip, marsaParticipantStripIds } from './marsa-state.js';
export { applyEfspRunwayStatusDelta, getEfspRunwayStatus, getAllEfspRunwayStatuses } from './runway-status-state.js';
export { applyEfspCorrelationDelta, getEfspCorrelation, getAllEfspCorrelations, getEfspCorrelationStats, getEfspCorrelationForStrip, correlatedTrackIdForStrip, stripIdsForTrackId } from './correlation-state.js';
export { efspAirspaces, efspAirspaceEdits, applyEfspAirspaceDelta, getEfspAirspaceEdits, getEfspAirspace, getAllEfspAirspaces, stripsInAirspace } from './airspace-state.js';
export { getEfspObligation, getEfspObligations, applyEfspAlerts, surveillanceHintsForStrip, conformanceAlertsForFlightData, tofiRegimeAlertForFlightData, getAllEfspConflicts, conflictAlertsForTrack, isConflictSuppressed, conflictTag, conflictName, refuelingAlertText, airspaceEntryAlertsForTrack, airspaceEntryAlertsForFlightData, airspaceEntryText, airspaceInsideForStrip, airspaceCoordinateForStrip } from './alerts-state.js';

// Client-side mirror of the EFSP Board — plain module-level Maps, matching
// app.js's existing style (tracks/history/settings are also plain globals,
// not a framework store). Owns the local copy of Strips/flight data/Positions,
// applying snapshot/delta/ack messages from crc-sync, and the pending-
// mutation tracker that lets an unacknowledged Mutation be replayed against
// a fresh baseline after reconnect (guide §5.6.3) instead of silently lost
// (the guide's own words: "the worst failure mode in the system").
//
// An ES module: the browser and node:test both import it directly, no build step.

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
// The Block writes a Position may make on a Strip it does not hold (crc-sync permission.js mayActBesideOwner), from the snapshot.
let efspNonOwnerBlockWrites = [];
let efspSelf = null; // { controllerId } from the snapshot and the resync snapshot (crc-sync docs/adr/0110): who "I" am in a Position's primary/observers

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
  efspNonOwnerBlockWrites = Array.isArray(msg.nonOwnerBlockWrites) ? msg.nonOwnerBlockWrites : [];
  setAirportSurfacePositions(msg.airportSurfacePositions); // who sees the airport surface, per Facility (H162)
  if (msg.self) efspSelf = msg.self;
  // A snapshot after a reconnect can carry edits made while this window was away: log them against what it last held.
  _replaceAirspaces(msg.airspaces);
  _replaceCorrelations(msg.correlations);
  _replaceMarsa(msg.marsa);
  _replaceRunwayStatuses(msg.runwayStatuses);
  replaceFrequencyRows(msg.frequencies); // crc-sync docs/adr/0131
  // crc-sync's docs/adr/0074 — the carrier's hull record (carrier-state.js).
  applyEfspCarrierSnapshot(msg);
  _adoptSnapshotStoreSyncs(msg);
}

// Store sync (crc-sync docs/adr/0106): the five stores outside the Board each count changes with a seq inside one
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
 * An efsp-frequency-delta (crc-sync docs/adr/0131): the Facility's frequency rows, and the two places the snapshot
 * carried those values, its Positions' `frequencies` and its SFA Bay's `sfaPool`, so every reader sees the new ones now.
 */
export function applyEfspFrequencyDelta(msg) {
  applyFrequencyDelta(msg);
  const facilityId = msg && msg.facilityId;
  if (!facilityId) return;
  const rows = getFrequencyRows(facilityId);
  const byPosition = positionFrequenciesOf(rows, facilityId);
  for (const [id, p] of efspPositions) {
    // A Position whose last added frequency was removed has none (crc-sync docs/adr/0138).
    if (p.facilityId === facilityId) efspPositions.set(id, { ...p, frequencies: byPosition[id] || [] });
  }
  const pool = sfaPoolOf(rows, facilityId);
  // The SFA Bay's Racks are the pool's, so a Rack added or removed at run time comes and goes with it (docs/adr/0138).
  const racksOf = (b) => [...(b.rackIds || []).filter(r => pool.some(p => p.rackId === r)), ...pool.map(p => p.rackId).filter(r => !(b.rackIds || []).includes(r))];
  if (pool) efspBays = efspBays.map(b => (b.view === 'sfa-freqs' && (!b.facilityId || b.facilityId === facilityId) ? { ...b, sfaPool: pool, rackIds: racksOf(b) } : b));
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

export function getEfspFlightData(flightDataId) { return efspFlightDataList.get(flightDataId) || null; }

export function getEfspPosition(positionId) { return efspPositions.get(positionId) || null; }
export function getEfspSelf() { return efspSelf; }

export function getAllEfspPositions() { return [...efspPositions.values()]; }

/** The Board epoch (lifetime) this client holds for a Facility, or undefined. */
export function getEfspBoardEpoch(facilityId) { const c = getCursor(boardCursorName(facilityId)); return c ? c.epoch : undefined; }

export function getEfspFacility() { return efspFacility; }

export function getEfspBays() { return efspBays; }

export function isAitAuthorizedFor(facilityId) { return !!efspAitAuthorizedByFacility[facilityId]; }

/** The snapshot's non-owner Block writes, `[{ blockId, stripType, positions }]`. */
export function getEfspNonOwnerBlockWrites() { return efspNonOwnerBlockWrites; }

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
 * callsign, beacon code or carrier side number (decisions.md H117/H122: the
 * carrier names an aircraft by it), case-insensitive substring. Excludes
 * DROPPED, same as getEfspRack.
 */
export function searchEfspStrips(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return getAllEfspStrips().filter((s) => {
    if (s.state === 'DROPPED') return false;
    const flightData = getEfspFlightData(s.flightDataId);
    const callsign = (flightData && flightData.identity && flightData.identity.callsign) || '';
    const beacon = (flightData && flightData.identity && flightData.identity.beaconAssigned) || '';
    const carrier = flightData && flightData.military && flightData.military.carrier;
    const side = String((carrier && carrier.sideNumber) || '');
    return callsign.toLowerCase().includes(q) || beacon.toLowerCase().includes(q) || side.toLowerCase().includes(q);
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
  _resetAlertsState();
  _resetCorrelationState();
  _resetMarsaState();
  _resetAirspaceState();
  _resetRunwayStatusState();
  replaceFrequencyRows([]);
  efspFacility = null;
  clearCursors();
  efspBays = [];
  efspAitAuthorizedByFacility = {};
  efspPositionLetters = {};
  efspNonOwnerBlockWrites = [];
  setAirportSurfacePositions({});
  efspSelf = null;
}
