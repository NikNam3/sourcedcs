# CMSG: client message registry (report)

Branch lane/CMSG-client-messages, base 115ff24. No ADR (0095). Behaviour identical; app.js's 24 `efsp-*` cases became `default: dispatchEfspMessage(msg)`.

## Code as found
app.js `onSyncMessage` held 24 efsp cases (snapshot, resync-reply, board-delta, heartbeat, mutation-ack, positions-ack, correlation d/a, marsa d/a, airspace d/a, alerts, carrier d/a, sfa d/a, field-state d/a, ato-preview-result, ato-ack, metrics, metrics-report-ack). Only resync-reply re-entered the switch (unwraps to snapshot/board-delta).

## Layout
- `panels/efsp/efsp-message-registry.js`: leaf (no imports) with `registerEfspMessage` (duplicate throws), `dispatchEfspMessage`, `registeredEfspTypes`.
- `panels/efsp/efsp-messages.js`: snapshot, resync-reply, board-delta, heartbeat, mutation-ack, positions-ack, correlation, marsa, alerts, sfa, ato, metrics-report-ack.
- airspace-panel.js, carrier-panel.js, field-state-panel.js, metrics-panel.js register their own family.
Bodies and call order are verbatim.

## Defaults taken
- Registry split into a leaf file: efsp-messages.js imports bay-view/efsp-panel, so registering from the family modules in it would hit a TDZ when entered from a cycle partner.
- efsp-messages.js is imported by app.js (side effect), not main.js (not in Owns).

## Outside Owns (S-CMSG1 approved for the first)
- crc-sync/tests/wire-payload-contract.test.mjs: scans efsp-messages.js; asserts handler found and non-empty.
- crc-desktop/tests/efsp-refusal-banner.test.mjs: static `_showMutationError` guard scans the handler files.

## Tests
crc-desktop 883 tests, 881 pass, 0 fail (2 todo); crc-sync 2153, 2152 pass, 0 fail. Contract test reads the live registry. Fixture: module-graph-exports.json +2 entries.
Playwright lane 4: smoke, ui-b-resync, l15-metrics, l17-carrier, field-state, l1-marsa, l14-ato-import pass. Failures seen once under load (load avg ~35-40): l15-metrics, l1-marsa, field-state (a different test each time, 3 s click timeouts); each passed on re-run alone, field-state twice, and base passed it once.
