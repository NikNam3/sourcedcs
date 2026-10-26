# 0144: Transit complete by hand, FAA SUA types only, and a prohibited area always in force

**Status.** Accepted (lane U-SUA, 2026-10-26). Rulings: decisions.md **H169** (a range is not airspace), **H170** (SUA is
US-only, the FAA wins over the human's wording), **H171** SUA-Q1 b, Q2 b, Q3 a, Q4 a, Q5 a, Q6 a. **Amends** ADR 0038
(the ICAO `DANGER` type and the `RANGE` type go), ADR 0119 (§3's `RESTRICTED_LIKE` set loses RANGE and DANGER; a
prohibited area alerts whatever its state), ADR 0127/0128 (a transit has a fourth state, `COMPLETED`, and a controller's
end, `EndTransit`), ADR 0136 (AcknowledgeTransit also clears a completed transit, by the decider). FAA quotes and the
file inventory: `docs/parallel/research/sua-types-and-transit-end.md`.

## Context

An approved transit had no end of its own: it lasted until the airspace was released, the flight's last Strip went, the
mission reset or the decider withdrew it. A re-entry hours later was still "approved", and nothing told the side that
restricted the users that the transiting aircraft had passed. The FAA is silent on how a transit ends; the research's
inference is "one passage" (¶9-3-4, 73.15 (c)(2), JO 7610.14A ¶8-1-9 b.1), and the human chose an action by hand.

Two of our six AREA types were not FAA airspace: `DANGER` ("not used in reference to areas within the United States",
P/CG) and `RANGE` (a range is a using agency, the airspace over it is a restricted or warning area: ¶21-3-3 g.1). And a
prohibited area was scheduled and activated like any block, although it is "normally [...] continuous" (7400.2R ¶22-1-4)
and has no controlling agency (¶21-2-5 NOTE).

## Decision

1. **`EndTransit` ("Transit complete").** A transit op on the airspace mutation family, `{ kind: 'EndTransit',
   flightDataId }`, no baseRev like the other transit ops. It ends one **APPROVED** transit. Allowed to the Position
   holding a live Strip of the flight and to a transit decider (`authority/airspace.js` `isTransitDecider`), the same
   rights as the existing ops. Not gated on IFR: a flight that cancelled IFR inside still completes its passage. Every
   check runs before the first write. The audit line is the ordinary one with `op: 'EndTransit'`, `flightDataId` and
   `trigger: 'COMPLETED'`, so every end of a transit (NO_LIVE_STRIP, MISSION_RESET, COMPLETED) is one `EndTransit` line.
   After it, `approvedTransit()` is null: a re-entry raises the ADR 0119 alert and needs a new transit
   (`RequestTransit` and `ApproveTransit` accept a `COMPLETED` transit as they accept a `DECLINED` one).
2. **The decider sees it (SUA-Q2 b).** Ended by a decider, the transit goes at once (the decider knows). Ended by the
   holder, it stays on the record in state **`COMPLETED`** (`completedBy`, `completedPositionId`, `completedAt`; the
   persisted shape lists them) and the decider's card row reads a grey **`transit complete`** with **Acknowledge** until
   a decider sends `AcknowledgeTransit` on it, which removes it. The holder may not acknowledge a completion; the decider
   may not acknowledge a decline (ADR 0136 unchanged). It lifts nothing (H151 MT-Q3 c): the users' restriction is on
   their own Strips. A completed transit is still ended by the release, the reset and the flight's last Strip going (the
   card lists no row without a live Strip, so it could not be acknowledged anyway). On the Strip a completed transit
   draws **no mark** (the holder's side is done) and still suppresses the `COORD` mark until acknowledged.
3. **No Undo.** The other transit ops have none (a transit is a request and a decision on the airspace record, not a
   Board Mutation); a wrong "Transit complete" is fixed by asking again, which the decider may approve at once.
4. **Client.** The Strip's ⋯ offers `Transit complete <name>` for each APPROVED transit when this controller holds the
   Strip's owner, sent as a decider it also holds (so nothing is left to acknowledge), else as the owner
   (`transit-rules.js` `completableTransits`). The card row offers `Transit complete` (`completeAs`: the decider first,
   else the holder) and, on a COMPLETED transit, the decider's `Acknowledge` (`acknowledgeAs`). No keyboard path: the
   other transit ops have none.
5. **AREA types are the FAA's four ATC works: MOA, RESTRICTED, PROHIBITED, WARNING** (SUA-Q3 a). `RANGE` and `DANGER`
   are removed with **no migration**: a `state/` Board snapshot or a standing list holding one stops start-up and names
   the airspace (the existing strict restore, "unknown AREA type"). The squadron retypes it: RESTRICTED over a firing
   range or other hazardous activity over land, WARNING offshore beyond 3 NM, MOA for non-hazardous military flying. The
   range as a using agency stays exactly as it was: `usingPositionId`, the derived RANGES Facility, `controlFrequencyMhz`
   and the FREQUENCY edit scope, none of which ever read the type. Alert, CFA and NSA are not added (SUA-Q4 a); every area
   stays joint use (SUA-Q6 a). The record's `type` is record content, so the wire surface did not change for this item.
6. **A prohibited area is always in force (SUA-Q5 a).** `airspace-schema.js` `ALWAYS_IN_FORCE_TYPES = ['PROHIBITED']`,
   `isAlwaysInForce(def)` and `inForce(record)` (ACTIVE, or always in force), with a client copy in `airspace-validate.js`
   under the parity test. Its record **stays RETURNED** (no new state, no lifecycle): every state op (Schedule, Request,
   Approve, Deny, Delay, Release, Return) is refused with "always in force, never scheduled, activated or released", as a
   JURISDICTION area's are, and definition edits stay open (R3-23 gates only a live record). Every reader that meant "in
   force" asks `inForce`: the entry alert's `activeAreasContaining`, `isActive` (the UNACTIVATED_AIRSPACE_ENTRY
   obligation), `isActiveFor`/`activeContaining` (MRU and regime queries), and ApproveAirspaceEntry's
   `AIRSPACE_NOT_ACTIVE` warning. So it alerts whenever an aircraft is inside without an approved entry, VFR included.
   Entry is approved as before (ADR 0119 §2): by its using agency, or by the Position working the Strip relaying it. It
   keeps its controlling Position only so the alert reaches someone. Strict restore refuses a prohibited record that
   carries a lifecycle (not RETURNED, a window or a pending request) and names it. It still has no transit (¶21-1-8 c).
7. **The prohibited card.** The state word reads **`IN FORCE`** (`displayState`), the card's left edge is drawn as an
   active one, and it offers no Schedule, Activate, Release or Take back. On the map it is solid with the limits only
   (as an ACTIVE area) and the layer menu files it under ACTIVE, so the default menu shows it.

## Consequences

- The wire surface changed (a new airspace op kind): `npm run wire:record` recorded it; WIRE_PROTOCOL stays 2 (the last
  release speaks 1). Freeze goldens were re-recorded (retyped fixtures and a prohibited scenario).
- A transit now has four states; anything that lists transits by state must handle `COMPLETED` (the Strip mark, the card
  row, the COORD suppression and the persisted shape do).
- sourcedcs-web's booking calendar still lets a squadron book a prohibited area; a booking never changes state, so it
  is harmless, but a later lane may hide prohibited areas from booking.
