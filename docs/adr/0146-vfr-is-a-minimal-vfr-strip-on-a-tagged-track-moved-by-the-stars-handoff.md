# 0146: VFR is a minimal VFR strip on a tagged track, moved by the STARS handoff

**Status.** Accepted (lane U-VFR-REDO, 2026-10-27). Rulings: decisions.md **H174** (the human's verdict on the VFR build:
"an ifr aircraft that has no flightplan"), **H175** (Desk round 18: VR-Q1 a minimal VFR strip everywhere, VR-Q2 the
STARS automated handoff, never a release; VR-Q3 and VR-Q4 taken as recommended, below). **Supersedes** ADR 0143 §5-§7
(Block 9K, `CreateVfrDeparture`, the CD VFR form) and H136 VQ2/VQ3 as built (VFR = "no clearance", flight following as an
OVERFLIGHT at AP/CTR). ADR 0143 §1-§4 (optional class, `vfrService`) stand. ADR 0145 (suppress one conflict alert) is
H174's "cancellable collision warnings" and is reused unchanged.

## Context

What a controller needs from a VFR aircraft (H174): the track, primary or with a code, correlated with a callsign by
clicking it and giving it a tag; cancellable conflict alerts; heading, speed and altitude assigned and cancelled, with
conformance. Everything else is not needed. The build had a VFR only at CD (`CreateVfrDeparture`, with a direction of
flight nobody uses), on a DEPARTURE Strip already CLEARED that looked like an IFR Strip and said nowhere that it was VFR,
and moved it by IFR steps (Hand Off to AP, the release, CTR).

The FAA, quoted from JO 7110.65BB (faa.gov atc_html, read 2026-10-27):

- ¶7-6-1 a: "Basic radar services for VFR aircraft must include: Safety alerts. Traffic advisories. Limited radar
  vectoring when requested by the pilot. Sequencing ..." No separation responsibility to hand over (H166, H174).
- ¶5-4-5 e: "Initiate verbal coordination to verify the position of primary or nondiscrete targets, **except for
  intrafacility automated handoffs in STARS, ERAM**, or MEARTS". g: "Consider the target being transferred as identified
  on the receiving controller's display when the receiving controller ... accepts the automated handoff." h 5: "To the
  extent possible, transfer communications when the handoff has been accepted."
- ¶5-4-6 a: the receiving controller ensures the target "corresponds with ... an automated data block ... before
  accepting a handoff."
- Marking VFR: chapter 2 section 3 has no "VFR" altitude-block entry; its one VFR rule is ¶2-3-8 c, "For VFR operations,
  indicate the aircraft's transponder and navigation capabilities by adding the appropriate symbol, preceded by a slant".
  The marking a controller reads is the automation's: ERAM's full data block shows `VFR/055` in the altitude field and
  STARS's data block a `V` category letter (`docs/parallel/research/stars.md`, vNAS). That is what the strip copies.

## Decision

1. **A strip type `VFR`** (`authority/strip-types/vfr.js`): states TRACKED and DROPPED, no NLA (`computeNla` null), no
   state owners: its holder works it (`ownerWorksEveryState`, read by `canActOnState` on both sides). It sits in **any
   Bay of its holder** (`anyBay`, `board/placement.js`): the runway queue (its rack is its runway, Block 8A), the pattern,
   the airborne Bay, the overflight Bay; a Bay's implied state never applies to it, and only a Bay with a view of its own
   (the SFA board, a final) refuses it. Its Block Map is the minimal strip: callsign (1), Block 3, the code if any (5, not
   required), the flight's clearance cells for altitude, heading and speed (7A, 9A-VECTOR, 9A-SPEED: OVERFLIGHT's ids,
   so the label menu (ADR 0140), conformance and the confirm-vacated stroke read them unchanged), the runway (8A, the
   departure runway cell), remarks (9E), the working frequency (22). No route, destination, release, void time or
   clearance step. The client draws `VFR` or `VFR/045` in the altitude cell and `VFR · TRACKED` on the tab.
2. **Why a strip type and not a flight-rules field on IFR strip types** (the briefing's default, the supervisor's three
   questions):
   - *The tower.* LC's runway queue, departed, landed and pattern Bays imply DEPARTURE/ARRIVAL states, and the pattern
     ops convert between those types. A field would have kept the VFR on the IFR lifecycle (PUSHBACK → TAXI → RUNWAY_QUEUE
     → DEPARTED → Hand Off to AP) and needed a VFR exception in each NLA table, transfer rule and Bay check: the forced
     steps H174 rejects. With the type, the rules that learn about it are named and none skips it silently:
     `validateBayImpliedTransition` (any Bay, no implied state), `relocateForImpliedState` (never moves it),
     `bayForNewOwner` (its VFR Bay), `runwayRackFor` (Block 8A picks the runway rack), `pattern.js` (JoinPattern and
     LeavePattern move a VFR strip to the Bay implying TRAFFIC_PATTERN or DEPARTED, it stays VFR), `TransferStrip`
     (refused: a VFR moves by handoff), `CreateStrip` (refused: a VFR strip is made by a tag), the surveillance hints
     (TRACKED expects no phase), correlation (TRACKED is eligible), traffic count (TRACKED counts). The takeoff stamp
     reads DEPARTURE's DEPARTED and so never fires on a VFR strip; nothing else keyed on DEPARTURE/ARRIVAL applies to it.
     Walked: GC tags, hands to LC, runway queue by runway, Leave pattern, Closed traffic, landed Bay, back to GC,
     terminated (`efsp-vfr-strip.test.mjs`).
   - *The conversions.* `ChangeFlightRules` changes the type in place, on ConvertToArrival's and JoinPattern's
     precedent: same stripId, flight data, code, track binding and Mutation history; the leg's annotations and flags go
     to `previousLeg`.
   - *Who holds it.* Always `strip.ownerPositionId`; during an open handoff the transferring Position still holds it and
     `strip.vfrHandoff` only names who was asked. One answer for U-CA-OWNER (H176).
   A field on the flight data would also have been a second fact beside the strip type, and a persisted-shape change for
   every flight. **Who is VFR** is therefore read off the strip: `vfr.js` `isVfrFlight(strips)` (a live VFR strip),
   which the airspace-entry alert (MOA/warning area, ADR 0119) and the transit rules (ADR 0128, client and server) read
   in place of `hasNoClearance`. A VFR aircraft given an altitude stays VFR; an IFR flight not yet cleared stays IFR.
3. **Tag a track** (VR-Q3 as recommended): `StartFlightFollowing` (the op name kept) at any Position with a VFR Bay, on the
   ground or in the air: callsign, Block 3 optional, → flight data, a VFR strip TRACKED in the acting Position's VFR Bay
   (or a Bay it names), the contact bound (ADR 0142 rung 1), one Mutation, undoable. **No code** unless asked (`code:
   true`), VR-Q4 as recommended: the binding follows the primary track. `AssignCode` gives a flight that has none a
   computer-assigned discrete code later (¶5-2-7 a). A track already tagged or bound is refused naming the flight.
4. **The VFR Bay** is data: a Bay flag `vfr: true` in the facility file (one per Position at most, `facility-schema.js`).
   Shipped: CD `cd-cleared`, GC `gc-taxi-out`, LC `lc-runway-queue`, AP `ap-overflight`, CTR `ctr-overflight`. A Position
   works VFR strips when it has one; the client reads the same flag off the snapshot's Bays, so neither side names a
   Position id (ADR 0132). The op grant `VFR_OP_KINDS` (StartFlightFollowing, TerminateRadarService, VfrHandoff,
   AssignCode, ChangeFlightRules) is the ceiling: CD, GC, LC, AP, CTR; OPS, PAR, the tactical and carrier Positions none.
5. **The STARS handoff** (VR-Q2): `VfrHandoff` INITIATE (the holder names a Position of its Facility with a VFR Bay, staffed
   or offered, at any time, no lifecycle gate), ACCEPT (the named Position, permission.js `mayActBesideOwner`'s one new row;
   the strip lands in its VFR Bay), RECALL (the holder). Never a release, no "Hand Off to AP/CTR" step. The client shows it
   as a coordination handoff is shown: the receiver's data block blinks and a click on its target accepts
   (`atc-scope.js`), the holder's block carries the receiver's letter, the strip a grey `HO LC`; the data block's menu
   offers ACCEPT, HO <Position>, RECALL. The frequency change is the controller's, said on the radio (H172: the tool
   writes no phraseology).
6. **IFR ↔ VFR** (`ChangeFlightRules`): `to: 'IFR'` (a pop-up IFR) makes the VFR strip one of the IFR strip types its
   holder originates (`canCreateStripType`), in that type's Bay at the holder and the state that Bay holds; a flight with
   no code gets one. `to: 'VFR'` (IFR cancelled, AIM ¶5-1-15) makes any live DEPARTURE/ARRIVAL/OVERFLIGHT a VFR strip
   TRACKED where it is, and ends the IFR altitude, heading and speed assignments (an empty entry, ADR 0058's history),
   since an IFR clearance no longer binds a VFR aircraft. An open coordination, TOFI or VFR handoff is resolved first.
7. **"Radar service terminated"** (`TerminateRadarService`, H136 VQ6) is the end of a VFR strip, at its holder: dropped,
   any code released, any airspace entry cleared, the binding ended.
8. **Removed:** `CreateVfrDeparture` and its grant, Block 9K and `filed.directionOfFlight` (nothing else read it), the CD
   toolbar VFR form and `.vfr`, `hasNoClearance`, `keepIfrHidden`, `FLIGHT_FOLLOWING_POSITIONS`, `VFR_DEPARTURE_POSITIONS`.
   `.ff <track> <CALLSIGN> [TYPE]` and `.term` stay as the keyboard path.

## Consequences

- The wire gains `VfrHandoff`, `AssignCode`, `ChangeFlightRules` and loses `CreateVfrDeparture` (`npm run wire:record`;
  the protocol stays 2, already ahead of the last release). Strips carry `vfrHandoff` (persisted shape).
- **Strict `state/`:** a Board snapshot whose flight data carry `filed.directionOfFlight` (every flight made after ADR
  0143, null or set) no longer starts. Production never ran ADR 0143 (protocol 1 deployed) and its v2 deploy deletes the
  Board; a local Board is fixed by deleting the key (the lane's wip note gives the jq line). A Board holding old
  VFR-departure Strips needs nothing: they are ordinary DEPARTURE Strips.
- Not built: a VFR handoff **across Facilities** (AP to CENTER's CTR). The cross-Facility HANDOFF carries replicas and the
  control-release model (ADR 0101, 0122), which H175 rejects for a VFR; a VFR leaving the Facility's airspace is
  terminated, or handed off once a cross-Facility VFR handoff is designed (a supervisor question, not a default).
- Two controllers tagging one track: the second is refused, naming the first's callsign. A track lost and back: the
  binding is kept while the picture misses it and correlates again when it returns, code or no code (ADR 0142).
