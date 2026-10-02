'use strict';

// Pure Strip helpers the Board facade and its collaborators share (docs/adr/0095). Every file under board/ may
// require this one (seam rule 1).

const crypto = require('crypto');
const { isValidAltitude } = require('../airspace-config');

function newFlags() {
  return { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null };
}

/**
 * An altitude block a flight is restricted to inside an airspace. Feet,
 * whole numbers, upper above lower, and — when the airspace publishes its
 * own vertical limits — inside them, since a controller cannot assign a
 * block the airspace does not contain.
 */
function _validateAltitudeBlock(block, definition) {
  if (block === undefined || block === null) return { ok: true };
  if (typeof block !== 'object') return { ok: false, detail: 'altitudeBlock must be {lowerFt, upperFt}' };
  const { lowerFt, upperFt } = block;
  if (!isValidAltitude(lowerFt) || !isValidAltitude(upperFt)) {
    return { ok: false, detail: 'altitudeBlock needs whole-foot lowerFt and upperFt' };
  }
  if (upperFt <= lowerFt) return { ok: false, detail: 'altitudeBlock upperFt must be above lowerFt' };
  if (isValidAltitude(definition.altLowerFt) && lowerFt < definition.altLowerFt) {
    return { ok: false, detail: `${definition.name} starts at ${definition.altLowerFt} ft — ${lowerFt} is below it` };
  }
  if (isValidAltitude(definition.altUpperFt) && upperFt > definition.altUpperFt) {
    return { ok: false, detail: `${definition.name} tops at ${definition.altUpperFt} ft — ${upperFt} is above it` };
  }
  return { ok: true };
}

function deepClone(obj) {
  return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}

/**
 * Block 22's value, as a frequency.
 *
 * Every Block a controller types into arrives as a STRING — the panel's
 * click-to-edit cell is an <input type="text"> and always has been — while
 * isValidFrequency() requires a number, deliberately, so that a configured
 * airspace frequency and a flight's approved frequency can never validate
 * differently (airspace-config.js's own header says so).
 *
 * Nothing bridged the two, so typing into Block 22 was refused with
 * `frequency must be a number between 30 and 400 MHz, not "360.200"` — a
 * message naming a value that looks perfectly valid, which is the worst kind.
 * The Block has been reachable since the RANGE slice and the only writer that
 * ever worked was ApproveAirspaceEntry, which passes a real number from config.
 *
 * Parsed here rather than coerced in the client because this is the one
 * boundary every writer crosses; a client-side fix would leave the dot-command
 * surface and any second client to make the same mistake again. Strict on
 * purpose: Number('') is 0 and Number('  ') is 0, so a blank must be caught
 * first, and anything that is not a plain decimal is left alone to be refused
 * by the validator with its own message.
 */
function _frequencyFromBlockValue(value) {
  if (value === '' || value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : value;
}

/**
 * The track-degradation soft interlock (guide §4.6 rule 5, docs/adr/0019): CST/FAIL/IF/NT/TRK force verbal
 * coordination, and a non-empty note is the electronic stand-in for it. Returns the refusal result, or null.
 */
function trackDegradationRefusal(flightData, note, strip) {
  const flag = flightData && flightData.identity.trackDegradationFlag;
  if (flag && flag !== 'NONE' && !note) {
    return {
      ok: false, reason: 'VALIDATION_ERROR',
      detail: `track degradation (${flag}) forces verbal coordination — a note is required`,
      strip,
    };
  }
  return null;
}

// The receiver's replica Strip: the mint the two peer-receive paths share (coordination's receiveCoordinationProposal and
// TOFI's receiveTofiProposal). Both land a brand-new Strip at the tail of the receiving Position's Coordination Bay rack,
// carrying the sender's flight data; they differ in strip type, state and which link record they hang on it.
/**
 * Mints the replica and inserts it into the Board state.
 * @param {{state:object, placement:object, clock:{now:()=>string}}} deps  the Board's state, placement and clock
 * @param {object} p
 * @param {string} p.flightDataId
 * @param {string} p.stripType
 * @param {string} p.state  the replica's starting EfspState
 * @param {string} p.toPositionId  the owner
 * @param {{bayId:string, rackIds:string[]}} p.coordinationBay
 * @param {string|null} [p.by]
 * @param {(now:string)=>object} p.links  the link record(s), spread between `flags` and `createdAt` (key order is part of the Strip's JSON)
 * @returns {object} the inserted Strip
 */
function mintReplica({ state, placement, clock }, { flightDataId, stripType, state: startState, toPositionId, coordinationBay, by, links }) {
  const stripId = crypto.randomUUID();
  const now = clock.now();
  const rackStrips = state.rack(coordinationBay.bayId, coordinationBay.rackIds[0]);
  const afterStripId = rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null;
  const orderKey = placement.resolveOrderKey(coordinationBay.bayId, coordinationBay.rackIds[0], afterStripId, null, null);

  const strip = {
    stripId,
    cid: state.nextCid(),
    flightDataId,
    rev: 1,
    stripType,
    state: startState,
    ownerPositionId: toPositionId,
    bayId: coordinationBay.bayId,
    rackId: coordinationBay.rackIds[0],
    orderKey,
    annotations: {},
    flags: newFlags(),
    // No `correlation` — it is keyed by flightDataId, and a replica shares the
    // originator's flight data (docs/adr/0013), so it shares the correlation too.
    ...links(now),
    createdAt: now, updatedAt: now, updatedBy: by || null,
  };
  state.insert(strip);
  return strip;
}

module.exports = { mintReplica, trackDegradationRefusal, newFlags, _validateAltitudeBlock, deepClone, _frequencyFromBlockValue };
