'use strict';

// Which side of a coordination exchange a Strip is (DESK-SPLIT: pure reads of the Strip record, split out of
// popovers/coordination.js so the dispatch helpers can use them without importing a popover).
/**
 * A cross-Facility coordination replica lands in the receiving Position's
 * Coordination Bay (bayId ends '-coordination') with coordination.state
 * PROPOSED — that combination is what actually distinguishes "this Strip
 * IS the pending proposal awaiting my response" from the SENDER's own
 * Strip, which also carries coordination.state:'INITIATED' but stays in
 * its normal working Bay. Accepting/rejecting your own just-sent proposal
 * makes no sense, so this check is load-bearing, not decorative.
 */
export function _isPendingCoordinationReplica(strip) {
  return !!(strip.coordination && strip.coordination.state === 'INITIATED' && strip.bayId.endsWith('-coordination'));
}

/**
 * Is this Strip the RECEIVER's replica of the exchange, rather than the
 * sender's own flight record?
 *
 * `mintedForCoordination` is the server's authoritative answer and is
 * stamped by board/coordination.js's `receiveCoordinationProposal`. The Bay
 * check is the same fallback the server keeps (`isRejectedReplica`, board/strip-ops.js) for a replica minted before the field
 * existed and restored from a persisted Board.
 */
export function _coordinationIsReplica(strip) {
  const co = strip.coordination;
  if (!co) return false;
  if (co.mintedForCoordination) return true;
  return strip.bayId.endsWith('-coordination');
}

/**
 * F-303: the receiver's copy of a coordination it rejected. It is inert — the
 * sender still works the flight — so it offers nothing but Drop and moving it
 * aside. board/strip-ops.js's `rejectedReplicaOpRefusal` refuses the rest; this
 * keeps the controls that would only be refused off the Strip in the first
 * place. MARSA and correlation are flight-level on the server, so for those
 * two this is the only guard there is.
 */
export function _isRejectedCoordinationReplica(strip) {
  return !!strip.coordination && strip.coordination.state === 'REJECTED' && _coordinationIsReplica(strip);
}
