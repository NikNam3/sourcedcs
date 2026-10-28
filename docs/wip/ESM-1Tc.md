# ESM-1Tc: partition c client tests to ES modules

22 files renamed `.test.js` to `.test.mjs` in `crc-desktop/tests/`; test counts identical before and after for every file.
Each imports `helpers/client-env.mjs` first. Files that built a vm sandbox per test use `freshGraph()` and the explicit setters
(`setEfspSender`, `setIsSyncOpen`/`setSendToSync`, `_set…ForTest`); stubbed field state, FDRs and live Strips are fed through the real
`applyEfspSnapshot`.

Changed expectations (the assertion's intent kept, the value or mechanism changed, all forced by real modules replacing stubs):
- efsp-field-state-client "alert-pad line": the constraint now comes from a real scramble in the Board, so the text is
  `ALERT-PAD ACCESS ROUTE (not configured) CONSTRAINED — scramble in progress (VIPER11)` instead of a stub string.
- efsp-scramble-client / efsp-ordnance-client: "no field state loaded" is `getEfspFieldState(...) === null`, not `typeof … === 'undefined'`.
- efsp-metrics-hooks: "metrics client not loaded" and "metrics client throws" go through `_setEfspMetricsClientForTest` (no-op / throwing client).
- magnetic-display "loads after geo.js": reads the import order in `js/main.js` instead of the `<script>` tags in index.html.
- metrics-panel / ato-import: `crypto.randomUUID` and `document.getElementById` are patched on the global for the test, restored in `finally` where shared.

Setters/exports asked of ESM-1: `_setCoverageRadars/_setCoverageDatalink/_setCoverageHeldPositions` (app.js), `_setShowLosProfileForTest`,
exports `_buildStripEl/_setExpandedStripId/_selectStrip/ALERT_SLOT_KEYS/_runEfspSearch/_dispatchDotCommand/renderCoverageList/flushEfspMetricsNow`,
`_setEfspMetricsClientForTest` plus removing `globalThis` guards in efsp-metrics-client.js, `_setRenderBayForTest`.
