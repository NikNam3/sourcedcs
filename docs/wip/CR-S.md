# CR-S working file

Lane CR-S, branch `lane/CR-S-control-release`, base `0417f7e` (UNDO-S's amended contract). ADR 0101
(`docs/adr/0101-…`). Rulings: H94, H98, H100 (DR-1..DR-11), S-CRS0 (sign-off: repair and alert, never block).

## Code as found (`0417f7e`)

| Briefing symbol | On this base |
|---|---|
| `COORDINATION_EFFECTS.HANDOFF` | `authority/primitives.js`, facade `coordination.js`; read by `board/coordination.js` |
| `Coordination` | `board/coordination.js` (PROPOSE/ACCEPT/REJECT/STAND_BY/CANCEL + `receive*`); PROPOSE/ACCEPT mint/mutate `commsTransferred` |
| HANDOFF op file | `board/ops/coordination.js` (five kinds, one handler) |
| `SetBlock` op | `board/ops/set-block.js`; `interlock` tags in `block-map.js` (`interlockFor`) |
| `REPLICA_STATE_ON_RECEIPT` | `authority/index.js` + strip-type families; carrier row added to the Position family `carrier.js` |
| retirement | `StripOps#retire` (the one path to DROPPED; SetState and InvokeNla go through DropStrip) |
| readers of `commsTransferred` | only `board/coordination.js`, `stores.js` (shape), tests; the client reads only TOFI's own |
| readers of `separationResponsibilityRef` | `board/coordination.js`, the client's POINT_OUT halves (`strip-view.js`), tests |
| sign-off | `efsp-ws.js#_handleSetPositions` + `PositionStore`: warns when the chain bottoms out, never blocks |
| carrier check-in | `rules.carrierAppendFlight` (CreateStrip MARSHAL/IN_STACK); `cv-marshal-coordination` Bay already existed |

Baseline: crc-sync 2133 tests, 1 flaky pre-existing (a jittered retry-delay test in the gRPC client).

## Design as built

`board/handoff-control.js` (`HandoffControl`) is a collaborator wired in `board-store.js` (seam rule 1 forbids sibling
requires): the record, `applyMark`, `applyRelease`, `controlPatch` (the one place control and its ref move),
`settleDueRelease`, `checkControlAxis`, the retirement hooks, `followOwner`, `assertControlInvariant`. A peer write is
one generic `receiveHandoffRecord({patch, auditOp, action})` so both Boards stay in step in one causal chain. Alerts ride
the existing obligations stream (`CONTROL_UNCOVERED`, `CONTROL_REPAIRED` in `forwarding-obligations.js`); the client already
renders any obligation type as an indicator, so both panels show them with no client change (CR-C may give them labels).

## Defaults taken (P2)

- Second TRANSFER_COMMS refused rather than a no-op; CANCEL of an ACTIVE HANDOFF refused after a mark moved.
- Alert = the obligations stream (standing state) plus an audited system entry; no new wire type.
- A repair also writes `coordination.repair` so the notice survives restarts and stands until the holders next move.
- `ControlRelease` is not in `COORDINATION_OP_KINDS` (the client lockstep test pins that list to the five primitives).

## Walks not done / left for others

- Undo (I8 first two parts, the 10 s window): `test.todo`s in `control-release.test.mjs` and `control-release-invariant.test.mjs`;
  the executor is UNDO-S's. The marks declare their scope; UNDO-S's executor should refuse a restore with
  `board.exchangeProblems(stripId)` non-empty (UNDO_BLOCKED) and call `assertControlInvariant` after a restore.
- I3 (join): SJ-S's `JoinFormation` is not on this base; the test drives `retire()`, which is what the join must call.
- SfaRotation owner follow is covered by the shared `followOwner` hook in `StripOps#dispatch`, tested through NLA transfers,
  TransferStrip, consolidation and CarrierHandoff, not through an SFA fixture.
- No manual two-Facility walk with screenshots (that is CR-C's, with the UI).

## Findings for other lanes

- Sign-off only warns (see ADR 0101 differences 6): the architecture check should look at it again.
- CR-C: wire shape is final: `HANDOFF` actions `TRANSFER_COMMS`/`TRANSFER_CONTROL`; op kind `ControlRelease`
  `{action, scopes, climbLimitFt, descentLimitFt, condition, effectiveAt, reason, note}`; `SetBlock.coordinatedWith`; a refused
  control Block returns `VALIDATION_ERROR` whose detail names the Position and scope (the prompt). Strip `coordination` has
  `comms`, `control`, `release`, `releaseRequest`, `repair`. `NOT_STAFFED` is a new refusal reason. Obligations `CONTROL_UNCOVERED`
  and `CONTROL_REPAIRED` need labels. The Marshal needs the receiver-side HANDOFF buttons; carrier replicas are MARSHAL/IN_STACK.
- UNDO-S: `HANDOFF` scope is `strips: [this, peer]`, `flightData: []`; the FULL-release auto control move is inside that scope.
