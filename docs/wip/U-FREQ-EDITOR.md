# U-FREQ-EDITOR: the runtime frequency editor (ADR 0131, H154)

Lane notes, 2026-10-17. Branch `lane/U-FREQ-EDITOR`.

## What was built

- **crc-sync**: `src/efsp/frequency-table.js` (the table, strict state file `state/efsp-frequencies.json`,
  `CRCSYNC_EFSP_FREQUENCIES_PATH`), `facility-config.js` frequency overlay (effective getters, `getShipped*`),
  `PositionStore` reads frequencies through a function, wire family `wire/families/frequency.js`
  (`efsp-frequency-mutation` / `-ack` / `-delta`, snapshot key `frequencies`), `frequencyDelta` in `wire/frames.js`,
  refusal `FREQUENCY_IN_USE`, wire surface recorded. Soak host and `.env.example` name the new path.
- **crc-desktop**: `panels/efsp/frequency-state.js` (leaf model, drift-tested), `panels/efsp/frequency-panel.js`
  (FREQUENCIES dock panel), `efsp-state.js` `applyEfspFrequencyDelta` (moves Positions' `frequencies` and the SFA Bay's
  `sfaPool`), `efsp-ws.js` `sendEfspFrequencyMutation`, dock/PANELS registration, `css/frequency-panel.css`, refusal
  wording, e2e harness redirects the file, `e2e/frequency-panel.spec.js` (lane 9).

## What the usage guide should say (for the supervisor to place)

> **Frequencies.** Open FREQUENCIES from the PANELS list. It lists each Facility's station frequencies (each Position's
> GND/TWR/... and the SFA pool). Click a value, type the new one, Enter. A value you or another controller set shows a
> grey SET with the default and who set it when; RESET puts the default back. Everyone sees a change at once. You must
> be Primary at some Position to edit. A frequency already given to a flight is not changed: an SFA frequency with a
> flight on it cannot be changed until that flight is moved or handed off. The airspace frequencies are edited in the
> airspace editor.

And for `docs/efsp-briefing.md` / CLAUDE.md's state/ paragraph: `state/efsp-frequencies.json` joins the strict state
files (ADR 0131); `CRCSYNC_EFSP_FREQUENCIES_PATH` overrides it.

## Defaults taken (P2)

1. **Where**: a separate dockable panel (briefing's recommendation), not a Settings tab.
2. **Who**: any controller Primary at any Position, any Facility (`primary-somewhere` gate). An Observer cannot edit.
3. **Audit / undo**: Mutation log line per change and per refusal (who, mission-clock `at`, before, after); undo = set
   it back; ResetFrequency per row.
4. **Concurrency**: last write wins, no rev / STALE_REV.
5. **Effects** (briefing item 4): assignments are not rewritten. Position frequency change touches no Strip. SFA pool
   change is **refused (`FREQUENCY_IN_USE`) while any live Strip of the Facility has a flight on the current
   frequency** — chosen over "Strip follows" (it would move a Strip whose pilot is still on the old frequency) and over
   "Strip keeps it on the Rack" (the Rack would no longer say the flight's frequency). New refusal code.
6. **Editable fields**: the frequency value only. Labels, Racks, SFA `use` and the row set stay in the facility file.
7. **Validation**: ADR 0105's 30–400 MHz and ADR 0117's UHF 225–399.975 range; channel grid **[OURS]**: 25 kHz, plus
   8.33 kHz channel names in 118–137 MHz. SFA frequencies unique in the pool. No check that an SFA frequency differs
   from a Position frequency.
8. **Storage**: own state file, not the Board snapshot (survives a mission reset; keeps `stores.js` untouched, so no
   conflict with U-PAR-VALUES there). Strict on load (unknown key, unknown row, bad value, duplicate SFA → start-up stops).
9. **SRS `defaultFreq`** (crc-desktop config.json) left alone: a personal setting, not a station frequency.
10. No seq / no STORE_SYNC entry: the delta carries the Facility's whole table; snapshot on reconnect.

## Walks

- Pilot on an SFA frequency while AP changes it: refused, detail names the frequency; once the Strip leaves (handed
  to LC, dropped) the change goes through. Missed approach back to AP afterwards: `transferTargetFor` finds the Rack of
  the flight's (old) frequency only if the pool still has it; with the pool changed after the flight left the pool,
  the Strip lands in AP's ordinary Bay. Not walked in a test.
- Combined Positions: the "Monitor ..." line (combination.js) goes through `PositionStore#frequenciesOf`, which the table test checks reads the effective value; the combination itself was not re-walked.
- Not walked: two controllers typing in the same row at once (last write wins, both audited).

## Questions for the human

- Q1 (default 5): is refusing an SFA frequency change while a flight is on it right, or should the controller be able
  to force it (the flight keeps its old frequency and leaves the SFA Rack)?
- Q2 (default 2): should editing be limited to the Facility's own Positions (e.g. only INCIRLIK controllers change
  INCIRLIK frequencies), or OPS only?
- Q3 (default 6): should controllers be able to add a frequency row (e.g. a second GND, ATIS) at run time, not only
  change values?

## Findings for other lanes

- U-PAR-VALUES: `tools/wire-surface.js` `storeOpKinds` and `tests/fixtures/wire-surface.json` both gained a line here;
  the supervisor re-runs `npm run wire:record` after the merge.
- The e2e harness (`e2e/helpers/harness-env.js`) must redirect every new state file; any new store file in another lane
  needs the same line, or an e2e run writes into the worktree's `crc-sync/state/`.
- **Any new `SyncedStore`** (U-PAR-VALUES may add one) mints an epoch with `crypto.randomUUID()` at construction. The
  soak and freeze hosts seed that call, so one extra store shifts every later seeded id and the random freeze traces
  diverge far from the change (here: `hub-random-seed1` from step 599, a MoveStrip neighbour pick). This lane's table
  first extended `SyncedStore` and hit exactly that; it is now a plain class (no seq, no epoch). A store that does need
  an epoch should expect the random-seed goldens to move, and say so when it re-records them.
- Freeze goldens here moved only for the snapshot's new `frequencies` key (snapshot / resync-reply hashes) and the
  three new message types in `tables-wire-message-types`; re-recorded with `npm run freeze:update` in their own commit.
