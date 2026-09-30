# 0085 — magnetic means the World Magnetic Model at the mission date, converted by crc-sync

## Context

The controller decided that every displayed heading, course, bearing and radial is **magnetic**
(`docs/parallel/decisions.md` H15), that variation comes from the World Magnetic Model at the position
and the mission date with a per-theater override (H69), and that typed magnetic values are converted to
true on the server, never in the client (S-R2-12).

What existed before this change:

- **The client showed grid, plus a fudge factor.** `geo.js` computed each bearing as true, converted it
  to DCS's grid with a first-order Transverse Mercator convergence, and then the call sites (topbar BRA,
  measure line, track panel heading) added `settings.hdgCorrection`. That setting was a synced number that
  any controller could edit from the Airport panel. It was described in the code as "NOT real-world
  magnetic variation". Over Syria, grid and magnetic differ by about 7° (convergence about −2°, variation
  about +5.4° E), so every heading on the scope was wrong by that much unless someone had typed the
  correction by hand.
- **Typed runway courses were converted in the client, or not converted at all.** The APRT extended
  centreline turned the runway number into true with `hdgCorrection` and convergence. The topbar approach
  vector drew the typed course as if it were true.
- **The server had no convergence and no variation.** L4 found that DCS-gRPC's `heading` and `course`
  are grid (`efsp/carrier/angles.js`), and it had to take both corrections as injected inputs (S-W3).
- **The transition altitude was a synced setting** (`theater-settings.js`), 18,000 ft by default, which any
  controller could edit. H62 makes it a per-theater fact, with Syria at 10,000 ft.

## Decision

### Three north references, one module

`crc-sync/src/magnetic.js` is pure and holds the whole convention:

| Reference | Where it comes from | Relation |
|---|---|---|
| true | lat/lon maths | — |
| grid | DCS-gRPC `heading`, `course` | true = grid + γ |
| magnetic | what controllers read and type | magnetic = true − variation (east positive) |

- `variationAt(lat, lon, dateMs, override?)` gives the declination in degrees, east positive.
- `convergenceAt(lat, lon, theater)` gives γ = (lon − lon0)·sin(lat). This is the client's formula, and
  it uses the same sign as `angles.js`'s `gridToTrue`. A theater without a central meridian has **null**
  convergence, never 0.
- `trueToMagnetic`, `magneticToTrue` and `normDeg`: an unknown variation gives null, so a true value is
  never shown as if it were magnetic.

### The source hierarchy: override, then WMM2025

1. **The theater override**, `magneticVariation` in `config/theaters.json`, set per theater (and
   overridable field by field from `state/theaters.json`, as in `0079`). It takes exactly one of two forms:
   - `{ "fixedDeg": n }`: one value for the whole map, which replaces the model.
   - `{ "offsetDeg": n }`: a squadron correction added to the model.

   An entry that sets both, or neither, is dropped with a warning, and the model applies. No theater ships
   an override today.
2. **WMM2025**, evaluated at sea level, at the position, on the **mission** date. The coefficients are
   NCEI's `WMM.COF` (header `2025.0 WMM-2025 11/13/2024`), shipped verbatim as `data/wmm/WMM2025.COF`
   (`data/` holds shipped read-only reference tables, and the file is read once on first use: P5). The
   synthesis follows the WMM2025 Technical Report: geodetic to geocentric, Schmidt semi-normalised
   Legendre functions, and a rotation back to geodetic. `tests/magnetic.test.mjs` checks it against both
   of NCEI's published test tables: the 12-point table on the product page, and the 100-point table
   inside `WMM2025COF.zip`. Every declination matches to the published 0.01°, and X/Y/Z match to 0.01 nT.

**Mission dates outside 2025.0–2030.0.** For these dates the secular variation is extrapolated linearly,
as NCEI's own software does. A 2016 Syria mission reads about 5.2° E, which is a few tenths of a degree
from the historical value. The `theater` message flags this (`modelDateValid: false`) and the Airport
panel shows it in the tooltip. A theater that needs better sets an override. Older WMM epochs were not
added, because nobody has yet shown that the difference matters.

The **mission date** comes from the mission clock (`0079`), snapped to the UTC day. If the clock is on
the wall-clock fallback, the wall date is used, and the message says so (`dateSource: 'WALL'`).

### Grid convergence moves to the theater table

`tmCentralMeridianDeg` joins each theater in `config/theaters.json`. The values are
`tools/miztoyaml/projection.py`'s table (8 theaters), and a test holds the two tables together. The
client's own `THEATRE_LON0` table in `geo.js` is gone, and the client gets the value from the server.
Theaters that the projection table does not cover (TheChannel, MarianaIslandsWWII, Kola, Afghanistan,
Iraq, GermanyCW) have unknown convergence until someone adds their central meridian.

### The transition altitude is a theater fact

`transitionAltFt` joins each theater: Syria is 10,000 ft (H62), and every other theater is 18,000 ft
**`[SOURCE-DEFINED]`**, the value they all had before. A theater the table does not list also gets
18,000 ft. `theater-settings.js`, its shipped `config/theater-settings.json`, its `theaterSettingsSet`
message and its test are deleted, because nothing settable is left in them. A leftover
`state/theater-settings.json` on a server is ignored (no migration, as in `0079`). This changes one line
of `0048`'s table and of `0079`'s "`gameTimeOffset` is gone" paragraph. Neither ADR is edited (P4).

### Where conversion happens

- **Server, both directions.** `src/theater-context.js` (`TheaterContext`, one instance in `server.js`)
  holds the theater table, the current theater and airfields (set on mission load), and the mission date
  (from `noteClock()` on every clock sample and on the 5 s timer). It provides `variationAt`,
  `convergenceAt`, `trueToMagnetic`, `magneticToTrue`, `gridToMagnetic` and `transitionAltFt`. It is the
  only place a typed magnetic value becomes true. EFSP code (L4's marshal radial, H27; L17's ship state)
  takes these as its injected `magneticVariationDeg` and `gridConvergenceDeg`.
- **`GET /api/magnetic/to-true?magDeg=&lat=&lon=`** returns `{ trueDeg, variationDeg }`, behind the usual
  auth, proxied by crc-desktop's local server. The client uses it for the two magnetic values it lets a
  controller type: the topbar approach course and the APRT runway number. The map draws each line only
  after the answer arrives, and converts it again whenever the `theater` message changes.
- **Client, true to magnetic for display only.** `crc-desktop/app/public/js/magnetic.js` exports
  `toMagneticDisplay(trueDeg[, lat, lon])`, which returns whole degrees 0–359 or null. `magneticText()`
  formats the same value as `"045"`, or `"---"` when the variation is unknown. Every bearing display
  calls one of them: the topbar cursor BRA (variation at the bullseye), the measure line (at its
  start), and the track panel heading (at the contact). Without a position, the value at the grid's
  centre is used. The client has no model, no table and no setting. `gridConvergenceDeg()` is the
  client's twin of `convergenceAt()`, fed from the same message, and a parity test holds the two
  together.

### The wire: its own `theater` message, not `game-time`

```
{ version, type: 'theater', theatre, transitionAltFt, dateMs, dateSource,
  magnetic: { source: 'WMM2025' | 'WMM2025+OFFSET' | 'FIXED', modelDateValid, fixedDeg,
              grid: { latMin, lonMin, stepDeg, rows, cols, deg: [...] } | null },
  convergence: { tmCentralMeridianDeg } }
```

- **Why its own message.** Variation depends on position (the reason for H69), so the client needs a
  field, not one number. `magnetic.grid` is the model evaluated at 1° over the mission airfields'
  bounding box, padded by 3° (at most 41 × 41 points). The client interpolates in it bilinearly, which
  stays within 0.05° of the server (tested). That is a few hundred numbers, and it changes only on
  mission load or a new mission day, while `game-time` goes out every 5 s. So `game-time` keeps its
  `{ zuluMs, source }` shape. The mission date the variation was computed for travels in `dateMs`.
- **When it is sent:** on connect (after `game-time`), on mission load, and when `noteClock()` reports a
  new mission day or a switch from the wall clock to the mission clock.
- **What replaced it.** The old `theater-settings` message is gone, and so is the inbound
  `theaterSettingsSet`.

### Removed from the client

- the `hdgCorrection` default and its Airport panel input (a saved settings object has the key stripped
  on load);
- the transition-altitude input (the panel shows the theater's value read-only, together with the
  variation at the selected airfield and its source);
- `gridBearingDeg`, and `geo.js`'s convergence table.

## Consequences

- Headings on the scope are magnetic. Over Syria they move by about 7° compared with before, unless
  someone had already typed a matching `hdgCorrection` by hand.
- A new DCS theater gets correct variation with no configuration. Its convergence stays unknown until its
  central meridian is added.
- Typed and shown values go through one model, on the server, so they cannot drift apart.
- Syria flight levels now start at FL100. The track labels (via `settings.transitionAltFt`), the
  surveillance altitude formatting and conformance's indicated altitude all read the theater value.

## Open

- **Conformance compares a magnetic assigned heading with a grid course.** `efsp/conformance.js`
  compares `track.course` (DCS grid) with the typed HDG clearance. Its `actual` is grid, and the client
  prints that value as if it were magnetic. The fix belongs to an EFSP lane:
  `course: theaterContext.gridToMagnetic(track.course, track.lat, track.lon)` at `ConformanceMonitor`'s
  input. That is outside F2, which does not touch `src/efsp/`.
- **Wind direction** (the airport weather popup and the ATIS text) is shown as DCS reports it (true).
  Real ATIS winds are magnetic. H15 lists heading, course, bearing and radial, and not wind, so this is
  left for the controller to decide.
- The six theaters without a central meridian, and the `[SOURCE-DEFINED]` transition altitudes.
