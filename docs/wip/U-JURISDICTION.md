# U-JURISDICTION: whose airspace an aircraft is in (ADR 0125)

Lane note. Branch `lane/U-JURISDICTION`, cut from `efsp-wp5-correlation` at `543c1c1f`. Rulings H142–H146, S-ARCH-62.
Resumed after a usage stop: the first agent built the server half and the client validator/rights mirrors; the resuming
agent kept all of it and added the map, the panel section, the entry refusal, the e2e spec, the ADR and this note.

## What was built

- crc-sync: a `JURISDICTION` airspace kind (owning Facility, owner Positions, class A–G, MSL limits, polygon or circle on a
  fixed point or a carrier hull, `cut`, `excludes`, `sourceText`); the 3D static-overlap check at config load, `state/`
  restore and every write; the edit rights; `AirspaceStore#jurisdictionAt({lat, lon, altFt})` and
  `#isInsideJurisdictionOf(positionId, {lat, lon, altFt})` (ADR 0125 §3 is the contract for U-RELEASE). Shipped Syria areas
  in `config/efsp-airspaces.json`: `LTAG-CZ`, `LTAG-RAPCON` (excludes it), `CVN-72-CCA`. `ApproveAirspaceEntry` into a
  jurisdiction area is refused; the web form's registry list leaves them out.
- crc-desktop: the airspaces panel's **JURISDICTION** section (`panels/efsp/jurisdiction-section.js`, its own block under the
  cards; `airspace-panel.js` only filters the kind out of the cards and appends the section in `_appendJurisdiction`),
  the map outline (`airspace-layer.js`, thin solid grey, label on the northern edge, carrier circle on the live hull), the
  layer menu's JURISDICTION kind (off by default), hand copies under parity tests (`jurisdiction-geometry.js`, validator,
  rights), the airspace-entry popover leaves them out.

## Usage-guide wording (for DOCS)

> **Jurisdiction areas.** The airspaces panel lists, under the airspace cards, the areas that say whose airspace an aircraft
> is in: the LTAG CTR (control zone, the tower's: LC and GC), the Incirlik RAPCON (AP and PAR; the control zone is cut out
> of it) and the carrier area (50 nm round the ship, every carrier Position; it wins wherever the ship is). Everywhere else is
> CENTER's. Each shows its class, limits (feet MSL) and shape, with the published text it came from. The Position that
> controls an area edits its class, limits and shape with **Edit…** (AP the RAPCON, LC the control zone, CV_PRIFLY or
> CV_MARSHAL the carrier area, whose ship it follows cannot be changed). crc-sync refuses an edit that would make two areas
> other than the carrier's overlap, and says which. Nobody creates or deletes one in the panel. On the map they are off by
> default: Airspaces ▾ → KIND → JURISDICTION draws them as thin grey outlines.

## Defaults taken (P2)

1. **Model:** the control zone is a circle with a `cut` (circle minus the half-plane left of the published line), not a
   polygon; RAPCON uses `excludes: ['LTAG-CZ']` (the whole volume of the named area is cut out). Both keep the AIP numbers
   readable in the config.
2. **Config:** extended the existing standing list `config/efsp-airspaces.json` (theater-keyed, ADR 0098 §10) rather than a
   new file; a `_comment` key is skipped by the loader.
3. **Classes (ours):** control zone D, RAPCON C, carrier E. The AIP gives "-" for the CTR.
4. **Carrier owners:** every CARRIER Position (CV_MARSHAL, CV_PRIFLY, CV_APP1, CV_APP2); controlling Position CV_PRIFLY.
5. **Rights:** no Position creates or deletes a jurisdiction area; the controlling Position edits it, a carrier area also
   CV_MARSHAL (H119's carrier-state right). A panel edit never changes the owning Facility, controlling Position, owner list
   or carrier anchor. The web service principal may create/edit (overlap-checked) and delete one no other area excludes.
6. **On a shared boundary** of two static areas the first by airspaceId answers (no precedence list after H144).
7. **Client overlap check:** none. Only crc-sync checks overlap; its refusal (naming both) shows in the form. The client
   checks the typed values (class, limits, radius, centre, cut, points).
8. **Altitude for the query:** the caller passes feet MSL; ADR 0125 recommends U-RELEASE use the airspace-entry alert's
   indicated altitude (`indicatedAltFt`). U-RELEASE decides.
9. **Map:** off by default; label on the northern edge of the ring; a carrier circle is not drawn while the hull is not found
   and is redrawn when the ship moves (on the carrier store's `bays` mark, only when a hull position changed).
10. **Edit form:** a separate small form (`jurisdiction-section.js`), not the AREA/ROUTE editor (no frequencies, type, using
    agency, conflict table). A STALE_REV refusal says "cancel and open it again" instead of the field-by-field conflict view.

## `state/` action for the human

None on the dev server today (there is no `crc-sync/state/efsp-airspaces.json`). On a server that has one, it replaces the
shipped file whole and will not hold the Syria areas: delete it or add the three entries from `config/efsp-airspaces.json`.
On a running server the standing ids are imported into the registry once per theater, on the next mission load after the
update; an already-restored Board snapshot is checked for overlap at start-up (strict, names the file).

## Walks not done

- **Overlap refusal against the real crc-sync in e2e:** the shipped areas cannot be made to overlap from the panel (RAPCON
  excludes the control zone; the carrier may overlap anything; no Position creates one) and the rig has no airspace service
  token, so the e2e test injects crc-sync's refusal into the form's ack path. crc-sync's half is unit-tested
  (`tests/airspace-jurisdiction.test.mjs`).
- **Moving hull on the map with a live ship:** unit-tested only (`tests/airspace-layer.test.mjs`); the fake DCS has no ship.

## Tests

crc-sync `npm test` 2764/2764; crc-desktop `npm test` 1342/1342; `npm run freeze` 56/56 (no golden change);
`npm run walk` 23/23; `soak:selfcheck` PASS (Board op `approve-airspace-entry.js` touched); `wire:record` surface unchanged,
WIRE_PROTOCOL stays 2 (record contents only). e2e `E2E_LANE=8 npx playwright test e2e/jurisdiction.spec.js` 5/5.

## Findings for other lanes

- **U-RELEASE:** call `airspaceStore.jurisdictionAt({lat, lon, altFt})` / `isInsideJurisdictionOf(positionId, {lat, lon,
  altFt})` with feet (a DCS track's `alt` is metres). `null` = nobody's (Class G) or unjudgeable: never move control on it.
  CTR is in CENTER's `positionIds` for the fallback. A carrier area is nowhere while its hull is not found.
- **U-MOA:** `airspace-panel.js` changed in two places only (the kind filter at the top of `renderAirspacePanel`, and
  `_appendJurisdiction` after the cards). Any new airspace list on the card or in an alert should leave out
  `kind === 'JURISDICTION'` (they are never ACTIVE, so `activeContaining`/`activeAreasContaining` already skip them).
- **DOCS:** glossary: "LTAG CTR (control zone)" is the tower's airspace; never bare "CTR" (the Center Position).
