'use strict';

// VFR the FAA way (H136 VQ2, S-ARCH-56): there is no flight-rules field. A flight with no assigned altitude and no
// assigned heading has no clearance for conformance to check, which is how a VFR aircraft on flight following shows
// (JO 7110.65BB para 2-3-8 c: VFR is in the equipment suffix and the absence of a clearance, not in a block). The
// client's hand copy is crc-desktop/app/public/js/panels/efsp/vfr.js; a parity test keeps them equal.

const _active = (cell) => !!(cell && (cell.entries || []).some(e => e.status === 'ACTIVE'));

/** No ACTIVE assigned altitude and no ACTIVE assigned heading on this flight data (null counts as none). */
function hasNoClearance(flightData) {
  return !(flightData && flightData.clearance && (_active(flightData.clearance.altitude) || _active(flightData.clearance.heading)));
}

module.exports = { hasNoClearance };
