# TOFI-C working file (client part of ADR 0102)

## Code as found
- `strip-view.js#_tofiExchange` draws the TOFI exchange row only while INITIATED or awaiting comms; `bay/popovers/tofi.js` holds `_dispatchTofi` and the accept regime select (`TOFI_ACCEPT_REGIMES`).
- SREG is a Block of kind `tofi` (`strip-template.js` resolveBlockValue); the enum picker takes its current value from the cell's `textContent`, so the pending value must not go in that span. Cell built by `bay/block-edit.js#_buildBlockCell`.
- `efsp-alerts` handled in `efsp-messages.js` -> `efsp-state.js#applyEfspAlerts` (full state, replace). Alert chips: `strip-view.js#_stripAlerts` + `ALERT_SLOT_KEYS`/`INDICATOR_ORDER`.
- Ack warnings: `panel/refusal.js` `MUTATION_WARNING_MESSAGES` (amber line); `applyEfspMutationAck` already stores `msg.flightData`.
- `ws-message-contract.test.mjs` `SERVER_ONLY_OK` has only `update-required`; no tofiRegime entry exists to remove (efsp-alerts is an existing type).
- Undo slot shows the server's `undoable.label` verbatim, so "Mark entered <callsign>" needs no client work.

## Defaults taken
