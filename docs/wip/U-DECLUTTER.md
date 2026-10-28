# U-DECLUTTER (2026-10-16)

Lane: `lane/U-DECLUTTER`, from `efsp-wp5-correlation` (`d9faca35`). Briefing `docs/parallel/next/U-DECLUTTER.md`,
decisions H6, H115–H119, H128, H134 (LT-Q1 c, LT-RQ11 a), S-ARCH-51, S-ARCH-56, S-ARCH-69; T4, T30.

## What was built

1. **LT-GROUND, ADR 0121**: no radar we model presents a ground vehicle (DCS category 3).
   - `crc-sync/src/surveillance/presentation.js`: `presentable(track)`; `presentTrack()` returns `null` for a vehicle,
     whatever saw it, answered for it or was declared on it.
   - `crc-sync/src/ws-hub.js` `_present()`: a datalink lock on a vehicle is dropped (its track id would leak).
   - `crc-sync/src/coverage.js`: vehicles skipped before any arithmetic; the airport radar's `seesGround` flag and the
     vehicle-only "skip terrain masking" exception are gone (`radars.js`).
   - `crc-sync/src/efsp/correlation-match.js` `buildTrackIndices()`: a vehicle is in neither the beacon nor the callsign
     index (still in `byId`), so a DCS ground unit sharing a flight's callsign stem cannot become a Strip's contact.
   - Client: the dead ground-vehicle drawing is removed: `gnd-*` icons (`icons.js`, `GROUND_COLOR`), the GROUND branch of
     `unit-squares`, the vehicle tag popup (`showGroundLabelPopup`, `#gnd-label-popup` and its CSS), the GROUND filters
     in `geojson.js`, and Settings → RADAR **Hide ground units** (`settings.hideGroundUnits`).
2. **T30**: Settings → RADAR → **Conflict Alert** → **Show predicted paths** (`settings.conflictAlertPaths`, default on,
   per controller, localStorage). Off: `buildConflictAlertOverlay()` emits no `path` / `cpa-line` features. The CPA
   marker with its countdown and the data block's `CA`/`MCI` stay.
3. **¶5-4-6 e NOTE** (`track-label.js` `receivedCodeText()`): JO 7110.65BB ¶5-4-6 e NOTE, *"When the beacon code received
   from the aircraft does not match the computer assigned beacon code, the code received (ERAM, MEARTS) or the
   site-adapted code … (STARS) will be displayed in the data block. When the aircraft changes to the computer assigned
   code, the code is automatically removed from the data block."*
   - Tactical block: the code line (`trackCodeTag(t, assignedCode)`) is empty while the received code equals the
     correlated flight's `identity.beaconAssigned`; an emergency still always shows.
   - ATC full data block: line 3 gains the received code before the assigned values (`4521 A060↓ H250`) on a mismatch
     (STARS line 3, `docs/parallel/research/stars.md`).
4. **`KEEP IFR` on a flight-following Strip**: why it reached them: CTR's OVERFLIGHT face list
   (`strip-fields.js` `COMPACT_BLOCKS_BY_POSITION.OVERFLIGHT.CTR`) carries the TOFI cells unconditionally, and
   `StartFlightFollowing` makes an OVERFLIGHT Strip. `keepIfrHidden()` now drops `IFR` from the face of an OVERFLIGHT
   whose flight data has no clearance (`vfr.js` `hasNoClearance`, H136 VQ2; the same test as "Radar service
   terminated"), unless KEEP IFR is set. The expanded view still has the cell. (AP's OVERFLIGHT face never had it.)

## For the usage guide / briefing (docs pass)

- Guide l.~873 (`LC` row): "the only one that shows ground vehicles" is now wrong: **no radar shows ground vehicles**
  (ADR 0121; surface movement radar is not modelled). Aircraft on the ground still show on the field radar.
- Guide l.~1271: "Tags (the track panel's text box, or clicking a ground vehicle)": drop "or clicking a ground vehicle".
- Guide, Settings → RADAR: add **Conflict Alert → Show predicted paths**: "Hides the dashed predicted paths and the line
  between the closest points. The CA in the data block and the closest-point marker with its countdown always show."
  Remove **Track Visibility → Hide ground units**.
- Guide, data block: "The code shows beside a flight's callsign only while the aircraft is not squawking the code it
  was assigned (JO 7110.65BB ¶5-4-6 e NOTE); on an ATC full data block it is on line 3, before the assigned altitude and
  heading. A contact named by the datalink or a tag still shows its code."
- Guide, flight following: "KEEP IFR is not on a flight-following Strip's face (VFR has no IFR to keep); it is in the
  expanded view, and stays on the face once set."
- Briefing §4 l.~1696 (Declutter last): ground clutter for **vehicles** is done (ADR 0121); the formation and navpoint
  declutters are unchanged (still off, H6/H70). Small-items row l.~1600: ¶5-4-6 e and `KEEP IFR` done.
- `docs/glossary.md` l.36 mentions "the map CSS `gnd-red` (ground units)": that image is gone.

## Defaults taken

- **ADR 0121 rule placement**: the guarantee is `presentTrack()` (the choke point, as briefed); coverage also skips
  vehicles (they cost nothing per tick) rather than computing returns nobody receives.
- **Vehicle with transponder/datalink/declaration**: never presented (ADR 0121 §4). In our model none transmits anyway.
- **Correlation**: vehicles excluded from the beacon/callsign rungs (ADR 0121 §6); an explicit binding is untouched.
- **Client ground code**: removed rather than left dead (no backwards compatibility).
- **T30 scope**: hides `conflict-alert-paths` and `conflict-alert-cpa-line` only (as T30 says); the CPA marker and its
  countdown label are kept as part of the alert. Setting name `conflictAlertPaths`, label "Show predicted paths".
- **¶5-4-6 e with no assigned code**: the tactical block shows the received code (nothing matches it; datalink- and
  tag-named contacts keep their code as before); the ATC FDB shows no pair without an assigned code (a flight's Strip
  always has BEACON). No blinking of the assigned code (STARS flashes it; ours: a plain received code only).
- **KEEP IFR**: "flight following" = OVERFLIGHT with no clearance (the client's existing test), not a new marker; a set
  `ifrActive` is never hidden. An IFR overflight with no assignment yet also loses the cell from its face (expanded view
  still has it).

## Findings for other lanes

- The `unit-squares` coalition images `sq-red`/`sq-blue`/`ac-red`/… (`icons.js` `updateIcons`) look unused since ADR
  0066 (the layer picks `*-iff-*` images); not touched here.
- `crc-sync/state/collab-overlay.json` may still hold tags/declarations on ground vehicles from before; harmless (never
  drawn), dropped with the mission session as usual.

## Walks not done

- Live DCS check: a tower scope at a busy field shows no vehicles, parked aircraft still shown.
