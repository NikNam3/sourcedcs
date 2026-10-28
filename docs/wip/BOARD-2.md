# BOARD-2 working file

## Report (lane BOARD-2, branch `lane/BOARD-2-protocols`, base `363aec9`)

- Coordination and TOFI moved verbatim into `crc-sync/src/efsp/board/coordination.js` (506 lines) and `board/tofi.js` (578). The facade keeps `receiveCoordination*` x4 and `receiveTofi*` x3 as one-line delegations (soak host-core wraps them by name); dispatch calls `this._coordination.applyOp` / `this._tofi.applyOp`.
- `board-store.js`: 2861 -> 1910 lines.
- Suites: crc-sync 2098 tests, 2096 pass, 1 fail (`grpc-client-stream` backoff, a known load-timing test, fails alone too, also at base per BOARD-1) + 1 todo, same counts as the S-M-WIRE merged tree. crc-desktop 866: 865 pass + 1 todo after the allow-list fix (one failure before it).
- Golden: identical (freeze 47/47, board-seam strict on both files, clock-policy green). `soak:selfcheck` PASS. No mutation targets moved code (M1/M2/M4/M8/M15 checked), so no retarget and no `freeze:selfcheck` run. `guard-board-surface.json`: no change (no private member was reached from outside).
- Outside Owns: `crc-desktop/tests/overflight-shared-state-names.test.js` ALLOWED gained `board/coordination.js` (the word INBOUND appears in one moved comment), same as BOARD-1's S-BOARD1-2.
- Deviation: one commit for both clusters, not two (the facade edits were intertwined).

## Design

`Coordination({ rules, state, audit, placement, clock, fdrStore, touch, activeCmid, retire, mutationLog, replicaStateOnReceipt, senderStateOnAccept })`; `Tofi({ rules, state, audit, placement, clock, fdrStore, touch, activeCmid, retire, defaultInitialStateByRole })`.
`touch` and `retire` are late-bound facade callbacks. `activeCmid` and `mutationLog` are functions read late; each collaborator exposes them as private getters `_activeCmid` / `_mutationLog`, so the moved bodies read `this._activeCmid` unchanged. The per-Role tables stay in the facade and are passed as values (stored as `this._replicaStateOnReceipt` etc., so three identifiers changed in the moved text). `this.getRack(` became `this._state.rack(`; `this._retireStrip(` became `this._retire(`.

## Defaults taken (P2)

- Extra deps beyond the briefing: `mutationLog` (PeerGone writes an inline log entry) and the three table values.
- Public method name `applyOp` on both (the only non-`receive*` entry point).
- Duplication for BOARD-3: the receiver-replica mint (random id, rack tail, orderKey, base strip shape) is repeated in `receiveCoordinationProposal` and `receiveTofiProposal`; the track-degradation check appears 3 times. Not pure helpers, left as is.

## Findings for other lanes

- `receiveCoordinationPeerGone` writes `_mutationLog.record` inline (BOARD-1's finding); it could route through BoardAudit.
- Comments in `permission.js`, `fdr-store.js`, `efsp-ws.js` and two tests still name `_applyCoordinationPropose` / `_applyTofiPropose` / `receiveTofiProposal` as board-store.js's; L20's to fix.
