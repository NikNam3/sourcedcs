'use strict';

// Single frequency approach, as data (docs/adr/0117, superseding the SFA parts of 0075 and 0093).
//
// SFA is a procedure between the radar approach controller (AP) and the GCA controller (PAR), not a Position:
//
//   JO 7610.14A para 7-1-5 b, c: "At least five discrete ultra-high frequency (UHF) frequencies are available for this
//   use." "The radar approach controller retains jurisdiction over the rotation of three frequencies between himself
//   and the GCA controller."
//   JO 7110.65BB para 4-7-3: "do not require a radio frequency change after the aircraft begins approach ... until a
//   landing or low approach has been completed" (with its five exceptions).
//   JO 7110.65BB para 5-10-15 c: after the handoff the transferring controller deselects the frequency and the
//   receiving controller selects it; "Do not require or expect the flight to check on frequency".
//
// So the PILOT never changes frequency: the frequency is the flight's (its working frequency, Block 22), AP assigns
// it by filing the Strip on a frequency Rack of its `sfa-freqs` Bay, and it travels with the flight when AP hands it
// to PAR (an ordinary radar handoff, board/ops/transfer-strip.js). Nothing here writes a frequency.
//
// Who is on a rotating frequency is not a record anyone keeps: it is PAR while PAR holds the Strip of a flight on it,
// otherwise AP, who holds the rotation (`selectionFor`). Pure: no store, no clock.

const SFA_USE = Object.freeze({ ROTATION: 'ROTATION', INITIAL_CONTACT: 'INITIAL_CONTACT', SPARE: 'SPARE' });

/** The pool entry for a Rack (`{ rackId, mhz, use }`), or null. */
function poolEntryFor(config, rackId) {
  return (config && Array.isArray(config.pool) ? config.pool : []).find(p => p.rackId === rackId) || null;
}

/** True when `bay` is the SFA frequencies Bay of a Facility that has a single frequency approach `config`. */
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

/** The three rotating pool entries (JO 7610.14A para 7-1-5 c), in pool order. */
function rotationEntries(config) {
  return (config && Array.isArray(config.pool) ? config.pool : []).filter(p => p.use === SFA_USE.ROTATION);
}

/**
 * Who has each rotating frequency selected now (JO 7110.65BB para 5-10-15 c): `{ rackId: positionId }`, the receiver
 * (PAR) while it holds a live Strip whose flight is on that frequency, else the jurisdiction Position (AP).
 * @param {object} config the Facility's singleFrequencyApproach
 * @param {object[]} strips the Facility's Strips
 * @param {(flightDataId:string) => object|null} flightDataOf
 * @param {string|null} receiver the Position a handoff to the final lands on (PAR)
 */
function selectionFor(config, strips, flightDataOf, receiver) {
  const out = {};
  for (const entry of rotationEntries(config)) {
    const atReceiver = !!receiver && (strips || []).some(s => {
      if (s.ownerPositionId !== receiver || s.state === 'DROPPED') return false;
      const fd = flightDataOf(s.flightDataId);
      return !!(fd && fd.comms && fd.comms.workingFrequencyMhz === entry.mhz);
    });
    out[entry.rackId] = atReceiver ? receiver : config.jurisdiction;
  }
  return out;
}

module.exports = { SFA_USE, poolEntryFor, isSfaBay, frequencyForRack, rackForFrequency, rotationEntries, selectionFor };
