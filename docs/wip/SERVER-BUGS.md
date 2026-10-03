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
