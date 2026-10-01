# RENAME-A: crc-sync identifiers, file moves, and every wire/snapshot name

> Read `README.md` in this folder first, then [rename-map.md](rename-map.md) (all of it: the rules in §1 are yours to
> enforce). Rulings: H96 (FAA-oriented renames; wire and snapshot renames only in a separately listed commit; ADRs never
> edited), H98 (scope and the human's calls), S-desk3 (golden replay; an output change is its own commit with the
> fixtures re-recorded in it), R3-2 / S3-4 (clean start, no migration), S-TEST (test policy). Prep notes and the open
> questions RP-1..RP-6: `docs/wip/RENAME-PREP.md`. If the human answered an RP question differently from its default,
> the supervisor has changed `rename-map.md` before you start; the map on your base wins over this briefing.

| | |
|---|---|
| Wave | W7, beside [RENAME-B](RENAME-B.md) and [RENAME-C](RENAME-C.md). You start first; B and C are cut from **your commit 1** (below). Merge order **A → B → C** |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-RENAME-A` on `lane/RENAME-A-crc-sync`, cut from `efsp-wp5-correlation` at the W6 (BACKCOMPAT) merge the supervisor names |
| ADR | none (H96: the glossary is lane C's `docs/glossary.md`) |
| E2E lane | `E2E_LANE=5` (boot smoke and the specs you edit; never the full suite) |
| Size / model | 1 lane / Opus 5.5 (≈3,200 structural and ≈8,500 wire occurrences are mechanical, but ≈1,350 review sites in area A, the wire commit and the trace list need judgement) |

## Goal

Every token of class `W`, `S` and `A` in the mapping table is renamed, by the shared tool, in every tree except
`*.md`. Structural commits are golden-identical. All wire, snapshot, audit and Position/Bay-id renames land in **one
separately listed `behaviour(RENAME-A): …` commit** (at most three if the diff is too big to review, see step 5) that
re-records the goldens and lists every changed trace.

## Owns

- **By token** (rename-map §1.2): every occurrence of a `W`, `S` or `A` token, in `crc-sync/**` (code, tests, tools,
  `server.js`, `config/*.json` for `W` keys and Position/Bay ids), `crc-desktop/app/public/**`, `crc-desktop/tests/**`,
  `crc-desktop/e2e/**`, soak profiles. In client files you change **only** those tokens.
- **Every file move** of rename-map §6, both trees (commit 1), with only the path specifiers, `<script>`/`<link>` paths
  and test file names that point at them.
- The goldens (`tests/freeze/golden/**`, re-recorded in the wire commit only) and the structure fixtures for names you
  rename (`guard-board-surface.json`, the clock allow-list, crc-desktop's module-graph export fixture), each change
  listed. `tests/freeze/selfcheck/M*.mjs` that name a renamed identifier (retarget, rename-map §10).
- `docs/wip/RENAME-A.md`, `docs/wip/RENAME-A/**` (step-0 output, review files, the tool copy you ran).

## Frozen for you

All `*.md` (lane C, including the briefing, guide and CLAUDE.md). Tokens of class `B`, `U`, `E`, `K` and the prose rows
(`P`). `docs/parallel/refactor/rename-map.md` (a row you need: SendMessage "main"). `docs/adr/**`. Comments' English
(L20): a comment changes only where it names a renamed token.

## Steps

0. **Step 0** per README: install, both suite counts, the freeze goldens once (`node --test tests/freeze/freeze-*.test.mjs`
   from `crc-sync/`, or `npm run freeze` if BACKCOMPAT made it opt-in). Copy rename-map §8 to your scratchpad as
   `rename_tool.py` and run, from the repo root:
   ```
   python3 rename_tool.py count --tokens > docs/wip/RENAME-A/step0-count.txt
   git grep -n -E "require\([^)]*(stca|station-coverage|fdr-store|field-state|carrier/transfer)|from '[^']*(stca|station-coverage|fdr-store|field-state|carrier/transfer)" -- crc-sync crc-desktop
   git grep -n -I -E "/[^/\n]*\b(TWR|GND|APP)\b[^/\n]*/[gimsuy]*[,)]" -- crc-sync/tests crc-desktop/tests crc-desktop/e2e   # trap 1
   git grep -n -I -E "\b(TWR|GND|APP)\b" -- 'crc-sync/tests/*.mjs' 'crc-desktop/tests/*.js' 'crc-desktop/e2e/*.js' | grep -v -E "['\"\`](TWR|GND|APP)['\"\`]"   # ids in sentences
   ```
   Write "Code as found" in `docs/wip/RENAME-A.md`: the per-row counts against rename-map §9 (a row whose count moved by
   more than 20 % gets a sentence), the stem compounds with their derived class, every file of §6 re-found on the new
   layout (`wire/families/field-state.js`, `authority/roles/`, `board/**` did not exist at prep time), and the
   **promotion check**: for every `A`/`S` exact row, `git grep -n -E "\b<token>\b\s*:|\.<token>\b" -- crc-sync/src/efsp/wire crc-sync/src/efsp/efsp-ws.js crc-sync/src/ws-hub.js crc-sync/src/efsp/board/persistence.js`
   (and the store registry's `snapshot` functions); a hit that is a sent or persisted property is promoted to `W`
   (rename-map §1.2) and listed. Send "main" the step-0 note.
1. **Commit 1, `refactor(RENAME-A): file moves and the N14 pre-rename`.** `git mv` every file of rename-map §6 (both
   trees), rewrite the specifiers by path with a scripted `sed` over the step-0 grep hits (quote the script in the wip
   file), then `python3 rename_tool.py apply --lane A --kind structural --rows N14P`. Golden-identical; module-graph and
   surface fixtures updated for the new paths. **Tell "main" the hash at once: RENAME-B and RENAME-C are cut from it.**
2. **Review files.** On commit 1, `python3 rename_tool.py review <ROW> --area A` for every `?` row that is yours (N03,
   N04 `held`, N11 `role`/`Role`/`roles`/`Roles`, N13, N18 part). Mark each site `Y`/`N` with a reason in
   `docs/wip/RENAME-A/review-<ROW>.tsv`. The rules: N04 `held` only where it is the list of Positions a controller is
   signed on to (the `efsp-set-positions`/`efsp-positions-ack` field, the coverage `held` array, locals holding
   Position ids), never `HELD`/hold; N11 only the Strip axis (Strip/op/Bay/Block-Map `role`), never ARIA, Casdoor or
   Playwright; N13 only `coordination.state` and `tofiCoordination.state` values, including where those objects are
   built (`state: 'PROPOSED'` inside the coordination record) and every comparison, never Strip `PROPOSED` or the runway
   change; N03 only a Position's staffing. RENAME-B writes the same files for area B (`docs/wip/RENAME-B/review-*.tsv`);
   copy them into your tree as `docs/wip/RENAME-A/review-B-<ROW>.tsv` before step 4 (`git show <B-branch>:<path>`).
   Commit the review files (`docs(RENAME-A): review decisions`).
3. **Structural token commits**, one per group so each diff is reviewable: N02+N03+N04+N05; N06+N07; N10; N11;
   N16+N18 structural rows. Each: `python3 rename_tool.py apply --lane A --kind structural --rows <rows>`, read every
   WARN, fix any MERGE with a new map row (ask "main"), then the per-commit gate: the touched test files plus the
   freeze goldens, **identical**. A structural commit that moves a golden byte means a token was misclassified: promote
   it to `W` and back it out of this commit.
4. **The wire commit**, `behaviour(RENAME-A): wire, snapshot and audit names (H96, H98)`. Approved in principle by
   H96/H98; send "main" the changed-trace summary before committing and commit on its ack.
   `python3 rename_tool.py apply --lane A --kind wire` with all review files (yours and B's) in place, then the traps
   of rename-map §10 (regex literals and expected sentences naming ids: fix each from the step-0 grep, listed), then
   `npm run freeze:update` and the trace list: every golden file and trace id whose bytes changed (expect nearly all;
   name any that did **not** change, those are the interesting ones). Retarget the selfcheck mutations that name a
   renamed token and run `npm run freeze:selfcheck` once. `npm run soak:selfcheck` (you touched `board/**`, `wire/**`,
   `efsp-ws.js`, `ws-hub.js`). If the commit is too big to review, split it into at most three, each re-recording on its
   own: (a) N18 Position and Bay ids, (b) N10 flight data, (c) the rest.
5. **State check (no migration).** Start crc-sync once on the renamed tree against a `state/` directory written by the
   base (run the base's server for a minute with a Strip on the Board, copy its `state/`). Record what happens: the
   facility copies with `coveringChain`/`TWR` must fail the DATA-1 validation loudly; the Board snapshot with `fdrs`/
   `fdrId` must hit BACKCOMPAT's loud start-up error or load as empty. **If it starts and serves a half-read Board**,
   that is a finding for "main" (a fix is a behaviour change the supervisor decides), not something you patch.
6. Both unit suites once, the boot smoke on `E2E_LANE=5` and the e2e specs whose files you edited only if fewer than
   five (otherwise list them for the supervisor's sharded run), report.

## Ordering with B and C

- B and C are cut from your commit 1, so all three share one set of file paths and the review-file keys
  (`path:line:token#n`, lines never move under a rename) agree.
- B never edits a `W`/`S`/`A` token and you never edit a `B`/`U` token, but both of you edit client files. When the
  supervisor merges B after you, a textual conflict is resolved by taking your side and **re-running B's `apply` on
  it** (B's rows are exact and stem rows only, so the re-run is deterministic). Same for C after B.
- The UI strings that contain Position ids and old words are B's (rename-map §5.1), but a test assertion that checks a
  wire value is yours: change it in the wire commit.

## Acceptance

- Every structural commit golden-identical; the wire commit(s) re-record with the trace list in the commit message and
  the report.
- crc-sync and crc-desktop `npm test` green, counts before → after equal (renamed test files keep their tests; explain
  any difference).
- `soak:selfcheck` all detectors fire; `freeze:selfcheck` every mutation applies and is caught.
- `python3 rename_tool.py count` on your head shows 0 for every `W`/`S`/`A` exact and stem row, and the review sites
  left are exactly the `N` decisions.
- Boot smoke on lane 5 passes. The supervisor runs the full Playwright suite sharded after the W7 merge (S-TEST (c)).

## Defaults (P2)

- Lower-case local variables named after an old Position id (`const twr = …`, `gnd`, `ctr`, never `app`) are left
  and listed for L20.
- Opaque invalid-input test values (`ROLE1`, `NOSUCHROLE`, `MTX-NOROLE`) stay (they are `!` rows).
- The STARS position letters (`positionLetters`: `G`, `T`, `A`) stay; they are facility data.
- A token that step 0 finds and the map does not cover gets a `!` row request to "main", never a hand edit.
