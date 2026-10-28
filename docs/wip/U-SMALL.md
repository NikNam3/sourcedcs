# U-SMALL: the small-items list (S-ARCH-69)

Branch `lane/U-SMALL`, cut from `efsp-wp5-correlation` at `d9faca35`. No ADR.

## 1. No station frequency hardcoded in the SRS bridge (H147 RQ5 / H149)

**What changed.** `lxsrs_v2/client.py` has no 251 MHz literal any more:

- `SRSClient.default_frequency_mhz` (new, optional): the frequency a radio added with **+ RADIO** tunes to, the one
  `cycle_modulation` gives a radio that has none yet, and the one a saved radio without `freq_mhz` loads with.
  Unset, the slot stays **untuned** (`UNTUNED_HZ = 1.0`, the same 1 Hz placeholder a DISABLED slot carries; it matches
  no station). The controller tunes it by clicking the frequency (the SRS panel already prompts empty for it).
- `python -m lxsrs_v2 --default-freq <MHz>` (new, optional) feeds it.
- crc-desktop: the bridge's command line moved from `main.js` into `lxsrs-setup.js` `lxsrsArgs(config)` (Electron-free,
  unit tested); it passes `--default-freq` only when `config.json` has `defaultFreq`. `config.json` gains
  `"defaultFreq": "251.000"` so behaviour is unchanged; every bridge frequency is now in `config.json`
  (`freqs`, `txFreq`, `defaultFreq`). `--tx-freq` is now also passed only when set.
- Both copies (`lxsrs_v2/lxsrs_v2/` and `crc-desktop/python-pkg/lxsrs_v2/`) re-vendored with
  `crc-desktop/scripts/sync-lxsrs.sh`; `check-lxsrs-sync.sh` reports OK. `direct_url.json` kept pointing at the main
  checkout (the script would have written the worktree path into it).

**Does anything check the two copies are identical?** Only `crc-desktop/scripts/check-lxsrs-sync.sh`, a manual
script: it is **not** wired into `npm test` or CI (the README says so: the Windows release leg has no guaranteed
bash/pip). Nothing automated stops drift. A Node test in `crc-desktop/tests` could diff the two trees' `*.py` files
without pip (finding, not done: it is outside this item's scope and would fail on every lxsrs edit that forgets the
re-vendor, which may be what the supervisor wants).

**Tests.** `lxsrs_v2/tests/test_default_frequency.py` (6: default applied, unset → untuned, cycle modulation, saved
state without a frequency, the CLI flag, and a scan of the package's `*.py` for a station literal);
`crc-desktop/tests/lxsrs-setup.test.js` +2 (`lxsrsArgs`; `config.json` names `defaultFreq` and `main.js` has no
frequency). pytest 63 → 69 (both copies).

**Frequency audit** (`command grep -rnE '2[0-9]{2}\.[0-9]{3}|[0-9]{3}_000_000'` over `crc-sync/src`,
`crc-desktop/app/public/js`, `lxsrs_v2`, plus `crc-desktop/main.js` and `lxsrs-setup.js`), after the change:

| Hit | What it is |
|---|---|
| `crc-sync/src/altimetry.js:15`, `crc-desktop/app/public/js/altimetry.js:12` | `ISA_R = 287.05287`, gas constant |
| `crc-sync/src/magnetic.js:52`, `crc-desktop/app/public/js/coords.js:107` | WGS-84 flattening `298.257223563` |
| `crc-sync/src/efsp/carrier/sun.js:20` | solar mean longitude `280.460` |
| `crc-sync/src/efsp/facility-schema.js:133` | comment: the UHF pool bounds 225.000–399.975 |
| `crc-sync/src/efsp/flight-data-store.js:1298` | comment: example "251.000" |
| `crc-desktop/app/public/js/panels/efsp/sfa-state.js:23` | JSDoc example `232.100` |
| `lxsrs_v2/lxsrs_v2/tests/*.py` | test fixtures |

No station frequency in code on the server, the client or the bridge. The values live in crc-sync
`config/comm-card.json`, the facility files and crc-desktop `config.json`.

**Docs pass.** `crc-desktop/README.md` "config.json fields" (a shared README, not edited here): add a row
``| `defaultFreq` | Frequency a radio added in the SRS panel tunes to; unset, it starts untuned |``.

## 2. Soak REFUSE memory (S-ARCH-67)

**Finding: a refused release request holds no memory of its own, and the R² drop was not caused by refusals.**

- Code: ControlRelease REFUSE (`board/handoff-control.js` `applyRelease`) only writes `coordination.releaseRequest`
  (`answer: 'REFUSED'`, `answeredAt`, `answeredBy`, `reason`) on the Strip. Nothing is keyed by the exchange elsewhere:
  the Board's applied-mutation cache and the hub replay cache (`sync/replay-cache.js`) are capped and hold every op the
  same; the ledger (`tools/soak/ledger.js`) tracks cmids, not exchanges. The record leaves with its Strip (archiver).
- Measured (smoke 20 min, `--inject leak --judge-memory`, three driver variants: **A** always GRANT as shipped,
  **B** always GRANT but with the `rng.chance(0.8)` draw the refusal needs, **C** REFUSE 20 %):

  | seed | A R² | B R² | C R² |
  |---|---|---|---|
  | 7 | 0.959 | **0.858** | **0.857** |
  | 8 | 0.991 | 0.996 | 0.996 |
  | 9 | 0.968 | 0.976 | 0.976 |
  | 11 | **0.786** | 0.972 | 0.971 |
  | 13 | 0.997 | 0.989 | 0.989 |

  B and C agree to the third decimal, with the same `strips.total` and slope: the extra RNG draw changes seed 7's whole
  traffic, refusing changes nothing measurable. A itself reads 0.786 on seed 11. Live Strips stay bounded in every
  variant (INCIRLIK end 3, CENTER end 2 on C-7): refused exchanges do not leave Strips live.
- Cause of the fragility: the smoke profile restarts the host, the fit keeps only the post-restart lifetime, which is
  about 7 heavy samples (min 11–20). Seven points of a 15 MB/h leak over DROPPED-Strip heap noise is marginal.

**What changed.** `tools/soak/traffic.js` `checkIn()` answers a release request GRANT 80 % / REFUSE 20 % again;
`tools/soak/selfcheck.mjs` runs the leak case with `--restarts 0` (11 heavy samples from min 5; seed 7 with REFUSE:
R² 0.985; across seeds 7–17 0.907–0.996, A on seed 13 0.779 is the one sub-0.9 read and that is the shipped
always-GRANT driver, so seeds other than 7 are still marginal: a longer leak case would make the proof robust, not
done since only seed 7 runs).
`soak:selfcheck` PASS (leak R² 0.985). `soak:smoke` (seed 1) PASS, 3 REFUSE and 23 GRANT applied (counted with a
temporary stderr line, removed). Freeze: the three `hub-random-seed*` goldens move (they replay the soak driver's seeded
traffic), `freeze:update` in its own commit, 57/57.

**Docs pass.** `CLAUDE.md` soak paragraph needs nothing. `docs/wip/U-RELEASE.md` finding is answered here.

## 3. FAA quotes for ADR 0126

`docs/research/twr-pattern-quotes.md`: ¶3-8-2, ¶3-10-5, ¶3-10-11 (JO 7110.65BB Change 3, effective 9 Jul 2026) and
AIM 4-3-3, 4-3-22, 4-3-23 (Change 3, same date), verbatim, from faa.gov's own ATPUBS HTML. faa.gov answered a plain
`curl` with a browser User-Agent (HTTP 200); no third-party copy needed. Disagreements with ADR 0126 (no ADR edit, P4):

1. **ADR 0126 cites "AIM 4-3-22 (option approach)": 4-3-22 is Practice Instrument Approaches; the option is AIM 4-3-23.**
2. The option has five outcomes (4-3-23: T&G, low approach, missed approach, stop-and-go, full stop); the OPT cell has
   three. Stop-and-go is out by H147 RQ7; **missed approach has no value** (nothing lost on the Board, noted only).
3. AIM 4-3-3 supports PAT; STR only through NOTE 1 to d. A weaker citation than the ADR suggests.
4. ¶3-10-5 is phraseology; g (USA/USN/USAF) has the tower give runway and wind with every land/T&G/LA/option clearance.
5. ¶3-8-2 and ¶3-10-11 match the ADR's quotations.

**Supervisor:** a successor ADR or the briefing should read 4-3-23 for 4-3-22.

## 4. The briefing's small-items row

| Item | What changed | Commit |
|---|---|---|
| TOFI with one counterpart | ⋯ item reads **"TOFI to CTR"** and sends at once; with a choice it stays **"TOFI…"** and the picker's Send button reads **"TOFI to TAC_C2"** / "TOFI to GCI", following the selection (was "Send TOFI"). `tofiSendLabel()` in `bay/popovers/tofi.js`. Specs/unit tests follow | `fix(efsp-client): TOFI names its target` |
| ⋯ menu "Flight" twice | `groupStripMenuItems()` (strip-menu.js) gathers items by group in first-appearance order before drawing: Start, Flight (MARSA, Show on map, Bind, …), Formation, Final, Strip. Cause: MARSA (Flight) was pushed before Formation, Show on map after | `fix(efsp-client): the Strip ⋯ menu prints each heading once` |
| `LUAW_WHILE_COMBINED_TEXT` | now `LUAW while LC is combined with a non-local Position` (no citation, no advice); the rule's source is in the code comment | `fix(efsp-client): LUAW_WHILE_COMBINED states the condition only` |
| Stale comments | reconciler `tick()` docstring (same-rung: first in sweep order takes it, the other's TRACK_LOST names the holder; two contacts for one flight is the ambiguous case); `par-monitor.js` l.10 names Landed / Missed approach; `shadow.js` "five synced stores (STORE_SYNC)" | `docs(crc-sync): three stale comments` |
| ATO / DD-1801 types | `aircraft-data.js` `designatorFor()` + `DESIGNATOR_BY_NAME`: "F-16C" → F16, "F/A-18C" → F18H, "KC-135R" → K35R, "E-3"/"E-3A" → E3TF, … Applied where types enter: ATO mapping (`ato-mapping.js` flightDataSeed) and the DD-1801 seed (`flight-plan-lookup.js` `toFlightDataFiledSeed`). An unknown name is kept as given (upper-cased), never guessed. A typed Block 3 / a CreateStrip's own type is not rewritten (a controller types a designator; the shape check stays) | `feat(efsp): ATO and DD-1801 types enter as ICAO designators…` |
| Wake rows vs Doc 8643 | Read against ICAO's own Doc 8643 data (`doc8643.icao.int/external/aircrafttypes`, POST, 2026-10-16). **Wrong rows removed** (not designators): F15E (→ F15), F18 (→ F18H), SU30/SU33 (→ SU27), JF17 (→ FC1), C5 (only C5M is listed), IL78 (→ IL76), T95 (→ TU95), T45 (→ HAWK, which Doc 8643 gives "L/M", so no row). **Added**: FC1 M, TU95 H. Every remaining row's WTC equals Doc 8643's. The rows are now labelled "DOC 8643" instead of "OURS" | same commit |
| `wakeCategory: 'D'` seeds | 41 seed lines in 30 test/spec files → `'M'` (their F16/F15/F-16C/F-15E), `'H'` for the C17. `efsp-aircraft-data.test.mjs` keeps its 'D' (the replaced-invalid case). Freeze goldens: own commit (274 lines of `"D"`→`"M"` in recorded inputs plus those flights' hashes) | `test: the wakeCategory 'D' seeds…` + `test(freeze): …` |
| Airspace approval and `ap-sfa` | **It did leave the Strip on the old Rack.** Path: `ApproveAirspaceEntry` → `flightDataStore.setWorkingFrequency` and nothing re-filed the Strip; same for `ClearAirspaceEntry` and SetBlock 22. Fix: `Placement.followSfaFrequency(strip)`, called by those three ops after the write: onto the new frequency's Rack when the pool has one, else the owner's ordinary Bay for its state (`ap-inbound`). Test `tests/efsp-sfa-frequency-follow.test.mjs` (4). `TerminateRadarService` also writes null but drops the Strip, so it does not need it | `fix(efsp): a frequency rewrite takes the Strip off the SFA Rack…` |

**e2e (E2E_LANE=7):** l1-popovers, l3-coordination, tofi-regime, ui-a, l14-ato-import, l5-arrivals, runway-status,
signon-reconnect, ui-b-resync: 58/58. `ui-a` now types `m/f15` (F15E is no designator).

**Freeze for the designator change:** `hub-op-matrix/ato-*`, the five `resync-*` and `scenario-ato`/`scenario-carrier-ato`
goldens move (ATO-imported flights' type and derived wake); own commit.

**Usage guide / briefing wording for the docs pass:**
- Guide, TOFI: "With one counterpart the ⋯ menu offers **TOFI to CTR**, which sends at once; CTR's **TOFI…** opens a
  picker whose button names the choice (**TOFI to TAC_C2**)."
- Guide, LUAW warning text as above.
- Guide/briefing, Block 3: an ATO or a filed DD-1801 seeds the ICAO designator ("F-16C" arrives as F16, with its wake);
  a name the map does not know arrives as written for the controller to correct.
- Briefing §4 small-items row: done except the two U-DECLUTTER items (received code on mismatch, KEEP IFR).
- Briefing l.1596 (SFA row): "an airspace approval that rewrites a flight's frequency leaves its Strip on the old
  frequency's `ap-sfa` Rack" is fixed: the Strip follows its frequency (or goes to `ap-inbound`).
- Briefing §3C: drop "(`tick()`'s docstring still says "neither gets it": wrong, queued for cleanup)".
