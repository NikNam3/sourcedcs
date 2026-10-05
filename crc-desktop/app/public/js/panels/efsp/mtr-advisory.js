'use strict';

// The MTR rules that read only a flight data record (DESK-SPLIT: split out of strip-fields.js, which imports strip-template.js's
// Block Maps, while strip-template.js needs the lost-comms advisory for the 9H-ALT title).

const MTR_FIELDS = ['designator', 'entryFix', 'entryTimeUtc', 'exitFix', 'exitEstimateUtc', 'requestedAltitudeAfterExit'];

/**
 * True when ANY of the six MTR fields holds a value — not only the designator.
 * A controller who clears the designator but leaves an exit fix must still see
 * that exit fix on the Strip, rather than have it vanish into the expanded
 * view while it still sits on the flight.
 */
export function hasMtrData(flightData) {
  const mtr = flightData && flightData.military && flightData.military.mtr;
  if (!mtr) return false;
  return MTR_FIELDS.some(k => mtr[k] != null && mtr[k] !== '');
}

/**
 * §9.4's lost-comms rule as a sentence, for a flight with MTR data; null
 * otherwise. An advisory, not a computation: it states the rule, shows the half
 * this system holds (the ACTIVE assigned altitude, docs/adr/0058) and says the
 * other half — the minimum IFR altitude for each remaining segment — is not
 * here. It never reads 9H-ALT: that is the pilot's request, and the rule says
 * "last clearance". [SOURCE-DEFINED] the wording; the rule is the guide's.
 */
export function mtrLostCommsAdvisory(flightData) {
  if (!hasMtrData(flightData)) return null;
  const cell = flightData.clearance && flightData.clearance.altitude;
  const active = cell && Array.isArray(cell.entries) ? cell.entries.find(e => e.status === 'ACTIVE') : null;
  const cleared = active && active.value != null && active.value !== ''
    ? String(active.value) : 'none posted (ALT is empty)';
  return 'Lost comms (§9.4): separate assuming the higher of the minimum IFR altitude for each '
    + 'remaining segment — not available in this system — or the altitude in the last clearance: '
    + `${cleared}.`;
}
