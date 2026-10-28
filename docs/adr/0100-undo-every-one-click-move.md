# 0100 — Undo for every one-click Strip move, 10 s, restoring the state before the action

**Status.** Built (lane UNDO-S, 2026-10-02; decisions.md H95, H100). Supersedes ADR 0009. Drafted in `docs/wip/DES-SPLIT-adr-0100.md`; "As built" at the end records what the build settled that the draft left open.

Vocabulary is post-RENAME (H96, H98): flight data (today FDR), strip type (Role), staffed (occupied), consolidation
(covering), **CarrierHandoff** (today `CarrierTransfer`), Interfacility (today `Peer*`), beacon code.

## Context

Today (code as found on `165a517`):

- `BoardStore._nlaHistory` holds one `{invokedAt, prevState, expiresAt}` per Strip, written only by a **state-only**
  `InvokeNla` (`_applyInvokeNla`), with a 30 s wall-clock window. `_applyUndo` sets the state back, and for a drop also
  clears the remove indicator and re-claims the code (`reacquireFdr`). Transfer-shaped NLAs are excluded on purpose
  (ADR 0009: reverting the state after ownership moved produced impossible state/owner pairs).
- The one-click moves added since are not undoable at all: L17's four carrier handoffs (`_applyCarrierTransfer`,
  reached by its own op and by the NLA), L18's SFA rotation (`_applySfaRotation`), L19's surveillance chip (a
  `SetState` with `observedAirborne`, `_applySetStateGated`), and UI-A's TOFI Exit in the NLA slot (a TOFI `PROPOSE`
  `EXIT`, `_applyTofiPropose` + the MRU Board's `receiveTofiExitProposal`). Each clears `_nlaHistory`.
- Undoing a terminal drop does not put back what the drop's side effects took: a MARSA relation ended by
  `retireMarsaForFdr`, a carrier stack entry removed by `carrierRetireFlight`, a proposer's link ended through
  `receiveCoordinationPeerGone`.
- The client has no visible Undo. The only entry point is the `.undo` dot-command (`efsp-panel.js`), which sends
  `{kind:'Undo'}` for the selected Strip; `isUndoAvailable` (`efsp-nla.js`) is tested but unused.

The human's ruling (H85 R3-57, H95): every one-click move must be undoable like an NLA so a mis-click is always fixable;
Undo restores the Strip to its state **before** the undone action; changes **another controller** made after it are
**voided**, audited, and that controller is told; the window drops from 30 s to **10 s**. The moves keep their own op
kinds (H95: "routes them through the same undo history rather than renaming them").

## Decision

### 1. What is undoable

Every op module (ADR 0095's op table, `board/ops/<op>.js`) declares `undo` explicitly: `'none'` or an undo scope (§3).
A module without the key fails a table test, so a new op forces the decision (as `COUNTABLE_PRE_DROP_STATES` does).

Undoable **settled H100 (Q-U1 b)**, every op that moves a Strip in one gesture:

| Op | Scope (what is restored) |
|---|---|
| `InvokeNla` (state-only, transfer-shaped, terminal drop, carrier-shaped) | as the op it routes to |
| `SetState` (typed, menu, and L19's chip) | the Strip; flight data (takeoff stamp) |
| `TransferStrip`, `MoveStrip` (drag, menu) | the Strip; flight data (SFA working frequency) |
| `DropStrip` | the Strip; flight data and its code; MARSA relations it ended; the carrier stack entry; an Interfacility link it ended |
| `CarrierHandoff` | the Strip; the carrier stack entry (Commence's push mark, PriFly's removal) |
| `SfaRotation` | the Strip |
| `ConvertToArrival` | the Strip; flight data |
| `TOFI` `PROPOSE` (`ENTRY` and `EXIT`, from the NLA slot or the menu) | the Strip; the MRU Board's Strip (an `ENTRY` replica is removed) |
| `SplitFormation`, `JoinFormation` (ADR 0099) | both Strips; both flight data records; codes; the joiner's MARSA relations |

Not undoable: `CreateStrip` (drop it), `SetBlock`, `SetFlag` (edits, corrected by editing), the coordination
primitives (they have `CANCEL`), TOFI `ACCEPT`/`REJECT`/`TRANSFER_COMMS` (answers to another party, said on frequency),
airspace entry approval, the `ControlRelease` ops of H94, and `Undo` itself (no redo). Exceptions settled in ADR 0101
(DR-5 a, H100): HANDOFF `TRANSFER_COMMS` and `TRANSFER_CONTROL` and TOFI `MARK_ENTERED` are one-click marks and are undoable.

### 2. One undo history, one record per action, 10 s

- **`UndoHistory`** is one object per crc-sync process (all Boards are in-process, ADR 0013), built in `createEfsp` and
  given to every Board's `StripOps`. It is not persisted and not on the wire: a restart loses open windows, as today,
  and mints a new Board epoch, which the client reads as "no undo".
- **One record per undoable action**, keyed by the action's `clientMutationId` (`actionId`). An unkeyed Mutation
  (tests, tools) is not undoable. A record holds: the acting Position and actor, the op kind and label, the wall time it
  was applied, `expiresAt = wallAt + UNDO_WINDOW_MS`, the before-images of its scope, and the ids of what it created.
- **`UNDO_WINDOW_MS = 10_000`** (H95), a named constant (a ruling, not tuning), measured on the **wall clock** (a pure
  duration, R3-16/ADR 0096), injected, never a bare `Date.now()`. The client mirror changes with it (PARITY test).
- The 400 ms double-tap guard stays where it is (a debounce, not history).
- A Strip may sit in several records (A's handoff, then B's state change). Undo names the action, not the Strip.

### 3. Undo scope and restore

- Each undoable op module declares `undo.scope(ctx, strip, op) → scope` before it applies (Strips on this Board,
  Strips on another Board it will write, flight data ids, the code, a carrier stack entry, MARSA relations it may end),
  and `undo.created(result) → ids` after. The history snapshots the scope **before** the op runs. A test (and a
  development-time check in the history) asserts that what the op touched is inside its declared scope; an action whose
  footprint escapes its scope is recorded as not undoable, never restored partly.
- **Restore is whole-record, not op-specific inverse logic.** Undo puts back every scoped record as it was before the
  action:
  - **Strip:** every field from the before-image except `rev` (new `rev` = current + 1), `updatedAt` (now, mission
    clock) and `updatedBy` (the undoer). Placement is not restored as a raw order key: Placement puts the Strip back in
    its recorded Bay and Rack directly after the Strip that preceded it at action time (or first, if that one is gone).
    Rebalance re-keys of neighbours are placement-only and never count as changes (§4).
  - **Created records** (a split part, an ENTRY replica on the MRU Board) are removed: the sync ring gets a `gone`, the
    flight data is archived at once, the code released.
  - **Flight data** is restored path by path, for the paths the action and the voided Mutations wrote. Paths written by
    surveillance (`identity.beaconObserved` and any other observed path the flight-data store lists in
    `OBSERVED_PATHS`) are never restored.
  - **Append-only cells** (clearance and Strip annotations, guide §3.7; JO 7110.65 2-3-1 forbids erasing an item) are
    not truncated: entries added by the action or by a voided Mutation get status **`VOIDED`** (with `voidedBy`
    `actionId`), and the entry they superseded is `ACTIVE` again **settled H100 (Q-U4 a)**.
  - **Side stores** through one compensator each, owned by that store and audited there with `causedBy`: the code
    allocator (`reacquire`, D23: a code another flight took meanwhile warns, never steals), the carrier store
    (`UnmarkPushed`, `Reinsert` at the vacated index; refused if the index was refilled), the MARSA store
    (`ReopenRelation` for a relation ended by this flight's retirement).
  - **Another Board's Strip** through its facade: `receiveUndoRestore({ causedBy, images })`, which restores and writes
    one `InterfacilityUndo` audit entry there.
- **Undo does not re-run the op gates** (NLA gates, runway inhibit, Bay-implied checks): it returns to a state that was
  valid a few seconds ago. It does check what can have changed underneath it, and refuses with the reason:
  the restored owner Position is no longer staffed (`NOT_STAFFED`); a restored Bay is now full (`BAY_FULL`); a scoped
  Strip was archived (ADR 0082 rule 4: `NOT_FOUND`).
  It also refuses when the restore would break the **control invariant** of ADR 0101 (settled H100 DR-6): a restored
  HANDOFF record that names a communications or control holder whose Strip has since been retired (for example the
  transferring side dropped its Strip after the marked step, which moved control to the receiver) is refused with
  `UNDO_BLOCKED`, because restoring it would leave a live flight with no live holder of communications or control.

### 4. Later changes: voided inside the Facility, blocking across it

From the moment an action is recorded until it expires, the history attributes every later change to the records in
its scope (through the Board's touch callback with the active `clientMutationId`, the Interfacility `causedBy`, and the
flight-data store's write hook). Order-key-only touches from a rebalance are ignored.

- **A later Mutation on this Facility's Board** whose footprint stays inside the scope is **voided** by the restore.
  The history lists it: `{ clientMutationId, op, actingPositionId, actorId, at }`. This is H95's rule, and it covers
  the acting controller's own later edits too.
- **A later Mutation that reached outside the scope** (for example B joined the split part into a third flight) makes
  the action **not undoable**: Undo is refused with `UNDO_BLOCKED` naming that Mutation. Restoring the scope alone
  would leave the third record inconsistent, and voiding it would widen the undo beyond what A did.
- **A later change from another Facility** to a scoped record (an Interfacility response, a coordination or TOFI
  answer, a flight data write through another Facility's Strip) **blocks** the undo **settled H100 (Q-U3 a)**. Coordination in
  flight is the case that matters: an undo may withdraw A's own unanswered proposal (TOFI Exit pressed by mistake, before
  the MRU answers: both Strips go back to `ACTIVE ENTRY`), but once the other Facility has answered, the exchange is
  undone through the protocol, not by voiding another Facility's controller.
- **A system change** to a scoped record (a Position signed off and its Strips reassigned, `SystemReassign`) blocks;
  archiving removes the record (`NOT_FOUND`).
- When the undo succeeds, every **record** whose action is voided or whose scope overlaps is dropped from the history:
  B's own undo of a voided action is no longer offered.

### 5. Who may undo

Only **the Position that performed the action** **settled H100 (Q-U5 a)**, whoever owns the Strip now (after a handoff the
receiver owns it; the sender is the one who mis-clicked). The `Undo` op has its own `authorize` (the record's acting
Position equals the acting Position), and is no longer an op-kind grant, so a Position whose only op is a hand-back
(JTAC) can still undo it. The session must be signed on to that Position (efsp-ws's existing binding).

### 6. The voided controller is told by a panel message only

**settled H100 (Q-U2 b)**: a message on the voided controller's panel, nothing on the Strip. The Strip carries **no**
`undoNotice`, no UNDONE indicator and no acknowledge op (`AckUndoNotice` does not exist); nothing about an undo is
persisted on a Strip or in the Board snapshot.

- When an Undo voids another Position's Mutations, the server sends **one targeted message** `efsp-undo-voided
  { actionId, undoneOp, undoneLabel, undoneBy: <Position>, at, voided: [{ op, positionId, at, summary }] }` to every
  session currently signed on to a Position named in `voided` (one message per Position, listing only that Position's
  voided Mutations). Positions only, never people (H35). It is sent after the Board event of the Undo (§7). Step 0
  checks whether a generic per-Position panel notification already exists (the CMSG message path); if so the voided
  list rides it instead of a new message type.
- The client shows it as a one-line message in the panel's message area ("TWR undid LC's hand-off VIPER1; your
  annotation was voided") that the controller dismisses. It is not stored on the client beyond the session.
- **Not delivered to a session that is not signed on at that moment**: the message is lost, by the human's choice. The
  audit still records what was voided: the `Undo` entry's `voided` list (§8) names every voided Mutation with its
  Position and actor, so a supervisor can always read it. A voided clearance entry is also still visible in the
  clearance cell as `VOIDED` (§3), so what the controller told the pilot is never silently gone.
- No Strip field is added, no snapshot or resync carries a notice, and a restored Strip is byte-for-byte the
  before-image (plus the new `rev`, `updatedAt`, `updatedBy`).

### 7. Wire

- **Action ack:** an undoable action's `efsp-mutation-ack` carries `undoable: { actionId, label, windowMs }`. The client
  keeps no list of which ops are undoable: the server says so.
- **Undo:** `op: { kind: 'Undo', actionId }` on `efsp-mutation`; `stripId` is any Strip in the action's scope (it routes
  the message to the Board and Facility). `baseRev` is not checked for `Undo` (it voids later changes on purpose). The
  old shape without `actionId` is refused (no compatibility, R3-2).
- **Undo ack:** `{ ok, voided: [...], warning? }`, or `{ ok:false, reason: 'UNDO_UNAVAILABLE' (expired, unknown,
  already undone) | 'UNDO_BLOCKED' | 'NOT_STAFFED' | 'BAY_FULL' | 'NOT_FOUND' | 'PERMISSION_DENIED', detail }`.
- **Broadcast:** one Board event per Board touched (ADR 0081): this Board's delta (restored Strips in `updated`, a
  removed split part in `gone`), the other Board's delta when an Interfacility Strip was restored, and the carrier or
  MARSA delta when a compensator ran, in the existing broadcast order.
- **Idempotency:** `Undo` is keyed by its own `clientMutationId`; a replay answers from the replay cache. The undone
  action stays in the replay cache, so a client that re-sends the original after reconnecting gets its cached ack and
  does not re-apply the mis-click.
- **Epoch:** the client drops its undo slot when the Facility's Board epoch changes (restart). Within one epoch a
  snapshot or a delta resync keeps it.

### 8. Audit

- The undone action's own entry is unchanged.
- The `Undo` entry: op `Undo`, addressed Strip = the undone action's addressed Strip (`before` = now, `after` =
  restored), `undoneActionId`, `undoneOp`, `records: [{ stripId, flightDataId, before, after | null }]` for every other
  Strip restored or removed on this Board, `voided: [{ clientMutationId, op, actingPositionId, actorId, at }]`, and the
  compensators' results. One entry per Board (ADR 0083); the other Board writes `InterfacilityUndo`; a side store writes
  its own entry with `causedBy`.
- A refused Undo is logged by the metrics tap like every Board refusal.

### 9. Traffic count, metrics, archiving

- The existing `isUndoOfDrop` (op `Undo`, `before` DROPPED, `after` not) keeps VOIDing the drop's COUNT. It is widened
  through `stripChangesOf(entry)` (ADR 0099) so a Strip in `records` that comes back out of DROPPED (the joiner of an
  undone join, a voided later drop) or is removed after a drop also VOIDs its COUNT.
- `metrics.js` gains `undos` (by undone op kind) and `undoVoided` (Mutations by another Position that an undo voided)
  per hour and session. An undone transfer stays a successful transfer attempt; `undoneTransfers` beside it makes the
  mis-click rate visible without changing the §11.1 success rate.
- Archiving (ADR 0082) is unchanged: nothing archived can be undone. Inside 10 s only a mission change archives a drop.

### 10. Client

- **One undo slot per session**, in the EFSP panel's status line (not on the Strip: after a handoff the Strip has left
  the sender's Bay): "Undo · Hand off VIPER1 → APP · 7 s". Filled from the ack's `undoable`, replaced by the next
  undoable ack, cleared at expiry (client wall clock from the ack's arrival; the server stays authoritative), on an
  epoch change, or after an Undo.
- **Ctrl+Z** with focus in the EFSP panel and **`.undo`** both send the slot's `actionId` (`.undo` no longer means "the
  selected Strip").
- After an Undo the slot shows the outcome for 3 s ("Undone; voided 1 change by TWR", or the refusal's detail).
- A voided controller who is signed on sees the panel message of §6 (no Strip marker).

## Alternatives considered

- **Per-op inverse functions** (each op writes its own `revert`). Rejected as the main mechanism: twelve inverses drift
  from their ops (ADR 0009's hazard was exactly a partial inverse). Whole-record restore of a declared scope is one
  mechanism; compensators exist only for the three side stores.
- **Keep the 30 s window.** Rejected: H95.
- **Make the moves NLAs** (the human's "why are they not NLAs?"). Rejected in H95: the Case picks the carrier target
  (L17 Q4), and routing through one undo history gives the same fix without renaming.
- **Undo voids another Facility's later changes too** (option (b) of Q-U3). Possible with `receiveUndoRestore`, but it
  silently reverses a second controller's handshake answer at another Facility.
- **Tell the voided controller with a Strip notice (`undoNotice`, UNDONE indicator, `AckUndoNotice`).** Rejected by the
  human (H100, Q-U2 b): the panel message is enough, and nothing about an undo is kept on the Strip. The price is that
  a session that is disconnected at that moment never hears of it; the audit and the `VOIDED` clearance entries remain.
- **Persist the history.** Rejected: 10 s across a restart is not worth a store (ADR 0009's reasoning, unchanged).

## Consequences

- ADR 0009 is superseded; guide §3.5 rule 5 (30 s, last NLA per Strip) is replaced by this ADR (L20 or the guide's next
  sweep notes it; the usage guide's "Undo" line changes in the lane).
- New: `UndoHistory`, the `undo` key on every op module, `receiveUndoRestore` on the Board facade, three side-store
  compensators, `OBSERVED_PATHS` in the flight-data store, `VOIDED` cell status, the `efsp-undo-voided` panel message, ack
  `undoable`, metrics counters, the client slot.
- Every later op (the release lane's, AIRSP's) declares `undo` and lists any system-written field as observed.

## As built (UNDO-S)

What the code settled inside this decision (`docs/wip/UNDO-S.md` has the code as found and the reasons):

- **The contract.** `src/efsp/undo/undo-history.js`. Each op module's `undo` is `'none'` or
  `{ label(op, strip, ctx), scope(ctx, strip, op), created?(result, ctx) }`; `scope` may return `null`, meaning
  that action of the op kind is not undoable (HANDOFF's marks vs its other actions, TOFI `PROPOSE` vs `ACCEPT`).
  `StripOps` refuses to start with a module that declares nothing. Shared scopes: `src/efsp/undo/scopes.js`.
- **How later changes are seen (§4).** Every `applyMutation` on every Board is one frame of the history
  (`begin` … `commit`). Every Board touch (`BoardState#recordTouch`, with a `placementOnly` flag that a rebalance
  sets) and every flight-data write (`FlightDataStore#setWriteObserver`; `OBSERVED_PATHS` are not reported) joins
  the open frame. A peer write happens inside the sender's frame, so another Facility's answer is seen as coming
  from that Facility. A write outside any frame is a system change: a sign-off's reassignment, and the non-Board
  families' writes to a scoped record (a MARSA declaration or void, an ATO import) block.
- **An action that changed nothing** (the NLA's 400 ms double-tap guard) is not undoable.
- **A restored Strip** is its before-image except `rev`, `updatedAt`, `updatedBy`, and annotation entries added
  since, which are `VOIDED` (§3's append-only rule applies to Strip annotations as well as clearance cells).
- **Where an Undo is sent.** To the Facility of the undone action (the record's Board); elsewhere it is
  `UNDO_UNAVAILABLE` naming that Facility. Another Board's Strips are restored there through `receiveUndoRestore`.
- **The panel message (§6).** crc-sync had no per-Position message path, so `efsp-undo-voided` is new:
  `efsp-ws.js` returns it as directed frames and `ws-hub.js` sends each, after the round trip's broadcasts, to the
  sessions signed on to that Position whose read scope (ADR 0080) shows the Strip. It also carries `stripId`.
- **The Undo ack** carries `undone: { actionId, op, label, transfer }`; `transfer` (the undone action moved the
  Strip to another Position) feeds `undoneTransfers`.
- **Undoable ops as built:** `InvokeNla`, `SetState`, `DropStrip`, `MoveStrip`, `TransferStrip`,
  `ConvertToArrival`, `CarrierHandoff`, `SfaRotation`, `TOFI` `PROPOSE` (`ENTRY`, `EXIT`). `'none'`: `CreateStrip`,
  `SetBlock`, `SetFlag`, the five coordination primitives (the release lane declares its three marks, S-DESK4),
  `ApproveAirspaceEntry`, `ClearAirspaceEntry`, `Undo`. SPLIT-JOIN declares `SplitFormation` and `JoinFormation`.

