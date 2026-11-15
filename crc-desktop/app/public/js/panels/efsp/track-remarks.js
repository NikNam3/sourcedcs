'use strict';
import { remarksOf } from './strip-template.js';

// A Strip's remarks carried onto its track's data block (docs/adr/0165), so the controller working a flight reads
// them on the scope without turning to the Board. The text is track-label.js's (remarksLabelText); this only picks
// whose remarks.
//
// Only a Strip this controller's Position owns counts, as for HIGHLIGHT (track-highlight.js): another controller's
// flight is theirs to brief, and a block on a scope that does not work the flight stays as it was. With several owned
// Strips, the first one with remarks wins.

/**
 * @param {object[]} strips  the Strips correlated to the track
 * @param {Iterable<string>} actingPositionIds  the Positions this controller is acting at
 * @param {(flightDataId: string) => object|null} flightDataOf  the Strip's flight data (efsp-state.js getEfspFlightData)
 * @returns {string} the remarks, or '' when none
 */
export function trackRemarks(strips, actingPositionIds, flightDataOf) {
  const acting = new Set(actingPositionIds || []);
  for (const strip of strips || []) {
    if (!strip || strip.state === 'DROPPED' || !acting.has(strip.ownerPositionId)) continue;
    const remarks = remarksOf(flightDataOf(strip.flightDataId));
    if (remarks) return remarks;
  }
  return '';
}
