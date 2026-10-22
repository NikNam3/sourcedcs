# U-FREQ-ROWS: lane note

ADR 0138. H156 FQ-Q2 b (own Facility only) and FQ-Q3 b (add/remove rows at run time).

## Defaults taken (briefing's recommendations, P2)

- An added row is a run-time row, persisted like an override (`added` per Facility in `state/efsp-frequencies.json`),
  shown with the grey SET mark; its note says `added · <who> <when>`.
- A shipped row is never removed, only reset (`RemoveFrequency` on it: `VALIDATION_ERROR`). `ResetFrequency` on an
  added row: `VALIDATION_ERROR` (no default).
- An added SFA row in use is not removable: `FREQUENCY_IN_USE` (FQ-Q1 a).
- **Ours:** an added SFA frequency is always `SPARE` (rotation stays exactly three, initial contact stays the shipped
  one); its Rack id is the table's, `freq-<n>`, the next free number. A removed Rack's id can be reused by a later add.
- **Ours:** labels follow the facility-file rule (1 to 12 characters, unique within the Position); the client
  upper-cases what is typed, the server does not transform.
- **Ours:** own Facility = the Facility whose Position set holds the acting Position (the lookup that exists today,
  stores.js's `facilityOfPosition` pattern, as a private `_facilityOfPosition` in frequency-table.js). U-ROLE-POSITIONS'
  `facilityConfig.facilityOf` can replace it after the merge.
- Refusal code `FACILITY_MISMATCH` (ADR 0132 §4), added with the exact hunk U-ROLE-POSITIONS adds (refusal-codes.js and
  the client's refusal.js), so the merge sees identical changes.
- The panel keeps ADR 0131's one line "Sign on to a Position to set frequencies." only when the controller holds no
  Position anywhere; another Facility's rows carry no text (dark cockpit, briefing).
- A Facility the controller holds a Position in shows in the panel even with no frequency rows (CENTER), so one can be
  added.

## What the usage guide should say (docs pass)

FREQUENCIES panel: "You set your own Facility's frequencies: each Facility's rows are editable from one of its
Positions; another Facility's rows only read. ADD beside the Facility's name adds a frequency: pick the Position (or
SFA), type a label and the frequency, Enter. An added frequency is marked SET with `added`, and REMOVE takes it away. A
frequency from the facility file cannot be removed, only RESET to its default. An SFA frequency with a flight on it can
be neither changed nor removed: move or hand off the flight first. An added SFA frequency is a spare and gets its own
Rack in AP's SFA Bay."

CLAUDE.md strict-`state/` list should name `efsp-frequencies.json` (already owed from ADR 0131, S-ARCH-74).

## Files shared with U-ROLE-POSITIONS (minimal hunks)

- `crc-sync/src/efsp/facility-config.js`: overlay comment; `getPositionFrequencies` appends added rows (2 lines before
  `return out`); `getSingleFrequencyApproach` appends added pool entries (1 line); `getAllBays`' SFA line also sets
  `rackIds`. No signature line touched (U-ROLE-POSITIONS rewrites those).
- `crc-sync/src/efsp/wire/families/frequency.js`: doc comment, one `require` after the frames require, `fromCached`
  uses `rowMatchesOp`. Line 5 (`facilityOf ... DEFAULT_FACILITY_ID`) untouched; U-ROLE-POSITIONS replaces it.
- `crc-sync/src/efsp/refusal-codes.js`, `crc-desktop/app/public/js/panels/efsp/panel/refusal.js`: identical to
  U-ROLE-POSITIONS' hunk.
- `crc-desktop/app/public/js/panels/efsp/efsp-state.js`: `applyEfspFrequencyDelta` only.
- `crc-desktop/tests/fixtures/module-graph-exports.json`: five new frequency-state.js exports (re-record on conflict).

## Findings for other lanes

- `wire/families/frequency.js` line 5 still uses `DEFAULT_FACILITY_ID` on this base (U-ROLE-POSITIONS fixes it). With
  FQ-Q2 b the table refuses any op whose Facility is not the acting Position's, so after their change a message
  without `facilityId` simply acts on the acting Position's Facility.
- `frequency-panel.spec.js`'s header said "Run on E2E_LANE=9"; changed to "one E2E_LANE".

## Walks

- Add CD CLR as GC, CENTER sees it read-only, remove: spec. Add SFA freq-6 as AP, file an arrival on it (assigns
  237.1), remove refused while on it, move off and clear Block 22, remove: unit test. Restart restores added rows: unit
  test. Not walked: an added Position frequency on a Position a controller then signs onto mid-edit (the positions frame
  carries it; the PositionStore reads through a function).
