# RENAME: the mapping table (W7, shared by RENAME-A, RENAME-B and RENAME-C)

> Rulings: H96 (rename toward the FAA, glossary plus code, UI and docs; a RENAME phase alone after the structural
> phases and before L20; wire and snapshot names only in a separately listed commit; ADRs never edited), H98 (scope and
> the human's calls), H82 R3-35 (hard rename of the ASACS env keys), S-desk3 (golden replay is the acceptance check,
> an output change is its own approved commit), S-ARCH2, S-TEST. Source inventory:
> `docs/parallel/research/vocabulary.md` (rows R1-R17 there; this file's rows are N01-N18). Briefings:
> [RENAME-A](RENAME-A.md) (crc-sync identifiers, all wire/snapshot names), [RENAME-B](RENAME-B.md) (client JS, CSS,
> HTML, UI labels), [RENAME-C](RENAME-C.md) (docs, glossary, config keys, env vars, infra). Prep notes and open
> questions: `docs/wip/RENAME-PREP.md`. **decisions.md wins over this file; the human's answers to RP-1..RP-6 may
> change rows N10, N11, N13 and N18.**

Written at `165a517`, before W1. By W7 the code will have moved into the target layout (`docs/wip/ARCH-plan.md`
§2.2: `board/`, `wire/families/`, `authority/roles/`, ES modules on the client, facility data in JSON). **Nothing here
is keyed by file or line.** Every row is keyed by token; every lane re-finds its sites on its own base with the script
in §8 (step 0).

## 1. The rules every lane applies

### 1.1 Tokens, not substrings

A **token** is a maximal run of `[A-Za-z0-9_$-]` (so `efsp-field-state-delta`, `fdrIdByLineId` and `twr-runway-queue`
are one token each; `.` `'` `"` `/` and spaces end a token). The machine table (§7) has four kinds of row:

| Op | Meaning |
|---|---|
| `=` | **Exact.** A token equal to *old* becomes *new*. Applied first. |
| `~` | **Stem.** Inside any token that contains *old* and has no `=` or `!` row, *old* becomes *new* (case-sensitive; rows are tried top to bottom, first match wins, so `fdrs` is tried before `fdr`). |
| `!` | **Keep.** The token is never changed (a collision the rows above would otherwise hit). |
| `?` | **Review.** The token is ambiguous. Step 0 lists every site; the lane marks each site Y or N in a review file it commits (`docs/wip/RENAME-<X>/review-<row>.tsv`, `path:line:token#n<TAB>Y|N<TAB>why`; a rename never adds or removes a line, so the keys survive the other rows' commits), and the codemod applies only the Y sites. Prose rows (cls `P`) are not codemodded at all (§5). |

Mode `lit` restricts a row to a **value**: the token as a whole quoted string (`'TWR'`, `"TWR"`, `` `TWR` ``), an
object key (`TWR:`, `"TWR":`) or a property (`.TWR`). Mode `tok` matches the token anywhere, comments included (a
comment that names an identifier must follow it; the comment's English is L20's, §5).

**Merge check.** The codemod refuses to finish if, in any one file, two *different* old tokens map to the same new
token (for example `fdr` and `fdrs` both becoming `flightData` would turn `for (const fdr of fdrs)` into a TDZ error).
It prints the file and both tokens; the lane resolves it with an exact row, never by hand. It also refuses a new token
that already exists in the file with another meaning (§3, N14's `runwayStatus` is the known case).

### 1.2 Classes and owners

Every token has exactly **one owning lane**, and the owner edits **every** occurrence of it in every tree (except
`*.md`, which is always lane C's). That is what keeps three parallel lanes from editing the same token twice.

| cls | What | Owner, commit kind |
|---|---|---|
| `W` | Wire message types, snapshot/delta/audit fields, refusal reasons, Mutation kinds, Position and Bay ids, freeze-harness names: anything that reaches a frame, the snapshot, the Mutation log or a golden | **RENAME-A, in the separately listed wire commit** (`behaviour(RENAME-A): …`), crc-sync, crc-desktop client, crc-desktop tests and e2e, `crc-sync/config/*.json`, soak profiles. Goldens re-recorded in that commit |
| `S` | A structural identifier that exists on both sides (client mirrors of server modules held by the PARITY tests, crc-sync modules that crc-desktop tests `require`/`import`) | RENAME-A, structural commit (golden-identical), both sides |
| `A` | A structural identifier only in crc-sync (src, tests, tools, server.js) | RENAME-A, structural commit |
| `B` | A structural identifier only in the client (JS, CSS classes, DOM ids, `data-*`, map layer ids, test-local names) | RENAME-B |
| `U` | UI text a controller reads | RENAME-B |
| `K` | A config JSON key that never reaches the wire | RENAME-C (the JSON and every reader of the key, in one commit). **Today every facility key that would be renamed is also `W`** (they reach the snapshot), so `K` is empty at `165a517`; step 0 re-checks |
| `E` | Environment variables and the page globals that carry them | RENAME-C, all trees |
| `P` | Prose | RENAME-C in docs, RENAME-B in UI strings; comments are L20's |
| `*` | Not fixed: derived per token at step 0 | `W` if the token occurs in a behaviour golden; else `S` if it occurs in both crc-sync and the client; else by tree |

**Promotion rule (safe side).** A token derived as `A`, `S` or `B` that step 0 finds in a golden, in a wire payload
(`efsp-ws.js`/`wire/**` sends, `ws-hub.js` frames, the snapshot), in a persisted file or in the Mutation log is
promoted to `W`. A wire field the goldens happen not to exercise (N16 `releaseState` is one) must still be `W`: a
structural commit may not change bytes on the wire even where no golden would notice.

### 1.3 Areas (what the counts and the codemods cover)

| Area | Paths |
|---|---|
| A | `crc-sync/` except `config/`, `data/`, `tests/freeze/golden/`, `protos/`, `*.md` |
| B | `crc-desktop/app/` (except `protos/`), `crc-desktop/e2e/`, `crc-desktop/tests/`, `crc-desktop/playwright.config.js` |
| C | `crc-sync/config/`, `crc-sync/data/`, `infra/` (not `infra/tests/fixtures/`), `.github/`, `.env.example`, `crc-desktop/main.js`; `sourcedcs-web/` **for `E` rows only** |
| D | the docs lane C rewrites (§5.2) |
| G | `crc-sync/tests/freeze/golden/**` (never edited, only re-recorded) |
| never | `docs/adr/**` (P4), `docs/wip/**`, `docs/parallel/**`, `docs/ui-findings/**`, `docs/atobrief/**`, `**/protos/**` (DCS-gRPC), `lxsrs_v2/`, `crc-desktop/python-pkg/`, `atobrief/`, `tools/`, `.junie/`, `sourcedcs-web/` except `E` rows, `package-lock.json` |

## 2. Position ids (H98: "the correct FAA facility position names wherever possible")

FAA source: **JO 7210.3 ¶10-1-1, TBL 10-1-1 "Operating Position Designators"** (terminal), fetched 2026-10-01
(`https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap10_section_1.html`): 1 AD Arrival Data (Radar),
2 **AP Approach Control**, 3 AR Arrival Control (Radar), 4 CC Coordinator (Tower), 5 **CD Clearance Delivery**,
6 CI Coordinator (Radar), 7 DC Departure Control, 8 DD Departure Data (Radar), 9 DR Departure Control (Radar),
10 EN Flight Service, 11 FD Flight Data, 12 **GC Ground Control**, 13 **LC Local Control**, 14 OM Operations Manager,
15 OS Operations Supervisor, 16 **PAR Precision Approach Radar**, 17 STMCIC; "Facility air traffic managers may use
designators other than those listed to accommodate local situations". En route: **JO 7210.3 ¶6-1-5, TBL 6-1-1**
(A, C, D Sector Controller, DR Radio Controller, …, **R Radar Controller**, RH Radar Handoff, …).

| Facility | Old id | New id | Long name (glossary, tooltips) | Citation |
|---|---|---|---|---|
| INCIRLIK | `OPS` | `OPS` (kept) | Airfield Operations (BASOPS/AMOPS) | project/USAF name: no FAA ATC position takes flight-plan intake at a military field (FD Flight Data, TBL 10-1-1 #11, is a tower/TRACON data position, not this). H98 keeps it |
| INCIRLIK | `CD` | `CD` (unchanged) | Clearance Delivery | TBL 10-1-1 #5 |
| INCIRLIK | `GND` | **`GC`** | Ground Control | TBL 10-1-1 #12 |
| INCIRLIK | `TWR` | **`LC`** | Local Control | TBL 10-1-1 #13 |
| INCIRLIK | `RSU` | `RSU` (kept) | Runway Supervisory Unit | USAF; no FAA position. H98 keeps it |
| INCIRLIK | `APP` | **`AP`** (RP-3) | Approach Control (departures consolidated: DC #7) | TBL 10-1-1 #2 |
| INCIRLIK | `SFA` | `SFA` (kept) | Single-frequency approach | the service is P/CG SINGLE-FREQUENCY APPROACH; no position designator. H98 keeps it |
| INCIRLIK | `PAR` | `PAR` (unchanged) | Precision Approach Radar | TBL 10-1-1 #16 (already the FAA designator) |
| CENTER | `CTR` | `CTR` (kept, **RP-1**) | Center, Radar Controller (R) | TBL 6-1-1 #12 names the sector's radar position `R`; a one-letter id is not safely codemoddable (`'R'` is also a runway suffix) and the FAA designates positions per sector (R/D/RH) while `CTR` names the single-sector facility. Default: keep, long name "Center (R)" |
| TACTICAL | `TAC_C2`, `AIC`, `GCI`, `JTAC` | kept | MRU positions | JO 7610.14 ¶8-1-1: an MRU is not an ATC facility; FAA ATC designators do not apply (H98) |
| CARRIER | `CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2` | kept | Marshal, PriFly, approach lanes 1/2 | CV NATOPS (Navy); H93, H98 |
| RANGES | derived from `efsp-airspaces.json` | kept | range control | using/controlling agency, not ATC |

**Consolidation after the rename** (N05): `{ CD: 'GC', GC: 'LC', LC: 'AP', SFA: 'AP', PAR: 'AP' }`.

**Bay ids** carry the Position prefix and are renamed with it (exact rows in §7, never a prefix rule: `gnd-red`,
`gnd-iff-*` and `gnd-label-*` are map ground-unit classes, and `app-` starts dozens of unrelated tokens):
`twr-runway-queue` `twr-airborne` `twr-arrivals` `twr-final` `twr-landed` `twr-coordination` → `lc-…`;
`gnd-pushback` `gnd-taxi-out` `gnd-taxi-in` `gnd-coordination` → `gc-…`; `app-inbound` `app-departures`
`app-overflight` `app-coordination` → `ap-…`; `ctr-app-coordination` → `ctr-ap-coordination`. `cd-*`, `ops-*`,
`rsu-*`, `sfa-*`, `par-*`, `ctr-*` (other than that one), tactical and carrier Bays keep their ids, except
`ops-field-state` → `ops-runway-status` (N14).

**What the Position-id rows do not touch:** the ids in English prose and comments (L20; docs: lane C), lower-case
local variables in tests (`const twr = …`, `gnd`, `app`, `ctr`: left, listed for L20), `CV_APP1`/`CV_APP2`,
`APP_LANES` (carrier), `APP_PORT`, `APP_RADAR`, radar labels such as `'LTAG APP'` (the `lit` mode only matches the whole
quoted value), the per-Position scope letters `positionLetters` (values `G`, `T`, `A` stay: they are facility data,
not names; a later data edit may change them).

## 3. The terms

Counts are **occurrences at `165a517`** from §8's script, per area A/B/C/D/G (§1.3). "Mechanical" sums the `=`/`~`
rows, "review" the `?` rows. They size the lanes; step 0 recounts on the W6 base.

| Row | Old (every form found) | New | Lanes | FAA citation | Collisions and keeps | Mechanical A/B/C/D/G | Review A/B/C/D/G |
|---|---|---|---|---|---|---|---|
| N01 | "seat" for a Position; `SEATS` (test map) | **Position**; `STAFFED` | A (test), C (docs) | JO 7210.3 ¶2-2-3 "each open position"; TBL 10-1-1, TBL 6-1-1 "Operating Position Designators" | SRS `Seat` (srs-client, lxsrs) and DCS "ejection seat" (protos): never | 4/0/0/0/0 | 4/2/0/1/0 |
| N02 | "station" for a Position; `StationCoverage`, `stationCoverage`, `station-coverage` (module), `crcsync-stationcov-` | **Position**; `PositionCoverage`, `positionCoverage`, `position-coverage.js` | A (S), C | as N01 | keep `ON_STATION`, `OFF_STATION`, `*-on-station` Bays, `onStationUtc`, `homeStation` (USAF home station), `wx-station`, `radar-station`, `workstation`, `stationary`, `'THIS STATION'` | 21/0/0/1/0 | 5/3/0/15/0 |
| N03 | occupied / unoccupied / occupancy / unmanned (a Position); `isOccupied`, `_isOccupied`, `occupiedBefore`, `PositionOccupancy`, reasons `NOT_OCCUPIED`, `UNMANNED` | **staffed / unstaffed / staffing**; `isStaffed`, `staffedBefore`, `PositionStaffing`, `NOT_STAFFED`, `UNSTAFFED` | A (S, W), B, C | JO 7210.3 ¶2-6-5 "…the tower associate (local assist) position must be staffed"; ¶2-2-3 "open position" | **Airspace occupancy keeps its word** (DES-AIRSP F2, ADR 0098 draft): `occupancyFor`, `_occupancyFor`, `occupiedAtRelease`, `AIRSPACE_STILL_OCCUPIED`, `MOA-OCCUPIED`, the "occupied airspace" warning. Runway occupant (`occupantFdrId` → N10 `occupantFlightDataId`, "occupant" stays), Marshal stack `carrier-slot-occupied`, sourcedcs-web `bk-resource-chip--occupied`. Bare `occupied` in the goldens (641) is the runway: review rows | 149/6/0/9/0 | 121/12/0/24/641 |
| N04 | hold/held/claim/release a Position, "signs into"; `setHeldPositions`, `heldPositions`, `heldPositionIds`, `heldBy`, `_claim`, `_release` (PositionStore only), the `held` list on `efsp-set-positions`/`efsp-positions-ack`/coverage, client `isHeld`, `_heldAt`, … | **sign on / sign off**; `setSignedOnPositions`, `signedOnPositions`, `signedOn`, `_signOn`, `_signOff`, … | A (A, S, W), B | JO 7210.3 ¶2-2-3 "only one certified air traffic controller is signed on and responsible for each open position"; ¶2-2-6 "Sign in/out and on/off procedures" | keep `HELD` (departure state), `cd-held`, `HOLD_FOR_RELEASE`, Marshal holding, `_pttHeld`, `withheld`, `requestPrimary`, `releasePrimaryTo` (Primary/Observer stays, vocabulary A11), `getActingPositions`, every other `_release`/`_claim` (scope: the module that defines `class PositionStore`). Message types `efsp-set-positions`/`efsp-positions-ack` keep their (neutral) names | 88/83/0/1/0 | 199/484/0/35/2741 |
| N05 | covering chain, covering Position, covered by; `coveringChain` (facility JSON + accessors), `getCoveringChain`, `COVERING_CHAIN`, `coveringPositionFor`, `coveringFor` (positions on the wire), `coveredFrom` (Strip field), `returnCoveredStrips`, `routedToCovering` (metrics) | **consolidation** ("CD is consolidated at GC"); `consolidation`, `getConsolidation`, `CONSOLIDATION`, `consolidatedAt`, `consolidatedPositions`, `consolidatedFrom`, `returnConsolidatedStrips`, `routedToConsolidated` | A (A, W), B, C | JO 7210.3 ¶2-2-3 "to include consolidated positions"; ¶2-6-5 "Consolidating Positions … consolidated/combined" | keep coverage (radar: `coverage.js`, `coverageFor`, N02's position-coverage), `RECOVERED`/`recovered`/`recovering` (carrier recovery), `discovered` | 159/5/2/3/2148 | 110/20/0/29/0 |
| N06 | hand-over, handover; `CarrierTransfer` (Mutation kind), `strip.nla.carrierTransfer`, `CARRIER_TRANSFERS`, `CARRIER_TRANSFER_EFFECTS`, `validateCarrierTransfer`, `.efsp-carrier-handover`, `data-carrier-transfer`; files `carrier/transfers.js`, `carrier/transfer-effects.js` | **handoff**; `CarrierHandoff`, `carrierHandoff`, `CARRIER_HANDOFFS`, …, `.efsp-carrier-handoff`, `data-carrier-handoff`; `carrier/handoffs.js`, `carrier/handoff-effects.js` | A (A, S, W), B | P/CG HANDOFF; JO 7110.65 ¶5-4-5 Transferring Controller Handoff, ¶5-4-6 Receiving Controller Handoff | keep `TransferStrip`, `TRANSFER_COMMS`, SFA rotation transfers, "transfer of control" (H94), other `transfer` tokens in the carrier module (step 0 lists them for review, no row renames them) | 143/64/0/17/24 | none |
| N07 | STCA; `stca` (efsp-alerts key, `alerting.json` key), `StcaMonitor`, `stca.js`, `conformanceStca` (harness tick), scope tag `'STCA'`, map layers `stca-*`, `.efsp-stca-indicator` | **Conflict Alert**; `conflictAlert`, `ConflictAlertMonitor`, `conflict-alert.js`, `conformanceConflictAlert`, tag `'CA'`, `conflict-alert-*` | A (A, W), B | P/CG CONFLICT ALERT; JO 7110.65 ¶5-13-1 "Conflict Alert (CA) and Mode C Intruder (MCI) Alert" (ERAM), ¶5-14-6 "CA/MCI" (STARS) | `CA` is a **UI tag only** (data block / scope tag); in code always `conflictAlert` (a bare `CA`/`ca` token collides with too much) | 100/64/1/9/1130 | none |
| N08 | env `ASACS_DOMAIN`, `ASACS_URL` (compose fallbacks, `.env.example`, `infra/tests`), sourcedcs-web `store.ASACS_URL`, page global `var ASACS_URL` | **`CRCSYNC_DOMAIN`, `CRCSYNC_URL` only; the fallbacks are deleted** (R3-35 hard rename) | C | project name, no FAA equivalent (R3-35) | keep the hostname `asacs.sourcedcs.page` and the default `wss://asacs…` endpoint (intentional), `asacs_link` in history notes, `infra/tests/fixtures/old-inline-nginx-compose.yml` (a historical fixture) | 0/0/15/0/0 | none |
| N09 | env `CRC_SYNC_URL` (`crc-desktop/main.js`, `app/server.js`) and the `config.js` page global `CRC_SYNC_URL` | **`CRCSYNC_URL`** | C | project name, no FAA equivalent (one spelling for one idea) | keep `CRC_SYNC` (freeze path const), `CRC_SYNC_PORT` (playwright), `crcSyncUrl` (key in installed clients' `config.json`) | 0/14/1/0/0 | none |
| N10 | FDR (Flight Data Record): `fdr`, `fdrs`, `fdrId`, `fdrIds`, `FdrStore`, `fdr-store.js`, `FDR` values, `ArchiveFdr`, ~150 compounds (`getFdr`, `createFdr`, `_callsignOfFdr`, `efspFdrs`, …), `.efsp-shared-fdr-badge` | **flight data** (H98); `flightData`, `flightDataList` (plural), `flightDataId`, `flightDataIds`, `FlightDataStore`, `flight-data-store.js`, `'FLIGHT_DATA'`, `ArchiveFlightData`, compounds by stem (RP-2) | A (A, S, W), B | FAA TFDM "Electronic Flight Data (EFD) exchange and Electronic Flight Strips (EFS)" (faa.gov TFDM page); JO 7210.3 TBL 10-1-1 #11 FD Flight Data. H98's reasons: JO 7210.3 ¶2-2-14 uses FDR for the Facility Directives Repository; "flight plan" is the filed DD1801 | **never abbreviate to `fd`/`FD`** (TBL 10-1-1's FD position, file descriptors); keep "flight plan", `filed`, `flight-plan-lookup.js` (the DD1801 path, untouched). Prose "FDR" → "flight data" (P) | 5538/1986/0/67/20665 | 516/262/0/54/0 |
| N11 | Strip **Role** (`strip.role`, `op.role`, `holdsRole` Bay key, `canCreateStripRole`, `STATES_BY_ROLE`, `NOT_A_ROLE`, `isValidRole`, `createsRoles`, `.efsp-strip-tab-role`, `authority/roles/` dir after W3) | **strip type** (`stripType`, `holdsStripType`, `canCreateStripType`, `STATES_BY_STRIP_TYPE`, `NOT_A_STRIP_TYPE`, `authority/strip-types/`); values unchanged | A (A, W), B (RP-5) | JO 7110.65 ¶2-3-4 Terminal Data Entries: separate strip layouts for Arrivals, Departures, Overflights | **never** ARIA `role` (`role=`, `setAttribute('role'`, `[role=`), Playwright `getByRole`, Casdoor/Discord roles (sourcedcs-web, atobrief, auth), the opaque invalid-input test values `ROLE1`, `NOSUCHROLE`, `MTX-NOROLE`. The guide's "an operating role a controller signs into" becomes "an operating position" (P) | 277/76/2/1/23 | 892/643/2/49/490 |
| N12 | `PeerCoordinationProposal/Response/Cancel`, `PeerTofiProposal/Response/ExitProposal` | **`InterfacilityCoordinationProposal/Response/Cancel`, `TofiProposal/Response/ExitProposal`** | A (W) | JO 7110.65 Ch 5 Sec 4 and ¶2-1-14 use "interfacility"/"intrafacility" (vocabulary R10); TOFI: JO 7610.14 ¶8-1-7 | keep `peerStripId`, `peerFacilityId`, `peerPositionId`, `peerBoard`, `recordPeer` (peer = the counterpart, not wrong) | 13/0/0/2/329 | none |
| N13 | coordination `PROPOSED` (`strip.coordination.state`, `strip.tofiCoordination.state`) | **`INITIATED`** (RP-6) | A (W) | JO 7110.65 ¶5-4-5 "while the handoff is being initiated or after acceptance" | keep Strip `PROPOSED` (proposed flight plan) and the runway-status change `PROPOSED`. Review only: the token is shared | 0 | 110/108/1/9/143 |
| N14 | field state, FIELD STATE panel, `fieldState`, `fieldStates`, `field-state*.js`, `efsp-field-state-mutation/-delta/-ack`, `ops-field-state`, ~55 `field-state-*` CSS classes, dock panel id `fieldState` | **runway status**, RUNWAY STATUS panel, `runwayStatus`, `runwayStatuses`, `runway-status*.js`, `efsp-runway-status-*`, `ops-runway-status`, `runway-status-*` | A (W, S, the pre-rename), B (CSS, U) | JO 7210.3 ¶10-1-6..¶10-1-8 (selecting/using active runways, opening and closing runways); P/CG RUNWAY IN USE / ACTIVE RUNWAY | **pre-rename first** (lane A's commit 1, it owns the collision): the existing client `runwayStatus` (one runway's OPEN/SUSPENDED/CLOSED in `pattern-board.js`, `bay-views.js`) → `runwayOpenStatus`, or it collides. Keep the runway Mutation kinds (`OpenRunway`, `BeginRunwayWorks`, …), "airfield", Block "field". Dock layout in `localStorage` (`crc-desktop-dock-layout`) names the panel id: see RENAME-B | 525/571/1/47/1363 | none |
| N15 | "EFSP State" (Block 25), bare "state" for a Strip | **strip state** (always qualified: strip state, coordination state, departure-release state, runway status) | C (docs), B (labels) | none (Block 25 is `[SOURCE-DEFINED]`); qualifying is the fix | `EFSP` itself stays (H98) | 0 | 1/0/0/5/0 |
| N16 | `assigned.releaseState`, "release state(s)", `RELEASE_STATES`, `WINDOWED_RELEASE_STATES` | **departure release**: `assigned.departureRelease`, `DEPARTURE_RELEASE_STATES`, … | A (W, A) | JO 7110.65 ¶4-3-4 "Departure Release, Hold for Release, Release Times, Departure Restrictions, and Clearance Void Times" | keep `standingReleases`, `matchesStandingRelease`, `release-envelope.js` (glossed "standing departure release (LOA)", vocabulary A4), `ReleaseAirspace`/`ReturnAirspace`, the HELD NLA "Release", `HOLD_FOR_RELEASE`. H94's future control release is `ControlRelease`, never a bare "Release" (glossary rule) | 61/1/0/4/0 | none |
| N17 | Block 5 / M4 label `SQUAWK` (the assigned code) | **`BEACON`** | B (U) | JO 7110.65 TBL 2-3-2 item 1 "Mode 3/A beacon code"; P/CG SQUAWK is the instruction | keep `track.squawk`, `squawkStatus` (the transponder reply from SRS/DCS), "squawking", the "Sequential squawk declutter" setting | 0/6/0/0/0 | none |
| N18 | Position ids `TWR`, `GND`, `APP` and every Bay id, harness id and test name built from them (§2) | **`LC`, `GC`, `AP`** (§2) | A (W) | §2 | §2 "What the Position-id rows do not touch" | 1925/774/28/137/21556 | none |

**Bare "transfer" and bare "release" are banned in new names** (vocabulary §4 A3/A4): every use names its object (strip
transfer, transfer of communications, transfer of control, departure release, airspace release, control release).

## 4. Kept (H98 and vocabulary §2), for the glossary

EFSP (product name; the FAA's EFS is noted), Bay, Rack (revisit if a TFDM manual turns up), Position, Facility, Strip,
Board, Block, Primary/Observer, owner, NLA, Mutation, `actingPositionId`, TOFI, HANDOFF/POINT_OUT/TRAFFIC/
OPERATIONAL_REQUEST/AIT, departure-release values, `ReleaseAirspace`/`ReturnAirspace`, `TransferStrip`,
`TRANSFER_COMMS`, `HANDED_OFF` and the other Strip states, stereo route, MARSA, QNH/STD, the MRU and Navy vocabularies,
CRC, `crc-sync`/`crc-desktop`, the `asacs.sourcedcs.page` hostname, "hand back".

## 5. Prose (not codemodded)

### 5.1 Who rewrites which prose

- **Code comments: L20**, after the window (H96: L20's sweep lands once on the final names). RENAME's `tok` rows
  already rename identifiers that comments name; the English around them is L20's, with `docs/glossary.md` as its key.
- **UI strings: RENAME-B.** Step 0 lists every string literal in `crc-desktop/app/public/**` that a controller can read
  and that contains an old term (`?`/`P` rows plus the Position ids), and B rewrites them through a reviewed
  replacement file, like a `?` row.
- **Docs: RENAME-C** (§5.2).

### 5.2 Docs lane C rewrites, and docs it leaves

Rewrites (area D): `CLAUDE.md`, `README.md`, `crc-sync/README.md`, `crc-desktop/README.md`, `infra/RUNBOOK.md`,
`docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`, `EFSPImplementationGuide.md` (RP-4: vocabulary only, § numbers
unchanged because code cites them), plus a new entry in `crc-desktop/build-assets/release-notes.md` and the new
`docs/glossary.md`.

Leaves (old words stay; the glossary is the key): `docs/adr/**` (P4, never edited), `docs/wip/**` (lane notes,
archived), `docs/parallel/**` (decision log, research, briefings: history), `docs/efsp-parallel-plan.md`,
`docs/efsp-wp6-plan.md`, `docs/efsp-ui-catalogue-*.md`, `docs/efsp-ui-findings.md`, `docs/ui-findings/**`,
`docs/atobrief/**`, older release-notes entries, `.junie/**`. New ADRs after W7 use only the new words.

## 6. File moves (`git mv`, by the token's owner; every importer/require updated in the same commit)

| Old | New | Owner |
|---|---|---|
| `crc-sync/src/efsp/station-coverage.js` (+ `tests/efsp-station-coverage.test.mjs`) | `position-coverage.js` (+ test) | A (S) |
| `crc-sync/src/efsp/fdr-store.js` (+ `tests/efsp-fdr-store.test.mjs`, `efsp-fdr-ato.test.mjs`) | `flight-data-store.js` (+ tests) | A (S) |
| `crc-sync/src/efsp/field-state.js`, `field-state-store.js` (+ tests, `wire/families/field-state.js` after W2) | `runway-status.js`, `runway-status-store.js` (+ tests, family file) | A (W commit: the family file carries the wire type) |
| `crc-sync/src/stca.js` (+ `tests/stca.test.mjs`) | `conflict-alert.js` (+ test) | A |
| `crc-sync/src/efsp/carrier/transfers.js`, `transfer-effects.js` (+ `tests/efsp-carrier-transfers.test.mjs`) | `handoffs.js`, `handoff-effects.js` (+ test) | A |
| `crc-sync/src/efsp/authority/roles/` (exists after W3) | `authority/strip-types/` | A |
| `crc-sync/tests/freeze/golden/scenario-field-state.json` and any trace named after an old term | renamed with the trace, listed in the W commit | A |
| `crc-desktop/app/public/js/panels/efsp/field-state-panel.js`, `field-state-rules.js`, `css/field-state-panel.css`, `e2e/field-state.spec.js`, `tests/efsp-field-state-client.test.js` | `runway-status-*` | B (the module names); A's W commit only edits the wire strings inside them |

## 7. The machine table

Columns, tab-separated: `row  op  mode  cls  old  new  note`. §1.1 defines `op` and `mode`, §1.2 `cls`. Adding or
changing a row during W7 is a supervisor decision (SendMessage "main"); a lane never edits this file, it lists the row
it needs in its wip file. A token step 0 finds that contains a stem but should not change gets a `!` row the same way.

<!-- MAP:BEGIN -->
```
N01	=	tok	A	SEATS	STAFFED	test-local map Position -> Facility
N01	!	tok	-	Seat	Seat	SRS protocol field (srs-client.js, lxsrs): never
N01	?	tok	P	seat	Position	prose only (comments: L20; docs: C)
N02	=	tok	S	StationCoverage	PositionCoverage
N02	=	tok	A	stationCoverage	positionCoverage
N02	=	tok	S	station-coverage	position-coverage	module path in require/import strings; file move
N02	=	tok	A	efsp-station-coverage	efsp-position-coverage	test file name
N02	=	tok	A	crcsync-stationcov-	crcsync-poscov-	tmp-dir prefix
N02	!	tok	-	ON_STATION	ON_STATION	MRU mission state (keep, vocabulary §2)
N02	!	tok	-	OFF_STATION	OFF_STATION
N02	!	tok	-	homeStation	homeStation	USAF home station (airbase), FDR identity field
N02	?	tok	P	station	Position	only where it means a Position; prose
N03	=	tok	S	isOccupied	isStaffed
N03	=	tok	A	_isOccupied	_isStaffed
N03	=	tok	A	occupiedBefore	staffedBefore
N03	=	tok	B	PositionOccupancy	PositionStaffing
N03	=	tok	W	NOT_OCCUPIED	NOT_STAFFED	refusal reason
N03	=	tok	W	UNMANNED	UNSTAFFED	field-state ack skip reason; also a test Position id
N03	=	tok	*	unmanned	unstaffed	strings, test titles, comments
N03	=	tok	A	TWR-occupancy	LC-staffing	test name fragment
N03	=	tok	A	GND-occupancy	GC-staffing	test name fragment
N03	=	tok	A	occupancy-gated	staffing-gated
N03	!	tok	-	occupancyFor	occupancyFor	aircraft inside an airspace (keep)
N03	!	tok	-	_occupancyFor	_occupancyFor
N03	!	tok	-	occupiedAtRelease	occupiedAtRelease	airspace occupancy (DES-AIRSP F2, ADR 0098 draft)
N03	!	tok	-	MOA-OCCUPIED	MOA-OCCUPIED	airspace
N03	!	tok	-	AIRSPACE_STILL_OCCUPIED	AIRSPACE_STILL_OCCUPIED	airspace
N03	!	tok	-	carrier-slot-occupied	carrier-slot-occupied	Marshal stack slot
N03	!	tok	-	bk-resource-chip--occupied	bk-resource-chip--occupied	sourcedcs-web booking
N03	?	tok	*	occupied	staffed	review: Position sense only (runway/airspace/stack stay)
N03	?	tok	*	unoccupied	unstaffed	review
N03	?	tok	*	occupancy	staffing	review
N03	?	tok	*	OCCUPIED	STAFFED	review
N03	?	tok	*	Occupancy	Staffing	review
N03	=	tok	*	manned	staffed	S-RENA0 (3): metrics "staffed hour", refusal details, test helpers
N03	=	tok	W	mannedHours	staffedHours	S-RENA0 (3): metrics report field (client metrics panel reads it)
N03	=	tok	W	perMannedHour	perStaffedHour	S-RENA0 (3): metrics report field
N03	=	tok	W	mannedMinutes	staffedMinutes	S-RENA0 (3): metrics report field (byHour), same family
N04	=	tok	A	setHeldPositions	setSignedOnPositions
N04	=	tok	W	heldPositions	signedOnPositions
N04	=	tok	S	heldPositionIds	signedOnPositionIds
N04	=	tok	B	coverageHeldPositions	coverageSignedOnPositions
N04	=	tok	A	heldBy	signedOnBy	PositionStore method
N04	=	tok	A	actuallyHeld	actuallySignedOn
N04	=	tok	B	heldIds	signedOnIds
N04	=	tok	B	heldFacilities	signedOnFacilities
N04	=	tok	B	heldFacilitiesWithTabs	signedOnFacilitiesWithTabs
N04	=	tok	B	isHeld	isSignedOn
N04	=	tok	B	_heldAt	_signedOnAt
N04	=	tok	B	_heldCarrierIds	_signedOnCarrierIds
N04	=	tok	B	heldHere	signedOnHere
N04	=	tok	B	_atoHeld	_atoSignedOn
N04	=	tok	B	droppedNotHeld	droppedNotSignedOn	client metrics stat
N04	=	tok	A	_claim	_signOn	PositionStore only (scope: the file defining class PositionStore)
N04	=	tok	A	_release	_signOff	PositionStore only (other _release tokens stay)
N04	!	tok	-	_pttHeld	_pttHeld	push-to-talk key
N04	!	tok	-	withheld	withheld
N04	!	tok	-	HELD	HELD	departure state (JO 7110.65 4-3-4)
N04	!	tok	-	cd-held	cd-held	Bay id (HELD state)
N04	!	tok	-	requestPrimary	requestPrimary	Primary/Observer kept
N04	!	tok	-	releasePrimaryTo	releasePrimaryTo	transfer of Primary, not sign-off
N04	!	tok	-	getActingPositions	getActingPositions
N04	!	tok	-	CENTER-held	CENTER-held	S-RENA0 (2): "a Strip CENTER holds" (owner sense), not the signed-on list
N04	!	tok	-	AIC-held	AIC-held	S-RENA0 (2): owner sense, as above
N04	!	tok	-	held-set	held-set	S-RENA0 (2): comment prose (N04 rule: prose is L20)
N04	!	tok	-	actually-held	actually-held	S-RENA0 (2): test-title prose (L20)
N04	?	tok	W	held	signedOn	review: the Position list on efsp-set-positions/efsp-positions-ack/coverage (W) and locals holding Position ids; never HELD/hold
N05	=	tok	W	coveringChain	consolidation	facility JSON key + accessor; in goldens
N05	=	tok	A	_coveringChain	_consolidation
N05	=	tok	A	getCoveringChain	getConsolidation
N05	=	tok	A	COVERING_CHAIN	CONSOLIDATION
N05	=	tok	A	covering-chain	consolidation	test-name fragment
N05	=	tok	A	coveringPositionFor	consolidatedAt
N05	=	tok	W	coveringFor	consolidatedPositions	positions list on the wire
N05	=	tok	W	coveredFrom	consolidatedFrom	Strip field (snapshot)
N05	=	tok	W	returnCoveredStrips	returnConsolidatedStrips	public BoardStore method; in the hub goldens' surface list
N05	=	tok	W	routedToCovering	routedToConsolidated	metrics report field (client reads it)
N05	=	tok	A	coveringStranded	consolidationStranded
N05	=	tok	A	coveringHandedBack	consolidationHandedBack
N05	=	tok	B	04-covering-lands-in-tab	04-consolidated-lands-in-tab	screenshot name
N05	!	tok	-	RECOVERED	RECOVERED
N05	!	tok	-	recovered	recovered
N05	!	tok	-	recovering	recovering
N05	?	tok	P	covering	consolidated	prose: "the covering Position" -> "the Position it is consolidated at"
N05	?	tok	P	covered	consolidated	prose
N06	=	tok	W	CarrierTransfer	CarrierHandoff	Mutation kind
N06	=	tok	W	carrierTransfer	carrierHandoff	strip.nla.carrierTransfer
N06	=	tok	A	carrierTransfers	carrierHandoffs
N06	=	tok	S	CARRIER_TRANSFERS	CARRIER_HANDOFFS	server table + client mirror
N06	=	tok	A	CARRIER_TRANSFER_EFFECTS	CARRIER_HANDOFF_EFFECTS
N06	=	tok	A	validateCarrierTransfer	validateCarrierHandoff
N06	=	tok	A	canRecordCarrierTransfer	canRecordCarrierHandoff
N06	=	tok	A	_applyCarrierTransfer	_applyCarrierHandoff
N06	=	tok	A	efsp-carrier-transfers	efsp-carrier-handoffs	test file name
N06	=	tok	B	data-carrier-transfer	data-carrier-handoff	DOM attribute
N06	=	tok	B	efsp-carrier-handover	efsp-carrier-handoff	CSS class
N06	=	tok	B	03-two-handover-buttons	03-two-handoff-buttons	screenshot name
N06	=	tok	*	hand-over	handoff
N06	=	tok	*	hand-overs	handoffs
N06	=	tok	*	Hand-over	Handoff
N06	=	tok	*	handover	handoff
N06	=	tok	*	Handovers	Handoffs
N07	=	tok	W	stca	conflictAlert	efsp-alerts payload key + alerting.json key
N07	=	tok	*	STCA	CA	scope tag / labels; prose "STCA" -> "Conflict Alert" in docs
N07	=	tok	A	StcaMonitor	ConflictAlertMonitor
N07	=	tok	A	stcaMonitor	conflictAlertMonitor
N07	=	tok	A	stcaMax	conflictAlertMax
N07	=	tok	A	stcaChanged	conflictAlertChanged
N07	=	tok	A	stcaRaised	conflictAlertRaised
N07	=	tok	A	_stcaUp	_conflictAlertUp
N07	=	tok	W	conformanceStca	conformanceConflictAlert	freeze harness tick name (in hub goldens)
N07	=	tok	A	conformance-stca	conformance-conflict-alert	S-RENA0 (2): ticker name (app.js, app-boot test, soak host-core)
N07	=	tok	B	stcaConflictsForTrack	conflictAlertsForTrack
N07	=	tok	B	buildStcaOverlay	buildConflictAlertOverlay
N07	=	tok	B	stcaNode	conflictAlertNode
N07	=	tok	B	stca-paths	conflict-alert-paths	map layer id
N07	=	tok	B	stca-cpa	conflict-alert-cpa	map source id
N07	=	tok	B	stca-cpa-line	conflict-alert-cpa-line	map layer id
N07	=	tok	B	stca-cpa-label	conflict-alert-cpa-label	map layer id
N07	=	tok	B	efsp-stca-indicator	efsp-conflict-alert-indicator	CSS class
N08	=	tok	E	ASACS_DOMAIN	CRCSYNC_DOMAIN	R3-35 hard rename: drop the fallback, not rename it
N08	=	tok	E	ASACS_URL	CRCSYNC_URL	env fallback + sourcedcs-web store key + page global
N08	!	tok	-	$$ASACS_DOMAIN	$$ASACS_DOMAIN	infra/tests/fixtures/old-inline-nginx-compose.yml is a historical fixture
N08	!	tok	-	asacs.sourcedcs.page	asacs.sourcedcs.page	hostname, intentional
N08	!	tok	-	asacs_link	asacs_link	retired product name in history notes
N09	=	tok	E	CRC_SYNC_URL	CRCSYNC_URL	env (main.js, app/server.js) + config.js page global
N09	!	tok	-	CRC_SYNC	CRC_SYNC	path constant in freeze tests
N09	!	tok	-	CRC_SYNC_PORT	CRC_SYNC_PORT	playwright.config.js port constant
N09	!	tok	-	crcSyncUrl	crcSyncUrl	user config.json key on installed clients
N10	=	tok	W	fdrId	flightDataId
N10	=	tok	W	fdrIds	flightDataIds
N10	=	tok	W	fdrs	flightDataList	snapshot/delta key and locals (plural rule)
N10	=	tok	W	fdr	flightData	Block Map target kind 'fdr', locals
N10	=	tok	W	occupantFdrId	occupantFlightDataId	runway occupant (occupant stays)
N10	=	tok	W	existingFdrId	existingFlightDataId
N10	=	tok	W	ArchiveFdr	ArchiveFlightData	audit op
N10	=	tok	W	fdrEqual	flightDataEqual	freeze harness field
N10	=	tok	W	FDR_PROVISIONAL	FLIGHT_DATA_PROVISIONAL	correlation source value
N10	=	tok	W	peerFdrId	peerFlightDataId	promoted (§1.2, RENAME-A N10 commit): ATO arInfo.links[] field on the flight data, read by the client ato-strip.js; goldens carry it only inside a record hash
N10	=	lit	W	FDR	FLIGHT_DATA	string value only ('FDR' correlation/runway source); prose FDR -> "flight data"
N10	=	tok	S	FdrStore	FlightDataStore
N10	=	tok	S	fdr-store	flight-data-store	module path; file move
N10	=	tok	B	efsp-shared-fdr-badge	efsp-shared-flight-data-badge	CSS class
N10	~	tok	*	FDRS	FLIGHT_DATA_LIST	stem, SNAKE plural
N10	~	tok	*	FDR_	FLIGHT_DATA_	stem, SNAKE prefix
N10	~	tok	*	_FDR	_FLIGHT_DATA	stem, SNAKE suffix
N10	~	tok	*	Fdrs	FlightDataList	stem, plural
N10	~	tok	*	fdrs	flightDataList	stem, plural (camel prefix)
N10	~	tok	*	Fdr	FlightData	stem
N10	~	tok	*	fdr-	flight-data-	stem, kebab
N10	~	tok	*	fdr	flightData	stem, camel prefix
N10	?	tok	P	FDR	flight data	prose (comments: L20; docs: C; UI text: B)
N10	?	tok	P	FDRs	flight data	prose
N11	=	tok	W	holdsRole	holdsStripType	facility JSON Bay key
N11	=	tok	W	canCreateStripRole	canCreateStripType	in goldens
N11	=	tok	W	STATES_BY_ROLE	STATES_BY_STRIP_TYPE
N11	=	tok	W	STATE_OWNERS_BY_ROLE	STATE_OWNERS_BY_STRIP_TYPE
N11	=	tok	W	CREATE_ROLE_PERMISSIONS	CREATE_STRIP_TYPE_PERMISSIONS
N11	=	tok	W	NOT_A_ROLE	NOT_A_STRIP_TYPE	refusal reason
N11	=	tok	A	isValidRole	isValidStripType
N11	=	tok	W	roleChange	stripTypeChange
N11	=	tok	W	toRole	toStripType
N11	=	tok	W	fromRole	fromStripType
N11	=	tok	A	createsRoles	createsStripTypes	capability column
N11	=	tok	A	createRoles	createsStripTypes	S-RENA0 (2): the Position-family field, one spelling with createsRoles (a property MERGE, accepted)
N11	=	tok	A	registerRoleFamily	registerStripTypeFamily	S-RENA0 (2)
N11	=	tok	A	roleFamilies	stripTypeFamilies	S-RENA0 (2)
N11	=	tok	A	roleFamily	stripTypeFamily	S-RENA0 (2)
N11	=	tok	A	_byRole	_byStripType	S-RENA0 (2)
N11	=	tok	A	_byRoleWhere	_byStripTypeWhere	S-RENA0 (2)
N11	=	tok	A	roleBayFor	stripTypeBayFor	S-RENA0 (2)
N11	=	tok	A	roleNames	stripTypeNames	S-RENA0 (2)
N11	=	tok	W	byRole	byStripType
N11	=	tok	A	bayHoldsRole	bayHoldsStripType
N11	=	tok	A	roleBay	stripTypeBay
N11	=	tok	A	roleBayIds	stripTypeBayIds
N11	=	tok	A	_roleBayFor	_stripTypeBayFor
N11	=	tok	A	roleOfBay	stripTypeOfBay
N11	=	tok	A	CARRIER_ROLES	CARRIER_STRIP_TYPES
N11	=	tok	A	ATC_ROLES	ATC_STRIP_TYPES
N11	=	tok	A	DEFAULT_INITIAL_STATE_BY_ROLE	DEFAULT_INITIAL_STATE_BY_STRIP_TYPE
N11	=	tok	A	UNCLASSIFIED_ROLE	UNCLASSIFIED_STRIP_TYPE
N11	=	tok	A	CLEARANCE_BLOCKS_BY_ROLE	CLEARANCE_BLOCKS_BY_STRIP_TYPE
N11	=	tok	A	STATE_SETS_BY_ROLE	STATE_SETS_BY_STRIP_TYPE
N11	=	tok	A	COMPUTE_BY_ROLE	COMPUTE_BY_STRIP_TYPE
N11	=	tok	A	efsp-carrier-roles	efsp-carrier-strip-types	test file name
N11	=	tok	A	efsp-role-bay-	efsp-strip-type-bay-	tmp prefix
N11	=	tok	B	_createStripRoleEl	_createStripTypeEl
N11	=	tok	B	efsp-create-strip-role	efsp-create-strip-type	CSS class / DOM id
N11	=	tok	B	efsp-strip-tab-role	efsp-strip-tab-type	CSS class
N11	=	tok	B	COMPACT_BLOCKS_BY_ROLE	COMPACT_BLOCKS_BY_STRIP_TYPE
N11	=	tok	B	ROLE_ABBR	STRIP_TYPE_ABBR
N11	=	tok	B	MTR_ROLES	MTR_STRIP_TYPES	test-local
N11	!	tok	-	getByRole	getByRole	Playwright API
N11	!	tok	-	ROLE1	ROLE1	invalid-input test values in goldens: opaque, keep
N11	!	tok	-	NOSUCHROLE	NOSUCHROLE
N11	!	tok	-	MTX-NOROLE	MTX-NOROLE
N11	?	tok	W	role	stripType	review: Strip/op/Bay/Block-Map strip axis only. Never ARIA role, Casdoor/Discord roles, Playwright getByRole
N11	?	tok	*	Role	strip type	review: type names/prose ("Strip Role")
N11	?	tok	*	roles	stripTypes	review
N11	?	tok	*	Roles	strip types	review
N12	=	tok	W	PeerCoordinationProposal	InterfacilityCoordinationProposal	audit/replica kind
N12	=	tok	W	PeerCoordinationResponse	InterfacilityCoordinationResponse
N12	=	tok	W	PeerCoordinationCancel	InterfacilityCoordinationCancel
N12	=	tok	W	PeerTofiProposal	TofiProposal	TOFI is interfacility by definition
N12	=	tok	W	PeerTofiResponse	TofiResponse
N12	=	tok	W	PeerTofiExitProposal	TofiExitProposal
N12	!	tok	-	peerStripId	peerStripId	peer* fields name the counterpart: keep
N12	!	tok	-	peerFacilityId	peerFacilityId
N12	!	tok	-	peerPositionId	peerPositionId
N12	!	tok	-	recordPeer	recordPeer
N13	?	lit	W	PROPOSED	INITIATED	review: only coordination.state / tofiCoordination.state values; Strip PROPOSED and runway-status change PROPOSED stay
N14P	=	tok	S	runwayStatus	runwayOpenStatus	PRE-RENAME, lane A's first commit: the existing client pattern-board param would collide with N14
N14	=	tok	W	efsp-field-state-mutation	efsp-runway-status-mutation	wire type
N14	=	tok	W	efsp-field-state-delta	efsp-runway-status-delta	wire type
N14	=	tok	W	efsp-field-state-ack	efsp-runway-status-ack	wire type
N14	=	tok	W	fieldStates	runwayStatuses	snapshot key
N14	=	tok	W	fieldState	runwayStatus	also the dock panel id (localStorage layout)
N14	=	tok	W	fieldStateSeq	runwayStatusSeq
N14	=	tok	W	fieldStateFacilityId	runwayStatusFacilityId
N14	=	tok	W	FIELD_STATE_OP_OWNERS	RUNWAY_STATUS_OP_OWNERS
N14	=	tok	W	ops-field-state	ops-runway-status	Bay id
N14	=	tok	U	FIELD STATE	RUNWAY STATUS	panel title (two-word literal)
N14	~	tok	*	FIELD_STATE	RUNWAY_STATUS	stem
N14	~	tok	*	FieldState	RunwayStatus	stem
N14	~	tok	*	fieldState	runwayStatus	stem
N14	~	tok	*	field-state	runway-status	stem (CSS classes, files, wire types)
N14	~	tok	*	Field-state	Runway-status	stem
N14	!	tok	-	OpenRunway	OpenRunway	Mutation kinds keep their names
N15	?	tok	P	EFSP State	strip state	prose/label only (guide Block 25)
N16	=	tok	W	releaseState	departureRelease	FDR assigned.* field and Block Map bind path
N16	=	tok	A	RELEASE_STATES	DEPARTURE_RELEASE_STATES
N16	=	tok	A	WINDOWED_RELEASE_STATES	WINDOWED_DEPARTURE_RELEASE_STATES
N16	!	tok	-	standingReleases	standingReleases	kept, glossed (vocabulary A4)
N16	!	tok	-	matchesStandingRelease	matchesStandingRelease
N16	!	tok	-	HOLD_FOR_RELEASE	HOLD_FOR_RELEASE	FAA departure-release value
N17	=	lit	U	SQUAWK	BEACON	Block 5/M4 label (assigned code)
N17	!	tok	-	squawk	squawk	transponder reply field from SRS/DCS (track.squawk): keep
N17	!	tok	-	squawkStatus	squawkStatus	SRS protocol
N17	!	tok	-	squawking	squawking
N17	!	tok	-	sequential-squawk	sequential-squawk	reply declutter setting
N18	=	lit	W	TWR	LC	Position id (lit: quoted literal, object key, .prop)
N18	=	lit	W	GND	GC	Position id
N18	=	lit	W	APP	AP	Position id
N18	?	part	W	TWR	LC	review: the id as one -/_ part of a longer token ('c-TWR', test ids, harness names)
N18	?	part	W	GND	GC	review: as above
N18	?	part	W	APP	AP	review: as above (APP_LANES, APP_PORT, APP_RADAR, APP-radar are ! rows)
N18	!	tok	-	CV_APP1	CV_APP1	carrier Position (kept)
N18	!	tok	-	CV_APP2	CV_APP2
N18	!	tok	-	APP_LANES	APP_LANES	carrier lanes
N18	!	tok	-	APP_PORT	APP_PORT	playwright port
N18	!	tok	-	APP_RADAR	APP_RADAR	approach radar fixture
N18	!	tok	-	APP-radar	APP-radar	radar kind prose
N18	=	tok	W	twr-runway-queue	lc-runway-queue	Bay id
N18	=	tok	W	twr-airborne	lc-airborne	Bay id
N18	=	tok	W	twr-arrivals	lc-arrivals	Bay id
N18	=	tok	W	twr-final	lc-final	Bay id
N18	=	tok	W	twr-landed	lc-landed	Bay id
N18	=	tok	W	twr-coordination	lc-coordination	Bay id
N18	=	tok	W	gnd-pushback	gc-pushback	Bay id
N18	=	tok	W	gnd-taxi-out	gc-taxi-out	Bay id
N18	=	tok	W	gnd-taxi-in	gc-taxi-in	Bay id
N18	=	tok	W	gnd-coordination	gc-coordination	Bay id
N18	=	tok	W	app-inbound	ap-inbound	Bay id
N18	=	tok	W	app-departures	ap-departures	Bay id
N18	=	tok	W	app-overflight	ap-overflight	Bay id
N18	=	tok	W	app-coordination	ap-coordination	Bay id
N18	=	tok	W	ctr-app-coordination	ctr-ap-coordination	Bay id (CTR's Bay toward AP)
N18	=	tok	W	ctl-twr	ctl-lc	freeze harness controller id
N18	=	tok	W	ctl-gnd	ctl-gc
N18	=	tok	W	ctl-app	ctl-ap
N18	=	tok	W	obs-app	obs-ap
N18	=	tok	W	APP_CTR_ONLY_OP_KINDS	AP_CTR_ONLY_OP_KINDS
N18	=	tok	A	twr-controller	lc-controller	test controller id
N18	=	tok	A	gnd-controller	gc-controller
N18	=	tok	A	app-controller	ap-controller
N18	=	tok	A	APP_SESSION	AP_SESSION
N18	=	tok	B	gnd-pending	gc-pending	client test Bay id
N18	!	tok	-	gnd-red	gnd-red	map ground-unit CSS (gnd = ground unit, not GND)
N18	!	tok	-	gnd-blue	gnd-blue
N18	!	tok	-	gnd-neutral	gnd-neutral
N18	!	tok	-	gnd-iff-friendly	gnd-iff-friendly
N18	!	tok	-	gnd-iff-bogey	gnd-iff-bogey
N18	!	tok	-	gnd-iff-neutral	gnd-iff-neutral
N18	!	tok	-	gnd-label-input	gnd-label-input
N18	!	tok	-	gnd-label-popup	gnd-label-popup
```
<!-- MAP:END -->

## 8. The tool (count, review, apply)

Copy the block below to your scratchpad as `rename_tool.py` and run it from the repo root. It is the single
implementation of §1 for all three lanes (same tokenizer, same classes), so their edits agree. It was dry-run on a
copy of `165a517` by RENAME-PREP (§10). `count` is step 0; `review ROW --area X` prints the sites of a `?` row
(`path:line:token#n<TAB>?<TAB>context`, n = which occurrence of the token on that line), which the lane turns into `docs/wip/RENAME-<X>/review-<ROW>.tsv` by
replacing `?` with `Y` or `N` and a reason; `apply` rewrites files in place for one lane and one commit kind
(`structural`, `wire`, or for lane C `docs`), honouring `!` rows and the review files (a row id ending in `P`, the pre-rename `N14P`, runs only when named with `--rows`), and exits non-zero on a
**MERGE** (two old tokens becoming one new token in one code file). A **WARN** (the new token already exists in the
file) is checked by hand and noted in the commit message. At start-up it refuses a table in which one row's new token
is another row's old token (a CHAIN would make `apply` non-idempotent). File moves are not done by the tool: see
RENAME-A step 1.

```python
#!/usr/bin/env python3
"""RENAME tool (W7). Copy it to your scratchpad; run from the repo root.

  python3 rename_tool.py count  [--tokens] [--sites ROW]       # step 0: counts per row and area, derived classes
  python3 rename_tool.py review ROW --area A|B|C|D > file.tsv   # site list for a '?' row, to mark Y/N
  python3 rename_tool.py apply  --lane A|B|C --kind structural|wire [--rows N04,N05] [--dry]

The table is read from docs/parallel/refactor/rename-map.md (between MAP:BEGIN and MAP:END). Review decisions are read
from docs/wip/RENAME-*/review-*.tsv (path:line:text#n<TAB>Y|N<TAB>why). Lines never move under a rename, so a review file stays valid across the
other rows' commits; make it after the file moves (a moved file's sites carry the new path)."""
import collections, glob, os, re, subprocess, sys

MAP = 'docs/parallel/refactor/rename-map.md'
D_DOCS = {'CLAUDE.md', 'README.md', 'EFSPImplementationGuide.md', 'crc-desktop/README.md', 'crc-sync/README.md',
          'infra/RUNBOOK.md', 'docs/efsp-usage-guide.md', 'docs/efsp-briefing.md', 'docs/glossary.md'}
NEVER = ('docs/adr/', 'docs/wip/', 'docs/parallel/', 'docs/ui-findings/', 'docs/atobrief/', '.junie/', 'lxsrs_v2/',
         'crc-desktop/python-pkg/', 'atobrief/', 'tools/', 'infra/tests/fixtures/')
TOK = re.compile(r'[A-Za-z0-9_$-]+')
OWNER = {'W': 'A', 'S': 'A', 'A': 'A', 'B': 'B', 'U': 'B', 'E': 'C', 'K': 'C', 'C': 'C', 'P': None}

def area(f):
    if not f or f.endswith('package-lock.json') or '/protos/' in f or f.startswith(NEVER): return None
    if f.endswith('.md'): return 'D' if f in D_DOCS else None
    if f.startswith('crc-sync/tests/freeze/golden/'): return 'G'
    if f.startswith(('crc-sync/config/', 'crc-sync/data/')): return 'C'
    if f.startswith('crc-sync/'): return 'A'
    if f.startswith(('crc-desktop/app/', 'crc-desktop/e2e/', 'crc-desktop/tests/')) or f == 'crc-desktop/playwright.config.js':
        return 'B'
    if f.startswith('sourcedcs-web/'): return 'Cweb'          # env rows (E) only: Discord/Casdoor roles live here
    if f.startswith(('infra/', '.github/')) or f in ('.env.example', 'crc-desktop/main.js'): return 'C'
    return None

def load_rows():
    block = open(MAP, encoding='utf-8').read().split('<!-- MAP:BEGIN -->')[1].split('<!-- MAP:END -->')[0]
    rows = []
    for line in block.splitlines():
        p = line.split('\t')
        if len(p) >= 6 and re.match(r'N\d\dP?$', p[0]):
            rows.append(dict(row=p[0], op=p[1], mode=p[2], cls=p[3], old=p[4], new=p[5], note=p[6] if len(p) > 6 else ''))
    return rows

def lit_re(t):
    e = re.escape(t)
    # a whole quoted value, an object key, or a property after an identifier/`)`/`]` (never a spread `...X`)
    return re.compile(r"""(['"`])%s\1|(?<![\w$.-])%s(?=\s*:)|(?<=[\w$)\]]\.)%s(?![\w$-])""" % (e, e, e))

def part_re(t):
    # the token as one '-', '_' or ':' delimited part of a longer token ('c-TWR', 'TWR-occupancy', 'ctl:TWR')
    return re.compile(r'(?:(?<=[-_:])%s(?=$|[-_:])|^%s(?=[-_:]))' % (re.escape(t), re.escape(t)))

def site_key(f, txt, start, text):
    # path:line:text#n, n = which occurrence of `text` on that line (1-based). Renames never add or remove lines and
    # a '?' token belongs to one row only, so the key survives other rows' edits on the same line (not a file move).
    ls = txt.rfind('\n', 0, start) + 1; seg = txt[ls:start]
    n = sum(1 for t in TOK.findall(seg) if t == text) if TOK.fullmatch(text) else seg.count(text)
    return f"{f}:{txt.count(chr(10), 0, start) + 1}:{text}#{n + 1}"

def tree():
    out = []
    for f in subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split('\n'):
        a = area(f)
        if not a or not os.path.isfile(f): continue
        try: out.append((f, a, open(f, encoding='utf-8').read()))
        except UnicodeDecodeError: pass
    return out

class Table:
    def __init__(self, rows):
        self.rows = rows
        olds = {r['old'] for r in rows if r['op'] != '!' and not r['row'].endswith('P')}
        chains = [r for r in rows if r['op'] != '!' and r['new'] in olds and r['new'] != r['old']]
        if chains:   # a row whose result another row would rename again: apply would not be idempotent
            sys.exit('CHAIN in the table: ' + ', '.join(f"{r['row']} {r['old']}->{r['new']}" for r in chains))
        self.exact = {r['old']: r for r in rows if r['mode'] == 'tok' and r['op'] in '=?!' and ' ' not in r['old']}
        self.stems = [r for r in rows if r['op'] == '~']
        self.lits = [r for r in rows if r['mode'] == 'lit' or ' ' in r['old']]
        self.parts = [(r, part_re(r['old'])) for r in rows if r['mode'] == 'part']
    def match(self, t):
        r = self.exact.get(t)
        if r: return r
        for s in self.stems:
            if s['old'] in t: return s
        for p, rx in self.parts:
            if rx.search(t): return p
        return None
    def new_token(self, r, t):
        if r['mode'] == 'part':
            return part_re(r['old']).sub(r['new'], t)
        return r['new'] if r['op'] in '=?' else t.replace(r['old'], r['new'])

def presence(files, table):
    pres = collections.defaultdict(set)           # token -> areas it occurs in
    for f, a, txt in files:
        for t in set(TOK.findall(txt)):
            if table.match(t): pres[t].add('C' if a == 'Cweb' else a)
    return pres

def derive(r, t, pres):
    if r['cls'] != '*': return r['cls']
    p = pres.get(t, set())
    return 'W' if 'G' in p else 'S' if {'A', 'B'} <= p else 'A' if 'A' in p else 'B' if 'B' in p else 'C'

def cmd_count(args):
    table = Table(load_rows()); files = tree(); pres = presence(files, table)
    cnt = collections.defaultdict(collections.Counter); comp = collections.defaultdict(collections.Counter)
    for f, a, txt in files:
        web = a == 'Cweb'; a = 'C' if web else a
        for t in TOK.findall(txt):
            r = table.match(t)
            if not r or (web and r['cls'] != 'E'): continue
            cnt[id(r)][a] += 1
            if r['op'] == '~': comp[r['old']][(t, derive(r, t, pres))] += 1
        for r in table.lits:
            if web and r['cls'] != 'E': continue
            n = len(lit_re(r['old']).findall(txt)) if r['mode'] == 'lit' else txt.count(r['old'])
            cnt[id(r)][a] += n
    lanes = collections.Counter()
    print('row op old -> new | cls | A B C D G')
    for r in table.rows:
        if r['op'] == '!': continue
        c = cnt[id(r)]; cls = derive(r, r['old'], pres) if r['op'] != '~' else '~'
        print(f"{r['row']} {r['op']} {r['old']} -> {r['new']} | {cls} | {c['A']} {c['B']} {c['C']} {c['D']} {c['G']}")
        if r['op'] == '?' and r['cls'] == 'P': lanes['prose sites (L20 comments; C docs)'] += sum(c.values()) - c['G']; continue
        if r['op'] == '?':
            for k in 'ABC': lanes[f'review sites in area {k}'] += c[k]
            lanes['C docs'] += c['D']; continue
        if r['op'] == '~': lanes['C docs'] += c['D']; continue      # stems: lanes split per compound below
        lanes['C docs'] += c['D']
        o = OWNER.get(cls)
        if cls == 'W': lanes['A wire commit'] += c['A'] + c['B'] + c['C']; lanes['G re-recorded'] += c['G']
        elif o == 'A': lanes['A structural'] += c['A'] + c['B'] + c['C']
        elif o == 'B': lanes['B'] += c['B']
        elif o == 'C': lanes['C code'] += c['A'] + c['B'] + c['C']
    for s, c in comp.items():                       # stems: split by the derived class of each compound
        for (t, k), n in c.items():
            if k == 'W': lanes['A wire commit (stems)'] += n
            elif OWNER.get(k) == 'A': lanes['A structural (stems)'] += n
            elif OWNER.get(k) == 'B': lanes['B (stems)'] += n
    print('\nLANE TOTALS (occurrences; stems listed separately):')
    for k, v in sorted(lanes.items()): print(f'  {k}: {v}')
    if '--tokens' in args:
        for s, c in comp.items():
            print(f'\nstem {s}: {len(c)} compounds')
            for (t, k), n in c.most_common(): print(f'  {k} {t} {n}')

def cmd_review(args):
    row = args[0]; want = args[args.index('--area') + 1] if '--area' in args else None
    table = Table(load_rows())
    for f, a, txt in tree():
        a = 'C' if a == 'Cweb' else a
        if a == 'G' or (want and a != want): continue
        lines = txt.splitlines()
        for m in TOK.finditer(txt):
            r = table.match(m.group(0))
            if r and r['row'] == row and r['op'] == '?' and r['mode'] != 'lit':
                k = site_key(f, txt, m.start(), m.group(0))
                print(f"{k}\t?\t{lines[int(k.split(':')[1]) - 1].strip()[:140]}")
        for r in table.lits:
            if r['row'] == row and r['op'] == '?':
                rx = lit_re(r['old']) if r['mode'] == 'lit' else re.compile(re.escape(r['old']))
                for m in rx.finditer(txt):
                    k = site_key(f, txt, m.start(), m.group(0))
                    print(f"{k}\t?\t{lines[int(k.split(':')[1]) - 1].strip()[:140]}")

def load_reviews():
    yes = set()
    for p in glob.glob('docs/wip/RENAME-*/review-*.tsv'):
        for line in open(p, encoding='utf-8'):
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 2 and parts[1] == 'Y': yes.add(parts[0])
    return yes

def cmd_apply(args):
    lane = args[args.index('--lane') + 1]; kind = args[args.index('--kind') + 1]
    only = set(args[args.index('--rows') + 1].split(',')) if '--rows' in args else None
    dry = '--dry' in args
    table = Table(load_rows()); files = tree(); pres = presence(files, table); yes = load_reviews()
    def wanted(r, t):
        if only and r['row'] not in only: return False
        if r['row'].endswith('P') and not only: return False     # pre-renames run once, named explicitly
        if r['op'] == '!' or r['cls'] == 'P': return False
        cls = derive(r, t, pres)
        if lane == 'C' and kind == 'docs': return True
        if OWNER.get(cls) != lane: return False
        return (cls == 'W') == (kind == 'wire')
    errors = 0; warns = 0; changed = 0
    for f, a, txt in files:
        if a == 'G': continue
        if a == 'D' and not (lane == 'C' and kind == 'docs'): continue
        if a != 'D' and lane == 'C' and kind == 'docs': continue
        web = a == 'Cweb'
        merges = collections.defaultdict(set); before = set(TOK.findall(txt))
        def sub_tok(m):
            t = m.group(0); r = table.match(t)
            if not r or (web and r['cls'] != 'E') or not wanted(r, t): return t
            if r['op'] == '?' and site_key(f, txt, m.start(), t) not in yes: return t
            n = table.new_token(r, t); merges[n].add(t); return n
        out = TOK.sub(sub_tok, txt)
        for r in table.lits:
            if web and r['cls'] != 'E': continue
            if not wanted(r, r['old']): continue
            prev = out
            if r['mode'] == 'lit':
                src = out          # '?' lit rows: keys are computed on the text this row starts from
                def rep(m, r=r, src=src):
                    if r['op'] == '?' and site_key(f, src, m.start(), m.group(0)) not in yes: return m.group(0)
                    return m.group(0).replace(r['old'], r['new'])
                out = lit_re(r['old']).sub(rep, src)
            else:
                out = out.replace(r['old'], r['new'])
            if out != prev: merges[r['new']].add(r['old'])
        for n, olds in merges.items():
            if len(olds) > 1 and not f.endswith('.md'):
                print(f'MERGE {f}: {sorted(olds)} -> {n}'); errors += 1
            elif n in before and n not in olds:
                print(f'WARN {f}: {n} already in the file (from {sorted(olds)}): check it is the same meaning'); warns += 1
        if out != txt:
            changed += 1
            if not dry: open(f, 'w', encoding='utf-8').write(out)
    print(f'{changed} files {"would change" if dry else "changed"}; {errors} merges (fatal); {warns} warnings')
    sys.exit(1 if errors else 0)

if __name__ == '__main__':
    cmd = sys.argv[1]; rest = sys.argv[2:]
    {'count': cmd_count, 'review': cmd_review, 'apply': cmd_apply}[cmd](rest)
```

## 9. Size of each lane at `165a517` (from `count`; step 0 recounts on the W6 base)

Occurrences, not lines. 18 terms, 211 token rows (154 rename or review, 57 keep).

| Lane | Mechanical (applied by the tool) | Review sites (marked Y/N, area owner reviews) | Re-recorded |
|---|---|---|---|
| RENAME-A structural | 962 exact + 2,226 stem compounds (crc-sync, and client mirrors for `S`) | 1,356 in area A (rows N03, N04 `held`, N11 `role`/`Role`, N13, N18 part) | none (golden-identical) |
| RENAME-A wire commit | 8,483 exact + 57 stem (all trees except docs) | (the same review files, `W` rows) | 47,237 golden occurrences, every behaviour golden |
| RENAME-B | 180 exact + 782 stem compounds (CSS classes, DOM ids, client-only names) | 1,260 in area B (it reviews the client sites of A's `?` rows too, §1.1) + UI strings | none |
| RENAME-C | 30 (env keys) + 417 doc tokens | ~830 prose sites in the eight docs of §5.2 | none |

Prose sites in code comments (1,027 counted, the `P` rows) are L20's after the window, not RENAME's.

## 10. Dry run on a copy of `165a517` (what the lanes should expect)

RENAME-PREP applied `apply --lane A --kind structural`, `--lane A --kind wire`, `--lane B --kind structural` and
`--lane C --kind structural` to a scratch copy, with the file moves of §6 done by `mv` plus a specifier rewrite, and
only N18's part-review sites marked Y. Result: 0 MERGE, 16 WARN (all the same meaning: `CA` already drawn by
`atc-scope.js`, prose "handoff" already present, `CRCSYNC_*` next to the `ASACS_*` fallback that R3-35 deletes),
`node --check` clean on every changed JS file, **crc-sync `npm test` 2,031/2,035 and crc-desktop 854/866** (the
crc-desktop count includes the base's TODO). The remaining failures are the traps below; none is a tool bug.

Known traps (each briefing repeats the ones that are its own):

1. **Regex literals and expected messages name Position ids**: `assert.match(msg, /only APP/)`,
   `'AP holds jurisdiction … not SFA'`. The `lit` mode does not touch `/…/` literals or ids inside a sentence. Step 0
   greps `/[^/\n]*\b(TWR|GND|APP)\b[^/\n]*/` in tests and lists them; the W commit fixes them by review.
2. **Module specifiers versus tokens**: `require('./stca')` would become `require('./conflictAlert')` because the
   token `stca` is a wire key (N07). Do the §6 file moves **first**, rewriting the specifiers by path, then run the
   token pass. `carrier/transfers` has no token row at all: only the move renames it.
3. **Spread is not a property**: `{ ...APP }` is an identifier, not a Position value; the tool's `lit` mode skips
   `...X` (fixed during the dry run).
4. **Composite ids** (`'c-TWR'`, `observer-selects-APP`, `combine-GND+CD`, test controller ids) are one token each:
   they come from the N18 `part` review rows, never from `lit`.
5. **Rendered UI text**: client tests assert labels that contain the old words or ids (radar-panel scope list, SFA
   header "only APP gets selects", runway-status board). RENAME-B's UI pass and A's W commit change the assertion with
   the label, in the same commit.
6. **Existing new names**: `runwayStatus` (N14 pre-rename), `AP` as a test radar constant, `BEACON` (already a
   correlation rung name in other files; N17 only changes the strip label). A WARN is read, never silenced.
