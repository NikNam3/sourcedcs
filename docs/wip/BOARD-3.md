# BOARD-3 working file

## Report (lane BOARD-3, branch `lane/BOARD-3-strip-ops`, base `0bfe9d3`)

```
14078aa docs(BOARD-3): report; crc-desktop tests follow the moved code (parity literals, INBOUND allow-list)
542bc9d refactor(BOARD-3): retarget M1 (strip-ops.js), M2 (ops/convert-to-arrival.js), M4 (ops/set-flag.js)
ec5bb91 refactor(BOARD-3): per-op audit keys are each op's auditFields; BoardAudit.recordAudit takes {head, tail} extras (S-BOARD3-0)
2afb098 refactor(BOARD-3): StripOps and the op table; per-Role tables read from the authority registry
19ed29f test(BOARD-3): freeze guard 1 also reads ctx.rules.X / this.rules.X (S-BOARD3-1)
```

- `board-store.js` 1910 -> 473 lines (facade: applyMutation + idempotency, kernel shims, receive* delegations, Position lifecycle, archive, snapshot/restore). New: `board/strip-ops.js` 511, `board/ops/*.js` (16 files incl. index).
- Suites: crc-sync 2145 -> 2142 (AUTH's 3 pin tests deleted), 2141 pass + 1 todo; the 1 failure is `grpc-client-stream` backoff (known load timing; 6/6 pass alone). crc-desktop 866 -> 866, 865 pass + 1 todo.
- Golden identical (freeze 47/47 at every commit, no UPDATE_GOLDEN); board-seam strict on every `board/` file incl. `strip-ops.js` and `ops/*`; clock-policy green.
- `soak:selfcheck` PASS (all 5 detectors fire). `freeze:selfcheck` 18/18 caught after retargeting M1 (strip-ops.js), M2 (ops/convert-to-arrival.js) and M4 (ops/set-flag.js; briefing listed M6/M15 but those did not move: M6 stays in placement.js, M15 in the facade).
- Structure fixtures: `guard-board-surface.json` loses `_dispatch`, `_retireStrip`, gains `_stripOps` (tests); clock allow-list `_applyInvokeNla` -> ops/invoke-nla.js, `_applyUndo` -> ops/undo.js, `_retireStrip` -> strip-ops.js `retire`.
- Outside Owns (all approved, S-BOARD3-0/1, or the same class as S-BOARD1-2): `board/audit.js`, `board/coordination.js`, `board/tofi.js`, `tests/freeze/freeze-guards.test.mjs` (guard 1 regex; name set 50 = 50 before/after), `tests/authority-registry.test.mjs` (pins deleted), crc-desktop `tests/client-mirror-parity.test.js` (reads ops/invoke-nla.js for the 400 ms / 30 s literals) and `tests/overflight-shared-state-names.test.js` (ALLOWED: board-store.js entry replaced by convert-to-arrival, create-strip, invoke-nla, sfa-rotation, strip-ops; not asked first, please ratify).
- Registry: injected as accessor functions (not required by collaborators). Optional carrier/SFA transfer table: skipped (see Defaults). `console` call left for LOG-2 per the run instruction.
- Supervisor decides: ratify the two crc-desktop test edits.

## Code as found (by symbol, at base `0bfe9d3`, `crc-sync/src/efsp/board-store.js`, 1910 lines)

- Constants: `DEPARTURE_AIRBORNE_STATES` 43, `FLAG_KEYS` 45, `REPLICA_STATE_ON_RECEIPT` 62, `SENDER_STATE_ON_ACCEPT` 65, `DEFAULT_INITIAL_STATE_BY_ROLE` 67.
- `applyMutation` 207 (idempotency, try/catch, stays), `_dispatch` 269-401, `_stampTakeoffOnStateChange` 410.
- Ops: `_applyCreateStrip` 425, `_applyConvertToArrival` 576, `_applyApproveAirspaceEntry` 714, `_applyClearAirspaceEntry` 753,
  `_setStateOwnerRefusal` 775, `_applySetStateGated` 795, `_observedDeparture` 810, `setAirborneObserver` 820,
  `_setStateRunwayRefusal` 829, `_applyMoveStrip` 837, `_assignSfaFrequency` 864, `_drainMarsaRegimeWrites` 882,
  `_marsaVoidFor` 903, `_applySetBlock` 917, `_applyAnnotationSet` 1031, `_applyTransferStrip` 1053,
  `_applyCarrierTransfer` 1161, `_applySfaRotation` 1255, `_applySetFlag` 1296, `_applySetStateOp` 1309, `_applySetState` 1324.
- NLA: `_isRejectedReplica` 1359, `_nlaPrecheck` 1372, `_rejectedReplicaRefusal` 1426, `_rejectedReplicaDetail` 1431,
  `_rejectedReplicaOpRefusal` 1454, `nlaStatusFor` 1477, `_applyInvokeNla` 1513, `_applyUndo` 1589.
- Retirement: `_applyDropStrip` 1609, `_retireStrip` 1635, `_releaseFdrIfLastStrip` 1694.
- Stays: `receive*` delegations 1715-1733, `reassignPositionStrips` 1746, `returnCoveredStrips` 1788, `droppedWallAtOf` 1819,
  `archiveStrip` 1842, `snapshot` 1862, `restore` 1873 (SYNC's).
- Authorization specials before `canMutate`: CarrierTransfer and SfaRotation only (`_dispatch` 292-304). The briefing's
  "observed-departure bypass" is not before `canMutate`: it is inside `_applySetStateGated`, after STALE_REV, NOT_OWNER and the
  inert check, so moving it to `authorize` would reorder refusals. It stays in SetState's `apply` (approved, S-BOARD3-0).
- Audit extras (`board/audit.js` `recordAudit`): SetBlock `blockId,value` (before `action`); after `after`: `selfCoordinated`
  (TransferStrip, and InvokeNla's transfer), `carrierTransfer/carrierTrigger` (CarrierTransfer and InvokeNla), `sfaTransfer/sfaTrigger`
  (SfaRotation), `bypass` (SetState).
- Private members reached from outside: `_retireStrip` (tests: `efsp-scenario-tactical-l23`), `_nlaHistory` (tests, tools/soak host-core),
  `_droppedWallAt` (tests), `_dispatch` (src: other stores' own `_dispatch`, a name collision).
- Callers of the NLA cluster from outside it: Placement's `rejectedReplicaRefusal` (late-bound), Coordination/Tofi `retire`.

## Design

- `board/strip-ops.js` `StripOps(deps)`: `dispatch`, `run(kind, strip, op, meta)`, `auditFieldsFor`, `nlaStatusFor`, `nlaPrecheck`,
  `isRejectedReplica`, `rejectedReplica{Refusal,Detail,OpRefusal}`, `applySetState`, `retire`, `assignSfaFrequency`, `marsaVoidFor`,
  `drainMarsaRegimeWrites`, `setAirborneObserver`. NLA and the ops are one collaborator (they call each other).
- `board/ops/<op>.js`: `{kind, authorize?(ctx, actingPositionId, op), apply(ctx, strip, op, meta), auditFields?(ctx, result, op)}`;
  `meta = {by, actingPositionId, clientMutationId}`. `ops/index.js` lists them; the five coordination kinds share `ops/coordination.js`.
  An op reaches another only through `ctx.run(kind, ...)` (InvokeNla -> TransferStrip/CarrierTransfer, SetState -> DropStrip).
- Wiring: the facade requires `ops/index.js` and hands the list to `StripOps` (the seam test forbids `strip-ops.js` requiring it).
- The facade keeps `_nlaHistory` and `_droppedWallAt` (snapshot, restore, archiveStrip and `droppedWallAtOf` use them, SYNC's regions);
  StripOps reads them through late accessors, because `restore` replaces the Maps.
- Registry: **injection** (chosen). The facade requires `authority/index.js` and passes `initialStateFor` to StripOps and Tofi,
  `replicaStateOnReceipt` and `senderStateOnAccept` to Coordination.
- The rules object is a public `rules` property of StripOps (set from `deps.rules`), because ops read `ctx.rules.X` and the seam
  test's rule 4 allows only the exact statement `this._rules = rules;`.

## Defaults taken (P2)

- Ops moved in one commit, not one or two per commit (the dispatch and the op table are one change); the golden was green at every commit.
- SetState's gating stays in `apply` (see above). `auditFields` returns `{head, tail}`; keys that were `undefined` are now absent from
  the in-memory entry the log listeners see (JSON on disk is identical, the goldens prove it).
- Optional last step (one role-change transfer table for CarrierTransfer and SfaRotation) **skipped**: the two differ in their
  validation order, their refusal wording, `from` shape (`frequencyRackId`), the rack choice and the stack effect; a table would need
  per-row hooks for all of them. Not worth the risk for the lines saved.
- Edits outside Owns, each approved by main: `board/audit.js` (S-BOARD3-0), `board/coordination.js` and `board/tofi.js` (3 read sites
  and the constructor deps, S-BOARD3-0), `tests/freeze/freeze-guards.test.mjs` guard 1 regex (S-BOARD3-1; the collected name set is 50
  names before and after, equal), `tests/authority-registry.test.mjs` (AUTH's pins deleted), `tests/efsp-scenario-tactical-l23.test.mjs`
  (`_retireStrip` -> `_stripOps.retire`; in Owns as "unit tests that reach a moved private member").
- The `console` call in board-store.js (`applyMutation`'s backstop) was left for LOG-2 (the lane rules say LOG-2 converts them; the
  briefing asked BOARD-3 to, but the instruction for this run overrides it).

## Findings for other lanes

- Duplication BOARD-2 named (receiver-replica mint, track-degradation check x3) is untouched: not in the briefing's scope.
- Comments in the moved files still name `_dispatch`, `_applyX` (now module functions in `board/ops/`) and `board-store.js`; L20's to fix.
- `reassignPositionStrips` / `returnCoveredStrips` still write `_mutationLog.record` inline (BOARD-1's finding), SYNC's region.
- The ops use `ctx.touch` (late-bound to the facade `_touch`) and the clock-policy sites follow code: `retire` in strip-ops.js,
  `_applyInvokeNla` in ops/invoke-nla.js, `_applyUndo` in ops/undo.js (TIME-B: file/function only).
