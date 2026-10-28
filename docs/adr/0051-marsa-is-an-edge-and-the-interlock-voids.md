# 0051 — MARSA is a fifth store keyed by `marsaId` with `fdrId` participants; the pre-rendezvous interlock voids the relation rather than refusing the clearance, and rendezvous is a controller action because nothing else can know

## Context

Guide §9.2 is WP6's first deliverable and the one it argues for hardest:

> MARSA is a **stateful relationship between two or more Strips**, with a declaring party, a start event, an end event, and auto-void conditions `[Annex §13.1]`.
>
> **The interlock:** issuing a course or altitude change prior to rendezvous **automatically voids MARSA**. Implement this: any `SetBlock` on assigned heading or altitude for a participant before the rendezvous event MUST void the relation, set `voidedBy`, and alert every participant Strip. **This is the highest-value single military interlock available.**

§13 turns that second paragraph into WP6's first acceptance criterion, near-verbatim. The section's own title — *"model it as an edge, not a flag"* — is the design brief, and §9.2 publishes a `MarsaRelation` schema to go with it.

What existed before this slice was the flag the section refuses: `fdr.tofi.separationRegime` (`docs/adr/0025`) has carried a `MARSA` value since WP4A's second slice, settable through Block `SREG`. It says this aircraft is under MARSA and nothing else — not who with, not who declared it, not whether they have joined up, and with no way to end the arrangement as a unit. Two aircraft could each carry `MARSA` while being in no shared arrangement at all, and nothing anywhere would notice.

## Decision

### A fifth store, keyed by `marsaId`, whose participants are `fdrId`s

`crc-sync/src/efsp/marsa-store.js`, peer to `FdrStore`, `BoardStore`, `AirspaceStore` and `CorrelationStore`, and built on the last of those throughout: own `_relations` Map, per-record `rev`, own `_seq`, `setMutationLog`, a `_recordAudit` that logs refusals too, append-only `transitions[]`, one never-throwing `apply()`, `snapshot()`/`restore()`.

One instance shared across every Facility, like `FdrStore` and `CorrelationStore` and for the same reason: MARSA is a fact about a set of airframes, not about one Facility's Board, and a tanker worked by CENTER can be in one relation with a receiver worked by INCIRLIK. There is no D13 replication question — the record has one home.

**Participants are `fdrId`s, never `stripId`s.** This is `docs/adr/0045`'s key choice reused, and the failure it prevents is the same one: an FDR legitimately has several Strips (per-Facility replicas `0013`, a TOFI `MISSION` Strip on the same FDR `0025`, an arrival converted in place `0023`), and a `stripId` participant list would let a tanker's INCIRLIK replica be in the relation while its CENTER replica was not. Two answers to "is this aircraft separating itself" is the defect class, arriving from inside the panel rather than from the track domain.

### Three fields §9.2's own schema does not have

- **`rendezvousAt` / `rendezvousBy`.** Rule 2 arms the interlock *"prior to rendezvous"* and the published schema has no rendezvous field, so as written the interlock has no off switch. Without one, either it never disarms — and a routine altitude assignment voids an AR that joined up twenty minutes ago, making the relation unusable — or it is never armed and rule 2 does nothing.
- **`endedBy` ∈ `END_CONDITION | PARTICIPANT_RETIRED`.** The schema carries `endedAt` with no "why" beside it, and three different things end a relation: the end condition was met, a controller ended it by hand, or the last participants went home. `voidedBy` already distinguishes the void causes; this does the same for the non-void ends. It is load-bearing on screen, not bookkeeping — a tanker landing mid-AR must not render as an interlock firing.
- **`state` ∈ `ACTIVE | ENDED | VOIDED`**, plus `declaredBy`/`declaredPositionId` for attribution.

### Rendezvous is an explicit controller action, not something inferred

The obvious alternative is to derive it from the now server-authoritative radar picture (`0042`): correlate both participants, watch the range close, call it a rendezvous below some threshold.

Refused, and this is the same call WP5 made when it declined to invent a definition of "detected airborne" (`0047`). *Have they joined up* is a judgement a controller or the tanker makes and says out loud, not a proximity-and-closure threshold this codebase gets to pick. Inventing one is defect D11. Worse, the failure is asymmetric: a threshold that fires early **silently disarms the highest-value interlock in the military layer**, and nothing on any screen would say so. One click is cheap; a quietly dead interlock is not.

### The interlock voids; it does not refuse

`voidForAssignment(fdrId, {cause, blockId, …})` runs from `board-store.js`'s `_applySetBlock` **after** the write has succeeded, and returns the voided relation for the caller to broadcast.

The direction is the decision. A controller who needs to turn or climb a joining aircraft must be able to, immediately — refusing the `SetBlock` would leave them arguing with the panel about an aircraft in the air. So the clearance applies and the relation ends under it, which is the conservative outcome: ATC re-assumes separation. Voiding when it need not have is extra work for a controller; *not* voiding when it should have means ATC believes the military is separating two aircraft it has just vectored apart.

That same asymmetry settles two smaller questions. The interlock fires on **any** write to a tagged Block, changed value or not — §9.2 rule 2 says "any `SetBlock`", and detecting "they re-issued the same heading" to suppress it would be cleverness in the unsafe direction. The one carve-out is **`confirmVacated`**, which carries no value and issues no instruction: it records that the aircraft has *left* an altitude assigned earlier (§3.7 rule 3), so firing there would be the interlock going off at the one moment nothing was issued.

It is not a Mutation of its own — no `baseRev`, and the caller is mid-`SetBlock` — but it **is** audited under the `clientMutationId` of the SetBlock that caused it, so the log answers *"why did SHELL71's MARSA void"* with the exact clearance.

### Which Blocks count is Block Map data

`block-map.js` gains `interlock: 'COURSE' | 'ALTITUDE'` metadata and an `interlockFor(role, blockId)` accessor, rather than a list of Block ids held next to the interlock.

Two reasons, and the second is the stronger one. The Block Map is the one place that knows what a Block *means*, and the answer is per-Role: **DEPARTURE's Block 7 is `filed.requestedAltitude` — what the flight asked for — while ARRIVAL's Block 7 is the assigned altitude.** The same id, opposite answers. And a parallel list kept somewhere else is `docs/adr/0041`'s frozen inclusion list in a new costume: correct the day it is written, silently wrong the next time the Block Map grows.

| Role | COURSE | ALTITUDE |
|---|---|---|
| `DEPARTURE` | `20` — guide §6.2's own "Heading" | `21` — guide §6.2's own "Initial altitude" |
| `ARRIVAL` | `9A-VECTOR` | `7` |
| `OVERFLIGHT` | `9A-VECTOR` **(new)** | `7A` **(new)** |
| `MISSION` | none | none |

**OVERFLIGHT had no Block carrying an ATC assignment at all**, only the filed request — so a MARSA participant transiting on an overflight Strip could be vectored or climbed with nothing voiding the relation, and the acceptance criterion would have passed on two Roles while quietly not holding on the third. Both new Blocks are annotation-routed, mirroring ARRIVAL so they carry §3.7's append-only model, and sub-lettered onto their parents per this codebase's convention (`3A`–`3E`, `8A`/`8B`, `9A`–`9F`, `5A`, `14A`–`14D`). `[SOURCE-DEFINED]`, on the same basis as `OVERFLIGHT_BLOCK_MAP`'s whole existence (`0023`).

`MISSION` gets none deliberately: the interlock is about **ATC issuing** a clearance and a MISSION Strip is the MRU-side mission line (§9.8), not a clearance surface. Because participants are `fdrId`s, a void raised on the ATC-side replica of the same flight *is* a void of this flight's relation — tagging a MISSION Block would add a second place the same aircraft can void from, not coverage.

### The relation owns `separationRegime` while it is ACTIVE

Declaring writes every participant's `fdr.tofi.separationRegime` to `MARSA`; ending or voiding writes it back to `ATC`. Done through an injected `setSeparationRegime` closure, the `fdrExists`/`liveStripsForFdr` pattern — the store never holds an `FdrStore`.

It writes at all because guide §4.8.3 says a flight entering the block *"genuinely changes"* the regime — *"ATC stops separating participants ... MARSA takes over"* — and names the failure precisely: *"if a second controller takes TAC_C2 ten minutes later, the state must already be correct, or they inherit a lie."* A relation that left the field alone would **be** that lie.

The other half is `board-store.js` **refusing a direct `SREG` write while an ACTIVE relation holds the FDR**, with a reason naming the declaring callsign and pointing at End/Void MARSA. Refused rather than silently overridden, and the reason names the way out, because ending the relation *is* the action a controller reaching for that Block actually wants — and it sets the regime back as part of doing so. §4.6.3 rule 5's `DUE_REGARD`/`MARSA` exclusion continues to hold by construction: one enum, not two booleans.

### The alert is a field on a record broadcast whole

Rule 2 requires the void to *"alert every participant Strip"*. `voidedBy`/`voidedDetail` live on the relation, which carries its own participant list and is broadcast whole on every change — so every participant Strip renders the alert off one record, with no per-Strip fan-out and no separate retraction mechanism.

This is `docs/adr/0045`'s shape and deliberately **not** `forwarding-obligations.js`'s fire-and-forget alert, which cannot retract at all and whose unretractable badge is still listed as an outstanding defect in the briefing. Copying the nearest precedent would have shipped that bug a second time.

`efsp-marsa-mutation` → `efsp-marsa-ack` + `efsp-marsa-delta` is a **fourth** wire dispatch path with its own `marsaSeq`, following airspace and correlation: a relation is not a Strip and rides no Board's sequence. Its session check is "Primary somewhere" rather than at a named Facility, a stronger version of correlation's reason — a relation's participants can be worked by two Facilities at once, so there is no single `PositionStore` that could be the right one to ask. `_handleAirspaceMutation`'s warning that *"a new dispatch path is exactly where that check gets forgotten"* has now been right three times.

A `SetBlock` that voids a relation, or a `DropStrip` that retires a flight from one, emits a **`marsaBroadcast` alongside the board delta in the same round trip**. Leaving it for the next MARSA op to carry would be `docs/adr/0022`'s bug again: a correct server-side change no client ever hears about.

### A relation survives a restart intact

Unlike a correlation record, which comes back `UNCORRELATED` with its `trackId` nulled. The two differ for a reason worth stating: a correlation names a DCS track id, which the process re-mints on restart, so the persisted value is a lie. A MARSA relation names `fdrId`s and records a verbal declaration a tanker crew made, and nothing about a crc-sync restart makes that declaration untrue. Coming back up with every AR silently reverted to ATC separation would be §4.8.3's *"second controller inherits a lie"* — caused by us.

A relation that comes back with fewer than two surviving participants is `ENDED`, not `ACTIVE`, applying live `RemoveParticipant`'s own rule.

## Alternatives considered

**A `MARSA` flag on the FDR, or a peer list on it.** What §9.2's title refuses. A flag cannot be voided as a unit, cannot say who declared it, and lets two aircraft each claim MARSA while sharing no arrangement. A peer list on the FDR is the edge modelled twice, once per endpoint, with nothing keeping the two copies agreed.

**Refusing the clearance instead of voiding.** Reads as the "safer" interlock and is the opposite. See above.

**Deriving rendezvous from the radar picture.** Refused as D11; see above.

**Making the interlock a list of Block ids in `marsa-store.js`.** `0041`'s lesson, and it would also have got Block 7 wrong, since its meaning inverts between DEPARTURE and ARRIVAL.

**Letting `SREG` and the relation both be authoritative, and rendering a mismatch.** Two answers to one question is the defect class the subsystem exists to prevent. The mismatch would also be invisible to the reachability test, which holds only writable Blocks.

**Rendering MARSA as a Block rather than a badge.** There is no Block target kind for a record keyed by its own id with `fdrId` participants, and a read-only Block is invisible to the very test that exists to catch invisible fields — `correlation-highlight.js`'s three reasons, applied again.

**Reusing `AddParticipant`/`RemoveParticipant`'s effect by voiding and re-declaring.** Loses the start event, the declaring callsign and the whole history of a relation that never ended. These ops exist because *"SHELL71, VIPER13 is joining you"* is a pilot request arriving mid-relation, not a lifecycle state — `docs/adr/0050`'s habit, applied before the fact this time rather than after.

## Consequences

- **§13's first WP6 acceptance criterion is asserted verbatim** in `tests/efsp-scenario-marsa.test.mjs` sortie 1, on its own durable board. crc-sync **984 → 1034** tests, crc-desktop **324 → 358**.
- **Block `SREG` is no longer freely writable.** Any flight in an ACTIVE relation refuses it. Existing behaviour is unchanged for every flight not in one.
- **`fdr.tofi.separationRegime` now has a writer that is not a controller.** It was previously only ever set through Block `SREG`; anything reading it should not assume a controller typed it.
- **A pre-existing client defect fell out of this and is fixed here:** DEPARTURE's Blocks 20 and 21 were labelled **`SCRATCH`** on the Strip. They are the guide §6.2's own "Heading" and "Initial altitude"; it is ARRIVAL and OVERFLIGHT where 20/21 are the radar scratchpads (§6.3 note 2), and that meaning had been copied onto DEPARTURE by mistake. `CONFIRM_VACATED_ELIGIBLE_BLOCKS` has listed DEPARTURE's `21` since Phase 2, which only ever made sense for an altitude. It mattered mildly before and matters more now: a controller typing into a chip labelled `SCRATCH` could void a live AR with no idea why. Labelled `HDG` and `INIT ALT`.
- **`efsp-block-map-parity.test.js` does not compare `interlock`.** It checks existence, `required`, writable-kind, `path` and `provenance` only, so the server can tag a Block and the client will not know. That is fine while the client's only use of the tag is a tooltip it composes itself, and wrong the moment the client needs to warn per-Block — add the assertion then, not before.
- **The interlock is the only thing that reads `rendezvousAt`.** If §9.4's MTR work later wants "has this flight reached its entry fix", it is a different question and should not borrow this field.
- **Nothing has been clicked in a browser.** Browser automation was not available this session either. The reachability tests render the real `bay-view.js` against a DOM stub and prove the badge exists, the popover opens, the controls are enabled when a Position is held and the right op leaves — they prove the wiring, not the pixels. The MARSA badge's placement among the six other Strip-level badges, and the participant highlight's visibility, are unverified by eye.
- **The three badge states are colour-distinguished on purpose**, and none uses the attention red §7.7 rule 4 reserves: armed is the amber tier a broken correlation and an overdue obligation already share, voided is a louder orange because it reports something the controller *just did and may not have meant*, established is a quiet blue. Rule 5's participant highlight is an `outline` rather than a left edge specifically so a Strip can be a voided participant **and** a highlighted peer of the selection at once.
- **`.efsp-coordinate-submit` had no CSS rule at all** and has had none since WP5 — the bind picker's candidate rows have been rendering as default browser buttons inside a dark popover this whole time. Styled here because the MARSA popover uses the same class; a pre-existing cosmetic defect, not one this slice introduced.
