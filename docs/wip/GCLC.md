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

## Built

Server `ee270873`, client + guide `64632152`. Wire protocol stays 2 (last release speaks 1, already behind). Re-recorded: `wire-surface.json`,
`module-graph-exports.json`, and every freeze golden whose trace carries `positions` (all hub-*/scenario-* plus
tables-nla-coordination-config, tables-wire-message-types).

Shared-file edits: `efsp-ws.js` (set-positions ack/offer, mutation-ack LUAW warning, `directedFor` primaryOnly), `facility-schema.js`,
`facility-config.js`, `index.js` (one line), `position-store.js`, client `efsp-messages.js`, `efsp-panel.js`, `panel/tabs.js`,
`panel/state.js`, `panel/refusal.js`, `radar-panel.js`, `index.html`, `efsp-panel.css`, `docs/efsp-usage-guide.md` (8M and three lines).

Tests rewritten for the removed link: efsp-facility-config, efsp-facility-schema, efsp-metrics-tap (transfer target LC not CD), efsp-ws,
efsp-scenario-manning, efsp-scenario-tactical (A3''). New: efsp-gclc-combination, efsp-combination-rules, e2e/gclc-combine.spec.js.

## Findings

- The offer is made at sign-off only. If LC's Primary signs on after GC left, nothing offers; the selector still works.
- Client `combinedWith` cannot tell a Primary from an Observer acting at LC: an Observer at LC sharing a combined Primary sees the line.
- Not persisted anywhere, so no `stores.js` change.
- `ato tokenize: pathological inputs finish fast` is a timing test that failed once under load, passes alone.
- Squadron to confirm: Incirlik GC 275.8 (GND) and LC 251.0 (TWR) are placeholders; no CD/AP frequencies shipped; USAF (DAFMAN 13-204v3) rule.
