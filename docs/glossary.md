# Glossary: the pre-W7 words and the FAA-based words that replaced them

> **ADRs 0001-0097, the notes in `docs/wip/` and `docs/parallel/`, the UI catalogues and the older release notes
> use the old words (seat, occupied, held, covering chain, FDR, Strip Role, field state, STCA, TWR/GND/APP, ...).
> They are never edited. Read them through this table.** The living docs (`CLAUDE.md`, the READMEs,
> `EFSPImplementationGuide.md`, `docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`) and every ADR from 0098 on use the
> new words only.

The rename (wave W7, decisions H96, H98, H101 in `docs/parallel/decisions.md`) follows the FAA's own vocabulary:
JO 7110.65 (Air Traffic Control), JO 7210.3 (Facility Operation and Administration), JO 7610.14 (Military Operations
in the NAS) and the Pilot/Controller Glossary (P/CG). The full machine table is `docs/parallel/refactor/rename-map.md`
(rows N01-N18); this file is the human key. "ID" columns are the strings that appear in code, config and the wire.

## 1. Terms

| Old word or name | New word or name | FAA source | Note |
|---|---|---|---|
| seat, station (for a Position); `SEATS`, `StationCoverage`, `station-coverage.js` | **Position**; `STAFFED`, `PositionCoverage`, `position-coverage.js` | JO 7210.3 para 2-2-3 "each open position"; TBL 10-1-1, TBL 6-1-1 "Operating Position Designators" | The SRS `Seat` field and DCS ejection seats are unrelated and unchanged. "Radar station" (the host's radar selection) and `homeStation`/`ON_STATION` (USAF, MRU) keep their words |
| occupied / unoccupied / occupancy / unmanned (a Position); `isOccupied`, `PositionOccupancy`, reasons `NOT_OCCUPIED`, `UNMANNED` | **staffed / unstaffed / staffing**; `isStaffed`, `PositionStaffing`, `NOT_STAFFED`, `UNSTAFFED` | JO 7210.3 para 2-6-5 "...position must be staffed"; para 2-2-3 "open position" | **Airspace occupancy keeps its word** (aircraft inside a block: `occupancyFor`, `AIRSPACE_STILL_OCCUPIED`), as does the runway occupant and a Marshal stack slot |
| hold / held / claim / release a Position; `heldPositions`, `setHeldPositions`, `heldBy`, `_claim`, `_release` (PositionStore) | **sign on / sign off**; `signedOnPositions`, `setSignedOnPositions`, `signedOnBy`, `_signOn`, `_signOff` | JO 7210.3 para 2-2-3 "only one certified air traffic controller is signed on and responsible for each open position"; para 2-2-6 "Sign in/out and on/off procedures" | The departure state `HELD`, `HOLD_FOR_RELEASE`, Marshal holding and "holds a Strip" (ownership) are different senses and stay. Message types `efsp-set-positions` / `efsp-positions-ack` keep their names |
| covering chain, covering Position, covered by; `coveringChain`, `coveringFor`, `coveredFrom`, `returnCoveredStrips`, `routedToCovering` | **consolidation** ("`CD` is consolidated at `GC`"); `consolidation`, `consolidatedPositions`, `consolidatedFrom`, `returnConsolidatedStrips`, `routedToConsolidated` | JO 7210.3 para 2-2-3 "to include consolidated positions"; para 2-6-5 "Consolidating Positions" | Radar *coverage* (`coverage.js`, `coverageFor`, `position-coverage.js`) keeps its word. "The covering Position" is written "the Position it is consolidated at". Open question RP-F1 (decisions H101): whether GC consolidates into LC at all is a doctrine lane after the window |
| hand-over, handover; `CarrierTransfer`, `carrierTransfer`, `CARRIER_TRANSFERS`, `carrier/transfers.js`, `.efsp-carrier-handover` | **handoff**; `CarrierHandoff`, `carrierHandoff`, `CARRIER_HANDOFFS`, `carrier/handoffs.js`, `.efsp-carrier-handoff` | P/CG HANDOFF; JO 7110.65 para 5-4-5 Transferring Controller Handoff, para 5-4-6 Receiving Controller Handoff | `TransferStrip`, `TRANSFER_COMMS`, SFA rotation transfers and "transfer of control" (H94) keep their names |
| STCA; `stca` (alerts key, `alerting.json` key), `StcaMonitor`, `stca.js`, tag `STCA` | **Conflict Alert (CA)**; `conflictAlert`, `ConflictAlertMonitor`, `conflict-alert.js`, tag `CA` | P/CG CONFLICT ALERT; JO 7110.65 para 5-13-1 "Conflict Alert (CA) and Mode C Intruder (MCI) Alert" (ERAM), para 5-14-6 (STARS) | `CA` is a UI tag only; code says `conflictAlert` |
| `ASACS_DOMAIN`, `ASACS_URL` (env, compose fallbacks, page global) | **`CRCSYNC_DOMAIN`, `CRCSYNC_URL`**; the fallbacks are gone (R3-35) | project name | The hostname `asacs.sourcedcs.page` and the default `wss://asacs...` endpoint are intentional and stay |
| `CRC_SYNC_URL` (crc-desktop env and `config.js` global) | **`CRCSYNC_URL`** | project name | The user's `config.json` key `crcSyncUrl` stays (installed clients) |
| FDR (Flight Data Record); `fdr`, `fdrId`, `FdrStore`, `fdr-store.js`, `ArchiveFdr`, `'FDR'` | **flight data**; `flightData`, `flightDataId`, `FlightDataStore`, `flight-data-store.js`, `ArchiveFlightData`, `'FLIGHT_DATA'`; plural `flightDataList` | FAA TFDM "Electronic Flight Data (EFD) exchange and Electronic Flight Strips (EFS)"; JO 7210.3 TBL 10-1-1 position FD Flight Data | JO 7210.3 para 2-2-14 uses FDR for the *Facility Directives Repository*, and "flight plan" is the filed DD1801 (`flight-plan-lookup.js`, untouched), hence the choice. Never abbreviate to `fd`/`FD` |
| Strip Role (`strip.role`, `holdsRole`, `STATES_BY_ROLE`, `NOT_A_ROLE`) | **strip type** (`stripType`, `holdsStripType`, `STATES_BY_STRIP_TYPE`, `NOT_A_STRIP_TYPE`); values (`DEPARTURE`, `ARRIVAL`, ...) unchanged | JO 7110.65 para 2-3-4: separate strip layouts for arrivals, departures, overflights | ARIA `role`, Casdoor/Discord roles and Playwright `getByRole` are unrelated and unchanged. The guide's "an operating role a controller signs into" is now "an operating position" |
| `PeerCoordinationProposal/Response/Cancel`, `PeerTofiProposal/Response/ExitProposal` | **`InterfacilityCoordinationProposal/Response/Cancel`**, **`TofiProposal/Response/ExitProposal`** | JO 7110.65 Ch 5 Sec 4 and para 2-1-14 ("interfacility"/"intrafacility"); TOFI: JO 7610.14 para 8-1-7 | `peerStripId`, `peerFacilityId`, `peerPositionId`, `peerBoard` keep "peer" (the counterpart) |
| coordination state `PROPOSED` (`strip.coordination.state`, `strip.tofiCoordination.state`) | **`INITIATED`** | JO 7110.65 para 5-4-5 "while the handoff is being initiated" | The Strip state `PROPOSED` (a proposed flight plan) and the runway-status change `PROPOSED` keep it |
| field state, FIELD STATE panel, `fieldState`, `field-state*.js`, `efsp-field-state-*`, `ops-field-state` | **runway status**, RUNWAY STATUS panel, `runwayStatus`, `runway-status*.js`, `efsp-runway-status-*`, `ops-runway-status` | JO 7210.3 para 10-1-6 to 10-1-8 (active runways, opening and closing runways); P/CG RUNWAY IN USE | The one runway's OPEN/SUSPENDED/CLOSED is `runwayOpenStatus`. Runway Mutation kinds (`OpenRunway`, `BeginRunwayWorks`, ...) are unchanged. The dock layout in `localStorage` names the panel id |
| "EFSP State" (Block 25), bare "state" of a Strip | **strip state** (always qualified: strip state, coordination state, departure-release state, runway status) | none (Block 25 is `[SOURCE-DEFINED]`) | |
| `assigned.releaseState`, "release state", `RELEASE_STATES` | **departure release**: `assigned.departureRelease`, `DEPARTURE_RELEASE_STATES` | JO 7110.65 para 4-3-4 "Departure Release, Hold for Release, Release Times, ..." | `standingReleases` (a standing departure release, LOA), `HOLD_FOR_RELEASE`, `ReleaseAirspace`/`ReturnAirspace` keep their names |
| Block 5 / M4 label `SQUAWK` (the assigned code) | **`BEACON`** | JO 7110.65 TBL 2-3-2 "Mode 3/A beacon code" | `track.squawk` and `squawkStatus` (the transponder *reply* from SRS/DCS) and "squawking" keep the word: that is what the aircraft does |
| Position ids `TWR`, `GND`, `APP` (and Bays `twr-*`, `gnd-*`, `app-*`) | **`LC`, `GC`, `AP`** (and `lc-*`, `gc-*`, `ap-*`) | JO 7210.3 para 10-1-1, TBL 10-1-1 "Operating Position Designators" | See section 2. `CV_APP1`/`CV_APP2` (carrier approach lanes), `APP_LANES` and the map CSS `gnd-red` (ground units) are unrelated |

### The two words that are never used bare

A **bare "transfer"** or **bare "release"** is never used in a new name or sentence: say what moves.

| Say | Meaning |
|---|---|
| strip transfer | ownership of a Strip passes between Positions (`TransferStrip`) |
| transfer of communications | the frequency move (`TRANSFER_COMMS`) |
| transfer of control | the aircraft's control passes (H94) |
| departure release | the release of a departure (`RELEASED`, `HOLD_FOR_RELEASE`, `EDCT`, ...) |
| standing departure release | the LOA envelope (`standingReleases`) |
| airspace release | an airspace block released to its using agency (`ReleaseAirspace`) |
| control release | H94's future release of control, named **`ControlRelease`**, never a bare "Release" |

## 2. Positions

Source: JO 7210.3 para 10-1-1, TBL 10-1-1 "Operating Position Designators" (terminal) and para 6-1-5, TBL 6-1-1 (en
route). "Facilities may use designators other than those listed to accommodate local situations."

| Facility | Old id | New id | Long name | Citation / note |
|---|---|---|---|---|
| INCIRLIK | `OPS` | `OPS` (kept) | Airfield Operations (BASOPS/AMOPS) | project/USAF name; no FAA ATC position takes flight-plan intake at a military field |
| INCIRLIK | `CD` | `CD` | Clearance Delivery | TBL 10-1-1 #5 |
| INCIRLIK | `GND` | **`GC`** | Ground Control | TBL 10-1-1 #12 |
| INCIRLIK | `TWR` | **`LC`** | Local Control | TBL 10-1-1 #13 |
| INCIRLIK | `RSU` | `RSU` (kept) | Runway Supervisory Unit | USAF; no FAA position |
| INCIRLIK | `APP` | **`AP`** | Approach Control (departures consolidated: DC, #7) | TBL 10-1-1 #2 (RP-3) |
| INCIRLIK | `SFA` | `SFA` (kept) | Single-frequency approach | the service is P/CG SINGLE-FREQUENCY APPROACH; no designator |
| INCIRLIK | `PAR` | `PAR` | Precision Approach Radar | TBL 10-1-1 #16 (already the FAA designator) |
| CENTER | `CTR` | `CTR` (kept) | Center (R), the Radar Controller | TBL 6-1-1 names the sector's radar position `R`; kept (RP-1) |
| TACTICAL | `TAC_C2`, `AIC`, `GCI`, `JTAC` | kept | MRU positions | JO 7610.14 para 8-1-1: an MRU is not an ATC facility |
| CARRIER | `CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2` | kept | Marshal, PriFly, approach lanes 1 and 2 | CV NATOPS (Navy) |
| RANGES | derived from `efsp-airspaces.json` | kept | range control | using/controlling agency, not ATC |

**Consolidation after the rename:** `{ CD: 'GC', GC: 'LC', LC: 'AP', SFA: 'AP', PAR: 'AP' }`.

**Bay ids** carry the Position prefix: `twr-runway-queue`, `twr-airborne`, `twr-arrivals`, `twr-final`, `twr-landed`,
`twr-coordination` are now `lc-...`; `gnd-pushback`, `gnd-taxi-out`, `gnd-taxi-in`, `gnd-coordination` are `gc-...`;
`app-inbound`, `app-departures`, `app-overflight`, `app-coordination` are `ap-...`; `ctr-app-coordination` is
`ctr-ap-coordination`; `ops-field-state` is `ops-runway-status`. Every other Bay id is unchanged.

## 3. Kept terms

| Term | Definition |
|---|---|
| **EFSP** | Electronic Flight Strip Panel, the product name. The FAA's equivalent is the EFS (Electronic Flight Strips) of TFDM; the project keeps its own name (H98) |
| **Strip** | the controller's presentation of one flight's flight data, owned by one Position |
| **Flight data** | the authoritative, server-owned record of one flight or formation (identity, filed intent, assigned clearance); formerly FDR |
| **Bay** | a named container of Strips inside a Position's tab (for example `lc-airborne`). Kept (H98; revisit if a TFDM manual names it) |
| **Rack** | an ordered stack of Strips inside a Bay. Kept (H98) |
| **Position** | an operating position of a Facility that a controller signs on to |
| **Facility** | the top-level container: `INCIRLIK`, `CENTER`, `RANGES`, `TACTICAL`, `CARRIER` |
| **Board** | the set of Strips, Bays and Racks of one Facility, replicated to clients |
| **Block** | one numbered field of a Strip (Block 5 beacon code, Block 25 strip state) |
| **Primary / Observer** | the controller "signed on and responsible" for a Position (JO 7210.3 para 2-2-3) versus one watching it. `requestPrimary`, `releasePrimaryTo` keep their names |
| **Owner** | the Position that currently owns a Strip |
| **NLA** | Next Logical Action: the one action Block 26 offers |
| **Mutation** | one recorded change to the Board; the audit log is a log of Mutations |
| **`actingPositionId`** | the Position a Mutation was made as |
| **TOFI** | transfer of flight information between ATC and an MRU (JO 7610.14 para 8-1-7) |
| **HANDOFF / POINT_OUT / TRAFFIC / OPERATIONAL_REQUEST / AIT** | the cross-Facility coordination primitives |
| **Departure-release values** | `RELEASED`, `HOLD_FOR_RELEASE`, `RELEASE_TIME`, `EDCT`, `CALL_FOR_RELEASE` |
| **`HANDED_OFF`** and the other Strip states | unchanged |
| **MARSA, stereo route, QNH/STD** | unchanged |
| **CRC, `crc-sync`, `crc-desktop`** | the project's names; the hostname `asacs.sourcedcs.page` is kept |
| **MRU and Navy vocabulary** | `ON_STATION`, Marshal, PriFly, Case I/II/III and the rest are not ATC terms and are not renamed |
| **hand back** | the tactical Positions' way of returning a line; kept |
