# UNDO: one undo history for every one-click Strip move (10 s)

> Read `docs/parallel/refactor/README.md` (conventions, **Test policy**) and `docs/parallel/lane-rules.md` first; they
> apply here except where this file says the refactor window is closed. Rulings: decisions.md **H85 (R3-57), H95**,
> H96/H98 (vocabulary), S-desk3 (goldens), S-TEST. ADR: **0100** (draft `docs/wip/DES-SPLIT-adr-0100.md`, copy it to
> `docs/adr/0100-undo-every-one-click-move.md` in your first commit). Design notes and the human's open questions:
> `docs/wip/DES-SPLIT.md`. **decisions.md wins over this file; the merged code wins over its file names.**

Written against the **post-refactor layout** (ARCH-plan §2.2) and the **post-RENAME vocabulary**: flight data (today
FDR / `fdr-store.js`), strip type (Role), staffed (occupied), consolidation (covering), `CarrierHandoff`
(`CarrierTransfer`), `Interfacility*` (`Peer*`). Today's behaviour is cited by symbol; step 0 re-finds each one.

| | UNDO-S (server) | UNDO-C (client) |
|---|---|---|
| Starts | after RENAME (W7) and L20 merged; beside SPLIT-JOIN, release+TOFI, AIRSP phase 2 | cut from UNDO-S's **wire commit** (step 3) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-UNDO-S` on `lane/UNDO-S-undo-history` | `/home/nklx/dev/personal/sourcedcs-UNDO-C` on `lane/UNDO-C-undo-slot` |
| ADR | 0100 (copies and finishes it) | none (0100) |
| Size / model | 1.5 lanes / **Opus** (the history contract every later op follows) | 0.5 lane / Sonnet |
| Merge | **first** of the post-refactor Board lanes; SPLIT-JOIN merges after it | with or right after UNDO-S |
| E2E lane | none (server-only) | `E2E_LANE=5` |

## Goal

Every op that moves a Strip in one gesture is undoable for 10 s by the Position that did it. Undo restores every record
the action touched to its state before the action, voids later changes made inside this Facility (audited, the voided
Position told on the Strip), and refuses when a later change came from another Facility, a system change or a Mutation
that reached outside the action's scope. One `UndoHistory` replaces `BoardStore._nlaHistory`'s Undo half; L17's
carrier handoffs, L18's SFA rotation, L19's chip and UI-A's TOFI Exit go through it with their own op kinds (H95).

## Code as found (cite by symbol; line numbers are not stable)

- `_applyInvokeNla` writes `_nlaHistory[stripId] = {invokedAt, prevState, expiresAt: wallNow + 30000}` only when the NLA
  is state-only (`!result.transferTo`, and not the carrier-shaped branch). `_applyUndo` sets the state back with
  `_applySetState`; on a DROPPED Strip it clears `flags.removeIndicator`, calls `reacquireFdr` and forgets
  `_droppedWallAt`. It does **not** reopen MARSA relations ended by `_releaseFdrIfLastStrip` → `retireMarsaForFdr`,
  re-add a carrier stack entry removed by `carrierRetireFlight`, or restore a proposer's link ended by
  `receiveCoordinationPeerGone` (finding F1 in `docs/wip/DES-SPLIT.md`).
- `_nlaHistory.delete` in `_applyTransferStrip`, `_applyCarrierTransfer`, `_applySfaRotation`, `archiveStrip` (ADR 0009).
- `Undo` goes through `_dispatch`'s owner gate and `baseRev` check, and is an `OP_KINDS` grant (`permission.js`).
- The four moves: `_applyCarrierTransfer` (+ `carrierApplyEffect` `MARK_PUSHED` / `REMOVE_NO_CLOSE_UP` on
  `carrier-store.js`); `_applySfaRotation`; `_applySetStateGated` + `_observedDeparture` (audit `bypass`);
  `_applyTofiPropose` `EXIT` + `receiveTofiExitProposal` (`PeerTofiExitProposal`). TOFI has no withdraw action.
- Takeoff stamp: `_stampTakeoffOnStateChange` after every state change (`fdrStore.setTakeoffStamp`).
- Client: `efsp-nla.js` `UNDO_WINDOW_MS = 30000`, `isUndoAvailable` (tests only); `.undo` in `efsp-panel.js`'s
  dot-command handler sends `{kind:'Undo'}` for the selected Strip; `client-mirror-parity.test.js` pins 30 s.
- Traffic count: `isUndoOfDrop` (op `Undo`, addressed `before` DROPPED, `after` not) appends a VOID.

## Owns

**UNDO-S:** new `crc-sync/src/efsp/undo/undo-history.js`; `src/efsp/board/strip-ops.js` (scope capture around the op
table's `apply`, the history record, the Undo op's wiring); `board/ops/undo.js` (rewritten), new
`board/ops/ack-undo-notice.js`; the **`undo` declaration** in every existing `board/ops/*.js` (that key only; for
TOFI, only the `undo` scope in its op module, not `board/tofi.js` internals); `board/placement.js`
(`restorePlacement`, placement-only touches); `board/board-state.js` (`remove(stripId)` with a `gone` ring entry, if
SYNC's `SyncLog` has none; the touch flag); the facade `board-store.js` (`receiveUndoRestore` delegation, the
`undoHistory` option); the flight-data store (`OBSERVED_PATHS`, `restorePaths`, the `VOIDED` cell status, a write hook);
`carrier-store.js` (`UnmarkPushed`, `Reinsert`); `marsa-store.js` (`ReopenRelation`); the authority registry's op-kind
lines for `Undo` (removed from the grants, own `authorize`); `src/efsp/index.js` (`createEfsp`: build the history, pass
it, one line per Board); `efsp-ws.js` Board path (ack `undoable`, `baseRev` not checked for `Undo`); `metrics.js`
(`undos`, `undoVoided`, `undoneTransfers`, and SPLIT-JOIN's `formationSplits`/`formationJoins`, keyed on op kind);
`tests/undo-*.test.mjs`; `docs/adr/0100-*.md`; `docs/wip/UNDO-S.md`.

**UNDO-C:** `crc-desktop/app/public/js/panels/efsp/efsp-nla.js` (window 10 s, `isUndoAvailable`), new
`js/panels/efsp/panel/undo-slot.js`, the `.undo` verb and Ctrl+Z binding in the panel's dot-command / key handling, the
`undone` indicator in the Strip element's indicator row (post-ESM-2a `js/panels/efsp/bay/…`), the ack handling line in
the client EFSP sender, `tests/efsp-undo-*.test.mjs`, `tests/client-mirror-parity.test.js` (the 30 → 10 s literal),
new `e2e/efsp-undo.spec.js`, the Undo lines of `docs/efsp-usage-guide.md`, `docs/wip/UNDO-C.md`.

## Frozen for you

`traffic-count.js` (SPLIT-JOIN owns it: its `stripChangesOf` widens `isUndoOfDrop`; you need nothing else there);
`board/ops/split-formation.js` and `join-formation.js` (SPLIT-JOIN declares their `undo` scope against your contract);
`board/coordination.js`, `board/tofi.js` internals and any control-release op (the release+TOFI lane); the airspace
registry (AIRSP phase 2). One line elsewhere: ask "main".

## Design (ADR 0100 is the spec; the lane decides only what it leaves open)

1. **The history contract** (commit it first, alone: SPLIT-JOIN and the release lane are cut from it):
   - Op module key `undo: 'none' | { label(op, strip), scope(ctx, strip, op) → Scope, created?(result) → Ids }`.
     `Scope = { strips: [{facilityId, stripId}], flightData: [id], codes: [code], carrier?: [{flightDataId}],
     marsa?: [relationId | {flightDataId}] }`.
   - `UndoHistory`: `begin(actionId, meta, scope)` (snapshots), `commit(result)` / `abort()`, `observe(change)` (later
     changes: `{cmid|causedBy, facilityId, kind:'strip'|'flightData', id, placementOnly?, system?}`), `undo(actionId,
     actingPositionId, wallNow) → Plan | refusal`, `expire(wallNow)`. Wall time injected (ADR 0096), never `Date.now()`.
   - A table test: every op module in `strip-ops.js`'s table declares `undo`. A scope-escape check: a touched id outside
     the declared scope marks the record not undoable (logged at warn) and never half-restores.
2. **Restore** per ADR 0100 §3: whole-record Strips (new `rev`, `updatedAt`, `updatedBy`), re-placed after their
   recorded predecessor; created records removed (`gone`); flight data path by path, never `OBSERVED_PATHS`; append-only
   cells `VOIDED`, not truncated; side stores through their compensator with `causedBy`; another Board through
   `receiveUndoRestore`. No op gate re-runs; staffing, Bay capacity and existence are re-checked.
3. **Voiding and blocking** per ADR 0100 §4: inside the Facility voided and listed; outside the scope, from another
   Facility, or a system change: `UNDO_BLOCKED` naming it. A successful undo drops every overlapping record.
4. **Notice** per §6: `undoNotice` on each restored Strip, cleared by the next Mutation on it or `AckUndoNotice`.
5. **Wire** per §7, **audit** per §8 (one entry per Board; `records`, `voided`, `undoneActionId`). The ack carries
   `undoable` for every op whose module declares a scope and whose record committed.
6. **Defaults to keep unless the human answers otherwise:** Q-U1 (b) every Strip move, Q-U2 (a) Strip notice + toast,
   Q-U3 (a) cross-Facility blocks, Q-U4 (a) `VOIDED` entries, Q-U5 (a) only the performing Position, Q-U6 (a) panel slot.

## Steps

0. Install, record suite counts, write "Code as found" in `docs/wip/UNDO-S.md` (every symbol above, re-found on your
   base, plus each op module's real side effects: what it touches beyond its Strip). SendMessage "main" when done.
1. The contract commit (§Design 1): `undo-history.js`, the op-module key with `'none'` on every op, the table test.
   **Tell "main" the commit id**: SPLIT-JOIN is cut from it.
2. Scopes and restore for the H95 four plus `InvokeNla`/`SetState`/`DropStrip`; then `TransferStrip`, `MoveStrip`,
   `ConvertToArrival`, TOFI `PROPOSE`; the three compensators; `receiveUndoRestore`.
3. Wire (ack `undoable`, `Undo {actionId}`, broadcasts), audit, notice, `AckUndoNotice`. **Tell "main" the commit id**:
   UNDO-C is cut from it. Then metrics.
4. Remove `_nlaHistory`'s Undo half (the 400 ms latch stays), ADR 0100 finished, report.

## Tests (S-TEST: file-scoped while working; both unit suites, `soak:selfcheck` once before the report; no Playwright)

Scenario tests in `crc-sync/tests/undo-*.test.mjs`, built from real `BoardStore`s, the flight-data store, carrier and
MARSA stores, a fake mission clock and an injected wall clock (no sleeps):

| # | Scenario | Expect |
|---|---|---|
| U1 | state-only NLA, Undo at +9.999 s / +10.000 s | restored / `UNDO_UNAVAILABLE` |
| U2 | transfer-shaped NLA LC → APP; APP writes an annotation at +3 s; LC undoes at +6 s | Strip back with LC after its predecessor; APP's entry `VOIDED`; `undoNotice.voided` names APP; Undo entry's `voided`; APP's own record dropped |
| U3 | terminal Drop with a MARSA relation, then Undo | relation reopened (MARSA entry, `causedBy`), code re-acquired, COUNT VOIDed |
| U4 | `CarrierHandoff` Commence, and PriFly removal; then the vacated index refilled before Undo | `UnmarkPushed`; `Reinsert`; refusal naming the new occupant |
| U5 | `SfaRotation`, Undo | back on APP's frequency Rack after its predecessor; PAR's Bay empty |
| U6 | L19 chip `SetState` with `observedAirborne`, Undo | state back, takeoff stamp cleared |
| U7 | TOFI Exit from the NLA slot, Undo before / after the MRU answers | both Strips `ACTIVE` `ENTRY` + `InterfacilityUndo` on the MRU Board / `UNDO_BLOCKED` |
| U8 | TOFI `ENTRY` proposal, Undo | MRU replica removed (`gone` in the MRU delta) |
| U9 | Undo by the new owner; JTAC undoes its hand-back | `PERMISSION_DENIED`; restored to JTAC |
| U10 | after A's handoff B proposes an Interfacility HANDOFF; A undoes | `UNDO_BLOCKED` naming B's Mutation |
| U11 | A's Position signs off inside the window; A's session undoes from another Position | `NOT_STAFFED` / `PERMISSION_DENIED` |
| U12 | Undo re-sent with its cmid; the original action re-sent | cached acks, nothing re-applied |
| U13 | restart (restore from snapshot), then Undo | `UNDO_UNAVAILABLE`, new epoch |
| U14 | mission change archives the dropped Strip inside the window | `NOT_FOUND` |
| U15 | `beaconObserved` changes at +2 s | survives the Undo |
| U16 | B assigns FL240 after A's action; Undo | FL240 `VOIDED`, the earlier entry `ACTIVE` |
| U17 | op table | every module declares `undo` |
| U18 | a fake op touching an undeclared Strip | record not undoable, nothing restored |
| U19 | wire through `efsp-ws` | ack `undoable`; `Undo` without `actionId` refused; `baseRev` ignored; broadcast order Board → Interfacility → MARSA → carrier |
| U20 | `AckUndoNotice`; next Mutation | notice cleared |
| U21 | A: NLA1 then NLA2 on one Strip; undo NLA1 / undo NLA2 | both voided back to before NLA1 / only NLA2 reverted |
| U22 | metrics | `undos` by op, `undoVoided`, `undoneTransfers`; §11.1 transfer rate unchanged |

UNDO-C: pure tests for the slot (fill, replace, expiry at 10 s on an injected clock, cleared on epoch change), the
`.undo` / Ctrl+Z dispatch, the `undone` indicator and toast (signed-on Position named), parity 10 s. Playwright: only
`e2e/efsp-undo.spec.js` (two clients: LC hands off, APP edits, LC undoes; APP sees UNDONE) and the specs of the panels
you changed, on `E2E_LANE=5`. Never the full suite.

**Goldens:** the refactor window is closed, so the freeze suite is opt-in and not maintained by behaviour lanes
(S-desk3, ARCH §3.1). Do not run or re-record it. If it is still part of `npm test` on your base, stop and ask "main".

## Acceptance

ADR 0100 committed and marked Built; U1–U22 green; both unit suites green; `soak:selfcheck` all detectors fire (you touch
`board/**` and `efsp-ws.js`); `board-seam` strict for every `board/` file you touched; `_nlaHistory` holds only the
latch; the report lists defaults taken (desk questions unanswered), each op's declared scope, and anything the release
or AIRSP lanes must declare.
