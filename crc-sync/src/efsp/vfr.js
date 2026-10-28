'use strict';

// Which flights are VFR (docs/adr/0146, superseding H136 VQ2's "VFR is no field, it is the absence of a clearance"). A
// VFR aircraft is the one a controller works on a VFR strip: the strip type says it, so a VFR aircraft that was assigned
// a heading or an altitude is still VFR (H174: VFR is assigned and cancelled HDG/SPD/ALT with conformance), and an IFR
// flight not yet cleared is still IFR. A flight's rules change only by ChangeFlightRules, which changes the strip type.
// The client's hand copy is crc-desktop/app/public/js/panels/efsp/vfr.js; a parity test keeps them equal.

const VFR_STRIP_TYPE = 'VFR';

/** Is this a live VFR strip? */
function isVfrStrip(strip) {
  return !!strip && strip.stripType === VFR_STRIP_TYPE && strip.state !== 'DROPPED';
}

/** Is the flight these live strips (any Facility) are worked on VFR? A flight with no strip is nobody's: false. */
function isVfrFlight(strips) {
  return (strips || []).some(isVfrStrip);
}

module.exports = { VFR_STRIP_TYPE, isVfrStrip, isVfrFlight };
