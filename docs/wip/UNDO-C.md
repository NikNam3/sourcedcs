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
