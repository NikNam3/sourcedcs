# L20-CORE wip

## Report (top)
Branch `lane/L20-CORE` from 277e65f. Scan, L20-CORE column, before -> after: comment lines 3486 -> ~3640; stale file ptrs 3 -> 0; stale `_method` ptrs 6 -> 0; board-store lines 40 -> 16 (all verified, see below); vocab hits 196 -> 20 (all kept senses); `[SOURCE-DEFINED]` markers 17 -> 41 (over the 30 owned files). Codecheck: `comment-only: no code change`. crc-sync unit: 2118 tests, baseline 1 fail (`ato tokenize: pathological inputs finish fast`, a timing flake under load, passes on rerun) -> 1 fail, `time chains: crc-desktop's copy is byte-identical`, expected until L20-CLIENT pastes the three hunks below. crc-desktop unit: 883 tests, the one failure is the same parity test.

## Mirror lines
`time-chains.js` (server, CORE) <-> `crc-desktop/app/public/js/panels/efsp/time-chains.js`: the parity tests compare the whole body, comments included. Three hunks, pasted byte for byte into the client copy (sent to "main" as well):
1. `// Two byte-identical copies: crc-sync/src/efsp/time-chains.js and` -> `// Two copies, identical but for the export syntax: crc-sync/src/efsp/time-chains.js and`
2. the two lines `// No requires, no clock: ...` / `// this is a classic script, ...` -> `// No require or import, no clock: nothing here is a time of its own. crc-sync's copy is` / `// CommonJS and crc-desktop's an ES module; the parity tests compare the bodies` / `// without the export syntax.`
3. `// the mission-clock time a DEPARTURE Strip entered DEPARTED, stamped by` / `// board-store.js into flightData.timeInputs.takeoffStampedUtc. It is an actual, so it` -> `// the mission-clock time a DEPARTURE Strip entered DEPARTED, stamped by crc-sync's` / `// board/strip-ops.js (`StripOps#_stampTakeoffOnStateChange`, through` / `// `FlightDataStore#setTakeoffStamp`) into flightData.timeInputs.takeoffStampedUtc. It is an actual, so it`
`block-map.js` <-> `strip-template.js`: no marker or rule wording changed; only vocabulary (strip type, flight data) and pointers. The client copy's comments are L20-CLIENT's (the parity test compares tables and strings, not comments).

## Facility notes (DATA-1): mapping from the literals at 8476c41^ to `facility-schema.js` (the block above `REQUIRED_KEYS`)
| Old literal comment | Now | Marker |
|---|---|---|
| Bay sets "the guide's own section 4.2 defaults", per-Position Bay notes (ops-proposed first, ops-filed client-local, RSU/PAR/SFA Bay descriptors, lc-runway-queue one Rack per runway, FINAL state vs FINAL type, app-overflight) | `bays` | `[SOURCE-DEFINED]` (0013, 0025, 0074) for CENTER, TACTICAL, carrier Bay sets; flags 0093, 0087 |
| CENTER "no guide-published default Bay set" | `bays` | `[SOURCE-DEFINED]` (0013) |
| TACTICAL Facility, JTAC read-only | `positions`, `bays` | `[SOURCE-DEFINED]` (0025) |
| CARRIER bullets (all four MILITARY_ATC, chain ends at the Marshal, no coordination Bays but the fallback, radar selectors name the hull) | `positionClasses`, `consolidation`, `bays`, `positionRadars` | `[SOURCE-DEFINED]` (0074) |
| `positionClasses` (guide 4.1 Class column; RSU/SFA/PAR MILITARY_ATC; no new class because of the ATC_CLASSES inclusion-list trap, 0041) | `positionClasses` | `[SOURCE-DEFINED]` for the carrier; the rest sourced to guide 4.1 |
| `positionLetters` | `positionLetters` | `[SOURCE-DEFINED]` (0088) |
| coveringChain notes (intrafacility, not extended to CTR, 0013; SFA/PAR to APP, RSU absent, 0075; carrier ends at Marshal; JTAC to TAC_C2, 0080; CENTER none) | `consolidation` | `[SOURCE-DEFINED]` (0013, 0074, 0075, 0080); deviations from guide 4.8.6 rule 2 listed (Q20-CORE-2) |
| `positionRadars` (selectors never ids, 0041/0042/0043; empty array is a statement; RSU, SFA, PAR; CENTER `airport '*'`; TACTICAL coalition `own`, JTAC none) | `positionRadars` | `[SOURCE-DEFINED]` (0042, 0043, 0059, 0075) |
| `hiddenBlocks` / `blockVisibility` | `hiddenBlocks` (refused at start-up: `blockVisibility`) | sourced to guide 8.2, 8.3 |
| `singleFrequencyApproach` (frequencies placeholders) | `singleFrequencyApproach` | `[SOURCE-DEFINED]` (0075), squadron data to verify |
| `dataOnly`, `standingReleases`, `aitAuthorized` (0021, 0017, 0022) | same keys | sourced to guide 4.6.1, 4.6.2, 4.6 rule 7 |
| fieldState inventory (squadron data, headings true, gear `[]`, acknowledgers OPS/AP, inspection authority, pads, accessRoute 0070) | `runwayStatus` | `[SOURCE-DEFINED]` (H17, H20, H21, 0070), squadron data to verify (C-9: Incirlik headings 056/236 shipped as 56/236) |
| `facility-config.js` header "Bay sets below", theater-settings.js pattern, permission.js OP_KINDS | rewritten as the loader header | none |
Defaults taken (P2): the notes live in `facility-schema.js`, not a new doc; values are described as they are now (LC/GC/AP ids, `consolidation`, `runwayStatus`, `holdsStripType`).
Guide quotes that no longer exist in the guide (`"a facility MAY narrow this"`, `"an empty-but-present Coordination Bay"`, `"If the covering Position is also unstaffed ..."`) were dropped or requoted from the current text.

## Guide/code difference for L20-GUIDE (usage guide "What is ours and what is sourced")
Guide 4.8.6 rule 2's default consolidation runs CD, GC, LC, AP, CTR; AIC/GCI to TAC_C2 to CTR; CV_APP* to CV_MARSHAL to CV_PRIFLY; RSU to LC; SFA/PAR to AP. Shipped: no AP to CTR and no TAC_C2 to CTR (ADR 0013, consolidation is intrafacility), no RSU to LC (ADR 0075), carrier ends at CV_MARSHAL (ADR 0074); JTAC to TAC_C2 is ours (ADR 0080). CTR/RANGES: none. Facility values to verify with the squadron: Incirlik runway headings, SFA frequencies, pad names, positionRadars airfield `LTAG`.

## Rows
C4 applied (synthetic block under its own `[SOURCE-DEFINED] (docs/adr/0059)`); C6 applied; C10 and D7 applied in `position-coverage.js` ("In our model a Ground controller has no scope"; tactical sentence rewritten as a squadron decision, 0059 as corrected by 0060); C11 applied and the guide quote re-quoted from the current text; U1 applied (literal token, D-6, ADR 0065); U8 applied (caps are engineering bounds, targets the guide's); U13 applied (`[SOURCE-DEFINED] (H36, docs/adr/0082)`, and the JSDoc that sat above `const log` moved onto the constant); U14 applied (S-L27, "tools/soak/report.js mirrors the 40"); U18 reworded to what the test checks (it only checks listed states are real states); L19 markers added in `surveillance-hints-config.js`, `airborne.js`, `surveillance-hints.js` (0076). BOARD-1 (`_bayForNewOwner`): gone from facility-config; the schema note names `board/placement.js`'s `bayForNewOwner`/`bayForImpliedState`. BOARD-2, BACKCOMPAT, C-4, SYNC, and the private-name pointers: done (`_handleAtoMutation` -> `wire/families/ato.js`'s `handleAtoMutation`, `_isRejectedReplica` -> `board/strip-ops.js`'s `rejectedReplicaRefusal`, `_stampStrip` -> `wire/frames.js`'s `stampStrip`, `_resolveOrderKey` -> `board/placement.js`'s `resolveOrderKey`, `_validateRadarSelectors` -> `position-coverage.js`'s `reportUnresolvedSelectors`, `APPLIED_MUTATIONS_CAP` -> `sync/replay-cache.js`). Hand grep of `_retireStrip`, `_bayForNewOwner`, `_dispatch`, `_touch` over the Owns: only `correlation-store.js`'s own `_touch` (a real method).

## Kept senses (vocab and board-store, the 36 remaining scan lines)
- `BoardStore`/`board-store.js` where it names the class or the facade (index.js composition root, stores.js, correlation-store.js "same wiring BoardStore has", surveillance-hints.js "never a BoardStore", archiver.js `BoardStore.archiveStrip`, position-store.js, traffic-count.js, nla-status-monitor.js, flight-data-store.js header): all exist, 16 lines.
- "claim" as the correlation binding sense (`correlation-reconciler.js`), "claims" a stereo/code/an admin role in a token (`flight-plan-lookup.js`), "claim" as an assertion (correlation-store, flight-data-store, index.js MARSA).
- "station": radar stations, `home station`, `on-station` (`block-map.js`, `position-store.js`).
- old words quoted as history in the facility note (`facility-schema.js`: TWR/GND/APP, coveringChain) and `APP`-style comment text in schema JSDoc.

## ADR errata
- ADR 0042 and 0043 name `radar-specs.json` (now `sensor-specs.json`): not met in this lane's files.
- ADR 0013 point 4 and 0075 are the sources of the consolidation deviations above; no errata.
- `docs/adr/0077` is cited in the facility notes (guide 13, markers) but does not exist yet: L20-GUIDE writes it.

## Findings
- `crc-sync/tests/efsp-time-chains.test.mjs` and crc-desktop's compare the whole body including comments; README rule 6 should say so (supervisor). 
- `tools/soak/report.js` mirrors `REBALANCE_KEY_LENGTH` (comment now says so); making it read the constant is "later hygiene".
- U18: the stronger test (a new silently eligible state) is still a finding (owner: a later test lane).
- `forwarding-obligations.js`, `flight-data-store.js` etc. keep narration like "Phase 1/Phase 2" in a few historical clauses (`block-map.js:36`, `forwarding-obligations.js:94`, `flight-data-store.js`): short history, left on purpose.
