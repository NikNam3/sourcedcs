# 0162: A VFR handoff across Facilities, and a handoff the sender also holds is accepted at once

**Status.** Accepted (2026-11-15). [SOURCE-DEFINED]: the human's request of 2026-11-15 in session ("there is no way to
hand a VFR strip over to center, and from center to any other station"; "if I'm also holding the receiving station on a
handoff, auto accept, not only for VFR but in general"; "count covering too"). Amends ADR 0146 ("Not built: a VFR
handoff across Facilities") and ADR 0122 (who answers a HANDOFF).

## Context

ADR 0146 moved a VFR strip only by `VfrHandoff` inside its own Facility. CENTER has one Position (CTR), so from CTR the
target list was empty, and AP, LC, GC and CD could not name CTR. The FAA has the interfacility case: JO 7110.65BB
¶5-4-5 e names "intrafacility automated handoffs in STARS, ERAM" as the case without verbal coordination of a primary
target, so automated handoffs between facilities (TRACON to ARTCC) exist; flight following (¶7-6-1) hands the VFR on.

A controller who holds both ends of a handoff (Primary at both, or Primary at the Position covering the receiver,
docs/adr/0110) had to accept their own offer. STARS consolidates sectors into one: there is nobody else to answer.
TransferStrip inside a Facility already applied in one step and recorded it as self-coordinated (guide §4.8.3).

## Decision

1. **Cross-Facility VFR handoff.** `VfrHandoff` INITIATE takes an optional `toFacilityId`. The receiver is checked
   against its own Board (a Position there with a VFR Bay and the VfrHandoff grant, staffed or covered). The strip stays
   the sender's and records `vfrHandoff: { toPositionId, toFacilityId, … }`; RECALL is unchanged. Nothing is minted at
   INITIATE: no replica, no release, no check-in (H175: a VFR has no control to release).
2. **ACCEPT across** is sent to the **receiver's own Board** with no Strip: `{ kind: 'VfrHandoff', action: 'ACCEPT',
   fromFacilityId, fromStripId }` (the wire binds a session to the Facility it acts at). That Board mints a VFR strip on
   the same flight data in the receiver's VFR Bay, with the strip's annotations, and then the sender's Board ends its
   strip (DROPPED, audited `VfrHandoffAccepted`, a system entry so the drop counts as the sender's operation, ADR 0065).
   Minting first keeps the flight data, its code, HDG/SPD/ALT and the track binding alive: they are keyed by flight data.
   Both Boards' deltas go out in the one round trip. `board/vfr-transfer.js` is each Board's half.
3. **Auto-accept when the sender holds the receiver** (`self-held.js` `heldByController`): Primary at the receiving
   Position, or that Position is unstaffed and the Position covering it (`consolidatedAt`) is one the sender is Primary
   at.
   - VFR inside a Facility: INITIATE moves the strip at once. Across Facilities: INITIATE mints at the receiver and ends
     the sender's strip in the same Mutation. A full receiving Bay leaves the handoff open with `NOT_AUTO_ACCEPTED`.
   - IFR `HANDOFF` across Facilities: PROPOSE also applies the receiver's ACCEPT (with the receiver's own permission), so
     both sides are ACTIVE at once. **CHECKED_IN stays the controller's** (ADR 0122): control moves when the pilot reports
     on the new frequency, whoever holds both ends.
   - TransferStrip already applies in one step; unchanged.
   - Every auto-accept is recorded `autoAccepted: true, selfCoordinated: true` (guide §4.8.3 rule 4): on the VfrHandoff
     entry, on the PROPOSE entry, and on the receiver's peer ACCEPT entry.

## Consequences

- Wire protocol 7 (`npm run wire:record -- --bump`): the strip's `vfrHandoff.toFacilityId` and the strip-less ACCEPT
  are record contents the scan does not see. Persisted shape: `vfrHandoff` may carry `toFacilityId`.
- An op module's `stripless` may be a predicate over the op (`board/strip-ops.js`).
- crc-desktop offers every VFR Position as a handoff target, its Facility's and the others' (`vfrHandoffTargets`), and
  the target click / label menu accept across Facilities (`acceptVfrHandoff`).
- Not changed: a VFR handoff names one Position; the receiver of a covered Position still lands the strip at that
  Position (as TransferStrip does), not at the cover.
