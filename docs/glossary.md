# Glossary: the pre-W7 words and the FAA-based words that replaced them

> **ADRs 0001-0097, the notes in `docs/wip/` and `docs/parallel/`, the UI catalogues and the older release notes
> use the old words (seat, occupied, held, covering chain, FDR, Strip Role, field state, STCA, TWR/GND/APP, ...).
> They are never edited. Read them through this table.** The living docs (`CLAUDE.md`, the READMEs,
> `EFSPImplementationGuide.md`, `docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`) and every ADR from 0098 on use the
> new words only.

Corrections to committed ADRs: `docs/adr/0077`.

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
| covering chain, covering Position, covered by; `coveringChain`, `coveringFor`, `coveredFrom`, `returnCoveredStrips`, `routedToCovering` | **consolidation** ("`CD` is consolidated at `GC`"); `consolidation`, `consolidatedPositions`, `consolidatedFrom`, `returnConsolidatedStrips`, `routedToConsolidated` | JO 7210.3 para 2-2-3 "to include consolidated positions"; para 2-6-5 "Consolidating Positions" | Radar *coverage* (`coverage.js`, `coverageFor`, `position-coverage.js`) keeps its word. "The covering Position" is written "the Position it is consolidated at". Open question RP-F1 (decisions H101): whether GC consolidates into LC at all is a doctrine lane after the window**Since ADR 0110 (H104, H111): `consolidation` is an ordered list of who is *offered* an unstaffed Position ("the next controller takes the hat"); no Strip moves at an ATC sign-off. Each Position entry carries `hatOffers`; `routedToConsolidated` became `transfers.toUnstaffed`; TACTICAL's MRU return is `handBack` (`routedTo`). `consolidatedFrom`/`returnConsolidatedStrips` stay for Strips persisted under the old reassignment** |
| hand-over, handover; `CarrierTransfer`, `carrierTransfer`, `CARRIER_TRANSFERS`, `carrier/transfers.js`, `.efsp-carrier-handover` | **handoff**; `CarrierHandoff`, `carrierHandoff`, `CARRIER_HANDOFFS`, `carrier/handoffs.js`, `.efsp-carrier-handoff` | P/CG HANDOFF; JO 7110.65 para 5-4-5 Transferring Controller Handoff, para 5-4-6 Receiving Controller Handoff | `TransferStrip`, `TRANSFER_COMMS` and "transfer of control" (H94) keep their names (the SFA rotation is gone, section 4). **"Handoff" is a strip or radar handoff only** (P/CG HANDOFF; JO 7110.65 para 5-4-5, 5-4-6). One controller replacing another at a Position is **position relief** (JO 7110.65 para 2-1-24, Appendix A: "transfer of position responsibility"), never a handoff or hand-over; `EFSPImplementationGuide.md` §4.8 "Position handover" now says so, section numbers unchanged (S-RENA1) |
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
| Position ids `TWR`, `GND`, `APP` (and Bays `twr-*`, `gnd-*`, `app-*`) | **`LC`, `GC`, `AP`** (and `lc-*`, `gc-*`, `ap-*`) | JO 7210.3 para 10-1-1, TBL 10-1-1 "Operating Position Designators" | See section 2. `CV_APP1`/`CV_APP2` (carrier approach lanes), `APP_LANES` and the old map CSS `gnd-red` (ground units, removed with ADR 0121) are unrelated |

### The two words that are never used bare

A **bare "transfer"** or **bare "release"** is never used in a new name or sentence: say what moves.

| Say | Meaning |
|---|---|
| strip transfer | ownership of a Strip passes between Positions (`TransferStrip`) |
| transfer of communications | the frequency move: on a HANDOFF the receiver's **check-in** (`HANDOFF CHECKED_IN`, ADR 0122); TOFI keeps `TRANSFER_COMMS` |
| transfer of control | the aircraft's control passes (H94) |
| departure release | the release of a departure (`RELEASED`, `HOLD_FOR_RELEASE`, `EDCT`, ...) |
| standing departure release | the LOA envelope (`standingReleases`) |
| airspace release | an airspace block released to its using agency (`ReleaseAirspace`) |
| control release | the release of a not-released HANDOFF, **`ControlRelease`** REQUEST / GRANT / REFUSE (ADR 0122), never a bare "Release" |

## 2. Positions

Source: JO 7210.3 para 10-1-1, TBL 10-1-1 "Operating Position Designators" (terminal) and para 6-1-5, TBL 6-1-1 (en
route). "Facilities may use designators other than those listed to accommodate local situations."

| Facility | Old id | New id | Long name | Citation / note |
|---|---|---|---|---|
| INCIRLIK | `OPS` | `OPS` (kept) | Airfield Operations (BASOPS/AMOPS) | project/USAF name; no FAA ATC position takes flight-plan intake at a military field |
| INCIRLIK | `CD` | `CD` | Clearance Delivery | TBL 10-1-1 #5 |
| INCIRLIK | `GND` | **`GC`** | Ground Control | TBL 10-1-1 #12 |
| INCIRLIK | `TWR` | **`LC`** | Local Control | TBL 10-1-1 #13 |
| INCIRLIK | `RSU` | **removed** (ADR 0126) | Runway Supervisory Unit | USAF, manned by pilots, not an ATC unit; the tower works the pattern (section 5) |
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

## 4. Words retired after the live test (2026-10-11, ADRs 0117-0119)

Older ADRs (0075, 0093, 0112) and notes use these; the living docs use the right-hand column.

| Old word or name | Now | Source | Note |
|---|---|---|---|
| the `SFA` Position; the SFA rotation record (`sfaRotation`, `sfa-store.js`, `SetSfaRotation`, the `efsp-sfa-*` messages); `SfaRotation`; "Rotate to PAR" | **AP's SFA Bay** (`ap-sfa`, `singleFrequencyApproach.pool` with `use` `ROTATION`/`INITIAL_CONTACT`/`SPARE`); **Hand off to PAR**, an ordinary `TransferStrip` converted by `par-final.js` `PAR_HANDOFF` | JO 7610.14A para 7-1-5; JO 7110.65BB para 5-10-15 | ADR 0117. Who has a rotating frequency is derived, not stored. A Board snapshot with `sfaRotation` refuses start-up |
| "Landing assured" | **Cleared to land** (recorded), **Landed** (to GC); op `FinalCall` with `BEGIN_DESCENT`, `CLEARED_TO_LAND`, `LANDED`, `MISSED_APPROACH` | JO 7110.65BB para 5-10-13, 5-12-3, 5-12-9 | No FAA order uses "landing assured" (ADR 0117) |
| Block 1 label `CALLSIGN` on DEPARTURE, ARRIVAL and OVERFLIGHT | **`ACID`** (aircraft identification) | JO 7110.65BB para 2-3-5 b "aircraft identifications (ACIDs)" | The mission line and the carrier Strips keep CALLSIGN (no FAA strip) |
| wake category `D` and the FAA CWT letters | **ICAO L / M / H / J** | JO 7360.1K App. A (ICAO WTC) | `aircraft-data.js`; Block 3 is `[count/]TYPE[/WAKE]` in ICAO order |
| "CA" for any pair of aircraft | **CA** between two tracked aircraft; **MCI** (Mode C intruder) a tracked aircraft against an untracked one reporting altitude | P/CG CONFLICT ALERT, MODE C INTRUDER ALERT; JO 7110.65 para 5-13-1 | ADR 0118. "Tracked" = correlated to a Strip (CORRELATED or PROVISIONAL) |
| airspace `type` "a label only" | `type` decides the **airspace-conflict alert** (`SAA`, "Airspace conflict <name>") | P/CG AIRSPACE CONFLICT; 14 CFR 73.13 | ADR 0119 amends ADR 0038/D14 |

## 5. Round 2 to the v2 launch (ADRs 0121-0138)

Older ADRs (0075, 0101, 0120, 0127) and notes use the left-hand words; the living docs use the right-hand column.

| Old word or name | Now | Source | Note |
|---|---|---|---|
| the RSU Position, its pattern board (`pattern-board.js`, `RSU_LEGS`), the `rsu-pattern` Bay, `HANDED_TO_RSU`, the RSU list (`rsu-list`), `CancelIfr`, `IFR_NOT_CANCELLED` | **the tower's pattern**: LC's ordinary Strips, cells **P/S** (`9J-ENTRY`: PAT / STR) and **OPT** (`9J-OPTION`: T&G / FS / LA), ARRIVAL state **`TRAFFIC_PATTERN`** ("IN PATTERN", Bay `lc-pattern`), ops `JoinPattern` ("Closed traffic") and `LeavePattern` | JO 7110.65BB para 3-8-2; AIM 4-3-23 (the option; ADR 0126 says 4-3-22, which is wrong) | ADR 0126 supersedes 0120. `TRAFFIC_PATTERN` is the airfield's; the carrier's PATTERN strip type and `IN_PATTERN` state are PriFly's |
| PriFly's pattern board (initial, break, downwind, groove), `view: 'pattern'` | PriFly's Bays `cv-prifly-pattern` (one Rack) and **`cv-prifly-recovered`** (the **Recovered Bay**: a trapped or Case I recovered aircraft, carrier handoff `FINAL_TRAPPED`) | CV NATOPS | ADR 0137 |
| **Comms to X**, **Control to X**, the release form (Turns, Climb, Descent, Full, limits, condition, time), **Withdraw release**, `TRANSFER_COMMS`/`TRANSFER_CONTROL` on a HANDOFF | **Released** (the switch at Hand off, default on), **Checked in** (the receiver), **Request release…** / **Release** / **Unable** | JO 7110.65BB para 2-1-15 a 1, a 2, c; para 2-1-17 a | ADR 0122 replaces 0101's release model. Inside one Facility a move is still a plain strip transfer |
| the airfield PAR final line (one row per aircraft in the FINAL Bay) | the **FINAL Strip** on an ordinary face (HDG, ALT, Landed, the next call, ⋯ group Final) | — | U-PANELS; the carrier's FINAL Bay keeps its line |
| the PAR "Default glideslope" setting (`parGpa`), "Elevation tolerance ±" (`parTolEl`), the lateral offset in feet | the **approach values** TDZE, TCH, DH, GPA set by the PAR controller per runway end (`SetParApproach`, `parValues`); **Elevation tolerance above / below** (`parTolElHigh`, `parTolElLow`); the azimuth in degrees | Order 8200.1D (the 0.5° lower safe limit) | ADRs 0123, 0130 |
| a transit "release" held on the airspace, Resume ops, pass marks | a **transit**: Request transit / Approve transit / Decline transit / Acknowledge, decided by whoever separates the airspace's users; its restrictions are ordinary assignments; grey marks `TRANSIT <name>` (REQ, DECLINED) | JO 7110.65BB para 9-3-1, 9-3-4; JO 7610.14A para 8-1-9 b.1 | ADR 0128 supersedes 0127; ADR 0136 adds Acknowledge |
| — (new) | **`COORD <name>`**: a grey mark on a flight filed through an active MOA, warning or restricted area that nobody has coordinated (no transit, no entry approval) | ours | ADR 0136, `efsp-alerts.airspaceCoordinate` |
| — (new) | **jurisdiction area** (airspace kind `JURISDICTION`): whose airspace an aircraft is in. **LTAG CTR (control zone)** is the tower's, never bare "CTR" (the Center Position); the **RAPCON** AP's and PAR's; the **carrier area** every carrier Position's | JO 7110.65BB para 2-1-15 c "area of jurisdiction"; AIP Türkiye | ADR 0125 |
| — (new) | **hand EAT** (`SetEat`, `eatOverrideUtc`): an EAT the Marshal assigned by hand, underlined until cleared | CV NATOPS 6.4.4, 6.4.9 | ADR 0137 |
| "the map shows ground vehicles", the airport radar's `seesGround`, "Hide ground units" | **no radar presents a ground vehicle** | — (no surface movement radar is modelled) | ADR 0121 |
| MapTiler terrain-RGB tiles, `webp-lossless.js`, `retryErroredTiles` | the **DCS terrain cache** (`<Theater>-<spacing>m.terrain`, `npm run terrain:build`); bundled glyphs; the **fallback basemap** (OpenFreeMap) | DCS `land.getHeight` | ADR 0133; U-GLYPHS |

## 6. The final tests and after (ADRs 0139-0144)

| Old word or name | Now | Source | Note |
|---|---|---|---|
| provisional correlation, `PROVISIONAL`, `TRK?`, the label `?`, callsign match (exact/fuzzy), `AMBIGUOUS_CALLSIGN`, `confidence` | gone: a flight is **correlated** by its beacon code or a controller's binding, or it is `NO TRK` | JO 7110.65BB ¶5-3-3 d, ¶5-3-4 | ADR 0142 |
| — (new) | **synthetic code**: a Mode 3/A code from crc-sync's block (6000-6777) that an AI aircraft squawks; a controller may type one into Block 5, crc-sync never assigns one. **`CODE_REISSUED`**: that code now sits on a different AI aircraft | ours | ADR 0059, 0142 |
| `RANGE`, `DANGER` (airspace types) | gone: the area types are **MOA**, **restricted**, **prohibited**, **warning** (FAA special use airspace); a range is a using agency (its Position stays), not an airspace type | 14 CFR 73, JO 7400.2R | ADR 0144 |
| — (new) | **IN FORCE**: a prohibited area's state word; always in force, no schedule, activation or release (`inForce`) | JO 7400.2R ¶22-1-4 | ADR 0144 |
| — (new) | **Transit complete** (`EndTransit`): ends an approved transit by hand; by the Strip's holder it leaves a grey `transit complete` line for the decider to **Acknowledge** | ours | ADR 0144 |
| the RAPCON's "Class C", a required `airspaceClass` | **unclassified** airspace (the RAPCON is the Adana **MTMA**) with a **VFR service**: *VFR separated from IFR and VFR*, *IFR separated from VFR; VFR to VFR traffic advisories*, *VFR: traffic advisories, no separation* (`vfrService` `ALL_SEPARATED`/`IFR_SEPARATED`/`ADVISORY`; a class implies one) | JO 7110.65BB ¶7-9-4, ¶7-8-2, ¶7-6-1; AIP Türkiye | ADR 0143 |
| — (new) | **VFR departure** (`CreateVfrDeparture`, `.vfr`): CD's one-step code and Strip for a VFR pilot; **DIR** (Block `9K`, `directionOfFlight`) its direction of flight | JO 7110.65BB ¶7-6-10 | ADR 0143 |
| "altitude checked until Begin descent" on a PAR final | **no clearance alerts once the final Position holds the flight**; the **glidepath alert** (`GLIDESLOPE`, `GP ↓/↑`) after Begin descent; **FIN HDG**, the heading that holds the final course in the wind | ¶5-12-3 | ADR 0139 |
| `headingGraceSec` (30 s to turn) | the **turn time**: the turn ÷ the turn rate (3°/s, or 25° of bank at ground speed) + 15 s, with a continuity check | AIM ¶5-3-8 | U-FT-SMALL |
