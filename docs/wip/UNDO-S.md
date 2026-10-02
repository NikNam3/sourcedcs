# UNDO-S working file

Lane UNDO-S, branch `lane/UNDO-S-undo-history`, base `6ffc6b8`. ADR 0100 (draft `docs/wip/DES-SPLIT-adr-0100.md`).
Rulings followed: decisions.md H95, H100 (Q-U1 b, Q-U2 b, Q-U3..Q-U6 a, DR-5 a, DR-6 invariant), S-DESK4 (2).

## Code as found (`6ffc6b8`, step 0)

Names are post-RENAME (the briefing's names map 1:1 through the glossary; differences noted).

| Briefing symbol | On this base | What it does |
|---|---|---|
| `_nlaHistory` | `BoardStore._nlaHistory` (Map), read late by `StripOps.nlaHistory` and `BoardPersistence._nlaHistory` | `{invokedAt, prevState, expiresAt}` per Strip; 400 ms latch + 30 s Undo |
| `_applyInvokeNla` | `board/ops/invoke-nla.js` | writes the history only when `applied.ok && !result.transferTo`; the carrier-shaped branch returns early through `ctx.run('CarrierHandoff', …, clientMutationId: null)`; wall time is a bare `Date.now()` |
| `_applyUndo` | `board/ops/undo.js` | bare `Date.now()` window; on DROPPED clears `flags.removeIndicator`, `flightDataStore.reacquireFlightData` (was `reacquireFdr`), deletes `droppedWallAt`; then `ctx.applySetState(prevState)` |
| `_nlaHistory.delete` | `ops/transfer-strip.js`, `ops/carrier-handoff.js`, `ops/sfa-rotation.js`, `board/persistence.js archiveStrip` | ADR 0009 clearing |
| `_dispatch` | `StripOps#dispatch` (`board/strip-ops.js`) | `authorize` or `rules.canMutate`; `NOT_FOUND`; `STALE_REV` (baseRev); `NOT_OWNER` unless `mayActBesideOwner`; rejected-replica refusal; op `apply`; takeoff stamp; `audit.recordAudit` |
| `Undo` grant | `authority/op-kinds.js` `OP_KINDS` (`'Undo'`), every Position built from it | an op-kind grant today |
| `_applyCarrierTransfer` | `ops/carrier-handoff.js` `_applyCarrierHandoff` (op kind `CarrierHandoff`) | strip type/state/owner/Bay change, `strip.carrierHandoff`; `rules.carrierApplyEffect` → `CarrierStore.applyEffect` `MARK_PUSHED` (`MarkPushed`) / `REMOVE_NO_CLOSE_UP` (`Remove closeUp:false`), audited `Stack:*` with the `clientMutationId` |
| `_applySfaRotation` | `ops/sfa-rotation.js` | ARRIVAL INBOUND → FINAL ON_FINAL at PAR, `strip.sfaTransfer`, no flight data write |
| `_applySetStateGated`, `_observedDeparture` | `ops/set-state.js` | owner check, runway gate, `bypass` audit; DROPPED routes to `DropStrip` |
| `_applyTofiPropose`, `receiveTofiExitProposal` | `board/tofi.js` (`Tofi#_applyTofiPropose`, peer `receiveTofiExitProposal`, audit `TofiExitProposal`) | ENTRY: `receiveTofiProposal` mints a MISSION Strip on the MRU Board, or re-uses an existing one for the same flight data (`TofiProposal` peer entry); EXIT re-enters the link on both Strips |
| `_stampTakeoffOnStateChange` | `StripOps#_stampTakeoffOnStateChange` → `flightDataStore.setTakeoffStamp` | after every op that changed the state |
| `_retireStrip` | `StripOps#retire` | DROPPED, `droppedWallAt` (bare `Date.now()`), remove indicator, `_releaseFlightDataIfLastStrip` (code release + `rules.retireMarsaForFlightData` → `MarsaStore.onFlightDataRetired` `PARTICIPANT_RETIRED`), `rules.carrierRetireFlight` for MARSHAL/FINAL/PATTERN (`CarrierStore.onFlightDataRetired`, vacancy), peer `receiveCoordinationPeerGone` (`SystemCoordinationEnd` on the proposer's Board) |
| `isUndoOfDrop` | `traffic-count.js` | op `Undo`, `before` DROPPED, `after` not: VOID (frozen for this lane) |
| client | `efsp-nla.js` `UNDO_WINDOW_MS = 30000`, `isUndoAvailable` | UNDO-C's |
| touch | `BoardState#recordTouch` → `SyncLog#touch`; `observeTouches(fn)` gives the id only | `Placement#rebalanceRack` touches every re-keyed neighbour through the same call |
| `gone` | `SyncLog#gone`, `BoardState#logGone` (archive) | exists: `remove(stripId)` reuses it |
| flight-data writes | `FlightDataStore` `setField`, `setBeaconAssigned`, `setBeaconObserved` (surveillance), `setAirspaceOwner`, `setTofi`, `setMilitary`, `setCarrier`, `applyAtoTasking`, `setWorkingFrequency`, `setTakeoffStamp`, `setClearance` (append-only ACTIVE/SUPERSEDED/STRUCK), `releaseFlightData`, `reacquireFlightData`, `archiveFlightData` | no write hook today |
| per-Position message | none on the server (no CMSG path in `ws-hub.js`/`efsp-ws.js`) | a new `efsp-undo-voided` frame is needed |
| metrics | `metrics.js` tap `_post` → `recordTransfer` for `TransferStrip` and NLA transfers | no undo counter |

### Each op module's real side effects (beyond its own Strip)

| Op | Touches beyond the addressed Strip |
|---|---|
| `CreateStrip` | a new Strip + flight data + code (not undoable) |
| `MoveStrip` | rebalanced neighbours (placement only); flight data `comms.workingFrequencyMhz` on an SFA frequency Rack |
| `SetBlock` | flight data paths / annotation cell; MARSA void interlock (not undoable) |
| `TransferStrip` | neighbours (placement); SFA frequency on the flight data |
| `SetFlag` | none |
| `SetState` | neighbours; takeoff stamp; DROPPED → `DropStrip`'s footprint |
| `InvokeNla` | the routed op's footprint (TransferStrip / retire / applySetState / CarrierHandoff); takeoff stamp |
| `DropStrip` (and every retire) | code release; MARSA relations (`PARTICIPANT_RETIRED`) and the regime writes on every participant's flight data; carrier stack entry (vacancy); the proposer's Strip on the peer Board (`coordination = null`) |
| `HANDOFF`…`AIT` | both Boards (not undoable; S-DESK4: CR-S's three marks are) |
| `TOFI` PROPOSE | ENTRY: a new or re-used MISSION Strip on the MRU Board; EXIT: the MRU Strip's `tofiCoordination` |
| `ConvertToArrival` | flight data `filed.originAirport`; neighbours |
| `ApproveAirspaceEntry`, `ClearAirspaceEntry` | flight data (not undoable: airspace entry approval, ADR 0100 §1) |
| `CarrierHandoff` | carrier stack (MarkPushed / Remove) |
| `SfaRotation` | neighbours only |

## Design (lane decisions inside ADR 0100)

- **One frame per Mutation.** `UndoHistory` is told when every `applyMutation` (any Board) starts and ends
  (`enterFrame`/`exitFrame`), and every Board touch and flight-data write is attributed to the open frame (touches
  outside a frame are system changes). The undoable action's own frame is `begin(actionId, meta, scope)` …
  `commit(result)` / `abort()`: its footprint must sit inside `scope ∪ created`, else the record is not undoable
  (warn). A later frame whose footprint overlaps an open record's scope is: voided (same Facility, footprint inside
  the scope), or a blocker (another Facility, a system change, or a footprint reaching outside). Peer writes
  (`receive*`) happen inside the sender's frame and carry the touching Board's `facilityId`, so another Facility's
  answer is seen as "from another Facility" by the record of the first.
- **Touch flag.** `recordTouch(id, {placementOnly})`; `Placement#rebalanceRack` passes it. Placement-only touches never
  count (ADR 0100 §4).
- **Restore = before-image**, through one executor (`board/ops/undo.js` + `Placement#restorePlacement`), with one
  exception: append-only cells (Strip annotations and flight-data clearance cells) keep every entry; entries added
  since the action are `VOIDED` (`voidedBy`), earlier ones get their before-image status back. So a restored Strip
  equals its before-image except `rev`/`updatedAt`/`updatedBy` and `VOIDED` entries in an annotation cell a voided
  Mutation wrote (ADR 0100 §3 vs §6 read together).
- **Validate, then apply.** Every check (existence, staffing, Bay capacity, carrier index free, control invariant)
  runs before the first write, so a refusal changes nothing.
- **Panel message.** No CMSG path exists, so `efsp-undo-voided` is new: `efsp-ws` returns it as `directed`
  frames `{facilityId, positionId, frame}` and the hub sends each to the sessions signed on to that Position. That is
  a few lines in `ws-hub.js` (not owned): asked "main" at the wire step.

## Defaults taken (P2)

- (filled as they come)

## Findings for other lanes

- (filled as they come)
