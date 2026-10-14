# 0125: Jurisdiction areas say whose airspace an aircraft is in; a carrier area wins, no two other areas overlap, CENTER is the rest

**Status.** Built (lane U-JURISDICTION, 2026-10-14). Rulings: decisions.md **H142**, **H143**, **H144**, **H145**, **H146**
(openAIP import is v3), **S-ARCH-62** (dispatch). Research: `docs/parallel/research/release-and-par.md` R1/R4. Followed
by U-RELEASE (ADR 0122, rewritten), which moves control of a not-released handoff at the boundary using the two functions
below. No release or handoff behaviour is in this ADR.

## Context

H142: a handoff that is **not released** moves control automatically once the receiver has the aircraft checked in
**and the aircraft is inside the receiver's airspace**. JO 7110.65BB ¶2-1-15 c: *"Assume control of an aircraft only
after it is in your area of jurisdiction unless specifically coordinated or as specified by letter of agreement or a
facility directive."* So crc-sync must know each controlling Facility's area of jurisdiction and answer one question:
whose airspace is this aircraft in. H143 gave the tower its own airspace and RAPCON the airspace below 2,000 ft; H144
removed the precedence list (only the carrier may overlap, because it moves); H145 made the tower's airspace the published
LTAG CTR.

## Decision

### 1. A third airspace kind, `JURISDICTION`

Next to `AREA` and `ROUTE` in the airspace registry (`airspace-schema.js`, `airspace-store.js`). It has no `type`, no
schedule and no activation (it always applies: `ACTIVATION_BY_KIND.JURISDICTION = null`, and every state op on it is
refused), no using agency and no frequencies. It carries:

- `controllingFacilityId` (the owning Facility: INCIRLIK, CARRIER, …) and `controllingPositionId` (who edits it),
- `ownerPositionIds`: the Positions whose airspace it is (all of them Positions of the owning Facility; checked),
- `airspaceClass` `A`–`G`. **Class G belongs to nobody** (its owner list must be empty; a point in it is nobody's),
- `altLowerFt` / `altUpperFt` in **feet MSL**; null lower = the surface, null upper = unlimited,
- `geometry`: a `POLYGON`, or a `CIRCLE` `{ centre, radiusNm, cut }` whose `centre` is a fixed `{ lat, lon }` or a
  carrier hull `{ hullId }` (a configured hull in `efsp-carriers.json`; the circle follows the live ship position the
  carrier store already has, `CarrierStore#getShipState`, and is nowhere while the hull is not found). A fixed circle may
  carry a `cut` `{ from, to }`: the part of the circle **left of the line from `from` to `to`** is removed. That is the ICAO
  control zone shape "circle … except the part north west of a straight line joining …", kept as a circle-minus-half-plane
  rather than a polygon so the source numbers stay readable in the config,
- `excludes`: ids of other static jurisdiction areas whose whole volume (their shape and limits, not their own excludes)
  is cut out of this one (H144: RAPCON minus the control zone),
- `sourceText`: the published text, verbatim, or where a number came from.

### 2. The rules (H144)

- **Boundary counts as inside** (lateral and vertical).
- **A carrier area wins** over every other area, wherever it is. It is the only area allowed to overlap anything.
- **No two static areas share volume.** The check is 3D (the altitude axis is cut at every limit; in each slice the lateral
  regions, shape minus excluded shapes, are tested for shared area; touching along an edge or at a point is not overlap).
  An area that excludes the other never overlaps it. It runs at config load, at `state/` restore (Board snapshot) and on
  every create, import and edit; a refusal names both areas. With no overlap there is no precedence list: on a shared
  boundary the first by airspaceId answers (deterministic).
- **CENTER is the rest**: a point no area holds is CENTER's, Class E. It is not drawn and has no record.
- A circle's point test is exact; the overlap check and the map use its 128-gon (`RING_POINTS`).

### 3. The query (for U-RELEASE)

`AirspaceStore` (crc-sync `src/efsp/airspace-store.js`), pure and synchronous:

```js
jurisdictionAt({ lat, lon, altFt })
  // altFt: feet MSL. -> { airspaceId, name, facilityId, positionIds, airspaceClass, fallback } | null
  // a carrier area on a found hull; else the static area holding the point; else CENTER
  // ({ airspaceId: null, facilityId: 'CENTER', positionIds: CENTER's Positions, airspaceClass: 'E', fallback: true });
  // null for Class G, or when lat/lon/altFt is not a finite number (never a guess)
isInsideJurisdictionOf(positionId, { lat, lon, altFt })
  // true when jurisdictionAt names positionId among its owners (CTR: the fallback); false for Class G / unjudgeable
```

The geometry is `src/efsp/airspace/jurisdiction.js` (`areaAt`, `contains`, `ringOf`, `findStaticOverlap`,
`checkTheater`). **The caller passes feet**, not a DCS track (whose `alt` is metres): our recommendation for U-RELEASE is
the same indicated altitude the airspace-entry alert uses (`indicatedAltFt`, ADR 0119), which is what the pilot flies and
the controller reads; U-RELEASE decides.

### 4. Shipped areas (`config/efsp-airspaces.json`, theater `Syria`)

The existing standing list (ADR 0098 §10), keyed by the theater name `GetTheatre` returns, now holds them; a
`state/efsp-airspaces.json` replaces it whole and is as strict (a definition that does not validate, an `excludes` naming
nothing, or two static areas sharing volume stops start-up). After the first import the panel's edits live in the Board
snapshot, as for every standing airspace.

| id | name | owner Positions | class | limits (MSL) | shape |
|---|---|---|---|---|---|
| `LTAG-CZ` | LTAG CTR (control zone) | LC, GC | D | SFC–3,000 ft | circle 5 nm on 37.003333 N 35.425000 E, cut off left of 36.985000 N 35.323611 E → 37.075556 N 35.476944 E |
| `LTAG-RAPCON` | Incirlik RAPCON (Adana MTMA) | AP, PAR | C | SFC–FL280 | circle 50 nm on 36.998889 N 35.433056 E, excludes `LTAG-CZ` |
| `CVN-72-CCA` | CVN-72 CCA (carrier control area) | CV_MARSHAL, CV_PRIFLY, CV_APP1, CV_APP2 | E | SFC–UNL | circle 50 nm on the hull CVN-72 |

The id is never bare "CTR" (our Center Position): `LTAG-CZ`, labelled "LTAG CTR (control zone)" (H145).

**Whose numbers are whose.**
- **Published (AIP Türkiye):** the control zone's shape and limits, verbatim, AD 2 LTAG AD 2.17 (page dated 14 MAY 26):
  *"Circle radius 5 NM centered on 370012N-0352530E except the part of the circle north west of a straight line joining
  365906N-0351925E and 370432N-0352837E. SFC-3000ft"*; the RAPCON's centre and radius, the Adana MTMA of ENR 2.1.3 (AIRAC
  AMDT 08/26): *"Centered on 365956N-0352559E, Radius 50 NM, FL280 / 2000FT AMSL"* (the ceiling FL280 is published).
- **The human's:** the RAPCON floor lowered to the surface (H143); the tower's airspace being the LTAG CTR (H145); RAPCON
  excluding exactly that volume (H144); the carrier area, 50 nm SFC–UNL on the live hull (H142); CENTER as the rest (H142);
  owners LC/GC for the tower and AP/PAR for RAPCON (H143); altitudes MSL (H145, AIP convention).
- **Ours:** the classes (control zone D, RAPCON C, carrier E; the AIP's class for the CTR is "-"), the carrier owner list
  (every CARRIER Position), the id and label spellings, the `cut` and `excludes` model, the 128-gon, the edit rights (§5).

### 5. Editing (airspaces panel)

Jurisdiction areas are listed in their own **JURISDICTION** section under the airspace cards (`jurisdiction-section.js`),
not as cards: no schedule, no state, no Delete, no History. Each shows the owning Facility and Positions, class, limits,
shape and the source text. **Edit…** opens an inline form for the class, the limits and the geometry (radius, centre and
cut of a fixed circle; radius of a carrier circle, whose anchor hull is shown read-only; the points of a polygon). A
refusal from crc-sync (an overlap naming both areas, a stale revision) shows in the form.

Rights (ours, U-JURISDICTION default; the existing airspace permission path, `definitionAuthority`):
- no Position **creates or deletes** a jurisdiction area; they come from the theater configuration (the web service
  principal still may, subject to the overlap check; it may not delete one another area excludes),
- the **controlling Position edits** it: AP the RAPCON area, LC the control zone, CV_PRIFLY the carrier area; a carrier area
  also **CV_MARSHAL** (the carrier management panel's right, H119),
- a panel edit never changes the owning Facility, the controlling Position, the owner list or a carrier anchor (refused).

The web form's airspace list (`/api/airspace-registry`) leaves jurisdiction areas out. An airspace entry
(`ApproveAirspaceEntry`) naming a jurisdiction area is refused: it is not a block a flight is cleared into. The map draws
a jurisdiction area as a thin solid grey outline with its name, class and limits on its northern edge; the layer menu has a
JURISDICTION kind, **off by default** (dark cockpit); a carrier circle redraws when the ship moves.

### 6. Wire

The airspace records already ride the airspace store's frames; the new kind and keys are record contents, which the wire
scan does not cover. `wire:record` reports the surface unchanged and `WIRE_PROTOCOL` already ahead of the last release (2
vs 1), so no bump.

## Consequences

- U-RELEASE calls `jurisdictionAt` / `isInsideJurisdictionOf` from its control settle tick; their signatures above are the
  contract.
- An old `state/efsp-airspaces.json` (if the server has one) replaces the shipped file whole, so it would not hold the
  Syria areas: delete it or add them (docs/wip/U-JURISDICTION.md).
- Importing airspace from openAIP is v3 (H146); v2 keeps the hand-entered config.
- The client mirrors the outline maths (`jurisdiction-geometry.js`, parity test), the validator and the rights; only the
  server answers whose airspace a point is in, and only the server checks overlap.
