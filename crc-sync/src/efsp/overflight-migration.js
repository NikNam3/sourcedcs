'use strict';

// docs/adr/0087 — the OVERFLIGHT lifecycle moved from TRANSITING -> DROPPED to
// the guide's INBOUND -> IN_SECTOR -> HANDED_OFF -> DROPPED. A Board saved
// before that holds live TRANSITING Strips, a state their Role no longer has
// (no NLA, no owner, no count). This maps each to IN_SECTOR on restore — the
// flight was being worked, so that is the state it was in. In the style of
// clearance-migration.js: a pure function over the restored Strips, run once in
// index.js's _restore, idempotent (a second run finds nothing to map).

const LEGACY_OVERFLIGHT_STATE = { TRANSITING: 'IN_SECTOR' };

/**
 * Maps every legacy-state OVERFLIGHT Strip to its new state, in place.
 * @param {Iterable<object>} strips
 * @returns {number} how many Strips were mapped
 */
function migrateOverflightStates(strips) {
  let mapped = 0;
  for (const strip of strips) {
    if (!strip || strip.role !== 'OVERFLIGHT') continue;
    const next = LEGACY_OVERFLIGHT_STATE[strip.state];
    if (!next) continue;
    strip.state = next;
    mapped += 1;
  }
  return mapped;
}

module.exports = { migrateOverflightStates };
