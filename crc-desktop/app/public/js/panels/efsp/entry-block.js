'use strict';
import { altitudeText, parseAltitudeText } from './airspace-draft.js';

// The altitude block a flight is approved to work inside an airspace (crc-sync ApproveAirspaceEntry's `altitudeBlock`,
// `{lowerFt, upperFt}`), typed in the entry popover (crc-sync docs/adr/0128 §3, H151 MT-Q2 b: the users' restriction is
// this block or their ordinary assigned altitude). Both fields empty: the whole airspace (null). Re-issuing the op on a
// Strip already in the airspace amends the block. The server's checks (strip-util.js `_validateAltitudeBlock`) are mirrored
// so the controller sees the reason before sending; the server decides.

/**
 * @param {string} lowerText
 * @param {string} upperText
 * @param {object} [definition] the airspace's definition (its vertical limits)
 * @returns {{ok:true, block:{lowerFt:number, upperFt:number}|null}|{ok:false, detail:string}}
 */
export function parseEntryBlock(lowerText, upperText, definition = {}) {
  const lower = parseAltitudeText(lowerText);
  const upper = parseAltitudeText(upperText);
  if (lower === null && upper === null) return { ok: true, block: null };
  if (Number.isNaN(lower) || Number.isNaN(upper)) return { ok: false, detail: 'write an altitude like 15000 or FL150' };
  if (lower === null || upper === null) return { ok: false, detail: 'a block needs both a lower and an upper altitude (leave both empty for the whole airspace)' };
  if (upper <= lower) return { ok: false, detail: 'the upper altitude must be above the lower' };
  const name = definition.name || 'the airspace';
  if (Number.isFinite(definition.altLowerFt) && lower < definition.altLowerFt) return { ok: false, detail: `${name} starts at ${altitudeText(definition.altLowerFt)}` };
  if (Number.isFinite(definition.altUpperFt) && upper > definition.altUpperFt) return { ok: false, detail: `${name} tops at ${altitudeText(definition.altUpperFt)}` };
  return { ok: true, block: { lowerFt: lower, upperFt: upper } };
}

/** The two input texts for a block (empty for the whole airspace). */
export function entryBlockTexts(block) {
  return block ? { lower: altitudeText(block.lowerFt), upper: altitudeText(block.upperFt) } : { lower: '', upper: '' };
}
