# L20-CORE wip

## Step 0 (base 277e65f)
l20scan L20-CORE: files 30, comment lines 3486, stale file ptr 3 (`efsp-block-map-parity.test.js`, `theater-settings.js` x2 in facility-config; mutation-log pointers are found as `theater-settings`), stale _method ptr 6 (`_validateRadarSelectors`, `_handleAtoMutation`, `_searchInvocationCount`, `_stampStrip`, `_resolveOrderKey`, `_isRejectedReplica`), board-store lines 40, vocab hits 196 (FDR 117, Role 36, claim 16, covering 8, station 5, held/hold Position 5, TWR/GND/APP 7, field state 2), SOURCE-DEFINED markers 17 (over the lane's 30 files).
Baseline `npm test` output kept in the scratchpad (test-before.txt).

## Code as found
Rows C4 (code-allocator.js: synthetic block in the "Doctrine" list, unmarked), C6 (conformance.js: no marker), C10/D7 (position-coverage.js: no marker, "no scope" sentence, tactical sentence), C11 (release-envelope.js: unmarked), U1, U8, U13, U14, U18, L19 are applied in step 3 and each gets its "as found" line below when done.
Facility notes: the doctrine comments on the old literals exist only at 8476c41^; the keys are now `consolidation` (was coveringChain), `runwayStatus` (was fieldState), ids LC/GC/AP.
