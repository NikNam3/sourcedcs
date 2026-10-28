# TIME-B: durations on the wall clock (an approved behaviour change), and the single-owner check for time parsing

> Read `README.md` in this folder first. Rulings: R3-16 ("keep the rule, move pure durations to wall time"), S3-3
> ("mission clock for facts, wall clock for housekeeping"), S-desk3 (consistent with R3-5), R3-63 ("one owner of the
> time-parsing rules"). Plan: `docs/wip/ARCH-plan.md` §2.8, §6 item 1, §9 points 9, 11 and 13. ADR 0079 is **not**
> edited (P4).

| | |
|---|---|
| Wave | W4, after APP and LOG-1 merged; beside BOARD-3 and LOG-2. **Merges last in W4** (it re-records goldens) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-TIME-B` on `lane/TIME-B-wall-durations` |
| ADR | **0096**: durations and housekeeping run on the wall clock; facts and gates on the mission clock |
| Size / model | 0.5 lane / Sonnet 5.5 |

## Goal

L19's "detected airborne" hold (5 s) and staleness threshold (120 s), and conformance's heading grace, are measured on
an **injected** wall clock. Every time they stamp, log or show (`since`, the staleness entry's `at`, the alert's
`since`) stays mission time. You also confirm that no HHMM parser exists outside `zulu-time.js` (the DTG grammar in
`ato/usmtf-time.js` is a separate owner), and you write ADR 0096.

## Owns

`crc-sync/src/efsp/surveillance-hints.js`, `src/efsp/conformance.js` (including their `console` calls),
`src/app.js` (only the two constructor calls that pass `wallClock`), `tests/clock-policy.test.mjs` (the allow-list),
these modules' unit tests, the goldens re-recorded in your behaviour commit, `docs/adr/0096-*.md`,
`docs/wip/TIME-B.md`.

## Frozen for you

`surveillance-hints-config.js` (the thresholds stay as they are), `mission-clock.js` (use its `WALL_CLOCK`; do not
change it), the Board, the wire, every other file.

## Steps

0. Step 0 per README: every duration comparison in both modules (`now - since >= x`), and for each one, what it is
   compared against. For conformance: the grace runs from the clearance's **mission** `at` (ADR 0079's table says so),
   so a wall-clock grace needs a wall start. Default (§9 point 11): the monitor stamps the wall time when it first sees
   the clearance, and the grace runs from that. List any other choice the questioner raises.
1. **Structural commit:** inject `wallClock` (default `WALL_CLOCK`) into both constructors, and pass it from
   `createApp`. Nothing reads it yet. Golden identical.
2. **`behaviour(TIME-B)` commit** (approved by the human, R3-16): the durations read `wallClock`. Re-record with
   `npm run freeze:update` and list every changed trace and step (expected: `hub-monitors`, maybe the random traces).
   Update the clock-policy allow-list (no new bare `Date.now()`: the wall clock is injected).
3. **Time-owner check** (R3-63): grep crc-sync and the client for HHMM or DTG parsing outside `zulu-time.js` and
   `ato/usmtf-time.js` (and the client hand copies under PARITY). Report what you find. Do not consolidate
   `usmtf-time.js` (QAS: a different grammar; §9 point 9).
4. ADR 0096: the rule ("mission clock for facts and gates: anything read as a time, stored on a record or compared
   with one; wall clock for pure durations and housekeeping, injected, never bare"), which rows of 0079's table it
   supersedes (the conformance row) and which it adds (L19's hold and staleness), and why every stamp stays mission time.

## Acceptance

Both suites green; golden identical after step 1; after step 2 only the listed traces change, with the diff explained
step by step; the boot test passes; ADR 0096 committed. Tell "main" that `docs/parallel/lane-rules.md` §5 ("never
`Date.now()`", H11) needs the refined wording (you do not edit it).
