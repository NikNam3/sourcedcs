# U-GLYPHS: no MapTiler dependency for what the controller needs

Lane `lane/U-GLYPHS`, E2E lane 3, no ADR.

## Scope as it ended up

1. **Glyphs**: bundled by the supervisor's hotfix `6dc60cce` (openmaptiles v2.0 ranges under `app/public/fonts/`, 1.1 MB,
   `/fonts/` route, style `glyphs` local, lt-ui T3 rewritten). This lane, on top of it:
   - **Fix: the route now merges the stack** (`app/glyph-route.js`, out of `server.js` so it is unit-testable). The
     hotfix answered a stack with its first shipped font only, so for `Roboto Regular,Noto Sans Regular` Roboto's
     8448-8703 file (no arrows) hid Noto's: the `↑`/`↓` altitude trend, `▲▼`, `≠ ≤ ≥` drew nothing. Now the shipped
     fonts' files are concatenated fallback-first, primary-last (maplibre keeps the last glyph per code point).
     Roboto Mono stands in as Roboto **of the same weight** (the hotfix's filter gave the Mono stacks Noto Sans, not
     Roboto, despite its README); a stack with no shipped font gets Roboto Regular; an unshipped range is an empty 200.
   - `app/public/fonts/.gitattributes`: `*.pbf binary`. The repo's `* text=auto` had stored
     `Roboto Medium/8960-9215.pbf` as text (no NUL byte); a Windows CI checkout with autocrlf would have corrupted it.
   - The style's `sprite` (MapTiler `streets-v2-dark`) is removed: no layer uses a sprite icon (track icons are
     `map.addImage`, `icons.js`), so it was only a 403 per start. Verified by the no-key specs and the scope specs.
   - `refreshMaptilerSources` / `retryErroredTiles` (T3) are gone: only GeoJSON tiles needed the retry, and only because
     of the glyphs. The vector basemap's errored tiles are dropped by its own reload: on a new key `basemap.onKey()`
     points the source at MapTiler again even if it never left, and VectorTileSource's reload clears its tiles.
     `tests/maptiler-refresh.test.mjs` deleted with them.
   - Tests: `tests/glyph-route.test.js` (merge order, Mono alias, unknown font, empty 200, 400, traversal);
     `e2e/no-maptiler.spec.js` (a track's symbol and data block render with no key and no MapTiler glyph request; an
     unshipped range answers 200 and the label's tile loads, checked in maplibre; the fallback switch).
2. **1b, basemap fallback** (`crc-desktop/app/public/js/basemap-fallback.js`, wired in `map-setup.js`).

## Basemap fallback (1b)

- When MapTiler can't be used, the style's one vector source `maptiler_planet` is pointed in place at OpenFreeMap's
  keyless planet TileJSON, `https://tiles.openfreemap.org/planet`. The style is never replaced (setStyle would drop the
  GeoJSON layers); `VectorTileSource#setSourceProperty` (maplibre 3.6.2's own) swaps `tiles` for `url` and reloads, and
  the reload clears the old (errored) tiles. The options' `tiles` must be deleted: maplibre lets them win over a TileJSON's.
- **What counts** (`shouldFallBack`): an error event whose `sourceId` is the basemap source, while on MapTiler, with
  status 401/403/429 (no key, refused, over quota), 5xx (outage) or no status (network). 404/400 do not count. With a key,
  only an error of a request that carried that key counts; a keyless request still in flight from before the key is stale.
  Sprite/style errors carry no `sourceId` and never switch.
- **No flapping**: once on the fallback the session stays there; only a new key (`onMaptilerKey`, which fires only for a
  different non-empty key) switches back. A refused new key falls back again.
- **Neither source**: if the fallback also fails (any non-404 error that is not a stale MapTiler one), state `none`; the
  map draws everything we own on the Background layer.
- **Note**: the amber "NO BASEMAP: map key unavailable" notice is gone. `#basemap-notice` is now a quiet grey
  (`#8a8a8a`) `FALLBACK BASEMAP` or `NO BASEMAP` note, and nothing while on MapTiler. One console warning per change.
- **Attribution**: set on the source each switch (OpenFreeMap + OpenMapTiles + OpenStreetMap, as its TileJSON gives
  it; MapTiler's back on return).
- **e2e harness**: `e2e/helpers/test.js` answers every `tiles.openfreemap.org` URL with 503, so no run leaves the machine
  and a run with no key ends in state `none`. `e2e/no-maptiler.spec.js` routes it per page to test the switch.

### OpenFreeMap checks

- **Terms** (openfreemap.org/tos, last updated 2026-10-14): free, "as-is", no key, no registration, no stated rate
  limit for map display; may be discontinued without notice; served through Cloudflare. Bulk/offline downloads are
  capped (3,000 tiles / 50 MB, 4 parallel, unique User-Agent), which normal map display is not. Attribution required
  by OpenMapTiles/OSM licences. Fine as a fallback; not something to make primary without asking them.
- **Schema** (its TileJSON, `version 3.16.0`, OpenMapTiles): the five source-layers the style uses are all there with
  the fields its filters read: `water` (class, brunnel), `waterway` (brunnel, class), `boundary` (admin_level, maritime,
  class), `aeroway` (class, ref), `place` (class, `name:en`). maxzoom 14 like MapTiler's.

### Defaults taken

- Fallback provider OpenFreeMap (the supervisor's candidate); its TileJSON URL rather than a tile URL, since the tile
  path carries a dated build that changes.
- A tile 404 on the fallback is not "fallback down".
- No proactive fallback before the first MapTiler error: the keyless first request answers 403 at once, which switches.

## For the docs pass

- `crc-desktop/app/public/fonts/README.md` (the hotfix's): "Roboto Mono ... fall back to Roboto" is now true per weight;
  add that a stack is answered merged (glyph-route.js). CLAUDE.md crc-desktop: glyphs are local, no MapTiler.
- `docs/efsp-briefing.md` LT-UI T3 entry: `retryErroredTiles` is gone (glyphs local, basemap reload on key).

- crc-desktop README / CLAUDE.md "crc-desktop": the basemap is MapTiler with the key from crc-sync, falling back to
  OpenFreeMap (keyless) when MapTiler refuses or is down; the grey FALLBACK BASEMAP / NO BASEMAP note; contours still
  need MapTiler (separate lane).
- infra/RUNBOOK.md "Rotating the MapTiler key": an exhausted key no longer blanks the basemap, it falls back.

## Glyph findings before the hand-over

- The prebuilt openmaptiles/fonts v2.0 release (`v2.0.zip`, 74 MB) has Roboto Regular/Medium and Noto Sans Regular but
  **no Roboto Mono** (neither has orangemug/font-glyphs). The track data blocks use `Roboto Mono Regular/Medium`.
- maplibre 3.6.2 merges a multi-font PBF **last-wins** (`loadGlyphRange`: `glyphs[glyph.id] = glyph` over every
  fontstack in the response), so a combined stack can be served by concatenating the per-font PBFs fallback-first,
  primary-last (protobuf concatenation appends the repeated `stacks`).
- Ranges with label content beyond Latin-1: 8192-8447 (— – •′″…), 8448-8703 (↑ ↓ trend arrows), 8704-8959 (− minus,
  ≠ ≤ ≥), 9472-9727 (▲ ▼). Roboto has none of the arrows or triangles; Noto Sans Regular has all of them.
  Sizes: Roboto Regular 0-255 74 KB; the 10 ranges 0-1279 + 8192-10239 come to 340 KB (Roboto Regular), 348 KB
  (Medium), 688 KB (Noto Sans Regular).
- An empty 200 body for a glyph range is parsed as no glyphs and does not error the tile (verified in maplibre by
  `e2e/no-maptiler.spec.js`).
- A Python SDF builder (fontTools + numpy, fontnik's parameters) was drafted for Roboto Mono and calibrated against the
  openmaptiles Roboto Regular; metrics were within a pixel but not matched yet when the work was handed over. Not committed.

## Installer size

This lane adds no font files (the hotfix's 1.1 MB stays as it is): +2 small JS modules.

## Tests

- crc-desktop unit: 1407/1407 (base `6dc60cce` 1399: + glyph-route 6, + basemap-fallback 4, − maptiler-refresh 2).
  crc-sync unit: 2873/2873 (unchanged).
- Playwright lane 3: `no-maptiler` (3), `lt-ui` (5), `smoke`, `l1-overlays`, `l22-stars-scope`: all pass.
