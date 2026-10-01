# BACKCOMPAT: remove the back-compat code, make a missing rule loud, close the fixture window

> Read `README.md` in this folder first. Rulings: ARCH-D5 ("remove the back-compat code and make a missing rule a
> loud startup error, as a small lane after the structural phases"), R3-2 (prod is a clean start), S3-4 (no versioning
> now), ARCH-D6 b (fixtures only during the refactor window). Plan: `docs/wip/ARCH-plan.md` §3.1, §6 items 2 and 8, §9
> points 7 and 14.

| | |
|---|---|
| Wave | W6, alone. When it merges, the refactor window closes and **L20 starts** |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-BACKCOMPAT` on `lane/BACKCOMPAT-removal` |
| ADR | none (0095 §8 states it) |
| Size / model | 0.5 lane / Sonnet 5.5 |

## Goal

An **approved behaviour change** (ARCH-D5, the human). Remove:

1. the `efsp.boardStore` / `efsp.positionStore` aliases (INCIRLIK's), with their callers moved to the per-Facility
   accessors;
2. the pre-WP4A `data.board` restore shape in `_restore`;
3. every optional-rule guard (`this._rules.x &&`, `rules.x &&`) in the Board and its collaborators. A `BoardStore`
   built without a rule the code reads throws at construction, naming the missing rules. The required set is derived
   from the same scan FREEZE guard 1 uses (one source);
4. the legacy `blockVisibility` handling in `facility-config.js`;
5. **only if the human answers "remove" to queue item 8:** `clearance-migration.js` and `overflight-migration.js` and
   their calls in `_restore`.

Also turn AUTH's `authority-coverage` test into a start-up check (a configured Position with no registered family stops
start-up), and close the window: the freeze suite leaves `npm test` and becomes `npm run freeze`, with a dated note in
`docs/wip/FREEZE.md` saying the fixtures are not maintained after this date.

## Owns

`crc-sync/src/efsp/index.js` (the aliases, the legacy restore, the migration calls if approved), `board-store.js` and
`src/efsp/board/**` (the guards only), `facility-config.js` (`blockVisibility` only), the two migration files (only
if approved), a new `tests/helpers/full-rules.mjs` (a complete `rules` object for unit tests, with overrides), every
unit test that built partial `rules` (switched to the helper), `crc-sync/package.json` (`test` and `freeze` scripts),
`docs/wip/FREEZE.md` (the closing note), `docs/wip/BACKCOMPAT.md`.

## Steps

0. Step 0 per README: every alias caller, every guard site, every partial-`rules` fixture (count), and both migrations'
   callers. Confirm queue item 8's answer is in `decisions.md`. If it is not there, leave the migrations and say so.
1. `tests/helpers/full-rules.mjs`, and switch the partial fixtures to it. Structural, golden identical.
2. **`behaviour(BACKCOMPAT)` commit:** items 1–4 (and 5 if approved), the required-rules check, and the authority
   start-up check. Re-record only if a golden changes, and list every change (none is expected for 1, 3 and 4; item 2
   has no golden; item 5 changes nothing a golden replays unless a trace restores old shapes).
3. Close the window (scripts and the dated note).

## Acceptance

Both suites green; `soak:selfcheck` green; `node --test tests/freeze/freeze-*.test.mjs` green at the closing commit
(the fixtures are correct on the day the window closes); `npm test` no longer runs the freeze suite. The report lists
every removed line group.
