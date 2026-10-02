'use strict';

// Pure Strip helpers the Board facade and its collaborators share (docs/adr/0095). Every file under board/ may
// require this one (seam rule 1).

const { isValidAltitude } = require('../airspace-schema');

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

module.exports = { newFlags, _validateAltitudeBlock, deepClone, _frequencyFromBlockValue };
