'use strict';

// LC's pattern work on its ordinary Strips (crc-sync docs/adr/0126, decisions H149, H150 TWR-Q1 a). Pure, imports nothing:
// what the Strip's tab says and which ⋯ items the tower is offered. crc-sync board/ops/pattern.js is authoritative; the
// tables here mirror it (tests/efsp-twr-pattern.test.mjs holds them to the server's CONVERSIONS).

/** The one Position holding crc-sync's PATTERN_OP_KINDS (authority/positions/civil-atc.js): the tower. */
export const PATTERN_POSITION = 'LC';

/** The ARRIVAL state LC's Pattern Bay implies: the flight is in the visual pattern. */
export const PATTERN_STATE = 'TRAFFIC_PATTERN';

/** What the tab says instead of the raw state name: the grey IN PATTERN mark (dark cockpit, H115-H119). */
export const STATE_DISPLAY_LABELS = { TRAFFIC_PATTERN: 'IN PATTERN' };

/** The tab's state words for a Strip. */
export function stateDisplayLabel(state) {
  return STATE_DISPLAY_LABELS[state] || String(state).replace(/_/g, ' ');
}

/** The two in-place strip-type changes, as crc-sync's CONVERSIONS: who may start each from where. */
export const PATTERN_CONVERSIONS = {
  JoinPattern: { from: 'DEPARTURE', fromStates: ['DEPARTED'], label: 'Closed traffic',
    title: 'the aircraft stays in closed traffic: this Strip becomes an arrival in the Pattern Bay (same Strip, same code)' },
  LeavePattern: { from: 'ARRIVAL', fromStates: ['TRAFFIC_PATTERN', 'FINAL'], label: 'Leave pattern',
    title: 'the aircraft departs the pattern: this Strip becomes a departure, then Hand Off to AP or Drop as usual' },
};

/** The pattern conversion ops offered on `strip` to `acting` (the Position the controller acts as on it), in order. */
export function patternConversionsFor(strip, acting) {
  if (!strip || !acting || acting !== strip.ownerPositionId || acting !== PATTERN_POSITION) return [];
  return Object.entries(PATTERN_CONVERSIONS)
    .filter(([, c]) => c.from === strip.stripType && c.fromStates.includes(strip.state))
    .map(([kind, c]) => ({ kind, label: c.label, title: c.title }));
}

/** Why an open exchange blocks the conversion (the server refuses the same three), or ''. */
export function patternConversionBlockedBy(strip) {
  if (strip.coordination && strip.coordination.state === 'INITIATED') return 'an open coordination proposal';
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'INITIATED') return 'an open TOFI proposal';
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') return 'active tactical control';
  return '';
}
