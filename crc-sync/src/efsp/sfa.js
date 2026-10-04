'use strict';

// Single Frequency Approach, as data (guide §4.7, docs/adr/0075, docs/adr/0093).
//
// SFA exists so a single-piloted jet never changes frequency during an approach:
// "controllers rotate onto the aircraft's frequency". The model has two parts and
// neither one writes a frequency.
//
//  1. The ROTATION RECORD (sfa-store.js): `{ rackId: positionId }`, which Position
//     is on which pool frequency right now. Only the jurisdiction Position (AP)
//     changes it.
//  2. The SFA_ROTATION transfer (below): a Strip's controller changes, the Strip's
//     frequency never does. It is the same shape as a carrier handoff (ADR 0074):
//     an ARRIVAL Strip becomes a FINAL Strip IN PLACE (same Strip, same flight data, as
//     ConvertToArrival does, ADR 0023), ownership moves to PAR, and the transfer's
//     trigger type is recorded.
//
// A frequency is an attribute of the FLIGHT (the flight data's working frequency, Block
// 22), so nothing here can change one by accident: SFA_ROTATION never touches the
// flight data. The one place a frequency IS written is a controller dragging a Strip onto
// an SFA Rack, which is assigning it a frequency on purpose (board/ops/move-strip.js, through `assignSfaFrequency`).
//
// Pure: no store, no clock. Who may do what is permission.js's capability table.

const { TRIGGER_TYPES } = require('./carrier/handoffs');

// The trigger type is one of the FOUR guide §9.12 names (a rotation is the
// controller's own gesture, like Commence): the four types stay four.
const SFA_TRANSFERS = Object.freeze({
  SFA_ROTATION: Object.freeze({
    trigger: 'CONTROLLER_INITIATED',
    stripType: 'ARRIVAL', state: 'INBOUND',
    toStripType: 'FINAL', toState: 'ON_FINAL',
    label: 'Rotate to PAR',
    source: '§4.7',
    guide: '§4.7 — SFA ownership transfer is a controller-side rotation; the Strip\'s frequency does not change',
  }),
});

if (!TRIGGER_TYPES.includes(SFA_TRANSFERS.SFA_ROTATION.trigger)) throw new Error('SFA_ROTATION must use one of the four trigger types');

/** The pool entry for a Rack (`{ rackId, mhz }`), or null. */
function poolEntryFor(config, rackId) {
  return (config && Array.isArray(config.pool) ? config.pool : []).find(p => p.rackId === rackId) || null;
}

/** True when `bay` is the SFA frequencies Bay of a Facility that has a Single Frequency Approach `config`. */
function isSfaBay(bay, config) {
  return !!bay && bay.view === 'sfa-freqs' && !!config;
}

/** The frequency (MHz) a Rack carries in the SFA pool of `bay`, or null (not an SFA Bay, or no such Rack). */
function frequencyForRack(bay, config, rackId) {
  if (!isSfaBay(bay, config)) return null;
  const entry = poolEntryFor(config, rackId);
  return entry ? entry.mhz : null;
}

/** The Rack that carries `mhz` in the SFA pool of `bay`, or null. */
function rackForFrequency(bay, config, mhz) {
  if (!isSfaBay(bay, config)) return null;
  const entry = (Array.isArray(config.pool) ? config.pool : []).find(p => p.mhz === mhz);
  return entry ? entry.rackId : null;
}

module.exports = { SFA_TRANSFERS, poolEntryFor, isSfaBay, frequencyForRack, rackForFrequency };
