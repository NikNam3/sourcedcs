'use strict';

// The clock-driven half of the NLA inhibit status (guide §3.5 rule 2,
// docs/ui-findings/lane4.md F-408).
//
// efsp-ws.js stamps every Strip it puts on the wire with `nla` — what pressing
// that Strip's button would do right now, and the reason it would be refused
// when it would be. That covers every status change a MESSAGE causes: a
// Mutation, a resync, a controller taking or giving up a Position.
//
// It does not cover the ones the clock causes, and those are exactly the
// moments F-408 is about. A HELD Strip's release time passes; an EDCT window
// opens or closes; a call-for-release window expires; a void deadline is
// reached. Nothing touches that Strip, no message is exchanged, and the panel
// goes on showing advice that is now wrong — and wrong in the direction that
// matters, because the next thing that will happen to that Strip is somebody
// pressing the button it is lying about.
//
// So: a sweep. It recomputes every live Strip's status, compares it against
// what was last PUT ON THE WIRE for that Strip (efsp-ws.js reports each stamp
// through note(), so a status a request-driven path already sent is never sent
// twice), and emits only what moved. On a quiet Board it emits nothing at all,
// which is the point — an unconditional re-broadcast on a fixed interval would
// push a delta at every connected client forever.
//
// Cadence is server.js's, and it deliberately SHARES the 15s forwarding-
// obligation sweep rather than picking its own. Two reasons, and the second is
// the real one:
//
//   1. 15s is comfortably finer than anything it guards. Every deadline here
//      is minute-scale — the EDCT window is +/-5 min, call-for-release is
//      -2/+1 min, the void deadline is 30 min after the void time.
//   2. forwarding-obligations.js's VOID_TIME_EXPIRED alert and this module's
//      'void time expired' inhibit are two renderings of ONE fact. Running
//      them at different cadences would let the alert and the button disagree
//      for the difference between the two, which is the defect class this
//      whole subsystem exists to prevent (guide §4.8.3, "two answers to one
//      question"). They move together because they have to.
//
// Not folded into ForwardingObligationMonitor despite sharing its tick. Both
// now raise and clear in both directions (docs/adr/0067), but this one
// re-states Strips on the Board, while obligations are alert state that rides
// efsp-alerts — two outputs, two classes. After a Mutation this one's half
// rides the Mutation's own board delta; the obligation monitor is re-ticked
// by ws-hub.js's setOnEfspChange hook, so the two still move together.

const { WALL_CLOCK } = require('../mission-clock');

/** Stable identity for a status, for change detection only — never sent anywhere. */
function statusKey(status) {
  if (!status) return 'none';
  if (status.inhibited) return `no:${status.reason}:${status.inhibited}`;
  return `go:${status.toState}:${status.transferTo || ''}`;
}

class NlaStatusMonitor {
  /**
   * @param {{boardStoreFor:(facilityId:string)=>object, facilityConfig:object, onDelta?:(payload:object)=>void}} deps
   */
  constructor({ boardStoreFor, facilityConfig, onDelta, clock = WALL_CLOCK } = {}) {
    this._clock = clock; // the mission clock — every gate this re-states is a time of day (docs/adr/0079)
    this._boardStoreFor = boardStoreFor;
    this._facilityConfig = facilityConfig;
    this._onDelta = onDelta || (() => {});
    this._last = new Map(); // stripId -> statusKey, as last put on the wire
  }

  /** Wired after construction, the way board-store.js/marsa-store.js take their MutationLog — the store is built in index.js's composition root, and only server.js has the WsHub to broadcast through. */
  setOnDelta(onDelta) { this._onDelta = onDelta || (() => {}); }

  /**
   * efsp-ws.js calls this for every Strip it stamps, so this sweep knows what
   * each client has already been told. Without it, the first tick after any
   * Mutation would re-send a Strip whose ack and board-delta had just carried
   * the identical status.
   */
  note(stripId, status) {
    if (stripId) this._last.set(stripId, statusKey(status));
  }

  /**
   * @returns {Array<{facilityId:string, boardSeq:number, strips:object[]}>} one
   *   payload per Facility that had anything change — also passed to onDelta.
   *   Empty when nothing moved, which is the ordinary case.
   */
  tick(now = this._clock.now()) {
    const payloads = [];
    const live = new Set();

    for (const facilityId of this._facilityConfig.getFacilityIds()) {
      const boardStore = this._boardStoreFor(facilityId);
      if (!boardStore) continue;

      const changed = [];
      for (const strip of boardStore.getAll()) {
        if (strip.state === 'DROPPED') continue;
        live.add(strip.stripId);
        const status = boardStore.nlaStatusFor(strip, now);
        const key = statusKey(status);
        if (this._last.get(strip.stripId) === key) continue;
        this._last.set(strip.stripId, key);
        // Stamped exactly as efsp-ws.js stamps one, because this record goes
        // into the same `strips.updated` a client applies from any other
        // board-delta.
        changed.push({ ...strip, facilityId, nla: status });
      }
      if (changed.length) payloads.push({ facilityId, boardSeq: boardStore.currentSeq, strips: changed });
    }

    // A DROPPED or deleted Strip leaves the Board and takes its cache entry
    // with it — otherwise this Map is the one thing here that grows forever.
    for (const stripId of this._last.keys()) {
      if (!live.has(stripId)) this._last.delete(stripId);
    }

    for (const payload of payloads) this._onDelta(payload);
    return payloads;
  }
}

module.exports = { NlaStatusMonitor, statusKey };
