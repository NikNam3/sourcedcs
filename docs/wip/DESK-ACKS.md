# DESK-ACKS (phase 3, client lane + small server half)

Branch `lane/DESK-ACKS-desk-acks`.

## What changed

1. **One ack path.** `efsp-ws.js` has `sendEfsp(msg, { pending, onAck })`, `settleEfspAck(ack, result)` and
   `orphanEfspAcks()`. All senders (`sendEfspMutation/Undo/CreateStrip/AirspaceMutation/Correlation/Marsa/RunwayStatus/Carrier/Sfa`)
   take a trailing `{ onAck }` and go through it. One cmid -> continuation map. `onAck` returning `true` means "I showed the
   outcome, skip the default surface". Replaced: the Undo slot's `_pendingUndoId` match, CreateStrip's id match in
   `notifyEfspMutationAck`, the ATO dialog's id match (`onAtoAck` is now private), the airspace views' per-view
   `handleAck` offer loop and `'?'` fallback. `_pendingCreateStripMutationId` and `_atoPendingImportId` remain as plain "form is
   busy" flags. A send the socket cannot carry answers `NOT_CONNECTED` (microtask); a (re)connect answers `CONNECTION_LOST` to every
   non-replayable request (`redeclareEfspPositions` calls `orphanEfspAcks`), so Undo no longer vanishes silently and the runway
   button no longer stays dead. `notifyEfspMutationAck(result)` lost its unused first argument.
2. **Structured attestation.** crc-sync's `checkControlAxis` returns `attestation: {with, needs:[scope..]}` on the "coordinate
   with X" refusal (reason stays `VALIDATION_ERROR`, detail sentence unchanged); `set-block.js` passes it up, `efsp-ws.js` puts it
   on the ack. Client `attestationRequest(attestation, op)` reads it; the regex and the source-text test are gone. The wrong-party
   refusal no longer carries the dead `coordinateWith`/`needs` fields and is an ordinary refusal. No client regex over server prose
   remains (the two `ref.detail` regexes in `airspace-editor.js` run over the client's own validator output).
3. **Refusal codes.** `crc-sync/src/efsp/refusal-codes.js` (`REFUSAL_CODES`, 16) + `tests/refusal-codes.test.mjs` (source scan, fails
   when a refusal code is missing from the list or the list has a dead entry). The client table gained `BAY_FULL`, `UNDO_BLOCKED`,
   `UNDO_UNAVAILABLE`, `INTERNAL_ERROR` plus the two client-only `NOT_CONNECTED`, `CONNECTION_LOST`; `efsp-refusal-banner.test.mjs`
   compares the table with `REFUSAL_CODES`. `EXISTS`, `CRASH_BEFORE_PERSIST`, `NOT_PERSISTED` are not ack refusals (per-item skip,
   audit only): ARCH-C was wrong to count them.
4. **Popovers close on ack.** `_sendFromPopover(popover, button, send)` in `bay/popover-portal.js`; coordination, TOFI, split, join,
   release/request/refuse and the three MARSA forms use it. Refusal: stays open with its input, button live again, banner still
   shows. Not converted (no typed input to lose): bind, highlight swatch, airspace-entry approve.

## Wire

No frame type or version changed; the ack gained an optional `attestation`. `npm run wire:record`: "WIRE_PROTOCOL stays 2, surface
unchanged". Four freeze ack hashes moved (own commit).

## Defaults taken

- Attestation is a field next to the unchanged `VALIDATION_ERROR`, not a new reason `ATTESTATION_REQUIRED` (ARCH-C's wording): keeps
  every old consumer's refusal path and the Mutation log untouched.
- A replayed (idempotent) attestation refusal answers from the replay cache, which does not store `attestation` (the persisted
  record shape is checked strictly in `stores.js`, SERVER-SEAMS ground), so only a lost-ack retry shows the plain banner with the
  sentence. Edge case; widen `replayRecord` + `stores.js` shape check if it matters.
- `NOT_CONNECTED` / `CONNECTION_LOST` are client-synthetic reasons worded in the same table.
- Correlation/MARSA/SFA/carrier/runway acks now settle continuations but keep their banner; only runway passes an `onAck`
  (re-render + banner on NOT_CONNECTED/CONNECTION_LOST).
- Playwright airspace specs stubbed `sendEfspAirspaceMutation`, which now bypasses the continuation; they stub `_sendEfsp` instead.

## Findings for other lanes

- `rebaseForResend` returns null for a CreateStrip (no stripId), so every pending CreateStrip is reported "orphaned"
  ("its target Strip no longer exists") on reconnect and never re-sent (DESK-SYNC). It now also clears the form with CONNECTION_LOST.
- `preview` (ATO) still matches by its own `requestId`, not the ack path; `efsp-positions-ack` is likewise its own thing.
- The warning field still has no state: a warning raised before the panel was opened is dropped; 6 s auto-clear, no dismiss (ARCH-C).
- `window.prompt` in `runway-status-panel.js` is still a blocking native dialog.
- `refusal.js` no longer imports `create-strip.js` (one edge less in the cycle).

## Guide / briefing wording to change

- `docs/efsp-briefing.md` (client section): "an ack is matched by `sendEfsp`'s `onAck` continuation by cmid; the refusal banner is the
  default surface; `settleEfspAck` is called from each family's ack handler".
- Control-release / usage guide: the "coordinated with" prompt is driven by the ack's `attestation: {with, needs}`, not by the detail
  sentence, so the sentence may be reworded freely.
- Usage guide: a refused Send in a popover leaves the popover open with the typed text; the red banner says why.
- crc-sync briefing: `REFUSAL_CODES` is the list a new refusal code must join (and the client table must word).

## Tests

crc-sync `npm test` 2435 (2433 + 2 new refusal-codes tests; the control-release matrix gained attestation asserts); `walk` pass;
`freeze` 52/52 after one approved golden commit; `soak:selfcheck` PASS. crc-desktop `npm test` 1151 (+ `efsp-ack-path` 4,
`efsp-popover-ack` 5). Playwright on E2E_LANE=1 only: smoke, l1-popovers, l3-coordination, marsa-popover, l1-marsa, efsp-formation,
control-release, tofi-regime, efsp-undo, l14-ato-import, runway-status, airspace-panel, airspace-geometry: all pass.
