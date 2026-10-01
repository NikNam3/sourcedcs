# RENAME-PREP: the W7 RENAME mapping table and briefings (docs only)

## Report

Branch `lane/RENAME-PREP-mapping` from `165a517`. Files: `docs/parallel/refactor/rename-map.md` (the shared table, the
tool, the counts), `RENAME-A.md`, `RENAME-B.md`, `RENAME-C.md`, this file. No code changed; nothing outside these five
files.

- **18 terms** (N01-N18) in **211 token rows** (154 rename/review, 57 keep), every one keyed by token, none by file or
  line. Position ids follow JO 7210.3 TBL 10-1-1 (fetched today): `TWR`→`LC`, `GND`→`GC`, `APP`→`AP`; `CD`, `PAR` are
  already FAA designators; `OPS`, `RSU`, `SFA`, `CTR` (RP-1), tactical and carrier Positions kept.
- **Size at `165a517`** (occurrences): RENAME-A structural ≈3,190 (962 exact + 2,226 stem compounds), RENAME-A wire
  commit ≈8,540 plus 47,237 golden occurrences re-recorded, review sites 1,356 (area A); RENAME-B ≈960 (180 + 782 stem)
  plus 1,260 review sites for A's rows; RENAME-C 30 env + ≈420 doc tokens + ≈830 prose sites. Code-comment prose
  (1,027 sites) is L20's.
- **The tool is in the map** (§8: `count`, `review`, `apply`). Dry run on a copy of `165a517`: 0 MERGE, 16 WARN (all
  the same meaning), crc-sync 2,031/2,035 and crc-desktop 854/866 with only N18's composite-id reviews auto-marked; the
  remaining failures are the six traps listed in map §10, none a tool bug.
- **Questions for the human:** RP-1 (CTR id), RP-2 (flight-data identifiers), RP-3 (APP → AP), RP-4 (rewrite
  `EFSPImplementationGuide.md`), RP-5 (Strip Role → strip type in W7), RP-6 (coordination `PROPOSED` scope). Every
  default is written into the map, so W7 can start without answers.
- **Risks:** (1) the wire commit is huge (≈8,500 edits, every golden re-recorded); the briefing allows a split into
  three. (2) Review volume (≈2,600 sites, mostly N04 `held` and N11 `role`) is the real work; B reviews the client half
  to balance the lanes. (3) Old `state/` directories: no migration; RENAME-A step 5 checks that an old state fails
  loudly and does not half-load. (4) Installed clients' saved dock layout names the `fieldState` panel (RENAME-B step
  4). (5) Prod `infra/.env` must be edited by hand when the ASACS fallback goes (release note; the human deploys).
  (6) Finding F1 below (consolidating GC at LC contradicts JO 7210.3 ¶2-6-5) is doctrine, not a rename.

## Interpretations taken (P2)

- **"The lower-priority list"** in H98 = vocabulary R8 (Strip Role → strip type), R10 (`Peer*` kinds), R11
  (coordination `INITIATED`), R12 (field state → runway status), R13 (qualify "state"), R14 (`releaseState` →
  departure release), R17 (squawk → beacon code). R7 (EFSP → EFS) is out (H98 keeps EFSP); R9 is H98's "flight data",
  not the inventory's "flight plan".
- **R17 is narrow.** The code's `squawk`/`squawkStatus` are the transponder reply from SRS/DCS (the protocol's name),
  and the squadron squawk map was removed (ADR 0059). Only the Block 5/M4 label `SQUAWK` (the assigned code) becomes
  `BEACON` (JO 7110.65 TBL 2-3-2 item 1 "Mode 3/A beacon code").
- **R10 renames only the six Mutation kinds.** `peerStripId`, `peerFacilityId`, `peerPositionId`, `recordPeer` name
  the counterpart and stay.
- **Position long names** ("Local Control", …) go into the glossary and the guide. No label field exists in the code
  today (the UI shows the id), so adding tooltips is a feature after the window, not RENAME.
- **The STARS position letters** (`positionLetters`: `T`, `G`, `A`) stay; they are facility data and can be edited in
  the JSON any time.
- **Ownership is by token, not by file**, with one exception list: `*.md` are always lane C's. That is the only way
  three parallel lanes can share client files without renaming the same token twice. File moves all happen in
  RENAME-A's commit 1, and B and C are cut from it, so the review-file keys agree across lanes.
- **Review keys are `path:line:token#n`.** A rename never adds or removes a line, so a decision survives the other
  rows' commits; only a file move would break it, and the moves come first.
- **Airspace occupancy keeps its word** (DES-AIRSP F2, received during this lane): `occupancyFor`, `_occupancyFor`,
  `occupiedAtRelease`, `AIRSPACE_STILL_OCCUPIED`, `MOA-OCCUPIED` and the "occupied airspace" warning of the ADR 0098
  draft are `!` rows in N03; the bare word goes through review, Position sense only.
- **Wire class is derived, on the safe side.** A token in a behaviour golden is `W`; a token on both sides is `S`; and
  a property step 0 finds in a sent or persisted payload is promoted to `W` even if no golden shows it (N16
  `releaseState` is such a field).

## Questions for the human

Each has a default already applied in `rename-map.md`; the supervisor edits the map if an answer differs.

**RP-1. The Center Position's id.** JO 7210.3 TBL 6-1-1 designates en route positions per sector (`R` Radar
Controller, `D` Sector Controller, `RH` Radar Handoff, …); `CTR` names the facility, and our CENTER has one Position.
(a) **Keep `CTR`** and show "Center (R)" in the glossary and guide. (b) `R`: FAA-exact, but a one-letter id cannot be
renamed or searched safely (`'R'` is also a runway suffix, `RWY_SUFFIX`), and Bay ids would become `r-enroute`.
(c) A sector-style id such as `R1`: FAA-shaped, but it invents a sector numbering nobody uses yet.
**Recommendation (a)**: H98 keeps a project name "where the FAA has none", and the FAA has no single-position id for
a whole center.

**RP-2. How "flight data" is spelled in code.** H98 fixed the word; the identifiers need one singular, one plural and
an id. (a) **`flightData` / `flightDataList` / `flightDataId`** (store `FlightDataStore`, file `flight-data-store.js`,
values `FLIGHT_DATA`): unambiguous, longer. (b) `fd` / `fds` / `fdId`: short like today, but collides with TBL 10-1-1's
`FD` Flight Data position and with file descriptors. (c) `flightDataRecord` / `flightDataRecords` /
`flightDataRecordId`: reads well, but spells out the "FDR" H98 wanted gone. A plural is needed because
`for (const fdr of fdrs)` must not become `for (const flightData of flightData)` (the tool refuses that merge).
**Recommendation (a).**

**RP-3. `APP` → `AP`.** TBL 10-1-1 item 2 is "AP Approach Control"; our APP also works departures (FAA `DC`
Departure Control, consolidated at approach). (a) **`AP`** per H98's "FAA names wherever possible". (b) Keep `APP`
as the radio name pilots use ("Incirlik Approach"), like the kept USAF names. **Recommendation (a)**; note that "AP"
also reads as "autopilot" to pilots, which is why this is asked rather than assumed. If (b), N18's three `APP` rows and
the four `app-*` Bay rows become `!` rows.

**RP-4. `EFSPImplementationGuide.md`.** It is the spec that code comments cite by section (`guide §4.5`), not a
decision record. (a) **Rewrite its vocabulary, keep every section number** (lane C). (b) Leave it as written and add a
banner pointing at `docs/glossary.md`, like an ADR. **Recommendation (a)**: it is still read as the reference, and a
living reference in the old words would undo the rename for every new reader.

**RP-5. Strip Role → strip type (vocabulary R8) in W7.** It is FAA-backed (JO 7110.65 ¶2-3-4 separate arrival,
departure and overflight strips) and inside H98's "lower-priority list", but it is the riskiest row: ≈1,500 review
sites (`role` is also ARIA, Playwright `getByRole`, Casdoor and Discord roles), the `authority/roles/` directory W3
creates, and a wire field on every Strip. (a) **Do it in W7** as its own structural commit plus its share of the wire
commit. (b) Defer it to its own lane after the window, with the glossary noting "Role (strip type)". **Recommendation
(a)**: one more wire break later costs another full golden re-record and client release; the review cost is the same
either way.

**RP-6. Which `PROPOSED` becomes `INITIATED`.** The token is shared by the Strip state (a proposed flight plan, FAA-
correct, stays), the coordination state, the TOFI coordination state and a runway-status change awaiting
acknowledgement. (a) **Coordination and TOFI coordination** (both are an initiated, unanswered handoff, JO 7110.65
¶5-4-5), runway change keeps `PROPOSED`. (b) Coordination only. (c) All three non-Strip uses. **Recommendation (a).**

## Findings (for later lanes, not RENAME)

- **F1. Consolidation order vs JO 7210.3 ¶2-6-5.** ¶2-6-5: "Nonlocal control functions must not be
  consolidated/combined at the local control position except during periods of significantly reduced traffic levels.
  When conducting line up and wait (LUAW) operations, local control position must not be consolidated/combined with any
  other non-local control position." Our chain consolidates `GND` (GC) at `TWR` (LC), and the app has LUAW. The rename
  makes this visible ("GC is consolidated at LC"). Doctrine question for the human after the window; RENAME keeps the
  chain as it is.
- **F2. The README's W7 row** still says "briefing to be written"; it should link `RENAME-A/B/C.md` and
  `rename-map.md` and say "three parallel lanes, B and C cut from A's commit 1, merge A → B → C" (supervisor's edit; not
  in this lane's file list).
- **F3. E2E lanes 5 and 6** are assigned to RENAME-A and RENAME-B in the briefings; the README's E2E list has no lane
  for W7 yet.

## Notes

- FAA sources fetched with curl on 2026-10-01: JO 7210.3 ¶10-1-1 (TBL 10-1-1), ¶6-1-5 (TBL 6-1-1), ¶2-2-3, ¶2-2-6,
  ¶2-6-5; JO 7110.65 ¶2-1-24, Ch 2 Sec 3 (TBL 2-3-2, ¶2-3-4), Ch 4 Sec 3 (¶4-3-4), Ch 5 Sec 4 (¶5-4-1..10), ¶5-13-1,
  ¶5-14-6; P/CG letters C and H (CONFLICT ALERT, HANDOFF); the FAA TFDM page (EFD, EFS). Citations taken from
  `docs/parallel/research/vocabulary.md` without a re-read here: JO 7210.3 ¶10-1-6..10-1-8 (N14), ¶2-2-14 (FDR = Facility
  Directives Repository), JO 7110.65 ¶2-1-14 (interfacility), JO 7610.14 ¶8-1-1 and ¶8-1-7.
- The dry run: copy of `165a517`, the §6 moves by `mv` plus a `sed` over specifiers, review file for N18 part rows
  auto-marked `Y` except `CV_APP`/`CLIENT_APP`, then `apply` A structural, A wire, B structural, C structural. A second
  run that also auto-marked N13 only on lines naming `coordination.state` failed 94 tests, as it should: N13's sites
  include the lines that **build** the coordination record, which a line filter misses. That is why N13 is a review
  row and RENAME-A step 2 spells out its rule.
- Counts are reproducible: on `165a517`, `python3 rename_tool.py count` (copy of map §8) prints the §9 totals.
