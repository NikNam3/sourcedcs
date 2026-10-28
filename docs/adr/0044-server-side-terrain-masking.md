# 0044 — Terrain masking moves to the server, decoded with zlib and cached to disk, and the renderer keeps its copy as a diagnostic only

## Context

`docs/adr/0042` made the radar picture server-authoritative, and terrain masking is part of the picture rather than part of its presentation: terrain decides whether a contact appears at all. Leaving it in the renderer would have moved only the picture's *timing* server-side while leaving its *contents* per-client, which is the divergence 0042 exists to remove.

The math was not the problem. `los.js`'s `losSightLineHeightM` and `losProfileBlocked` are pure — 24 samples along the path, a 4/3-earth curvature model for atmospheric refraction, terrain-above-sight-line as the blocked test — and `crc-desktop/tests/los-math.test.js` was the **only** test anywhere in the radar area, 8 cases over those two functions.

The DEM source was the problem. `elevation.js` fetches MapTiler `terrain-rgb-v2` **WebP** tiles and decodes them by drawing to a `<canvas>` and reading pixels back. Node has no canvas, and `crc-sync` runs on six dependencies (`@grpc/grpc-js`, `@grpc/proto-loader`, `dotenv`, `express`, `express-rate-limit`, `ws`) — adding a native image library to decode elevation tiles is a large change in that package's character for one feature.

## Decision

**A new `src/terrain.js`, with the math ported unchanged and the DEM source replaced.**

`losSightLineHeightM` and `losProfileBlocked` come across byte for byte, along with `EFFECTIVE_EARTH_RADIUS_M`, `LOS_SAMPLE_COUNT = 24` and `LOS_DEM_ZOOM = 10`. **The test moved with them**, as `tests/terrain.test.mjs`, assertions intact. It was the one piece of existing coverage in this area and carrying it over was worth more than rewriting it.

**PNG instead of WebP, decoded with Node's own `zlib`.** MapTiler serves the same tileset as `.png`, so the decoder is ~80 lines: walk the chunks for `IHDR`/`IDAT`, `zlib.inflateSync`, reverse the five per-scanline filters, then apply Mapbox Terrain-RGB v1 (`height = -10000 + (R·65536 + G·256 + B)·0.1`) and subsample to a 128×128 `Float32Array`. **No new dependency.**

**It decodes exactly the one flavour MapTiler actually serves and throws on anything else** — 8-bit, colour type 2 or 6, non-interlaced. A silently mis-decoded DEM is terrain that masks the wrong things, which is considerably worse than no terrain at all, so guessing is not an option. `tests/terrain.test.mjs` builds real PNGs with known heights (including an Up-filtered one, so the unfiltering is exercised rather than being a memcpy) and asserts the heights come back.

**Two caches, for two different problems.** Decoded grids in memory, FIFO at 600 tiles, so the coverage tick can sample synchronously. The raw tiles on disk, so a restart does not re-fetch the theater. In the compose stack that is a volume (`crc-sync-state:/app/state`, see `docs/adr/0048`) — deliberately **not** mounted over `/app/config` or `/app/data`, since a named volume starts empty and would shadow the shipped squadron config and reference tables baked into the image, presenting as every one of them having reset to defaults.

**Pre-warm on mission load**, scoped and capped — and the scoping is another thing only running it showed. The theater's airfield radars are known once the mission lands, so the tiles covering their range circles are fetched up front. Airborne radars are not pre-warmed: they move, so there is no fixed circle, and they warm as they fly.

The first version pre-warmed for *every* radar in the theater. Against the live squadron server that is a 225-airfield map, 450 airfield radars, and 925 tiles fetched for scopes nobody will ever look through. It is now scoped to radars some Position is actually **assigned** (`assignableRadars`), and deliberately **not** to radars an *occupied* Position holds — a controller taking Approach mid-session must not then wait for a DEM.

A cap (`PREWARM_MAX_TILES = 1500`) bounds the remaining surprise rather than changing the behaviour. `CTR` legitimately carries `{kind:'approach', airport:'*'}`, because an en-route Position genuinely works every airfield, so on a large map one pre-warm is still theater-wide. Whatever the cap skips loads on demand the first time a sight line needs it, and everything fails open meanwhile.

**Three degradation paths, all fail-open, because going spuriously blind is worse than seeing slightly too much:**

- **A tile not yet cached** answers `'unknown'`, exactly as `los.js` did, and `CoverageEngine` treats that as visible without caching it, so the next sample asks again once the tile lands.
- **A tile the source has no data for** — ocean, or outside the tileset — is **sea level, not unknown.** Without that distinction an over-water radar would fail open on every sample for the whole session and never mask anything at all.
- **No `CRCSYNC_MAPTILER_KEY`** means terrain masking is simply off: every radar sees to its full range, the picture otherwise works identically, and it is logged once at startup. That is the correct degradation for a missing credential, and it is a legitimate configuration rather than a broken one — `CoverageEngine` accepts a null terrain store on the same footing.

**The renderer keeps `los.js` and `elevation.js`, for the debug beam overlay and the hover profile chart only.** They are diagnostics: the chart exists to *explain* the server's masking, not to reproduce it. `los-panel.js`'s header says so, and says which side wins if they ever disagree — the server — so neither half gets "fixed" into the other by a later reader who finds two copies of the same math. Deleting them would mean either losing a genuinely useful tool or building an endpoint to serve it, and neither is worth it for a debug overlay.

The key was hardcoded in `elevation.js`; server-side it is `CRCSYNC_MAPTILER_KEY`, with `CRCSYNC_TERRAIN_CACHE_DIR` for the cache, both wired through `.env.example` and `infra/docker-compose.yml`.

## Alternatives considered

- **Add `sharp` (or another native image library) and keep decoding WebP.** Rejected: a native dependency with a build step, in a Docker image, to read elevation tiles. The PNG variant of the same tileset plus `zlib` costs eighty lines and nothing else.
- **Use `pngjs` or a similar pure-JS decoder.** Rejected more narrowly — it would have worked, and this is the closest call here. But the input is one known format from one known source, the decode is the boring half of the file, and a dependency whose job is fully described by eighty lines of `zlib` calls is a dependency that mostly buys generality nobody needs.
- **Serve terrain to crc-sync from crc-desktop**, reusing the client's existing fetch and canvas decode. Rejected: it inverts the dependency — the authoritative picture would be masked using terrain fetched by whichever client happened to be connected, so the server's answer would depend on who was looking. That is the per-client divergence 0042 removes, reintroduced through the back door.
- **Skip terrain masking on the server and mask client-side as a display refinement**, drawing only what the local terrain permits. Rejected: two controllers would again see different contacts, differing exactly where their tile caches differed. It also makes masking a per-viewer opinion about whether an aircraft exists.
- **Ship a pre-baked DEM for the squadron's theaters** instead of fetching tiles. Rejected for now: it trades a network dependency for a repo-size and staleness problem, and it only helps for theaters somebody remembered to bake. The disk cache reaches the same steady state after one mission load and needs no curation.
- **Fail closed on unknown terrain** (treat an uncached sample as blocked). Rejected outright, and it is worth naming because it is the intuitive choice for a safety-shaped question. It would blank the scope for the first minute of every session and permanently over water, which is not a conservative failure — it is a controller with no picture and no reason given.
- **Cache line-of-sight answers on disk alongside the tiles.** Rejected: the answer depends on the target's position, which moves, so the cache key is unbounded. Caching the terrain — which does not move — and recomputing the sight line is the right split, and the 1 s per-pair memo in `docs/adr/0043` covers the rest.

## Consequences

- **`tests/terrain.test.mjs` is the ported LOS suite plus the new decoder**: the eight original assertions unchanged, real synthetic PNGs through `decodeTerrainTile` (both filter types), refusal of a non-PNG and of an unexpected tile size, the disk cache round-tripping so a second store does not re-fetch, a missing tile reading as sea level, and a ridge blocking two low aircraft while not blocking the same two at altitude.
- **`crc-desktop/tests/los-math.test.js` stays as well.** The client's copy is still live code for the debug chart, so keeping its test costs nothing and pins the diagnostic; the server copy is the authoritative one and has its own.
- **Terrain is the one thing in the picture that can be silently absent.** With no key, masking does nothing and the only signal is a single startup log line. That is deliberate, but it means "why can this radar see through a mountain" has a configuration answer as well as a code one, and the log line is where to look first.
- **`crc-sync` now makes outbound HTTPS requests** it did not before. It already reaches sourcedcs-web over HTTP and DCS-gRPC/SRS over TCP, so this is not a new class of dependency, but it is a new host (`api.maptiler.com`) and a deployment behind a restrictive egress policy will silently get no masking — which looks exactly like a missing key.
- **`crc-sync/data/` is gitignored**, and the cache is derived data with no curation value: deleting it costs one re-fetch.
- **The `CoverageEngine` is constructible with no terrain at all**, which is what lets `tests/coverage.test.mjs` test the beam arithmetic without a DEM and lets a key-less deployment run. Terrain is a dependency of the engine, not a premise of it.
