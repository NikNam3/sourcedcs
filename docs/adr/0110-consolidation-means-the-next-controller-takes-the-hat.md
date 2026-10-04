# 0110: Consolidation means the next controller takes the hat; no Strip moves when a Position is left

**Status.** Proposed (draft, lane CONSOL-DESIGN, 2026-10-04). Not built. Ruling: decisions.md **H104 GCLC-3 (a)** ("the other
consolidation links (CD→GC, LC→AP, carrier) get the 'next controller takes the hat' treatment later, as their own design
lane"), building on **ADR 0105** (GC→LC, as built: H104 GCLC-1, GCLC-2, GCLC-4) and S-WAVEB-4's open findings. The
questions only the human can answer are in `docs/parallel/questions-consol.md` (Q-C1 to Q-C3); where this ADR depends on
one it names the question and the recommended default. The build briefing is `docs/parallel/next/CONSOL-BUILD.md`.

Vocabulary is the glossary's (`docs/glossary.md`): Position, staffed, signed on, Primary/Observer, consolidated at, strip
type. **"Taking the hat"** is this ADR's shorthand for one thing: a controller signs on to a vacated Position, so that one
person is "signed on and responsible" for it as well as their own (JO 7210.3 ¶2-2-3). It is a **combination** (guide
§4.8.4): two Positions, two Bay groups, permissions per acting Position. Nothing else.

File:line references are to `efsp-wp5-correlation` at `4f6be7d8`; the build lane re-finds them.

## Decisions at a glance

1. **No Strip moves when a Position is left.** On every consolidation link, a vacated Position's Strips stay its own
   (`ownerPositionId` unchanged, no `consolidatedFrom`). `reassignPositionStrips` is used only by the TACTICAL hand-back.
2. **`consolidation` names who is offered the hat, in order.** Its values become ordered lists:
   `{ "CD": ["GC", "LC", "AP"] }` reads "when CD is unstaffed, the first of GC, LC, AP that is staffed is offered CD". No
   transitive walk. GC→LC returns to this map with the new meaning (it is exactly ADR 0105's offer).
3. **The offer is standing state, not a one-shot frame.** It exists while the Position is unstaffed and owns live Strips,
   and every Position entry on the wire carries the offers made to it (`hatOffers`). So a controller who signs on later,
   reconnects, or resyncs sees it. `efsp-position-offer` is retired.
4. **Observers first.** An Observer left at a Position with no Primary is offered Primary there, and re-declaring the
   Position makes them Primary (guide §4.8.2 rule 2). Today they are stuck (finding F1 below).
5. **A hand-off into an unstaffed Position with a hat-taker is delivered to that Position**, with a warning, instead of
   to the Position it is consolidated at. With no hat-taker it is inhibited, as today.
6. **Combinations warn and never block** (H104 GCLC-1, GCLC-2). The LC warning covers every non-local Position, AP
   included, and is stronger while LUAW is in use. The offer itself previews the warning it would raise.
7. **The TACTICAL links stay reassignments**, renamed `handBack` (MRU lines are handed back, ADR 0080 F10; TAC_C2 can
   work every MISSION state).

## Context

### What the doctrine says

From `docs/parallel/research/gc-lc-consolidation.md` (cited "research §n"; FAA texts read 2026-10-02):

- **Consolidated/combined is one notion: a person, not a move of traffic.** JO 7210.3EE ¶2-2-3: "only one certified air
  traffic controller is signed on and responsible for each open position, to include consolidated positions" (research
  §1.3). Nothing in the order moves traffic from one position to another; the person takes on the other position's job
  (research §1.1 point 1).
- **Positions may be consolidated "in consideration of activity"** (¶2-6-5a), and the watch supervisor/CIC assigns
  positions on the day (¶2-6-1d) (research §1.3). Combining is a position relief like any other, done with care
  (JO 7110.65BB ¶2-1-24, Appendix A: "Extra care should be taken when … combining or decombining positions") (research §1.3).
- **Non-local functions at LC only in significantly reduced traffic** (¶2-6-5b); **never while LUAW operations are
  conducted** (¶2-6-5c, ¶10-3-8a4, which names clearance delivery, flight data and ground control, and allows LC to be
  combined with other *local* positions) (research §1.1, §1.2).
- **Tower and radar approach** functions are "not normally consolidated during non-midwatch operations" (¶2-6-12), and
  consolidating them in the cab needs a facility directive (research §1.3, §1.6). This is the only text we have for
  LC→AP.
- **Clearance delivery may work on the ground frequency** "if the service can be provided without derogating the
  primary function of GC" (¶10-4-6) (research §1.4). CD with GC is the ordinary FAA combination; it needs no warning.
- **Every allocated frequency stays monitored** (¶3-3-3), and combined sectors keep separate frequencies (JO 7110.65BB
  ¶2-1-17) (research §1.5). ADR 0105's `monitoring` already gives a combined controller the union.
- **USAF (DAFMAN 13-204v3) is unverified** (research §1.7); FAA practice is applied to Incirlik by analogy, as in 0105.
- **The carrier: no source in the repo.** The repo holds no CV NATOPS or CATCC text (`grep -rn "NATOPS\|CATCC" docs`
  finds only vocabulary notes that mark Navy claims "unverified", `research/vocabulary.md` line 15). The guide gives the
  four Positions (§4.1), the handoffs (§9.12: "CV_APP1 / CV_APP2 fed alternately from the Marshal stack in push order")
  and a default chain `CV_APP*→CV_MARSHAL→CV_PRIFLY` (§4.8.6 rule 2) with no citation. Everything carrier-side here is
  `[SOURCE-DEFINED]`; Q-C2 asks the squadron.

### What the EFSP does today, per link

The sign-off path: `efsp-ws.js` `_handleSetPositions` (339) and `signOffController` (463, the grace expiry and the
disconnect) both call **`staffingChanged`** (380). For each vacated Position still unstaffed with live Strips it calls
`positionStore.consolidatedAt` (`position-store.js:82`, walks the one-hop map to the first staffed Position) and, when
that finds one, `boardStore.reassignPositionStrips` (`board-store.js:372`): owner rewritten, `consolidatedFrom` stamped,
moved to the new owner's Bay for its state or its first state-free Bay, control follows the owner (392, ADR 0101 decision
7), audited `SystemReassign` `position-vacated`. The ack warns `{positionId, count, routedTo}` (`efsp-ws.js:404`); with
no staffed link it warns `routedTo: null` (410, D19). When the Position is staffed again, `returnConsolidatedStrips`
(`board-store.js:408`) gives back every Strip still carrying `consolidatedFrom` (F10, ADR 0080). A hand-off to an
unstaffed Position is routed the same way (`board/ops/transfer-strip.js:44-50`, reached from the NLA by
`board/ops/invoke-nla.js:61`; the carrier's `board/ops/carrier-handoff.js:46-51`). The NLA gates count a Position present
when `isStaffed(X) || consolidatedAt(X)` (`authority/strip-types/departure.js:137,152,191,206,233`, `arrival.js:49,70`,
`marshal.js:54`). The receiving Position may act only on the states its strip type gives it
(`StripOps#nlaPrecheck`, `board/strip-ops.js:450`; `Placement#validateBayImpliedTransition`, `board/placement.js:232`:
"`<state> is not <owner>'s to advance`").

| Link (shipped) | When the consolidated-into side… | What happens to the vacated Position's Strips | Can it work them? |
|---|---|---|---|
| **CD→GC** (`efsp-facility-incirlik.json:33`) | CD signs off holding PENDING_CLEARANCE, CLEARED, HELD | moved to GC, `gc-coordination` unless a GC Bay implies the state | **HELD only** (`departure.js:37`: `['CD','GC']`). PENDING_CLEARANCE and CLEARED are CD's alone (35-36): parked. OPS's "Send to Clearance" with CD empty passes the gate (137) and lands PENDING_CLEARANCE at GC, frozen |
| **LC→AP** | LC signs off holding RUNWAY_QUEUE, LUAW, DEPARTED (departures), HANDED_TO_TOWER, FINAL, LANDED (arrivals) | moved to AP's `ap-coordination` | **none** (`departure.js:40-42`, `arrival.js:27-29` are `['LC']`). An aircraft lined up on the runway (LUAW) is parked in a radar controller's coordination Bay. GC's TAXI→RUNWAY_QUEUE with LC empty passes (206) and parks at AP; AP's own INBOUND→HANDED_TO_TOWER (`arrival.js:49`) "hands off" to LC and is routed back **to AP itself**, frozen |
| **SFA→AP, PAR→AP** | SFA/PAR sign off | moved to AP (`efsp-scenario-incirlik-l18.test.mjs:280,303`) | a PAR on final: no (usage guide §8L: "the same shape as the Marshal's") |
| **GC** (ADR 0105) | GC signs off | **stay GC's**, `routedTo: null`, and LC's Primary gets the one-shot `efsp-position-offer` (`combination.js:43-50`, sent `efsp-ws.js:363,453`) | yes, once LC takes GC |
| **CV_APP2→CV_APP1** (`efsp-facility-carrier.json:21`) | APP2 signs off with COMMENCED/ON_FINAL/BALL/BOLTER Strips | moved to APP1 | **yes**: both lanes own every lane state (`CV_LANES`, `marshal.js:29`, `final.js:12-14`). New Commences go to APP1 (`carrier/handoffs.js:137-147`) |
| **CV_APP1→CV_MARSHAL** | APP1 signs off (APP2 empty) | moved to the Marshal's `cv-marshal-coordination` | **no**: the Marshal owns LAUNCH and IN_STACK only (`marshal.js:27-28`). ADR 0074 "Consequences" records it |
| **CV_PRIFLY, CV_MARSHAL** | sign off | nothing (no link): `routedTo: null` | — |
| **AIC/GCI/JTAC→TAC_C2** (`efsp-facility-tactical.json:21`) | sign off | moved to TAC_C2, given back on retake (F10) | **yes**: TAC_C2 owns every MISSION state (`mission.js:23-30`) |

**No test vacates a carrier Position** (`grep` of `tests/` for a sign-off with `CV_APP*` finds only `undo-scenarios`).

Findings the walks below rely on:

- **F1. An Observer can be left at a Position with no Primary and no way to become it.** A non-abrupt sign-off sets
  `primary = null` and keeps the Observers (`position-store.js:237-238`); `setSignedOnPositions` signs on only Positions
  newly added to the declared set (166-168), so re-declaring changes nothing; `requestPrimary`/`releasePrimaryTo`
  (199-221) have no wire message (`grep` of `src/` finds no caller). Guide §4.8.6 rule 1 ("they are offered Primary") is
  not built.
- **F2. The 0105 offer is made only at sign-off** (`combination.js:43`, S-WAVEB-4 "LC signing on later gets none"), only
  for GC, only to LC, and is lost on reconnect (the client holds it in a module variable, `panel/combination.js:11`).
- **F4. A HANDOFF replica is minted at its receiving Position whether or not that Position is staffed**
  (`board/coordination.js` reads no staffing; ADR 0101's table says "minted at a Position that must be staffed or
  consolidated"). Not this ADR's to fix; with standing offers it at least prompts someone (W13).
- **F3. The client cannot tell whether it is a Position's Primary**: it guesses its controller id from the Positions it
  acts at (`panel/arrivals.js:72-76`). S-WAVEB-4 "client can't tell Primary from Observer for the COMBINED line".

## Options considered

| | Option | For | Against |
|---|---|---|---|
| A | Keep reassignment on CD→GC, LC→AP, the carrier | No work | Parking: the receiving Position cannot advance most of what lands on it (table above); an aircraft in LUAW parked at AP; "consolidated at" says the FAA thing and does another |
| B | **Hat on every ATC link, offered, standing; TACTICAL keeps hand-back** | The FAA meaning (¶2-2-3) everywhere a Position is ATC; every Strip workable by whoever takes the hat; one mechanism (0105's) generalised; order-insensitive (below) | Wire change; shipped config and goldens change; a Strip can sit at an unstaffed Position (visible, offered) |
| C | Hat, but **automatic** sign-on of the next controller | Literal ¶2-2-3: someone is always "signed on and responsible" | A Primary nobody chose (guide §4.8.2); a controller suddenly holds LC with an aircraft on the runway without knowing it; H104 GCLC-1 chose "offered" for GC |
| D | Hat only where the target cannot work the Strips; reassign where it can (CV_APP2→CV_APP1) | Fewer offers | Two meanings of one word again, chosen per link by a permission accident |

**B.** C contradicts H104's choice for GC and the "warn, never block, never surprise" line; D keeps the confusion this
lane exists to remove. TACTICAL is not ATC (JO 7610.14 ¶8-1-1, guide §4.1 rule 1), its links are hand-backs of lines
TAC_C2 delegated, and its receiving Position can work them, so it keeps the mechanism ADR 0080 designed, under its own name.

## Decision (proposed)

### 1. Config: `consolidation` is an ordered offer list; `handBack` is the TACTICAL reassignment

```jsonc
// efsp-facility-incirlik.json (recommended answer to Q-C1; [SOURCE-DEFINED])
"consolidation": {
  "CD":  ["GC", "LC", "AP"],
  "GC":  ["LC", "AP"],
  "LC":  ["AP"],
  "RSU": ["LC"],
  "SFA": ["AP"],
  "PAR": ["AP"]
}
// efsp-facility-carrier.json (recommended answer to Q-C2; [SOURCE-DEFINED])
"consolidation": {
  "CV_APP1":    ["CV_APP2", "CV_MARSHAL"],
  "CV_APP2":    ["CV_APP1", "CV_MARSHAL"],
  "CV_MARSHAL": ["CV_APP1", "CV_APP2", "CV_PRIFLY"],
  "CV_PRIFLY":  ["CV_MARSHAL"]
}
// efsp-facility-tactical.json (unchanged behaviour, renamed key)
"consolidation": {},
"handBack": { "AIC": "TAC_C2", "GCI": "TAC_C2", "JTAC": "TAC_C2" }
// efsp-facility-center.json: "consolidation": {} (unchanged)
```

- **Schema** (`facility-schema.js`): `consolidation` is `{ Position: Position[] }`, each list non-empty, members of the
  Facility, without the key itself and without repeats. **No loop check**: there is no walk, so `CV_APP1↔CV_APP2` is
  legal (that symmetry is why the shape changes; a one-hop chain cannot express "the other lane first"). `handBack` is
  the old one-hop shape and keeps the loop check; a Position may not be in both maps. Both keys are required (`{}` when
  empty), like `consolidation` today.
- **Why lists, not a walk:** the order is the squadron's choice (Q-C1, Q-C2) and is read off the file, with no
  transitive surprise (today CD's walk would reach AP through two hops nobody wrote down).
- **Why OPS and AP have no list:** OPS is not a control position (guide §4.1 rule 3); AP→CTR would cross a Facility
  (ADR 0013 point 4). A sign-off there warns `offeredTo: null` (D19), as today.
- **RSU→LC returns** (guide §4.8.6 rule 2's default). ADR 0075 left RSU out "so a Strip never strands on it"; with no
  Strip moving, that reason is gone, and LC may be combined with local positions (¶10-3-8a4). No warning.
- **The carrier's PriFly exclusion** (ADR 0064 B1, 0074) had the same reason; Q-C2 decides whether PriFly joins.
- **GC→LC returns to `consolidation`** with the new meaning, which is exactly ADR 0105's offer, now with AP after LC. The
  hard-coded `GROUND`/`LOCAL` offer in `combination.js` goes; `combination.js` keeps only the warnings.

### 2. Sign-off: nothing moves; the ack says who is offered

`staffingChanged` (`efsp-ws.js:380`), for each vacated Position Q still unstaffed with live Strips:

- Q in `handBack`: today's path unchanged (`reassignPositionStrips`, warning `{positionId, count, routedTo, unplaced?}`).
- otherwise: **no write to the Board.** Warning `{ positionId: Q, count, offeredTo }`, where `offeredTo` is the hat-taker
  (§3) or `null` (D19: nobody to offer; guide §4.8.6 rules 3 and 5, warn, do not block).

`returnConsolidatedStrips` stays general (any Strip still carrying `consolidatedFrom` goes home when its Position is
staffed): it serves `handBack` and drains Strips a Board persisted before this change (§9).

`PositionStore#consolidatedAt(Q)` keeps its name and becomes "the first member of Q's list that is staffed, or null" (no
walk). It is still what the NLA gates, `HandoffControl#ownerCovered` (`board/handoff-control.js:100`) and the transfer
routing read. A Primary inside the sign-on grace counts as staffed (a blip is no sign-off, `docs/wip/DESK-SIGNON.md`, `config/sign-on-grace.json`); the grace's
expiry runs `staffingChanged` and re-derives everything.

### 3. Who is offered the hat, and for how long

For an unstaffed Position Q that owns at least one live (non-DROPPED) Strip, an offer stands to:

1. **Q's Observers**, if any: "Q has no Primary. Take it?". Accepting re-sends the controller's declared set unchanged;
   `setSignedOnPositions` gains one rule: **a declared Position the controller observes and that has no Primary makes
   them its Primary** (guide §4.8.2 rule 2, "Selecting a station whose Position has no Primary makes the selector
   Primary"). The longest-waiting Observer is listed first; whoever declares first wins (fixes F1).
2. **The Primary of `consolidatedAt(Q)`**: "Q is unstaffed with N Strips. Take Q as well?". Accepting is the ordinary
   `efsp-set-positions` with Q added (ADR 0105, unchanged): a combination. No new Mutation, no undo (ADR 0100 covers
   Mutations; sign-on is not one).

The offer **stands while its condition holds**: it appears on any change that makes it true (a sign-off, a hand-off into
Q, a Strip minted at Q, a sign-on that makes some Position the first staffed member of Q's list) and lapses when Q is
staffed or owns no live Strip. "Not now" hides it in that client until its count grows or the client reloads; nothing is
recorded on the server.

**Self-offer.** A controller holding GC and CD who signs off CD with Strips is the first staffed member of CD's list. The
offer is derived, so it is made to them; their client hides an offer for a Position it vacated itself in this session
until the count grows (the sign-off ack already said "3 Strips left at CD, nobody signed on"). Nobody else is prompted:
leaving CD's Strips was their decision, and ADR 0105 did the same (`combination.js:46`).

**Only to a Primary** of the target, never to its Observers (the Primary decides what their Position takes on, ¶2-6-1d's
CIC role being the nearest analogue). The snapshot tells each session its own `controllerId` (§6), so the client can
check (fixes F3).

### 4. A hand-off into an unstaffed Position

`TransferStrip` (`transfer-strip.js:44`) and `CarrierHandoff` (`carrier-handoff.js:46`) to an unstaffed Q:

- `consolidatedAt(Q)` staffed: **delivered to Q** (owner Q, Q's own Bay, the op's `bayId`), mutation-ack warning
  `UNSTAFFED_RECEIVER` "Q is unstaffed: offered to P". The offer at P appears in the same round trip (§6). `routedTo`
  is gone from the result.
- otherwise: `NO_RECEIVING_POSITION`, as today. The NLA gates are unchanged, so the NLA is inhibited "no receiving
  Position present" exactly when today.
- Q in `handBack` (TACTICAL): today's routing to the hand-back target, unchanged.

This **changes ADR 0105 decision 4** for GC: with LC (or AP) staffed, CD's CLEARED→PUSHBACK and LC's LANDED→TAXI_IN
into an empty GC are delivered to GC and offered, instead of inhibited. With nobody on LC or AP they are inhibited as in
0105. Supervisor item S1 in the build briefing.

Why deliver rather than inhibit: OPS cannot hand a flight to CD while CD is empty, and inhibiting would never prompt GC
(the offer exists only when CD owns a Strip). Delivering puts the Strip where it belongs and makes the prompt. And it is
**order-insensitive**: "LC signs off, then GC hands a departure to LC" and "GC hands it to LC, then LC signs off" end in the
same state (the Strip at LC, offered to AP). Reassignment never had that property.

### 5. Combination warnings (H104 GCLC-1, GCLC-2: warn, never block)

`combination.js` generalises `NON_LOCAL_TOWER` to **every Incirlik Position but LC and RSU**: `OPS, CD, GC, AP, SFA,
PAR`. When one controller is Primary at LC and any of those:

- always: GC/CD/OPS: "only at significantly reduced traffic (JO 7210.3 ¶2-6-5b)"; AP/SFA/PAR: "tower and radar approach
  combined: not normally outside the midwatch (¶2-6-12)". Plus "monitor every frequency (¶3-3-3)" with the
  `monitoring` list.
- while LUAW is in use (a DEPARTURE at the Facility in RUNWAY_QUEUE or LUAW, `combination.js:18`): "LC must not be
  combined with a non-local position (¶2-6-5c, ¶10-3-8a4)", severe.
- `LUAW_WHILE_COMBINED` on the mutation ack (`efsp-ws.js:328`) uses the same list.

RSU is left out: ¶10-3-8a4 allows LC with other local positions, and RSU has no separation authority (guide §4.1). CD+GC
gets no warning (¶10-4-6). The carrier gets **no combination warnings**: no source in the repo, and inventing one would
be doctrine we cannot cite.

**The offer previews its warning.** An LC offer made to AP's Primary reads "LC is unstaffed with 2 Strips (1 on the
runway). Take LC as well? Tower and radar approach combined (¶2-6-12). LUAW in use (¶2-6-5c)." and is drawn severe when
Q holds a Strip in a runway state. Accepting is never refused.

**"On the runway"** (`onRunway`) counts a DEPARTURE in LUAW and an ARRIVAL in FINAL: the aircraft on, or committed to,
the runway. `runwayStatus.RUNWAY_GATED_STATES` (`runway-status.js:209`) is not reused: it includes DEPARTED, which is
airborne. An LC that signs off with an aircraft in LUAW is the most dangerous case this ADR
touches: the sign-off ack's warning names it ("LC left with VIPER1 in LUAW, offered to AP") and the offer is severe. It
still does not block (guide §4.8.6 rule 5, H104).

### 6. Wire (protocol bump: `npm run wire:record`)

- **Snapshot**: `self: { controllerId }`, per session (`_snapshotMessage` already takes the session). One field.
- **Position entry** (snapshot, every delta that carries `positions`): `hatOffers: [{ positionId, count, onRunway,
  observersFirst }]`, the unstaffed Positions whose hat this Position's Primary is offered, replacing
  `consolidatedPositions` (which listed unstaffed Positions whether or not they held anything). An unstaffed Position's
  own entry needs nothing new: `primary: null` with `observers` is what the Observer prompt reads.
- **Mutation deltas** carry `positions` when any Position's `hatOffers` changed in that round trip (a before/after
  compare of the Facility's offers in the mutation handler; a handful of Positions). Today mutation deltas never carry
  Positions (`efsp-ws.js:134-138`).
- **Positions ack** `warnings[]`: `{ positionId, count, offeredTo }` (consolidation) or `{ positionId, count, routedTo,
  unplaced? }` (`handBack`). `combination` gains the generalised `with`.
- **Mutation ack** warning `UNSTAFFED_RECEIVER` (new code in `refusal-codes.js`/`warnings.js`).
- **Removed**: the `efsp-position-offer` frame and its directed send (`efsp-ws.js:363,453`); the directed channel stays
  (ADR 0100 §6 uses it).
- **Metrics**: `transfers.routedToConsolidated` becomes `transfers.toUnstaffed`; `systemReassigned` then counts only
  hand-backs. Optional, if cheap: guide §4.8.7's "time a Position spends unstaffed while it still owns Strips" from the
  60 s manning tick, now that the condition is real.

### 7. Client

- **The offer row** (`panel/combination.js`): one row per standing offer on a Position where this session's
  `self.controllerId` is Primary, plus one per unstaffed Position this session observes. Text as §3/§5, buttons
  **Take Q** and **Not now**, severe styling when `onRunway > 0` or the preview warning is the LUAW one. The callsigns of
  Q's Strips are listed (display only, from the client's Board copy, which an ATC session reads in full).
- **Sign-off warnings** (`radar-panel.js:280`): "3 Strips left at CD: offered to GC" / "…nobody to offer them to";
  hand-back keeps "routed to".
- **The COMBINED line** and `combination-rules.js`: the generalised non-local list and the AP wording; Primary/Observer
  decided by `self.controllerId` (F3).
- **Mutation warning** `UNSTAFFED_RECEIVER` rendered through `refusal.js` like `LUAW_WHILE_COMBINED`.
- **Metrics panel**: the renamed field.

### 8. Walks: the pilot and controller requests, not only the lifecycle

| # | Walk | Today | Proposed |
|---|---|---|---|
| W1 | CD leaves with VIPER1 CLEARED, GC staffed | VIPER1 parked at GC, "CLEARED is not GC's to advance" | stays CD's; GC offered "Take CD"; GC takes it and presses Push |
| W2 | OPS sends a flight to Clearance while CD is empty, GC staffed | lands PENDING_CLEARANCE at GC, frozen | lands at CD, warning to OPS "CD unstaffed: offered to GC"; GC's offer appears |
| W3 | LC leaves with VIPER1 in LUAW and VIPER2 on FINAL, AP staffed | both parked in `ap-coordination`; AP cannot clear VIPER1 for takeoff | both stay LC's; AP offered LC, **severe** ("2 on the runway", LUAW preview); AP takes LC, gets the LC+AP warning (severe while LUAW), clears VIPER1 |
| W4 | **Sign-off mid-handoff**: GC presses "Hand off to LC" (TAXI→RUNWAY_QUEUE) in the same second LC signs off | either order: parked at AP | either order: at LC, offered to AP (order-insensitive, §4) |
| W5 | **Sign-off mid-handoff, cross-Facility**: CTR has proposed a HANDOFF to AP; AP signs off before ACCEPT | AP has no link: the replica stays at AP, D19 warning | unchanged (AP has no list); the transferring side holds comms and control until ACCEPT (ADR 0101), so invariant I holds; whoever signs on to AP next accepts |
| W6 | **Sign-off mid-handoff, carrier**: Marshal pressed Commence to APP1; APP1 leaves with the Strip COMMENCED, APP2 staffed | moved to the Marshal (APP1's chain skips APP2), frozen | stays APP1's; **APP2** offered APP1 first (Q-C2 a/b); `laneFor` already sends the next Commence to APP2 |
| W7 | **Sign-on later** (GCLC finding): GC leaves with Strips while nobody holds LC or AP; ten minutes later a controller signs on to LC | no offer, ever (0105); Strips wait for someone to think of GC | the sign-on makes LC the first staffed member of GC's list: the re-sent Positions carry `hatOffers` on LC and the offer appears at once |
| W8 | **A combined controller signs off one of two**: A holds LC+GC, signs off GC with 2 taxiing; B holds AP | (0105) stays GC's, no offer (A is LC's Primary) | stays GC's; the derived offer is to A (LC first), A's client hides it (self-vacated); B is not prompted. A's ack: "2 Strips left at GC: offered to LC (you)". If A then signs off LC too, GC's first staffed member is AP: B is offered GC and LC |
| W9 | A holds LC+GC and signs off **LC** with a LUAW departure, keeps GC; B holds AP | parked at AP | stays LC's; B offered LC, severe |
| W10 | **Reconnect inside the 15 s grace** (`config/sign-on-grace.json`) | nothing vacated, no offer | the same: an absent Primary is staffed; no offer is made to or about them. If an offer stood to that controller's Position before the blip, the reconnect snapshot carries `hatOffers` and the row reappears (the 0105 offer was lost) |
| W11 | **Grace expires** while the controller held CD and GC; B holds LC | CD's Strips → GC? No: GC is vacated too; walk CD→GC (unstaffed) ends; D19 for both | CD and GC both offered to B at LC (CD's list reaches LC); one row each |
| W12 | **Takeover during the grace**: B signs on to GC held by absent A (A held CD and GC) | — | B is GC's Primary at once; at grace expiry CD is vacated and offered to B at GC |
| W13 | **The carrier with no Marshal staffed**: APP1 alone; a recovery comes in from CTR (HANDOFF into the Marshal) | the replica is minted at the unstaffed Marshal (`board/coordination.js` has no staffing check, although ADR 0101's table says "staffed or consolidated"); nobody can ACCEPT; D19 is never even warned (no sign-off happened) | Q-C2 (a)/(b): the Marshal's list holds APP1, so the replica at the Marshal makes an offer: APP1 is offered the Marshal hat at once; taking it, they ACCEPT, stack and Commence to themselves (self-coordination, guide §4.8.3). Q-C2 (c): as today. The build lane checks the mint path against invariant I (finding F4) |
| W14 | PriFly leaves with three PATTERN Strips, Marshal staffed | `routedTo: null`, nobody can work them | Q-C2 (b): Marshal offered PriFly (and with it the Case selector); (a)/(c): D19 as today |
| W15 | An Observer sits at GC; GC's Primary signs off (non-abrupt) with Strips; LC staffed | the Observer is stuck read-only (F1); Strips moved? no (GC has no link): stay | Observer offered "GC has no Primary. Take it?" and LC offered GC; whoever declares first is Primary |
| W16 | A pilot calls for taxi while GC is empty and LC is offered GC but has not taken it | the pilot's Strip is at GC (or would be after CD's hand-off) | the Strip is at GC; the LC controller's offer row lists the callsign. A controller who answers on GND without taking the hat cannot advance it, which is the prompt to take it |
| W17 | The hat-taker is an Observer elsewhere: B observes LC (Primary A), A leaves LC | — | B (LC Observer) is offered LC first; AP's Primary second (both shown) |
| W18 | Undo (ADR 0100) of a hand-off delivered to an unstaffed Q within 10 s | — | restores the Strip to the sender; Q's offer lapses if Q now owns nothing (positions ride the undo's delta: offers changed) |
| W19 | A new mission (ADR 0108) clears the Board | — | every offer lapses (no live Strips); nothing else |

### 9. Migration

- **Shipped config**: the four `efsp-facility-*.json` files as in §1 (`center` unchanged), `facility-config.js`'s
  derived RANGES config (`consolidation: {}`, plus `handBack: {}`), the `facility-schema.js` note rewritten (the
  deviations list: GC→LC and RSU→LC return as offers, PriFly per Q-C2, TACTICAL renamed).
- **A persisted Board** with Strips stamped `consolidatedFrom` by the old reassignment: they go home on the next sign-on
  of their Position through the kept `returnConsolidatedStrips`. No migration code. `consolidatedFrom` stays a known
  key in `stores.js` (286) for `handBack`.
- **`state/efsp-facility-*.json`**: a copy in the server's `state/` with string `consolidation` values is now invalid and
  **stops start-up** with the file and the reason (strict state, ADR 0095). No code writes these files today
  (`grep setFacilityConfig src/` finds none), so a copy exists only if someone placed one. RUNBOOK line: check
  `state/` on the server before the deploy, delete or convert. Supervisor item S2.
- **Wire**: `npm run wire:record` (protocol bump); a release of crc-desktop must follow the merge (CLAUDE.md "Wire
  protocol").
- **Usage guide**: §8M becomes "Taking a hat" for every Facility; the Facility table at the top, §8K (carrier), §8L
  (SFA/PAR/RSU) and §8F1's consolidation row change. The ADR 0105 wording "`CD→GC`, `LC→AP`… keep today's behaviour"
  goes.

## Consequences

- No parked Strip remains in the EFSP's ATC Facilities: a Strip is always at the Position whose rules can advance it, and
  whoever takes that Position's hat can. `ap-coordination`, `gc-coordination` and `cv-marshal-coordination` stop
  receiving routed Strips.
- A Strip can now sit at an unstaffed Position, visible to everyone with an ATC read scope and offered to someone. That is
  the guide's D19 condition made explicit; guide §4.8.6 rule 2 ("its Strips MUST route…") is deviated from for every
  ATC link, recorded in §8F1 as ADR 0105 did for GC. Rule 3's intent (never a Strip with nobody to signal) holds through
  the offer and the `offeredTo: null` warning.
- ADR 0105 decisions 1, 2 and 4 are superseded for GC by this ADR's general form (decision 2's behaviour is kept; 4
  changes, §4). 0105's frequencies, `monitoring`, `combinedWith` and the LUAW warnings stay.
- ADR 0101's invariant I is untouched: "staffed or consolidated into a staffed Position" now means "staffed, or a
  staffed Position stands offered its hat". The coverage it guarantees is the same as before: under reassignment the
  covering Position held the Strip but could not advance it; now it is one click from being able to.
- ADR 0074's and 0075's "so a Strip never strands on it" reasons for leaving PriFly and RSU out lapse.
- The soak's `consolidationStranded`/`consolidationHandedBack` path (`tools/soak/driver.js:620-635`) and the CD churn
  (1238) change: a vacated CD's flights wait at CD for the churn-back or for the GC client to take the hat. The
  `soak:selfcheck` must still pass.

## Open (for the human: `docs/parallel/questions-consol.md`)

- **Q-C1** How far do tower hats reach: to AP or not? (recommended: to AP, last)
- **Q-C2** The carrier's hat order, and whether PriFly is on it. (recommended: lanes cover each other, then the Marshal;
  Marshal and PriFly cover each other)
- **Q-C3** When an approach lane leaves, does the other lane take the hat (two frequencies, one controller) or are the
  aircraft moved to the remaining lane's frequency? (recommended: the hat)
