// Which Strips have just ARRIVED in a Bay this controller works — so the panel
// can count them on the Bay tabs, list the ones that landed out of view, and
// mark the Strip itself until it has been noticed.
//
// No DOM here. efsp-panel.js (tabs, arrivals line) and strip-view.js (the
// Strip's amber edge and "from" line) read this; app.js feeds it every board
// delta. Pure enough for efsp-arrivals.test.js to drive directly.
//
// What counts as an arrival (docs/adr/0057), for a Bay owned by a Position
// this controller holds:
//  - a Strip that MOVES into it from a different Bay, whoever moved it —
//    another controller handing it over, or this controller's own NLA or drag,
//    including between two Bays of the same Position. A controller working
//    several Positions at once is exactly the one who loses track of where a
//    Strip went; OR
//  - a Strip that is new to this client and was made by somebody else: a
//    coordination or TOFI replica, another controller's new Strip.
// Not an arrival: a Strip this controller just created, a reorder within a
// Bay, or any change that leaves a Strip where it was.

const ARRIVAL_FRESH_MS = 30000; // how long a seen arrival keeps its amber edge
const ARRIVAL_LOG_LIMIT = 3;

// stripId -> { bayId, positionId, from, callsign, at, seenAt, bayUnseen, flashed }
const _efspArrivals = new Map();
let _efspArrivalsTouched = 0; // bumped on every change, for cheap "did anything move" checks

/** Where each Strip a delta is about to update currently sits. Call BEFORE applying it. */
function captureEfspPlacement(msg, getStrip) {
  const before = new Map();
  for (const s of (msg && msg.strips && msg.strips.updated) || []) {
    const prev = getStrip(s.stripId);
    if (prev) before.set(s.stripId, { bayId: prev.bayId, ownerPositionId: prev.ownerPositionId });
  }
  return before;
}

/** Who the Strip came from, in the controller's words: the Position or Bay that had it, or the peer that proposed it. */
function _arrivalSource(strip, prev) {
  if (prev && prev.ownerPositionId && prev.ownerPositionId !== strip.ownerPositionId) return prev.ownerPositionId;
  if (prev && prev.bayId && prev.bayId !== strip.bayId) return prev.bayId;
  if (strip.coordination && strip.coordination.peerPositionId) return strip.coordination.peerPositionId;
  if (strip.tofiCoordination && strip.tofiCoordination.peerPositionId) return strip.tofiCoordination.peerPositionId;
  return strip.updatedBy ? 'another controller' : '?';
}

/** A Strip a cross-Facility exchange minted at the receiver (HANDOFF/POINT_OUT/... or a TOFI entry). */
function _isMintedReplica(strip) {
  return !!((strip.coordination && strip.coordination.mintedForCoordination)
    || (strip.tofiCoordination && strip.tofiCoordination.mintedForTofi));
}

/**
 * Records the arrivals in one applied delta.
 * @param {Map} before   captureEfspPlacement's result, taken before the delta was applied
 * @param {object[]} updated  the delta's updated Strip records
 * @param {{heldPositions:string[], myControllerIds:Set<string>|string[], visibleBayId:?string, now:number, callsignOf:(strip)=>string}} ctx
 * @returns {object[]} the arrivals recorded, oldest first
 */
function noteEfspArrivals(before, updated, ctx) {
  const held = new Set(ctx.heldPositions || []);
  const mine = new Set(ctx.myControllerIds || []);
  const found = [];
  for (const strip of updated || []) {
    const prev = before.get(strip.stripId);
    const existing = _efspArrivals.get(strip.stripId);
    // A Strip that has moved on (or been dropped) is no longer "new here".
    if (existing && (existing.bayId !== strip.bayId || strip.state === 'DROPPED')) _efspArrivals.delete(strip.stripId);
    if (strip.state === 'DROPPED') continue;
    if (!held.has(strip.ownerPositionId)) continue;
    if (prev && prev.bayId === strip.bayId) continue;           // it did not move
    // A Strip this controller just made. NOT a coordination/TOFI replica, though: the exchange
    // mints it at the receiving Position, and a controller who holds both ends (UI-A U2: one
    // person on APP and CTR) is still being told that a proposal has arrived there.
    if (!prev && !_isMintedReplica(strip) && (!strip.updatedBy || mine.has(strip.updatedBy))) continue;
    const inView = ctx.visibleBayId === strip.bayId;
    const entry = {
      bayId: strip.bayId, positionId: strip.ownerPositionId,
      from: _arrivalSource(strip, prev),
      callsign: ctx.callsignOf ? ctx.callsignOf(strip) : strip.stripId,
      at: ctx.now, seenAt: null, bayUnseen: !inView, flashed: false,
    };
    _efspArrivals.set(strip.stripId, entry);
    found.push({ stripId: strip.stripId, ...entry });
  }
  if (found.length) _efspArrivalsTouched += 1;
  return found;
}

/** Forget arrivals for Strips that no longer exist on this client (a delta's `gone`). */
function forgetEfspArrivals(stripIds) {
  let changed = false;
  for (const id of stripIds || []) changed = _efspArrivals.delete(id) || changed;
  if (changed) _efspArrivalsTouched += 1;
}

function _isFresh(entry, now) {
  return !entry.seenAt || now - entry.seenAt < ARRIVAL_FRESH_MS;
}

/** The arrival marking this Strip, while it should still show — or null. */
function efspArrivalFor(stripId, now = Date.now()) {
  const entry = _efspArrivals.get(stripId);
  return entry && _isFresh(entry, now) ? entry : null;
}

/**
 * True exactly once per arrival: the first time the Strip is drawn where the
 * controller can see it. The flash plays on that build and never again — a
 * rebuild for any other reason (another Strip arriving, an FDR change) shows
 * the steady amber edge, not a replay. Also starts the 30 s fade-out clock.
 */
function consumeEfspArrivalFlash(stripId, now = Date.now()) {
  const entry = _efspArrivals.get(stripId);
  if (!entry || entry.flashed) return false;
  entry.flashed = true;
  entry.seenAt = now;
  entry.bayUnseen = false;
  return true;
}

/** The controller touched the Strip: it has been noticed. */
function clearEfspArrival(stripId) {
  if (_efspArrivals.delete(stripId)) _efspArrivalsTouched += 1;
}

/** Arrivals in this Bay the controller has not had in front of them yet. */
function unseenEfspArrivalsInBay(bayId) {
  let n = 0;
  for (const e of _efspArrivals.values()) if (e.bayId === bayId && e.bayUnseen) n += 1;
  return n;
}

function unseenEfspArrivalsForPosition(positionId) {
  let n = 0;
  for (const e of _efspArrivals.values()) if (e.positionId === positionId && e.bayUnseen) n += 1;
  return n;
}

/** The controller opened this Bay: everything in it has been seen, and drops off the arrivals line. */
function markEfspBaySeen(bayId) {
  let changed = false;
  for (const e of _efspArrivals.values()) {
    if (e.bayId === bayId && e.bayUnseen) { e.bayUnseen = false; changed = true; }
  }
  if (changed) _efspArrivalsTouched += 1;
}

/** The arrivals line: unseen arrivals in OTHER Bays, newest first. */
function efspArrivalLog(limit = ARRIVAL_LOG_LIMIT) {
  return [..._efspArrivals.entries()]
    .filter(([, e]) => e.bayUnseen)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, limit)
    .map(([stripId, e]) => ({ stripId, ...e }));
}

/** When the next seen arrival's amber edge runs out, so the panel can redraw then. Null when nothing is fading. */
function nextEfspArrivalExpiry(now = Date.now()) {
  let next = null;
  for (const e of _efspArrivals.values()) {
    if (!e.seenAt) continue;
    const at = e.seenAt + ARRIVAL_FRESH_MS;
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}

function efspArrivalsVersion() { return _efspArrivalsTouched; }

function _resetEfspArrivalsForTest() { _efspArrivals.clear(); _efspArrivalsTouched = 0; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ARRIVAL_FRESH_MS, ARRIVAL_LOG_LIMIT,
    captureEfspPlacement, noteEfspArrivals, forgetEfspArrivals,
    efspArrivalFor, consumeEfspArrivalFlash, clearEfspArrival,
    unseenEfspArrivalsInBay, unseenEfspArrivalsForPosition, markEfspBaySeen,
    efspArrivalLog, nextEfspArrivalExpiry, efspArrivalsVersion, _resetEfspArrivalsForTest,
  };
}
