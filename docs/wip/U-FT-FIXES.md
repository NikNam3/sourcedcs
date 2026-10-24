# U-FT-FIXES (client + server): the two intermittent specs, and the lanes' leftovers

Branch `lane/U-FT-FIXES`, cut from `abe5834d`. No ADR. Wire protocol unchanged (2).

## 1. The two intermittent specs

### `l5-arrivals.spec.js` "a Strip arriving in the Bay on screen flashes once" (product bug)
Cause: the server's correlation warning for the handed-over Strip (`cor:1/UNCORRELATED///0/TRACK_LOST`) reaches the
client 0.4 to 0.6 s after the hand-off, which changes the Strip's render signature and rebuilds it. The flash is
consumed on the first build (`consumeEfspArrivalFlash`), so the rebuilt element had the amber edge but no flash: the
controller saw half a second of a 1.6 s flash, and the spec's `toHaveClass(/flash/)` failed whenever its poll landed
after the rebuild (ARV601 or ARV602). Measured with a MutationObserver: 2 of 5 runs rebuilt the Strip ~0.5 s after the
flash build. Not a bisectable regression: the timing of the warning is what changed under load.

Fix: `efsp-arrivals.js` `efspArrivalFlashElapsed()` + `ARRIVAL_FLASH_MS` (1600, parity-tested against the CSS). A rebuild
inside the flash window carries the flash on from where it was (`--efsp-arrived-flash-delay` = negative elapsed ms on the
animation), so it is neither cut short nor replayed. The spec waits on `crc.arrivals.efspArrivalFlashElapsed(...)` being
null before its "an unrelated rebuild does not replay it" check (no sleep). `crc.arrivals` added to `e2e/helpers/modules.js`.

### `u-scope-small.spec.js` H162 "Airport surface follows GC/LC held" (spec waited wrongly)
Cause, two wrong waits: (a) `signOn` returned on the efsp-set-positions ack, but `ws-hub.js` sends the session's own
`coverage` frame after the ack as a second message, so the real coverage (no radars: the rig has no DCS) could land after
the spec's injected ATC-only coverage and take the black scope away; (b) the black background is applied on
`atc-scope.js`'s next 500 ms beat, and the LC step read it once (`expect(await black())`) instead of polling. With (a)
fixed, (b) failed 5 of 10, which is how it was found. The spec is new since S-ARCH-90 (U-SURFACE, `285a67d9`), so this
was never a regression either.

Fix: `signOn` also waits for `crc.picture.coverageSignedOnPositions` to show the new set for that Facility; the LC step
polls `black`. Product unchanged.

Proof: both ×10 on lane 7, one worker, on the final tip; both files whole.

## 2. Leftovers
1. `tracks.js` / `grpc-client.js`: a missing heading is `null` (was `|| 0` / `: 0`). Only the PAR sample's
   `headings.current` reads a track heading on the wire (null-safe already; the panel prints nothing). `radars.js`
   keeps `t.heading || 0` for a radar's boresight (orientation of a sensor, never shown as HDG).
2. `bay/dispatch.js` `_resolveActingPositionId(strip, op)`: Owner if held; else the held Position a non-owner rule names
   for this op; else null (nothing sent). The only non-owner rule the generic path needed was OPS's 14E/3G Block writes
   (`permission.js` `NON_OWNER_BLOCK_WRITES`, `mayActBesideOwner`), which the old "first acting Position" fallback only
   reached by luck of order. The table now rides the snapshot as `nonOwnerBlockWrites` (rules, snapshot only, like
   `positionLetters`), so the client names no Position id. Block cells render read-only when no acting Position resolves
   (cycle cells already did). The strip signature's `act:` carries the held set for a non-owned Strip, so a sign-on
   unlocks the cell. The airborne chip's send now guards a null. TOFI answer and Back to stack keep their own resolution.
3. `tickers.js`: `buildTickers({ wallClock })` (createApp passes `WALL_CLOCK`; it throws without one);
   `conflictAlertMonitor.tick(wallClock.now())`. `clock-policy.test.mjs` pins `src/app/tickers.js` at no wall reads.
4. `CreateStrip`: an `initialState` the strip type does not have, or one the target Bay contradicts (a Bay that implies a
   state the type has), is refused `VALIDATION_ERROR` with the reason, before any flight data or beacon code is minted.
   No new refusal code.
5. Fixtures 56/236 → 52.7/232.7 (047M/227M): `par-panel.spec.js`, `par-panel.test.mjs`, the runway-status and ordnance
   fixtures (both suites), `par-geometry.test.mjs`. `efsp-par-values.test.mjs`'s `validateParValue('courseTrueDeg', 56)`
   left: it tests the range, not Incirlik.

## Defaults taken
- D1: the non-owner Block-write table goes on the snapshot (`nonOwnerBlockWrites`) rather than a client mirror with
  literal ids (rule 9). Additive key, old clients ignore it, so no wire bump (`wire:record` scan does not cover the
  snapshot's top-level keys; the same call U-SURFACE made for `airportSurfacePositions`). A new client against an old
  server gets `[]`: OPS cannot write 14E/3G on a Strip it does not hold until crc-sync updates (they ship together).
- D2: a Block cell the controller cannot write renders read-only (no editor, no `efsp-block-editable`), per the briefing.
- D3: the arrival flash continues across a rebuild inside its 1.6 s, rather than being kept on the old DOM element.

## For the guide / briefing
- Arrival flash: "a Strip rebuilt while it flashes keeps flashing to the end; never replayed."
- OPS sets ALERT/SCRAMBLE (14E) and ordnance (3G) on a departure whoever holds it; any other cell on a Strip you do not
  hold is read-only.

## Findings for other lanes
- `ws-hub.js` sends the efsp-set-positions ack before the session's `coverage` frame; any spec that injects coverage
  after a sign-on must wait for the coverage frame (as `u-scope-small` now does).
- Rule-9 literals still in client mirrors (U-ROLE-POSITIONS list): `marshal-panel.js` sends as `'CV_MARSHAL'`;
  `authority-mirror.js` `TOFI_ANSWERED_BY`, `HAND_BACK_TO`, `AIRSPACE_ENTRY_POSITIONS` etc.; `create-strip.js` origin table.
  The snapshot-table pattern used here for `nonOwnerBlockWrites` would serve them.
- `facility-topology.js` still exports `DEFAULT_FACILITY_ID` (U-ROLE-POSITIONS).

## Gates (final tip)
- crc-sync `npm test` 2951/2951 (tip 2947 + 4); crc-desktop `npm test` 1470/1470 (tip 1466 + 4).
- `npm run walk` 24/24; `npm run freeze` 58/58 (goldens re-recorded in their own commit, the new key only);
  `soak:selfcheck` PASS.
- Playwright, lane 7, one worker: `l5-arrivals` "flashes once" ×10, `u-scope-small` H162 ×10, both files whole (10),
  `par-panel` 9/9, `l22-stars-scope` + `smoke` 7/7, `alert-scramble` + `ordnance-hung` + `l2-block-editing` + `u-strip`
  29/29, `u-label-menu` + `u6-block-altitude` + `l3-coordination` 18/18.
