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

(filled as they come)
