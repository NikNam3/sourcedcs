'use strict';

// The mission reset (docs/adr/0108, decisions.md H108): a real mission roll-over (mission-session.js decides) ends everything
// that belonged to the old mission. Every live Strip goes to DROPPED, one audited system pass per Board (board-store.js
// resetForMission), and each per-mission store goes back to its start: runway works, suspensions and changes, the carrier's Case,
// stacks and ship inputs, MARSA relations, the SFA rotation, correlation records. Strip-level state (ALERT and SCRAMBLE flags,
// coordination and TOFI links, comms and control) is on the Strips and ends with them.
//
// Not cleared: configuration (Facility config, airspace definitions and the registry, stereo routes, theaters, apt-config), the
// Mutation log (it gains the reset), the metrics and the traffic count (they read the reset's drops), Position staffing.
//
// This function only changes the stores and builds the frames; the caller persists, delivers and then runs the archiver's
// roll-over sweep, which files the dropped Strips and their flight data (app.js).

const { boardDelta, touchedStrips, runwayStatusDelta, carrierDelta, marsaDelta, sfaDelta, correlationDelta } = require('./wire/frames');

/**
 * @param {object} ctx the facade's context (efsp/index.js): the stores and boardStoreFor
 * @param {string[]} facilityIds
 * @param {{seq?:number, reason?:string}|null} [session]
 * @returns {{frames: object[], summary: object}}
 */
function resetForMission(ctx, facilityIds, session = null) {
  const frames = [];
  const summary = { strips: 0, flightDataList: 0, boards: {}, runwayStatusFacilities: [], carrierHulls: [], marsaEnded: 0, sfaRotation: false, correlations: 0 };
  const stores = { runway: ctx.runwayStatusStore, carrier: ctx.carrierStore, marsa: ctx.marsaStore, sfa: ctx.sfaStore, correlation: ctx.correlationStore };
  const seq0 = Object.fromEntries(Object.entries(stores).map(([k, s]) => [k, s ? s.currentSeq : null]));
  const moved = (k) => !!stores[k] && stores[k].currentSeq !== seq0[k];

  const touchedBoards = [];
  for (const facilityId of facilityIds) {
    const boardStore = ctx.boardStoreFor(facilityId);
    if (!boardStore) continue;
    boardStore.drainTouched(); // anything left over from before is not part of this event
    const r = boardStore.resetForMission({ session });
    if (!r.dropped.length) continue;
    summary.strips += r.dropped.length;
    summary.boards[facilityId] = r.dropped.length;
    summary.flightDataList += r.flightDataIds.length;
    touchedBoards.push({ facilityId, boardStore });
  }
  // The Strips each Board touched, peers included (a link that ended on a Strip the reset did not name is in the same delta).
  for (const { facilityId, boardStore } of touchedBoards) {
    const strips = touchedStrips(ctx, boardStore, facilityId, boardStore.drainTouched(), null);
    frames.push(boardDelta(ctx, boardStore, facilityId, strips, []));
  }

  if (stores.marsa) summary.marsaEnded = stores.marsa.resetForMission().length;
  if (stores.carrier) summary.carrierHulls = stores.carrier.resetForMission();
  if (stores.runway) summary.runwayStatusFacilities = stores.runway.resetForMission();
  if (stores.sfa) summary.sfaRotation = stores.sfa.resetForMission();
  if (stores.correlation) summary.correlations = stores.correlation.forgetAll();

  // One frame per store whose sequence moved, whoever moved it (the retirements above move MARSA and the carrier too).
  if (moved('marsa')) frames.push(marsaDelta(stores.marsa, stores.marsa.getAll()));
  if (moved('carrier')) frames.push(carrierDelta(stores.carrier));
  if (moved('runway')) frames.push(runwayStatusDelta(stores.runway, stores.runway.getAll()));
  if (moved('sfa')) frames.push(sfaDelta(stores.sfa));
  if (moved('correlation')) frames.push(correlationDelta(stores.correlation, []));
  return { frames, summary };
}

module.exports = { resetForMission };
