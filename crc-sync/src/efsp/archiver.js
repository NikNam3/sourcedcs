'use strict';

// Archiving finished flights (docs/adr/0082; decisions.md H36, S-R2-13).
//
// Nothing used to leave memory: a DROPPED Strip stayed in its Board's _strips
// forever, its FDR stayed in the FdrStore, and both went into every snapshot.
// L6's 4-hour soak measured it: the snapshot grew from 23 KB to 470 KB and a
// Mutation's p50 from 0.8 to 13 ms. The rules, exactly as S-R2-13 fixed them:
//
//   1. A Strip is archived when it is DROPPED and either 2 h of wall time have
//      passed since its drop or the mission session rolls over (F3, ADR 0086),
//      and L5's traffic count has its record.
//   2. An FDR is archived only if it had a Strip and every Strip that
//      referenced it is DROPPED or archived: it goes in the sweep that archives
//      its last Strip. An FDR that never had a Strip is never touched.
//   3. Mission change archives everything DROPPED and counted, whatever its age.
//   4. Nothing archived can be undone.
//
// "Archived" means gone from memory and from the snapshot. The Mutation log
// keeps the history, with one `Archive` line per Strip and one `ArchiveFdr`
// line per FDR. There is no archive file.
//
// This module decides WHEN; BoardStore.archiveStrip and FdrStore.archiveFdr
// do it. The caller persists and broadcasts what a sweep returns (server.js).

/** H36: two hours. A decision, not tuning, so a constant rather than a config file. */
const ARCHIVE_AFTER_MS = 2 * 60 * 60 * 1000;

class Archiver {
  /**
   * @param {object} deps
   * @param {string[]} deps.facilityIds
   * @param {(facilityId:string) => object|null} deps.boardStoreFor
   * @param {object} deps.fdrStore
   * @param {object} [deps.correlationStore]
   * @param {object} [deps.marsaStore]
   * @param {object} [deps.mutationLog]
   * @param {{now:()=>number}} deps.clock  the mission clock, for the audit lines' `at` (H11)
   * @param {() => number} [deps.wallNow]  the retention clock (a storage lifetime, like L5's rotation)
   * @param {number} [deps.retentionMs]
   * @param {((stripId:string) => boolean)|null} [deps.isCounted] null: no traffic count wired
   */
  constructor({ facilityIds, boardStoreFor, fdrStore, correlationStore = null, marsaStore = null, mutationLog = null,
    clock, wallNow = () => Date.now(), retentionMs = ARCHIVE_AFTER_MS, isCounted = null }) {
    this._facilityIds = [...facilityIds];
    this._boardStoreFor = boardStoreFor;
    this._fdrStore = fdrStore;
    this._correlationStore = correlationStore;
    this._marsaStore = marsaStore;
    this._mutationLog = mutationLog;
    this._clock = clock;
    this._wallNow = wallNow;
    this._retentionMs = retentionMs;
    this._isCounted = isCounted;
    this._warnedNoCounter = false;
  }

  /** Wired by server.js to the traffic count (L5), which is built outside createEfsp. */
  setIsCounted(fn) { this._isCounted = fn; }

  /**
   * One pass over every Board.
   * @param {{all?:boolean, reason?:'AGE'|'MISSION_CHANGE', extra?:object}} [opts]
   *   all: archive every counted DROPPED Strip whatever its age (mission change)
   * @returns {{stripsByFacility:Object<string,string[]>, fdrIds:string[], relations:number, correlations:number, skipped:string[]}}
   */
  sweep({ all = false, reason = 'AGE', extra = {} } = {}) {
    const result = { stripsByFacility: {}, fdrIds: [], relations: 0, correlations: 0, skipped: [] };
    if (!this._isCounted && !this._warnedNoCounter) {
      this._warnedNoCounter = true;
      console.warn('[efsp-archiver] no traffic count wired — archiving DROPPED Strips without checking they were counted');
    }
    const now = this._wallNow();
    const candidateFdrs = new Set();

    for (const facilityId of this._facilityIds) {
      const board = this._boardStoreFor(facilityId);
      if (!board) continue;
      const archived = [];
      for (const strip of board.getAll()) {
        if (strip.state !== 'DROPPED') continue;
        const droppedAt = board.droppedWallAtOf(strip.stripId);
        if (!all && !(now - droppedAt >= this._retentionMs)) continue;
        // T3: never archive a drop the traffic count has no record of. A count
        // bug then shows as a Strip that stays, never as a silent loss.
        if (this._isCounted && !this._isCounted(strip.stripId)) {
          result.skipped.push(strip.stripId);
          console.warn(`[efsp-archiver] DROPPED Strip ${strip.stripId} at ${facilityId} has no traffic-count record — kept, retried next sweep`);
          continue;
        }
        const fdrId = board.archiveStrip(strip.stripId, reason, extra);
        archived.push(strip.stripId);
        if (fdrId) candidateFdrs.add(fdrId);
      }
      if (archived.length) result.stripsByFacility[facilityId] = archived;
    }

    // Rule 2: an FDR goes only when no Strip on any Board — live, or DROPPED
    // and not archived yet — still references it (TOFI's shared FDR, T1).
    if (candidateFdrs.size) {
      const referenced = new Set();
      for (const facilityId of this._facilityIds) {
        const board = this._boardStoreFor(facilityId);
        if (!board) continue;
        for (const s of board.getAll()) referenced.add(s.fdrId);
      }
      for (const fdrId of candidateFdrs) {
        if (referenced.has(fdrId)) continue;
        if (!this._fdrStore.archiveFdr(fdrId)) continue;
        result.fdrIds.push(fdrId);
        if (this._mutationLog) {
          this._mutationLog.record({
            clientMutationId: null, op: 'ArchiveFdr', fdrId,
            actingPositionId: null, actorId: 'system', at: this._clock.now(), reason, ...extra,
          });
        }
      }
    }

    // What pointed at an archived FDR goes with it. Both only ran at restore
    // before (index.js _reconcileRestored).
    if (result.fdrIds.length) {
      if (this._marsaStore) result.relations = this._marsaStore.evictMissingFdrs();
      if (this._correlationStore) result.correlations = this._correlationStore.evictMissingFdrs();
    }
    return result;
  }

  /**
   * F3's roll-over (missionSession.onNewSession): every counted DROPPED Strip
   * goes now, inside its Undo window too. Live Strips stay (ADR 0002).
   * @param {{seq?:number, reason?:string}} [session]
   */
  onMissionSessionChange(session = null) {
    const extra = session ? { missionSession: session.seq ?? null, sessionReason: session.reason ?? null } : {};
    return this.sweep({ all: true, reason: 'MISSION_CHANGE', extra });
  }
}

/** True when a sweep archived anything (the caller then persists and broadcasts). */
function sweepChanged(r) {
  return !!r && (Object.keys(r.stripsByFacility).length > 0 || r.fdrIds.length > 0);
}

/**
 * The board-deltas that tell clients about a sweep: one per Facility whose
 * ring advanced, so every client's boardSeq stays continuous (T5), each
 * carrying the archived FDR ids — the FdrStore is shared across Facilities
 * and a client holds every FDR, whichever Facility it works. The archived
 * Strips were already DROPPED, so their `gone` is a no-op on a client that
 * saw the drop; it matters to one that missed it.
 * @returns {{facilityId:string, boardSeq:number, gone:string[], fdrsGone:string[]}[]}
 */
function archiveDeltas(r, boardStoreFor) {
  if (!sweepChanged(r)) return [];
  const payloads = [];
  for (const [facilityId, gone] of Object.entries(r.stripsByFacility)) {
    const board = boardStoreFor(facilityId);
    if (!board) continue;
    payloads.push({ facilityId, boardSeq: board.currentSeq, gone, fdrsGone: r.fdrIds });
  }
  return payloads;
}

module.exports = { Archiver, ARCHIVE_AFTER_MS, sweepChanged, archiveDeltas };
