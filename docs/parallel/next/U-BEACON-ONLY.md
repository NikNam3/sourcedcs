# Briefing: U-BEACON-ONLY (server + client): correlation by beacon code only, no automatic callsign match

Written 2026-10-25 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-BEACON-ONLY`, branch `lane/U-BEACON-ONLY`, `E2E_LANE=6`). **ADR 0142** (yours:
it supersedes the callsign rungs of the §6.6 rule 1 ladder in ADR/WP5 correlation; say which ADRs it amends). Read
**H165** in `decisions.md`; H160 binds you (design for N, no literal Position ids, rule 9).

## The ruling (H165, human 2026-10-25)

"I don't want the autobind feature. It's enough if the controller can set the beacon code and it then correlates
correctly." Trigger: an AI flight correlated by a near callsign match (`COLT11` flying, `COLT1` filed) showed `?` on
its label and `TRK?` on its Strip, and the controller had no way to confirm it.

## What to build

1. **Remove the automatic callsign rungs** (exact and fuzzy) from the correlation ladder
   (`crc-sync/src/efsp/correlation-match.js`, `correlation-reconciler.js`). What remains: the controller's explicit
   binding (`BindTrack`/`UnbindTrack`, `.bind`, Bind… — keep, it is manual) and the Mode 3/A beacon code. A Strip
   whose flight has no code match and no binding is `NO TRK`.
2. **The AI case must work.** An AI aircraft squawks a synthetic code from the reserved block
   (`surveillance/transponder.js`, `config/sensor-specs.json` `transponder.syntheticBlock`), and today
   `code-allocator.js` `validateAssignment` refuses that block on a Strip, so after (1) an AI flight could never
   correlate. Make a **controller-entered** code in the synthetic block valid (the allocator still never hands one
   out automatically), and make the beacon rung match it (`correlation-match.js` header comment: "never an AI's
   synthetic code, which no flight data can hold" is no longer true). So: the controller reads the AI's code off the
   scope, types it into the Strip's code, and the Strip correlates. Walk it: duplicate code (DUPLICATE warning as
   today), the AI unit leaving (synthetic code released and maybe re-minted to another AI: the Strip must not
   silently jump to the new holder without the controller seeing it; find what the beacon rung does on any code
   reuse today and say in the wip note), the code changed again, unbind.
3. **Remove what only the callsign rungs produced**, if nothing else produces it: `PROVISIONAL` state, the
   `TRK?` badge, the label `?` (`track-label.js` `trackNameSuffix`, `FLIGHT_DATA_PROVISIONAL` in
   `surveillance/presentation.js`), `AMBIGUOUS_CALLSIGN`, `REBOUND_ON_CALLSIGN`, `CALLSIGN_EXACT/FUZZY`, the
   `byStem` index, `callsignAffinity` & co. Check every reader first (`surveillance-hints.js`, the correlation-rate
   metric, conformance/CA "provisional counts", ATO import `ato/*`, `start-flight-following.js`, soak, METRICS).
   Two contacts on the **same code** stay `TRK ×2` (pick one). No backwards compatibility (rule 5); a persisted
   record with a removed state: follow the strict-state rule (the correlation record's state is volatile? check).
4. If the wire changes (a state/reason enum, a frame key), `npm run wire:record` (bump as its rule says).

## Gates

Unit tests for the new rule (AI synthetic code typed in → correlated; no callsign-only correlation, exact or fuzzy;
same code twice → ambiguous; bind still wins). Both unit suites once before the report; `npm run walk`,
`npm run freeze` (goldens will move: `freeze:update` in a separate commit, explain the diff); `npm run
soak:selfcheck` (correlation feeds the hub). Specs that cover correlation badges/labels only, on `E2E_LANE=6`, plus
the boot smoke. Every command under `nice -n 19`. Output `docs/wip/U-BEACON-ONLY.md`, including what usage guide §8C
should say (the table loses `TRK?`; how to correlate an AI flight). Final message per rule 8.
