# U-ALT-LIMITS — an assigned altitude limit, `<X` / `>X` (ADR 0163)

Branch `lane/U-ALT-LIMITS` (cut from `cancel-ff`).

## What is built

- `<X` = at or below X, `>X` = at or above X, in every assigned-altitude field (ALT cell, label menu ALT, formation
  split altitude, divert Maintain, MTR exit altitude). X is any single altitude form.
- Stored as `block: { lowFt: null, highFt: X }` / `{ lowFt: X, highFt: null }`, `parsed: null`. No new key anywhere;
  persisted snapshots and the wire are unchanged (no `wire:record`, WIRE_PROTOCOL stays 8).
- Canonical text: `<`/`>` + X as typed below the theater's transition altitude, `FL###` at and above it.
- Conformance: allowed side conforms; past the limit > `levelBustFt` after reaching = LEVEL_BUST; past it and moving
  away = WRONG_WAY. Alerts carry `assigned` = the limit and `block` with the null end.
- Readers fixed: conformance.js, handoff-control.js (`_neededScopes`), route-geometry.js (`altitudeBandOf`,
  `bandOverlaps`, now exported), carrier-handoff.js (clears a limit/block too, it used to skip a block: `parsed != null`),
  client track-label.js (`assignedBlockText`, `atcAssignedText`), atc-scope.js (`altText`), geojson.js (tactical
  assigned line), track-panel.js, strip-alerts.js, formation-rules.js.
- New modules: `crc-sync/src/efsp/altitude-band.js` (the parsing moved out of flight-data-store.js, re-exported there),
  `crc-desktop/app/public/js/altitude-limit.js` (leaf).

## Usage-guide text (for docs/efsp-usage-guide.md, the ALT field section beside the block altitude)

> **An altitude limit.** Type `<` or `>` before an altitude: `<080` is *maintain at or below 8,000*, `>FL240` *at or
> above FL240* (JO 7110.65BB ¶9-2-6 "MAINTAIN AT OR BELOW (altitude)", ¶4-5-7 "AT OR ABOVE/BELOW"; the `<`/`>` is
> ours). Any altitude form works after it (`<080`, `<A080`, `<8000`, `>240`); the strip writes it as you typed it below
> the transition altitude and as a flight level at and above it, and the data block, the label menu and the track panel
> show the same text. The flight is conforming anywhere on the allowed side, climbing, descending or level: the limit is
> not a level it has to reach. Past the limit by more than 500 ft it is a level bust (BUST), and past it while still
> moving away it is a wrong-way alert (ALT ↑/↓). The data block's arrow appears only when the flight is past the limit.
> A limit on a block (`<FL220-FL240`) is refused: a block is already both limits.

## Defaults taken

- **Canonical text below TA = as typed** (`<080` stays `<080`, `<8000` stays `<8000`, `<A080` stays `<A080`); at and
  above TA a flight level (`>240` → `>FL240`). This reconciles AL-Q1 a's examples with "follow the block
  canonicalisation" (a block end below TA writes feet, which would have made `<080` into `<8000`).
- **`parsed` is null for a limit**, so no reader can take the limit as a level target.
- **Control-axis attestation** with a limit: the axes the new band opens past the current one (080 → `<100` needs CLIMB
  and DESCENT; `<080` → `060` needs nothing). Closed blocks keep the old overlap rule. Ours.
- **Data block**: the strip's text (`<080`), no `A` prefix, arrow only when past the limit by > 200 ft (the same slack
  as the existing trend arrow).
- LEVEL_BUST reason on the strip for a limit reads "Limit at or below 8,000 ft, now at 8,600 ft." instead of "Reached …".

## Tests

- `crc-sync/tests/efsp-altitude-limit.test.mjs` (new, 10 tests): parse, format, bandEnds/entryBand, setClearance +
  snapshot round-trip + `<090` shift, MTR exit, conformance (allowed side, bust, wrong way both ways), control axes,
  airspace overlap.
- `crc-desktop/tests/altitude-limit-display.test.mjs` (new, 4 tests): altitude-limit.js, data block text and arrow,
  assignedBlockText, formation split parsing.
- Also ran (unchanged, to check the move out of flight-data-store.js): `efsp-block-altitude.test.mjs`,
  `conformance.test.mjs` — 46/46.

## Walks not done

- No Playwright/e2e walk of typing `<080` in the strip cell and the label menu (rule 7). The client sends the typed text
  unchanged to `SetBlock`/the label menu op, so nothing client-side validates it, except the formation split form.
- Prod Board snapshot: not booted (no change to the stored shape, so not needed; the supervisor may still check).

## Findings for other lanes

- **U-SCOPE-GESTURES** (Alt+wheel): `<090`/`>FL250` round-trips through `setClearance`. Shift the number and keep the
  operator; the entry's `value` is the text to start from (`parsed` is null for a limit, read `block` for the feet:
  `lowFt == null ? highFt : lowFt`). Below TA the server keeps the typed form, so `<080` → `<090` stays three digits.
- carrier-handoff.js's "clears assignments on return to the stack" used to skip an ACTIVE **block** (it tested
  `parsed != null`); now fixed for blocks too.
