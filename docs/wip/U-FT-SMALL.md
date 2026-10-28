# U-FT-SMALL: small fixes from the final test of 2026-10-24 (H163, H164)

Branch `lane/U-FT-SMALL`, cut from `07aa7ec9`. No ADR. The wire is unchanged (`wire-protocol.test.mjs` green, no
`wire:record`).

## What changed

1. **Bullseye cursor readout** (`panels/topbar.js`, `map-interactions.js`). Hidden while `atcOnlySession()` is true.
   That is checked on every move, and also on the `positions` and `scope` topics, so the readout blanks when a
   sign-on happens with the cursor at rest. The map canvas's `mouseleave` blanks it too, which also covers moving onto
   a panel over the map. The measure tool is a map layer, not this element, so it is unchanged.
   Test: `tests/bullseye-readout.test.mjs`.
2. **STARS letters centred** (`map-layers-tracks.js` `atc-symbols`). MapLibre centres the line box, not the ink, so a
   capital on the bundled Roboto sat 0.15 em (1.5 to 2 px at 11 px) above the disc's centre. The fix is
   `text-offset: [0, 0.15]`, given in ems so it holds at any size. `l22-stars-scope` now measures the ink centre
   against the disc centre on the black scope, at 1x and 4x. Before the fix it was dy −1.5 to −2 px at 1x and −6.5 px
   at 4x; after, it is within ±0.5 px at 1x and ±1 px at 4x. Screenshots: `U-FT-SMALL/stars-letters-before.png`,
   `stars-letters-after.png`, and `stars-letters-zoom-before-top-after-bottom.png` (10x crops, before on top).
3. **Heading grace scales with the turn** (`crc-sync/src/efsp/conformance.js`, `config/alerting.json`).
   - The grace is the assigned turn divided by the rate, plus `headingGraceMarginSec` (15). The rate is
     `headingTurnRateDegPerSec` (3) or the rate at `headingTurnMaxBankDeg` (25°) of bank for the ground speed,
     whichever is slower. Both values are fixed when the monitor first sees the assignment.
   - Continuity: inside the grace, the remaining turn has to keep shrinking (by more than 1°). If it stops (levelled
     off short, or turning the wrong way), a HEADING alert fires `headingPersistSec` after the last progress, with
     `since` set to that moment.
   - Durations run on the wall clock. `headingGraceSec` is gone.
   - Tests cover 30°, 90°, 180° and left turns at 3°/s with no alert, a 180° at 450 kt with bank-limited rate and no
     alert, levelling off at 120° of 180° (alerts at 50 s), a wrong-way turn (alerts at 10 s), a 170° turn taken the
     long way (no alert), and stall then resume.
4. **Airport range ring off by default** (H164 FT-Q1 (c), as the supervisor chose).
   - Settings → Map Overlays now has an "Airport range ring" switch (`airportRangeRing`, default false). It gates the
     radar-sized ring `buildRangeRing` draws around the selected airport.
   - The reference track's ring is built in the same function. I left it ungated because it is a selection the
     controller made.
   - (b), the Coverage/PANELS dock panel, was already closed on a first launch, and so was Radar debug (a).
   - Test: `tests/airport-range-ring.test.mjs`. This is its own commit, so it can be swapped if FT-Q11 comes back
     different.
5. **CD originates DEPARTURE Strips** (H164 FT-Q2 a).
   - Server: CD gets `CreateStrip` and `DEPARTURE` in `CREATE_STRIP_TYPE_PERMISSIONS`.
   - Client: a `CD · Departure` origin in `cd-pending-clearance`, starting PENDING_CLEARANCE.
   - Server fix found on the way: without an `initialState`, CreateStrip used the strip type's default. A CD Strip
     therefore sat in PROPOSED, which only OPS may move, and a GCI Mission made in `gci-on-station` was TASKED. A Bay
     that implies a state now sets the starting state when the strip type has that state; an explicit `initialState`
     still wins.
   - Tests: `crc-sync/tests/efsp-cd-create-strip.test.mjs`, `crc-desktop/tests/efsp-cd-create-origin.test.mjs`, and
     updated `efsp-permission`.
6. **LC departure face** (H164 FT-Q3 a). P/S (9J-ENTRY), OPT (9J-OPTION) and HOOK (3F) are off LC's DEPARTURE face and
   settable in the expanded ▼ view (the view lists every Block Map block not on the face). LC and AP arrivals are
   unchanged. Tests: `efsp-twr-pattern`, `efsp-ui-reachability`.

## Freeze goldens (separate commits)

- `04ef6120`, heading grace: only `efsp-alerts` frames move, in hub-random-seed1/2/3. With those frames stripped, the
  goldens are byte-identical. The soak tracks fly random courses, so the continuity check alerts on them after 10 s
  instead of after the old 30 s grace.
- `5cbd81cf`, CD create:
  - In `table-create`, the CD/DEPARTURE cell goes from PERMISSION_DENIED to a PENDING_CLEARANCE Strip. Later Strip
    ids shift by two.
  - The GCI Mission now starts ON_STATION.
  - The permission tables and the `hub-op-matrix` CreateStrip golden follow.

## For the usage guide / briefing

- §conformance: the heading grace scales with the turn and needs the turn to keep going (the three new alerting keys).
  A `state/alerting.json` that still carries `headingGraceSec` will stop start-up (unknown key). Delete that key.
- §4.1: CD may create a DEPARTURE Strip, which lands in Pending Clearance.
- §LC: P/S, OPT and HOOK on a departure are in ▼.
- Settings: Airport range ring (off by default). Bullseye readout: hidden on an ATC-only session and off the map.

## Defaults taken

- The heading entry carries no LEFT/RIGHT (digits only), so the turn is measured the short way round. A 180° or
  near-180° turn taken the long way only looks wrong until it passes 180°, which is shorter than `headingPersistSec`,
  so it does not alert.
- I added the bank limit, `headingTurnMaxBankDeg: 25`, beyond the briefing. Without it, a 180° turn at 350 kt
  (about 1.45°/s at 25° of bank) would alert mid-turn, which is the reported complaint again. It follows the AIM's
  holding turns (5-3-8: 3°/s, 30° of bank, or 25° with a flight director, whichever needs the least bank). I could not
  check the sub-paragraph offline. Ground speed stands in for TAS.
- Item 4: (c), the supervisor's pick while FT-Q11 is open.

## Findings for other lanes / the supervisor

- `atcOnlySession()` is coverage-based: every radar is ATC and there is no datalink. A GC- or CD-only session has no
  radar, so it counts as not ATC-only and still shows the bullseye readout. The briefing described the rule as
  "every Position held is ATC". If the human wants the readout off there too, the rule needs Position roles
  (U-ROLE-POSITIONS).
- Rule 9: items 5 and 6 extend existing tables keyed by literal Position ids (`CREATE_STRIP_TYPE_PERMISSIONS`,
  `PERMISSIONS`, the client `CREATE_STRIP_ORIGINS`, `COMPACT_BLOCKS_BY_POSITION`). The structure forced this; it
  belongs on U-ROLE-POSITIONS' list.
- `CreateStrip` accepts any `initialState` from the client, unvalidated against the strip type or the Bay.
- The l22 letter measurement needed refreshed returns: a contact older than three sweeps coasts and loses its disc,
  which can happen in a slow multi-spec run.
