'use strict';
import { getActingPositions, sendEfspConflictSuppress } from './efsp-ws.js';

// A controller's suppress of one conflict alert (crc-sync's docs/adr/0145, H173 VQ-A; JO 7110.65BB para 5-14-6 c.1,
// 5-13-1 c.1(a)): one click on the alert, for that pair only, at this controller's own Positions it is shown at. The server
// keeps it until the pair stops alerting or a track drops; suppressed is not hidden, a grey CA stays on both labels.
// Restore is the same click on a suppressed alert.
//
// crc-sync's docs/adr/0147 (H176): the alert reaches this controller only where they work one of the aircraft, and one
// suppress applies at every Position they are Primary at where it is shown (one person, one acknowledgement), so one
// frame goes out, named for the first of them.
//
// `conflict` is one of conflictAlertsForTrack()'s entries (or a raw efsp-alerts record): its `shownAt` and `suppressedAt`
// name Positions, which the server filled in for this session. Nothing here names a Position of its own.

/** The Positions this controller acts at (Primary) where the alert is shown and not yet suppressed. */
export function conflictSuppressTargets(conflict, acting = getActingPositions()) {
  const at = (conflict && conflict.suppressedAt) || [];
  return ((conflict && conflict.shownAt) || []).filter(p => acting.includes(p) && !at.includes(p));
}

/** The Positions this controller acts at where the alert is suppressed. */
export function conflictRestoreTargets(conflict, acting = getActingPositions()) {
  return ((conflict && conflict.suppressedAt) || []).filter(p => acting.includes(p));
}

/** Suppresses the alert at this controller's Positions (the server applies it at each). Returns how many were sent. */
export function suppressConflict(conflict) {
  const [first] = conflictSuppressTargets(conflict);
  if (!first) return 0;
  sendEfspConflictSuppress(first, conflict.id, true);
  return 1;
}

/** Restores the alert at this controller's Positions it is suppressed at. Returns how many were sent. */
export function restoreConflict(conflict) {
  const [first] = conflictRestoreTargets(conflict);
  if (!first) return 0;
  sendEfspConflictSuppress(first, conflict.id, false);
  return 1;
}
