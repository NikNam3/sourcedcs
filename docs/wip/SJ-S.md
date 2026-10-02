# SJ-S working file

Lane SJ-S, branch `lane/SJ-S-split-join`, base `069fdb7` (UNDO-S contract). ADR 0099. Rulings: H89-H91, H100 (Q-SJ1 b, Q-SJ2, Q-SJ3 c, Q-SJ4 a, Q-SJ5 a), DR-11 b.
Baseline: crc-sync 2131 tests, 2 timing flakes under load (`ato tokenize pathological`, `grpc-client-stream backoff`) that pass alone; crc-desktop 884.

## Code as found (step 0)

Post-rename names already in the tree: `flightDataStore`, `stripType`, `beaconAssigned`, `FlightDataStore`, `StripOps` (`ctx`), `ctx.retire`.

| Briefing symbol | On this base |
|---|---|
| `createFdr` | `FlightDataStore#createFlightData(seed, {by})`; mints the code with `CodeAllocator#allocate(flightDataId)` AFTER every refusable check |
| `releaseFdr`, `reacquireFdr`, `archiveFdr` | `releaseFlightData`, `reacquireFlightData` (D23: never steals), `archiveFlightData` |
| `CLEARANCE_FIELDS`, `setClearance`, `parseHeadingDeg`, `parseAltitude` | `flight-data-store.js` (`Set` of altitude, heading); cells `{entries:[{value, parsed, status, at, by, block?}]}`; `ensureClearance` seeds old snapshots |
| `_retireStrip` | `StripOps#retire(strip, by)`: TOFI ACTIVE refusal, DROPPED, `droppedWallAt`, removeIndicator, `_releaseFlightDataIfLastStrip` (code + `rules.retireMarsaForFlightData`), carrier retire, peer link end |
| `_applyCreateStrip` | `board/ops/create-strip.js`: `placement.resolveOrderKey(bay, rack, afterId, beforeId, excludeId)`, `state.nextCid()`, `state.insert(strip)` |
| `_recordAudit` | `BoardAudit#recordAudit(mutation, acting, by, before, result, extras)`; op `auditFields` gives `{head, tail}`; ONE entry per Mutation, addressed Strip = `result.strip` |
| `isDropTransition` / `isUndoOfDrop` / `countability` / `_buildRecord` | `traffic-count.js` as briefed; `_onLogEntry` and `expectedFromLog` key the VOID on `entry.stripId` |
| grants | `authority/op-kinds.js` `OP_KINDS`; Position sets in `positions/{civil-atc,incirlik-military,tactical,carrier}.js`; `permission.canMutate` is the default `authorize` |
| `STATES_BY_ROLE` | `STATES_BY_STRIP_TYPE` in `authority/index.js` (strip-type families) |
| Strip persisted shape | `stores.js` `STRIP_SHAPE` / `FLIGHT_DATA_SHAPE` / `FLIGHT_DATA_SECTIONS` (strict) |
| Flight rules (VFR) field | does NOT exist on flight data (`filed.*` has none): the "refuse VFR" gate of ADR 0099 §4 has nothing to read, so it is not built (default taken) |
| coordination "PROPOSED" | `strip.coordination.state === 'INITIATED'` (and `tofiCoordination.state`); TOFI active is `tofiCoordination.state === 'ACTIVE'` |

Positions: civil-atc OPS CD GC LC AP CTR, incirlik-military RSU SFA PAR (all "ATC Positions", Q-SJ3 c). Tactical (TAC_C2, GCI, AIC, JTAC) and carrier (CV_*) are excluded.

### Block Map finding (ADR 0099 §3 correction)

DEPARTURE already has `20` (heading) and `21` (altitude) clearance Blocks, so DEPARTURE gains only a speed Block (`9A-SPEED`), not `9A-VECTOR` too. OVERFLIGHT has `7A` and `9A-VECTOR`: gains `9A-SPEED`. ARRIVAL has `7` and `9A-VECTOR`; its `9A-SPEED` (annotation) is retargeted to the speed cell. The ADR text is corrected in the Built edit.

### Flight data copy / reset / new (the departing part)

| Path | Rule |
|---|---|
| `flightDataId`, `rev`, `createdAt`, `updatedAt`, `updatedBy` | new |
| `identity.callsign` | typed (new) |
| `identity.flightSize` | k |
| `identity.beaconAssigned` | new (allocator); provenance COMPUTER_GENERATED |
| `identity.beaconObserved`, `modeOne`, `modeTwo`, `tailNumber` | reset null |
| `identity.degradation`, `trackDegradationFlag` | reset `NONE` (the part is a new track with a new code) |
| `identity.aircraftType`, `wakeCategory`, `equipmentCodes`, `equipmentSuffix`, `unit`, `homeStation` | copy |
| `identity.splitFrom` | new: lead flight data id |
| `filed.*` (all 12 paths) | copy (same plan) |
| `assigned.*` | copy |
| `timeInputs.flightPlanDepartureUtc` | copy; `takeoffStampedUtc`: copy airborne, reset null on a ground split |
| `clearance.altitude/heading/speed` | the ACTIVE entry copied as a fresh ACTIVE entry (history not copied); then the assignment is written as a normal entry (supersedes) |
| `military.*` | copy; `arInfo` reset null (tasking link belongs to the lead's flight) |
| `mission.*` | copy |
| `tofi.*` | copy; `separationRegime` `MARSA` reset to `ATC` (the part is in no relation) |
| `airspace`, `comms` | copy values, `transitions` reset `[]` |
| `ato`, `trackRef`, `clearanceUpdatedAt` | not copied (null / absent) |
| `provenance` | fresh: copied non-empty `filed.*`, `mission.*`, identity type paths = `COPIED_ON_SPLIT` |
| `voided` | absent (set on a joiner) |

## Defaults taken (P2)

- No flight-rules field exists: the VFR refusal is not built. A VFR flight is whatever the Strip type says; ADR 0099 §4 edited in the Built step.
- Join of a lead and a joiner in different states is allowed (ADR §4); ack warns on mixed type or mixed ground/airborne.

## Findings for other lanes

- **SJ-C:** wire is final. Ack carries `splitStripId`, `split`, `join`; the new Strip arrives in the same board delta; the part's flight data in `flightDataList.updated`. Client Block Map mirror already has `9A-SPEED` (clearance/speed) for the three IFR types; ARRIVAL's template must now READ the speed cell, not the annotation. `clearance.speed` entries have `unit` `KT`|`MACH`, `parsed` knots or Mach number, value `250` / `M.85`. Refusal `reason` is `ASSIGNMENT_REQUIRED` for the missing assignment.
- **UNDO-S:** after merge, check the executor with `SplitFormation` (removes a created Strip: `records` with `after: null` in its audit entry makes `undoneDrops` VOID a dropped part's COUNT) and `JoinFormation` (restores the joiner, un-voids its flight data: `voided` must be removed by the before-image, the code re-acquired). S10/S11 execution is not tested here; only the declarations are (formation-split-join S10/S11).
- **AIRSP phase 2 (occupancy):** a split adds a flight (new Strip and flight data on the same Board, `airspaceEntry` copied) and a join removes one (joiner DROPPED with `endReason: 'JOINED'`). Occupancy derived from live Strips follows; a stored count must recount on `SplitFormation` and `JoinFormation`. The part's `airspaceEntry` is a copy: the approval is shared, not re-issued.
- **Not covered:** S13 (the joiner's correlation ends in `retireFinished`) relies on the existing reconciler, no new test.
- **Goldens:** re-recorded (37 files): every flight data now carries an empty `clearance.speed` cell; block maps and permission tables list the new entries.
- The two timing flakes in the baseline (`ato tokenize pathological inputs`, `grpc-client-stream backoff`) fail only under load.
