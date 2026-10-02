# L20-DOMAINS: comments in the carrier, ATO, runway-status, airspace, MARSA, SFA, scramble and stereo modules

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-DOMAINS` on `lane/L20-DOMAINS` |
| Model / size | Sonnet 5.5 / M: 29 files, 2,078 comment lines, 1 stale pointer, 22 `board-store` lines, 89 vocab hits (FDR 54), 42 markers (most of them L4/L12/L13/L3/L14, keep), 9 rows + the re-sweep of what landed after the prep |
| Wip | `docs/wip/L20-DOMAINS.md` |
| ADR / E2E lane | none / none |

## Goal

The domain modules' comments are true and in the new vocabulary; the prep's rows for them are applied; and the
`[SOURCE-DEFINED]` sweep covers what merged after the prep was written (L17 carrier server half, L18 server half,
L28, UI-B, AIRSP), which nobody has audited yet.

## Owns

`crc-sync/src/efsp/carrier/**`, `crc-sync/src/efsp/ato/**`, and in `crc-sync/src/efsp/`: `carrier-store.js`,
`carrier-tick.js`, `runway-status.js`, `runway-status-store.js`, `alert-scramble.js`, `airspace-config.js`,
`airspace-store.js`, `marsa-store.js`, `sfa.js`, `sfa-store.js`, `stereo-routes.js`. Comments only.
`docs/wip/L20-DOMAINS.md`, `docs/wip/L20-DOMAINS/**`.

## Frozen for you

Everything else, including the client mirrors (`runway-status-rules.js`, `ordnance-advisory.js`, `scramble.js`,
`marsa-badge.js`: L20-CLIENT) and every string (the mirrored "SOURCE practice" sentences stay as they are; any change
is L20-STR's, both sides).

## Steps

0. **Step 0** as in the README (`(cd crc-sync && npm ci)`, `nice npm test`, tools, counts, `--sites L20-DOMAINS`,
   markers, "Code as found", step-0 note).
1. **Re-sweep (prep section 4, on your files).** List the markers added since the prep (`git log --since=2026-10-01`
   on your Owns, then `git blame` on each marker) and the unmarked numeric constants/thresholds added since `c12cd7c`:
   ```
   git diff -U0 c12cd7c HEAD -- <Owns> | grep -E '^\+(export )?(const|let) [A-Z][A-Z0-9_]+ *= *[-0-9(]'
   git diff -U0 c12cd7c HEAD -- <Owns> | grep -iE '^\+.*(doctrin|real[- ]world|\bFAA\b|7110|in practice|standard practice|typically|commonly)'
   ```
   Classify each hit as L9 did (sourced and cited / ours and marked / ours and unmarked → mark / engineering bound →
   say so / overclaim → reword) and list it in the wip. Mark what needs it. Commit.
2. **Rows.** C12 (`airspace-store.js` approver: `[SOURCE-DEFINED] (docs/adr/0036)` — §9.11's verified principle is
   only that ATC approves; the guide's example Position is AP now), D8 (`airspace-config.js`: the FAA/ICAO taxonomy
   sentences, per the L9 row), U3 (`runway-status.js`/`runway-status-store.js` `activeEndIntoWind`: ties and calm go
   to the first end: `// [SOURCE-DEFINED] (decisions H22, S-L1d)`), U11 (`carrier/flight-record.js`
   `BINGO_FIELD_MAX_LEN = 32`: mark or say "engineering bound"; `carrier/ship-state.js:26-27` "the 1° re-broadcast
   step": L17 has merged, read `ship-state.js:233` area: if the step exists, name it; if not, delete the clause),
   U17 (`marsa-store.js:37-41` "forwarding-obligations.js's fire-and-forget alert, which cannot retract": stale since
   L7 (H39), rewrite as "before L7 ..." or delete; Mirror line for `marsa-badge.js:88`), C-10 (`runway-status.js`
   `RUNWAY_GATED_STATES`: add the marker; Mirror line for the label set in `runway-status-rules.js`), C-12 (keep the
   L13 markers). `ato/ato-board.js:10` "efsp-ws.js _handleAtoMutation" (gone: name `wire/families/ato.js`). Commit.
3. **Pointers and vocabulary.** All 22 `board-store` lines; FDR (54) → flight data; TWR/GND/APP (20) → LC/GC/AP;
   "field state" → runway status (module names already changed: `runway-status*.js`); "transfer"/"hand-over" in the
   carrier files → handoff (`carrier/handoffs.js`, `handoff-effects.js`), with SFA rotation transfers and
   `TransferStrip` kept. Commit per directory.
4. **Close.** `node --check`; codecheck `comment-only`; `node --test tests/board-seam.test.mjs tests/clock-policy.test.mjs`
   plus the test file of each module whose comments you changed most (`ls tests | grep <module>`); `nice npm test`
   once. Counts, row table, re-sweep table, Mirror lines, report.

## Acceptance

- codecheck `comment-only`; crc-sync `npm test` identical before → after.
- L20-DOMAINS column: stale pointers 0; 22 `board-store` lines verified; vocab reworded or covered; markers ≥ 42.
- The re-sweep table lists every new marker and every new constant/threshold with its classification.
- C12, D8, U3, U11, U17, C-10 in the row table.

## Defaults (P2)

- A carrier number that `marshal-stack.js:50-54` cites to guide §9.12 is sourced ("binding"), not a marker case.
- The "SOURCE practice" phrase in strings is left as it is (README rule 5).
- Where a comment and its client mirror differ only in wording, do not chase byte equality (drift tests compare
  strings); write the Mirror line when the *meaning* changed.
