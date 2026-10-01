# L20 prep inventory (lane L20PREP)

Branch `lane/L20-prep-inventory`, cut from `efsp-wp5-correlation` at `c12cd7c` (after S-M-wave3a: L26, U6 and L18 client
half merged). Read-only analysis: this file is the only change. Date 2026-10-01.

**Baseline.** L9 audited `cfcf344`. `git log cfcf344..HEAD` is 283 commits, 451 files. Every `file:line` below is verified at
`c12cd7c`. **Not yet merged, so not covered:** L17 (carrier server half), L18 server half (second run after L17), L19, UI-A, any
lane after S-M-wave3a. L20 must re-run the sweep (section 4) on the final tree and add what they bring.

**Still open from L9 (checked at `c12cd7c`, nothing in Groups A, C or D has been fixed by a later lane).** The L9 line numbers have
moved. Current positions, so L20 does not re-grep:

| L9 row | now at | | L9 row | now at |
|---|---|---|---|---|
| A1 | `crc-sync/src/efsp/code-allocator.js:113` | | C13 | `permission.js:430` (+ `:472` "guide-sourced one") |
| A2 | `crc-desktop/.../panels/radar-panel.js:78` | | C14 | `efsp-nla.js:57` (unchanged) |
| A3 | `.../efsp/strip-template.js:370` | | C15 | `efsp-nla.js:42` (`:102` not re-checked) |
| C1 | `crc-sync/config/alerting.json:2` | | C16 | `nla.js:75` |
| C4 | `code-allocator.js:8, :23` | | D1 | `board-store.js:14` |
| C5 | `surveillance/transponder.js:12` | | D2 | `board-store.js:808, :1223`; `efsp-panel.js:823` (D5 is the same line) |
| C6 | `conformance.js:3` | | D4 | `board-store.js:2388` |
| C7 | `stca.js:3` | | D6 | `bay-view.js:1586` |
| C8 | `surveillance/presentation.js:3` | | D7 | `station-coverage.js:32` (the "collision avoidance" wording is gone from the comment, re-read the lines around `:30`) |
| C9 | `surveillance/iff.js:1-12` (header has no marker; L10 has landed, ADR 0066/0084, so add it now) | | D8 | `airspace-config.js:34, :50` |
| C10 | `station-coverage.js:3` | | D9 | `surveillance/datalink.js:8` |
| C11 | `release-envelope.js:3` | | D10 | `nla.js:66`, `permission.js:487` (the "OVERFLIGHT has no guide-published" text) |
| C12 | `airspace-store.js:209` | | F72/E6 | `efsp/index.js:22`, `forwarding-obligations.js:22-25` (settled: DCO, no action) |

Group B (usage guide, 18 rows): L20 drafts replacement text in `docs/wip/L20.md`; the integrator folds it in (P3, Q7). Line
numbers in B shifted too (for example B3 is now `docs/efsp-usage-guide.md:321`, B7 `:652`). The E answers are on record:
E1-E3, E8 = (a) (H61), E4 = H62 (Syria 10,000 ft, so **B12 and C3 wording changes**: see section 1.3), E5 = errata row in ADR 0077,
E6 = parent-section citation counts, E7 = (a), E9 = yes.

---

## 1. New since L9: markers and unsourced values

### 1.1 `[SOURCE-DEFINED]` markers added or touched after `cfcf344` (73 lines, found by `git blame` on every current marker)

All are marked already. Default treatment is **keep**; the right column says where something is wrong or needs a follow-up.

| Lane | file:line (value) | Treatment |
|---|---|---|
| L1/L1b | `field-state.js:208` (inhibit wordings, Q40), `:226` (closed runway also inhibits), `:407` (hung-ordnance basis), `:428` (one sentence per fact); `field-state-rules.js:191` (gear counted per pavement, either end) | keep |
| L1b/L1 | `facility-config.js:203` ("every value below is squadron data": Incirlik headings 056/236, `LTAG`, acknowledgers `OPS/APP`, inspection authority `OPS`, pad names "Hot cargo pad"/"Alert pad", gear `[]`), `:231` (`accessRoute: 'ALERT ACCESS TAXIWAY'`, ADR 0070) | keep; squadron to verify the data (L1 wip), not an L20 change |
| L12 | `ordnance-advisory.js:5, :75, :92`; mirrored sentences `field-state.js:431-432` and `ordnance-advisory.js:78-79` | keep; mirror pair changes together |
| L13 | `alert-scramble.js:27` (GROUND_STATES); client mirror `scramble.js` | keep; "SOURCE practice" strings in 1.2 |
| L2 | `strip-fields.js:149` (MTR Positions, H24), `:194`; `zulu-time.js:15` (nearest occurrence within ±12 h) | keep |
| L16 | `time-chains.js:30` (server `efsp/time-chains.js:30` and client mirror), ADR 0073 | keep |
| L3/L14 | `ato/ato-board.js:19, :31, :35`; `ato-ingest.js:17`; `ato-mapping.js:281` (any alert value = ALERT); `ato-sets.js:15, :42, :247 (walk-back 3 fields), :449`; `ato-structure.js:16`; `callsign-fit.js:8` | keep |
| L4 | `carrier/flight-record.js:25, :36-39, :76` (approach types, button 1..20, fuel 100000 lb); `marshal-stack.js:30, :48-49, :56, :59` (maxIndex 19, Case I 2..20, radial tolerance 15 deg); `recovery-case.js:14, :36` (default Case III); `ship-state.js:24, :39-40, :42` (9 deg deck, altimeter 27.00-32.00); `transfers.js:26-27, :87-88, :131` (APP lane parity) | keep; see U11 for the two unmarked neighbours |
| L5/L15 | `efsp-metrics-client.js:36, :182`; `metrics-panel.js:43-45, :97`; `traffic-count.js:12, :59, :117` | keep; the metrics panel notes ship as visible text with the literal `[SOURCE-DEFINED]` prefix (intended, ADR 0072) |
| L18 client | `final-panel.js:26-27` (glidepath 0.3 deg, trend step 0.1 deg); `pattern-board.js:28-29` (10 min, more than 1 on the last leg) | keep (S-L18); see U10 for the unmarked 4 s |
| L22 | `facility-config.js:89, :251` (`positionLetters`, ADR 0088) | keep |
| L23 | `permission.js:306` (TACTICAL capability table) | keep |
| L27/L6 | `board-store.js:42` (10 min replay window) | keep |
| L10 | `iff.js:40` (Mode 3/C = neutral); `radars.js:82` (tuning read once, P5) | keep; C9 header marker still to add |
| F1/F2 | `crc-sync/config/theaters.json:2`; `crc-sync/config/sensor-specs.json:2` | keep theaters; amend sensor-specs (U2) |
| L11 | `atobrief/public/js/usmtf-ato.js:26-32` (MSNACFT 11 fields, ARINFO 16 positions, `DEFAULTS` EXER/`SOURCEDCS AOC`/`SOURCE DCS`/`US`/`F`, `:45-49`) | keep |

### 1.2 Wording that is "SOURCE practice" (a convention, not a tag): one family, keep, but mirrored pairs must change together

`field-state-panel.js:152`, `field-state-rules.js:205` ("Hook required: no arresting gear is rigged ... (SOURCE practice)"),
`ordnance-advisory.js:78-79`, `field-state.js:431-432`, `scramble.js:121, :130`, `alert-scramble.js:18`. Treatment: keep the phrase;
B18's usage-guide section says once what "SOURCE practice" means. Tests assert some of these strings: grep `crc-sync/tests` and
`crc-desktop/tests` before changing any.

### 1.3 Unmarked or under-sourced values (U-rows)

Severity as in L9 (S1 = shown to a controller as if sourced, S2 = config/tuning, S3 = code comment).

| # | file:line | Value / wording | Why | Treatment | Sev |
|---|---|---|---|---|---|
| U1 | `crc-sync/config/efsp-instrumentation.json:2` and `src/efsp/instrumentation-config.js:6-9` | retention 30 / 30 / 400 days, `homeAirports: {INCIRLIK: [LTAG]}` | the note says "SOURCE policy choices, not doctrine" without the literal token; the guide (D-6 `:1442`) says retention is not a requirement; 400 days appears nowhere in the guide | add the literal token (C1 style); cite guide D-6 and ADR 0065; no tuning change (already a tuning file) | S2 |
| U2 | `crc-sync/config/sensor-specs.json:2` | the new `presentation` section (airport/approach/carrierApproach = ATC, awacs/fighter/carrier = TACTICAL, ADR 0088) | the `_comment` describes `radar`, `datalink`, `transponder` and says "every figure"; it never mentions `presentation`, which is a SOURCE classification, not a figure | extend the `_comment`: "`presentation`: which scheme (ATC/TACTICAL) draws a contact a radar kind sees; [SOURCE-DEFINED], docs/adr/0088". Config comment only | S2 |
| U3 | `crc-sync/src/efsp/field-state.js:283-300` (`activeEndIntoWind`), `field-state-store.js:672-690` | wind picks the end with the largest headwind; ties and calm go to the first end (05) | unmarked rule (H22, L1's tie default) | add `// [SOURCE-DEFINED] (decisions H22, S-L1d)`; keep | S3 |
| U4 | `crc-sync/src/efsp/fdr-store.js:300-301` | `BLOCK_FL_FROM_FT = 18000`: block text writes FL at or above 18,000 ft whatever the theater | ADR 0091 says fixed on purpose, but Syria's transition altitude is 10,000 (H62), so `FL100-FL120` renders as `10000-12000`; the code carries no marker | add `[SOURCE-DEFINED] (docs/adr/0091)`; the behaviour question goes to the supervisor (section 5, D-2) | S3 |
| U5 | `theater-context.js:21` (`DEFAULT_TRANSITION_ALT_FT`), `altimetry.js:30-33`, `surveillance/index.js:35`, `aprt-panel.js:119, :141, :483`, `track-label.js:102`, `strip-view.js:367`, `app.js:159` | fallback 18000 ft | after H62 the fallback differs from Syria's value; comments say "the theater's" but not that these are only fallbacks | comment each as a fallback for "no `theater` message yet" with `[SOURCE-DEFINED]` (F2 already marks the theater table). No value changes | S3 |
| U6 | `docs/efsp-usage-guide.md` (B12, around `:789-790`) | "18,000 ft shipped" | stale after H62 | wording in `docs/wip/L20.md`: "a per-theater setting in `config/theaters.json`; Syria 10,000 ft (squadron decision), every other theater 18,000 ft [SOURCE-DEFINED]" | S1 |
| U7 | `crc-desktop/app/public/js/panels/efsp/efsp-metrics-client.js:27-33` | `FLUSH_MS` 10 s, `FLUSH_AT` 20, `QUEUE_CAP` 500, `MAX_AGE_MS` 5 min, `TTF_CAP_MS` 10 min, `VISIBILITY_CHECK_MS` 1 s | unmarked client constants. `TTF_CAP_MS` changes what a metric means ("a Bay left ... 10 min is not counted") and is in the visible note at `metrics-panel.js:44` | one `// [SOURCE-DEFINED] (docs/adr/0072)` above the frozen object; the rest is engineering, say so | S3 |
| U8 | `crc-sync/src/efsp/metrics.js:50-72` | targets `TIME_TO_FIND_TARGET_MS` 3000, `CORRELATION_TARGET` 0.95, `TRANSFER_FAILURE_TARGET` 0.005 are cited (guide `:1226, :1228, :1197`); caps (500, 100, 50, 5000, 1000, 720 h) | caps are engineering bounds | keep; add one line "caps are engineering bounds, targets are the guide's" | S3 |
| U9 | `crc-desktop/.../atc-scope.js:50-53` (blink 5 s, time-share 2 s, coast 2 sweeps / 6 s fallback), `geojson.js:107` (`ATC_MAX_SEGMENTS = 16`), palettes `:34-45`, `surveillance/presentation.js:48` (`SCHEME_HOLD_SWEEPS = 2`) | the mockup's values, approved as H41/H71; the BLACK palette is cited (FAA TC-08/15, `research/stars.md` row HF08) | cite, do not tag as doctrine: the MAP palette is a softened "variant B" of ours | add `// [SOURCE-DEFINED] (docs/adr/0088, H41/H71)` above the constants; `ATC_MAX_SEGMENTS` gets a reason or is deleted if unused | S3 |
| U10 | `final-panel.js:23` (`FINAL_PROMPT_HOLD_S = 4`) | the lane's wip says all thresholds are marked; line 23 has no marker (22 cites guide 7.10, 26-27 are marked) | add `// [SOURCE-DEFINED]` | S3 |
| U11 | `carrier/flight-record.js:40` (`BINGO_FIELD_MAX_LEN = 32`); `ship-state.js:24-26` header mentions "the 1 deg re-broadcast step" but no such constant exists in `carrier/*.js` | one unmarked limit; one header sentence that describes code that is not there | mark the 32; **re-check at merge**: L17 may add the step. If it did not, delete the sentence | S3 |
| U12 | `crc-sync/src/mission-session.js:35, :39, :43` | clock step back 5 min opens a new session, last-at persisted every 60 s, step/load adoption window 2 min | unmarked. Policy (what counts as a new mission) rather than engineering | `// [SOURCE-DEFINED] (docs/adr/0086)` above `CLOCK_STEP_BACK_MS` and `CLOCK_ROLL_ADOPT_MS`; `LAST_AT_PERSIST_MS` is engineering | S3 |
| U13 | `crc-sync/src/efsp/archiver.js:25` | 2 h, "H36: ... A decision, not tuning" | decided by the human, not tagged | `// [SOURCE-DEFINED] (H36, docs/adr/0082)`; keep a constant | S3 |
| U14 | `crc-sync/src/efsp/order-key.js:160` (`REBALANCE_KEY_LENGTH = 40`), `crc-sync/tools/soak/report.js:12-22` (`THRESHOLDS`: 1.0 MB/h, 25 % (H72), key length 40, 50 % code pool, p99 50/200 ms, ring 2000, applied 5000) | S-L27 names the 40 as `[SOURCE-DEFINED]`; the soak numbers are the harness's own judgement | tag the 40 in `order-key.js` ("engineering threshold, chosen well below exhaustion; `report.js` mirrors it"); tag the harness block as "soak pass/fail thresholds, SOURCE's own, guide §7.9 200 ms excepted" | S3 |
| U15 | `crc-desktop/app/public/js/track-label.js:198` | "(7110.65 §5-14-4d)" for the assigned-altitude trend arrow | the paragraph is cited only in `docs/parallel/research/stars.md`, not in the guide or Annex | rewrite as "(STARS trend arrow; `docs/parallel/research/stars.md` [65 §5-14-4d])" so the claim names where it was read | S3 |
| U16 | `tools/miztoyaml/build_doc.py:47-58` (`TANKER_AR_SYSTEM`) | KC-135/KC-10 = BOOM, KC135MPRS/KC-130/KC130J/S-3B/IL-78M = DROGUE | called "a fact of the airframe"; true, but unsourced in the repo, and keyed by DCS type names | add "(DCS module facts, not from the guide)"; keep | S3 |
| U17 | `crc-sync/src/efsp/marsa-store.js:37-41`, `desktop .../marsa-badge.js:88` | "forwarding-obligations.js's fire-and-forget alert, which cannot retract" | stale since L7 (an obligation now clears when its condition clears, H39) | rewrite as history ("before L7") or delete; see checklist C-3 | S3 |
| U18 | `crc-sync/src/efsp/correlation-reconciler.js:44-52` | "A test holds every state in nla.js's STATES_BY_ROLE to being either listed here or eligible" | the test (`efsp-correlation-reconciler.test.mjs:86-95`) only checks that every listed state is a real state; a new state that is silently eligible is not caught (S-L4 finding) | either strengthen the test (a code change, so say so and let the supervisor decide) or reword to what is tested | S3 |

Checked, **not** findings: `carrier/marshal-stack.js:50-54` (6, 15, 60 s, 10 s, Case I 2 deg) are guide §9.12 "binding"; `metrics.js`
targets cited above; `usmtf-tokenize.js` limits and the dedupe caps (`replay-cache.js:16`, `efsp-ws.js:974`) are engineering;
`ship-state.js:34-35` are unit constants; `magnetic.js:47-50` are WGS84/WMM constants; `theaters.json` offsets and the table (F2
marks them); `radars.js` figures (E2 = keep).

---

## 2. Collected "goes to L20" items (decisions.md and lane wips)

Owner file = the file L20 edits. "Draft" = L20 writes text in `docs/wip/L20.md`; the integrator folds it into the shared doc.

| # | Source | Item | Owner file(s) | Action |
|---|---|---|---|---|
| C-1 | S-L15 | `HIGHLIGHT_SWATCHES` comment claims the swatch "satisfies the one-input cost ceiling even though it's a popover"; HIGHLIGHT costs 2 (right-click + swatch) and OFFSET 2, §7.3's ceiling is 1 | `crc-desktop/app/public/js/panels/efsp/bay-view.js:2166-2172` | rewrite: "costs 2 inputs against §7.3's ceiling of 1; accepted for now (S-L15), one-input entry points are a later UI lane". Also note on `efsp-metrics-client.js`'s `GESTURE_INPUT_COST` rows. Comment only. |
| C-2 | S-L14 (L14 wip `:136-138`) | double 6xxx warning (L3's `MODE3_SYNTHETIC` plus L14's `MODE3_NOT_ADOPTED`) and `rev` bump on an unchanged re-import (the `atoRef` changes), both cosmetic | `crc-sync/src/efsp/ato/ato-board.js` and `ato-mapping.js` (warnings), `ato-import.js` (preview text); `fdr-store.js` `applyAtoTasking()` (rev) | Warning: merge into one line in the preview, or suppress `MODE3_SYNTHETIC` when `MODE3_NOT_ADOPTED` is raised for the same line. `rev`: skip the write when the incoming `atoRef` content is equal (or document "harmless"). These two **change behaviour**, so they need their own tests; ask the supervisor whether L20 may (D-3) |
| C-3 | S-L7 | stale comment `marsa-store.js:37-41` ("obligation alerts cannot retract"); also `marsa-badge.js:88`, `efsp-state.js:187` area | `marsa-store.js`, `marsa-badge.js` | rewrite as history |
| C-4 | S-F2 (4) | stale `theater-settings.js` mentions in `src/efsp/` comments: `facility-config.js:5, :43`, `efsp-ws.js:6`, `mutation-log.js:5, :41`, `state-paths.js:15` (that one is already "since removed", keep), `theater-context.js:14-16` (correct, keep) | those files | replace with "formerly theater-settings.js (removed, ADR 0085)" or name `theaters.json` / `aptConfigSet`; comments only. Also the ADRs `0048:14` and `0079:80-85` still describe `theater-settings.js`: **not edited (P4)**; one errata row each in ADR 0077 |
| C-5 | S-L27 | rebalance threshold 40 is `[SOURCE-DEFINED]` | `order-key.js:160`, `tools/soak/report.js:16` | = U14 |
| C-6 | S-L26 | `soak:selfcheck` fails `drop-broadcast` at the base commit (silentStaleness 0, expected >= 1; `docs/wip/L26.md:47`), contradicting CLAUDE.md's "proves every detector fires" | `CLAUDE.md` (Commands section, line 43, and the paragraph at ~48), `docs/efsp-briefing.md` | CLAUDE.md is a shared doc (rule 3): draft the rewording in `docs/wip/L20.md`; text: "`soak:selfcheck` runs every detector against a seeded fault; `drop-broadcast` currently fails (known, owned by the soak owner), the rest pass". Optionally fix the detector (`tools/soak/selfcheck.mjs`), which is a code change and so a supervisor decision (D-4) |
| C-7 | L23 wip `:99` | `permission.js` module header still says "no coordination primitives are built" (stale since WP4A) | `crc-sync/src/efsp/permission.js:21-30` ("Phase 1 had only ... HANDOFF/POINT_OUT/TOFI aren't even in the Mutation op union yet") | rewrite the header paragraph to the present: coordination primitives exist (guide §4.6, `coordination.js`), HANDOFF/POINT_OUT/TOFI are ops, MRU Positions exist (TAC_C2 etc., ADR 0080 capability table). Also `permission.js:472` "guide-sourced one" (C13) |
| C-8 | S-L4 | (a) ADR 0042 names `crc-sync/config/radar-specs.json`, but the file is `sensor-specs.json` (`docs/adr/0042` lines 24 and 48; `crc-desktop/app/data/aircraft-types.json:2` also mentions the old name); (b) the untested `correlation-reconciler.js:50-52` claim | ADR 0077 (errata row for 0042); `aircraft-types.json` `_comment`; `correlation-reconciler.js` | = U18 for (b); (a): errata row (P4), and fix the JSON comment |
| C-9 | S-L1d / L1 wip | Incirlik's true headings 056/236 and the other shipped field data (airportIcao `LTAG`, acknowledgers, inspection authority, pad names, gear `[]`) | `facility-config.js:203-236` | marked already (section 1.1); only "squadron to verify" remains. List them in B18 |
| C-10 | L1b wip `:166` | `[SOURCE-DEFINED]` choices: pavement-wide gear counting, the Q5 state set, "works in progress", the label set | `field-state-rules.js:191` (marked), `field-state.js:208` (marked), `field-state-panel.js` labels | verify each is tagged: gear counting yes (`:191`), "works in progress" yes (`:208`), state set (`RUNWAY_GATED_STATES`, `field-state.js:200-204`) **not tagged**, label set (button labels CLOSE/OPEN/WORKS/WRK DONE/... in `field-state-rules.js:353`-area) **not tagged**. Add one marker each |
| C-11 | L12 wip `:149` | listed every `[SOURCE-DEFINED]` string added | `field-state.js:450-452`-area, `ordnance-advisory.js:78-80, :95`, chip `HUNG` | marked in code (1.1); `ordnance-advisory.js:95` ("The hot cargo pad is shown when field state is available.") has no marker of its own: it is covered by `:92` |
| C-12 | L13 wip `:123` | `facility-config.js:230` accessRoute; `alert-scramble.js:27-35`; `scramble.js:121, :130` | those | marked; keep |
| C-13 | S-L26 | `crc-desktop` can drop its owners-table fallback now that `runwayChangeAcknowledgers` / `inspectionAuthorityPositionId` are on the wire | `crc-desktop/app/public/js/panels/efsp/field-state-rules.js` | **owner is UI-A, not L20** (a code change). Listed so it is not lost; L20 only makes sure the comment above the fallback says "fallback" |
| C-14 | S-L9 | `_comment` loader check, iff.js marker after L10 | `facility-config.js`, `iff.js` | see section 3 step 2; the check is done here: `_loadOne()` (`facility-config.js:501-519`) spreads the whole on-disk object into the config (`{...defaults, ...onDisk}`) and `validateConfig` ignores unknown keys, so a `_comment` **would be accepted but then ride into the config snapshot and `_persist`**. C2/C3 therefore go **next to the loader as code comments**, not as `_comment` keys, for `efsp-facility-*.json`. `theaters.json`, `sensor-specs.json`, `alerting.json`, `efsp-instrumentation.json` already carry `_comment`/`_note` and their loaders ignore it. For `transitionAltFt` (C3) the file `theater-settings.json` no longer exists: the note is already in `theaters.json:2` (H62), so C3 is **done by F2**. |
| C-15 | L9 | A1-A3, B1-B18, C1-C16, D1-D10, E5 (errata for ADR 0033:21) | see L9 report | apply, with the changes in this table (B12/C3 reworded, C9 now actionable, D7 re-read) |

---

## 3. Draft briefing: L20, `[SOURCE-DEFINED]` audit, fixes (ADR 0077)

**Lane L20.** Last lane. Worktree `/home/nklx/dev/personal/sourcedcs-L20`, branch `lane/L20-source-defined`, cut from the
integration branch after **every** other lane (including L17, L18 server half, L19, UI-A and anything else) has merged. ADR `0077`.
No e2e lane (`E2E_LANE` unset). Follow `docs/parallel/lane-rules.md`.

### Scope

Make the SOURCE-DEFINED rule (EFSPImplementationGuide.md §13, "no invented doctrine"; defect D11) true of the merged tree:
every number, threshold, state name, label and sentence that is SOURCE's own is either marked `[SOURCE-DEFINED]`, cited to a
guide/Annex clause, or moved into a tuning file, and nothing in a rendered string or comment presents SOURCE's choice, or an
unsourced real-world claim, as doctrine.

In scope:
1. L9's rows A1-A3, C1-C16, D1-D10 in `docs/wip/L9-source-defined-inventory.md`, with the current positions in this file's
   table at the top, plus the F45 mis-citation (`docs/efsp-usage-guide.md:99`, draft only).
2. Section 1.3 U-rows and section 2 checklist of this file.
3. **Everything added after this prep**: re-run the sweep (below) on the final tree and classify new hits as L9 did.
4. Usage-guide text (L9 Group B, B1-B18, with B12 reworded for H62) and CLAUDE.md/briefing rewordings: **drafted** in
   `docs/wip/L20.md` under "Usage guide" and "Shared docs", never edited (P3, Q7). The integrator folds them in.
5. ADR `0077`: the errata ADR. One table row per correction to an earlier ADR: `0033:21` (E5: "GND and CD are not radar positions
   in any facility, real or simulated" is the squadron's model), `0042` (names `radar-specs.json`; the file is
   `sensor-specs.json`), `0048:14` and `0079:80-85` (describe the removed `theater-settings.js`, see ADR 0085), and any other ADR
   statement the sweep finds. ADRs are never edited (P4); no "Update" appended to an old one.

Out of scope (record, do not do): any change of behaviour or value (the shipped figures stay: E1-E3, E8 are "keep, labelled",
H61); moving a constant into a new tuning file unless this briefing's checklist says so; the client owners-table fallback (UI-A);
building a theater table for FL-text switching (D-2); anything in `tests/helpers/efsp-scenario.mjs` (append-only).

### Acceptance

1. `git grep -n "SOURCE-DEFINED" -- crc-sync/src crc-sync/config crc-desktop/app atobrief tools` count is at least the count at
   start, and every row of L9 Groups C and D and this file's U-rows has been applied or has a one-line "kept because" in
   `docs/wip/L20.md`. A row-by-row table in `docs/wip/L20.md` (row id, before, after, commit) is the evidence.
2. No rendered UI string and no server reason string contains "doctrine", "FAA", "real-world" or "reserved for uncontrolled"
   unless it cites a guide/Annex clause (re-run the L9 grep set, section 4). A1's `detail` changes; D2/D3/D5 say "lifecycle check".
3. No behaviour change: crc-sync `npm test` and crc-desktop `npm test` have the **same pass/fail counts** as before the lane, except
   tests that assert a reworded string (update them in the same commit, list them in the wip). Baselines known at `c12cd7c`:
   crc-sync 1862 pass / 0 fail (L26 report, may have moved), crc-desktop 734 of 735 (the one failure is the packaging test needing
   `app/node_modules`, install it first). Record the real baseline in the first commit.
4. `npm run soak:selfcheck` is unchanged by this lane (comments only in `board-store.js`, `ws-hub.js`, `efsp-ws.js`).
5. No `// [SOURCE-DEFINED]` marker precedes a line it does not describe; every marker uses the house style
   `// [SOURCE-DEFINED] (docs/adr/00NN) — <what is ours>.` (or the JSON `_comment`/`_note` equivalent).
6. `docs/wip/L20.md` holds: the row table, the drafted usage-guide text (B1-B18), the drafted CLAUDE.md/briefing rewording (C-6),
   the "What is ours and what is sourced" section (B18, E9), defaults taken, and findings for other lanes.

### Shared-file rules

- L20 runs alone (nothing else is running), but it touches many files. **Comments, strings and `_comment` keys only.** A diff that
  changes executable code (other than a string literal) is a bug unless the checklist names it (D-3, D-4).
- **Mirrored pairs change together**, in one commit, and the drift tests must pass: `field-state.js` / `field-state-rules.js` /
  `ordnance-advisory.js`; `alert-scramble.js` / `scramble.js`; `nla.js` / `efsp-nla.js`; `permission.js` / `efsp-nla.js`;
  `block-map.js` / `strip-template.js`; `time-chains.js` server and client.
- `crc-sync/config/*.json`: edit `_comment`/`_note` only; tuning files stay read-once (P5). **Do not add `_comment` keys to
  `efsp-facility-*.json`** (C-14: the loader spreads them into the persisted config). Put the note in `facility-config.js` beside
  `DEFAULT_CONFIG`.
- Test files: edit only to follow a reworded string. `tests/helpers/efsp-scenario.mjs` is append-only (S-Q3).
- `docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`, `CLAUDE.md`, READMEs: not edited (rule 3). ADRs: not edited (P4), only the
  new ADR `0077`.
- `docs/efsp-parallel-plan.md` and `docs/parallel/*` are the supervisor's.
- Commit every green step; one commit per L9 group (A, C, D, U, ADR, wip), trailer `Co-Authored-By: Claude Sonnet 5.5
  <noreply@anthropic.com>` (as the supervisor's reminder says; rule 4 still shows the old name).

### Steps

1. Install and baseline: `(cd crc-sync && npm ci) && (cd crc-desktop && npm ci) && (cd crc-desktop/app && npm ci)`; run both unit
   suites; write the counts into `docs/wip/L20.md`. Read `docs/parallel/decisions.md` (it overrides this briefing), L9's report and
   this prep file.
2. **Re-sweep the final tree** (section 4 commands). Diff the marker list and the U-rows against this file; classify every new hit
   (PAD / USD / OKM / DCO / GH, severity as in L9). Lanes known to be missing from this prep: L17, L18 server half, L19, UI-A.
   Add their rows to `docs/wip/L20.md`.
3. Group A (strings): A1 (`code-allocator.js:113`: `"reserved for AI aircraft (crc-sync's synthetic block 6000–6777)"`), A2 (radar-panel
   title), A3 (no change, latent, E8). Update the tests that assert `reserved for uncontrolled traffic`.
4. Group C (add markers) and Group D (reword), using the table at the top for positions. C2 goes in `facility-config.js`, not in the
   JSON (C-14). C3 is already covered by `theaters.json:2`. C9 now: add the marker to `iff.js`'s header (ADR 0066, 0084).
5. U-rows (1.3) and checklist C-1, C-3, C-4, C-7, C-8, C-10 (comment work). C-2 and C-6's detector fix only if the supervisor
   answered D-3 / D-4 yes.
6. ADR `0077`: context (D11 / §13), the decisions (marker house style, "SOURCE practice" wording, "mirrored pairs"), and the errata
   table (`0033:21`, `0042`, `0048:14`, `0079:80-85`, plus sweep finds). Take only the number 0077.
7. `docs/wip/L20.md`: row table, drafted Group B text (B12 on H62: 10,000 ft Syria, 18,000 ft elsewhere), B18 section, CLAUDE.md
   `soak:selfcheck` rewording, defaults taken, findings (for example the U4 behaviour question).
8. Run both unit suites; compare with the baseline; `git diff --stat` must show no executable-code change beyond the D-3/D-4
   exceptions (`git diff -U0 | grep '^[-+]' | grep -v '^[-+]\s*\(//\|\*\|/\*\)'` is the quick check). Final message per lane-rules item 8.

### Defaults if unanswered (P2)

D-1 keep all shipped figures (H61). D-2 leave `BLOCK_FL_FROM_FT` fixed at 18000, mark it, and record the Syria consequence in the wip. D-3 do
not change behaviour for C-2 (leave the double warning and the `rev` bump, record "harmless, cosmetic"). D-4 reword CLAUDE.md only.

---

## 4. Re-sweep commands for L20 (run from the lane worktree root)

```bash
# markers added or touched since L9's tree, by blame (73 at c12cd7c)
git rev-list cfcf344..HEAD > /tmp/new.txt   # use the scratchpad
git grep -n "SOURCE-DEFINED" -- crc-sync/src crc-sync/config crc-sync/data crc-desktop/app atobrief tools ':!*node_modules*' |
 while IFS=: read f n rest; do c=$(git blame -L $n,$n --porcelain HEAD -- "$f" | head -1 | cut -d' ' -f1);
   grep -q "^$c" /tmp/new.txt && echo "$f:$n:$rest"; done
# unmarked numbers (uppercase numeric constants and *Ms/*Ft/*Nm/*Deg/*Max fields added since L9)
git diff -U0 cfcf344 HEAD -- crc-sync/src crc-sync/config crc-desktop/app/public tools/miztoyaml | grep -E '^\+(export )?(const|let) [A-Z][A-Z0-9_]+ *= *[-0-9(]'
# overclaim wording in added lines
git diff -U0 cfcf344 HEAD -- crc-sync/src crc-sync/config crc-desktop/app/public | grep -iE '^\+.*(doctrin|real[- ]world|\bFAA\b|7110|in practice|standard practice|typically|commonly)'
# L9's own grep set (its "Commands used" block) on the final tree
# the hard-coded transition altitude and stale theater-settings mentions
git grep -n "18000\|18,000\|theater-settings" -- crc-sync/src crc-desktop/app/public ':!*node_modules*'
```

Three greps that came back **empty** at `c12cd7c` and so need no rewording: "collision avoidance" in `station-coverage.js` (D7's exact
phrase moved or was reworded, still re-read `:28-33`), "no scope in any real facility" (now only in ADR 0033), "Our own choices"
beyond `alerting.json`.

---

## 5. For the supervisor

Questions (defaults taken above if unanswered, P2):

- **D-1** none needed (H61 settled the L9 E-items).
- **D-2** `fdr-store.js` writes block text with FL at or above 18,000 ft for every theater (ADR 0091 says fixed on purpose). In Syria
  (TA 10,000, H62) `FL100-FL120` becomes `10000-12000`. Default: keep, mark, document. Alternative: a later lane passes the theater
  context into `fdr-store.js` (it has none today).
- **D-3** may L20 change two cosmetic behaviours (C-2: one warning instead of two on a 6xxx ATO Mode 3, no `rev` bump on an unchanged
  re-import)? Default no.
- **D-4** may L20 fix the `drop-broadcast` selfcheck detector (C-6), or only reword CLAUDE.md? Default reword. Owner of the soak
  harness is L6/L24/L27's area, so a code fix is best done by whoever owns `tools/soak/`.
- **D-5** L20 cannot finish its sweep until L17, L18 server half, L19 and UI-A have merged; this prep covers up to S-M-wave3a.

Findings for other lanes:

- **UI-A:** C-13 (owners-table fallback in `field-state-rules.js`).
- **L17:** `ship-state.js:24-26` mentions a "1 deg re-broadcast step"; make the constant exist and be marked, or delete the sentence.
  Also state in its wip which `permission.js` header lines it changed (C-7 overlaps).
- **Integrator:** `docs/efsp-usage-guide.md:99` cites "guide §4.2" for Rack order, which is the SOURCE-DEFINED Bay table (L9 F45 fix:
  "guide §1 'Rack', Annex §9"); B12 needs the H62 wording; CLAUDE.md `soak:selfcheck` line is untrue until the detector is fixed.
- **Facility-config loader:** a `_comment` key in `efsp-facility-*.json` would be persisted into the config (`_loadOne` spreads the
  file). Not a bug today (none exists). Do not add one.

Defaults taken in this prep: classified a `[SOURCE-DEFINED]` marker plus the lane's own wip as sufficient ("keep"); treated numbers
cited to a guide clause (`marshal-stack.js`, `metrics.js` targets) as sourced; treated `SOURCE practice` strings as a convention,
not a tag; did not audit `tests/` or `docs/parallel/` (L9's Q4/Q5).
