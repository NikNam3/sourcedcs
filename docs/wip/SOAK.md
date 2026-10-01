# Lane SOAK: soak harness fixes (crc-sync/tools/soak/ only)

## 1. `drop-broadcast` selfcheck
Cause: detector drift, not a detector bug. The injected fault drops one board-delta to one client. The
detector that fires is `broadcastMissing` (it did), but the selfcheck asks for `silentStaleness`, which was
judged only at the 60 s checkpoint. Since L24/L26/L27 a Strip moves on within seconds (the dropped delta was
an arrival `HANDED_TO_TOWER` rev 2, superseded before t+60 s), and the Strip's next delta repairs the replica,
so there was nothing stale left to find. Fix (`driver.js`): in `drop-broadcast` mode, when a send's
broadcast check finds a client starved of the Strip, judge that client's shadow against fresh truth at once
(`where: 'post-drop'`). Staleness is then observed while it exists. Production-like gates are untouched.

## 2. Metrics tap
`host-core.js` now builds `createEfspInstrumentation` exactly as `server.js` does (before the hub, paths in the
temp dir, archiver `setIsCounted` guarded by the traffic count, and the 60 s `tick` once per virtual minute).
Effect: efsp-mutation refusals and every `unaudited` pre-store refusal now get a `source: 'wire'` line, as in
production. `ledger.js` previously expected 0 lines for those; it now expects exactly one line per answered
Mutation, and checks the writer: a refusal from the tap (every efsp-mutation refusal, every wire-level
refusal of other types) must be `source: 'wire'`, anything else must not. Missing, duplicate and
wrong-writer lines are all findings. `auditForRefusal` (a refusal with a line) is replaced by
`auditWrongSource` (report, gate, selfcheck's clean-run quiet list). Nothing is excused: the gate got stricter
(it also checks the line's writer and that successes have exactly one non-wire line). Seed 7 smoke: 0/0/0/0.

## 3. Heap slope: it is NOT only fleet ramp-up
`memory.slope` on `--seed 1 realistic`: 10 min 5.84 MB/h, 30 min 3.01, 60 min 2.87 (existing warm-up
10 %..25 % of the run), 240 min -0.30 PASS. The growth is the DROPPED-Strip retention filling: a finished
Strip stays 2 h before the archiver removes it (ADR 0082), `strips.dropped` climbs ~42/h until then (and
~26-37 KB per DROPPED Strip in the 30/60-min fits); live Strips and FDRs are flat. The heap plateaus only
after ~2 h. A 30-minute warm-up on the 60-min run still fails (2.83); a 130-min warm-up on a 180-min run
passes (-1.04 MB/h, R² 0.54).

Implemented: `--warmup-min <m>` (run.js, report.js) overrides the warm-up. Default unchanged, on purpose:
`soak:selfcheck`'s `leak` case relies on a 20-minute run failing `memory.slope`, and a 2 h default would
make every run under ~3 h unjudged for memory.

Proposal (not done): default warm-up = max(current rule, archive retention 2 h) for runs of 3 h or more,
and for shorter runs report memory as a warning (`not judged: before archive plateau`) while keeping the
per-DROPPED-Strip KB and residual rows. The selfcheck `leak` case would then pass `--warmup-min` explicitly
(or keep a short warm-up flag). Smoke/10-minute runs should not gate on slope; the 4-hour run does.

## Defaults taken
- Fixed the drop-broadcast detector in the driver (judge at the drop), not by lengthening the run.
- Kept the warm-up default; added the flag only.

## Findings for others
- `CLAUDE.md` text ("proves every detector fires") is true again once this merges; no wording change needed.
- Briefing/CLAUDE.md note that the soak "currently fails on known findings" may now be the slope alone on short runs.
