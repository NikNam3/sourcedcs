# 0091 — the ALT field takes block altitudes, and a block is conformant anywhere inside it

## Context

Military flying assigns altitude *blocks* ("maintain FL220 to FL240") as often as a single level, for
formations, air-to-air work and tanker tracks. `0058`'s ALT accepted one altitude only, so a controller
had to write a block into a note and the flight's conformance check had nothing to compare it to.

## Decision

### Input

`parseAltitude(text)` (`src/efsp/fdr-store.js`) returns a band `{ lowFt, highFt }`. A single altitude is a
zero-width band, read exactly as `0058` reads it (`FL180`, `A050`, `050`, `5000`). A **block** is two
altitudes joined by `-`, `B` or `TO`, spaces ignored, lower first: `FL220-FL240`, `FL220B240`, `220B240`,
`220-240`, `FL220TO240`, `A050-A080`, `5000-8000`, `5000B8000`. Each end follows the single-altitude
rules, so `220B240` is FL220 to FL240 and `5000B8000` is feet.

Refused, with the entry unchanged and the reason shown: a low end that is not below the high end
(reversed or equal), a half-written block (`FL220-`, `B240`), more than two ends, and anything either
end cannot read. The check needs no clock. `parseAltitudeFt` is unchanged and answers a single altitude
only; callers that may take a block use `parseAltitude`.

### Stored shape and wire

An altitude entry is `{ value, parsed, block, status, at, by }`:

- a single altitude: `parsed` is feet, `block` is `null` (exactly as in `0058`);
- a block: `parsed` is `null` and `block` is `{ lowFt, highFt }`; `value` is rewritten to the one canonical
  text, `FL220-FL240` (an end at or above 18,000 ft and a whole hundred is written as a flight level,
  anything else in feet, `5000-8000`, `16000-FL200`).

So a reader that only knows single altitudes sees `parsed: null` and ignores the entry rather than
misreading it. The Strip's ALT cell shows `value`, so the canonical text is what every Position sees.
`military.mtr.requestedAltitudeAfterExit` takes a block the same way (stored as canonical text).
The old clearance migration (`clearance-migration.js`) reads blocks the same way. Snapshots and
`efsp-alerts` carry the new fields as-is; an entry written before this ADR has no `block` and reads as
a single altitude.

### Conformance (extends `0058`)

Against a block the aircraft's deviation is **0 anywhere inside it**, and outside it the signed distance
to the **nearest edge**. Everything else in `0058` then applies unchanged:

- "reached" is within `atAltitudeBandFt` (400 ft) of the block, so the edge tolerance is the usual one;
- `LEVEL_BUST` is more than `levelBustFt` (500 ft) outside the block after reaching it, `deviationFt` is
  measured from the edge it left through;
- `WRONG_WAY` is climbing away from a block that is above, or descending away from one that is below;
  inside the block vertical speed is irrelevant.

An alert's `assigned` is that edge (a number, so existing text reads "from 24,000 ft"), and the alert also
carries `block: { lowFt, highFt }` when the clearance is a block. A new entry still starts the memory over.

### STCA

`StcaMonitor` projects tracks in straight lines and **does not read the assigned altitude**, so a block
changes nothing there. If separation logic ever reads the assigned altitude to predict a level-off, the
conservative reading is that the flight may be at **any altitude in the block**, i.e. use the point of
the block nearest the other aircraft's altitude, never the middle and never "the end it is heading to".

### Display

Track panel `ALT FL220-FL240`; scope data block `A220B240` (the trend arrow only appears when more than
200 ft outside the block, pointing toward it); map line `A220B240`.

## Consequences

- A controller can write the altitude as a military block, and every Strip, the scope and the alerts agree.
- A block that is not an altitude pair is refused where it is typed, with the format in the message.
- The 18,000 ft flight-level switch in the canonical text is fixed, not the theater's transition altitude
  (`H62`, Syria 10,000): `fdr-store.js` has no theater context. Only the *text* is affected, never the
  stored feet, and a controller who typed `FL100-FL120` gets `10000-12000`.
- Tests: `crc-sync/tests/efsp-block-altitude.test.mjs`, `crc-desktop/tests/track-label.test.js`,
  `crc-desktop/e2e/u6-block-altitude.spec.js`.
