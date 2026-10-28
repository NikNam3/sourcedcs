'use strict';
import { isWithinDoubleTapWindow } from '../efsp-nla.js';
import { getEfspBays, getEfspCorrelationForStrip, getEfspMarsa, getEfspNonOwnerBlockWrites, getEfspStrip } from '../efsp-state.js';
import { getActingPositions, sendEfspCorrelationMutation, sendEfspMarsaMutation, sendEfspMutation } from '../efsp-ws.js';
import { _isRejectedCoordinationReplica } from './coordination-rules.js';

// What a Strip's controls send (DESK-SPLIT, split out of bay-view.js): the acting-Position rule, the board-wide double-tap
// guard and the one-Mutation dispatch helpers (MARSA, correlation, NLA, move, transfer, hand-back, the paper gestures).
// Imports state and the wire only, so the Strip view, the popovers and drag all use it without importing the Bay renderer.

// The board-wide double-tap guard (guide §3.5 rule 3, lane 1's F-101).
//
// crc-sync has a 400ms guard too, keyed per stripId, and that is the right key
// for the bug it was written for: one controller pressing one Strip's button
// twice. It is structurally incapable of catching this one. The first press
// transfers the Strip away, the Rack reflows, and the NEIGHBOUR's button is
// now exactly where the pointer is — so the second tap is an ordinary first
// click on a different Strip, which no per-Strip guard can see.
//
// Lane 4 measured it on every transfer-shaped step, and the worst case is the
// one to design against: a double-tap on "Hand Off to AP" pressed "Line Up
// and Wait" for the jet that slid up underneath. The Strip that arrives under
// the pointer need not even be in the same state as the one tapped, so this is
// a runway clearance nobody gave.
//
// Hence a board-wide window: any advancing press within DOUBLE_TAP_MS of
// another advancing press is discarded. Silently, and raising no banner —
// §3.5 rule 3 is explicit that a double tap is "success, not an error", and
// the server's own guard was deliberately left as a silent no-op for the same
// reason. The cost is that a controller who genuinely meant two presses inside
// 400ms presses once more.
//
// efsp-nla.js has exported isWithinDoubleTapWindow/DOUBLE_TAP_MS for exactly
// this since Phase 1 ("so the button visibly disables … without waiting on a
// round trip") and nothing in app/public/js had ever called it.
let _lastAdvancingPressAt = null;

/** @returns {boolean} true when this press is the tail of a double tap and must be dropped. */
export function _swallowRepeatAdvance() {
  const now = Date.now();
  if (isWithinDoubleTapWindow(_lastAdvancingPressAt, now)) return true;
  _lastAdvancingPressAt = now;
  return false;
}

export function _dispatchMarsa(strip, marsaId, op, { onAck } = {}) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return false;
  const relation = marsaId ? getEfspMarsa(marsaId) : null;
  sendEfspMarsaMutation(actingPositionId, marsaId, relation ? relation.rev : undefined, op, { onAck });
  return true;
}

export function _dispatchCorrelation(strip, op) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  const record = getEfspCorrelationForStrip(strip);
  sendEfspCorrelationMutation(actingPositionId, strip.flightDataId, record ? record.rev : 0, op);
}

/**
 * The Position a controller acts as for a Mutation on this Strip: its Owner, when this controller holds it. Otherwise
 * only a Position the rules let act beside the Owner for this op (crc-sync permission.js mayActBesideOwner; the Block
 * writes come in the snapshot's `nonOwnerBlockWrites`), when this controller holds one. Anything else is null: nothing
 * is sent and the control stays read-only. Never a guess at "some Position this controller holds" (rule 9).
 * Shared by every dispatch helper below (NLA, move, transfer, gestures).
 * @param {object} strip
 * @param {{kind:string, blockId?:string}|null} [op] the op about to be sent, when it may be one a non-owner makes
 * @returns {string|null}
 */
export function _resolveActingPositionId(strip, op = null) {
  if (!strip) return null;
  const positions = getActingPositions();
  if (positions.includes(strip.ownerPositionId)) return strip.ownerPositionId;
  return besideOwnerActingPosition(strip, op, positions, getEfspNonOwnerBlockWrites());
}

/** Pure: the held Position a non-owner rule names for this op on this Strip, or null (exported for the unit test). */
export function besideOwnerActingPosition(strip, op, held, nonOwnerBlockWrites) {
  if (!strip || !op || op.kind !== 'SetBlock' || strip.state === 'DROPPED') return null;
  for (const r of nonOwnerBlockWrites || []) {
    if (r.blockId !== op.blockId || r.stripType !== strip.stripType) continue;
    const p = (r.positions || []).find(id => held.includes(id));
    if (p) return p;
  }
  return null;
}

/**
 * @returns {boolean} whether a Mutation was actually sent — the caller uses it
 *   to give the press its <50ms feedback (§7.9) without lying about a press
 *   that went nowhere.
 */
export function _invokeNla(strip) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return false;
  // F-101 — board-wide, because the Strip this press lands on after a reflow
  // is not the Strip the previous press was about. See _swallowRepeatAdvance.
  if (_swallowRepeatAdvance()) return false;
  sendEfspMutation(actingPositionId, strip, { kind: 'InvokeNla' });
  return true;
}

export function _moveStrip(strip, bayId, rackId, afterStripId, beforeStripId) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'MoveStrip', bayId, rackId, afterStripId, beforeStripId });
}

// Owning Position hand-off (guide §4.5) — distinct from _moveStrip, which
// only ever reorders/relocates a Strip within its CURRENT owner's own Bay
// set. Appends to the end of the destination Bay/Rack; the guide doesn't
// mandate letting the sender pick an exact insertion point mid-transfer,
// and the receiving controller can always reorder locally afterward.
export function _transferStrip(strip, toPositionId, bayId, rackId) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'TransferStrip', toPositionId, bayId, rackId });
}

/**
 * The Bay a hand-back lands in: the receiving Position's Bay implying the
 * Strip's state, else its first Bay implying none — the client mirror of
 * crc-sync's board/placement.js `bayForNewOwner` (the server rule is authoritative).
 * @returns {{bayId:string, rackId:string}|null}
 */
export function _handBackBayFor(strip, toPositionId) {
  const bays = getEfspBays().filter(b => b.positionId === toPositionId && (!b.facilityId || b.facilityId === strip.facilityId));
  const bay = bays.find(b => b.impliesState === strip.state) || bays.find(b => !b.impliesState) || null;
  return bay ? { bayId: bay.bayId, rackId: (bay.rackIds && bay.rackIds[0]) || 'main' } : null;
}

export function _dispatchHandBack(strip, toPositionId) {
  strip = getEfspStrip(strip.stripId) || strip; // F-107 — see _dispatchCoordination
  const actingPositionId = _resolveActingPositionId(strip);
  if (actingPositionId !== strip.ownerPositionId) return; // only its owner hands a line on
  const bay = _handBackBayFor(strip, toPositionId);
  if (!bay) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'TransferStrip', toPositionId, bayId: bay.bayId, rackId: bay.rackId });
}

// Anything on a Strip that is a control of its own. A click, double-click or
// right-click that lands on one of these belongs to the control, never to the
// Strip's select / flip / highlight gestures underneath it.
export const STRIP_CONTROL_SELECTOR = '.efsp-block-editable, .efsp-block-input, button, select, option, label, input, textarea';

// The four paper gestures (guide §7.3, defect D4) — efsp-gestures.js's
// toggleOffset/toggleFlip/setHighlight/setAttention are pure and each
// already dispatch exactly one Mutation; this is the one shared plumbing
// point that resolves actingPositionId and hands them a bound
// sendMutation(strip, op), matching _invokeNla/_moveStrip/_transferStrip's
// own pattern. `extraArgs` covers setHighlight/setAttention's `color` param.
export function _dispatchGesture(strip, gestureFn, ...extraArgs) {
  // F-107 — see _dispatchCoordination. Highlight is dispatched from a popover,
  // and setHighlight reads strip.flags to decide whether this colour clears or
  // replaces, so a stale capture gets that wrong as well as the rev.
  strip = getEfspStrip(strip.stripId) || strip;
  // A dead replica refuses every Flag write (F-303) — say nothing rather than
  // raise a refusal banner for a double-click.
  if (_isRejectedCoordinationReplica(strip)) return;
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  gestureFn(strip, ...extraArgs, (s, op) => sendEfspMutation(actingPositionId, s, op));
  return actingPositionId; // truthy only when dispatched — what the gesture metric counts (docs/adr/0072)
}

/** The first configured Bay for a Position — used as the transfer landing spot when the drop target is a Position tab rather than a specific Bay tab. crc-sync's facility-config.js Bay ordering intentionally puts each Position's "entry" Bay first (e.g. CD's Pending Clearance, GC's Pushback). */
export function _defaultBayFor(positionId) {
  return getEfspBays().find(b => b.positionId === positionId) || null;
}

export function _defaultRackFor(bayId) {
  const bay = getEfspBays().find(b => b.bayId === bayId);
  return bay ? bay.rackIds[0] : 'main';
}
