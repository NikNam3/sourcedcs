# Briefing: U-SUA (server + client): Transit complete, FAA area types only, prohibited always in force

Written 2026-10-26 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-SUA`, branch `lane/U-SUA`, `E2E_LANE=6`). **ADR 0144** (yours; amends ADR 0119,
0127, 0128 where they say otherwise). Read **H169, H170, H171** in `decisions.md` (grep the rows, never read the whole
file: it is 350 KB). The research is done: **`docs/parallel/research/sua-types-and-transit-end.md`** has the FAA quotes
and every file:line below; read its "What our app does today" sections (lines ~110–142 and ~329–372) and the inventory
at ~436, and do not re-research. H160/rule 9 bind you. U-PANELS-RADARS runs beside you (`panels/radar-panel.js` only).

## Build (commit each green)

1. **SUA-Q1 b: a "Transit complete" action.** Today an APPROVED transit ends only on release, last Strip gone,
   mission reset, or a decider's withdrawal (`airspace-store.js` ~776, ~963–992, ~893). Add a controller action
   that ends one APPROVED transit: offered to the Position holding the flight's live Strip and to the decider (same
   rights as the existing transit ops, `authority/airspace.js` ~132). One `EndTransit` audit line with trigger
   `COMPLETED` (or similar), all checks before the first write, Undo like the other transit ops. After it, a re-entry
   is unapproved again (it alerts and needs a new transit). Client: on the Strip's ⋯ (where the transit shows,
   `transit-rules.js`) and on the airspace card row. Keyboard path if the other transit ops have one.
2. **SUA-Q2 b: the decider sees it.** When a transit is completed, the decider's card row turns into a grey
   `transit complete` line until the decider acknowledges it, as H156 MTB-Q2 b did for a decline (find that path,
   `AcknowledgeTransit`, `transit-rules.js` ~108). It lifts nothing (H151 MT-Q3 c).
3. **SUA-Q3 a: `RANGE` and `DANGER` removed** as area types, no migration. Inventory (research ~436):
   `airspace-schema.js:22`, `airspace-entry-alert.js:66`, `authority/airspace.js:132-135`, client
   `airspace-capabilities.js:156`, `airspace-validate.js:12`, `airspace-layer-menu.js:14`, `airspace-editor.js:139`
   (and its hint text "MOA, range, danger area…"), `sourcedcs-web/public/js/airspace-admin.js:6`, the 12 test files,
   freeze goldens (`freeze:update`, separate commit). The RANGES Facility, `usingPositionId`, `controlFrequencyMhz` and the
   FREQUENCY edit scope stay (range control is a using agency). Strict restore already refuses an unknown type
   (`airspace-store.js` ~1065): keep it. Run `wire-protocol.test.mjs`; `wire:record` only if it asks.
4. **SUA-Q5 a: prohibited always in force.** A PROHIBITED area has no schedule or activation lifecycle and alerts
   whenever an aircraft is inside without an approved entry; entry approved by its using agency (or the Position
   relaying it, ADR 0119 §2); it keeps a controlling Position only so the alert reaches someone. Today:
   `ACTIVATION_BY_KIND.AREA`, schema ~286. Decide how its card looks (no Activate/Release buttons; a state shown as
   in force) and say so in the ADR.
5. SUA-Q4 a and SUA-Q6 a: build nothing (no alert/CFA/NSA, all joint use).

## Gates

Unit tests per item (both sides + parity). Both unit suites once before the report; `npm run walk`, `npm run freeze`,
`npm run soak:selfcheck`; sourcedcs-web `npm test` (you touch its admin page). Specs for what you touched only, on
`E2E_LANE=6` (`u-moa`, `airspace-*`, `moa-transit*`, boot smoke). `nice -n 19` on every command. Batch your reads
(several files per command) to keep steps few. Output `docs/wip/U-SUA.md` with the usage-guide text. Final message
per rule 8.
