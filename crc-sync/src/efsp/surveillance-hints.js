'use strict';

// Surveillance informs; the controller advances (guide §10.3, §10.4;
// docs/adr/0076).
//
// Once per tick, for every Strip whose state expects the aircraft to be on the
// ground or in the air, this compares that expectation with the phase of the
// Strip's CORRELATED contact (airborne.js) and states two things:
//
//   AIRBORNE_ADVANCE  a DEPARTURE Strip still on the ground side whose contact
//                     has been detected airborne: the suggestion chip. The
//                     client offers one input; accepting it is the
//                     controller's own SetState.
//   STALE             any Strip whose state has contradicted its contact for
//                     longer than `staleness.afterSec`: a low-severity
//                     indication. Each episode is reported ONCE, through
//                     `onStaleness`, for L5's metric 6.
//
// NOTHING HERE MOVES A STRIP, and nothing could: the monitor is handed
// read-only views (boardStoreFor's getAll, the correlation store's read) and
// never a BoardStore it could mutate — the same ring fence as
// correlation-reconciler.js (docs/adr/0047). The output is a slice of
// `efsp-alerts`, which is state a client renders, never a Mutation.
//
// Only a CORRELATED record counts. A provisional match is a guess, and a hint
// built on a guess is how auto-advance confusion comes back.

const { instantPhase, debouncedPhase, PHASES } = require('./airborne');
const { WALL_CLOCK } = require('../mission-clock');

// What a Strip's State says about where the aircraft is. A state not listed
// expects nothing: pre-movement states have no aircraft yet (and correlation
// already counts them ineligible), and a test forces every nla.js state to be
// either here or in UNEXPECTING.
const EXPECTS = Object.freeze({
  DEPARTURE: Object.freeze({
    PUSHBACK: PHASES.ON_GROUND, TAXI: PHASES.ON_GROUND, RUNWAY_QUEUE: PHASES.ON_GROUND, LUAW: PHASES.ON_GROUND,
    DEPARTED: PHASES.AIRBORNE, HANDED_OFF: PHASES.AIRBORNE,
  }),
  ARRIVAL: Object.freeze({
    INBOUND: PHASES.AIRBORNE, HANDED_TO_TOWER: PHASES.AIRBORNE, FINAL: PHASES.AIRBORNE,
    LANDED: PHASES.ON_GROUND, TAXI_IN: PHASES.ON_GROUND,
  }),
  MISSION: Object.freeze({
    AIRBORNE: PHASES.AIRBORNE, ON_STATION: PHASES.AIRBORNE, OFF_STATION: PHASES.AIRBORNE, RTB: PHASES.AIRBORNE,
  }),
  OVERFLIGHT: Object.freeze({ INBOUND: PHASES.AIRBORNE, IN_SECTOR: PHASES.AIRBORNE, HANDED_OFF: PHASES.AIRBORNE }),
});

// States that deliberately expect nothing.
const UNEXPECTING = Object.freeze({
  DEPARTURE: Object.freeze(['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'DROPPED']),
  ARRIVAL: Object.freeze(['DROPPED']),
  MISSION: Object.freeze(['TASKED', 'DROPPED']),
  OVERFLIGHT: Object.freeze(['DROPPED']),
  // The carrier Roles (docs/adr/0074) expect nothing yet: "airborne" is judged against the nearest
  // airfield's elevation and footprint, which means nothing for a moving deck. Integration default
  // (S-M-L19); building a ship-relative phase is a supervisor decision.
  MARSHAL: Object.freeze(['LAUNCH', 'IN_STACK', 'COMMENCED', 'DROPPED']),
  FINAL: Object.freeze(['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF', 'DROPPED']),
  PATTERN: Object.freeze(['IN_PATTERN', 'RECOVERED', 'DROPPED']),
});

// The state an observed-airborne DEPARTURE Strip is offered.
const ADVANCE_TO = Object.freeze({ DEPARTURE: 'DEPARTED' });

class SurveillanceHintMonitor {
  /**
   * @param {object} deps
   * @param {{get:(id)=>object|null}} deps.trackStore
   * @param {{correlatedTrackId:(fdrId:string)=>string|null}} deps.correlationStore
   * @param {(facilityId:string)=>{getAll:()=>object[]}|null} deps.boardStoreFor
   * @param {{getFacilityIds:()=>string[]}} deps.facilityConfig
   * @param {()=>object|null} deps.getMissionData
   * @param {{airborne:object, staleness:object}} deps.config  surveillance-hints-config.js
   * @param {object} [deps.clock]  the mission clock (docs/adr/0079)
   * @param {(episode:object)=>void} [deps.onStaleness]
   */
  constructor(deps) {
    this._d = deps;
    this._clock = deps.clock || WALL_CLOCK;
    this._cfg = deps.config;
    this._onStaleness = deps.onStaleness || (() => {});
    this._mem = new Map();   // stripId -> { phase: {instant, since}, episode }
    this._hints = new Map(); // stripId -> hint
    this._signature = '';
  }

  /** Every hint standing right now. */
  getAll() { return [...this._hints.values()]; }

  /** Runs one pass. @returns {boolean} true when the hints changed. */
  tick(now = this._clock.now()) {
    const d = this._d;
    const missionData = d.getMissionData ? d.getMissionData() : null;
    const seen = new Set();
    const hints = new Map();

    for (const facilityId of d.facilityConfig.getFacilityIds()) {
      const board = d.boardStoreFor(facilityId);
      if (!board) continue;
      for (const strip of board.getAll()) {
        const expected = (EXPECTS[strip.role] || {})[strip.state];
        if (!expected) continue;
        seen.add(strip.stripId);
        const mem = this._mem.get(strip.stripId) || { phase: { instant: null, since: now }, episode: null };
        this._mem.set(strip.stripId, mem);

        const trackId = d.correlationStore.correlatedTrackId(strip.fdrId);
        const track = trackId ? d.trackStore.get(trackId) : null;
        const observed = track
          ? debouncedPhase(mem.phase, instantPhase(track, missionData, this._cfg.airborne), now, this._cfg.airborne).phase
          : PHASES.UNKNOWN;
        if (!track) { mem.phase.instant = null; }

        const contradicts = observed !== PHASES.UNKNOWN && observed !== expected;
        if (!contradicts) { mem.episode = null; continue; }

        if (!mem.episode || mem.episode.stripState !== strip.state || mem.episode.observed !== observed) {
          mem.episode = { stripState: strip.state, observed, since: now, logged: false };
        }
        const base = {
          stripId: strip.stripId, fdrId: strip.fdrId, facilityId, positionId: strip.ownerPositionId,
          stripState: strip.state, contactPhase: observed, trackId, since: mem.episode.since,
        };

        // The chip: only the airborne direction, only a DEPARTURE.
        if (observed === PHASES.AIRBORNE && ADVANCE_TO[strip.role]) {
          hints.set(`${strip.stripId}|chip`, { ...base, kind: 'AIRBORNE_ADVANCE', toState: ADVANCE_TO[strip.role] });
        }

        const durationMs = now - mem.episode.since;
        if (durationMs >= this._cfg.staleness.afterSec * 1000) {
          hints.set(`${strip.stripId}|stale`, { ...base, kind: 'STALE', afterSec: this._cfg.staleness.afterSec });
          if (!mem.episode.logged) {
            mem.episode.logged = true;
            try {
              this._onStaleness({ at: now, facilityId, positionId: strip.ownerPositionId, stripId: strip.stripId, fdrId: strip.fdrId, stripState: strip.state, trackState: observed, durationMs });
            } catch (e) {
              console.error('[efsp-surveillance-hints] staleness log failed:', e);
            }
          }
        }
      }
    }

    for (const id of [...this._mem.keys()]) if (!seen.has(id)) this._mem.delete(id);

    const signature = [...hints.entries()].map(([k, h]) => `${k}/${h.stripState}/${h.contactPhase}/${h.since}`).sort().join(';');
    this._hints = hints;
    const changed = signature !== this._signature;
    this._signature = signature;
    return changed;
  }
}

module.exports = { SurveillanceHintMonitor, EXPECTS, UNEXPECTING, };
