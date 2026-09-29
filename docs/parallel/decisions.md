# Decisions for the parallel lanes

**Answering questions:** the human answers in the Decision Desk page (https://claude.ai/artifact/A3gizEgbwfqCnnU831G4Y7, source `docs/parallel/decision-desk.html`). Its answers live in the page's database, which persists across sessions and republishes; the supervisor copies every settled answer into this file, which is the record lanes read.

Kept by the supervisor (the main session; see `docs/efsp-parallel-plan.md` §1). Every lane reads
this before starting, and again whenever the supervisor says it changed. A decision here overrides
the "recommended default" in a lane's briefing.

Each entry: id, the question it answers (`questions-*.md` id or lane report), the decision, who
made it (`human` or `supervisor`), and the lanes affected.

## Standing process decisions

| Id | Decision | By | Lanes |
|---|---|---|---|
| P1 | One git worktree and branch per lane (`lane/L<n>-<slug>`), cut from the integration branch. Lanes commit only on their own branch; the supervisor merges in the order of `efsp-parallel-plan.md` §3 | human | all |
| P2 | A lane that meets an unanswered question takes its briefing's recommended default, logs it in `docs/wip/<lane>.md` under "Defaults taken", and carries on. It stops only if the default could destroy work or cross another lane's files | human | all |
| P3 | No lane touches the crc-sync running on :3000, or the shared docs (briefing, usage guide, CLAUDE.md, READMEs) | supervisor | all |
| P4 | **Corrections go in new prose; an ADR is never edited once committed.** A lane that changes something an earlier ADR decided writes its own ADR saying so. It never appends an "Update" to the old one (0014/0016's Update sections are historical and not a precedent) | human | all |
| P5 | **Tuning files are read once at startup and never written by code** (`alerting.json`, `sensor-specs.json`, any new one). A change applies on restart only. See ADR 0058 "Notes" | human | all |
| P6 | ADR numbers shift up by one: `0060` is the corrections ADR ("ADR errata"). Lane numbers are now L1 `0061`, L2 `0062`, L3 `0063`, L4 `0064`, L5 `0065`, L10 `0066`, **L7 `0067` (new — see D1)**. Later waves renumber in the plan | supervisor | all |

## Round 1

| Id | Question | Decision | By | Lanes |
|---|---|---|---|---|
| D1 | L7 briefing: append an `## Update` to ADR 0021? | **No** (P4). L7 writes ADR `0067`, which says what it changes about 0021 | human (P4) | L7 |
| D2 | L2 needs one-line edits in `strip-view.js:331` and `bay-view.js:721`, not on its shared-file list | **Allowed**, as additive one-line changes; list them in the L2 report. `strip-view.js` is otherwise touched in wave 1 only through `_stripAlerts`/`_buildIndicator` (L7's timer slot) — keep edits to separate functions | supervisor | L2, L7 |
| D3 | L7 wants Playwright lane 7 in wave 1 | **Yes.** Lane 7 is free until L16 (wave 2) | supervisor | L7 |
| H1 | Q46/Q47/Q48 — what format is the squadron's ATO? | **USMTF is the interface between systems.** The atobrief YAML is atobrief-internal. Anything that exchanges ATO data talks USMTF, and **atobrief must provide a USMTF export/API** (new lane L11, wave 1, atobrief only). L3 parses USMTF only: no YAML adapter, no YAML dependency. L3 always emits a normalised callsign and flags missing acceptance fields per mission (so L14 can fall back to callsign binding). L3's fixtures are hand-written USMTF modelled on the researched set layouts (see `docs/parallel/research/usmtf-ato.md` when it lands) | human | L3, L11, L14 |
| H2 | Q89 — what does the AIC do with a mission line? | **TAC_C2 transfers it in at check-in (ON_STATION); AIC moves it between On Station and Committed and annotates, never advances state; transfers back to TAC_C2 to go OFF_STATION.** AIC gets an update in a future version: build it **modularly**, so the tactical Strip system (MISSION roles, AIC/GCI/JTAC capabilities) can be expanded without rework | human | L8 (and every tactical lane) |
| H3 | Q96 + L10 Q1/Q3 — IFF from interrogation | **Accept the L10 §5.3 table (option a).** A valid Mode 4 reply = own coalition **and** Mode 4 switched on (coalition models the crypto key, never the answer). No valid reply → `bogey`, except a Mode 3/C reply to an SSR radar → `neutral`. Automatic IFF never produces bandit/hostile | human | L10 |
| H4 | Q97 — do own AI and ships answer Mode 4? | **Yes**: own AI aircraft and ships reply automatically; ground vehicles answer nothing (bogey unless declared) | human | L10 |
| H5 | Q98 — ATC radars and Mode 4 / colour | **ATC scopes get their own draw scheme, distinct from military radar** — modelled on STARS (research + design artifacts first, `docs/parallel/research/stars.md`; a later lane builds it). **Where one track is seen by both a military and an ATC radar that the session holds, the military presentation wins.** L10 builds the IFF model only; it does not decide ATC symbology | human | L10, new scope-symbology lane |
| H6 | Q99 — the `invisible` / ground-clutter rule | **No hiding for now.** An aircraft on the ground is presented like any other contact (A2); `invisible` goes. An own player with no SRS is primary-only, and that is fine — such players "shouldn't exist". **Every declutter behaviour is disabled until the very end of the EFSP work** (ground clutter, and the formation label declutter `settings.declutter` / `getDeclutteredIds`): L10 removes `invisible` and turns the formation declutter off (default off, code path left in place, marked for revisit) | human | L10 |
| H7 | Q100 — own player with no SRS | **Bogey** (primary only; friendly only to a datalink session if its type participates) | human | L10 |
| H8 | Q6 — which lane ADRs the human reads before merge | **The product-facing ones only**: 0061 field state, 0062 MTR placement, 0064 carrier design, 0066 IFF colours. The supervisor accepts the rest | human | L1, L2, L4, L10 |
| H9 | Q10 — what the human sees at the wave-1 merge | L2's Playwright screenshots, L10's before/after colour table, L9's inventory items needing answers, and the H8 ADRs | human | L2, L9, L10 |
| H10 | Q11 — does L2 need an approved mockup first? | **Yes, mockup first.** L2 makes the mockup and hands it to the supervisor. The supervisor brings it to the human and relays approval or changes back to L2. Meanwhile L2 carries on with server-side work only | human | L2 |
| H11 | Q13 — which clock EFSP times mean | **In-game UTC is authoritative, always.** Every EFSP time gate, the Strip clock, vul windows, push times, metrics buckets and MTR times use the DCS mission clock converted to Zulu, never the wall clock. The theater's local offset is **fixed per theater** in a shipped table (Syria: local = Z+3), not a controller setting. Today the offset is a synced setting edited in the APRT panel and applied client-side, which is wrong. **Pre-wave fix F1**: crc-sync owns a `MissionClock` (`now()` = in-game Zulu, ms), EFSP code takes it by injection instead of `Date.now()`, the offset comes from the theater table, and the APRT offset field goes. Wave-1 lanes call the injected clock, never `Date.now()`, for anything a controller reads as a time | human | all |
| H12 | Q14 — manning and traffic | **1–4 controllers, 3–20 aircraft.** Session length unanswered: assume 2–3 h. L6's soak profile goes up to 20 aircraft with 1 controller holding every Position as the worst case | human | L1, L5, L6 |
| H13 | Q15 — squadron types, bases, map | **Incirlik (LTAG) is the main field; Konya (LTAN) and Akrotiri (LCRA) are used from time to time. The carrier is CVN-72 (unit `UNION` in DCS)**, not CVN-75 Truman. Syria only for now, but **every theater is coming eventually**: nothing hardcodes Syria; theater-specific values sit in per-theater tables (like F1's offset table) | human | all, esp. L1, L4, L10 |
| H14 | Q16 — one own coalition per server? | **No. Both coalitions may be controlled at the same time on one server.** A red controller and a blue controller must be able to work at once **without either knowing the other exists**, and neither may see or edit the other's Strips, FDRs, tags, declarations, alerts or presence. `CRCSYNC_COALITION` as one global "own" side is wrong. **Wave-1 rule now:** no new code may read a global own coalition; coalition comes from the acting session/Position (pass it in). The isolation itself is a new lane (**L21 coalition isolation**, design ADR first); its timing is on the Decision Desk (C1/C2) | human | all, esp. L1, L7, L10 |
| H15 | Q20 — magnetic vs grid | **Magnetic, always**, for every displayed heading, course, bearing and radial. Variation comes from a per-theater source (not a controller setting); `hdgCorrection` as a manual setting goes. L4 computes in true and converts at display with the variation. Delivered with or after F1 (same per-theater table idea) | human | L4, L10, all UI |
| H16 | Q22 — the real ATO as a fixture | Use the newer squadron package **`/home/nklx/Downloads/ojw1v5.yaml`** as the reference (it supersedes `Flashbang 1.6.yaml`). No objection given to committing it, so the default holds: a **trimmed copy with callsigns anonymised** may be committed as a fixture (L11 on the atobrief side; L3 stays USMTF-only per H1 and uses L11's output or hand-written USMTF) | human (default b) | L3, L4, L11 |
| H17 | Q31 — Incirlik arresting gear | **DCS doesn't simulate arresting wires. Gear is a stub**: keep the data shape, no gear inventory flows or barrier-change machinery beyond it in L1 | human | L1 |
| H18 | Q32 — who closes and opens a runway | **TWR only.** Tower is the sole authority over the runways. OPS, RSU and others can only **request** that TWR close or open one (a request TWR accepts or rejects), never do it themselves | human | L1, L18 |
| H19 | Q33 — emergency onto a suspended runway | **(a)** Nothing special in L1: the Strip waits; `FINAL → LANDED` stays uninhibited. The audited override stays a candidate in `docs/wip/L1.md` | human | L1 |
| H20 | Q34 — runway change with OPS or APP unmanned | Human: "question doesn't make sense, use an earlier answer". Supervisor reading: under H18 TWR alone decides a runway change, so acknowledgements are **coordination, not permission**. An unmanned APP is covered by CTR (§4.1 reversion); an unmanned acknowledger with no cover is **skipped and audited**, never a deadlock. With S-Q24, a controller holding TWR and the acknowledgers self-coordinates in one input | supervisor (from H18) | L1 |
| H21 | Q37 — hot cargo pad, alert pad, hung-ordnance direction | **(b)** Placeholders, names only, no preferred direction; the advisory states the fact without recommending a runway | human | L1, L12, L13 |
| H22 | Q38 — default active runway at boot | **(b) Derived from the mission wind at load** (the end most into the wind), then TWR changes it. Not a config default | human | L1 |
| H23 | Q41 — MTRs | **The squadron flies MTRs.** Syria is treated as if under US regulation. The human will supply the route list later: **free text now**, a config table when the list arrives | human | L2, L16 |
| H24 | Q42 — Positions showing the MTR group | **(a)** The briefing default | human | L2 |
| H25 | Q43 — MTR amendment history | **(a)** No history cell in L2; the gap is recorded and fixed once for all `fdr` Blocks later | human | L2 |
| H26 | Q56 — carrier and types | **CVN-72 `UNION`, for all carrier aircraft** (one hull). Recovering types and Supercarrier per the briefing default | human | L4, L17 |
| H27 | Q57 — marshal radial | **Settable by the marshal controller; default final bearing + 180** | human | L4, L17 |
| H28 | Q58 — stack compression | **(a)** No automatic compression; the controller re-sequences in one gesture | human | L4 |
| H29 | Q59 — stacks | **(a)** One in v1, keyed by stack id | human | L4 |
| H30 | Q60 — FACSFAC, APP split | **(a)** No FACSFAC in v1; `DUE_REGARD` inside the CCA; alternating APP lanes `[SOURCE-DEFINED]` | human | L4, L17 |
| H31 | Q61 — approach buttons | **(a)** chosen with no list given, so: validated integer, no defaults, until the human supplies the squadron's buttons | human | L4 |
| H32 | Q64 — a metrics session | **(a)** One DCS mission load to the next, with rolling one-hour windows beside it | human | L5, L15 |
| H33 | Q66 — local vs transient | **(a)** Departs and lands at the same Facility's airfield, `[SOURCE-DEFINED]` | human | L5 |
| H34 | Q67 — formation counting | **(a)** One operation, aircraft count recorded | human | L5 |
| H35 | Q71 — metrics visibility | **(b)** Everyone authenticated, per-person breakdowns hidden | human | L5, L15 |
| H36 | Q78 — finished flights | **(a)** Archive DROPPED Strips (and FDRs with no live Strip) after 2 h or at mission change, once L5 has counted them; the log keeps history. Scheduled in wave 2 | human | L6, wave 2 |
| H37 | Q80 — the 4-hour soak | **(b)** A manual-dispatch GitHub workflow. L6 writes it | human | L6 |
| H38 | Q83 — `AMENDMENT_INSIDE_30MIN` | **(a)** 60 s flash accepted now; (b) stays a follow-up | human | L7 |
| H39 | Q88 — acknowledging obligations | **(a)** No; alerts clear only when their condition clears | human | L7 |
| H40 | Q90 — what the JTAC sees | **Only the Strips TAC_C2 has handed off to the JTAC**, with the same transfer-in / transfer-back model as the AIC (H2). Nothing else is visible to a JTAC. L8's scenario asserts this; JTAC binding/MARSA (B5) stays a bug to fix | human | L8 |
| H41 | S1–S10 — ATC draw scheme (mockups `research/stars-mockups.html`, "looks perfect") | **Variant B (STARS on the app map) for every ATC Position now; ERAM (C) kept for CTR later** as its own lane. Everything the mockup shows stands: per-contact `scheme: 'TACTICAL'\|'ATC'` with ~2 sweeps of hysteresis (S1); letters T/A/C (S5); `CST` coast hold (S6); `+` for primary-only (S7); per-track mixing, tactical wins (S8); ADR 0058 conformance tag and CPA overlay kept (S10). **New personal setting**: "ATC map background" off → black scope with the strict-STARS (A) palette, next to the existing elevation-contours option; per user, client-only, conformance tag and CPA overlay stay either way. Still open: S2 (hostiles on ATC scopes), S3 (owner letter after TOFI) | human | L22 |

## Supervisor rulings on the round-1 blocking questions

| Id | Question | Decision | By | Lanes |
|---|---|---|---|---|
| S-Q1 | Q1 — worktrees see only committed files | **(a)** Commit the plan, `docs/parallel/` and the wave-1 briefings to the integration branch before cutting worktrees (on the human's go-ahead to commit). Lanes read this file by absolute path, `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`, so mid-wave rulings reach them without a rebase | supervisor | all |
| S-Q3 | Q3 — shared files missing from plan §2 | **(a)** `crc-sync/tests/helpers/efsp-scenario.mjs` and `crc-desktop/app/public/js/app.js` are append-only. `crc-sync/src/ws-hub.js` is serialised L7 → L10. `crc-sync/server.js` is serialised L7 → L5. L10 and L5 rebase their small hunks onto L7 | supervisor | L1, L5, L7, L8, L10 |
| S-Q23 | Q23 — a Runway record per direction or per pavement | **(a)** One record per physical runway: `{id:'05/23', ends:['05','23'], status, arrestingGear:[{end, position, distanceFt, type, state}]}`. The Facility holds `activeRunway:'05'`, and each Rack maps to an end | supervisor | L1 |
| S-Q24 | Q24 — a solo controller changing runway | **(a)** A one-input `SelfCoordinateRunwayChange`, legal only when the session is Primary on TWR and on every acknowledger Position. One Mutation, each Position named, `selfCoordinated:true`. The D21 test becomes "an ack sent as TWR never counts as APP's" | supervisor | L1 |
| S-Q25 | Q25 — a Strip with no runway Rack and no 8A | **(a)** Rack, then FDR field, then the Facility's `activeRunway`, then fail open. Record which source resolved it. §10.2 default assignment stays its own slice | supervisor | L1 |
| S-Q50 | Q50 — L3 output shape | **(a)** Per mission: `{ fdrSeed, military, extras, warnings }`. `fdrSeed` holds only what `createFdr` accepts today, `military` the §12 fields for L14, and `extras` the rest verbatim. No FDR schema change in L3 | supervisor | L3, L14 |
| S-Q65 | Q65 — metrics source of truth | **(a)** In-memory counters fed at dispatch, snapshotted to `state/efsp-metrics.json`, plus a reconcile function that recomputes the traffic count from the Mutation log (used by the test and on demand) | supervisor | L5 |
| S-Q82 | Q82 — obligations inside `efsp-alerts` | **(a) Confirmed.** One compose function builds the message. A test proves that a conformance-only tick does not clear obligations | supervisor | L7 |
| S-ALL | Every other round-1 question marked SUPERVISOR | **Its Recommended option**, unless a row above or a later row says otherwise. A lane that finds a recommendation wrong in practice raises it in `docs/wip/<lane>.md` instead of silently deviating | supervisor | all |

## L11 briefing open questions (supervisor)

| Id | Question | Decision | By | Lanes |
|---|---|---|---|---|
| S-L11 | L11 §10 Q1, Q3–Q7, Q9–Q13 | **Briefing defaults accepted**: strip `MSN` from mission numbers (the join key downstream); loadout codes verbatim; datalink slots `-`; auth = `ATOBRIEF_USMTF_TOKEN` or role-bearing JWT (unsigned decode, like the siblings); `EXER`; `SOURCE DCS`/`US`/`F` as per-document defaults (H14); one `GTGTLOC` per timed target; no SPINS C1.3 mapping; DMPI = target coords; room API + stateless POST is enough for now; the integrator wires the token into compose | supervisor | L11, L3, L14 |
| S-L3a | L11 Q9 knock-on for L3 | **L3's `DUPLICATE_SET` rule exempts repeated `GTGTLOC`** (several timed targets per mission are legal) | supervisor | L3 |
| — | L11 Q2 (classification marking), Q8 (agency types ABM/IC/RADAR) | On the Decision Desk as L11-2 and L11-8; lanes take the briefing default until answered | — | L11, L3 |

*(the rest filled in after the questioning round)*
