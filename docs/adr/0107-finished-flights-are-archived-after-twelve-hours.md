# 0107 — Finished flights are archived after twelve hours

## Context

ADR 0082 archives a DROPPED Strip 2 h of wall time after its drop (`ARCHIVE_AFTER_MS`, decision H36), and the
flight data goes in the sweep that archives its last Strip. A DEPARTURE is dropped at hand-off, so the flight that
comes back is a flight whose Strip is already on the clock. Q3-2 raised it: after the archive the returning flight
has no flight data to bind to (the plan, the ATO line `fdr.ato`, MARSA and the military Blocks are gone), the
`CONVERTED_ARRIVAL` classification is lost, and the MISSION line loses its bind target. The human ruled (H107,
2026-10-04): "2 hour archive is to short. sorties can go up to around 6-8 hours so archive needs to be at least 12 hours."

## Decision

- `ARCHIVE_AFTER_MS` is **12 h** (`crc-sync/src/efsp/archiver.js`). Nothing else about archiving changes: the same
  rules (ADR 0082), the wall-time clock, the mission roll-over archiving everything counted (a mission change still
  archives early; what a roll-over does is ADR 0086 and H108's business, not this one), nothing archived can be undone.
  This ADR supersedes 0082's number; 0082 is not edited.
- 12 h covers the longest stated sortie (8 h) plus the return, the recovery and a late arrival Strip, with margin.
- **Memory.** The soak measured 26-37 KB of heap per DROPPED Strip (`docs/wip/SOAK.md`) at a fleet rate of about 42
  dropped Strips an hour. Twelve hours of that is about 500 Strips, roughly 13-19 MB. A squadron evening is a fraction
  of the soak's rate, so the real figure is a few MB. The cost that scales is not the heap but the Board snapshot, which
  `_persist` serialises whole on every Mutation: 2 h held about 200 Strips and made a 284 KB snapshot (briefing, L24), so a
  busy 12 h may reach about 1.5 MB, with the persist time growing in step. That is the signal to watch on a long live
  session, and the fix is a persistence one (an incremental write), not a shorter retention.
- **The soak keeps its own retention.** `memory.slope` and `memory.netGrowth` are judged only on runs whose warm-up
  covers the retention (`memoryPolicy()`, SOAKW). At 12 h a 4 h run would never be judged. The soak host therefore builds
  the archiver with an explicit `retentionMs` (`createApp({ archiveRetentionMs })`, which the production composition root
  never passes): **2 h**, the number every soak threshold was measured against (`tools/soak/retention.js`).
  `--retention-min <m>` overrides it; it reaches the forked host through the environment. `memoryPolicy()` reads that
  value (its `retentionMin` argument), not `ARCHIVE_AFTER_MS`, and the report prints `soak retention 2 h (production 12 h)`.
  The 12 h constant itself is therefore never exercised by a soak run; the unit test pins it and the 8 h/12 h behaviour.

## Consequences

- A returning flight up to 12 h after its departure was handed off still finds its flight data, ATO line, MARSA and
  military Blocks; `ConvertToArrival` and the local/transient count keep working in that window.
- The Board snapshot, the replay cache and every resync carry up to 12 h of finished Strips and flight data.
- A flight that never returns still holds its flight data (and its beacon code in the allocator) for 12 h instead of 2 h.
- The soak's heap gate says nothing about a 12 h fill; the numbers above are an estimate, and a live session of 12 h or
  more is the only real measurement.
