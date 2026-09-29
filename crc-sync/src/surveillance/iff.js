'use strict';

// IFF classification: which side a contact is on, as the scope colours it.
//
// A controller's declaration wins; otherwise it is worked out automatically.
// The automatic answer still reads the DCS coalition, which no real sensor
// would give — it stands in for IFF interrogation until that is modelled
// (docs/adr/0059, open items).

const { checkOnGround } = require('../geo');

// Keep this list byte-identical to crc-desktop/app/public/js/iff.js's own
// IFF_STATES — the client validates declare mutations against its copy
// before ever sending them here.
const IFF_STATES = ['friendly', 'neutral', 'bogey', 'bandit', 'hostile'];

const USER_COALITION = parseInt(process.env.CRCSYNC_COALITION, 10) === 2 ? 2 : 3; // 3=BLUE (default), 2=RED

/**
 * @param {object} track       raw track
 * @param {object} missionData airports, for the on-ground check
 * @param {boolean} squawking  whether the aircraft's transponder is on
 */
function computeAutoIff(track, missionData, squawking) {
  const own   = USER_COALITION;
  const enemy = own === 3 ? 2 : 3;

  if (track.coalition === own) {
    if (!track.player) return 'friendly'; // AI = always friendly
    if (squawking)     return 'friendly'; // player + transponder
    return checkOnGround(track, missionData) ? 'friendly' : 'bogey';
  }

  if (track.coalition === enemy) {
    return checkOnGround(track, missionData) ? 'invisible' : 'bogey';
  }

  return 'neutral'; // coalition 1 (neutral) or unknown
}

/** A controller's declaration first, then the automatic answer. */
function resolveIff(track, collabEntry, missionData, squawking) {
  if (collabEntry && collabEntry.iff) return collabEntry.iff.state;
  return computeAutoIff(track, missionData, squawking);
}

module.exports = { IFF_STATES, USER_COALITION, computeAutoIff, resolveIff };
