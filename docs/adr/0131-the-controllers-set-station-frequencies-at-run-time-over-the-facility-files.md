# 0131: The controllers set station frequencies at run time, over the facility files

**Status.** Accepted (lane U-FREQ-EDITOR, 2026-10-17). Rulings: decisions.md **H154** (a frequency editor; the
controllers enter GND/TWR/CD/AP and SFA frequencies themselves), **H147** RQ5 / **H149** (no station frequency hardcoded,
every one editable), ADR **0048** (`state/` over `config/`), dark cockpit (**H115–H119**). Builds on ADR 0105 (Position
frequencies) and ADR 0117 (the SFA pool). Supersedes nothing.

## Context

Every station frequency lives in a facility file: `positionFrequencies` (`{ <Position>: [{ label, mhz }] }`, ADR 0105)
and `singleFrequencyApproach.pool` (`[{ rackId, mhz, use }]`, ADR 0117). The files are read once at start-up (P5), so a
change needed a file edit and a restart. H154 hands those values to the controllers: they set them in the running system.
The airspace working and control frequencies are already editable, in the airspace editor, as part of the airspace
record; they stay there.

## Decision

### 1. A runtime frequency table over the shipped defaults

`crc-sync/src/efsp/frequency-table.js` keeps the frequencies a controller set, per row: one Position frequency
(Facility, Position, label) or one SFA pool frequency (Facility, Rack). The facility files are never written (P5); they
are the **defaults**. The table is persisted in `state/efsp-frequencies.json` (`CRCSYNC_EFSP_FREQUENCIES_PATH`), and it
keeps only rows that differ from the default, each with `mhz`, `setAt` (mission clock, ADR 0079) and `setBy`. Setting a
row back to its default removes it. No shipped `config/` copy exists: a missing file means every row is its default.

It is its own file, not a key in the Board snapshot: the frequencies are squadron data that outlive a Board (a mission
reset, ADR 0108, does not touch them) and they are not part of the Board's persisted shape.

The file is **strict**, like every `state/` file holding controller data (ADR 0095): invalid JSON, an unknown key, a
Facility/Position/label/Rack the facility files do not have, a frequency §4 would refuse, or an SFA pool frequency given
twice stops start-up naming the file. There is no migration; correct or delete it.

### 2. One effective value, read by every consumer

`facility-config.js` holds the table's values as a frequency overlay and answers with the effective value:
`getPositionFrequencies`, `getSingleFrequencyApproach` and the SFA Bay's `sfaPool` in `getAllBays`. The shipped values
stay reachable as `getShippedPositionFrequencies` / `getShippedSingleFrequencyApproach` (the table's defaults). So every
consumer follows a change at once with no change of its own: the PositionStore (it now reads the frequencies through a
function, so the positions frames and the combination's monitor list are current), sfa.js's rack <-> frequency lookup
(placement, `assignSfaFrequency`), the snapshot's Bays, and the client's SFA rotation rows.

The SRS bridge's `defaultFreq` (crc-desktop `config.json`) is not a station frequency: it is what this controller's own
added radio tunes to, a personal setting. It stays where it is. The SRS radio panel has no station prefill to follow
(H147 RQ5 already left an unset radio empty).

### 3. Who may edit, and how it is recorded

Any controller **Primary at any Position** may set any Facility's frequencies (the wire family's `primary-somewhere`
gate, correlation's). The values are shared squadron data, not a clearance, and the controllers working the field are
the ones who know them. Every change and every refusal reaching the table is audited in the Mutation log: who
(`actorId`, `actingPositionId`), when (`at`, mission clock), the row, `before` and `after`. **Undo** is setting it back;
**ResetFrequency** returns a row to its default. Last write wins (no rev): the table is small, every delta carries the
whole Facility's rows, and both writes are in the log.

### 4. Validation

A Position frequency is a number from 30 to 400 MHz (ADR 0105's range, `airspace-schema.js`); an SFA frequency is UHF,
225 to 399.975 MHz (ADR 0117), unique within the pool. Both must be on a channel. **[OURS]**: in the VHF aeronautical
band (118 to 137 MHz) a 25 kHz channel or an 8.33 kHz channel name (within each 25 kHz block the names end .x00, .x05,
.x10, .x15; .x20 is not one); elsewhere (VHF FM, UHF) the 25 kHz grid, which every shipped value and the DCS radios we
fly keep. SRS itself tunes any value, so this is a typo guard, not an SRS limit. The client checks the same rules before
sending (`frequency-state.js`, drift-tested against the server's `channelProblem`).

### 5. A change does not rewrite an assignment

A flight's working frequency (Block 22, `comms.workingFrequencyMhz`) is a clearance fact: the pilot was told it. The
table changes only what is offered from now on (the frequency a Rack assigns, what a Position monitors, what the panels
show). So:

- A **Position frequency** change touches no Strip and no flight data.
- An **SFA pool frequency** cannot change while a live Strip's flight is on it: **`FREQUENCY_IN_USE`** (a new refusal
  code). The Rack IS its frequency (sfa.js; `Placement.followSfaFrequency` moves a Strip when its flight's frequency
  changes), so changing the Rack under a flight would either leave the flight on a Rack that no longer says its
  frequency or move the Strip off the Rack while the pilot is still on the old frequency. Neither is true to what was
  said on the radio; the controller moves or hands off the flight first, as a real facility changes a frequency only
  when nobody is on it.

### 6. Wire

A new family, `efsp-frequency-mutation` (`wire/families/frequency.js`), ops `SetFrequency { positionId, label, mhz }` /
`{ rackId, mhz }` and `ResetFrequency { positionId, label }` / `{ rackId }`, ack `efsp-frequency-ack` (`row`, `changed`),
delta `efsp-frequency-delta` (`facilityId`, `frequencies`: that Facility's rows, whole), built in `wire/frames.js`. The
snapshot carries every row under `frequencies`. A row: `{ facilityId, kind: 'POSITION', positionId, label, mhz,
defaultMhz, setAt, setBy }` or `{ facilityId, kind: 'SFA', rackId, use, mhz, defaultMhz, setAt, setBy }`. The table has no
seq: the delta is idempotent and whole, so a lost one is mended by the next delta or the snapshot. The client's handler
also moves the Facility's Positions' `frequencies` and its SFA Bay's `sfaPool`, which the snapshot carried, so every
reader agrees without a new snapshot.

### 7. The panel

A separate dockable panel, **FREQUENCIES** (PANELS list), not a Settings tab: Settings holds a controller's own choices,
these values are shared. A grey table per Facility: each Position's frequencies, then the SFA pool (Rack and use). Click a
value to edit in place, Enter sends, Escape abandons; a refused value stays in the row with its reason (the panel's only
amber). A value differing from the default carries a grey **SET** mark, a note (default, who, when) and **RESET**.
Signed on nowhere, the table only reads.

## Consequences

- The facility files' frequencies are now defaults; a deployed squadron's working frequencies live in the `crc-sync-state`
  volume with everything else the service writes.
- A new Position frequency or SFA Rack still needs a facility file edit (the table edits values, never adds rows); a
  removed one makes a stale table entry stop start-up (§1), named.
- `FREQUENCY_IN_USE` joins `REFUSAL_CODES` and the client's wording table.
- Wire surface: one new message family; `npm run wire:record` recorded it (the protocol was already ahead of the last
  release, so no bump).
