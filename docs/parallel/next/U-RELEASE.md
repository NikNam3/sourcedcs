# Briefing: U-RELEASE (server + client, wire change): released handoffs, check-in, control at the boundary (U5–U8) — ADR 0122

Written 2026-10-13 by the supervisor, **rewritten after H142** (the first version, built on H141's U-RQ1/U-RQ3, is void).
One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree `/home/nklx/dev/personal/sourcedcs-U-RELEASE`, branch
`lane/U-RELEASE`, `E2E_LANE=7`). **Commit at every green step, at least every ~15 minutes.** ADR number **0122** (yours).
**Needs U-JURISDICTION (ADR 0125) merged first**: you call its `isInsideJurisdictionOf` / `jurisdictionAt`.

## Why

Round-2 findings U5–U8 (`docs/parallel/live-test-2026-10-13.md` §B). Rulings, read them whole in `decisions.md`:
**H142 and H143** (the model and the areas) and H141's **U-RQ2 c** (no withdraw). Research background: `docs/parallel/research/release-and-par.md`
R1–R5 (its build sketch assumed the earlier answers: use it for code locations, not for the rules). Supersedes parts of
ADR 0101, 0017, 0039 (never edit them; ADR 0122 says what it replaces, cites ¶2-1-15 **a 1 / a 2 / c** — ADR 0101's
"¶2-1-15 b" is wrong — and ¶2-1-17).

## The model (H142)

1. **Handoff** carries one switch, **Released (default) / Not released**. No partial scopes anywhere.
2. The handing-off station presses **only Handoff**. There is no separate "Comms to …" button: the handoff sends the
   pilot over.
3. The receiver accepts, and marks **"Checked in"** when the pilot calls (radio contact). That is the receiver's only
   step besides accepting.
4. **Control never moves before "Checked in"** (takes precedence over everything). Then:
   - **Released**: control moves at check-in.
   - **Not released**: control moves **automatically** once the aircraft is **inside the receiver's airspace**
     (U-JURISDICTION's `isInsideJurisdictionOf(receivingPosition, track)`: LC/GC the tower area, AP/PAR RAPCON, H143;
     so AP→LC not released moves control on entering the tower area, and AP→PAR at once since both share RAPCON). Settled by the server's control tick (`settleDueRelease` or its successor), audited
     as a Mutation like any control move.
5. **The receiver never takes control by hand**: remove its "Control to me"/take-control action (server refuses it).
6. **Request release, only on a not-released handoff**: the receiver may ask; the handing-off station **grants**
   (the handoff becomes released: control moves at check-in, or at once if already checked in) or **refuses**. One
   open request at a time. **Never offered or accepted on a released handoff or after control moved** (U8: client
   `control-release-rules.js` `handoffSteps` never checks `co.release`; server `applyRelease` REQUEST refuses only an
   open request — fix both). **No withdraw** of a granted release (U-RQ2 c). Grant is all-or-nothing (no scopes).
7. **Dark cockpit (U7)**: nothing shown once control has moved (no "release complete"). Attention (amber) only for what
   needs the controller: an offered handoff to answer, an aircraft accepted but **not checked in** after a while
   (threshold ours, a tuning value, say 60 s), a not-released aircraft **inside the receiver's airspace but not checked
   in** (control cannot move), a refused release request, and control repair. Released/not released shows as one grey word on the receiver's Strip
   until control moves. `COMMS:`/`CTRL:` chips stay grey (U-STRIP).
8. TOFI and tactical handoffs (ADR 0053/0102) unchanged. A position with no geometry to test (no track, uncorrelated):
   a not-released handoff waits; record what the receiver sees.

## Where

Server: `crc-sync/src/efsp/board/coordination.js` (`_applyCoordinationPropose` takes `released`, default true;
`_applyCoordinationAccept`), `board/handoff-control.js` (`applyRelease` → removed or reduced, `applyMark` CHECKED_IN, the
settle tick, refuse receiver TRANSFER_CONTROL), `board/ops/control-release.js`, `authority/`, `refusal-codes.js`,
`wire/frames.js`. Client: `control-release-rules.js` (`handoffSteps`, `handoffChips`), `bay/popovers/coordination.js`
(the Released switch), strip menu.

## Tests and gates

- Unit: every rule above (both suites), including: released + checked in → control moves; not released + checked in +
  outside → stays, then moves on entry; not released + inside + not checked in → stays (amber); AP→LC not released
  waits for the tower area; AP→PAR moves at check-in (shared RAPCON); receiver take-control refused; REQUEST refused on a released handoff and after control moved (U8); GRANT makes it released; REFUSE leaves it not released (amber for the receiver); WITHDRAW refused as unknown. `npm run walk` (the I11
  control-release walk: rewrite for the new model), `npm run freeze` + `freeze:update` (explain the diff, separate
  commit), `soak:selfcheck` (Board/wire moved; the soak driver's handoff steps must follow the new model).
- Wire: `npm run wire:record` (op/action kinds change); protocol stays 2 unless the tool says otherwise.
- e2e: `e2e/control-release.spec.js` and every spec pressing Request release / Grant / Withdraw / partial scopes / "Comms to" /
  "Control to me" (search `e2e/`), rewritten. New: AP→CTR released, CTR checks in, control moves, nothing amber;
  AP→CTR not released, CTR checks in, control waits until the track crosses the RAPCON boundary (synthetic track),
  then moves; AP→CTR not released, CTR requests release, AP grants, control moves at check-in, Request release is gone. `E2E_LANE=7`, your specs.

## Output

Commits on `lane/U-RELEASE`; ADR 0122; `docs/wip/U-RELEASE.md` (usage-guide wording, defaults, any `state/` action the
human must take — an old Board with partial-scope or withdrawn releases may refuse start-up), findings; final message per lane-rules
rule 8.
