# U-VFR-REDO (ADR 0146): VFR as a minimal VFR strip on a tagged track

Lane note. Shared docs (guide, briefing, CLAUDE.md) are not this lane's; what they should say is below.

## Step 0: code as found (base 44cfb209)

- Suites at base: crc-sync 2973/2973, crc-desktop 1518/1518, freeze 58/58.
- `crc-sync/src/efsp/board/ops/start-flight-following.js` `StartFlightFollowing`: AP/CTR only (`AP_CTR_ONLY_OP_KINDS`), an
  OVERFLIGHT Strip IN_SECTOR in the strip-type Bay, always a discrete code, binds the track (`bindTrackOnStart`).
- `board/ops/create-vfr-departure.js` `CreateVfrDeparture`: CD (`VFR_DEPARTURE_OP_KINDS`), DEPARTURE at CLEARED, needs
  Block 9K `filed.directionOfFlight` (`flight-data-store.js` `normalizeDirectionOfFlight`, `DIRECTIONS_OF_FLIGHT`).
- `board/ops/terminate-radar-service.js` `TerminateRadarService`: DropStrip + airspace entry cleared + binding ended.
- `src/efsp/vfr.js` `hasNoClearance` (VFR = no ACTIVE assigned ALT/HDG), read by `airspace-entry-alert.js` (joint-use
  rule, filed-through coordination) and `stores.js` (`transitFlight().ifr`). Client copy `panels/efsp/vfr.js`.
- Client: `panels/efsp/flight-following.js` (track panel "Start flight following", `FLIGHT_FOLLOWING_POSITIONS`),
  `panels/efsp/vfr-departure.js` (CD toolbar `VFR…` form, `.vfr`), `strip-fields.js` 9K `DIR_WHEN_SET`,
  `keepIfrHidden`; `label-menu.js` (ADR 0140 HDG/SPD/ALT for the owner, ADR 0145 SUPPRESS).
