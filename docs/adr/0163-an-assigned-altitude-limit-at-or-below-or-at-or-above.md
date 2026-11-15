# 0163: An assigned altitude limit, at or below or at or above one altitude

**Status.** Accepted (2026-11-15). [SOURCE-DEFINED]: the human's request of 2026-11-15 ("alt fields should support <X
entries ie remain at or below. and >X entrys remain at or above with conformance checking"); Decision Desk AL-Q1 a
(canonical as typed, `<080`, `>FL240`, the same everywhere) and AL-Q2 a (no deviation anywhere on the allowed side).
Extends ADR 0091 (a block altitude in the ALT field) and ADR 0058 (the clearance on the flight data).

## Context

The assigned altitude (ADR 0058) is a single altitude or, since ADR 0091, a block (`FL220-FL240`). A controller also
restricts a flight to one side of an altitude. JO 7110.65BB has the phraseology:

- ¶9-2-6 (IFR military training routes): *"CLEARED INTO IR (designator). MAINTAIN (altitude), or MAINTAIN IR
  (designator) ALTITUDE(S), or MAINTAIN AT OR BELOW (altitude), or CRUISE (altitude) …"*.
- ¶4-5-7 (Altitude information), the crossing restriction: *"CROSS (fix, waypoint) AT OR ABOVE/BELOW (altitude)."*
- ¶7-3-1 (VFR-on-top): *"MAINTAIN VFR-ON-TOP AT OR ABOVE/BELOW/BETWEEN (altitudes)."*

So "at or below" and "at or above" are assignments the order knows. The ALT field had no way to write one.

## Decision

1. **Entry.** Every assigned-altitude field (the Strip's ALT cell, Block 7/7A/21, the label menu's ALT, the formation
   split's altitude, the divert form's Maintain, the MTR exit altitude) takes `<X` (at or below X) and `>X` (at or above
   X). X is any single altitude `parseAltitudeFt` reads (`080`, `A080`, `8000`, `FL240`, `240`). A limit on a block
   (`<FL220-FL240`) is refused. The `<`/`>` notation is ours (a strip is written, not spoken).
2. **Representation.** A limit is an altitude block with **one open end**: `<080` is `block: { lowFt: null, highFt:
   8000 }`, `>FL240` is `block: { lowFt: 24000, highFt: null }`, and `parsed` is null, as for a block: a limit is never a
   level to reach. No new key on the entry, the persisted Board snapshot or the wire (the scan does not reach entry
   contents); old snapshots load unchanged. Comparisons read an open end as -Infinity / Infinity (`bandEnds`), never
   stored or sent.
3. **Canonical text (AL-Q1 a).** The entry's `value` is `<` or `>` and the altitude as typed below the theater's
   transition altitude, a flight level at and above it (`<080`, `<8000`, `>FL240` from `>240`), the same rule ADR 0091's
   block text follows for its ends. The strip, the data block (`<080`, an arrow only when the flight is past the limit
   by more than 200 ft), the tactical label, the track panel and the label menu show that text unchanged.
4. **Conformance (AL-Q2 a).** The band check of ADR 0091 with one open end: anywhere on the allowed side conforms and
   counts as reached; past the limit by more than `levelBustFt` (after reaching) is LEVEL_BUST; past the limit and moving
   further away (before reaching) is WRONG_WAY. `assigned` in the alert is the limit, `block` carries the open end as
   null. The alert text says "at or below" / "at or above".
5. **Readers.** The control-axis attestation (`handoff-control.js`): when either the current or the new assignment is
   a limit, the axes are the directions the new band opens past the current one (ours; a closed block keeps ADR 0091's
   overlap rule). The airspace filed-through check reads an open end as open. A carrier flight back in the stack has
   its limit cleared like a block.

## Module layout

- `crc-sync/src/efsp/altitude-band.js` (new): `parseAltitudeFt`, `parseAltitude`, `formatAltitudeBlock`,
  `isAltitudeLimit`, `bandEnds`, `entryBand`; moved out of `flight-data-store.js`, which re-exports them.
- `crc-desktop/app/public/js/altitude-limit.js` (new, a leaf): `isAltitudeLimit`, `limitFt`, `limitWords`,
  `limitTrend`.

## Consequences

- A shift of a limit (the Alt+wheel of U-SCOPE-GESTURES) writes `<090` back through `setClearance`, which reads it.
- Nothing is reported for a flight that stays on the allowed side, including one that never levels: a limit is not a
  target.
- Not built: "between" (that is the block), and a limit tied to a fix or a time (`CROSS … AT OR ABOVE`, `MAINTAIN …
  UNTIL`): the field holds an assignment, not a restriction with a place.
