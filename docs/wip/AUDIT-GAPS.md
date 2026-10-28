# AUDIT-GAPS: wip

## Code as found (step 0, summary)
Sites re-found by symbol: `covering` locals in `board/ops/transfer-strip.js`, `board/ops/carrier-handoff.js`, `efsp-ws.js` (SetPositions); the replica mint in `receiveCoordinationProposal` / `receiveTofiProposal`; the degradation check x3; inline `record` for `SystemCoordinationEnd` (coordination.js), `SystemReassign` x2 (board-store.js), `Archive` (persistence.js); the narrowing in `runway-status-store.js` (`_completeInspection`, `_proposeChange`) and `sfa-store.js` (`_dispatch`); `unauditedGates: false` in the carrier and SFA families. Freeze at base: pass.

## Done
- Item 5: the three `covering` locals are `consolidatedAt`. No `covering` code identifier remains in `crc-sync/src` (comments that use the word "covering" in its English sense are untouched); no test locals remained.
- Item 6 (a TEST change, U18): `efsp-correlation-reconciler.test.mjs` has an explicit `ELIGIBLE` set; ELIGIBLE + `INELIGIBLE_STATES` must equal the union of `STATES_BY_STRIP_TYPE` (no overlap, no stale). Shown failing on a scratch state added to MISSION (`'SCRATCH_STATE'` unclassified), then reverted. The module's comment now says what is tested.
- Item 3: `mintReplica` and `trackDegradationRefusal` in `board/strip-util.js` (seam rule 1 forbids a sibling `replica.js`; board-seam test caught it). Freeze identical.
- Item 4: `BoardAudit#recordSystem(op, strip, tail, {flightDataFirst})`; all four system records go through it (none kept inline). `tests/board-system-audit.test.mjs` compares the JSONL line per site, key order included. `Coordination` and `BoardPersistence` lost their `mutationLog` dep (unused now; Persistence takes `audit`). Freeze identical.
- Item 2: `authority/narrowing.js` (`runwayInspectionRefusal`, `selfCoordinationRefusal`, `sfaJurisdictionRefusal`), exported by `authority/index.js`; they take plain values and return null or the refusal. Texts unchanged. `tests/authority-narrowing.test.mjs`. Freeze identical.
- Item 1 (behaviour): `unauditedGates` removed from both families and the skeleton. Carrier and SFA gate refusals (NOT_HOLDING_POSITION, no store) now reach the Mutation log with `unaudited: true`. `test.todo` is a test over all six families. Subject: `metrics.js` tap gets `hullId`, and `op.rackId` for `efsp-sfa-mutation` (the SFA's rackId is in the op, not on the message, so the approved key-list edit needed one more line). Re-recorded goldens: `scenario-carrier-l17`, `scenario-incirlik-l18`.

## Defaults taken
- The narrowing predicates return the refusal object (null when allowed) so the detail text comes from the registry.
- `mintReplica` takes a `links(now)` callback so the link record sits between `flags` and `createdAt`, keeping the Strip's key order.

## Findings for other lanes
- `docs/wip/WIRE.md` still mentions `unauditedGates`; it is historical.
- Runway-status refusals subject is `facilityId` (already logged), `runwayId` is not.

## Release note
(none: server-side audit only; the Mutation log gains carrier and SFA gate refusals)
