# CONSOL-S working note

Lane CONSOL-S (server half of ADR 0110), branch `lane/CONSOL-S-consol-s`, base `6d85ee45`. ADR 0110 is **built** on the server; it stays
"Proposed" as committed (S4: P4, never edited). Its acceptance is decisions.md S-ARCH-25 plus H111 (the human's answers to Q-C1..Q-C3).

## Step 0: where the ADR's file:line references moved

Base is the ADR's own branch, so the references were re-found rather than re-based: `staffingChanged` is `efsp-ws.js:~400` (ADR 380),
`consolidatedAt` `position-store.js:~90`, `reassignPositionStrips` `board-store.js:~372` (unchanged), `transfer-strip.js:41-50`,
`carrier-handoff.js:46-51`. Baseline unit suite: crc-sync 2498/2498. After: 2535/2535 (+37), freeze 53/53, walk 23/23, crc-desktop 1182
(+1 `todo`, below).

## What was built

- **Config**: `consolidation` is `{ Position: Position[] }` (lists, no loop check, `CV_APP1<->CV_APP2` legal); new required key `handBack`
  (`{}` where empty). A string value is refused with a message naming the fix. Shipped lists (decisions.md H111):
  Incirlik `CD:[GC,LC,AP] GC:[LC,AP] LC:[AP] RSU:[LC] SFA:[AP] PAR:[AP]`; carrier `APP1:[MARSHAL,APP2,PRIFLY]`,
  `APP2:[MARSHAL,APP1,PRIFLY]`, `PRIFLY:[MARSHAL,APP1,APP2]`, `MARSHAL:[APP1,APP2,PRIFLY]`; TACTICAL `consolidation {}` and
  `handBack {AIC,GCI,JTAC -> TAC_C2}`. Each list is one line in its `config/efsp-facility-*.json`; the one test that pins them is
  `efsp-facility-config.test.mjs`.
- **PositionStore**: `consolidatedAt` = first staffed list member, else the staffed `handBack` target; new `hatTakerOf`, `handBackTo`,
  `hasHandBack`, `positionIds`; `getAll()` drops `consolidatedPositions`; **F1**: re-declaring a Position you observe that has no Primary
  makes you its Primary (`_promoteObserver`), only when there is no Primary. Constructor takes `{consolidation, handBack}`
  (`facilityConfig.getHatMaps`).
- **Sign-off** (`staffingChanged`): nothing moves on an ATC Facility; warning `{positionId, count, offeredTo, onRunway?}`
  (`offeredTo: null` = D19); `handBack` sources keep `reassignPositionStrips` and the `routedTo` warning. `returnConsolidatedStrips` kept
  (drains Strips an old Board persisted, `consolidatedFrom` still a known key).
- **Delivery to an unstaffed Position** (`transfer-strip.js`, `carrier-handoff.js`): delivered there with warning `UNSTAFFED_RECEIVER`
  ("Q is unstaffed: offered to P") when a staffed Position is first on Q's list; `NO_RECEIVING_POSITION` otherwise; `handBack` sources
  still route (`rules.handBackTo`, new required rule). `routedTo` is gone from the carrier result.
- **Wire**: Position entries carry `hatOffers: [{positionId, count, onRunway, observersFirst}]` (one serialiser, `positionsWire`, in
  `efsp-ws.js`); a mutation delta carries Positions when the Facility's offers changed in that round trip (before/after compare of all
  Facilities; another Facility's change rides the peer slot); snapshot (and resync snapshot) carry `self: {controllerId}` when a session is
  known. `combination.js`: `NON_LOCAL = OPS, CD, GC, AP, SFA, PAR`, `onRunwayCount`, `hatOffersFor`; `LUAW_WHILE_COMBINED` reads the same list.
- **Metrics**: `transfers.routedToConsolidated` -> `transfers.toUnstaffed` (counts delivered-to-unstaffed and TACTICAL routing).
- **F4**: a HANDOFF replica is minted only at a staffed Position or one a staffed Position is offered (`receiveCoordinationProposal`);
  otherwise `NO_RECEIVING_POSITION`; an offered-but-unstaffed receiver mints and the proposer's ack warns `UNSTAFFED_RECEIVER`. This is
  the stricter reading of ADR 0101's table ("minted at a Position that must be staffed or consolidated"); it changed one behaviour:
  proposing to an empty AP/CTR with nobody offered used to leave a replica nobody could ACCEPT, now it is refused.
- **Soak**: the stranded/hand-back path is replaced by `waitForHat` (`waitingForHat`, `hatTaken` in the report; the client at the next
  Position on CD's list takes the hat after two waits, else the churn-back retakes it). The selfcheck faults had been timing luck
  (`drop-ack` was spent on the R2 message the host dies on, or lost with the restart; `drop-broadcast` was spent on a staffing re-send
  nobody checks); fixed in `host-core.js` (skip the dying send; only a Mutation's broadcast) and `driver.js` (re-arm after a restart).

## Defaults taken (P2)

- Lists as H111 (Q-C1 a, Q-C2 the human's order, Q-C3 a).
- **S1 still open with the human**: GC is on an offer list and an NLA/transfer into an empty GC is delivered and offered. A Position with
  **no list** keeps today's refusal, so a "no" is a config edit (below). Test: `efsp-consol-s1-switch.test.mjs`.
- `efsp-position-offer` is **still sent** (legacy, GC -> LC's Primary only, `combination.legacyOfferAfterSignOff`) so the shipped client has an
  offer until CONSOL-C lands; CONSOL-C removes the frame, the function and the client handler together (that is a wire-surface change then).
- `observersFirst` = the offered Position has Observers (they are offered Primary there before the hat-taker).
- `onRunway` = DEPARTURE in LUAW + ARRIVAL in FINAL, as the ADR; it is also on the sign-off ack warning (extra field).
- RSU->LC, SFA/PAR->AP as ADR 0110 (not asked of the human).
- `wire:record` said "WIRE_PROTOCOL stays 2 (last release speaks 1); surface unchanged": the new fields are not in the recorded surface.
- The crc-desktop parity test `client-rule-tables-parity` (non-local list) is marked `todo` until CONSOL-C: the client list is still GC, CD.

## Supervisor decisions still open

- **S1**. The "no" edit: delete the `"GC": ["LC", "AP"],` line from `crc-sync/config/efsp-facility-incirlik.json` and its pin in
  `efsp-facility-config.test.mjs` (one line each). Effects: GC has no list, so an NLA into an empty GC is inhibited and a transfer refused
  (ADR 0105 decision 4), a GC sign-off warns `offeredTo: null`, CD's list still reaches LC/AP. Nothing else changes. (`efsp-gclc-combination`
  has one assertion that `consolidatedAt('GC')` is `LC`, and `efsp-scenario-manning`/`efsp-ws` tests expect `offeredTo: 'LC'`; they would move with it.)

## Walks (ADR 0110 section 8) in `tests/efsp-consol-hat.test.mjs`

W1 W2 W3 (LUAW only; FINAL covered in the pure `onRunway` test) W4 W5 W6 W7 W8 W9 W10 (snapshot/resync carry the offer and `self`; the
grace window itself is hub-level and not exercised) W11 (grace expiry via `onDisconnect`) W12 (takeover via `isAbsent`) W13 W14 W15 W16
W17 W18 W19 (`resetForMission`): all tested. W6 and W14 set the Strip's owner/state directly (Commence and PriFly create are other lanes'
paths). Also F1, F4, the LC-with-LUAW and AP-INBOUND-to-empty-LC cases, and the combination warnings.

## For CONSOL-C: client files that must change

- `crc-desktop/app/public/js/panels/efsp/panel/combination.js` (offer rows from `positions[].hatOffers` where `self.controllerId` is Primary;
  Observer prompt; "Not now"; Take = `efsp-set-positions`; drop the module-variable offer and the `efsp-position-offer` handler).
- `panels/efsp/combination-rules.js` (non-local list `OPS CD GC AP SFA PAR`, AP/SFA/PAR wording, Primary by `self.controllerId`; then remove the
  `todo` in `crc-desktop/tests/client-rule-tables-parity.test.mjs`).
- `panels/efsp/efsp-messages.js` (drop `efsp-position-offer`, store `self` from the snapshot and the resync reply; positions entries lose
  `consolidatedPositions`, gain `hatOffers`).
- `panels/radar-panel.js` `renderPositionWarnings` (~280): warning `offeredTo` (+ `onRunway`), keep `routedTo` for hand-back.
- `panels/efsp/panel/refusal.js`: warning code `UNSTAFFED_RECEIVER` (also on the proposer's ack for a HANDOFF into an unstaffed Position).
- `panels/metrics-panel.js` (~234): `transfers.toUnstaffed` replaces `routedToConsolidated` (today the line silently disappears).
- `css/efsp-panel.css`; `e2e/gclc-combine.spec.js` (the offer is standing now); `tests/efsp-combination-rules.test.mjs`, `metrics-panel.test.mjs`.
- Then in crc-sync, with the client: remove `legacyOfferAfterSignOff` and the directed frame (`efsp-ws.js`, `combination.js`), re-run `wire:record`.

## What the guide should say (CONSOL-C owns the edit)

As in `docs/wip/CONSOL-DESIGN.md`; additionally: a HANDOFF to an empty receiving Position that nobody is offered is refused
(`NO_RECEIVING_POSITION`), one that someone is offered is minted and the sender is told; a hand-back (TACTICAL) is the only sign-off that moves a Strip.

## Findings for other lanes

- `docs/glossary.md` row for `consolidatedPositions` and `routedToConsolidated` is now stale (both gone); the supervisor's glossary pass.
- `CLAUDE.md` text about `consolidatedAt`/"consolidation" in crc-sync's section still describes the old meaning (supervisor).
