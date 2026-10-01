# ESM-1Tb: partition b tests to ES modules

16 files renamed to `.test.mjs`, same test names and counts (bay-views 13, strip-fields 19, gestures 8, refusal-banner 14,
ui-a 7, dot-command 18, annotation-model 6, arrivals 12, state 26, state-archive 2, order-key-insertion 26,
panel-drop-targets 8, marsa-client 24, correlation-client 24, sfa-client 4, resync-state 4).

- Pure modules: plain imports (`import * as` where the old test used the whole `module.exports`).
- bay-views: real Board state via `applyEfspSnapshot`, acting Positions via `sendEfspSetPositions`, senders via
  `setEfspSender`, `Date.now` pinned for `missionNow`. The "no top-level name declared twice" test walks the import
  graph from `js/main.js` instead of the `<script>` list in index.html.
- refusal-banner: one `freshGraph()` per mount; unref'd `setTimeout` replaces the sandbox's.
- marsa / correlation: `_setSelectedStripIdForTest`, `setOpenEfspBays`, `_setSelectEfspStripByIdForTest`, `_setUpdateMapForTest`.
- Setters asked: `_setSelectedStripIdForTest` (bay-view.js), exports of `MUTATION_ERROR_VISIBLE_MS` / `MUTATION_ERROR_MESSAGES`.
