# Briefing: U-FREQ-EDITOR (server + client): a runtime frequency editor, ADR 0131

Written 2026-10-17 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-FREQ-EDITOR`, branch `lane/U-FREQ-EDITOR`, `E2E_LANE=9`). **Commit at every green
step, at least every ~15 minutes.** ADR number **0131** (yours).

Running beside you: **U-CLOCK** (mission-clock, mission-session, grpc-client, feed-handlers, topbar clock),
**U-PAR-VALUES** (PAR values; may add a store), **U-SMALL2** (tests/soak only). Stay out of their files. If you add a
synced store, `stores.js`, `app.js`, `ws-hub.js` and the wire record will conflict with U-PAR-VALUES: keep your hunks
small; the supervisor merges and re-runs `wire:record`.

## Why

**H154** (read it in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`): a frequency editor, in Settings or
as a separate panel. Today every station frequency is in the facility files (`positionFrequencies`,
`singleFrequencyApproach` in `crc-sync/config/efsp-facility-*.json`), read once at startup (P5): a change needs a file
edit and a restart (H147 RQ5 made them JSON-editable only). The controllers will now enter GND/TWR/CD/AP and SFA
frequencies themselves. Also H147, ADR 0048 (state/ over config/), dark cockpit H115–H119.

## Design (take the recommended default, log it, P2)

1. **A runtime frequency table** persisted in `state/` that overrides the shipped facility defaults per Position
   frequency and per SFA slot; P5 stays true for the config files (they are never written; the new state file is a
   store, like `apt-config` / ATIS frequencies in `crc-sync/src/apt-config.js`, which is the precedent to read first).
   Every consumer (`facility-config.js`, `placement.js`, SFA Racks/`sfa-state.js`, Strip templates, the SRS prefill,
   the bridge's `defaultFreq`?) reads the effective value; a change reaches clients live (no restart).
2. **Who may edit.** Recommended: any signed-on controller, audited (who, when on the mission clock, old → new);
   undo by setting it back. "Reset to default" per row.
3. **Where.** Recommended: a **separate dockable panel** ("Frequencies"): the values are squadron-wide shared data,
   while Settings holds a controller's own preferences. Grey table per Facility/Position, edit in place, a value
   differing from the default marked set (grey). Validation: the UHF/VHF ranges SRS accepts and 25/8.33 kHz steps
   (cite or label ours). Airspace working/control frequencies already have the airspace editor: leave them there.
4. **Effects of a change.** A Strip whose frequency came from the old value: does it follow? (cf. U-SMALL's
   `Placement.followSfaFrequency`). Recommended: Strips keep what was assigned (an assignment is a clearance fact); the
   table changes only new defaults. Argue it in the ADR.
5. Wire: an existing family if one fits, else a small new one; `npm run wire:record`.

## Tests, gates

Unit tests for the store (defaults, override, reset, persist/restore, strict shape on restore like `checkPersistedShape`),
rights, consumers reading effective values, hub delivery; client panel model. e2e: your panel's spec only,
`E2E_LANE=9`. Before the report: both unit suites, `npm run walk`, `npm run freeze`, `soak:selfcheck` if Board/wire/hub
moved, `wire:record`, module-graph fixture if exports change.

## Output

Commits; ADR 0131; `docs/wip/U-FREQ-EDITOR.md` (guide wording, defaults taken, questions for the human); final message
per rule 8.
