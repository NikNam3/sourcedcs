'use strict';

// A Strip's HIGHLIGHT colour (the right-click swatches, Ctrl+click) carried onto its track's label on the map, so the
// controller who marked a flight on the Board finds it on the scope too. Only the callsign takes the colour: the target,
// the leader and the rest of the block keep what they say (IFF, ownership, alerts).
//
// Only a Strip this controller is working counts: a highlight is the owner's own memory aid, and another controller's
// marks would colour a scope they did not mark. With several, the first highlighted one wins.

/**
 * @param {object[]} strips  the Strips correlated to the track
 * @param {Iterable<string>} actingPositionIds  the Positions this controller is acting at
 * @returns {string|null} the colour, or null
 */
export function trackHighlightColor(strips, actingPositionIds) {
  const acting = new Set(actingPositionIds || []);
  for (const strip of strips || []) {
    if (!strip || strip.state === 'DROPPED' || !acting.has(strip.ownerPositionId)) continue;
    const color = strip.flags && strip.flags.highlight;
    if (color) return color;
  }
  return null;
}
