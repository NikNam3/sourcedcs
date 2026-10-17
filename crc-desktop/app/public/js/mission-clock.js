'use strict';

// crc-sync owns the mission clock (crc-sync/src/mission-clock.js, docs/adr/
// 0079): it converts DCS's in-game local time to Zulu with the theater's fixed
// offset and sends the result as `game-time` { zuluMs, source } after every
// poll. This side only advances it in real time between messages — there is
// no offset, and no clock arithmetic, here.
//
// missionNow() is the client's one answer to "what time is it" for anything a
// controller reads as a time of day (a booking window, how long an exchange
// has waited). Before the first message it is the wall clock, which is also
// what the server answers before DCS does. MISSION_HELD (DCS paused, ADR 0129)
// is not advanced: a paused game clock does not move.

let _missionAnchorWallMs = null; // Date.now() when the last game-time arrived
let _missionAnchorZuluMs = null; // what it said
let _missionClockSource  = 'WALL';

export function updateGameTime(msg) {
  if (!Number.isFinite(msg.zuluMs)) return;
  _missionAnchorWallMs = Date.now();
  _missionAnchorZuluMs = msg.zuluMs;
  _missionClockSource  = msg.source || 'WALL';
}

export function missionNow() {
  if (_missionAnchorZuluMs === null) return Date.now();
  if (_missionClockSource === 'MISSION_HELD') return _missionAnchorZuluMs;
  return _missionAnchorZuluMs + (Date.now() - _missionAnchorWallMs);
}

export function hasMissionTime() { return _missionAnchorZuluMs !== null; }
export function missionClockSource() { return _missionClockSource; }
