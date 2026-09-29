# [SOURCE-DEFINED] inventory — L9

Branch `lane/L9-sd-inventory`. Date 2026-09-30. Read-only report: nothing but this file was edited.

**Audited tree: `cfcf344`** (the branch head, cut from `efsp-wp5-correlation`), not the briefing's
`49e6bb2`. Between the two, F1 (MissionClock) touched `nla.js`, `board-store.js`, `fdr-store.js`,
`airspace-store.js`, `correlation-reconciler.js` and others, and `docs/efsp-usage-guide.md:786-787`
was reworded (calibration case C2 is already fixed). Every file:line below is verified at `cfcf344`,
so L20 can apply it as written. Lines that moved from the briefing: C4 `board-store.js:650/:991` →
`:656/:997`; C8 `airspace-store.js:81` → `:86`, `correlation-reconciler.js:34-35` → `:35-36`;
`nla.js:276` → `:287`; `fdr-store.js:481-485` → `:488-491`.

Abbreviations in the tables: **PAD** = `PRESENTED-AS-DOCTRINE`, **USD** = `UNMARKED-SD`,
**OKM** = `OK-MARKED`, **DCO** = `DOCTRINE-CITED-OK`, **GH** = `GAP-HONOURED`.

---

## Summary

| Class | S1 | S2 | S3 | Total |
|---|---|---|---|---|
| `PRESENTED-AS-DOCTRINE` | 5 | 0 | 9 | 14 |
| `UNMARKED-SD` | 15 | 2 | 13 | 30 |
| `OK-MARKED` | 4 | 3 | 39 | 46 |
| `DOCTRINE-CITED-OK` | 17 | 0 | 11 | 28 |
| `GAP-HONOURED` | 0 | 0 | 3 | 3 |
| `GAP-VIOLATED` | 0 | 0 | 0 | 0 |
| **Total** | 41 | 5 | 75 | **121** |

- **UI or usage-guide text presenting something SOURCE-defined, or unsourced, as doctrine (PAD, S1): 5.**
  One is a UI string (A1), and four are in the usage guide (B3, B5, B7, B9). As the briefing
  predicted, no rendered string in crc-desktop contains "FAA" or "doctrine". The UI's one PAD is a
  refusal line that sounds like an external rule.
- **Code comments presenting something as doctrine (PAD, S3): 9** (Group D). Three are the C4
  "doctrine check" comments. One (`station-coverage.js:30-32`) repeats the ADR 0059 sentence that
  ADR 0060 has already corrected.
- **GAP-VIOLATED: none.** Nothing orders by scramble or interceptor priority, nothing ingests
  APVLs, and no retention period is encoded.
- **Five S1 findings to fix first:** B7 (Incirlik radar figures), B9 ("no scope in any real
  facility"), A1 ("reserved for uncontrolled traffic"), B5 (FAA/ICAO airspace-naming claim) and B3
  ("the order of the paper strip").

### Marker counts per directory (literal `SOURCE-DEFINED`, re-measured at `cfcf344`)

| Directory | Markers | Files | vs. briefing (`49e6bb2`) |
|---|---|---|---|
| `crc-sync/src` | 29 | 11 | same |
| `crc-sync/config` | 2 | 2 | +1: `theaters.json` (F1, new) |
| `crc-sync/data` | 0 | 0 | same |
| `crc-sync/tests` | 5 | 2 | same (appendix) |
| `crc-desktop/app` | 11 | 3 | same |
| `crc-desktop/tests` | 0 | 0 | same |
| `docs` excluding `docs/parallel/` | 38 | 17 | +6: ADR 0079 (2), ADR 0060 (1), usage guide `:787` (1), `efsp-parallel-plan.md` (4), minus rounding in the briefing's count |
| `docs/parallel/` | 86 | 10 | new (planning docs, not audited) |
| `EFSPImplementationGuide.md` | 15 | 1 | same (the source of truth, not audited) |

---

## Group A — S1 wording fixes: crc-desktop UI and server reason strings (L20 edits code)

| # | file:line | Excerpt (verbatim, ≤ 120 chars) | Class | Sev | Traces to | Suggested fix wording |
|---|---|---|---|---|---|---|
| A1 | crc-sync/src/efsp/code-allocator.js:92 | `detail: 'reserved for uncontrolled traffic'` | PAD | S1 | ADR 0059 (no guide clause) | `detail: "reserved for AI aircraft (crc-sync's synthetic block 6000–6777)"`. This is the second half of calibration C5. The comment half is C4. |
| A2 | crc-desktop/app/public/js/panels/radar-panel.js:78-79 | `` $range.textContent = `${Math.round(r.rangeM / 1852)}nm`; `` beside a real ICAO label (`LTAG 40nm`) | USD | S1 | `radars.js:40-44` (OKM) | Keep the text. Set the title to `` `${TYPE_LABELS[r.type] \|\| r.type.toUpperCase()} — range in crc-sync's model, not the real site's` ``. The number is a SOURCE figure shown next to a real airfield. |
| A3 | crc-desktop/app/public/js/panels/efsp/strip-template.js:342-344 | `` : id.equipmentSuffix ? '/' + id.equipmentSuffix : ''; `` | USD | S1 | `fdr-store.js:155-163` (OKM, "MUST NOT be presented as real FAA doctrine") | **Latent.** No UI path, and no DD1801 mapping, writes `identity.equipmentCodes` today, so the suffix is always empty. When one does, the rendered `/XYZ` will look like a real FAA equipment suffix. See E8. For now, no change. |

Checked and **not** findings: the `inhibited:` strings in `nla.js:189-316` are plain reasons, with no
authority claimed. The same goes for the refusals at `board-store.js:761` and `:1157` (`"… is not X's
to advance"`), `radar-panel.js:55-56`, `index.html:173` (`NO RADAR COVERAGE — HOLD A RADAR POSITION`),
`marsa-badge.js`, `airspace-panel.js` and `track-panel.js:226-236`. The conformance and STCA reason
lines in `strip-view.js:372-394`, `track-panel.js:227-233` and `geojson.js:49-56` state measurements
and no rule. The track-degradation, AIT, SREG and callsign strings are cited: see Group F.

---

## Group B — S1 usage-guide wording (the integrator folds these; L20 drafts in `docs/wip/L20.md`)

Under decision P3 and Q7, no lane edits `docs/efsp-usage-guide.md`. L20 drafts replacement text in
`docs/wip/L20.md`, and the integrator folds it in. Every row is S1.

| # | file:line | Excerpt (verbatim, ≤ 120 chars) | Class | Sev | Traces to | Suggested fix wording |
|---|---|---|---|---|---|---|
| B1 | docs/efsp-usage-guide.md:37-63 | `The full pre-departure chain is PROPOSED → PENDING_CLEARANCE → CLEARED …` + the per-State authority table | USD | S1 | guide `:193` §3.4 `[SOURCE-DEFINED]`, `:219` §3.5 | After the table (`:62`), add: *"The states, who owns each one and the NLA labels are SOURCE's own lifecycle (guide §3.4/§3.5, `[SOURCE-DEFINED]`). Real TFDM publishes none of them."* |
| B2 | docs/efsp-usage-guide.md:67 | `Every Position's Bay set is fixed by facility-config.js (guide §4.2).` | USD | S1 | guide `:400` "Default Bay sets `[SOURCE-DEFINED]`" | `Every Position's Bay set is fixed by facility-config.js — guide §4.2's default Bay sets, which are SOURCE's own (the real TFDM bay names are not published).` |
| B3 | docs/efsp-usage-guide.md:311 | `in Block Map order, which is the order of the paper strip.` | PAD | S1 | DEPARTURE only: guide `:720` §6.2 `[Annex §2.1]`. ARRIVAL/OVERFLIGHT/MISSION: `block-map.js:187/:274/:347` (OKM) | `in Block Map order — for a DEPARTURE Strip the FAA strip's order (guide §6.2); the other Roles' orders are ours.` |
| B4 | docs/efsp-usage-guide.md:530-531 | `For the MOAs around Incirlik that is Ankara Center (CTR), not Incirlik Approach.` | USD | S1 | ADR 0036 (the project owner's airspace picture). The guide's verified §9.11 (`:1103`, `[Annex §13.3]`) names APP | `In SOURCE's model (the project owner's airspace picture, adr/0036) the MOAs around Incirlik belong to Ankara Center (CTR), not Incirlik Approach. The verified rule is only that ATC, not the using agency, approves activation (guide §9.11).` |
| B5 | docs/efsp-usage-guide.md:535-538 | `the FAA and ICAO names for overlapping things, since what the FAA calls a MOA is usually charted as a danger or restricted area here` | PAD | S1 | none. `airspace-config.js:20-24` marks the taxonomy as ours | `type is one of … — a label set of our own that borrows FAA and ICAO special-use-airspace names. It is a label only: …` (drop the unsourced claim about how things are charted). |
| B6 | docs/efsp-usage-guide.md:539-568 | `a MOA's workingFrequencyMhz is what flights working inside it go to` / `…which is how two aircraft use one area` | USD | S1 | `fdr-store.js:488-491`, `airspace-config.js:20-24` (both OKM: "this squadron's operating practice, not FAA or DoD doctrine"). ADR 0037 | Add at the start of "Putting a flight in" (`:553`): *"Working and range-control frequencies, and approving a flight onto one, are this squadron's operating practice, not an FAA or DoD procedure (`[SOURCE-DEFINED]`, adr/0037). The approval round trip itself is guide §9.11."* At `:563`, change "which is how two aircraft use one area" to "which is how, in this model, two aircraft share one area". |
| B7 | docs/efsp-usage-guide.md:578-579 | `Incirlik's field surveillance radar (40 nm, …)` / `the approach radar (80 nm) — you are the RAPCON` | PAD | S1 | `radars.js:40-44` (OKM, "must not be presented as any real facility's equipment (defect D11)"), `facility-config.js:95` | `TWR`: `the field radar crc-sync models for Incirlik (40 nm in our model, and the only one that shows ground vehicles)`. `APP`: `that, plus the approach radar crc-sync models there (80 nm) — you are the RAPCON`. This is calibration C1. |
| B8 | docs/efsp-usage-guide.md:576-582 | the whole `Holding` / `You see` table, incl. `CTR` → `every airfield's approach radar in the theater` | USD | S1 | `facility-config.js:95-96`, `:211`, `:264` (OKM: "squadron data, not doctrine") | Move the sentence at `:596-597` ("the shipped defaults are a guess") to just above the table: *"These are the shipped `positionRadars` defaults — SOURCE's guess at which scope sits at which console, not any real facility's."* See E1. |
| B9 | docs/efsp-usage-guide.md:584-585 | `Ground and Clearance Delivery have no scope in any real facility` | PAD | S1 | ADR 0033:21 (the same claim, unsourced). No guide clause | `In our model Ground and Clearance Delivery work no scope (adr/0033), so holding only those shows …`. On ADR 0033 itself, see E5. |
| B10 | docs/efsp-usage-guide.md:706-707 | `The typed form defaults to the refuelling case (tanker accepted / until vertically positioned)` | USD | S1 | `efsp-panel.js:1167` (OKM) | `The typed form defaults to the refuelling case — our default, because it is the case guide §9.2 spells out in full.` |
| B11 | docs/efsp-usage-guide.md:776-779 | `more than 5° off the assigned heading for 10 s (after 30 s …)` / `faster than 500 ft/min` / `more than 500 ft` / `within 3 NM and 1,000 ft` | USD | S1 | `config/alerting.json:2` (OKM, "Our own choices, not doctrine") | Add under the table: *"Every threshold here is SOURCE's own choice (`config/alerting.json`, adr/0058), not a published standard."* This is calibration C7's S1 row. See E3. |
| B12 | docs/efsp-usage-guide.md:789-790 | `on QNH below the transition altitude and as flight levels above it` | USD | S1 | `config/theater-settings.json` `transitionAltFt: 18000` (no comment) | `… below the theater's transition altitude (a theater setting, config/theater-settings.json; 18,000 ft shipped) …`. See E4. |
| B13 | docs/efsp-usage-guide.md:800 | `6000–6777 is an AI aircraft's code` | USD | S1 | `code-allocator.js:23-26`, ADR 0059 | `6000–6777 is the block crc-sync gives AI aircraft (our convention, adr/0059 — not a real code allocation)` |
| B14 | docs/efsp-usage-guide.md:803 | `an altitude from a height-finding radar (AWACS, fighter, carrier), not from the aircraft` | USD | S1 | `radars.js:52-67` DEFAULT_CAPS (OKM) | `an altitude from a radar crc-sync models as height-finding (AWACS, fighter, carrier), not from the aircraft` (Q8) |
| B15 | docs/efsp-usage-guide.md:804, :813-815 | `a datalink report from one of your own aircraft` / `The datalink (TAC_C2, AIC, GCI) shows your own participating aircraft …` | USD | S1 | `datalink.js:19` (OKM), `sensor-specs.json:2` | At `:813`: `The datalink — crc-sync's model of one, [SOURCE-DEFINED]: which types participate is in sensor-specs.json — shows …` |
| B16 | docs/efsp-usage-guide.md:807-808 | `A player with no SRS client has no transponder.` | USD | S1 | `transponder.js:8-9`, ADR 0059 | `In crc-sync's model a player's transponder is whatever SRS reports, so a player with no SRS client has none.` (The bogey/primary-only consequence is L10's: decisions H6/H7.) |
| B17 | docs/efsp-usage-guide.md:809 | `Airfield and approach radars are 2D with SSR.` | USD | S1 | `radars.js:52-67` | `crc-sync models airfield and approach radars as 2D with SSR.` (Q8: this is roughly true of real installations, but it is still our model.) |
| B18 | *(new section)* after `docs/efsp-usage-guide.md:825` | — | *(addition, not a finding)* | S1 | Q3 | Add a short section, **"What is ours and what is sourced"**. It lists once the SOURCE-defined things that appear only as plain labels, with no claim attached: state names and NLA button text (§3.4/§3.5), Bay names (§4.2), ARRIVAL/OVERFLIGHT/MISSION Block Maps and all sub-lettered Block ids (`3A`–`3G`, `7A`, `9A-*`, `9F`, `M1`–`M8`), the CID format, the equipment-suffix derivation, working frequencies, airspace `type`, `positionRadars`, radar figures and caps, the datalink, the synthetic code block, and conformance/STCA thresholds. Then it lists what is cited (§4.6 primitives, §9.2 MARSA, §3.7 amendments, §3.10 codes, §9.10 stereo, §9.11 activation). This is the "diff baseline" that WP6 plan Phase 7 step 4 asks for. |

---

## Group C — add a marker: code comments and config `_comment`s (L20, mechanical)

House style is `// [SOURCE-DEFINED] (docs/adr/00NN) — <what is ours>.`

| # | file:line | Excerpt (verbatim, ≤ 120 chars) | Class | Sev | Traces to | Suggested fix wording |
|---|---|---|---|---|---|---|
| C1 | crc-sync/config/alerting.json:2 | `"… (docs/adr/0058). Our own choices, not doctrine. Override by …"` | OKM | S2 | ADR 0058 | Insert the literal token: `"… (docs/adr/0058). [SOURCE-DEFINED]: our own choices, not doctrine. …"` (Q1) |
| C2 | crc-sync/config/efsp-facility-incirlik.json:1, efsp-facility-center.json:1 | `"facility": "INCIRLIK", "positions": [ …` (Bay sets, covering chain, no `_comment`) | USD | S2 | guide `:400` | Add `"_comment": "Bay sets are [SOURCE-DEFINED] (guide §4.2): the real TFDM bay names are not published."`. **L20 must first confirm that `validateConfig()` (`facility-config.js:362`) tolerates an unknown `_comment` key.** If it does not, put the note in `facility-config.js` next to the loader instead. |
| C3 | crc-sync/config/theater-settings.json:2 | `"transitionAltFt": 18000,` | USD | S2 | none; see E4 | Add `"_comment": "transitionAltFt is a squadron setting ([SOURCE-DEFINED]); 18000 is the US value."`. The same loader-tolerance check applies as for C2. |
| C4 | crc-sync/src/efsp/code-allocator.js:8, :23-26 | `// Doctrine implemented here, from EFSPImplementationGuide.md §3.10.2/§3.10.4:` … `//   - 6000–6777 is the SYNTHETIC block (docs/adr/0059)` | USD | S3 | rules 4–8: guide `:322-329` (`[Coord §2.8.x]`). Synthetic block: ADR 0059 only | Move the synthetic bullet out of the "Doctrine" list, under its own line: `// [SOURCE-DEFINED] (docs/adr/0059) — 6000–6777 is crc-sync's synthetic block for AI transponders; no real allocation.` This is C5's comment half. A1 is the string half. |
| C5 | crc-sync/src/surveillance/transponder.js:10-14 | `synthetic code from the reserved 6000–6777 block … hostile AI flies with it off.` | USD | S3 | ADR 0059 | Prefix the bullet: `// [SOURCE-DEFINED] (docs/adr/0059) — the synthetic block, and which coalitions' AI squawk, are ours.` |
| C6 | crc-sync/src/efsp/conformance.js:1-24 | `// Conformance monitoring (docs/adr/0058): is a correlated flight doing what its clearance says?` | USD | S3 | ADR 0058, `alerting.json` | Add after `:4`: `// [SOURCE-DEFINED] (docs/adr/0058) — the three checks and every threshold (config/alerting.json) are ours, not a published standard.` |
| C7 | crc-sync/src/stca.js:1-22 | `// Short-term conflict alert (docs/adr/0058).` | USD | S3 | ADR 0058, ADR 0059 | Add after `:3`: `// [SOURCE-DEFINED] (docs/adr/0058, 0059) — the prediction model, thresholds and ATC-only scoping are ours.` |
| C8 | crc-sync/src/surveillance/presentation.js:1-20 | `// What a controller is told about a contact (docs/adr/0059).` | USD | S3 | ADR 0059 | Add after `:3`: `// [SOURCE-DEFINED] (docs/adr/0059) — which sensor yields which field is crc-sync's model of a scope, not a real system's.` |
| C9 | crc-sync/src/surveillance/iff.js:1-8 | `// The automatic answer still reads the DCS coalition, which no real sensor would give` | USD | S3 | ADR 0059. L10 rewrites this under H3/H4 | The header is honest but carries no marker. **After L10 lands**, add `// [SOURCE-DEFINED] (docs/adr/0066) — the automatic-IFF rules are ours.` (L10's ADR number is from P6.) |
| C10 | crc-sync/src/efsp/station-coverage.js:1-26 | `// Which radars a controller is looking through … A Ground controller has no scope; that is the answer.` | USD | S3 | ADR 0042, 0043, 0033 | Add after `:3`: `// [SOURCE-DEFINED] (docs/adr/0042/0043) — coverage-follows-Position and every positionRadars default are ours.` At `:20-21`: `In our model a Ground controller has no scope; that is the answer.` |
| C11 | crc-sync/src/efsp/release-envelope.js:1-17 | `// Standing-release envelope matching (EFSPImplementationGuide.md §4.6.2, docs/adr/0017)` | USD | S3 | the envelope concept is guide `:502` (§4.6.2, `[Coord §2.7]`). Matching rules: ADR 0017/0050 | Add: `// [SOURCE-DEFINED] (docs/adr/0017, 0050) — the matching rules (short name first, then route string, altitude, radius) are ours; the envelope idea is §4.6.2's.` |
| C12 | crc-sync/src/efsp/airspace-store.js:200-205 | `// §9.11's split, generalized: … a MOA inside Ankara Center's airspace is approved by CTR` | USD | S3 | guide §9.11 (verified, names APP), ADR 0036 | Prefix: `// [SOURCE-DEFINED] (docs/adr/0036) — the approver is configured per airspace; §9.11's verified principle is only that ATC approves.` |
| C13 | crc-sync/src/efsp/permission.js:300, :342 | `// Per-State authority (guide §3.4's "normally owned by" column)` / `DEPARTURE's guide-sourced one.` | USD | S3 | guide `:193` §3.4 `[SOURCE-DEFINED]` | At `:300`, prefix `// [SOURCE-DEFINED] (guide §3.4) —`. At `:342`, change "guide-sourced" to "guide-given". This is calibration C6. |
| C14 | crc-desktop/app/public/js/panels/efsp/efsp-nla.js:57, :74 | `// Per-State authority (guide §3.4's "normally owned by" column) — client mirror …` / `const DEPARTURE_STATE_OWNERS = {` | USD | S3 | mirror of C13 | Prefix `:57` with `// [SOURCE-DEFINED] (guide §3.4) — mirrors permission.js's marker.` (Q2) |
| C15 | crc-desktop/app/public/js/panels/efsp/efsp-nla.js:42-43, :102-105 | `// WP4A second slice — MISSION lifecycle labels, mirroring … (guide's own §9.8 lifecycle, line 215).` / `const MISSION_STATE_OWNERS = {` | USD | S3 | guide `:215` is inside §3.4 `[SOURCE-DEFINED]`. Server `permission.js:368` is marked | `:42`: `// [SOURCE-DEFINED] MISSION lifecycle labels (guide §3.4's mission line, itself [SOURCE-DEFINED]) —`. `:102`: `// [SOURCE-DEFINED] (WP4A second slice) — MISSION lifecycle authority, mirroring permission.js …` (Q2) |
| C16 | crc-sync/src/efsp/nla.js:68 | `// Guide-specified lifecycle (§9.8, line 215) — not invented.` | USD | S3 | guide `:215` inside §3.4 `[SOURCE-DEFINED]` | `// [SOURCE-DEFINED] — the guide's own mission lifecycle (guide :215, under §3.4's [SOURCE-DEFINED] heading).` "Not invented" is the "guide-sourced = verified" trap (briefing §3). |

---

## Group D — reword a code comment that overclaims (L20)

All rows are S3.

| # | file:line | Excerpt (verbatim, ≤ 120 chars) | Class | Sev | Traces to | Suggested fix wording |
|---|---|---|---|---|---|---|
| D1 | crc-sync/src/efsp/board-store.js:14 | `// Doctrinal decisions (block routing, Bay-implies-state, NLA, occupancy/` | PAD | S3 | Bay-implies-state and NLA are §3.5/§4.2 `[SOURCE-DEFINED]` | `// Rule decisions (block routing, Bay-implies-state, NLA, occupancy/` |
| D2 | crc-sync/src/efsp/board-store.js:656-657 | `could silently skip a Strip past every doctrine check NLA enforces` | PAD | S3 | `nla.js:4` (OKM) | `could silently skip a Strip past every lifecycle check NLA enforces` (C4) |
| D3 | crc-sync/src/efsp/board-store.js:997 | `dragging a Strip straight past every doctrine check NLA enforces` | PAD | S3 | `nla.js:4` | `dragging a Strip straight past every lifecycle check NLA enforces` (C4) |
| D4 | crc-sync/src/efsp/board-store.js:2008-2009 | `But the two are genuinely separable in real operations (a MOA can stay hot after one flight leaves it)` | PAD | S3 | none (Q6) | `But the two are separable in our model (a MOA can stay hot after one flight leaves it)` |
| D5 | crc-desktop/app/public/js/panels/efsp/efsp-panel.js:772 | `validation: "you can't drop this here, it'd skip a doctrine check")` | PAD | S3 | `nla.js:4` | `validation: "you can't drop this here, it'd skip a lifecycle check")` (C4) |
| D6 | crc-desktop/app/public/js/panels/efsp/bay-view.js:1569 | `// before this file — the established pattern for small doctrinal tables` | PAD | S3 | `COORDINATION_ELIGIBLE_STATES` is ADR 0022 (ours) | `// before this file — the established pattern for small rule tables` |
| D7 | crc-sync/src/efsp/station-coverage.js:30-32 | `The tactical side does not: military positions and radars do not do collision avoidance the way ATC does.` | PAD | S3 | ADR 0059:171, **already corrected by ADR 0060:40** | `The tactical side does not — a squadron decision (docs/adr/0059, as corrected by 0060), [SOURCE-DEFINED].` This is the code copy of calibration C2 that the usage-guide fix missed. |
| D8 | crc-sync/src/efsp/airspace-config.js:34-37, :48-53 | `The FAA's special-use taxonomy and ICAO's (which is what Turkey publishes) name overlapping things` / `'DANGER', // ICAO D — how most of these are charted outside the US` | PAD | S3 | none (Q6). The module's own `:20-24` marks the taxonomy as ours | `:34-37`: `// What kind of block this is — labels borrowed from FAA and ICAO special-use-airspace names, spanning both rather than picking one. The set is ours (see the [SOURCE-DEFINED] note above).` `:50`: `'DANGER', // ICAO D`. Drop "which is what Turkey publishes" and "how most of these are charted outside the US" unless the Annex sources them. |
| D9 | crc-sync/src/surveillance/datalink.js:8-9 | `` callsign, type and altitude — every `pliPeriodMs`, the way Link 16 PPLI does. `` | PAD | S3 | none. The file's own `:19` says "Everything here is [SOURCE-DEFINED]" | `` … every `pliPeriodMs` — loosely modelled on a Link 16 PPLI, not a model of one. `` It is an analogy, but it asserts a real system's behaviour, so it is phrased as one. |
| D10 | crc-sync/src/efsp/nla.js:59-60; crc-sync/src/efsp/permission.js:357-358 | `// [SOURCE-DEFINED] (docs/adr/0023) — OVERFLIGHT has no guide-published state table at all` | OKM | S3 | guide `:214` **does** give one: `Overflight: INBOUND → IN_SECTOR → HANDED_OFF → DROPPED` (under §3.4 `[SOURCE-DEFINED]`) | The marker is right, but the provenance sentence is wrong: it understates the guide rather than overclaiming, so this is not D11. Change it to `// [SOURCE-DEFINED] (docs/adr/0023) — replaces the guide's own [SOURCE-DEFINED] overflight lifecycle (guide §3.4: INBOUND → IN_SECTOR → HANDED_OFF → DROPPED) with a two-state one.` See E7. |

---

## Group E — needs a squadron / human answer before it can be worded (supervisor → Decision Desk)

> **L9's inventory items needing answers (H9).** Each item is a question with options and a
> recommendation, ready for the Decision Desk. None of them blocks L20's mechanical rows (Groups
> C, D) or the plain-marker rows of Group B. Where a Group B row depends on one, the recommended
> option is what that row's wording already assumes.

| # | Question | Options | Recommendation | Rows it settles |
|---|---|---|---|---|
| E1 | **Which scope sits at which console?** The shipped `positionRadars` give TWR the field radar only, APP the field and approach radars, CTR every airfield's approach radar in the theater, and TAC_C2/AIC/GCI own AWACS + fighter radars + datalink. `OPS`/`CD`/`GND`/`JTAC` get none. The briefing calls this "guesses … wants a look from somebody who knows". | (a) Keep the defaults as SOURCE's model and label them as such in the usage guide. (b) The squadron supplies the real assignment, and L20 (or a later lane) changes the defaults. (c) Keep, but give GND a field-radar picture (for ground vehicles). | **(a) now**, with (b) whenever the squadron has an answer. Wording does not depend on the answer, because B8 labels whatever ships. | B7, B8, C10 |
| E2 | **Radar figures** (`radars.js:43-49`): field 40 nm/2 s, approach 80 nm/3 s, CVN approach 50 nm/4 s, ship default 40 nm/5 s, plus DEFAULT_CAPS (field/approach 2D+SSR). Keep them as model figures, or does the squadron want different ones? | (a) Keep them, marked as "in our model" (A2, B7, B14, B17). (b) The squadron supplies figures. | **(a)**. Any real-world figure would need an Annex citation, which does not exist. | A2, B7, B14, B17 |
| E3 | **Conformance / STCA thresholds** (`alerting.json`): heading 5° for 10 s after a 30 s grace, wrong-way 500 ft/min, level bust 500 ft, STCA 3 NM / 1,000 ft. Are these the squadron's values? | (a) Keep, stated as SOURCE's own choices (B11). (b) The squadron supplies values: a config edit only (P5, restart). | **(a)** | B11, C1, C6, C7 |
| E4 | **Transition altitude.** `theater-settings.json` ships `transitionAltFt: 18000` (the US value) for every theater, and conformance compares altitudes across it. Is 18,000 ft the squadron's TA for Syria, consistent with "Syria treated as if under US regulation" (H23)? | (a) Yes: mark it as a squadron setting (C3, B12). (b) No: give the squadron's value, per theater (H13's per-theater tables). | **(a)**, marking it as squadron data. Move it into `theaters.json` when the per-theater table grows (H13/H15). | B12, C3 |
| E5 | **Where does the correction of ADR 0033:21 go?** It says GND and CD *"are not radar positions in any facility, real or simulated"*, the source of usage-guide B9. P4 forbids editing ADRs, and ADR 0060 (the errata ADR) is already committed and says "a later correction adds a new ADR". | (a) L20's own ADR `0077` carries an errata row for `0033:21`. (b) A second errata ADR, collecting corrections at the end of the waves. (c) Leave `0033` alone and fix only the usage guide. | **(a)**. L20 is the lane fixing D11 wording, so its ADR is the natural home, and it keeps the correction next to the fix. | B9, D7 (already done for 0059 by 0060) |
| E6 | **Do inherited citations count?** Some guide sub-sections carry no bracket of their own but sit under a lead-in that cites: §4.6.1's timers (15 min / 3 min / 30 min) under §4.6's "per `EFSP-Coordination-Annex.md` §2.4 and §3.1", and §4.6.2's rules under `[Coord §2.7]`. `index.js:22` calls the timers "the guide's real-world forwarding-obligation timers". | (a) Yes: a parent-section citation covers an untagged sub-clause, so these are DCO. (b) No: only a clause's own bracket counts, and they are USD until the guide adds one. | **(a)**. The guide tags SOURCE-defined sub-sections explicitly, so an untagged sub-clause under a cited section is the guide asserting it as sourced. | F72 (and `forwarding-obligations.js:22-25`) |
| E7 | **The OVERFLIGHT lifecycle diverges from the guide.** Guide `:214` gives `INBOUND → IN_SECTOR → HANDED_OFF → DROPPED` (SOURCE-defined). ADR 0023 built `TRANSITING → DROPPED` and its comments say the guide has no table. | (a) Keep ADR 0023's lifecycle and just correct the comments (D10). (b) Restore the guide's four-state lifecycle (a code change, a new lane). | **(a)**. Both are ours; the comment should tell the truth about which one replaced which. | D10 |
| E8 | **Equipment suffix.** `deriveEquipmentSuffix` is deliberately naive (sorted code letters). Block 3 renders it as `/XYZ`, which would read as a real FAA suffix once anything fills `equipmentCodes`. Nothing does today. | (a) Leave it latent, and list it in the "What is ours" section (B18). (b) Render only `/H` and `/O` (the guide's cited §3.3 degradations) until a real table is sourced. (c) Render it with a visible "derived by SOURCE's simplified rule" title. | **(a) now**. Revisit as (b) when an equipment-code editor or the DD1801 mapping lands, because at that point it becomes S1. | A3 |
| E9 | **The "What is ours and what is sourced" usage-guide section (B18).** This is Q3's default: plain UI labels for SOURCE-defined things get no visible marker, and instead the guide lists them once. | (a) Add the section, with no markers in the UI. (b) Also mark labels in the UI (tooltips on state names, Bay tabs, Block labels). (c) Neither. | **(a)**. A label makes no claim, and a bracketed tag in front of a controller is noise. The section doubles as Phase 7 step 4's diff baseline. | B18 |

---

## Group F — no action: OK-MARKED, DOCTRINE-CITED-OK, GAP-HONOURED (baseline for the next audit's diff)

### F.1 OK-MARKED (the marker covers what it sits on, and nothing nearby overclaims)

| # | file:line | Excerpt (verbatim, ≤ 120 chars) | Class | Sev | Surfaces to a controller as |
|---|---|---|---|---|---|
| F1 | crc-sync/src/radars.js:40-42 | `// Airport surveillance and approach radars, per airfield. [SOURCE-DEFINED] —` | OKM | S3 | A2, B7 |
| F2 | crc-sync/src/radars.js:52-59 | `// [SOURCE-DEFINED], like every figure here.` (DEFAULT_CAPS) | OKM | S3 | B14, B17 |
| F3 | crc-sync/config/sensor-specs.json:2 | `Every figure is [SOURCE-DEFINED] — DCS publishes none of it, and none of it should be presented as a real system's…` | OKM | S2 | covers `datalink.participants` (`:254-257`) and `transponder.syntheticFor` (`:279-280`); B13, B15 |
| F4 | crc-sync/config/theaters.json:2 | `Every other value is [SOURCE-DEFINED]: DCS does not publish these …` | OKM | S2 | the Strip clock's local offset (F1/H11) |
| F5 | crc-sync/src/efsp/facility-config.js:95-96 | `// [SOURCE-DEFINED]: which scope sits at which console is squadron data, not` | OKM | S3 | B8, E1 |
| F6 | crc-sync/src/efsp/facility-config.js:194 | `// [SOURCE-DEFINED] WP4A (docs/adr/0013) — the guide gives no published` | OKM | S3 | CTR Bays |
| F7 | crc-sync/src/efsp/facility-config.js:211 | `// [SOURCE-DEFINED] — every airfield's approach radar in the theater, which` | OKM | S3 | B8 |
| F8 | crc-sync/src/efsp/facility-config.js:241 | `// [SOURCE-DEFINED] WP4A second slice (docs/adr/0025) — the TACTICAL` | OKM | S3 | TACTICAL Bays |
| F9 | crc-sync/src/efsp/facility-config.js:264 | `// [SOURCE-DEFINED] — a Military Radar Unit in DCS works off the airborne` | OKM | S3 | B8 |
| F10 | crc-sync/src/efsp/fdr-store.js:155-163 | `// [SOURCE-DEFINED, deliberately simplified] — the real FAA equipment-suffix` | OKM | S3 | A3, E8 |
| F11 | crc-sync/src/efsp/fdr-store.js:488-491 | `// [SOURCE-DEFINED]: the concept of a "working frequency" for an` | OKM | S3 | Block 22 `FREQ`; B6 |
| F12 | crc-sync/src/efsp/airspace-config.js:20-24 | `// [SOURCE-DEFINED]: the guide models no working frequency, no range-control` | OKM | S3 | B5, B6 (D8 is a separate overclaim lower in the same file) |
| F13 | crc-sync/src/efsp/airspace-config.js:141-144 | `// exactly the [SOURCE-DEFINED]-presented-as-doctrine trap D11 names.` | OKM | S3 | ships `[]` |
| F14 | crc-sync/src/efsp/stereo-routes.js:15-19 | `// and an invented "PACK 1 out of Incirlik" would be the [SOURCE-DEFINED]-presented-as-doctrine trap` | OKM | S3 | F41 |
| F15 | crc-sync/src/efsp/block-map.js:39 | `// Grouped near '3' as SOURCE-DEFINED sub-fields, same numbering` | OKM | S3 | Block labels ACFT/WAKE/TAIL/UNIT/HOME |
| F16 | crc-sync/src/efsp/block-map.js:187-192 | `// [SOURCE-DEFINED] Arrival Block Map (Phase 2, docs/adr/0008) — the real` | OKM | S3 | B3 |
| F17 | crc-sync/src/efsp/block-map.js:274-280 | `// [SOURCE-DEFINED] Overflight Block Map (docs/adr/0023) — a flight` | OKM | S3 | B3 |
| F18 | crc-sync/src/efsp/block-map.js:303, :319-322 | `// [SOURCE-DEFINED] WP6 (docs/adr/0051) — OVERFLIGHT had NO Block carrying an` | OKM | S3 | `7A`/`9A-VECTOR` labels ALT/HDG |
| F19 | crc-sync/src/efsp/block-map.js:347 | `// [SOURCE-DEFINED] WP4A second slice (docs/adr/0026) — the MISSION Strip` | OKM | S3 | B3 |
| F20 | crc-sync/src/efsp/board-store.js:229-231 | `// [SOURCE-DEFINED] format for Block 4 (guide §6.2); no real-world` | OKM | S3 | F42 |
| F21 | crc-sync/src/efsp/flight-plan-lookup.js:66-68 | `* filed.* by createFdr() itself) — [SOURCE-DEFINED] mapping, since` | OKM | S3 | usage §4 |
| F22 | crc-sync/src/efsp/nla.js:3-8 | `// (EFSPImplementationGuide.md §3.4, §3.5). [SOURCE-DEFINED] per the guide's` | OKM | S3 | B1 |
| F23 | crc-sync/src/efsp/nla.js:50 | `// [SOURCE-DEFINED], per guide §3.4's arrival lifecycle:` | OKM | S3 | B1 |
| F24 | crc-sync/src/efsp/nla.js:59 | `// [SOURCE-DEFINED] (docs/adr/0023) — OVERFLIGHT has no guide-published` | OKM | S3 | wording error: D10 |
| F25 | crc-sync/src/efsp/nla.js:287 | `/** [SOURCE-DEFINED] ARRIVAL lifecycle NLA (docs/adr/0008) — same shape as DEPARTURE's table above. */` | OKM | S3 | NLA buttons |
| F26 | crc-sync/src/efsp/permission.js:340 | `// [SOURCE-DEFINED] — ARRIVAL has no guide-published "normally owned by"` | OKM | S3 | B1 |
| F27 | crc-sync/src/efsp/permission.js:357 | `// [SOURCE-DEFINED] (docs/adr/0023) — OVERFLIGHT has no guide-published` | OKM | S3 | wording error: D10 |
| F28 | crc-sync/src/efsp/permission.js:368 | `// [SOURCE-DEFINED] (WP4A second slice) — MISSION has no guide-published` | OKM | S3 | — |
| F29 | crc-sync/src/surveillance/datalink.js:19 | `// Players and AI both count. Everything here is [SOURCE-DEFINED].` | OKM | S3 | B15 (D9 is a separate overclaim at `:8-9`) |
| F30 | crc-desktop/app/public/js/panels/efsp/efsp-nla.js:11 | `// [SOURCE-DEFINED] — mirrors nla.js's STATES_BY_ROLE/computeNla exactly,` | OKM | S3 | NLA labels |
| F31 | crc-desktop/app/public/js/panels/efsp/efsp-nla.js:29 | `// [SOURCE-DEFINED] ARRIVAL lifecycle labels (docs/adr/0008).` | OKM | S3 | NLA labels |
| F32 | crc-desktop/app/public/js/panels/efsp/efsp-nla.js:37 | `// [SOURCE-DEFINED] OVERFLIGHT lifecycle labels (docs/adr/0023) — mirrors` | OKM | S3 | NLA labels |
| F33 | crc-desktop/app/public/js/panels/efsp/efsp-nla.js:87 | `// [SOURCE-DEFINED] ARRIVAL lifecycle authority (docs/adr/0008/0010). CTR` | OKM | S3 | — |
| F34 | crc-desktop/app/public/js/panels/efsp/efsp-nla.js:97 | `// [SOURCE-DEFINED] OVERFLIGHT lifecycle authority (docs/adr/0023) — mirrors permission.js exactly.` | OKM | S3 | — |
| F35 | crc-desktop/app/public/js/panels/efsp/strip-template.js:137 | `// [SOURCE-DEFINED] Arrival Block Map (Phase 2, docs/adr/0008) — client` | OKM | S3 | Block labels |
| F36 | crc-desktop/app/public/js/panels/efsp/strip-template.js:187 | `// [SOURCE-DEFINED] Overflight Block Map (docs/adr/0023) — client mirror of` | OKM | S3 | Block labels |
| F37 | crc-desktop/app/public/js/panels/efsp/strip-template.js:210-214 | `// append-only (§3.7) and confirmVacated works. See the server's copy for the [SOURCE-DEFINED] note` | OKM | S3 | `7A` |
| F38 | crc-desktop/app/public/js/panels/efsp/strip-template.js:238 | `// [SOURCE-DEFINED] WP4A second slice — client mirror of crc-sync's` | OKM | S3 | M-Block labels |
| F39 | crc-desktop/app/public/js/panels/efsp/strip-template.js:334 | `// [SOURCE-DEFINED] composite format for Block 3, per the guide's own` | OKM | S3 | Block 3 `TYPE`; A3 |
| F40 | crc-desktop/app/public/js/panels/efsp/efsp-panel.js:1167 | `// [SOURCE-DEFINED] defaults: the typed form is the fast path for the` | OKM | S3 | B10 |
| F41 | docs/efsp-usage-guide.md:163-166 | `inventing plausible-looking ones would put invented content on a Strip where it reads as doctrine.` | OKM | S1 | — |
| F42 | docs/efsp-usage-guide.md:352 | `cid               3-digit sequential display code (Block 4) — [SOURCE-DEFINED] format` | OKM | S1 | — |
| F43 | docs/efsp-usage-guide.md:596-597 | `Which scope sits at which console is squadron configuration (positionRadars …), and the shipped defaults are a guess.` | OKM | S1 | B8 moves it above the table |
| F44 | docs/efsp-usage-guide.md:786-787 | `The tactical Positions get no STCA — a squadron decision (adr/0059, [SOURCE-DEFINED]), not a statement of real-world doctrine.` | OKM | S1 | C2, fixed in `cfcf344`. The code copy is still dirty: D7 |

(C1 `alerting.json:2` and D10 are also OKM. They are listed in their action groups.)

### F.2 DOCTRINE-CITED-OK (the claim traces to a guide clause with `[Annex]`/`[Coord]`)

| # | file:line | Excerpt (verbatim, ≤ 120 chars) | Class | Sev | Traces to | Optional fix |
|---|---|---|---|---|---|---|
| F45 | docs/efsp-usage-guide.md:99 | `Order within a Rack *is* the departure sequence (guide §4.2)` | DCO | S1 | guide `:105` `[Annex §9]` | Mis-cited: §4.2 is the `[SOURCE-DEFINED]` Bay table. Change it to `(guide §1 "Rack", Annex §9)`. |
| F46 | docs/efsp-usage-guide.md:154-158 | `This is real practice, not a sim convenience: assigned aircraft at Kunsan file locally-defined "Pack" routes` | DCO | S1 | guide `:1097` `[Annex §12]` | — |
| F47 | docs/efsp-usage-guide.md:324-325, :375 | `FAA JO 7110.65 ¶2-3-1's *"do not erase or overwrite any item."*` | DCO | S1 | guide `:261` `[Annex §9]` | — |
| F48 | docs/efsp-usage-guide.md:332-333 | `an altitude must not be struck until the aircraft has reported or is observed leaving it` | DCO | S1 | guide `:261`, `:280` `[Annex §9]` | — |
| F49 | docs/efsp-usage-guide.md:372-373 | `Never red — red is reserved for attention.` … `per guide §7.7 rule 4` | DCO | S1 | guide `:896` `[Annex §15.5]` | — |
| F50 | docs/efsp-usage-guide.md:443-450 | `EDCT … Window is edctTimeUtc ± 5 min` / `CALL_FOR_RELEASE … − 2 / + 1 min` / `+ 30min` | DCO | S1 | guide `:498` `[Coord §2.7]`, `:293` | — |
| F51 | docs/efsp-usage-guide.md:466, :488-498 | `"the Strip does not cross the Facility boundary" (guide §4.6)` + primitive cheat sheet | DCO | S1 | guide `:456-483`, per `EFSP-Coordination-Annex.md` §2.4/§3.1 | — |
| F52 | docs/efsp-usage-guide.md:634-636 | `It turns amber below 95%, which the guide treats as a defect rather than a fact of life.` | DCO | S1 | guide `:830`. Measured 85–90% at `:819` `[Annex §6]` | — (the claim is attributed to the guide, not to the real world) |
| F53 | docs/efsp-usage-guide.md:640-689 | `the flight keeps its IFR clearance, keeps its ATC squawk` / `it comes from the governing agreement` | DCO | S1 | guide `:508-520` `[Coord §3.2, §3.3]` | — |
| F54 | docs/efsp-usage-guide.md:693-699 | `MARSA is Military Authority Assumes Responsibility …` / `the tanker tells you it is accepting MARSA` | DCO | S1 | guide `:979` `[Annex §13.1]`, `:996`, `:1001` | — |
| F55 | docs/efsp-usage-guide.md:728 | `That is doctrine, not a panel quirk: issuing a course or altitude change before the rendezvous breaks the join-up` | DCO | S1 | guide `:997` under `:979` `[Annex §13.1]` | Optionally append `(guide §9.2, Annex §13.1)`. This is calibration C3. |
| F56 | crc-sync/src/efsp/code-allocator.js:8-22 | `// Doctrine implemented here …` rules 4–8: reserved, duplicates, 7777, 4000, monitor set | DCO | S3 | guide `:322-329` `[Coord §2.8.x]` | Only the synthetic bullet is dirty: C4 |
| F57 | crc-sync/src/efsp/correlation-reconciler.js:35-36 | `// fact of life." The measured real-world figure was 85-90%.` | DCO | S3 | guide `:819` `[Annex §6]` | — (C8) |
| F58 | crc-sync/src/efsp/airspace-store.js:86-88; correlation-store.js:124; marsa-store.js:377-378; fdr-store.js:752-753; board-store.js:612 | `JO 7110.65 ¶2-3-1's "do not erase or overwrite any item"` | DCO | S3 | guide `:261` `[Annex §9]` | — (C8). Note: four of these apply a strip-marking rule by analogy to audit records (airspace transitions, correlations, MARSA). The analogy is stated as "the same reason", not as the rule itself, which is acceptable. |
| F59 | crc-desktop/app/public/js/panels/efsp/bay-view.js:1779, :2042 | `` `Track degraded (…) — verbal coordination required, note mandatory` `` | DCO | S1 | guide §4.6 rule 5 (`:481`, under "Rules, each verified" `:475`) | — (C8) |
| F60 | crc-sync/src/efsp/board-store.js:1551, :1936, :1972 | `` detail: `track degradation (…) forces verbal coordination — a note is required` `` | DCO | S1 | guide §4.6 rule 5 | — |
| F61 | crc-sync/src/efsp/board-store.js:1505 | `detail: "AIT requires a written directive — not authorized in this Facility's configuration"` | DCO | S1 | guide §4.6 rule 7 (`:483`) | — |
| F62 | crc-sync/src/efsp/board-store.js:2023, :2061 | `separation_regime must be set back to ATC …` / `it comes from the governing agreement and cannot be derived` | DCO | S1 | guide `:516-518` `[Coord §3.2, §3.3]` | — |
| F63 | crc-desktop/app/public/js/panels/efsp/bay-view.js:1167-1170 | `` `declaringCallsign` is a required free-text field and that is doctrine, not an oversight: §9.2 rule 1 says … `` | DCO | S3 | guide `:996` `[Annex §13.1]` | — |
| F64 | crc-sync/src/efsp/coordination.js:5-8 | `// This is the doctrinal table (guide §4.6's own primitive table,` | DCO | S3 | guide `:464` Coord §2.4/§3.1 | — |
| F65 | crc-sync/src/efsp/facility-config.js:77, :484 | `// WP4A second slice — every Position's doctrinal class (guide §4.1's own` | DCO | S3 | guide `:360` "derived in `EFSP-Coordination-Annex.md` §1" | — |
| F66 | crc-sync/src/efsp/facility-config.js:117, :363 | `// validateConfig() below enforces the doctrinal exceptions (every` | DCO | S3 | guide `:949` §8.3. Required Blocks: `:720` `[Annex §2.1]`, `:760` `[Annex §2.2, §2.3]` | — |
| F67 | crc-sync/src/efsp/block-map.js:200, :250 | `'9A-FUEL': … // minimum fuel — the doctrinal exception, guide §6.3 note 1` | DCO | S3 | guide `:760-762` `[Annex §2.2, §2.3]` | — |
| F68 | crc-sync/src/efsp/fdr-store.js:338; crc-desktop/app/public/js/panels/efsp/efsp-panel.js:633 | `callsign must be 1-7 alphanumeric characters` | DCO | S1 | guide `:179` `[Annex §9]` | — |
| F69 | crc-sync/src/stca.js:20-21 | `Suppressed: a pair in the same active MARSA relation (military authority is separating them, guide §9.2)` | DCO | S3 | guide `:979` `[Annex §13.1]` | — |
| F70 | crc-sync/src/efsp/stereo-routes.js:5-8 | `// require a full flight-plan form. This is verified real practice: assigned` | DCO | S3 | guide `:1097` `[Annex §12]` | — |
| F71 | crc-desktop/app/public/js/panels/efsp/strip-view.js:210, :238 | `'under which regime is the MRU taking this aircraft (§4.6.3)'` / `'Guide §4.6.3 — a separate step from ACCEPT'` | DCO | S1 | guide `:506-508` `[Coord §3.2, §3.3]` | — |
| F72 | crc-sync/src/efsp/index.js:22; crc-sync/src/efsp/forwarding-obligations.js:22-25 | `// other, and the guide's real-world forwarding-obligation timers (§4.6.1)` | DCO | S3 | guide `:485-492` §4.6.1, **inherited** from §4.6's Coord §2.4/§3.1 lead-in | Depends on **E6**. Under (b) these become USD and need a marker. |

### F.3 GAP-HONOURED

| # | file:line | Excerpt (verbatim, ≤ 120 chars) | Class | Sev | Traces to | Note |
|---|---|---|---|---|---|---|
| F73 | crc-sync/src/efsp/fdr-store.js:66 | `const ALERT_STATUSES = new Set(['NONE', 'ALERT', 'SCRAMBLE']);            // §9.6 (M16)` | GH | S3 | guide `:1031` `[GAP]` | A status value only. No Strip, Bay or list is ordered by it anywhere (`grep scramble\|interceptor\|priority`). `efsp-panel.js:363`'s "priority order" is about Strip-origin selection, which is unrelated. |
| F74 | *(absent)* | no APVL ingest in `crc-sync/src` or `crc-desktop/app` | GH | S3 | guide `:1009` `[GAP]` | Nothing to mark until someone builds it. The guide then requires a `[SOURCE-DEFINED]` marker on the ingest path. |
| F75 | crc-sync/src/efsp/mutation-log.js:8-10 | `// Format: one JSON object per line (JSONL), append-only. The 30-day-default retention/rotation job …` | GH | S3 | guide `:1211` `[Annex §16 gap 9]` | No "15 days" anywhere, and retention is deferred to WP8. |

### F.4 Checked, not findings (so the next audit does not re-derive them)

Comments that *warn against* D11 or use "real" to mean "not a DCS artefact":
`correlation-match.js:29`, `nla.js:29-31`, `bay-view.js:1034`, `airspace-panel.js:120`, `geo.js:45`,
`app.js:143`, `track-panel.js:273`, `iff.js:5-8` (honest about reading the DCS coalition),
`board-store.js:1862` (TOFI side-of-exchange, `[Coord §3.2]`), `geojson.js:533` (runway numbers
are magnetic, now also decision H15), and `aprt-panel.js:447` (NATO phonetic alphabet).
Usage guide `:106` "(RAPCON)" and `:114` "Ankara Center" are the project owner's fixed operating
environment (guide `:9`, `:368`, `:372`), not claims.

---

## Defaults taken

Under decision P2, these are the briefing §9 defaults this inventory relied on, plus L9's own:

- **Q1**: an explicit disclaimer without the literal token counts as OKM, with a Group C row to add the token (C1).
- **Q2**: each client mirror needs its own marker (C14, C15). Mirrors already marked are in F30-F39.
- **Q3**: plain labels need no visible marker. Proposed instead: the B18 section, which is on the desk as E9.
- **Q4**: test-file markers are counted and listed in the appendix, not classified.
- **Q5**: ADRs are audited only where a usage-guide line or a code comment relies on them: `0059:171`
  (already corrected by `0060:40`), `0033:21` (E5) and `0036` (B4). Otherwise count only.
- **Q6**: unsourced real-world claims that are not about a SOURCE-DEFINED behaviour are in scope as PAD (B5, B9, D4, D8, D9).
- **Q7**: Group B is drafted by L20 in `docs/wip/L20.md` and folded by the integrator.
- **Q8**: roughly-true radar statements are still "our model" (B14, B17).
- **L9-own 1**: audited the branch head `cfcf344`, not `49e6bb2`, because that is the tree L20 will
  edit. Moved lines are listed at the top. C2 was already fixed; its code copy (D7) was not.
- **L9-own 2**: section-level citations count for untagged sub-clauses (F72). This is on the desk as E6.
- **L9-own 3**: a factually wrong provenance sentence inside a correct marker (D10) goes in Group D as OKM. It understates the guide rather than overclaiming, so it is not D11.
- **L9-own 4**: `radar-panel.js`'s `LTAG 40nm` (A2) is treated as "a figure attributed to a real
  facility" (briefing §4), even though it is a label. It is USD rather than PAD because it
  asserts nothing beyond the number.

---

## Appendix

### Test-file markers (Q4, counted, not classified): 5 in 2 files

- `crc-sync/tests/efsp-block-map.test.mjs:81` — ARRIVAL_BLOCK_MAP
- `crc-sync/tests/efsp-block-map.test.mjs:145` — OVERFLIGHT_BLOCK_MAP
- `crc-sync/tests/efsp-block-map.test.mjs:176` — MISSION_BLOCK_MAP
- `crc-sync/tests/efsp-nla.test.mjs:274` — ARRIVAL lifecycle
- `crc-sync/tests/efsp-nla.test.mjs:350` — OVERFLIGHT lifecycle

### ADR mentions (Q5, count only): 17 markers in 13 ADRs

`0008` 3, `0023` 2, `0079` 2, and 1 each in `0010`, `0013`, `0036`, `0037`, `0041`, `0043`,
`0050`, `0051`, `0059` and `0060`. Other docs: `efsp-wp6-plan.md` 7, `efsp-briefing.md` 5,
`efsp-parallel-plan.md` 4 and `efsp-usage-guide.md` 2. The planning docs in `docs/parallel/` have 86,
which are not audited.

### Commands used (from the worktree root, at `cfcf344`)

```bash
grep -rIn --exclude-dir=node_modules 'SOURCE-DEFINED' crc-sync/src crc-sync/config crc-sync/data crc-desktop/app
grep -rIn 'SOURCE-DEFINED' docs/efsp-usage-guide.md
grep -rIn --exclude-dir=node_modules -iE 'not doctrine|our own (choice|figure)|squadron.s (own|operating)|must (never|not) be presented' crc-sync crc-desktop/app docs/efsp-usage-guide.md
grep -rn -iE 'doctrin' crc-sync/src crc-sync/config crc-desktop/app/public
grep -rIn --exclude-dir=node_modules -E "FAA|7110|real[- ]world|NATOPS|AFI |DoD|NATO|Link 16|verified|Annex §|Coord §" crc-sync/src crc-sync/config crc-desktop/app/public/js
grep -rIn --exclude-dir=node_modules -iE "any real|real facilit|real controller|real military|real ATC|in practice|the way (ATC|real|military)|standard practice|in reality" crc-sync/src crc-desktop/app/public/js docs/efsp-usage-guide.md
grep -rnE "['\`\"][^'\`\"]*\b(standard|mandatory|reserved|not allowed|doctrine|FAA|DoD|NATO|real|must|requires?|only|never|rule)\b[^'\`\"]*['\`\"]" crc-desktop/app/public/js/panels/efsp crc-desktop/app/public/js/panels/track-panel.js crc-desktop/app/public/js/panels/radar-panel.js crc-desktop/app/public/js/geojson.js
grep -rnE "(detail|inhibited|reason|text|message|label|title): *['\`][^'\`]*(must|required|reserved|only|not allowed|mandatory|doctrine|rule|real|standard|AI )" crc-sync/src
grep -n "inhibited:" crc-sync/src/efsp/nla.js
grep -rn -iE "scramble|interceptor|priority|apvl|15 ?days|retention" crc-sync/src crc-desktop/app/public/js
grep -n 'SOURCE-DEFINED\|\[GAP' EFSPImplementationGuide.md
git diff --stat 49e6bb2 HEAD
```

Unswept: nothing in scope was skipped. The S3 module-header pass stopped at one row per module
(the briefing's instruction), so individual constants inside `conformance.js`, `stca.js` and
`presentation.js` are covered by their header rows (C6-C8), not listed one by one.
