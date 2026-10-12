# LT-TERRAIN (live-test finding T2): terrain masking works again

## What was wrong
MapTiler's `terrain-rgb-v2` serves **lossless WebP only** (its `tiles.json` says `format: webp`; a `.png` URL gets
`content-type: image/webp` too). `crc-sync/src/terrain.js` asked for `.png` and decoded PNG only, so every tile failed
`not a PNG`, nothing was cached, and every radar saw to its full range (fail-open, as designed).

## Fix chosen: decode WebP in pure JS (`crc-sync/src/webp-lossless.js`)
- A lossless (VP8L) decoder written to RFC 9649 §3, about 480 lines with comments, **no dependency**. It refuses lossy (`VP8 `) and
  animated WebP with an error. A DEM tile can only be lossless, and a mis-decoded DEM is worse than none (the same rule as
  the existing PNG decoder).
- `terrain.js` requests `…/terrain-rgb-v2/{z}/{x}/{y}.webp` and caches as `{cacheDir}/{z}/{x}/{y}.webp`
  (`TILE_FORMAT`). `decodeTerrainImage()` picks the decoder by magic bytes, so a PNG still decodes.
- Checked **byte for byte against libwebp 1.6.0** (via Pillow) on 11 real tiles: land, sea, and zooms 3, 6, 8, 10, 12
  and 14. Every one matched. Speed: about 27 ms per 512² tile when warm (PNG 17 ms).
- Live check with the real key (not committed): a 60 nm Incirlik pre-warm queued 72 tiles and fetched 72, with 0 failed.
  Incirlik reads 62 m (published 72.5 m; the DEM is sampled every 4 px). A low sight line north over the Taurus is
  blocked.

### Why not the alternatives
- **`@cwasm/webp`** (MIT, wasm, ~100 KB): its wasm is a 2020-era libwebp, older than the fix for CVE-2023-4863, a heap
  overflow in exactly the VP8L Huffman decoder this needs. It is unmaintained (last release 2022).
- **`sharp`** (Apache-2.0): it works on `node:22-alpine` (prebuilt linuxmusl libvips), but it adds about 8 MB of native
  binaries per platform to an image that only needs to decode one lossless format, and it is async only.
- **`@jsquash/webp`**: ESM only with async init, about 0.9 MB.
- **The older `terrain-rgb` set**: it still serves PNG (`tiles.json` `format: png`, maxzoom 12, the same pixels as v2 at
  z10 on the fixture tile). I did not verify that it is not deprecated, and v2 is the current set that the client's
  contours already use (`crc-desktop/app/public/js/elevation.js:60`). Not chosen.

## Docker / dependencies
None. `package.json` and `package-lock.json` are unchanged, `npm ci --omit=dev` in `crc-sync/Dockerfile` is unaffected,
and there are no new licences.

## Tests
`crc-sync/tests/terrain-tiles.test.mjs` (10 tests) uses real fixtures in `crc-sync/tests/fixtures/terrain/`:
- `10-612-398.webp`: terrain-rgb-v2, Incirlik / Adana plain, 196 KB;
- `10-612-398.png`: the same tile from terrain-rgb (PNG), 275 KB;
- `10-600-400.webp`: an open-sea tile, 54 bytes.

What the tests check:
- both decoders give libwebp's RGBA hash;
- known pixel heights, and the grid's min/max;
- the sea tile reads 0 m;
- lossy and truncated input is refused;
- a **boot-style pre-warm** (`new TerrainStore({ env })` as `radar-picture.js` builds it, global `fetch` stubbed with
  the real WebP bytes) fetches every tile with **0 failures**, with `.webp` URLs and `.webp` cache files;
- the Incirlik elevation is 50–80 m and a restart reads it back from the disk cache.

The cache dir is under the test process's private TMPDIR.

## Defaults taken
- **The PNG decoder stays.** It is selected by magic bytes and still covered by tests. Cost: about 100 lines kept.
- **An old `.png` disk cache is never read.** None can exist anyway: a tile failed to decode before it was saved.

## For the briefing / CLAUDE.md (supervisor)
- **ADR 0044's decision "PNG instead of WebP, decoded with Node's own zlib"** (its l.17, and the rejected alternative
  at l.41) no longer holds: the premise that "MapTiler serves the same tileset as `.png`" is false for terrain-rgb-v2.
  ADRs are never edited (P4) and this lane has no ADR number. **Supervisor decides** whether a short superseding ADR
  is owed or whether this wip note and the T2 row are enough. Its reasoning (no native dependency) carries over
  unchanged. CLAUDE.md does not mention the format, so it needs no change.

## Not done
- No wire change. No Board, sync or hub files touched, so no `soak:selfcheck`.
