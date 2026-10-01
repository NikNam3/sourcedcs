# The architecture refactor: dispatch order and shared rules

Plan: `docs/wip/ARCH-plan.md`. ADR: `docs/wip/ARCH-plan-adr.md` (0095, committed by BOARD-1). Rulings:
`docs/parallel/decisions.md` rows S-ARCH, H78, H79–H87, S-desk3. **decisions.md wins over every briefing here, and the
merged code wins over a briefing's line numbers.** Lane rules: `docs/parallel/lane-rules.md` (all of it applies).

## Waves

| Wave | Lanes (parallel) | Start condition | Merge |
|---|---|---|---|
| W1 | [R0](R0.md) · [ESM-1](ESM-1.md) · [ESM-1T](ESM-1T.md) a/b/c (cut from ESM-1's first sources-converted commit) | merge4 + R3-47 follow-up merged into `efsp-wp5-correlation`, goldens re-recorded there | R0 alone; ESM-1 + the three ESM-1T as **one unit** |
| W2 | [BOARD-1](BOARD-1.md) · [WIRE](WIRE.md) · [STORES](STORES.md) · [APP](APP.md) | R0 merged | WIRE → STORES → BOARD-1 → APP |
| W3 | [BOARD-2](BOARD-2.md) · [AUTH](AUTH.md) · [DATA-1](DATA-1.md) · [DATA-2](DATA-2.md) · [LOG-1](LOG-1.md) · [CMSG](CMSG.md) · [ESM-2a](ESM-2a.md) · [ESM-2b](ESM-2b.md) | W2 merged (and the ESM-1 unit, for the client lanes) | any order |
| W4 | [BOARD-3](BOARD-3.md) · [LOG-2](LOG-2.md) · [TIME-B](TIME-B.md) | BOARD-2, AUTH, LOG-1 merged | BOARD-3 → LOG-2 → TIME-B |
| W5 | [SYNC](SYNC.md) | W4 merged | alone |
| W6 | [BACKCOMPAT](BACKCOMPAT.md) | W5 merged | alone |
| W7 | [RENAME-A](RENAME-A.md) · [RENAME-B](RENAME-B.md) · [RENAME-C](RENAME-C.md), one shared map [rename-map.md](rename-map.md) (H96/H98, desk RP-1..6) | W6 merged | alone, tree-wide; golden replay proves it; wire/snapshot renames in a separately listed commit; then the window closes and L20 starts |

Every wave also runs **one questioner** (Opus). It reads each lane's step-0 report ("Code as found" plus the design
notes) and challenges its assumptions against the plan, decisions.md and the code, before the lane writes production
code. The lane carries on with its defaults meanwhile (P2), but it must answer the questioner's points in its wip file.
Peak load is 9 agents in W3 (8 lanes and the questioner). The cap is 10.

## Test policy (S-TEST, human 2026-10-01: "only run tests when absolutely necessary") — wins over every briefing's gate lines

Measured unloaded on the dev machine: crc-sync `npm test` 18 s, freeze goldens alone 14 s, crc-desktop `npm test` 8 s,
`soak:selfcheck` ~40 s, `freeze:selfcheck` ~5 min, **full Playwright ~18 min and load-sensitive** (9 agents running it at
once is what produced the "load lottery" failures).

- **While working:** run only the test files for the code you touched (`node --test tests/<file>`), plus the freeze
  goldens (14 s) after each structural commit. That is the per-commit gate.
- **Once, before your report:** both full unit suites; `soak:selfcheck` if you touched the files listed under Gates;
  `freeze:selfcheck` only if you retargeted a mutation (once, at the end, not per commit).
- **Playwright: lanes never run the full suite.** Client lanes (ESM-1, ESM-2a, ESM-2b, CMSG) may run a boot smoke
  (one spec that loads the app and asserts zero script errors) and the specs for the panels they changed, on their own
  `E2E_LANE`, never more than one Playwright process per lane. **Server-only lanes run no Playwright at all**: a
  golden-identical structural change sends byte-identical frames, which the client cannot tell apart.
- **The supervisor runs the full Playwright suite**, sharded across E2E lanes in parallel (`e2e/tools/run-sharded.js`,
  PW-SHARD), only (a) after merging a wave that touched `crc-desktop/app/public/**` (the ESM unit; W3's ESM-2a/2b/CMSG,
  merged together and run once), (b) after any approved `behaviour(...)` commit a controller could see, and (c) once at
  the window close. Never more than one full run machine-wide. A failure is re-run alone before it counts.
- Re-running a suite that already passed on the same tree is never needed; cite the earlier run instead.

## Slot plan (cap 10 agents; fill idle slots, critical path first)

The critical path is the board-store chain BOARD-1 → BOARD-2 → BOARD-3 → SYNC → BACKCOMPAT → RENAME. The supervisor
keeps it moving first and fills the remaining slots in this priority order:

1. **W1 and W2 overlap.** W2's start condition is R0 merged, not the ESM unit: BOARD-1, WIRE, STORES and APP run
   alongside ESM-1 and ESM-1T a/b/c (server-only vs client-only files). Peak 9 with the questioner.
2. **Side tracks that touch no frozen file** (start in W1, fill any free slot):
   - **PW-SHARD** (Sonnet): `crc-desktop/e2e/tools/run-sharded.js` splits the spec files across N `E2E_LANE`s and
     runs them in parallel with per-lane servers (builds on E2EH's run-order tool and reset supervisor); target the
     full suite in ~5 min. Touches only `crc-desktop/e2e/tools/**` and a package.json script.
   - **Post-refactor design** (Opus, docs only): ADR drafts and lane briefings so the feature lanes start the day the
     window closes: (a) formation Split/Join + undo for every one-click move (H89-H91, H95), (b) control release on
     HANDOFF (H94) + TOFI regime at airspace entry (H97), (c) the airspace registry ADR 0098 with `kind: AREA|ROUTE`
     (S-R3-80), geometry as polygon or DCS drawing (R3-12) and the sourcedcs-web airspace admin/booking-tool link
     (AIRSP-2 note).
   - **RENAME prep** (Opus, docs only): the W7 briefing(s) and the exact mapping table from
     `docs/parallel/research/vocabulary.md` + H98 (FAA position names with citations).
   - **INFRA3** (Sonnet): the settled infra items outside the refactor's files: R3-34 (compose → `./init.sh`), R3-36
     (CI check for the nginx template, if INFRA2 did not add one), R3-37 (refuse release tags not on main), R3-67
     (delete the nix packages, not the dev shell; keep any code), R3-17 (untrack `sourcedcs-web/data` with a seed,
     compare first). Touches `infra/`, `.github/`, `flake.nix`, `sourcedcs-web/` only.
3. **W7 RENAME runs as three parallel lanes** by area (crc-sync identifiers / client and CSS / docs, config keys, env,
   infra), sharing one mapping table; wire message names belong to one lane that edits both sides.
4. **After the window:** L20 first (split by directory into parallel lanes, comments only), then the feature lanes in
   parallel by disjoint files (Split/Join+undo, release+TOFI, AIRSP phase 2, WIRE-B, SYNC-B).

## Conventions every refactor lane follows

- **Worktree:** `/home/nklx/dev/personal/sourcedcs-<LANE>` on `lane/<LANE>-<slug>`, cut from `efsp-wp5-correlation`
  at the commit the supervisor names (after the previous wave merged). ESM-1T lanes are cut from ESM-1's branch.
- **Install first:** `(cd crc-sync && npm ci) && (cd crc-desktop && npm ci) && (cd crc-desktop/app && npm ci)`.
  Without it crc-sync shows about 10 false failures (`Cannot find module 'ws'`).
- **Step 0, before any code:** record both suite counts at your base, run the freeze suite once, and write "Code as
  found" in `docs/wip/<LANE>.md`: every line number your briefing cites, re-found by symbol on your base. Send the
  supervisor a one-paragraph note that step 0 is done (the questioner reads it).
- **Structural commits** (`refactor(<LANE>): …`) must leave every behaviour golden identical:
  `cd crc-sync && node --test tests/freeze/freeze-*.test.mjs` with no `UPDATE_GOLDEN`. **Never run
  `npm run freeze:update` in a structural commit.** If a golden fails, your move changed behaviour: fix the move. If you
  believe the change is right, stop and SendMessage "main". It becomes a separate `behaviour(<LANE>): …` commit only if
  the supervisor approves it, and that commit re-records with `npm run freeze:update` and lists every changed
  trace and step.
- **Structure fixtures** (`tests/freeze/golden/guard-board-surface.json`, the clock allow-list in
  `tests/clock-policy.test.mjs`, crc-desktop's module-graph export fixture) may change in a structural commit when the
  structure does. List each change in the commit message and in your report. Every lane may edit these entries for
  the code it moves (a `Date.now()` site that moves from `board-store.js` to `board/strip-ops.js` changes its
  allow-list entry's file and function, not its reason), even though the files are not under its "Owns".
- **Selfcheck:** after R0, `crc-sync/tests/freeze/selfcheck/` holds one file per mutation (M1…M16). When you move code a
  mutation targets, retarget **that mutation file only** and re-prove it with `npm run freeze:selfcheck` (about 5 min).
  Every mutation must apply and be caught.
- **Gates** (plan §3.3, timing per the test policy above): both suites green; golden identical; `npm run soak:selfcheck`
  when you touch `board-store.js`, `board/**`, `efsp-ws.js`, `wire/**`, `ws-hub.js`, `sync/**` or `host-core.js`; for
  client lanes the boot smoke and touched-panel specs only (the full Playwright run is the supervisor's).
- **Comments move verbatim with their code.** Do not reword, add `[SOURCE-DEFINED]` markers, or fix a stale comment.
  That is L20's job, on the new layout. If a comment is now false because of your move (it names a file or method
  that moved), change only the pointer.
- **Files:** write only what your briefing lists under "Owns". Reading anything is fine. If you need a one-line edit
  outside your list, ask "main" first. Never edit shared docs (CLAUDE.md, the guide, the briefing, READMEs) unless your
  briefing lists them.
- **No feature work, no fixes on the side.** If you find a bug, write it under "Findings" in your wip file with a
  failing `test.todo` if cheap. Do not fix it in a structural commit.
- **Report** (final message, at most 40 lines, and the same at the top of `docs/wip/<LANE>.md`): branch and
  `git log --oneline <base>..HEAD`; both suite counts before → after; golden status (identical / approved behaviour
  commits with the changed traces); selfcheck and soak results; structure-fixture changes; files touched outside "Owns"
  (should be none); defaults taken (P2); findings for other lanes; anything the supervisor must decide.

## E2E lanes

ESM-1 `E2E_LANE=1` (the ESM-1T lanes run no Playwright; the unit's full run is the supervisor's, S-TEST), ESM-2a `2`, ESM-2b `3`,
CMSG `4`, RENAME-A `5`, RENAME-B `6`. The supervisor's post-wave full run uses lane `7`. Server lanes need no Playwright run of their own.

## The approved-change queue

Plan §6. Two items are already approved by the human: TIME-B's wall clock and BACKCOMPAT's removal and loud start-up
error. Items 3, 4, 5 and 8 need the human; the supervisor puts them on the Decision Desk before the lane that would
build them. Items 6 and 7 (DATA-1) the supervisor approves and reports.
