# L20-DESK: comments in the rest of crc-desktop (shell, scope, local server, tests, e2e)

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-DESK` on `lane/L20-DESK` |
| Model / size | Sonnet 5.5 / M: ~159 files (≈44 public non-EFSP, ≈15 shell, ≈100 tests and specs), 5,526 comment lines (CSS/HTML included), 50 stale pointers (mostly `*.test.js` names), 9 `board-store` lines, 150 vocab hits, 6 markers, 9 rows |
| Wip | `docs/wip/L20-DESK.md` |
| ADR / E2E lane | none / none (comments only) |

## Goal

Every comment in crc-desktop outside `panels/efsp/` is true after ESM-1 (native ES modules), RENAME-B (UI words,
dock layout v2) and TA, names the current files, and uses the glossary's words; the prep's scope/label rows are
applied.

## Owns

- `crc-desktop/app/public/**` **except** `js/panels/efsp/**`: `js/*.js` (app, atc-scope, geojson, track-label, sync,
  dock, map-setup, ...), `js/panels/*.js`, `css/*.css`, `index.html`, `auth-callback.html`.
- `crc-desktop/app/*.js` (`server.js`, `proxy-routes.js`, `maptiler.js`, `preload.js`), `crc-desktop/app/data/*.json`
  (`_comment` text), `crc-desktop/main.js`, `lxsrs-setup.js`, `patch-notes.js`, `playwright.config.js`, `scripts/**`.
- `crc-desktop/tests/**`, `crc-desktop/e2e/**`: **comments only** (titles and locals are L20-STR's for `tests/`
  and BRIDGE's for `e2e/`).
- `docs/wip/L20-DESK.md`, `docs/wip/L20-DESK/**`.

## Frozen for you

`panels/efsp/**` (L20-CLIENT), `classic-globals-bridge.js` beyond its comments (BRIDGE deletes it), the `typeof`
guards (ESM-GUARDS), every string (A2's radar-panel title is L20-STR's), `python-pkg/**`, `build-assets/**`
(L20-DOCS owns the release note), `package.json`.

## Steps

0. **Step 0** as in the README (`(cd crc-desktop && npm ci) && (cd crc-desktop/app && npm ci)`, `nice npm test`,
   tools, counts, `--sites L20-DESK`, markers, "Code as found", step-0 note).
1. **Shell and scope rows.** U9 (`atc-scope.js` blink 5 s, time-share 2 s, coast 2 sweeps / 6 s fallback, palettes;
   `geojson.js` `ATC_MAX_SEGMENTS = 16` (a reason, or "unused" as a finding if no reader): `// [SOURCE-DEFINED]
   (docs/adr/0088, H41/H71)`; the BLACK palette is cited, the MAP palette is our softened variant), U15
   (`track-label.js` "(7110.65 §5-14-4d)" → "(STARS trend arrow; `docs/parallel/research/stars.md` [65 §5-14-4d])"),
   U5 (18,000 ft fallbacks left after TA in `app.js`, `aprt-panel.js`, `track-label.js`: re-grep `18000`; each says it
   is the fallback before the first `theater` message, `[SOURCE-DEFINED]`), ESM-1 (`atc-scope.js` header on the
   removed `module.exports` guard), C-8 (`app/data/aircraft-types.json` `_comment`: `radar-specs.json` →
   `sensor-specs.json`). Commit.
2. **ES modules and file names.** Headers in `js/*.js` and `js/panels/*.js` that describe classic scripts or globals;
   "former ui.js god file" lines are history on purpose (keep one short form); `config.js` mentions are the generated
   `/js/config.js` (correct, keep); `tools-panel.js:20` "sync.js's `_initConnTab`" (gone). In `tests/**`: the 49
   `*.test.js` names → the real file (`ls tests`; five CommonJS stay `.test.js`); BACKCOMPAT
   (`efsp-ui-reachability.test.mjs:347, :432` cite `clearance-migration.js`: removed by BACKCOMPAT; say "the old
   clearance migration (removed, BACKCOMPAT)" or drop); `client-env.mjs`, `dom-stub.js` headers. Commit.
3. **Vocabulary.** RENAME-B's leftovers: CSS/HTML comments that read "the signedOn Positions" (rewrite as prose: "the
   Positions a controller is signed on to"), "hand-over", "manned", "SQUAWK", "Role" (strip type); TWR/GND/APP in
   comments of `tests/**` and `e2e/**` (comments only; the e2e locals `twr`, `gnd`, `ARR_TWR` stay for BRIDGE). Commit
   per directory.
4. **Local server and CLAUDE.md fact.** Confirm in the `app/server.js` header that the local server is Node
   `http`/`https` (not Express); L20-DOCS corrects CLAUDE.md (S-ARCH2 16). Write the one-line fact in your wip for
   them.
5. **Close.** `node --check` every changed JS (CommonJS and ESM); codecheck `comment-only` (CSS and HTML comments
   included); `node --test tests/module-graph.test.mjs tests/e2e-spec-hygiene.test.mjs tests/packaging-config.test.js
   tests/ws-message-contract.test.mjs tests/server-proxy-routes.test.js`; `nice npm test` once. Counts, row table,
   report.

## Acceptance

- codecheck `comment-only`; crc-desktop `npm test` identical before → after; no Playwright run.
- L20-DESK column: stale pointers 0 (or listed: "former ui.js" history lines are fine); 9 `board-store` lines
  verified; "signedOn Positions" 0; vocab reworded or covered; markers ≥ 6 and rising (U9, U5).

## Defaults (P2)

- A comment in an e2e spec that explains a selector or a wait keeps its exact quoted selector text; reword around it.
- `index.html`'s comment about `/js/config.js` and the single module script stays (it is the ESM contract
  `module-graph.test.mjs` pins); fix only words.
