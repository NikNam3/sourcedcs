# Briefing: U-TERRAIN-DCS (server + client): terrain heights from DCS itself, one cache per map

Written 2026-10-21 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-TERRAIN-DCS`, branch `lane/U-TERRAIN-DCS`, `E2E_LANE=8`). **Commit at every green
step, at least every ~15 minutes.** ADR number **0133** (yours).

Running beside you: **U-AIRSPACE-BADGE** (`efsp/airspace-entry-alert.js`, hub delivery of an "inside" fact, client
`strip-indicators.js`), **U-ROLE-POSITIONS** (ADR 0132: `authority/`, `position-store.js`, `facility-config.js`, every
`DEFAULT_FACILITY_ID` user). Stay out of their files.

## Why

**H157 and S-ARCH-77** (read both in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`; also S-ARCH-78,
H156 MT-K1). The MapTiler quota was exhausted (140k tile requests in a day, no users) by `crc-sync/src/terrain.js`
re-asking failed tiles every 250 ms coverage tick, and by re-prewarming on an empty state dir. The human: "i would
just cache the whole map". Terrain comes from DCS itself: DCS-gRPC has no terrain RPC, but `CustomService.Eval`
(already used in `grpc-client.js` for nav points, drawings, datalink) reaches `land.getHeight`, `land.isVisible`,
`land.profile`, `coord.LLtoLO`. Live per-check `land.isVisible` was rejected (needs the link, silent while paused,
runs on the shared sim thread, untestable, straight-line horizon vs our 4/3-earth model).

## Hard rule: no automatic DCS load

**The cache is built only by a command the human runs.** No build at start-up, in a ticker, in the background or on a
cache miss. **You never run the build or validate command against a real DCS server** (the shared server is the
squadron's): test with a fake Eval. A running crc-sync only reads the cache; with no cache for the theater it logs once
and every radar sees to full range (today's no-key behaviour).

## Design (take the recommended default, log it, P2)

1. **The build command:** `cd crc-sync && npm run terrain:build -- --theater Syria [--spacing 500]`: a regular grid
   of `land.getHeight` samples over the theater's extent, asked in chunks (a few thousand points per `Eval`, one Lua
   loop returning a packed list), **resumable** (progress file; a re-run continues), **rate-limited** (a pause between
   chunks, a flag to change it; measure what one chunk costs the sim and say so), progress printed (done/total, ETA).
   It talks to DCS-gRPC with the same host env the server uses. Grid in the DCS map's own x/z metres (`LOtoLL` /
   `LLtoLO` once per corner, or in Lua), so the samples line up with the sim.
2. **Theater extents** in `config/theaters.json` (new optional field per theater, e.g. DCS x/z min/max; give Syria
   at least, cite where the numbers come from; unknown extents = the build refuses with a message). Keep the file's
   `_comment` and the strict-layer rules (`checkLayerKeys`); `theaters.js` reads it.
3. **The cache file:** one compact binary per theater and spacing (Int16 metres + a small header: theater, spacing,
   origin, dims, DCS version/date built), stored under the state dir (`CRCSYNC_TERRAIN_CACHE_DIR`, the state volume in
   the stack). Optionally shipped in `data/` later (say the size; do not commit a real cache). Strict on read: a bad
   header stops using it with one log line (not a crash: terrain is optional).
4. **Spacing:** `npm run terrain:validate -- --theater Syria`: compares grid LOS (our `terrain.js` LOS on the cache)
   against `land.isVisible` on sample radar→point pairs, at 1 km / 500 m / 250 m, and prints agreement. The human runs
   it and picks; default **500 m** until then (H157: today's resolution ~250 m, 24 samples per path).
5. **Radar masking** (`terrain.js`, `coverage.js`) reads the cache: bilinear height lookup, same LOS model (4/3 earth),
   same 1 s pair cache; MapTiler terrain fetching removed from crc-sync entirely, with its prewarm.
6. **Client contours** (`crc-desktop/app/public/js/elevation.js`, today MapTiler terrain-RGB + marching squares) and
   the radar-debug LOS (`los.js`, `los-panel.js`) read the same heights: recommended, crc-sync serves the grid (or
   tiles of it) on an authenticated HTTP route the local server proxies (`app/proxy-routes.js`), cached by the client
   per theater; keep the marching-squares code. No MapTiler terrain anywhere; MapTiler keeps the basemap only (one key,
   H156 MT-K1), the OpenFreeMap fallback stays.
7. **S-ARCH-77 folded in:** no per-tick retry of a failed fetch anywhere (server or client): a failure is remembered
   (per tile, and globally on 401/403/429) with a back-off; a request counter (logged hourly, visible in a status
   route or log) for whatever MapTiler requests remain (basemap is client-side: count there).
8. `CRCSYNC_MAPTILER_KEY` stops being a terrain key: update `.env.example`, compose, the CLAUDE.md wording goes in your
   wip note (you do not own CLAUDE.md). `CRCSYNC_MAPTILER_CLIENT_KEY` stays.

## Tests, gates

Unit tests: chunking and resume (fake Eval answering a synthetic terrain), the Lua builder's output parsing, cache
read/write and header strictness, bilinear lookup, LOS on a synthetic ridge (masked/unmasked), no DCS call outside the
command (a test that `createApp` never calls the build path), the back-off. e2e: the contour overlay with a fake grid
served by the harness, `E2E_LANE=8`; the harness never gets a MapTiler key (`harness-env.js`). Before the report: both
unit suites, `npm run walk`, `npm run freeze`, `soak:selfcheck` if anything the soak uses moved. Every command under
`nice -n 19`.

## Output

Commits; ADR 0133; `docs/wip/U-TERRAIN-DCS.md` (the human's run instructions: build, validate, where the file lands,
how long Syria takes at 500 m, the server deploy steps; defaults taken; CLAUDE.md/README wording); final message per
rule 8.
