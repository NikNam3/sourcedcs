# L20-STR wip

Strings, test titles and locals moved to the glossary words. Step-0 greps are in `docs/wip/L20-STR/*.txt`.

Defaults taken: FDR -> flight data, field state -> runway status, "or TWR sets it" -> "or LC sets it", Q20-STR-1 "not held" -> "not signed on".
Held/covering/covered/seat in test titles -> signed-on / consolidation / consolidated at.
Kept (N): radar `${aptLabel} APP` labels, `occupied` pads/slots, runway-status-rules "is not held" (gating), `e2e/**`, freeze trace names, `freeze-traces.mjs` `app`/`ctr` handles (golden keys), Express `app` locals.

Goldens: the briefing says not to re-record, the lane prompt allows it for wording; re-recorded in a separate commit `3658c14` that the supervisor can drop.
Traces moved: hub-op-matrix, hub-random-seed2, hub-resync-metrics, scenario-ato, scenario-runway-status.
`l20-codecheck.mjs` was not present in the worktree; not run.
