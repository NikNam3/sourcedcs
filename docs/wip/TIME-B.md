# TIME-B report

Branch `lane/TIME-B-wall-durations` (base 0bfe9d3). Commits: see `git log --oneline 0bfe9d3..HEAD` (structural `refactor(TIME-B)` wallClock injection, golden identical; `behaviour(TIME-B)` clock switch + re-record; `docs(TIME-B)` ADR 0096 + this file).

- Suites: crc-sync 2145 → 2146 (2144 → 2146 pass; two new divergence tests, one rewritten). crc-desktop 866 → 866 (865 pass, unchanged). In the final full run 2-3 timing tests failed under load (`ato tokenize: pathological inputs finish fast`, `grpc-client-stream` backoff, one more); both re-run alone: pass.
- Golden: identical after the structural commit (47/47). After the behaviour commit only `hub-random-seed1/2/3` changed, all `efsp-alerts` frame timing, every snapshot hash identical: seed1 i=620, 669, 684, 688-801 (alerts hash d975bece69 -> 07009d7f93 on every later tick); seed2 i=264, 267, 646, 694; seed3 i=384, 448, 479. Named traces (including `hub-monitors`) unchanged. Cause: virtual `Date.now` moves only on collapsed timer waits, so wall-measured hold/staleness expire at other ticks.
- `freeze:selfcheck`: 18/18 caught (M14 clock-policy included). soak:selfcheck not run (no Gates file touched).
- Structure fixtures: none changed (clock-policy allow-list needs no edit: WALL_CLOCK is injected, no bare site added or removed).
- Files outside Owns: tests/efsp-mission-clock.test.mjs (its conformance grace test, rewritten for the wall clock). `app.js` also had one comment rewritten (conformance-stca tick), besides the two constructor lines.
- Controller-visible: yes, alert/hint timing only where mission and wall clocks disagree (pause, reload, resync); supervisor decides on Playwright. Alerts and chips otherwise appear on the same ticks.

## Code as found
- surveillance-hints.js: `debouncedPhase(..., now, ...)` (hold 5 s vs `mem.phase.since`), `durationMs = now - mem.episode.since >= staleness.afterSec*1000`. conformance.js: `now - hdg.at < headingGraceSec*1000` (grace vs the clearance's mission `at`); persistence checks `now - mem.*Since >= *PersistSec*1000` (heading 10 s, wrong-way, bust) are also durations but stay mission (not in scope). app.js: the two constructor calls plus `stcaMonitor.tick(Date.now())` (allow-listed).
- clock-policy: 14 sites in 7 files, no entry for these modules.

## Defaults taken (P2)
- Conformance grace starts at the wall time the monitor first sees the heading clearance (stamped before the min-ground-speed early return, so a slow aircraft does not get a fresh grace on speed-up). After a restart the grace restarts.
- Persistence durations (heading/wrong-way/bust) left on mission time; hint and conformance `since`/`at` mission; `durationMs` in the staleness log is wall time.

## Time-owner check (R3-63)
No HHMM or DTG parser outside `zulu-time.js` (parseZuluHhmm) and `ato/usmtf-time.js` (parseDtg). Other hits are not parsers: `mission-clock.js` ISO_RE (the gRPC scenario ISO stamp, a third grammar, one owner already), `magnetic.js` Date.UTC year math, `mutation-log.js` segment-name regex. Client: only `formatZuluHhmm` and `time-chains.js` hand copies (PARITY).

## Findings
- The three persistence durations are the same class as the grace and could move to wall time in a follow-up.

## Text for the supervisor: lane-rules §5 (H11), replace "EFSP times come from the injected mission clock, never `Date.now()` (H11)." with:
"EFSP facts and gates (anything read as a time, stored on a record or compared with one, every Mutation-log `at`) come from the injected mission clock; pure durations and housekeeping use an injected wall clock (`WALL_CLOCK` or a `wallClock` dependency). Never a bare `Date.now()` (H11, ADR 0096)."
S-ARCH2 (10) conformance grace can end once TIME-B merges.
