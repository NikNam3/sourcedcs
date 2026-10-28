# Briefing: U-FREQ-ROWS (server + client): add and remove frequency rows; edit only your own Facility

Written 2026-10-22 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-FREQ-ROWS`, branch `lane/U-FREQ-ROWS`, `E2E_LANE=7`). **Commit at every green
step, at least every ~15 minutes.** ADR number **0138** (yours; P4: ADR 0131 is never edited, yours supersedes the parts
you change).

v2 includes SFA (H159): keep it small, plain unit tests plus the frequency panel's spec.

Running beside you: **U-ROLE-POSITIONS** (lean: `authority/`, `position-store.js`, `facility-config.js`, every
`DEFAULT_FACILITY_ID` user, client sends) and **U-CARRIER** (carrier family, MARSHAL/PriFly panels, carrier map). Stay
out of their files. For "the Position's Facility" use the lookup that exists today (rule 9: never
`DEFAULT_FACILITY_ID`, never a literal id); if only U-ROLE-POSITIONS' `facilityOf` would do it cleanly, write a tiny
local helper and say so in your report.

## Items (decisions in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`: H154, H156 FQ-Q1..Q3; ADR 0131)

1. **FQ-Q3 b: controllers add and remove frequency rows at run time** in the FREQUENCIES panel
   (`crc-desktop/app/public/js/panels/efsp/frequency-panel.js`, `frequency-state.js`; server
   `crc-sync/src/efsp/frequency-table.js`, persisted in `state/efsp-frequencies.json`). Rows: Position frequencies and
   SFA pool frequencies. Recommended: an added row is a run-time row (shown set, grey) that persists like an override;
   a shipped row cannot be removed, only reset to its default (removing a shipped Position's frequency would leave a
   Position with none); an SFA row in use is not removable (FQ-Q1 a: refuse a change in use, same refusal). Validation
   as today (ranges, channel steps). Audited like edits. `npm run wire:record`. The strict `state/` shape check
   (`checkPersistedShape`) must accept the new rows and still refuse unknown keys.
2. **FQ-Q2 b: a Primary edits only its own Facility's frequencies** (change from built: today any Primary at any
   Position, `frequency-table.js` l.19). "Own" = the Facility of the acting Position (ADR 0132 §3: the one acting
   Position, not "any Position the controller holds"). New refusal code if none fits (join `REFUSAL_CODES`). Client:
   other Facilities' rows read-only (grey, no edit affordance), no explanatory text (dark cockpit).

## Gates

Both unit suites, `npm run walk`, `npm run freeze` (goldens: `freeze:update`, small diff, separate commit),
`soak:selfcheck` if Board/wire/hub moved, `wire:record`, module-graph fixture if exports change. Specs: the frequency
panel's spec (find it) on `E2E_LANE=7` only. Every command under `nice -n 19`.

## Output

Commits; ADR 0138; `docs/wip/U-FREQ-ROWS.md` (guide wording, defaults taken); final message per rule 8.
