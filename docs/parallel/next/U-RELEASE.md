# Briefing: U-RELEASE (server + client, wire change): release, control and comms the FAA way (U5–U8) — ADR 0122

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-RELEASE`, branch `lane/U-RELEASE`, `E2E_LANE=7`). **Commit at every green step, at
least every ~15 minutes.** ADR number **0122** (yours).

## Why

Round-2 findings U5–U8 (`docs/parallel/live-test-2026-10-13.md` §B). Research: `docs/parallel/research/release-and-par.md`
R1–R5, its "Build sketch: U-RELEASE" (l.~650) and its corrections section. Rulings: **H141** (`decisions.md`), which
**differ from the research's recommendations in one place: U-RQ2 c, withdraw is removed, not kept.** H128 (FAA model),
H115–H119 (dark cockpit). Supersedes parts of ADR 0101 and ADR 0017/0039 (never edit them; ADR 0122 says what it
replaces, and cites ¶2-1-15 **a 2** where ADR 0101 wrongly says "b").

## What to build (H141)

| Id | Rule | FAA |
|---|---|---|
| U5 | A HANDOFF may be **offered already released**: the handoff form has a "Released" section (scopes as GRANT has today, incl. Control); the receiver's ACCEPT writes it as the grant; the receiver need not request anything. | ¶5-4-3 b, ¶2-1-15 a 1, ¶5-4-6 b/c |
| U-RQ1 | A **FULL release moves control by itself**, at once or at its effective time; comms stay a separate step. "Full" is renamed **"Control"** everywhere a controller reads it (scope label, chip, refusal text). New control-move trigger `COORDINATED` (name it to fit the existing trigger enum). | ¶5-4-5 k, ¶2-1-15 a 1 |
| U-RQ2 | **No withdraw.** Remove the `WITHDRAW` action (server op kind, client button, tests). An approved release stands until control moves; after that the way back is a handoff the other way. Old Mutation-log/snapshot shapes: `state/` is strict, no migration (an old Board with a withdrawn release refuses start-up only if its shape changes; say in the wip note what the human must delete). | ¶8-2-2 a; orders silent on withdrawing |
| U6 / U-RQ3 | The receiver's **"Comms to me" becomes "Checked in"** (records the check-in; only the transferring side's "Comms to …" tells the pilot). The receiver's **"Control to me" is refused until comms are with the receiver**, then labelled **"Control at boundary"**. The research's R4 table lists all 12 receiver actions: everything else stays. | ¶2-1-15 c, ¶2-1-17 a/b |
| U7 | **No "release complete" marker**: once control has moved the receiver's Strip shows nothing about it. Follow the R5 state table: attention (amber) only for an open offer the controller must answer, a refused request, and control repair; everything normal is grey or absent. `COMMS:`/`CTRL:` chips were made grey by U-STRIP (merged before you): keep that. | dark cockpit (ours) |
| U8 | **Bug:** the receiver still has "Request release" after a full release. Client `control-release-rules.js` `handoffSteps` never checks `co.release`; server `board/handoff-control.js` `applyRelease` REQUEST refuses only an open request. Fix both: no REQUEST offered or accepted when the release in effect already covers the scopes, or control has moved. | — |

## Where

Server: `crc-sync/src/efsp/board/coordination.js` (`_applyCoordinationPropose` optional `release`, `_applyCoordinationAccept`),
`board/handoff-control.js` (`applyRelease`, `settleDueRelease`, `applyMark` TRANSFER_CONTROL from the receiving side),
`board/ops/control-release.js`, `authority/`, `refusal-codes.js` (any new code joins `REFUSAL_CODES`), `wire/frames.js`.
Client: `crc-desktop/app/public/js/panels/efsp/control-release-rules.js` (`handoffSteps`, `handoffChips`),
`bay/popovers/coordination.js` (the handoff form), strip menu.

## Tests and gates

- Unit: `tests/efsp-control-release*.test.mjs` (both suites), new cases for each row above, including U8's refusal on
  the server. Both unit suites green. `npm run walk` (the I11 control-release walk lives there: update it for the new
  rules), `npm run freeze` then `freeze:update` with a small, explained diff (commit goldens separately),
  `soak:selfcheck` (Board/wire moved).
- Wire: `cd crc-sync && npm run wire:record` (op kinds change: WITHDRAW gone, propose carries `release`); protocol stays 2
  unless the tool says otherwise. Record contents/ack payloads are unscanned: use `-- --bump` only if the tool tells you to.
- e2e: `e2e/control-release.spec.js` and every spec that presses Withdraw / "Comms to me" / "Control to me" / "Full"
  (search `e2e/`), updated; one new spec: AP hands off to CTR **already released (Control)**, CTR accepts, control moves
  without a request, CTR has no Request release, pilot checks in, nothing amber left. `E2E_LANE=7`, your specs only.

## Output

Commits on `lane/U-RELEASE`; ADR 0122; `docs/wip/U-RELEASE.md` (usage-guide wording in R1's terms, defaults taken,
the human's `state/` action if any, findings); final message per lane-rules rule 8.
