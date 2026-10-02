# L20-SYNCTESTS: comments in crc-sync's tests

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-SYNCTESTS` on `lane/L20-SYNCTESTS` |
| Model / size | Sonnet 5.5 / M: 172 files, 3,497 comment lines, 22 stale pointers (15 `_method`, 7 file), 30 `board-store` lines, 281 vocab hits (TWR/GND/APP 141, FDR 67, Strip Role 28, covering 20), 8 markers |
| Wip | `docs/wip/L20-SYNCTESTS.md` |
| ADR / E2E lane | none / none |

## Goal

Test comments point at code that exists and use the glossary's words, so a reader of a failing test is sent to the
right file. Test **titles** and test **locals** are not yours (L20-STR, wave 2): you change comments only.

## Owns

`crc-sync/tests/**` comments, except `crc-sync/tests/freeze/golden/**` (never) and JSON fixtures' data. Comment-only
edits in `tests/helpers/efsp-scenario.mjs` are allowed: its append-only rule (S-Q3) protects its code from concurrent
lanes, and no other lane edits it now. `crc-sync/tests/fixtures/time-chains.json`'s `_comment` is yours.
`docs/wip/L20-SYNCTESTS.md`, `docs/wip/L20-SYNCTESTS/**`.

## Frozen for you

`crc-sync/src/**`, `crc-sync/tools/**`, goldens, structure fixtures (`guard-board-surface.json`), every string
literal (test names, assertion messages, expected refusals), every identifier.

## Steps

0. **Step 0** as in the README (`(cd crc-sync && npm ci)`, `nice npm test`, tools, counts, `--sites L20-SYNCTESTS`,
   markers, step-0 note).
1. **Stale method pointers.** `_validateBayImpliedTransition` (8 sites: `efsp-scenarios.test.mjs` ×3,
   `efsp-ws.test.mjs` ×3, `efsp-board-store-coordination.test.mjs`, `helpers/efsp-scenario.mjs`), `_nlaPrecheck`,
   `_isRejectedReplica` (`efsp-ui-findings.test.mjs`), `_handleMarsaMutation` (`efsp-ws-replay.test.mjs`),
   `_resolveOrderKey` (`efsp-order-key.test.mjs`), `_stampStrip` (`efsp-scenario-scramble.test.mjs`),
   `_buildAllRadars` (`radars.test.mjs`: history, keep if phrased as such). Find where each piece of code lives now
   (README rule 2) and name it. BOARD-2: the two tests that name `_applyCoordinationPropose`/`_applyTofiPropose`/
   `receiveTofiProposal` as board-store's. Commit.
2. **File pointers and `board-store` lines.** `efsp-time-chains.test.js` → `.test.mjs` (client test renamed by
   ESM-1; check the actual name), `board-store.test.mjs`'s → `efsp-board-store.test.mjs` if that is what is meant,
   `los-math.test.js` (history in `terrain.test.mjs`: keep if it says "moved here"), the 30 `board-store` lines
   (`freeze-guards.test.mjs` ×12 describes the facade surface: check each against `guard-board-surface.json`).
   Commit.
3. **Vocabulary.** TWR/GND/APP in comments → LC/GC/AP where they name a Position (a comment quoting a test title or
   an id string quotes it as it is); FDR → flight data; Strip Role → strip type; covering → consolidated at; "held"
   Positions → signed on. Freeze trace descriptions in `freeze/freeze-traces.mjs` comments: fine to reword, but never
   a trace *name* (it keys a golden). Commit per group of files (scenario suites, ws suites, store suites, freeze,
   others).
4. **Close.** `node --check` every changed file; codecheck `comment-only`; `nice npm test` once (the test files you
   edited are inside it). Counts, a short table of the pointer fixes, report.

## Acceptance

- codecheck `comment-only` (test names and assertion strings untouched); crc-sync `npm test` identical before → after.
- L20-SYNCTESTS column: stale pointers 0 (or listed with "kept: history"); every `board-store` line verified; vocab
  reworded or covered by a kept-sense line (test titles and locals are excluded from your count; list how many remain
  for L20-STR).

## Defaults (P2)

- A comment that explains *why a test exists* by quoting an old bug keeps the bug's words in quotes and adds the new
  name once in brackets.
- If a comment names a test title that L20-STR will rename, keep it matching the title as it is on your base; STR
  updates both.
