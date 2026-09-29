'use strict';

// USMTF Air Tasking Order ingest — the facade (EFSPImplementationGuide.md
// §9.9, WP7; docs/adr/0063). Text in, mission lines out. It creates nothing:
// no FDR, no Strip, no beacon code. Lane L14 (ADR 0071) turns the result into
// mission Strips.
//
// SOURCE CAVEAT (EFSPImplementationGuide.md §9.9, required to be carried into code):
// the detailed USMTF set-level breakdown this parser implements comes from a
// DCS community wiki — the 455 vAEW "ATO, ACO & SPINS Guide"
// (https://wiki.455aew.com/books/ato-aco-spins-guide/page/ato) — NOT from the
// official specification. Set names are consistent with real USMTF, but
// anything load-bearing MUST be verified against MIL-STD-6040 [Annex §14.3],
// which was not available when this was written (and the Annex itself is not
// in this repository). Every positional guess the parser makes where the wiki's
// field list and its own examples disagree is listed in docs/adr/0063 and is
// [SOURCE-DEFINED], not doctrine. The field layouts actually read are the
// "recommended reading" of docs/parallel/research/usmtf-ato.md, which cross-
// checks the wiki against an AFIT paper, an NPS thesis and Combined Ops' DCS
// ATO generator; its [PROFILE] shapes are a SOURCE DCS convention shared with
// atobrief's USMTF export (lane L11), not the standard.
//
// USMTF is the only input (decision H1). atobrief's YAML is atobrief-internal;
// atobrief exports USMTF.
//
// Never throws. Pure: no I/O at require time or call time.

const { parseStructure } = require('./ato-structure');
const { mapAtoDocument, collectWarnings, ATO_FIELD_TARGETS, SEED_KEYS, ACCEPTANCE_FIELDS } = require('./ato-mapping');

function internalError(err) {
  return {
    code: 'INTERNAL_ERROR', severity: 'error', line: null, set: null, field: null,
    message: `The ATO parser failed unexpectedly: ${err && err.message ? err.message : String(err)}`,
  };
}

/**
 * @param {string} text raw ATO message
 * @param {{ referenceUtc?: number, modeOneMax?: '73'|'77' }} [opts]
 *   referenceUtc — epoch ms (in-game Zulu, e.g. MissionClock.now()) used to
 *   resolve DTGs lacking a month/year when the ATO has no TIMEFRAM. Never
 *   defaulted to the wall clock.
 *   modeOneMax — '73' warns on a Mode 1 above 73 (guide §3.10.3 rule 5; the
 *   real choice belongs in facility config).
 * @returns {object} AtoDocument (see ato-structure.js)
 */
function parseAtoText(text, opts = {}) {
  try {
    return parseStructure(text, opts || {});
  } catch (err) {
    return {
      source: 'USMTF', fatal: true,
      header: { classification: null, operation: null, msgId: null, acknowledge: null, timeframe: null, remarks: [] },
      missions: [], unmappedSets: [], warnings: [internalError(err)], heuristics: [],
    };
  }
}

/**
 * @returns {{ ok, source, header, packages, missionLines, arLinks, unmappedSets, warnings, heuristics }}
 *   ok is false only when nothing usable came out: non-text, over the size
 *   cap, no missions, or an internal error.
 */
function ingestAtoText(text, opts = {}) {
  try {
    return mapAtoDocument(parseAtoText(text, opts));
  } catch (err) {
    return {
      ok: false, source: 'USMTF', header: null, packages: [], missionLines: [], arLinks: [],
      unmappedSets: [], warnings: [internalError(err)], heuristics: [],
    };
  }
}

module.exports = {
  parseAtoText, ingestAtoText, mapAtoDocument, collectWarnings,
  ATO_FIELD_TARGETS, SEED_KEYS, ACCEPTANCE_FIELDS,
};
