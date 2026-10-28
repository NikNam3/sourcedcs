# Briefing: U-TWR-PATTERN (server + client, wire change): no RSU; the tower works pattern traffic — ADR 0126

Written 2026-10-15 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-TWR-PATTERN`, branch `lane/U-TWR-PATTERN`, `E2E_LANE=7`). **Commit at every green
step, at least every ~15 minutes.** ADR number **0126** (yours; supersedes ADR 0120's RSU model, never edit 0120).

## Why

**H149** (read whole in `decisions.md`): a real RSU is manned by pilots with only a landline to the tower, not an ATC
unit, so the CRC suite has **no RSU**. The tower (**LC**) gets the pattern features. **H150**: TWR-Q1 **a** (on LC's
ordinary Strips) and REL-Q1 **b** (transfers inside a Facility stay plain: no Released switch, no check-in). Background
only: ADR 0120 and `docs/wip/U-RSU-DESIGN.md` (its Block names, list columns and mockup are reusable ideas; its RSU,
`HANDED_TO_RSU`, `CancelIfr`, guards and handoff are void). H128 FAA model, always (pattern work is JO 7110.65 Ch. 3:
find and cite the paragraphs for closed traffic, the options — touch-and-go, stop-and-go, low approach, full stop — and
straight-in, AIM 4-3-3/4-3-22 for the pilot side); dark cockpit (H115–H119).

## What to build

1. **Remove the RSU Position everywhere** (`command grep -rln RSU crc-sync/src crc-sync/config crc-desktop/app/public/js
   crc-desktop/e2e crc-sync/tests crc-desktop/tests`): Position tables (`incirlik-military.js`, `civil-atc.js`,
   `authority/index.js`), facility schema and `config/efsp-facility-incirlik.json` (roster, classes, consolidation,
   Bays, frequencies), combination rules (server + client), block map, stereo routes, `handoff-guards.js` comments,
   client topology/NLA/fields/formation/runway-status rules. The **RSU's `rsu-pattern` Bay and its PATTERN Strips go**.
   **The carrier keeps `PATTERN`/`IN_PATTERN`** and anything it uses (`pattern-board.js` if the carrier still mounts it;
   check `bay-views.js` and `config/efsp-facility-carrier*.json` before deleting): carrier changes are U-CARRIER's.
2. **Pattern features on LC's ordinary Strips** (TWR-Q1 a):
   - two small editable cells: **PAT / STR** (in the pattern vs straight-in) and **T&G / FS / LA** (touch-and-go, full
     stop, low approach; no stop-and-go, H147 RQ7 stands) — Blocks set with `SetBlock` (reuse ADR 0120's `9J-ENTRY` /
     `9J-OPTION` names or pick better ones; ADR says which), editable by whoever holds the Strip (AP before the
     transfer, LC after);
   - an **IN PATTERN** mark when the flight is in closed traffic (grey, dark cockpit), set/cleared by LC (an existing
     state or a Block: your design, the ADR says why);
   - pattern Strips in **their own Rack in LC's Bay** (e.g. "Pattern"), next to the existing arrival/departure Racks;
   - **leaving the pattern**: full stop → the ordinary landed/taxi-in flow to GC; departing the pattern → the ordinary
     LC departure flow (to AP or, VFR, terminate); the pilot then calls APP like any VFR aircraft (H138 U15 stands).
   - a local departure can stay in closed traffic with LC without going to AP (the old RQ10 b need, now LC's).
3. **Frequencies (H147 RQ5, stands for every station):** audit server and client for any hardcoded station frequency;
   every one must come from JSON config (`config/comm-card.json`, the facility files, a `state/` copy overrides). Fix any
   literal you find; list the audit in the wip note.
4. **REL-Q1 b:** AP→LC / AP→PAR stay plain transfers (no change needed, U-RELEASE's default). Note it in the ADR.

## Tests and gates

Both unit suites; `npm run walk`; `npm run freeze` + `freeze:update` (separate commit, explain the diff: RSU removal
moves goldens); `soak:selfcheck` (Board/authority moved; the soak driver must not use the RSU); `npm run wire:record`
(Position/strip-type/op surface changes; protocol stays 2 unless the tool says otherwise). e2e: update/remove every spec
using RSU (`l18-incirlik`, …); new: LC sets STR + T&G on an arrival, marks IN PATTERN, the Strip moves to the Pattern
Rack, full stop goes to GC; a local departure stays in closed traffic. `E2E_LANE=7`, your specs only.

## Output

Commits on `lane/U-TWR-PATTERN`; ADR 0126 (cites the FAA paragraphs; says what is ours); a mockup update if the LC Strip
face changes visibly (`docs/mockups/`); `docs/wip/U-TWR-PATTERN.md` (usage-guide wording, defaults, frequency audit,
**`state/` actions for the human**: an old `state/efsp-board.json` with RSU Strips and a `state/efsp-facility-incirlik.json`
naming RSU will stop start-up); final message per lane-rules rule 8.
