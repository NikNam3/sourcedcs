# Vocabulary inventory and FAA-oriented rename map (H96)

Read-only inventory for the RENAME phase (H96: run alone after the structural refactor phases, before L20; wire and
snapshot renames in a separately listed commit; no compatibility, R3-2 clean start). Committed ADRs are never edited
(P4): `docs/adr/*` keep the old words, and this file is the old-to-new key for reading them.

Sources read (fetched with curl, 2026-10-01): FAA JO 7110.65 Ch 2-1, 2-3, 4-3, 5-4 and Appendix A; JO 7210.3 Ch 2-1,
2-2, 2-6, 4-3, 6-1, 10-1, 10-3; the Pilot/Controller Glossary (P/CG) letters A, C, D, E, F, H, O, P, R, S, T; the FAA
TFDM pages. JO 7610.14 Ch 8-1 is cited through `research/control-release.md`. URL roots:
`ATC` = https://www.faa.gov/air_traffic/publications/atpubs/atc_html/ (JO 7110.65),
`FOA` = https://www.faa.gov/air_traffic/publications/atpubs/foa_html/ (JO 7210.3),
`PCG` = https://www.faa.gov/air_traffic/publications/atpubs/pcg_html/ ,
`SO` = https://www.faa.gov/air_traffic/publications/atpubs/so_html/ (JO 7610.14).
Not verified against a primary source: TFDM's internal EFS layout terms (only a secondary search snippet), USAF
DAFMAN 13-204 wording, CV NATOPS. Those claims are marked "unverified".

**Counts** are `grep -rIE <regex> | wc -l` (matching lines) over the tree, excluding `node_modules`, `.git`,
`docs/adr`, `dist` and `package-lock.json`. They include docs/wip, docs/parallel, tests and incidental English, so they
size the job; they are not the exact edit count. Scope letters: **U** UI text, **C** code identifiers, **W** wire
message types/fields, **A** audit (Mutation log) fields, **K** config JSON keys, **E** env vars, **F** file names,
**D** docs (incl. CLAUDE.md, the usage guide, the briefing, `EFSPImplementationGuide.md`).

## 1. Proposed glossary (renames)

Ordered by value. "Old" lists every spelling found for the same idea.

| # | Old term(s) | New term | FAA source | Scope | Count (regex) |
|---|---|---|---|---|---|
| R1 | "seat" (a Position: "holding both seats", "takes the seat"), "station" meaning a Position ("Bays by station", "every station", "the `RANGE` station"), `station-coverage.js` | **Position** (`position-coverage.js`) | JO 7210.3 2-2-3 "each open position"; 6-1-5 / 10-1-1 "Operating Position Designators" (FOA chap2_section_2.html, chap10_section_1.html) | U D F C | seat 30 (`\b[Ss]eats?\b`, minus 8 DCS proto "ejection seat" lines, keep those); station-as-Position ~170; `station-coverage` 32 |
| R2 | "occupied", "occupancy", "unmanned", `isOccupied`, "carrier-slot-occupied" (that one is a stack slot: keep) | **staffed / unstaffed** (`isStaffed`); "occupancy" -> **staffing** | JO 7210.3 2-6-5 "the tower associate (local assist) position must be staffed"; 2-2-3 "open position" | U C D | 512 (`occup(ied|ant|ancy|y)|isOccupied|[Uu]nmanned`; includes runway `occupantFdrId`, which stays) |
| R3 | Position "claim", "hold/held Positions", `setHeldPositions`, `heldBy`, Position "release" (`_release`), "signs into" | **sign on / sign off**; `signedOnPositions`, `signOn()`, `signOff()` | JO 7210.3 2-2-3 "only one certified air traffic controller is signed on and responsible for each open position"; 2-2-6 "signing ... on and off positions" | U C W D | `heldPositions|setHeldPositions` 101; `requestPrimary|_claim|claimed` 71 |
| R4 | "covering", "covering chain", `coveringChain`, "covered by", "covering Position" | **consolidation**: "CD is consolidated at GND"; `coveringChain` -> `consolidation` (map `{CD:'GND'}`), `coveringPositionOf` -> `consolidatedAt` | JO 7210.3 2-2-3 "to include consolidated positions"; 2-6-5 "Consolidating Positions ... consolidated/combined"; Appendix A "combining or decombining positions" (ATC appendix_a.html) | U C K D | 900 (`coveringChain|covering chain|covering Position|coveredBy|...`; inflated by plain "covering") |
| R5 | "hand-over", "handover", `efsp-carrier-handover` (CSS), `CarrierTransfer` (Mutation), `strip.nla.carrierTransfer`, `CARRIER_TRANSFER` | **handoff**; `CarrierHandoff`, `strip.nla.carrierHandoff`, `.efs-carrier-handoff` | P/CG HANDOFF (PCG glossary-h.html); JO 7110.65 5-4-5 (ATC chap5_section_4.html). Navy usage of "handoff" Marshal -> Approach: unverified, but no competing Navy term was found in the tree | U C W A D | hand-over 86; carrierTransfer 167 |
| R6 | STCA, `stca.js`, `alerting.json` key `stca`, scope tag `'STCA'` (`geojson.js:54`) | **Conflict Alert (CA)**: tag `CA`, `conflict-alert.js`, key `conflictAlert` | P/CG CONFLICT ALERT (PCG glossary-c.html). STCA is the ICAO/EUROCONTROL name | U C K F D | 400 (`STCA|stca`), 78 upper-case |
| R7 | EFSP (Electronic Flight Strip Panel), `efsp-*` wire types, `efsp-*.js`, `.efsp-*` CSS, `efsp-*.json` config files, `crc-sync/src/efsp/` | **EFS** (Electronic Flight Strips); `efs-*` | FAA TFDM: "Electronic Flight Data (EFD) exchange and Electronic Flight Strips (EFS) in the tower to replace paper flight strips" (https://www.faa.gov/air_traffic/technology/tfdm/whatistfdm) | all | 16414 (`EFSP|efsp`); `efsp-` 11116 |
| R8 | Strip **Role** (`strip.role`, `holdsRole`, `.efsp-strip-tab-role`, "a `MISSION` Strip Role") | **strip type** (`strip.stripType`, `holdsStripType`). Values unchanged (`DEPARTURE`, `ARRIVAL`, `OVERFLIGHT`, `MISSION`, ...) | JO 7110.65 2-3-4 "Terminal data entries": separate strip layouts for "Arrivals", "Departures", "Overflights" (ATC chap2_section_3.html) | U C W K A D | ~2083 lines touch `role` with a strip value (`strip\.role|holdsRole|\brole:`...); Casdoor/Discord "roles" in sourcedcs-web/atobrief are out of scope |
| R9 | **FDR** (Flight Data Record), `fdr`, `fdrId`, `fdr-store.js`, "FDR fields", `.efsp-shared-fdr-badge` | **flight plan** (FP): `flightPlan`, `fpId`, `flight-plan-store.js`; the DD1801 is the **filed flight plan** | P/CG FLIGHT PLAN (PCG glossary-f.html); ERAM's record of a flight is the flight plan, amended by "flight plan amendments". FAA uses FDR for "Facility Directives Repository" (JO 7210.3 2-2-14) | all | 16076 (`FDR|\bfdr`); `fdrId` 10202 |
| R10 | `Peer` in `PeerCoordinationProposal/Response/Cancel`, `PeerTofiProposal/Response/ExitProposal` | **Interfacility**: `InterfacilityCoordinationProposal`, ... `TofiProposal` (TOFI is interfacility by definition) | JO 7110.65 2-1-14 / 5-4 use "interfacility" and "intrafacility" for coordination and handoffs | C W A D | 351 |
| R11 | `coordination.state: 'PROPOSED'` (a coordination nobody has answered) | **`INITIATED`** (strip `PROPOSED` keeps its name) | JO 7110.65 5-4-5 "while the handoff is being initiated or after acceptance" | C W U D | in the 2945/426 state greps; isolate `coordination.state` |
| R12 | "field state", FIELD STATE panel, `fieldState`, `field-state*.js`, `efsp-field-state-*` wire types | **runway status** (panel RUNWAY STATUS; `runwayStatus`; `efs-runway-status-*`) | JO 7210.3 10-1-6..10-1-8 "Selecting/Use of active runways", "Procedures for opening and closing runways"; P/CG RUNWAY IN USE/ACTIVE RUNWAY | U C W K F D | 2260 |
| R13 | "EFSP State" (Block 25), bare "state" for a Strip | **strip state** (always qualified: strip state, coordination state, departure-release state, runway status) | none (Block 25 is `[SOURCE-DEFINED]`); qualifying is the fix | D U | 7 (`EFSP State|efspState`) |
| R14 | `assigned.releaseState`, "release state(s)", guide §7 "Release states" | **departure release** (`assigned.departureRelease`), "departure-release state" | JO 7110.65 4-3-4 "Departure Release, Hold for Release, Release Times ... Clearance Void Times" (ATC chap4_section_3.html); P/CG HOLD FOR RELEASE, RELEASE TIME, CALL FOR RELEASE | C W U D | 65 |
| R15 | Env `ASACS_DOMAIN`, `ASACS_URL` (compose fallbacks, `.env.example`, `infra/tests`), sourcedcs-web `store.ASACS_URL` and the page global `var ASACS_URL` (`server.js:108`) | **`CRCSYNC_DOMAIN`, `CRCSYNC_URL` only** (R3-35 hard rename: drop the fallbacks) | not FAA: retired product name (R3-35) | E C D | ASACS_DOMAIN 14, ASACS_URL 10 |
| R16 | Env `CRC_SYNC_URL` (`crc-desktop/main.js`) vs `CRCSYNC_URL` (root `.env`, compose, sourcedcs-web) | **`CRCSYNC_URL`** everywhere (one spelling for one idea) | not FAA: consistency | E C D | 12 vs 8 |
| R17 | `squawk` meaning the assigned code (e.g. "squadron squawk map", `squawk` fields) | **beacon code** (`beaconCode`, already used 89x); keep "squawk" for the pilot instruction | P/CG SQUAWK is the instruction; DISCRETE CODE / "Mode 3/A ... codes" is the code (PCG glossary-s.html, -d.html) | C U D | 400 (`\b[Ss]quawk`) |

Bare **"transfer"** and bare **"release"** are banned after the rename (see §4 A3, A4): each must name its object.

## 2. Terms kept as-is

| Term | Why it stays |
|---|---|
| **Position**, Position IDs `OPS CD GND TWR APP CTR RSU SFA PAR` | FAA "operating position" (JO 7210.3 6-1-5, 10-1-1). IDs: see §4 A6. |
| **Facility** (code container `INCIRLIK`, `CENTER`, `CARRIER`, `TACTICAL`, `RANGES`) | FAA term for ATCT/TRACON/ARTCC/RAPCON. One container kind (fewest node kinds). The non-ATC members get a doc note, §4 A7. |
| **Strip**, **Board**, **Block** (Block IDs `1`, `9E`, `25`, `26`) | JO 7110.65 2-3-1 "flight progress strips ... remove the strips from the flight progress boards"; 2-3-2/2-3-4 tables are headed "Block". |
| **Bay** | TFDM EFS term (strips "organized into ... bays", secondary source: Air Traffic Technology International 2021, unverified). See §4 A1 for Rack. |
| **HANDOFF, POINT_OUT, TRAFFIC, OPERATIONAL_REQUEST, AIT** | JO 7110.65 5-4-3..5-4-7, 2-1-18 "Operational Requests", 2-1-21; JO 7210.3 4-3-10 "Automated Information Transfer (AIT)". |
| **TOFI** (Transfer of Flight Information) | JO 7610.14 8-1-7 uses exactly this ("after the Transfer of Flight Information has been accomplished"). |
| **Departure-release values** `HOLD_FOR_RELEASE`, `RELEASE_TIME`, `CLEARANCE_VOID_TIME`, `EDCT`, `CALL_FOR_RELEASE`, the HELD NLA "Release" | JO 7110.65 4-3-4; P/CG entries. Only the container field is renamed (R14). |
| `ReleaseAirspace`, `ReturnAirspace` | JO 7610.14 8-1-1 "Airspace will be released to the MRU", 8-1-11 "Return to ATC facility any portion of ATCAA/SUA". Already qualified by "Airspace". |
| `TransferStrip` (wire/audit name), `TRANSFER_COMMS` | "Transfer" is qualified by its object (strip ownership; communications, cf. P/CG TRANSFER OF COMMUNICATION). See §4 A3. |
| **owner** (`ownerPositionId`, "owns the Strip") | STARS/ERAM track ownership; after H94 "owner" = whoever accepted the handoff, and **control** is the separate FAA concept (2-1-15, P/CG TRANSFER OF CONTROL). Do not merge them. |
| States `PROPOSED`, `PENDING_CLEARANCE`, `CLEARED`, `PUSHBACK`, `TAXI`, `LUAW`, `DEPARTED`, `HANDED_OFF`, `INBOUND`, `HANDED_TO_TOWER`, `FINAL`, `LANDED`, `DROPPED` | FAA-shaped ("proposed flight plan", LUAW = JO 7210.3 10-3-8). `HANDED_OFF` is named after its entry event like `DEPARTED`; it means "handoff accepted" under H94, which is consistent. |
| **NLA** (Next Logical Action), **Mutation**, `actingPositionId`, Undo | No FAA term competes; NLA comes from the TFDM/Raytheon one-touch-action material the guide cites (unverified). `actingPositionId` is in every audit line (5522 lines); renaming it buys nothing. UI should show the action's label, not "NLA". |
| **Primary / Observer** | No FAA standard for a second, non-responsible controller at a position (2-2-3's note: developmental and instructor "both signed on", instructor responsible). Plain English, unambiguous in the code. |
| **Stereo route** | P/CG STEREO ROUTE. |
| **MARSA** | JO 7110.65 2-1-11; P/CG. |
| **QNH / STD**, transition altitude, flight level | Theaters are ICAO airspace (Syria, Caucasus, ...); `config/theaters.json` models ICAO transition altitudes. FAA "altimeter setting" would be wrong outside the US. |
| **NATO/USAF tactical** (MRU side): `TAC_C2`, `AIC`, `GCI`, `JTAC`, mission line, `ON_STATION`/`OFF_STATION`, vul window, ATO, frag, ALERT/SCRAMBLE, bandit/hostile, Mode 4, IFF | Correct in their domain; JO 7610.14 Ch 8 itself says the MRU is not an ATC facility, so FAA ATC vocabulary does not apply there. |
| **Navy carrier**: Marshal, PriFly, Case I/II/III, low state, "See you", Commence, angels, recovery | CV NATOPS doctrine terms (H93 keeps L17 as built). "Low state" is the Navy fuel term (H85 R3-56 still open), not a strip state. |
| **USAF field**: RAPCON, RSU, SFA, PAR, OPS | USAF terms for a USAF base; RAPCON is in P/CG, PAR in JO 7210.3 10-1-1. |
| **CRC** (crc-desktop, crc-sync) | Product name, also the correct USAF/NATO "Control and Reporting Center" for the GCI side. See §4 A8. |
| `asacs.sourcedcs.page` DNS name and the default `wss://asacs...` endpoint | Intentional, a hostname not vocabulary (R3-35 renames env keys only). |
| "hand back" (TOFI exit to `TAC_C2`/ATC) | JO 7610.14 8-1-11 says "return"; "hand back" is the established UI verb and is not ambiguous. |

## 3. Risky renames (separate commit, what each touches)

Clean start (R3-2) means no migration code, but a running server's `crc-sync-state` volume and installed clients must
be reset together; the rename commit needs the release-day note "wipe `state/efsp-*` and ship client + server".

| Rename | Wire | Persisted (snapshot / `state/`) | Audit (Mutation log) / metrics | Config / env / files | Tests and specs |
|---|---|---|---|---|---|
| R7 EFSP -> EFS | every `efsp-*` type (`efsp-mutation`, `-ack`, `-snapshot`, `-board-delta`, `-resync`, `-heartbeat`, `-set-positions`, `-positions-ack`, `-alerts`, and the `-airspace/-ato/-carrier/-correlation/-field-state/-marsa/-sfa` `-mutation/-delta/-ack` families, `efsp-metrics`, `efsp-metrics-report-ack`) | `state/` file names (`efsp-mutations.jsonl`, `efsp-facility-*.json` copies, board snapshot) | `metrics.js:851` matches `msg.type === 'efsp-mutation'` | `crc-sync/config/efsp-*.json` (8 files), `src/efsp/`, `panels/efsp/`, `efsp-*.js` (9 client files plus the server `efsp-ws.js`), `tools/soak` profiles | 84 distinct `.efsp-*` classes in 29 Playwright files; `soak:selfcheck` detectors; golden replay fixtures |
| R9 FDR -> flight plan | `fdrs` snapshot/delta key, `fdrId` on every Strip | Board snapshot `fdrs`, every Strip's `fdrId` | `fdrId` in Mutation payloads (10202 lines), `metrics.js` (2 reads) | `fdr-store.js`; collides with existing `flight-plan-lookup.js` / `efsp-flight-plan-lookup.js` (rename those **filed-plan-lookup**) | `.efsp-shared-fdr-badge`; scenario tests |
| R8 Role -> strip type | `strip.role` in every Strip | snapshot Strips | Mutation payloads carrying `role` (`CreateStrip`, `ConvertToArrival`) | `holdsRole` in `efsp-facility-incirlik.json`, `-center.json`, `facility-config.js` | `.efsp-strip-tab-role` |
| R12 field state -> runway status | `efsp-field-state-mutation/-delta/-ack` | `state/` field-state store file | field-state Mutation kinds keep their names (`OpenRunway`, `BeginRunwayWorks`, ...) | `fieldState` pads in facility config (K), `field-state*.js` (4 files) | field-state Playwright specs |
| R5 CarrierTransfer -> CarrierHandoff | Mutation kind on `efsp-mutation`; `strip.nla.carrierTransfer` | none beyond the log | Mutation `kind` (73 lines) | `efsp-carriers.json` if it names triggers | `.efsp-carrier-handover`, `data-carrier-transfer` |
| R10 Peer* -> Interfacility* | 6 Mutation kinds | none | Mutation `kind` (351 lines); metrics counters keyed by kind | `permission.js` op sets | scenario tests |
| R11 coordination `PROPOSED` -> `INITIATED` | Strip `coordination.state` | snapshot Strips | yes | none | coordination badge specs |
| R3 sign on/off | `efsp-set-positions`, `efsp-positions-ack`, `positions` key | none (Position staffing is ephemeral, guide §4.8.2 rule 5) | none | none | `data-position-id` (27 uses) unaffected |
| R4 consolidation | `coveringChain` if sent in snapshot | `state/efsp-facility-*.json` | none | `coveringChain` key in both shipped facility JSONs + `DEFAULT_CONFIG` (Q3-1: a persisted `state/` copy keeps the old key) | none known |
| R6 STCA -> CA | alert payload kind if it says `stca` | none | none | `alerting.json` key `stca` (and any `state/alerting.json` copy) | label assertions on `STCA` |
| R14 releaseState -> departureRelease | FDR `assigned.releaseState` | snapshot FDRs | `SetBlock` payloads binding it; Block Map `bind` strings (`strip-template.js:91-98`) | `release-envelope.js`, `standingReleases` key | release specs |
| R15/R16 env keys | none | none | none | `.env.example`, `infra/docker-compose.yml` (lines 31-33, 143), `infra/tests/nginx-render.test.js` (asserts the fallback, must flip), `sourcedcs-web/store.js`, `server.js:108`, `crc-desktop/main.js` | the infra test; the server's real `infra/.env` must be edited by hand before the deploy |
| R1 station-coverage.js -> position-coverage.js | none | none | none | file rename, 32 requires/mentions | unit test file name |

`bayId`, `rackId`, `actingPositionId`, `data-bay-id` (22 uses) and `data-position-id` stay, so most Playwright
locators survive.

## 4. Ambiguities and recommendations

**A1 Bay vs Rack.** The project's Board > Bay > Rack: a Bay is a Position's state container, a Rack an ordered column
inside it. A secondary TFDM description has "strip boards that contain ... bays ... composed of different bay
sections", i.e. the FAA's bay may be our Rack. No primary TFDM text was read. **Recommend: keep both words**, put the
definitions in the user guide's glossary verbatim (Bay = a Position's strip area that implies a state; Rack = one
ordered column in a Bay, e.g. the departure sequence for runway 05), and do not rename until someone reads TFDM's EFS
user documentation. Renaming Rack costs ~3100 lines for no proven FAA gain.

**A2 "Position" vs "sector".** JO 7210.3 6-1-2 makes the sector the en route airspace unit, staffed by R and D
positions. Only 35 lines say "sector" (all in comments about overflight). **Recommend: Position for the staffed
role, "sector" only for airspace (CTR's area), never as a synonym.**

**A3 "transfer" (five senses).** Strip ownership move (`TransferStrip`, "transfer-shaped NLA"), carrier hand-over
(`CarrierTransfer`), SFA frequency rotation (`SFA_TRANSFERS`), TOFI and its `TRANSFER_COMMS`, and H94's control
transfer. **Recommend:** R5 removes the carrier one; the others stay but are always written with their object:
"strip transfer" (owner change, `TransferStrip`), "transfer of communications", "transfer of control" (H94, JO
7110.65 2-1-15), "transfer of position responsibility" (sign off with relief, 2-1-24/Appendix A), TOFI. The H94
release lane must name its Mutation `TransferControl`, not reuse `TransferStrip`.

**A4 "release" (five senses).** Departure release (FAA, keep), airspace release (7610.14, keep), Position release
(R3 makes it sign off), H94 control release (FAA has no defined term: JO 7110.65 2-1-15 says control transferred "of
the type and extent" an LOA specifies; ICAO 12.3.5.2 uses "RELEASED FOR CLIMB"), and `standingReleases` (no FAA
term found; it is a departure-release envelope set by LOA). **Recommend:** H94 builds `ControlRelease` with UI verbs
"Release turns / climb / descent / full" and the button label always qualified ("Control release", never bare
"Release", which stays the HELD departure NLA); rename `standingReleases` -> `loaDepartureReleases` only if the
human wants it, otherwise keep and gloss it as "standing departure release (LOA)".

**A5 "hold" (four senses).** Holding a Position (R3 -> signed on), `HELD` departure state, `HOLD_FOR_RELEASE`, and
holding/Marshal stack. **Recommend:** R3 removes the first; the other three are FAA/Navy-correct and stay.

**A6 Position IDs vs FAA designators.** JO 7210.3 10-1-1 designates Local Control `LC`, Ground Control `GC`, Clearance
Delivery `CD`, Flight Data `FD`, Departure Control `DC/DR`. The project uses `TWR`, `GND`, `APP`. **Recommend: keep
the IDs** (they are the radio names a USAF field and DCS pilots use, they key every Bay ID, `data-position-id` and the
audit), and show the FAA position name in the Position picker tooltip ("TWR - Local Control"). Ask the human only if
they want FAA designators on screen.

**A7 Facility for non-ATC units.** `TACTICAL` is an MRU, which JO 7610.14 8-1-1 says is "not [a] commissioned ATC
facilit[y]"; `RANGES` are using/controlling agencies. **Recommend: keep the one code container `Facility`**, and in
UI and docs say "MRU" for TACTICAL and "range control" for RANGES; the glossary notes that Facility is the code's word
for any unit, wider than the FAA's.

**A8 CRC.** In this repo CRC is the client; in USAF/NATO a CRC is a Control and Reporting Center (fits the GCI side),
and VATSIM's FAA-oriented radar client is also called CRC. **Recommend: keep** (renaming `crc-sync`/`crc-desktop`
touches images, workflows, tags, the autoupdate feed and installed clients). Human decision if they want to avoid the
VATSIM clash.

**A9 EFSP -> EFS (R7) and FDR -> flight plan (R9).** Both are the biggest renames (~16k lines each) and both hit wire,
snapshot, audit, file names and specs. EFS is the FAA's own name; "FDR" collides with JO 7210.3 2-2-14 (Facility
Directives Repository) and "flight data recorder". "Flight plan" collides with the DD1801 filed plan already in the
code. **Recommend: do both**, as the last two commits of the RENAME phase (separately listed, per H96), with
`filed` / filed-plan-lookup kept for the DD1801 part; **needs the human's yes** because of the size and because
"flight plan" for a record that also holds strip-independent state is a stretch (TFDM's "flight data" is the
alternative: `flightData`/`fdId`).

**A10 Role (R8).** "Role" also names Casdoor roles, Discord roles (sourcedcs-web) and, in the guide, a Position ("an
operating role a controller signs into"). **Recommend: strip type** for the strip axis; fix the guide's Position
definition to "an operating position".

**A11 Primary/Observer vs FAA.** FAA has one controller "signed on and responsible" per open position (2-2-3).
**Recommend: keep Primary/Observer**, and write "responsible (Primary)" once in the glossary.

**A12 OPS.** USAF renamed Airfield Operations/AMOPS to Airfield Management (unverified, DAFMAN 13-204). **Recommend:
keep `OPS`**; the guide already says "BASOPS / AMOPS".

**A13 Runway status vs field state (R12).** USAF airfield management speaks of "airfield status" (unverified); FAA
orders speak of opening/closing runways and the runway in use. The record holds runway open/closed/works/inspection
and the active runway. **Recommend: runway status** (FAA-backed); if the human prefers the USAF word, "airfield
status" is the fallback.

**A14 handoff states.** `HANDED_OFF` (departure at APP) vs coordination `HANDOFF` vs H94's handoff-accepted. All three
are the same FAA handoff at different moments. **Recommend: keep `HANDED_OFF`**; R11's `INITIATED` and the existing
`ACCEPT` cover the coordination side.

## 5. Old words that stay in committed ADRs

`docs/adr/*` keep: seat, station (as Position), occupied/unmanned, claim/held/release (Position), covering chain,
hand-over, `CarrierTransfer`, STCA, EFSP, Strip Role, FDR, `Peer*`, coordination `PROPOSED`, field state,
`releaseState`, `ASACS_*`, `CRC_SYNC_URL`. Read them through §1. New ADRs written after the RENAME phase use only the
new words; L20's comment sweep lands on the final names (H96 placement).
