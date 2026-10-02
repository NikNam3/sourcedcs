# GCLC working file

Lane GCLC, branch `lane/GCLC-combine`, base `8bbe15bc`. ADR 0105. Ruling: H104 (GCLC-1..4).

## Code as found (`8bbe15bc`)

| Thing | Where |
|---|---|
| consolidation config | `efsp-facility-incirlik.json` `consolidation` `{CD:GC, GC:LC, LC:AP, SFA:AP, PAR:AP}`; schema `facility-schema.js` (loop check, unknown Position check) |
| walk | `PositionStore#consolidatedAt` (position-store.js), wired as `rules.consolidatedAt` in `efsp/index.js` |
| sign-on/off | `efsp-ws.js#_handleSetPositions`: `returnConsolidatedStrips` on a newly staffed Position; for each vacated, unstaffed Position with Strips `reassignPositionStrips(from, consolidatedAt)` else warns `routedTo:null` (D19); then `reconcileExchanges()` (ADR 0101) |
| ack | `efsp-positions-ack {signedOn, warnings:[{positionId,count,routedTo,unplaced?}]}`; positions ride in `boardDelta` as `positionStore.getAll()` |
| directed channel | `result.directed` -> `ws-hub.js` -> `directedFor` (ADR 0100 s6), used only by `efsp-undo-voided` |
| frequencies | none per Position; `isValidFrequency` (airspace-schema, 30..400 MHz); SFA pool uses its own UHF range check |
| LUAW | typed DEPARTURE state, owner LC; nothing relates it to staffing |
| client | Position selector `radar-panel.js` (`renderPositionControls`, `renderPositionWarnings`); Position tabs `panels/efsp/panel/tabs.js`; message handler `efsp-messages.js`; mutation `warning` string via `refusal.js` |
| control invariant | `board/handoff-control.js` `assertControlInvariant` / `followOwner`; "covered" is `isStaffed(owner) || consolidatedAt(owner)` |

## Decisions (step 0)

1. **GC's Strips while nobody holds GC: they stay GC's.** No reassignment, no `consolidatedFrom`, D19 warning (`routedTo:null`).
   They are not workable until someone signs on to GC, which is exactly the offer. NLAs into an empty GC are inhibited
   (today's "no receiving Position present" path, now reached because `consolidatedAt('GC')` is null).
2. **Offer** = directed frame `efsp-position-offer` to LC's Primary only; accept = the usual `efsp-set-positions` with GC added.
   No new Mutation, so no undo declaration (ADR 0100 covers Mutations; sign-on/off are not).
3. **Combination** = Primary at LC and also Primary at GC or CD, same controller, same Facility. Warn on the positions ack
   (`combination`) and when a Strip enters LUAW under LC while combined (mutation ack `warning: LUAW_WHILE_COMBINED`).
4. **Control invariant:** unchanged code. A vacated, unstaffed GC no longer follows to LC, so a HANDOFF exchange Strip owned by
   GC (rare: GC owns no exchange) would be CONTROL_UNCOVERED, which is the invariant's alert-not-block path.
5. **Frequencies:** optional facility key `positionFrequencies` (optional like `runwayStatus`, so third-party fixtures need no
   edit; shipped files carry it). Validated by `isValidFrequency`.

## Defaults taken (P2)

- Offer only goes to the Primary at LC, only when GC is left unstaffed with Strips.
- `positionFrequencies` optional, not required.
- LUAW trigger for the sign-on warning: any DEPARTURE at the Facility in RUNWAY_QUEUE or LUAW (draft).

## Squadron values needing confirmation

- Incirlik GC and LC frequencies (placeholders: see `efsp-facility-incirlik.json`).
