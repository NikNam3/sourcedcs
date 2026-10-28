# 0138: Controllers add and remove frequency rows, and edit only their own Facility's frequencies

**Status.** Accepted (lane U-FREQ-ROWS, 2026-10-22). Rulings: decisions.md **H156** (FQ-Q1 a: refuse an SFA change in
use, as built; **FQ-Q2 b**: a Primary edits only its own Facility's frequencies; **FQ-Q3 b**: controllers add and remove
frequency rows at run time), **H159** (SFA is v2), ADR **0132** §3/§4 (the one acting Position; `FACILITY_MISMATCH`).
Builds on ADR 0131 (the runtime frequency table), 0105 (Position frequencies), 0117 (the SFA pool). **Supersedes ADR 0131
§3's "any Primary at any Position may set any Facility's frequencies"** and its Consequences line "the table edits values,
never adds rows"; the rest of 0131 stands.

## Context

ADR 0131 let controllers change the value of a frequency the facility files ship, but not add one: a second ground
frequency, a clearance delivery frequency for CD (which ships none), or a sixth SFA frequency needed a file edit and a
restart. And any controller Primary anywhere could change any Facility's frequencies, so CENTER's controller could
retune Incirlik's tower. The human chose both changes on the Decision Desk (H156 FQ-Q2 b, FQ-Q3 b).

## Decision

### 1. Run-time rows

Two new ops in the `efsp-frequency-mutation` family:

- **`AddFrequency { positionId, label, mhz }`**: another frequency for a Position of the Facility. The label follows the
  facility file's rule (1 to 12 characters, not blank, unique within the Position; the client upper-cases what is
  typed), the frequency ADR 0131 §4's.
- **`AddFrequency { sfa: true, mhz }`**: another frequency for the Facility's SFA pool (refused `NOT_FOUND` where the
  Facility has none). It is a **SPARE** on a new Rack the table names (`freq-<n>`, the next free number), because the
  pool rotates exactly three (JO 7610.14A para 7-1-5 c) and the initial-contact frequency is the shipped one (ADR 0117
  decision 2). The new Rack is a Rack of the `sfa-freqs` Bay (`getAllBays` lists the pool's Racks), so filing a Strip on
  it assigns its frequency like any other.
- **`RemoveFrequency { positionId, label }` / `{ rackId }`** removes **an added row only**. A shipped row is refused
  (`VALIDATION_ERROR`): it is reset to its default, never removed, because removing a shipped Position's frequency could
  leave a Position with none. An added SFA frequency with a flight on it is not removed: **`FREQUENCY_IN_USE`**, the same
  refusal and the same reason as a change (ADR 0131 §5, FQ-Q1 a).

An added row is edited with `SetFrequency` like any row (in-use rule included). `ResetFrequency` on it is refused: it
has no default.

A row on the wire gains **`added`** (true on an added row) and an added row has **`defaultMhz: null`**. Added rows come
after the shipped rows of their Position; added SFA rows after the shipped pool.

### 2. Persisted like an override, strict

`state/efsp-frequencies.json` gains, per Facility, `added: { positions: { <Position>: { <label>: { mhz, setAt, setBy } } },
sfa: { <rackId>: { mhz, setAt, setBy } } }`. The file stays strict (ADR 0095, 0131 §1): an unknown key at any level,
a Position not of that Facility, a label or Rack the facility file already has, an SFA row at a Facility with no
single frequency approach, an invalid label or frequency, or a pool frequency given twice stops start-up naming the
file. `facility-config.js`'s overlay carries the added rows, so every consumer (PositionStore, positions frames, the
SFA Bay's `sfaPool` and `rackIds`, sfa.js's lookups) sees them with no change of its own.

### 3. Only the acting Position's Facility

A frequency op is applied only when the Facility it names is the Facility of its **acting Position** (ADR 0132 §3: the
one acting Position, never "any Position the controller holds"). Otherwise it is refused **`FACILITY_MISMATCH`** (ADR
0132 §4's code, added here identically), audited like every refusal reaching the table. The wire family's gate stays
"Primary at the acting Position" (`primary-somewhere`); the table checks the Facility. The Facility of a Position is the
one whose Position set includes it (ids are unique, ADR 0132 §1); U-ROLE-POSITIONS' `facilityOf` may replace that
lookup.

### 4. The panel

The FREQUENCIES panel acts for each Facility as one of the controller's Positions **in that Facility**
(`getActingPositions(facilityId)`). A Facility the controller holds no Position in reads only: plain grey values, no
ADD, RESET or REMOVE, and no text saying why (dark cockpit). A Facility the controller holds a Position in shows **ADD**
beside its name, even with no frequencies yet; it opens one line: where (one of the Facility's Positions, or SFA when it
has a pool), a label (for a Position), the frequency; Enter sends, Escape abandons, a refusal stays in the line in amber.
An added row carries the grey **SET** mark, the note `added · <who> <when>`, and **REMOVE** in RESET's place.

## Consequences

- Adding a frequency or an SFA Rack no longer needs a facility file edit or a restart.
- An SFA Rack can now come and go at run time; the client's delta handler moves the SFA Bay's `rackIds` with its pool.
- A Facility's frequencies are changed only by its own controllers; CENTER no longer retunes Incirlik.
- Wire: `AddFrequency`, `RemoveFrequency` recorded by `npm run wire:record` (the protocol was already ahead of the last
  release: stays 2); the rows' new `added` key re-recorded three freeze goldens.
