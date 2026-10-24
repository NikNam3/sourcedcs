# U-SURFACE: the airport surface follows the ground/tower Positions held, also on black (H162)

Lane U-SURFACE, branch `lane/U-SURFACE`, cut from `d6050bfe`. No ADR (H162 is the record).

## What changed

- **crc-sync facility files:** optional `airportSurfacePositions: [<positionId>, …]` (`facility-schema.js`
  `validateConfig`, beside `positionLetters`): a list of unique Position ids of this Facility; an unknown Position,
  a repeat, a blank or a non-list is refused, and a `state/` copy that does so stops start-up naming the file (the
  usual facility-file rule). Absent or empty: none. Shipped: Incirlik `["GC", "LC"]`, nothing elsewhere.
- **Snapshot:** `airportSurfacePositions: { facilityId: [positionId] }` for every Facility (`[]` where none), from
  `facility-config.js` `allAirportSurfacePositions()`, carried exactly like `positionLetters` (`efsp-ws.js`).
- **Client:** `airport-surface.js` (still a leaf) holds the snapshot's table (`setAirportSurfacePositions`, set by
  `efsp-state.js` `applyEfspSnapshot`, cleared by its reset) and the rule: `airportSurfaceHeld(table, signedOnOf)` is
  true when the controller is signed on (Primary or Observer, `efsp-ws.js` `getSignedOnPositions`) at a Position that
  *its own* Facility lists; every Facility is looked at, none is first, no id is named in code.
  `airportSurfaceVisibility({ enabled, held })`: visible iff the Declutter switch is on and `held`. The black scope no
  longer hides it. `map-style.js` re-applies on the `positions` and `snapshot` topics (live on sign-on/off and on a
  Primary/Observer change) and on `atcBackground`.
- **Black-scope look:** `airportSurfacePaint({ black, light, gray })` returns the paint for every surface layer. On the
  black ATC scope: pavement fill `#1A1A1A` with a `#4A4A4A` outline, taxiway lines `#5A5A5A`, runway designators and
  taxiway names `#8C8C8C` (`ATC_DIM_GRAY`, the runways' grey), apron and gate names `#6E6E6E`, black halo: nothing
  brighter than the runways. The theme's paint (same properties, moved out of `applyMapTheme` unchanged) is restored
  by `applyMapTheme` when the background comes back.

## Tests and gates

- crc-sync unit **2906 → 2910** (schema: shipped/unknown/repeat/malformed/empty; config accessor; start-up error naming
  the `state/` file; snapshot key). crc-desktop unit **1425 → 1433** (`tests/airport-surface.test.mjs`: 12 generated
  Facilities with and without surface Positions, held/not held, own-Facility only, black on/off, switch off, paint on
  black and restore, a stub-map walk through snapshot → sign-on → black → restore → switch → sign-off;
  `scope-small.test.mjs` visibility case rewritten for the new rule).
- Module-graph fixture re-recorded (five new exports of `airport-surface.js`); no import cycle (bound 0 holds).
- `npm run walk` 24/24; `npm run freeze` 58/58 after `freeze:update` (separate commit: every changed unit is the
  snapshot hash or `facility.INCIRLIK`); `soak:selfcheck` PASS (seed 7; `efsp-ws.js` touched).
- `wire:record`: "WIRE_PROTOCOL stays 2 (last release speaks 1); surface unchanged". The snapshot's fixed keys are not
  scanned; `--bump` would be a no-op (2 is already ahead of the release), so it was not run.
- e2e on `E2E_LANE=7`: `u-scope-small` 4/4 (new: GC+AP and CTR held on black → visible and grey; GC signed off, only AP
  and CTR → hidden, runways stay; LC → visible; background back → theme paint; all signed off → hidden. The switch case
  now signs on GC), `l22-stars-scope` 5/5, `smoke` 1/1.

## For the usage guide (§8O map) — wording

> **Airport surface.** Aprons, taxiways, runway numbers and taxiway, apron and gate names show while you are signed on
> (Primary or Observer) at a Position your Facility lists for it (Incirlik: GC and LC), together with any other
> Positions you hold, and on both backgrounds: on the black ATC scope it is drawn in the video map's dim grey. Signed on
> only at AP, CTR or another radar Position, the scope shows the runways without the surface. Settings → Declutter →
> Airport surface turns it off for you. A facility file names its surface Positions in `airportSurfacePositions`.

For the briefing/CLAUDE.md facility-file notes: `airportSurfacePositions` joins the optional facility-file keys (strict
like the rest: an unknown Position stops start-up).

## Defaults taken

- The black-scope greys above (the briefing gave the look, not the values). Apron/gate names one step dimmer than
  designators and taxiway names, as in the theme's strong/mid/weak.
- The Settings label and its one-line description ("Airport surface: aprons, taxiways, runway numbers and taxiway names,
  zoomed in on a field.") do not state the old rule, so they are unchanged (briefing item 5). A controller at AP who turns
  the switch on sees nothing; the guide wording above explains it.
- Before the first snapshot (or against a crc-sync without the key) the table is empty, so the surface is hidden.

## Findings for other lanes

- When U-ROLE-POSITIONS lands roles (ADR 0132), `airportSurfacePositions` can become "the Facility's GC/LC roles"
  (H162); the client rule takes the table either way, so only the server side changes.
- `map-style.js` `applyMapTheme` declares `labelPaint` and never uses it (pre-existing, untouched).
- The client's `facility-topology.js` still carries `DEFAULT_FACILITY_ID` and the hard-coded `FACILITY_POSITIONS` table
  (ADR 0132 / H160 items); this lane neither used nor extended them.
