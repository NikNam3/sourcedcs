# Briefing: LT-AIRSPACE-ALERT — airspace-entry alert and agency rights (ADR 0119)

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-LT-AIRSPACE-ALERT`, branch `lane/LT-AIRSPACE-ALERT`, `E2E_LANE=3`, commit at every
green step, a `wip(…)` checkpoint at least every ~15 min). Server and client. ADR **0119** is yours.

## Read first

- `docs/parallel/next/LIVE-TEST-FIXES.md` "### 8." and the Gates; T27 and T29 in `docs/parallel/live-test-2026-10-11.md`.
- `docs/parallel/research/live-test-faa.md` **Q8** (controlling vs using agency) and **Q9** (EDST aircraft-to-airspace
  alert); `docs/parallel/research/vfr-flight-following.md` **V3** and "Proposed model" (b). Quote them in ADR 0119.
- `docs/parallel/decisions.md` (decisions win): **H132**, **H134** LT-Q5, LT-RQ13, LT-RQ14; **H136** VQ4 b, VQ5;
  S-ARCH-51 (what LT-AIRSPACE-FIX left you), S-ARCH-56 (VFR test), S-ARCH-57 (the tracked set and per-session delivery).
- `docs/wip/LT-AIRSPACE-FIX.md` (its notes for you), `docs/wip/LT-VFR.md`, `docs/wip/LT-MARSA.md`; ADR 0098 §7
  (`activeContaining`); `crc-sync/src/efsp/airspace-store.js`, `authority/airspace.js`, `authority/positions/*.js`,
  client `airspace-capabilities.js`.

## Build

1. **Agency rights (H134 LT-RQ13 a; JO 7400.2R ¶21-1-8, ¶21-1-10, ¶21-1-11).** Only the **controlling Position** defines
   an airspace (create, edit shape, delete). The **using agency** (e.g. Incirlik OPS) schedules, activates, releases and
   approves entry. Per LT-AIRSPACE-FIX's note: OPS's `airspace` create/edit/delete rows go from `'FACILITY'` to `null` on
   both sides (server `authority/positions/*.js`, client hand copy `AIRSPACE_ROWS.OPS`, parity test), and the using
   agency's rights sit on `use` and the state ops. Update the tests it names.
2. **The entry alert (H132; H134 LT-Q5 a, LT-RQ14 a; H136 VQ4 b).** On **entry only** (actual containment, not
   predictive; the FAA's nearest equivalent is ERAM's predictive EDST probe, ¶13-1-1/13-1-2: cite it, label ours what
   differs). By airspace **type**, as the FAA (this makes `type` behavioural for the first time; say so in the ADR):
   - **Restricted, prohibited, and our range/danger types** (inference: restricted-like, from the research): any aircraft
     inside while ACTIVE without an approved entry alerts (14 CFR 73.13/73.15; ¶9-3-1 a–b).
   - **MOA and warning area:** a **tracked VFR** aircraft (a correlated Strip with no assigned ALT/HDG, the `_noClearance`
     test, now shared with the server, S-ARCH-56) never alerts (7400.2R ¶25-1-6 a, ¶24-1-3 d). A tracked IFR aircraft
     without approval alerts (ours, labelled).
   - **An uncorrelated contact** inside any ACTIVE airspace alerts (H134 LT-Q5; supervisor's reading of H136: it is not
     a tracked VFR aircraft). Only contacts that report altitude, or all? Decide with the MCI rule (H136 VQ8) in mind,
     log it.
   - Delivered to the controlling Position and the Position working the flight, using the per-session hook pattern from
     LT-MARSA (`conflictAlertFor`). Amber, acknowledgeable, retracts on leaving or on approval. Dark cockpit.
3. **Approval (H136 VQ5 a):** the existing `ApproveAirspaceEntry` by the using agency, or by the Position working the
   Strip relaying it, under the rights of item 1. A flight-following Strip (LT-VFR) is approved the same way.

## Gates

Both unit suites; `npm run freeze` (goldens: `freeze:update` once, separate commit); `npm run walk`; `soak:selfcheck`;
`npm run wire:record` (a new alert kind is a wire change; protocol stays 2); module-graph fixture; specs only for what you
touch, on lane 3 (`airspace-server` and a new spec for the alert). Never the full Playwright suite. Never touch
`crc-sync/state/`, :3000, `crc-desktop/config.json`, or shared docs (wording in `docs/wip/LT-AIRSPACE-ALERT.md`).

## Report

lane-rules rule 8: branch and commits, test counts, ADR 0119 summary, per item, the wire change, defaults taken, specs,
anything to decide.
