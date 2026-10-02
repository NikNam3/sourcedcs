# UNDO-C working file

Lane UNDO-C, branch `lane/UNDO-C-undo-button`, base `9d1c58d4`. ADR 0100 "As built" is the wire.

## Code as found

- `efsp-nla.js`: `UNDO_WINDOW_MS = 10000` already (parity test pins it to `undo-history.js`); `isUndoAvailable` used by tests only.
- `panel/dot-commands.js` `_dispatchDotCommand`: `.undo` sends `{kind:'Undo'}` for the selected Strip (no actionId; the server now refuses that).
- `efsp-ws.js`: `sendEfspMutation(actingPositionId, strip, op)` registers pending; `setEfspSender` switch lists replaceable senders.
- `efsp-messages.js` `efsp-mutation-ack` handler -> `applyEfspMutationAck` (returns `{pending, ok, reason, detail, warning}`, drops `undoable/undone/voided`) -> `notifyEfspMutationAck` (refusal banner).
- Epochs: `efspBoardEpochByFacility` in `efsp-state.js`; acks/deltas carry `boardEpoch`, snapshot carries `boardEpochByFacility`.
- No per-Position panel message path on the client; `efsp-undo-voided` is only in `SERVER_ONLY_OK` of `ws-message-contract.test.mjs`.
- Panel chrome: `#efsp-mutation-error` / `#efsp-mutation-warning` in `index.html`, cached in `panel/state.js`, styled in `css/efsp-panel.css`.
- Server wire: ack `undoable {actionId,label,windowMs}`; Undo ack `undone {actionId,op,label,transfer}`, `voided [{clientMutationId,op,actingPositionId,actorId,at,summary}]`; frame `efsp-undo-voided {facilityId,positionId,actionId,stripId,undoneOp,undoneLabel,undoneBy,at,voided:[{op,positionId,at,summary}]}`.

## Defaults taken
- P2 defaults: the voided-message wording is the ADR's example; terminal refusals (UNDO_UNAVAILABLE, UNDO_BLOCKED, NOT_FOUND) clear the slot, transient ones (NOT_STAFFED, BAY_FULL) keep it; Ctrl+Z is ignored while typing in an input.
- The Undo send is not registered as a pending mutation (no reconnect replay by rebase); undo-slot.js tracks its own ack and skips the refusal banner for it.

## What was built
`panel/undo-slot.js` (slot, outcome, voided messages, Ctrl+Z), `sendEfspUndo` in `efsp-ws.js`, ack/delta/snapshot epoch hooks and the `efsp-undo-voided` handler in `efsp-messages.js`, `#efsp-undo-slot` / `#efsp-undo-voided` in `index.html`, `.undo` by actionId. `SERVER_ONLY_OK['efsp-undo-voided']` removed. Tests: `tests/efsp-undo-slot.test.mjs`, `e2e/efsp-undo.spec.js` (4 specs, E2E_LANE=5).

## Not done / walks
- The e2e voided-message spec injects the frame; a real two-Position scenario (LC hands off, APP edits, LC undoes) is covered server-side by UNDO-S's tests, not walked in a browser.
- `docs/efsp-usage-guide.md` line 1431 area updated (Undo lines only).

## Release note
Undo: every one-click move can be undone for 10 s from the new Undo slot, Ctrl+Z or `.undo`; a controller whose change an Undo voided gets a panel message.
