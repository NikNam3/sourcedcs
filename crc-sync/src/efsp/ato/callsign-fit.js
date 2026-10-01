'use strict';

// Fitting an ATO callsign into a Strip's seven characters (decision H60,
// docs/adr/0071). Beside L3's normaliser (ato-sets.js normaliseCallsign), which
// upper-cases and drops spaces, `-` and `_` and never abbreviates; this runs on
// its output.
//
// The rule is the human's, and it is [SOURCE-DEFINED]: a SOURCE DCS convention,
// not doctrine. Guide §3.2 rule 1 caps a callsign at 7 alphanumerics and says
// nothing about how to get there. Vowels are cut from the back of the callsign
// to the front until it fits: ENFIELD11 → ENFLD11, SHADOW11 → SHADW11. A
// callsign that still does not fit once every vowel is gone is returned as
// null, and its line waits for a controller to type one.
//
// SOURCE CAVEAT (EFSPImplementationGuide.md §9.9): the ATO this reads was
// parsed by a layout taken from a DCS community wiki, not MIL-STD-6040; see
// ato-ingest.js.
//
// Pure: no I/O, no requires.

const MAX_CALLSIGN = 7;                 // guide §3.2 rule 1
const FITS_RE = /^[A-Z0-9]{1,7}$/;
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

/**
 * @param {string|null} normalised a callsign as L3's normaliser emits it (upper case, no separators)
 * @returns {string|null} the callsign itself when it already fits, the shortened one, or null
 */
function fitCallsign(normalised) {
  if (typeof normalised !== 'string' || normalised === '') return null;
  const cs = normalised.toUpperCase();
  if (!/^[A-Z0-9]+$/.test(cs)) return null;
  if (FITS_RE.test(cs)) return cs;
  const chars = cs.split('');
  for (let i = chars.length - 1; i >= 0 && chars.length > MAX_CALLSIGN; i--) {
    if (VOWELS.has(chars[i])) chars.splice(i, 1);
  }
  const out = chars.join('');
  return FITS_RE.test(out) ? out : null;
}

module.exports = { fitCallsign, };
