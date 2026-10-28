# L20-CORE: comments in the EFSP core modules, and the facility doctrine notes

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 (start it first: one of the two large lanes) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-CORE` on `lane/L20-CORE` |
| Model / size | Sonnet 5.5 / L: 30 files, 3,486 comment lines, 9 stale pointers, 40 `board-store` lines, 196 vocab hits (FDR 117), 17 markers, 22 rows + the facility notes |
| Wip | `docs/wip/L20-CORE.md` |
| ADR / E2E lane | none / none |

## Goal

The top-level EFSP modules' comments are true on the new layout and in the new vocabulary, the prep's marker rows for
them are applied, and the doctrine/`[SOURCE-DEFINED]` notes that sat on the facility literals before DATA-1 moved them
to JSON (they exist only at `8476c41^`) are restated next to the schema, where a reader of a facility file looks.

## Owns

These files in `crc-sync/src/efsp/` (top level only): `airborne.js`, `archiver.js`, `block-map.js`,
`code-allocator.js`, `conformance.js`, `coordination.js`, `correlation-match.js`, `correlation-reconciler.js`,
`correlation-store.js`, `facility-config.js`, `facility-schema.js`, `flight-data-store.js`, `flight-plan-lookup.js`,
`forwarding-obligations.js`, `index.js`, `instrumentation-config.js`, `metrics.js`, `mutation-log.js`,
`nla-status-monitor.js`, `order-key.js`, `position-coverage.js`, `position-store.js`, `read-scope.js`,
`release-envelope.js`, `stores.js`, `surveillance-hints-config.js`, `surveillance-hints.js`, `time-chains.js`,
`traffic-count.js`, `zulu-time.js`. Comments only. `docs/wip/L20-CORE.md`, `docs/wip/L20-CORE/**`.

## Frozen for you

Everything else; `config/efsp-facility-*.json` (no `_comment` keys there, ever: README rule 5); the client mirrors
`strip-template.js`, `time-chains.js` (client) (L20-CLIENT); every string (L20-STR: A1's `code-allocator.js` detail is
theirs, not yours).

## Steps

0. **Step 0** as in the README (`(cd crc-sync && npm ci)`, `nice npm test`, tools, counts, `--sites L20-CORE`, markers,
   "Code as found" for every row, step-0 note).
1. **Facility notes (DATA-1, S-M-DATA1).** `git show 8476c41^:crc-sync/src/efsp/facility-config.js` holds 47 lines of
   doctrine citations and markers on the old literals (Bay sets "the guide's own §4.2 defaults" marked
   `[SOURCE-DEFINED]`, the covering chain, `bayImpliesState`, `positionClasses`, Incirlik's headings 056/236, `LTAG`,
   acknowledgers, inspection authority, pad names, gear `[]`, accessRoute ADR 0070, `positionLetters` ADR 0088,
   L18's thresholds). Restate them as one comment block per top-level key beside `REQUIRED_KEYS` in
   `facility-schema.js` (what the key means, where it is sourced, `[SOURCE-DEFINED]` with ADR/decision where it is
   ours, "squadron data to verify" for C-9's Incirlik values), in the glossary's words (consolidation, not covering
   chain). Rewrite the `facility-config.js` header: it is the loader now (lazy load, file layering, startup error on a
   missing/invalid file, BACKCOMPAT's `blockVisibility` refusal), not "Bay sets below"; drop "same pattern as
   theater-settings.js" (C-4) and "permission.js's OP_KINDS" (now `authority/op-kinds.js`). Commit.
2. **Pointers.** BOARD-1 (`facility-config.js` `_bayForNewOwner`: gone, find the current Placement function);
   BOARD-2 (`flight-data-store.js` names the coordination/TOFI methods as board-store's); BACKCOMPAT
   (`facility-schema.js`, `block-map.js` mention `blockVisibility`: keep only where it says "refused at start-up", the
   code token stays); C-4 (`mutation-log.js:5, :41` `theater-settings.js`); SYNC (`metrics.js` names
   `board-store.js APPLIED_MUTATIONS_CAP`: now `sync/replay-cache.js`); `_handleAtoMutation` (`flight-data-store.js`),
   `_isRejectedReplica` (`traffic-count.js`), `_stampStrip` (`metrics.js`), `_resolveOrderKey` (`order-key.js`),
   `_validateRadarSelectors` (`facility-schema.js` "index.js's"), `_searchInvocationCount` "efsp-panel.js's"
   (`forwarding-obligations.js:291`), `efsp-block-map-parity.test.js` → `.test.mjs` (`block-map.js:9`). All 40
   `board-store` lines. Commit.
3. **Rows.** C4 (`code-allocator.js`: move the synthetic-block bullet out of "Doctrine" with the ADR 0059 marker),
   C6 (`conformance.js` marker), C10 and D7 (`position-coverage.js`, formerly `station-coverage.js`: marker; "In our
   model a Ground controller has no scope"; re-read the tactical sentence D7 names), C11 (`release-envelope.js`),
   U1 (`instrumentation-config.js`: literal token, cite guide D-6 and ADR 0065), U8 (`metrics.js`: "caps are
   engineering bounds, targets are the guide's"), U13 (`archiver.js` 2 h: `[SOURCE-DEFINED] (H36, docs/adr/0082)`),
   U14 (`order-key.js` `REBALANCE_KEY_LENGTH = 40`: engineering threshold, `[SOURCE-DEFINED]` per S-L27, and
   "`tools/soak/report.js` mirrors it"), U18 (`correlation-reconciler.js`: reword the "A test holds every state ..."
   claim to what the test actually checks; the stronger test is a finding, README "Not L20"), L19
   (`surveillance-hints*.js` thresholds `[SOURCE-DEFINED] (docs/adr/0076)` where not yet marked; S-L19 (3)).
   Mirror lines for `block-map.js` ↔ `strip-template.js` and `time-chains.js` if you touch either. Commit.
4. **Vocabulary.** FDR (117) → flight data (the store is `FlightDataStore`, the id `flightDataId`); Strip Role → strip
   type; covering/covering chain → consolidation; TWR/GND/APP → LC/GC/AP; held/claim a Position → signed on;
   "occupied" stays only for airspace/runway/Marshal senses. Commit per file group.
5. **Close.** `node --check`; codecheck `comment-only`; `node --test tests/board-seam.test.mjs tests/clock-policy.test.mjs
   tests/efsp-metrics-contract.test.mjs tests/required-rules.test.mjs`; `nice npm test` once. Counts, row table,
   Mirror lines, ADR errata (ADR 0042 names `radar-specs.json` if you meet it), report.

## Acceptance

- codecheck `comment-only`; crc-sync `npm test` identical before → after.
- L20-CORE column: stale pointers 0 (or listed); 40 `board-store` lines verified; vocab hits reworded or covered by a
  kept-sense line; marker count ≥ 17 (it should rise: C4, C6, C10, C11, U1, U13, U14, the facility block).
- Every key in `REQUIRED_KEYS` has a source/ours note; every `[SOURCE-DEFINED]` that sat on the literals at
  `8476c41^` has a counterpart (list the mapping in the wip).

## Defaults (P2)

- The facility notes go in `facility-schema.js` (the shape) and not in a new doc; L20-GUIDE adds the controller-facing
  summary to the usage guide's "What is ours and what is sourced" section from your wip's list.
- Values that changed since `8476c41^` (RENAME-A's ids, L28's Bays) are described as they are now; the old comment's
  claim is kept only if still true.
