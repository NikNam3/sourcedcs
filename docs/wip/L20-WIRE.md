# L20-WIRE report

Branch `lane/L20-WIRE`, base 277e65f. Comment-only gate: `comment-only: no code change`.

## Counts (l20scan, L20-WIRE column), base -> final
comment lines 1515 -> 1463; stale file ptr 1 -> 0; stale _method ptr 5 -> 0; board-store lines 37 -> 6 (all verified,
`BoardStore`/`board-store.js` still exist: required-rules.js x2, replay-cache.js x2, efsp-ws.js:126, frames.js:18);
vocab 184 -> 9 (kept: "client claim" x6 untrusted-claim sense, "covered by" x1, runway occupancy x2); markers 15 -> 19.

## Code as found (step 0)
permission.js header "Phase 1 had only ... not in the op union" (C-7); nla.js header Phase 1/2/WP4A narration; efsp-ws.js
`theater-settings`-style pointer was `theaterSettingsSet`; `_applyCoordinationPropose` named as board-store's; classes.js
"config.js's positionClasses"; departure.js `_validateBayImpliedTransition`; wire/families cite `_handleAirspaceMutation`.

## Rows
- C-7 applied (permission.js header rewritten to the present; guide quote now "signed-on set", matching guide §4.8.4).
- C13 applied (departure.js `// [SOURCE-DEFINED] (guide §3.4) —`; arrival.js "guide-given").
- C16 applied (mission.js: `[SOURCE-DEFINED] — the guide's own mission lifecycle (guide line 215, under §3.4's [SOURCE-DEFINED] heading ...)`).
- D10: no longer applies, because ADR 0087 put overflight on the guide's four-state lifecycle and overflight.js already says so.
- C-4: `theaterSettingsSet` dropped from efsp-ws.js header (no such message exists; `aptConfigSet` kept).
- BOARD-1: departure.js now names board/ops/invoke-nla.js `_applyInvokeNla` and board/placement.js `validateBayImpliedTransition`.
- BOARD-2: coordination/TOFI methods named as board/coordination.js, board/tofi.js. `_pruneLog`: no occurrence found in owned files.
- family files: `_handleAirspaceMutation` references replaced by "the airspace family (airspace.js)".
- skeleton.js `_subject` -> the family's `subject` field. L23 TACTICAL capability-table marker kept.
- Vocabulary: TWR/GND/APP -> LC/GC/AP, Strip Role -> strip type, FDR -> flight data, field state -> runway status,
  held set -> signed-on set, covering -> consolidated at.

## Mirror lines (for L20-CLIENT)
- efsp-nla.js C14: prefix the per-State owners comment `// [SOURCE-DEFINED] (guide §3.4) — mirrors authority/strip-types/departure.js's marker.`
- efsp-nla.js C15 (mission lifecycle): `[SOURCE-DEFINED] — the guide's own mission lifecycle (guide line 215, under §3.4's [SOURCE-DEFINED] heading).`

## ADR errata
none found.

## Tests
Baseline crc-sync `npm test`: 2118 tests, 2116 pass, 1 fail (`a stream the server ends straight away is retried with
growing, jittered delays` in the gRPC client test, unrelated; it passed on the final run), 1 todo. Final: 2117 pass, 0 fail.
Touched-file tests (board-seam, wire-payload-contract, required-rules, clock-policy): 16/16.

## Findings
- Several comments still narrate WP4A/WP4A-slice history ("WP4A gap-closure", "WP4A second slice"); kept as ADR-anchored context.
