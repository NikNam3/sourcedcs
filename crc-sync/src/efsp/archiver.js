'use strict';

// Archiving finished flights (docs/adr/0082; decisions.md H36, S-R2-13).
//
// Nothing used to leave memory: a DROPPED Strip stayed in its Board's _strips
// forever, its flight data stayed in the FlightDataStore, and both went into every snapshot.
// L6's 4-hour soak measured it: the snapshot grew from 23 KB to 470 KB and a
// Mutation's p50 from 0.8 to 13 ms. The rules, exactly as S-R2-13 fixed them:
//
//   1. A Strip is archived when it is DROPPED and either 2 h of wall time have
//      passed since its drop or the mission session rolls over (F3, ADR 0086),
//      and L5's traffic count has its record.
//   2. The flight data is archived only if it had a Strip and every Strip that
//      referenced it is DROPPED or archived: it goes in the sweep that archives
//      its last Strip. The flight data that never had a Strip is never touched.
//   3. Mission change archives everything DROPPED and counted, whatever its age.
//   4. Nothing archived can be undone.
//
// "Archived" means gone from memory and from the snapshot. The Mutation log
// keeps the history, with one `Archive` line per Strip and one `ArchiveFlightData`
// line per flight data. There is no archive file.
//
// This module decides WHEN; BoardStore.archiveStrip (board-store.js, via board/persistence.js) and
// FlightDataStore.archiveFlightData do it. The caller persists and broadcasts what a sweep returns (app.js).

const log = require('../log').logger('efsp:archiver');
const { WALL_CLOCK } = require('../mission-clock');

/**
 * [SOURCE-DEFINED] (H36, docs/adr/0082) — two hours after a Strip is finished is
 * the human's decision, not tuning, so a constant rather than a config file.
 */
const ARCHIVE_AFTER_MS = 2 * 60 * 60 * 1000;

class Archiver {
  /**
   * @param {object} deps
   * @param {string[]} deps.facilityIds
   * @param {(facilityId:string) => object|null} deps.boardStoreFor
   * @param {object} deps.flightDataStore
   * @param {object} [deps.correlationStore]
   * @param {object} [deps.marsaStore]
   * @param {object} [deps.mutationLog]
   * @param {{now:()=>number}} deps.clock  the mission clock, for the audit lines' `at` (H11)
   * @param {() => number} [deps.wallNow]  the retention clock (a storage lifetime, like L5's rotation)
   * @param {number} [deps.retentionMs]
   * @param {((stripId:string) => boolean)|null} [deps.isCounted] null: no traffic count wired
   */
  constructor({ facilityIds, boardStoreFor, flightDataStore, correlationStore = null, marsaStore = null, mutationLog = null,
    clock, wallNow = WALL_CLOCK.now, retentionMs = ARCHIVE_AFTER_MS, isCounted = null }) {
    this._facilityIds = [...facilityIds];
    this._boardStoreFor = boardStoreFor;
    this._flightDataStore = flightDataStore;
    this._correlationStore = correlationStore;
    this._marsaStore = marsaStore;
    this._mutationLog = mutationLog;
    this._clock = clock;
    this._wallNow = wallNow;
    this._retentionMs = retentionMs;
    this._isCounted = isCounted;
    this._warnedNoCounter = false;
  }

  /** Wired by createEfspInstrumentation (metrics.js) to the traffic count (L5), which is built outside createEfsp and needs the facade this archiver belongs to. */
  setIsCounted(fn) { this._isCounted = fn; }

  /**
   * One pass over every Board.
   * @param {{all?:boolean, reason?:'AGE'|'MISSION_CHANGE', extra?:object}} [opts]
   *   all: archive every counted DROPPED Strip whatever its age (mission change)
   * @returns {{stripsByFacility:Object<string,string[]>, flightDataIds:string[], relations:number, correlations:number, skipped:string[]}}
   */
  sweep({ all = false, reason = 'AGE', extra = {} } = {}) {
    const result = { stripsByFacility: {}, flightDataIds: [], relations: 0, correlations: 0, skipped: [] };
    if (!this._isCounted && !this._warnedNoCounter) {
      this._warnedNoCounter = true;
      log.warn('no traffic count wired — archiving DROPPED Strips without checking they were counted');
    }
    const now = this._wallNow();
    const candidateFlightDataList = new Set();

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
          log.warn('DROPPED Strip has no traffic-count record — kept, retried next sweep', { stripId: strip.stripId, facilityId });
          continue;
        }
        const flightDataId = board.archiveStrip(strip.stripId, reason, extra);
        archived.push(strip.stripId);
        if (flightDataId) candidateFlightDataList.add(flightDataId);
      }
      if (archived.length) result.stripsByFacility[facilityId] = archived;
    }

    // Rule 2: the flight data goes only when no Strip on any Board — live, or DROPPED
    // and not archived yet — still references it (TOFI's shared flight data, T1).
    if (candidateFlightDataList.size) {
      const referenced = new Set();
      for (const facilityId of this._facilityIds) {
        const board = this._boardStoreFor(facilityId);
        if (!board) continue;
        for (const s of board.getAll()) referenced.add(s.flightDataId);
      }
      for (const flightDataId of candidateFlightDataList) {
        if (referenced.has(flightDataId)) continue;
        if (!this._flightDataStore.archiveFlightData(flightDataId)) continue;
        result.flightDataIds.push(flightDataId);
        if (this._mutationLog) {
          this._mutationLog.record({
            clientMutationId: null, op: 'ArchiveFlightData', flightDataId,
            actingPositionId: null, actorId: 'system', at: this._clock.now(), reason, ...extra,
          });
        }
      }
    }

    // What pointed at an archived flight data goes with it. Both only ran at restore
    // before (index.js _reconcileRestored).
    if (result.flightDataIds.length) {
      if (this._marsaStore) result.relations = this._marsaStore.evictMissingFlightDataList();
      if (this._correlationStore) result.correlations = this._correlationStore.evictMissingFlightDataList();
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
  return !!r && (Object.keys(r.stripsByFacility).length > 0 || r.flightDataIds.length > 0);
}

/**
 * The board-deltas that tell clients about a sweep: one per Facility whose
 * ring advanced, so every client's boardSeq stays continuous (T5), each
 * carrying the archived flight data ids — the FlightDataStore is shared across Facilities
 * and a client holds every flight data, whichever Facility it works. The archived
 * Strips were already DROPPED, so their `gone` is a no-op on a client that
 * saw the drop; it matters to one that missed it.
 * @returns {{facilityId:string, boardSeq:number, gone:string[], flightDataListGone:string[]}[]}
 */
function archiveDeltas(r, boardStoreFor) {
  if (!sweepChanged(r)) return [];
  const payloads = [];
  for (const [facilityId, gone] of Object.entries(r.stripsByFacility)) {
    const board = boardStoreFor(facilityId);
    if (!board) continue;
    payloads.push({ facilityId, boardSeq: board.currentSeq, gone, flightDataListGone: r.flightDataIds });
  }
  return payloads;
}

module.exports = { Archiver, ARCHIVE_AFTER_MS, sweepChanged, archiveDeltas };
