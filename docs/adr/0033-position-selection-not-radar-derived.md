# 0033 — Positions are declared through a dedicated selector, not derived from radar-station selection (guide D-9, retroactive)

## Context

This ADR is written retroactively. The deviation it records was made during WP1A and has governed every Position-related decision since; it has been documented only as a comment in `position-store.js`'s header, and the WP4A briefing has carried *"no ADR for the WP1A position-selection deviation"* as an open gap ever since. docs/adr/0029's session binding now depends on it, which makes leaving it unrecorded an active liability rather than a tidiness matter.

Guide decision **D-9** (§15's register, line 1445):

> | D-9 | **Positions are derived from selected radar stations**, combine freely including across Facilities, and change live during a session | §4.8 in full; §4.1 combination rule replaced; §4.5 occupancy gating |

stated at greater length at line 390:

> **Positions are not signed into. They are derived from the controller's selected radar stations, they combine freely including across Facilities, and the set changes live during a session.** This is a property of the host CRC, it is the normal operating condition under low manning, and it governs §4.8 — read that before implementing anything in this section.

and restated in §4.8 itself, line 544:

> Fixed by the project owner: **a controller's Positions are derived from which radar stations they have selected**, several controllers may hold the same station with one acting as Primary, and **selection changes mid-session with automatic handover**. Combination across Facilities is normal — one person may be `CTR` and `TAC_C2` simultaneously — and under low manning it is the usual case, not the exception.

WP0 was tasked (§0.3) with establishing *how the host exposes radar-station selection, since Position occupancy derives from it*. It found nothing to derive from. docs/adr/0003 records the adjacent findings — assumption A3 (*"A Position/authentication concept exists"*) is false; `auth.js` is pure per-user Casdoor OAuth with no role concept, the WebSocket session carries only `{user, who}` for audit attribution, and `CRCSYNC_COALITION` is one server-wide environment variable — and states the consequence that the Position/occupancy model is net-new, *"plus a dedicated Position-selector UI in crc-desktop, independent of both Casdoor login and the existing radar-visibility checkboxes."* But 0003's own scope was D-1 and A3. D-9 was left uncovered, and it is the decision that sentence actually embodies.

There is a second, independent reason the derivation cannot work as written, and it is the decisive one: **`GND` and `CD` have no associated radar at all.** Ground and Clearance Delivery are not radar positions in any facility, real or simulated. "Derive the Position from which radar station you have selected" is therefore not merely unimplemented but structurally inapplicable to half of Phase 1's four Positions, and would remain so however the host evolved.

## Decision

**Positions are declared, not derived.** A dedicated Position selector in crc-desktop — independent of Casdoor login and of the existing radar-visibility checkboxes — calls `PositionStore.setHeldPositions(controllerId, controllerName, heldPositionIds)` with the controller's **full declared set** each time it changes. `position-store.js`'s header records the deviation and its reason:

> Positions are NOT signed into or derived from radar-station selection in this implementation (guide's D-9 talks about stations, but Ground/Clearance Delivery have no associated radar at all) — see the implementation plan's decision: a dedicated Position selector in crc-desktop calls `setHeldPositions()` with the controller's full declared set each time it changes.

**Declare-the-whole-set, never a delta.** `setHeldPositions` diffs the declared set against what the controller previously held: newly-added Positions are claimed (Primary if unoccupied, else Observer — §4.8.2 rule 3, D18), removed ones released, and the `vacated` list returned so the caller can build the §4.8.6 rule 5 strand warning. The client mirrors that contract exactly, per Facility — `efsp-ws.js`'s `sendEfspSetPositions(facilityId, held)`, documented as *"Sets the FULL held-Position set for ONE Facility — mirrors position-store.js's own 'declare your full set each call' contract."* A delta protocol would make the two sides' notions of "what you hold" driftable, and this is the state every authority check in the system resolves against.

**What D-9 gets right is kept.** The three properties the guide actually cares about all survive the change of mechanism: Positions combine freely including across Facilities (a controller holds sets at `INCIRLIK`, `CENTER` and `TACTICAL` independently, docs/adr/0013), the set changes live mid-session, and several controllers may hold the same Position with one Primary and the rest Observers. Only the *source* of the set differs. The guide's own WP0 rule (*"if a WP0 finding contradicts this guide, the finding wins and this guide MUST be amended by ADR"*) is what this ADR discharges for D-9.

## Alternatives considered

- **Derive where a radar exists and fall back to a selector elsewhere.** Rejected: a split-brain model — `TWR`/`APP`/`CTR` derived, `GND`/`CD` declared — for no benefit. It doubles the ways a Position can be acquired and released, and forces every caller that asks "what does this controller hold" to reason about which half it is in. Worse, it makes the two halves behave differently on the cases that matter most (an abrupt disconnect, a mid-session change), so §4.8.6's vacate and covering-chain handling would need two implementations.
- **Derive Positions from the existing radar-visibility checkboxes** in crc-desktop, as the nearest available analogue to "selected radar stations." Rejected, and this is the sharper version of the same point: those checkboxes control *what a controller can see*, and coupling authority to visibility means a controller silently acquires or loses the right to act on Strips by adjusting their display. docs/adr/0003 already names the Position selector as independent of them for this reason.
- **Wait for the host to grow a real radar-station-selection concept**, implementing D-9 as written later. Rejected: `GND`/`CD` would still have no radar, so the deviation would be permanent regardless; and Position occupancy is a WP1A prerequisite for everything downstream, not something that could be deferred.
- **Sign in as a Position** (the A3 model the guide assumed). Rejected by 0003's finding and by D-9's own first sentence, which this decision agrees with: *"Positions are not signed into."* The selector is a live, changeable declaration, not a login.

## Consequences

- **Every Position built since uses this model with no exception carved out** — `APP` in Phase 2, `CTR` at `CENTER` (docs/adr/0013), and the MRU Positions `TAC_C2`/`AIC`/`GCI`/`JTAC` at `TACTICAL` (docs/adr/0025). No radar-derived subset was ever created, which is what keeps the single `setHeldPositions` path credible as the authoritative answer to "what does this controller hold."
- **docs/adr/0029 depends on this directly.** Binding `actingPositionId` to `positionStore.primaryOf(...) === session.controllerId` is only safe because the selector is a deliberate statement of intent. Had Positions been derived from something a controller changes for an unrelated reason — radar visibility, a display filter — that check would start denying legitimate actions whenever the two purposes diverged. Any future proposal to derive Positions from anything else has to revisit 0029 at the same time.
- Position occupancy remains ephemeral and non-durable (docs/adr/0002, guide §4.8.2 rule 5: *"Primary status is presence state... and it MUST NOT enter the durable Mutation log"*), so the declaration is re-sent on every connect and after every server restart. What is durable is the `actingPositionId` stamped on each Mutation by `board-store.js`/`mutation-log.js` — never the store's own state.
- The guide's §4.8 text stands as written for everything except the derivation mechanism; readers should treat D-9's *"derived from selected radar stations"* as superseded by this ADR and the rest of D-9 as current.
