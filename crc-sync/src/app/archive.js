'use strict';

// Archiving finished flights (H36, docs/adr/0082): a DROPPED Strip leaves memory and the Board snapshot 12 h after its drop, or at
// the next mission session (F3), once the traffic count has it; its Flight data goes with its last Strip. The Mutation log keeps
// the history. Archiving a Board's Strips is a Board change nobody asked for, so it is persisted and delivered like one.

const { archiveDeltas } = require('../efsp/archiver');
const { serverBoardDelta } = require('../efsp/wire/frames');
const log = require('../log').logger('efsp:archiver');

/**
 * @param {{efsp: object, deliver: (frames: object[]) => void}} deps
 * @returns {(result: object) => (number|undefined)} the archiver's sweep result in, the count of Strips archived out
 */
function createArchiveSweep({ efsp, deliver }) {
  return function archive(r) {
    const payloads = archiveDeltas(r, efsp.boardStoreFor);
    if (!payloads.length) return undefined;
    efsp.persist();
    deliver(payloads.map((p) => serverBoardDelta(p, efsp.boardStoreFor)));
    const n = payloads.reduce((sum, p) => sum + p.gone.length, 0);
    log.info('archived Strips and flight data', { strips: n, flightDataList: r.flightDataIds.length });
    return n;
  };
}

module.exports = { createArchiveSweep };
