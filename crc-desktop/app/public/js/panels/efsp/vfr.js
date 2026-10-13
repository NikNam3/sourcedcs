'use strict';

// VFR the FAA way (crc-sync H136 VQ2): no flight-rules field; a flight with no assigned altitude and no assigned heading
// has no clearance. The hand copy of crc-sync/src/efsp/vfr.js (a parity test keeps them equal). A leaf: imports nothing.

const _active = (cell) => !!(cell && (cell.entries || []).some(e => e.status === 'ACTIVE'));

/** No ACTIVE assigned altitude and no ACTIVE assigned heading on this flight data (null counts as none). */
export function hasNoClearance(flightData) {
  return !(flightData && flightData.clearance && (_active(flightData.clearance.altitude) || _active(flightData.clearance.heading)));
}
