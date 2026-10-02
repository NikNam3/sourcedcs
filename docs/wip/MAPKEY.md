# MAPKEY: the client's MapTiler key comes from crc-sync at login

## Code as found (step 0)
- As briefed: `app/maptiler.js` (literal default key, `CRC_MAPTILER_KEY`, `renderStyle`), `server.js` wrote `var MAPTILER_KEY` into
  `/js/config.js` and served the style with `__MAPTILER_KEY__` filled; `elevation.js` used the global; `los.js` reuses
  `elevDecodeTileMeters` (no key of its own). `tests/helpers/client-env.mjs` defined a `MAPTILER_KEY` global (removed).
- Style: `maptiler_planet` was a **TileJSON URL** source with the key; `glyphs` carried the key; `sprite` has none
  (and no sprite layer uses it; sprite requests are not MapTiler-keyed here). `maptiler_attribution` is a keyless source.
- maplibre 3.6.2 (read from the CDN dev build): `VectorTileSource` has `setTiles()` and `setUrl()`, both reload the source.
  A failed glyph range is not cached as loaded (`entry.ranges[range]` is set only on success), so a reloaded tile retries it.
- e2e: no spec asserts a basemap. The specs that mention tiles say tile/terrain fetches fail with no DCS and ignore them.

## What was built
- crc-sync `GET /api/client-config` (`requireAuth`, `Cache-Control: no-store`) -> `{ maptilerKey }`. Key = `CRCSYNC_MAPTILER_CLIENT_KEY`,
  else `CRCSYNC_MAPTILER_KEY`, else `null`; read once in `createApp` from `deps.env`. `ws-ticket` has no limiter, so none was added.
- crc-desktop: the proxy table forwards `GET /api/client-config`; `/js/config.js` has no key; the style is served as a plain static
  file; `maptiler.js` and `CRC_MAPTILER_KEY` are gone. New `js/maptiler-key.js`; `getSyncFeedUrl` calls `loadMaptilerKey(token)` once
  a ticket works (fire and forget, never throws); `map-setup.js` passes `transformRequest`; `elevation.js` throws "no MapTiler key"
  before fetching (nothing cached), and both it and the map refresh on `onMaptilerKey`.

## Decision: transformRequest + `setTiles`, not "hold map creation"
The style's vector source became **inline `tiles`** (`https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf`, maxzoom 14) instead of a
TileJSON URL. A failed TileJSON request leaves the source unloaded, and maplibre's map `load` event (where every overlay is added)
waits for it, so with no key (e2e, or a server with none) the app would never finish booting. With inline tiles the source loads at
once; tile 403s are per-tile errors. When the key arrives, `refreshMaptilerSources()` calls `setTiles()` on the MapTiler vector
sources, which reloads the tiles and retries glyphs. `setStyle` is never used. The map is still created at boot, so the rest of the app
does not wait on login. `refreshMaptilerSources` is module-private (exporting it would grow the classic-globals bridge, which may only shrink).
Residual: maxzoom 14 is my reading of MapTiler's v3 planet tileset (what its TileJSON reports is not visible without a key); if it is 15,
z15 overzooms z14 data, nothing breaks.

## Found in e2e: the map never became ready without a key (fixed)
With key-less tile requests answered 403, every tile errors and maplibre stops rendering, so the frame that fires `load` never comes:
`map.loaded()` was true but `mapReady` stayed false (the L22 specs timed out; the app's overlays are added in `load`). Fix in `initMap`:
a 400 ms `triggerRepaint()` nudge until `mapReady`. A 403 from api.maptiler.com (no key, or a refused key) shows one notice
("NO BASEMAP: map key unavailable", bottom-left of the map, removed when a key arrives) and one console warning. The style's Background
layer is the fallback basemap; scope, strips and panels do not use tiles. e2e: `helpers/test.js` answers api.maptiler.com with 403 for
every context, so no spec reaches MapTiler and the real no-key path is the one under test.

## Defaults taken (P2)
Two env names with a fallback; no pre-login key; key not stored in `localStorage`.

## Walks / not done
- Live check with a real key: **not done**, no key on this machine. The human should log in once against a crc-sync with a key and
  confirm the basemap and contours draw without a reload (the code path: first ticket -> `loadMaptilerKey` -> `setTiles` + contour update).
- Playwright, E2E_LANE=4: boot smoke + all 5 L22 scope specs pass (6/6) on the no-key path.

## Release note
crc-desktop no longer contains a MapTiler key. The basemap and elevation contours load after login with a key from crc-sync
(`CRCSYNC_MAPTILER_CLIENT_KEY`, else `CRCSYNC_MAPTILER_KEY`). Without a key on crc-sync there is no basemap and no contours. Older
clients keep the old key until it is revoked at MapTiler (infra/RUNBOOK.md, "Rotating the MapTiler key").

## For the human
1. Set `CRCSYNC_MAPTILER_KEY` and/or `CRCSYNC_MAPTILER_CLIENT_KEY` in `infra/.env` on the server (without one, clients lose the basemap).
2. Deploy crc-sync (R3-79 approval, VERSION gate). 3. Rotate per the RUNBOOK: new key at MapTiler, set it, deploy, then delete the old key.
