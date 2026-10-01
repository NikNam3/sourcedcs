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
| W7 | RENAME (briefing to be written from `docs/parallel/research/vocabulary.md`, H96/H98) | W6 merged | alone, tree-wide; golden replay proves it; wire/snapshot renames in a separately listed commit; then the window closes and L20 starts |

Every wave also runs **one questioner** (Opus). It reads each lane's step-0 report ("Code as found" plus the design
notes) and challenges its assumptions against the plan, decisions.md and the code, before the lane writes production
code. The lane carries on with its defaults meanwhile (P2), but it must answer the questioner's points in its wip file.
Peak load is 9 agents in W3 (8 lanes and the questioner). The cap is 10.

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
- **Gates** (plan §3.3): both suites green; golden identical; `npm run soak:selfcheck` when you touch
  `board-store.js`, `board/**`, `efsp-ws.js`, `wire/**`, `ws-hub.js`, `sync/**` or `host-core.js`; Playwright full suite
  on your `E2E_LANE` when you touch `crc-desktop/app/public/**`.
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

ESM-1 `E2E_LANE=1` (the ESM-1T lanes run no Playwright; the unit's full run is ESM-1's), ESM-2a `2`, ESM-2b `3`,
CMSG `4`. The supervisor's post-wave full run uses lane `7`. Server lanes need no Playwright run of their own.

## The approved-change queue

Plan §6. Two items are already approved by the human: TIME-B's wall clock and BACKCOMPAT's removal and loud start-up
error. Items 3, 4, 5 and 8 need the human; the supervisor puts them on the Decision Desk before the lane that would
build them. Items 6 and 7 (DATA-1) the supervisor approves and reports.
