# 0133: Terrain heights come from DCS, cached once per map by a command a human runs

**Status.** Accepted and built by lane **U-TERRAIN-DCS** (2026-10-21). Rulings: decisions.md **H157** (terrain from DCS,
"i would just cache the whole map"), **S-ARCH-77** (the MapTiler quota exhausted by terrain fetching), **S-ARCH-78**
(fallbacks), **H156 MT-K1** (one MapTiler key). Changes ADR 0044 (server-side masking: its DEM source) and 0042 (the
client's debug LOS reads the same heights); keeps ADR 0048 (the cache is state, on the state volume).

## Context

Radar masking (`crc-sync/src/terrain.js`) and the client's contours and radar-debug LOS (`crc-desktop/app/public/js/
elevation.js`, `los.js`) sampled MapTiler terrain-RGB tiles. On 2026-10-18 the account's quota was gone: 140,000 tile
requests in one day with no users. The server never remembered a failed tile, so every 250 ms coverage tick asked again,
and each start on an empty state directory pre-warmed up to 1,500 tiles. MapTiler's heights are also not DCS's: a radar
could be masked by a hill the sim does not have.

DCS-gRPC has no terrain RPC, but `CustomService.Eval` (already used for nav points, drawings and datalink) reaches
`land.getHeight`, `land.isVisible` and `coord.LLtoLO`/`LOtoLL`. Asking `land.isVisible` live per check was rejected in
H157: it needs the link, is silent while DCS is paused, runs on the shared sim thread, cannot be tested without DCS, and
draws a straight line where our model bends over a 4/3 earth.

## Decision

1. **A human builds the cache; crc-sync only reads it.** `cd crc-sync && npm run terrain:build -- --theater Syria
   [--spacing 500] [--chunk 4000] [--pause 500] [--out <dir>]` samples `land.getHeight` over the theater through Eval
   (`tools/terrain/`), using the server's own DCS-gRPC host env. Nothing builds at start-up, in a ticker, in the background
   or on a miss. No file under `src/` loads `tools/terrain/` or names `land.getHeight`/`isVisible`, and a booted
   `createApp` never sends terrain Lua nor fetches anything (`tests/terrain-no-dcs.test.mjs`).
2. **The build is resumable and rate-limited.** One Eval per chunk of whole grid rows (at least one row), then a pause.
   Finished rows go into `<file>.partial` and the next row into `<file>.progress.json` (written atomically after the
   rows are fsynced); a re-run with the same theater and spacing continues there, and a different grid is refused with
   the files to delete. A failed Eval is retried three times with doubling waits, then the command stops ("re-run to
   continue"). Every answer carries the mission's theater, so a mission change stops the build instead of mixing maps.
   Each chunk prints done/total, the round trip, the time inside DCS where the mission environment has `os.clock`, and
   an ETA. The finished partial is read back strictly before it is renamed.
3. **The grid is regular in latitude and longitude, not in DCS x/z.** Every sample is DCS's height at that exact lat/lon:
   the Lua turns each point into map coordinates with `coord.LLtoLO`, so samples line up with the sim. The steps are the
   spacing in metres at the box's middle latitude. Lookups then need no Transverse Mercator constants in Node, which
   three theaters have no citable source for (`tools/miztoyaml/projection.py`), and the client's contours are plain
   lon/lat. The box comes from the DCS map rectangle: `config/theaters.json` gets an optional `terrainExtent`
   `{xMin, xMax, zMin, zMax}` per theater (Syria and Caucasus shipped, from pydcs `bounds`, cited in the file's
   `_comment`). The build walks the rectangle's edges with `coord.LOtoLL` to get its lat/lon box. A theater without an
   extent is refused with a message; a malformed one is dropped with a warning (`theaters.js`).
4. **The cache file** (`src/terrain-grid.js`): magic `CRCTERR1`, a JSON header with exactly `format, theater, spacingM,
   latMin, lonMin, latStep, lonStep, rows, cols, builtAt, dcsVersion`, then `rows*cols` Int16 metres, row 0 south,
   column 0 west. Named `<Theater>-<spacing>m.terrain` in `CRCSYNC_TERRAIN_CACHE_DIR` (else `state/terrain-cache`, the
   `crc-sync-state` volume in the stack). The server takes the finest spacing present for the mission's theater. Strict
   on read: a bad magic, an unknown or missing header key, a wrong size, another theater or an unsampled cell means that
   file is not used, with one log line. Terrain is optional, so this is never a start-up failure (unlike ADR 0095's
   Board snapshot): the radar picture works, it is just not masked.
5. **Masking reads the cache** at each mission load (a local file read, so a file built while crc-sync runs is used at
   the next mission (re)start). Bilinear height, the same 24-sample 4/3-earth LOS, the same 1 s pair cache in
   `coverage.js`. No cache, or a path leaving the grid, answers `'unknown'` and fails open, as a missing key did before.
   MapTiler terrain fetching, the PNG/WebP decoders and the pre-warm are removed from crc-sync.
6. **The client reads the same heights.** `GET /api/terrain/grid` (auth) sends the loaded file as written, gzipped once
   when accepted, with an ETag; `GET /api/terrain/status` says what is loaded or why not. The local server proxies both
   and now passes `Accept-Encoding`/`If-None-Match` up and `Content-Encoding`/`ETag`/`Cache-Control`/`Vary` back.
   `terrain-grid.js` (a leaf) loads the grid when a `theater` message arrives; `elevation.js` traces contours over grid
   blocks (marching squares kept, stride a power of two so a sample is ~4 px apart); `los.js` reads the same grid. No
   MapTiler terrain request remains anywhere: MapTiler is the basemap only, with the OpenFreeMap fallback.
7. **No per-tick retry anywhere (S-ARCH-77).** The server never fetches terrain. The client loads on `theater` messages
   only; a 404 is remembered until the next one, any other failure waits 1 min doubling to 30 min. MapTiler basemap
   requests are counted where they all pass (`transformMaptilerRequest`) and the count is logged hourly.
8. **`npm run terrain:validate -- --theater Syria`** picks the spacing. For seeded radar-to-target pairs it asks DCS for
   `land.isVisible` and for the heights at the grid nodes each of the 24 LOS samples falls between, at 1 km / 500 m /
   250 m on the build's own origin (no full grid needed), and prints agreement per spacing under a flat line (resolution
   only, like for like with `isVisible`) and under our 4/3 earth, plus a "direct" row (the 24 samples straight from
   `land.getHeight`), which separates the grid's error from the error of sampling a path 24 times. Default spacing is
   **500 m** until the human has run it.
9. `CRCSYNC_MAPTILER_KEY` is no longer a terrain key: it stays only as the fallback for `CRCSYNC_MAPTILER_CLIENT_KEY`.

## Alternatives considered

- **Live `land.isVisible` per check.** Rejected in H157 (link, pause, sim thread, untestable, straight line).
- **A grid in DCS x/z metres** (the briefing's first suggestion). It would need lat/lon to x/z in Node for every lookup,
  that is the per-theater TM constants, which are uncitable for Afghanistan, Iraq and MarianaIslandsWWII, and a second
  projection in the client for the contours. The lat/lon grid gets the same alignment from DCS's own `LLtoLO`.
- **Build on a cache miss or at start-up, in the background.** Rejected by the hard rule: the shared DCS server is the
  squadron's, and a sim-thread load must be something a human chose to start.
- **Keep MapTiler with a back-off.** It fixes the quota but not the heights, which are not the sim's.
- **Ship the cache in `data/`.** Possible later (Syria at 500 m is ~6.3 MB, gzip smaller); not done, because the file
  must be built against a real server and the lane never runs the build.

## Consequences

- Until the human runs the build, every theater runs unmasked, as it did with no key. The server logs this once per
  theater, and the client shows no contours.
- Sizes and chunk counts for the shipped extents (whole rows per chunk): Syria 1 km 660 x 1,199 (1.6 MB, 220 Evals),
  **500 m 1,319 x 2,397 (6.3 MB, 1,319 Evals of one row each)**, 250 m 2,637 x 4,792 (25 MB); Caucasus 500 m
  2,159 x 3,628 (15.7 MB). The lat/lon box is wider than the rotated map rectangle, so some samples fall off the map.
- The cost of one chunk inside DCS was not measured (the lane never ran against DCS): the build prints it per chunk.
- A rebuilt file is picked up at the next mission load; a client keeps its grid until the next `theater` message.
- Tests: `terrain.test.mjs` (file strictness, bilinear, LOS over a synthetic ridge), `terrain-build.test.mjs` (fake Eval:
  chunking, resume, retries, theater checks, parsers, validate), `terrain-no-dcs.test.mjs` (the hard rule and the routes),
  crc-desktop `terrain-grid-client.test.mjs` (decodes the server's file, back-off, contours, the MapTiler counter),
  `server-proxy-routes.test.js`, e2e `terrain-contours.spec.js`.
