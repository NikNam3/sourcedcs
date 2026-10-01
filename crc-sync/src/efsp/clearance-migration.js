'use strict';

// docs/adr/0058 — the assigned altitude and heading moved from per-Strip
// annotations onto the flight record (fdr.clearance). A Board saved before
// that still has them as annotations; this moves them over on restore so a
// restart does not silently drop a clearance a controller issued.
//
// Per Role, the Blocks that used to hold them:
const CLEARANCE_BLOCKS_BY_ROLE = {
  DEPARTURE: { '21': 'altitude', '20': 'heading' },
  ARRIVAL: { '7': 'altitude', '9A-VECTOR': 'heading' },
  OVERFLIGHT: { '7A': 'altitude', '9A-VECTOR': 'heading' },
};

const { ensureClearance, parseAltitude, parseHeadingDeg } = require('./fdr-store');

/**
 * Moves every old clearance annotation onto its FDR, in place.
 *
 * Several Strips can share one FDR (the sender's and a replica). The first one
 * with history wins, and the FDR keeps it; the others are simply cleared — a
 * replica's notes were a copy the controller made by hand, not a second
 * clearance. An FDR that already has entries (written after the move) is
 * never overwritten.
 *
 * @param {Iterable<object>} strips
 * @param {(fdrId:string) => object|null} getFdr
 * @returns {number} how many cells moved
 */
function migrateClearanceAnnotations(strips, getFdr) {
  let moved = 0;
  for (const strip of strips) {
    const blocks = CLEARANCE_BLOCKS_BY_ROLE[strip.role];
    if (!blocks || !strip.annotations) continue;
    const fdr = getFdr(strip.fdrId);
    for (const [blockId, field] of Object.entries(blocks)) {
      const cell = strip.annotations[blockId];
      if (!cell) continue;
      delete strip.annotations[blockId];
      if (!fdr || !cell.entries || cell.entries.length === 0) continue;
      const target = ensureClearance(fdr)[field];
      if (target.entries.length > 0) continue;
      target.entries = cell.entries.map(e => {
        const empty = e.value == null || e.value === '';
        const entry = { value: empty ? '' : String(e.value).trim().toUpperCase(), parsed: null, status: e.status, at: e.at, by: e.by || null };
        if (field === 'altitude') {
          const band = empty ? null : parseAltitude(e.value);
          entry.parsed = band && band.lowFt === band.highFt ? band.lowFt : null;
          entry.block = band && band.lowFt < band.highFt ? band : null;
        } else {
          entry.parsed = empty ? null : parseHeadingDeg(e.value);
        }
        return entry;
      });
      moved += 1;
    }
  }
  return moved;
}

module.exports = { migrateClearanceAnnotations };
