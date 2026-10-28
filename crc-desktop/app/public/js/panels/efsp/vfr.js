'use strict';

// Which flights are VFR (crc-sync docs/adr/0146): the one worked on a live VFR strip, whatever it was assigned. The hand
// copy of crc-sync/src/efsp/vfr.js (a parity test keeps them equal). A leaf: imports nothing.

export const VFR_STRIP_TYPE = 'VFR';

/** Is this a live VFR strip? */
export function isVfrStrip(strip) {
  return !!strip && strip.stripType === VFR_STRIP_TYPE && strip.state !== 'DROPPED';
}

/** Is the flight these live strips (any Facility) are worked on VFR? A flight with no strip is nobody's: false. */
export function isVfrFlight(strips) {
  return (strips || []).some(isVfrStrip);
}
