# 0058 — one assigned ALT and HDG per flight, conformance and STCA, and indicators only when wrong

## Context

A controller asked for crc-sync to cross-check what a track is doing against what its Strip says, and
for a short-term conflict alert. Working that through exposed that there was no single "assigned
altitude" or "assigned heading" to check against:

- Each Role had its own Blocks: DEPARTURE `INIT ALT` (21) and `HDG` (20), ARRIVAL `ALT` (7) and
  `VECTOR` (9A-VECTOR), OVERFLIGHT `ASGN ALT` (7A) and `VECTOR`. They were **Strip annotations**, so
  a departure's climb clearance did not exist on the arrival Strip the same flight later became, and
  two Strips on one flight (docs/adr/0054) could disagree.
- `INIT ALT` was a separate idea from "the altitude the flight is cleared to". Once DEP amends it, it
  *is* the assigned altitude; the controller saw no reason for both.
- DEPARTURE's Block 7 is the **filed** cruise altitude, labelled `ALT`, and sat next to the assigned
  one with the same label.

The indicator row from `0056` drew every slot all the time and dimmed the ones that were off. The
controller asked for the opposite ("airbus philosophy"): **show nothing when nothing is wrong**, for
the new warnings and for every existing box.

The design was mocked and approved (reference artifact, "EFSP assigned ALT/HDG, conformance & STCA").

## Decision

### One `ALT` and one `HDG`, on the flight record

- `fdr.clearance = { altitude: { entries }, heading: { entries } }`. Each entry is
  `{ value, parsed, status, at, by }` with the same §3.7 history as an annotation: amending
  supersedes, `⌿` strikes a vacated altitude, nothing is erased. `parsed` is feet (altitude) or
  degrees 1–360 (heading, `000` is `360`); input the parser cannot read is refused.
- Altitude input: `FL180`, `F180`, `A050`, or a bare number: up to three digits is hundreds of
  feet (`050` → 5000, `180` → 18000), four or more is feet.
- The Blocks keep their ids and their Block Map entries. Their target is now `kind: 'clearance'`
  (DEP 20/21, ARR 7 / 9A-VECTOR, OVF 7A / 9A-VECTOR). SetBlock on them writes the FDR, so every
  Strip on the flight shows the same value, and `ConvertToArrival` carries the clearance across
  because there is nothing to copy.
- Labels: the assigned altitude is **`ALT`**, the assigned heading **`HDG`**, with no "ASGN" in
  front. DEPARTURE's and OVERFLIGHT's filed Block 7 is renamed **`CRUS ALT`**.
- Writing a clearance cell bumps the FDR's `rev` and `clearanceUpdatedAt`, **not** `updatedAt`. An
  assigned altitude is ATC's instruction, not an amendment to what the pilot filed, and must not
  raise `AMENDMENT_INSIDE_30MIN`.
- The MARSA interlock (`0041`, guide §9.2) fires from the same Blocks as before: assigning either
  one on a participant before rendezvous voids the relation.
- **Migration.** On boot, any old annotation on those Blocks moves to the FDR. The first Strip found
  wins, a cell already on the FDR is never overwritten, and the annotation is removed from the
  Strip (`clearance-migration.js`).
- Which Positions see the fields: `HDG` is rarely part of a departure clearance, so DEP CD and TWR
  no longer show it. CTR gets both. ARR TWR gets `ALT`.

### Conformance: only what is wrong

`ConformanceMonitor` (`src/efsp/conformance.js`) runs every second for each correlated or
provisional flight, against its active clearance cells only. Three alerts, each only when its value
is assigned and the aircraft is above 50 kt ground speed:

| Alert | When | Shown as |
|---|---|---|
| `HEADING` | course over ground more than ±5° off `HDG`, for 10 s, after a 30 s grace for the turn. The grace ends early once the aircraft is on the heading. | `HDG 072` |
| `WRONG_WAY` | told to climb and descending, or told to descend and climbing, faster than 500 ft/min for 5 s, before it has reached `ALT` | `ALT ↓` / `ALT ↑` |
| `LEVEL_BUST` | having reached `ALT` (within ±400 ft), more than 500 ft off it for 3 s | `BUST +600` |

Deliberately **not** checked: that the aircraft has *started* climbing or descending. "Descend when
ready" is an ordinary clearance and would alert all the time. Also not checked: conformance with the
filed route (future work).

Altitudes are compared the way the controller reads them: QNH below the theater's transition
altitude (default 18,000 ft), standard pressure above (`src/altimetry.js`, from the DCS weather at
the aircraft). Course is DCS's course over ground in the same reference the track panel uses (grid).
Magnetic variation is open and will be looked at separately.

A new clearance entry starts over: the grace, "reached" and the persistence clocks belong to the
entry, so re-clearing an aircraft that has reached one level is not a bust of the old one.

### STCA

`StcaMonitor` (`src/stca.js`) projects every pair of airborne tracks (airplanes and helicopters,
above 50 kt, seen for 10 s) forward in straight lines for 120 s in 2 s steps. A pair that will be
inside 3 NM **and** 1,000 ft at the same moment is a conflict, reported with the time to the
closest point, the distance and height apart there, and both predicted positions. A pair in the
same active MARSA relation is suppressed. A pair with no Strips is **not**: two unknowns can still
collide. Terrain and MSAW are out of scope until AIRAC data is in.

### Thresholds and transport

All thresholds live in `config/alerting.json`, overridable per key in `state/alerting.json`
(`0048`), read at startup. Both monitors tick once a second. When either changes, the server
broadcasts the complete current set, `{ type: 'efsp-alerts', conformance, stca }`, and sends it to
each client on connect. Full state rather than deltas: the set is small and is almost always empty.
A conformance alert's drifting numbers (altitude, rate) do not count as a change by themselves. An
STCA conflict re-broadcasts every tick while it lasts, because its countdown moves.

Nothing here moves, advances or edits a Strip (guide §10.3). The alerts are advisory.

**Amended by `0059`:** the alerts are now sent per session. Conformance still goes to everybody, but
a conflict goes only to a controller at an ATC Position (`MILITARY_ATC`/`CIVIL_ATC`), and only when
both aircraft are in their picture. A conflict names each aircraft the way it is labelled: its
flight's callsign when correlated, else its tag or track number.

### Indicators only when something is wrong

This supersedes `0056`'s "indicators always drawn, dim when off":

- The indicator row exists only when it has something in it. No placeholders.
- `TRK` is hidden when the flight is correlated normally. Provisional, ambiguous, lost,
  uncorrelated and outside-coverage still show.
- New indicators come first: `STCA <other> m:ss` and the conformance ones above, both orange-red,
  each with a full reason line ("Conflict with SNAKE21 in 0:55: closest 1.8 NM / 400 ft.") above
  the Strip's other reasons. A Strip with a live alert gets the orange-red edge.
- MARSA, TOFI, airspace, timer and siblings still show while they are in effect. Each is a state
  the controller is working, not a decoration.

### On the scope and the track panel

- The data block gets a coloured tag in front (`STCA`, `HDG`, `BUST`, …) and a line
  `A180 H050` with the flight's assigned values.
- An STCA conflict draws both predicted paths to the closest point, a line between the two
  positions there, and a label with the time.
- The track panel shows `ALT FL180 · HDG 050` when the flight has a clearance, and one line per
  active alert.

## Consequences

- A clearance entered at any Position is on every Strip of the flight and survives the Strip being
  dropped or converted. Where two Strips previously disagreed, the first one found on migration won.
- Strips are shorter when nothing is wrong. A Strip that gains its first indicator grows by the
  indicator row, inside the body zone (`l4-badges.spec.js` now allows that one row).
- STCA is O(n²) in airborne tracks, with a cheap distance rejection before projecting. That is fine
  for a DCS server's traffic, and would need a spatial index long before it mattered.
- The tests are `crc-sync/tests/conformance.test.mjs`, `stca.test.mjs` and
  `efsp-clearance.test.mjs`, plus the rendering tests in `crc-desktop/tests/efsp-ui-reachability.test.js`.

## Notes

### Convert to Arrival keeps the clearance, unlike the annotations `0040` archives

`0040` archives a departure's annotations on Convert to Arrival rather than carrying them across,
because the same Block id means something different on the return leg, and carrying the value
would *"relabel it as a statement about the return leg that nobody made."*

The assigned `ALT` and `HDG` are the exception, and deliberately so. They are not Strip annotations
that change meaning with the Role; they are the flight's clearance, stored once on the FDR. An
aircraft turning back toward Incirlik is still cleared to the altitude and heading it was last given,
so the return leg showing them is the truth, not a relabelling. The controller confirmed this is the
behaviour they want. Everything else `0040` archives is unchanged.

### Thresholds change only on a restart

`0043` and `0046` keep tuning values (tick rates, correlation affinities) as module constants,
because *"persisting a tuning constant lets an old snapshot pin a value the code has since moved
past."* `config/alerting.json` is shipped config with a hand-edited `state/` override, which looks
like that risk and is not, for two reasons the controller confirmed:

- **Nothing in the code ever writes it.** There is no setter and no API. The only way a value
  reaches `state/alerting.json` is a person editing the file, so no snapshot can pin a value the
  code chose. A missing key falls back to the shipped default, so a threshold added by a later image
  still arrives.
- **It is read once, at startup** (`server.js`: `loadAlertingConfig()`), and never re-read. A
  change takes effect on the next restart and at no other time, so thresholds never shift under a
  controller mid-session.

`config/sensor-specs.json` (`0059`) follows the same two rules. Any future tuning file should too,
or say why not.
