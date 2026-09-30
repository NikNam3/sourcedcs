'use strict';

// IFF classification: which side a contact is on, as the scope colours it
// (docs/adr/0066).
//
// The colour is what THIS controller's interrogators got back, never the DCS
// coalition. A controller's declaration wins; otherwise a datalink report or
// a valid Mode 4/5 reply is friendly, a Mode 3/C reply alone is neutral, and
// silence (or a radar that never asked) is a bogey. classifyIff() takes only
// those answers — it never sees the track — so it cannot read the coalition.
//
// USER_COALITION stays here as "which side's crypto our interrogators hold".
// Only the sensor model reads it (transponder.js, datalink.js, station
// coverage), to decide what a contact would transmit; classification never
// does.

// Keep this list byte-identical to crc-desktop/app/public/js/iff.js's own
// IFF_STATES — the client validates declare mutations against its copy
// before ever sending them here.
const IFF_STATES = ['friendly', 'neutral', 'bogey', 'bandit', 'hostile'];

const USER_COALITION = parseInt(process.env.CRCSYNC_COALITION, 10) === 2 ? 2 : 3; // 3=BLUE (default), 2=RED

/**
 * What an interrogation got back, as the scope colours it (docs/adr/0066).
 * Takes only what this controller's sensors received; it never sees the
 * track, so it cannot read the DCS coalition. Automatic IFF never says
 * bandit or hostile: only a controller's declaration does.
 *
 * @param {object} a
 * @param {string|null} [a.declared]   a controller's declaration
 * @param {boolean} [a.datalink]       reported on the datalink in this session (PPLI)
 * @param {boolean} [a.mode4]          a valid Mode 4/5 reply to one of this session's radars
 * @param {boolean} [a.mode3]          a Mode 3/C reply to one of this session's radars
 * @returns {string} one of IFF_STATES
 */
function classifyIff({ declared = null, datalink = false, mode4 = false, mode3 = false } = {}) {
  if (declared) return declared;
  if (datalink || mode4) return 'friendly';
  if (mode3) return 'neutral'; // [SOURCE-DEFINED] ID criterion, docs/adr/0066
  return 'bogey';
}

module.exports = { IFF_STATES, USER_COALITION, classifyIff };
