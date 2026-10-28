# SERVER-BUGS: five crc-sync bugs from the architecture check (H103), B2-B6

Branch `lane/SERVER-BUGS-fixes`, cut from `efsp-wp5-correlation` at `d586ad2a`.

## Code as found (step 0)

**B2 (sign-on/off control repair).** `efsp-ws.js` `_handleSetPositions` loops over every Facility and does
`if (b && b.reconcileExchanges().length) controlRepaired = true`. `HandoffControl#reconcileExchanges`
(`board/handoff-control.js`) returns a number (`n += ...length`), so `.length` is `undefined` and
`controlRepaired` is never true. When no Strip was reassigned either, `persist()` is skipped and the repair
(comms/control moved to the live side, one bumped Strip + `InterfacilityControlRepair` audit line) is lost on restart.
Repairs on another Facility's Board stay in that Board's touched set: the set-positions reply only re-sends the
signing Facility's Board, so those sessions hear of it on that Board's next Mutation or via the heartbeat seq gap.
Also `boardStore.drainTouched()` runs only on the signing Board.

**B3 (throw inside an op).** `BoardStore#applyMutation` wraps `StripOps#dispatch` in try/catch and converts any
throw into `{ok:false, reason:'VALIDATION_ERROR', detail:'internal error processing mutation'}`, then stores that
in the replay cache. Whatever the op wrote before the throw (Strip fields, peer Board, flight data, MARSA) stays in
memory. `efsp-ws.js` broadcasts the touched Strips of a refusal but `persist()` runs only on `ok`, and the audit line
is written after the op body, so it is skipped. Board, snapshot and audit then disagree.

**B4 (single `warning`).** The mutation ack has `warning: luawWhileCombined(...) || result.warning` (`efsp-ws.js`),
so the GCLC code wins over an op's own warning. Producers set a string (code or prose), a `'; '`-joined string
(`join-formation.js`), or an object (`correlation`/ATO elsewhere). Also in the replay record
(`sync/replay-cache.js` `replayRecord`, persisted: `stores.js` ENTRY_SHAPES.boards.replay lists `warning`).
Client: `efsp-state.js` `warning: msg.warning` -> `panel/refusal.js` `_showMutationWarning(result.warning)`.

**B5 (runway-status delta scope).** `WsHub#broadcastEfspRunwayStatusDelta` sends through `_broadcast`, not
`_broadcastEfsp`, so `filterForSession` never runs for it. Harmless today only because the family has no filter.

**B6 (system TOFI entry).** `board/tofi.js` `markEnteredBySystem` does `strip.rev += 1; updatedAt; updatedBy='system'`
on the MISSION Strip, whose record is not otherwise changed (the regime lives on the flight data), then
`_touch(id, {placementOnly:true})`, borrowing the rebalance flag so undo ignores it. A controller holding the old
rev gets `STALE_REV` on the next edit.

## Decisions / defaults taken

(filled in below as work proceeds)

### Goldens moved
- B2: hub-random-seed1, hub-random-seed2, scenario-coordination, scenario-manning, scenarios (a sign-off now persists a repair and sends the other Boards' touched Strips as extra `efsp-board-delta` frames in the same round trip).

## B3 decision
Rollback was not chosen: the undo frame holds before-images only for a keyed op that declares a Scope, and even then only
for the records in that Scope. An op can also have written to a peer Board, MARSA, carriers or the code allocator, none of
which a Strip restore would undo (and the undo restore path has its own gates). A partial rollback would be a second way
to leave the Board half-changed. So a throw is treated as a crash that audits and persists what changed:
- `applyMutation` answers `INTERNAL_ERROR` (was `VALIDATION_ERROR`) and, when any Strip was touched, sets `partial: true`.
- `BoardAudit#recordInternalError` writes the audit line the op never got (`outcome: 'INTERNAL_ERROR', partial: true, error`).
- `efsp-ws.js` persists on `ok || partial`; the touched Strips were already broadcast on a refusal.
- The replay cache keeps the refusal, so a retry is not run on top of the half-applied op.
Not done (same catch-all exists, same shape): correlation, carrier, airspace, MARSA, runway-status and SFA stores still answer
`VALIDATION_ERROR` on a throw. Their ops write one record, so the partial window is small; left for a later lane.

## B4 decision
- Ack: `warnings: [{ code, detail? }]`, present only when non-empty (like `undoable`); the singular `warning` is gone from
  the Board mutation ack and the Board replay record (`replayRecord`, persisted: `stores.js` shape now lists `warnings`).
  Ops return `warnings` on their results (`src/efsp/warnings.js`: `warn(code, detail)`, `fromCode(code)`). Order: the op's
  own, then the wire's (`LUAW_WHILE_COMBINED`).
- New codes for what used to be prose: `NO_BAY_FOR_STATE` (SetState), `NO_BAY_FOR_STRIP` (TransferStrip, CarrierHandoff),
  `NOT_IN_MARSHAL_STACK` (CreateStrip, coordination accept), `COMMS_MOVED_BY_DROP`, `FORMATION_MIXED_TYPE`,
  `FORMATION_GROUND_AND_AIRBORNE` (JoinFormation now reports each, not a `'; '` string). Code-only: `AIRSPACE_NOT_ACTIVE`,
  `AIRSPACE_STILL_WITH_USING_AGENCY`, `NOT_IN_ACTIVE_AIRSPACE`, `DUPLICATE_IGNORED_WARNING`, `LUAW_WHILE_COMBINED`.
- Not changed: the airspace family's ack (`efsp-airspace-ack` `warning` + `occupied`, read by airspace-panel.js), the
  families' replay record, flight-data-store/code-allocator's own `warning` (store API, converted at the op),
  the correlation record's `warning` object, and the audit's `tofiRegime.warning` field. The client's
  `_showMutationWarning` accepts a string (airspace panel) or the list.
- WIRE_PROTOCOL: `wire:record` reports "stays 2 (last release speaks 1); surface unchanged": 2 is already unreleased.
- **State dir**: a Board snapshot written before this commit holds replay records with the key `warning`; the strict
  shape check (`checkPersistedShape`) stops start-up on it, naming the file. Fix: delete `state/efsp-board.json` and
  `state/efsp-mutations.jsonl` (the error says so) or wait out nothing: there is no migration (lane rules).

## B5
`broadcastEfspRunwayStatusDelta` now uses `_broadcastEfsp`. The family has no `filter`, so nothing moves on the wire;
the test gives it one temporarily and shows the hub reaches it. Whether the runway-status family SHOULD filter is a
separate decision (field status is information for everyone today).

## B6
No rev bump; `touch(id, { unobserved: true })` (renamed from `placementOnly`, which is what Placement's rebalance also
uses). STALE_REV was real for any controller whose edit was built on the rev before the entry and reached the server
after it (the delta with the new rev had not yet arrived or had not been applied), reproduced in the test with the old
code. No golden moved.

## Findings for other lanes
- The same catch-all `VALIDATION_ERROR` on a throw exists in the correlation, carrier, airspace, MARSA, runway-status and SFA stores.
- A sign-off now sends other Boards' touched Strips in the same round trip (B2), so DESK-SIGNON's helper that waits for the
  sign-on reply may see extra `efsp-board-delta` frames for another Facility after the primary one.
