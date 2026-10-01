# Lane SOAKW: memory.slope judged only on 3 h+ runs (crc-sync/tools/soak/)

## Rule (supervisor decision, S-SOAK)
`memory.slope` (and `memory.netGrowth`, the same retention fill) is judged only on runs of 3 hours or more
whose warm-up is at least the Strip retention (2 h, `ARCHIVE_AFTER_MS` read from `src/efsp/archiver.js`, ADR 0082).
Shorter runs report it as **not judged**: not a failure and not silently green. The headline reads
`SOAK PASS ... (memory.slope NOT JUDGED)`, the two rows say `NOT JUDGED (info)`, the first warning names the
reason, and `report.json` carries `memory.judged: false` + `memory.notJudgedReason`. The per-DROPPED-Strip KB
and residual rows are kept, and the exit code is unaffected.

## Flags
- Default warm-up on runs >= 180 min is `max(10 %..25 % rule, retention)`; shorter runs keep the old rule.
- `--warmup-min <m>` stays an explicit override. A warm-up under the retention is itself "not judged".
- `--judge-memory` forces the gate (detector proofs). The selfcheck `leak` case passes it, so a 20-minute run
  still has to fail `memory.slope` (R² > 0.9, 20 MB/h). Defaults were not weakened.
- Logic: `memoryPolicy()` in `tools/soak/report.js`; tests `crc-sync/tests/soak-memory-policy.test.mjs`.

## Results
`soak:selfcheck` PASS 5/5; `soak:smoke` PASS with memory not judged (5.21 MB/h, info); `npm test` 1879 pass / 0 fail.

## Text for CLAUDE.md (supervisor/integrator applies; not edited here)
In the crc-sync commands block: "`npm run soak:smoke` ... reports `memory.slope` as not judged: the heap slope is
judged only on runs of 3 h or more with a warm-up of at least the 2 h Strip retention (ADR 0082), so the 4-hour
run gates on it and short runs do not. `--judge-memory` forces the gate (the selfcheck `leak` case uses it)."
Also "currently fails on known findings": the slope-on-short-runs part of that no longer applies.

## Defaults taken
- Net growth is not judged together with the slope (same cause).
- `--judge-memory` forces the gate even with a short warm-up; no `--no-judge-memory` flag.

## Findings for others
None.
