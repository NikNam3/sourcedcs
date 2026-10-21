# U-TERRAIN-DCS: terrain heights from DCS, one cache per map (ADR 0133)

Lane note, 2026-10-21. Branch `lane/U-TERRAIN-DCS`. The lane never ran the build or validate command against a real
DCS server; every test uses a fake Eval (`crc-sync/tests/helpers/fake-dcs-terrain.mjs`).

## Run instructions for the human

Pick a time when you may load the DCS server: each Eval runs on the sim thread. A mission on the theater must be
running (the command checks `env.mission.theatre` and refuses another map; a mission change mid-build stops it).

### Build (Syria, 500 m)

On the server, into the state volume directly (the image ships `tools/`):

```bash
cd <repo>/infra
docker compose exec crc-sync npm run terrain:build -- --theater Syria
#   optional: --spacing 500 (metres, default 500)  --chunk 4000 (samples per Eval, at least one row)
#             --pause 500 (ms between Evals)        --out <dir> (default CRCSYNC_TERRAIN_CACHE_DIR)
```

Or locally (`cd crc-sync && npm run terrain:build -- --theater Syria`, with `CRCSYNC_DCS_GRPC_HOST` or `DCS_GRPC_HOST`
set), then copy `state/terrain-cache/Syria-500m.terrain` into the server's volume:
`docker compose cp Syria-500m.terrain crc-sync:/app/state/terrain-cache/` (check it is owned by `node`).

- **Where it lands:** `/app/state/terrain-cache/Syria-500m.terrain` in the stack (`crc-sync-state` volume), else
  `crc-sync/state/terrain-cache/`. While it runs, `Syria-500m.terrain.partial` and `.progress.json` sit beside it.
- **Interrupted?** Run the same command again: it continues from the next row. To start over, delete the `.partial`
  and `.progress.json` files. To rebuild a finished file, delete it first.
- **How long:** Syria at 500 m is 1,319 rows x 2,397 columns = 3.16 M samples, 6.3 MB. A row is 2,397 samples, so
  each Eval is one row (the `--chunk 4000` default holds fewer than two). 1,319 Evals at `--pause 500` plus a round trip
  of ~0.1 s and the Lua time: roughly **13-20 minutes**. The command prints the measured round trip, the time inside DCS
  (when the mission environment has `os.clock`, otherwise "not measurable") and an ETA after every chunk. **Watch the
  first few lines:** if "ms in DCS per Eval" is above ~10 ms with players on, raise `--pause` (e.g. 1500) or build when
  the server is empty. At 1 km: 220 Evals of 5 rows, 1.6 MB, a few minutes.
- **Then:** restart the mission (or crc-sync). crc-sync reads the file at every mission load and logs `terrain cache
  loaded` with spacing, size, build date and DCS version. `GET /api/terrain/status` (bearer token) says what is loaded
  or why not. Clients pick it up at their next `theater` message (connect, mission load).

### Validate (pick the spacing)

```bash
docker compose exec crc-sync npm run terrain:validate -- --theater Syria
#   optional: --spacings 1000,500,250  --pairs 200  --seed 1  --pause 500
```

20 Evals for 200 pairs (10 pairs each, a few thousand point heights per Eval). Prints, per source (`direct`, `1000 m`,
`500 m`, `250 m`), how often grid LOS agrees with `land.isVisible`, under a flat line (resolution only, like for like) and
under our 4/3 earth. `direct` is the same 24 samples straight from DCS: if a spacing agrees about as well as `direct`,
it is fine enough, and the remaining disagreement is the 24-sample path, not the grid. If 500 m is clearly worse than
250 m, build `--spacing 250` (25 MB, ~45-60 min); the server takes the finest file present.

### Server deploy steps

1. Merge as usual; the Deploy workflow recreates crc-sync. No env change is needed: `CRCSYNC_TERRAIN_CACHE_DIR` is
   already `/app/state/terrain-cache` on the volume. `CRCSYNC_MAPTILER_KEY` may stay (it is now only the client
   basemap fallback).
2. Optional cleanup: the old MapTiler tiles in the volume (`/app/state/terrain-cache/10/...`) are never read again:
   `docker compose exec crc-sync rm -rf /app/state/terrain-cache/10`.
3. Run the build (above), then restart the mission.
4. The **wire protocol does not change** (two new HTTP routes, no WS frame). A client release is needed for contours to
   come from the grid: an old client keeps asking MapTiler terrain-rgb for contours (and debug LOS) until updated.

## Defaults taken (P2)

1. **Grid regular in lat/lon, sampled with `coord.LLtoLO` per point**, not in DCS x/z (the briefing's "Grid in the DCS
   map's own x/z metres"). Same alignment with the sim; no TM constants in Node (uncitable for 3 theaters) or in the
   client. The extent IS given in DCS x/z in `theaters.json` (`terrainExtent`), converted with `LOtoLL` at the edges.
   **Supervisor may want to confirm.**
2. Extents shipped for **Syria and Caucasus** only, from pydcs `bounds` at master `55dc18ad` (same commit
   `projection.py` cites). Others are refused by the build until added.
3. Default spacing **500 m**; chunk 4,000 samples (whole rows, at least one); pause **500 ms**; 3 retries at 5/10/20 s.
4. Server picks the **finest** spacing file present for the theater; re-reads at every mission load.
5. A bad file: one log line, not used, fail open (not a start-up stop: terrain is optional).
6. Client: grid fetched on `theater` messages only; 404 remembered until the next one; other failures back off 1 min
   doubling to 30 min. Held in memory, not on disk (the server answers 304 by ETag on repeat loads in one run).
7. Heights rounded to whole metres and clamped to Int16; -32768 reserved for "not sampled".
8. `CRCSYNC_MAPTILER_KEY` kept as the fallback for the client basemap key (H156 MT-K1, one key).
9. Validate's pairs: radar 20 m above ground, target 30-1,500 m above ground, 10-150 km apart, 10 % margin inside the box.
10. The e2e harness keeps a `terrain` directory across resets (`harness-env.js` KEEP), as a read-only crc-sync input;
    only `terrain-contours.spec.js` writes there and removes its file afterwards.

## Wording for shared docs (I do not own them)

- **CLAUDE.md, crc-sync architecture:** after the radar-picture sentence: "Terrain heights come from DCS itself
  (`docs/adr/0133`): a per-theater cache `<Theater>-<spacing>m.terrain` in `CRCSYNC_TERRAIN_CACHE_DIR`, built only by
  the human-run `npm run terrain:build` (`tools/terrain/`, resumable, rate-limited) and checked with `npm run
  terrain:validate`; a running crc-sync only reads it at mission load and serves it at `GET /api/terrain/grid`. Nothing
  in `src/` may call DCS for terrain (`tests/terrain-no-dcs.test.mjs`). No cache for the theater: logged once, no masking."
- **CLAUDE.md, Commands (crc-sync):** add `npm run terrain:build -- --theater Syria   # human-run only, loads the DCS
  server (ADR 0133)` and `npm run terrain:validate -- --theater Syria`.
- **CLAUDE.md, env table:** `CRCSYNC_MAPTILER_KEY`: "crc-sync (optional: only the fallback for
  `CRCSYNC_MAPTILER_CLIENT_KEY`; no longer a terrain key, terrain is the DCS cache, ADR 0133)".
  `CRCSYNC_MAPTILER_CLIENT_KEY`: "the MapTiler key crc-desktop draws its basemap with" (drop "and contours").
  `CRCSYNC_TERRAIN_CACHE_DIR`: "crc-sync (the DCS terrain cache files, ADR 0133; the stack points it at the
  `crc-sync-state` volume)".
- **CLAUDE.md, `config/theaters.json` paragraph:** add "and an optional `terrainExtent` (the DCS map rectangle in x/z
  metres, from pydcs bounds) that `npm run terrain:build` needs".
- **infra/RUNBOOK.md, "Rotating the MapTiler key":** line 7 "(also crc-sync's own terrain-masking key)" is stale: the
  key draws the basemap only; contours come from the DCS grid. Line 14's "terrain key" likewise. Add a section
  "Building the terrain cache" with the run instructions above.
- **crc-desktop README** (if it mentions contours from MapTiler): contours and the radar-debug LOS read crc-sync's DCS
  grid (`terrain-grid.js`).

## Findings for other lanes / the supervisor

- `assignableRadars` in `crc-sync/src/efsp/position-coverage.js` is now unused (its only caller was the pre-warm). Left
  in place to stay out of U-ROLE-POSITIONS's way; delete it when that lane lands.
- The harness log shows `radar selectors match nothing ... TACTICAL/TAC_C2 ...` (literal Position ids in a log): not
  this lane's, noted for U-ROLE-POSITIONS.
- The old `state/terrain-cache/10/` MapTiler tiles on the live volume are dead weight (see deploy step 2).
- `infra/RUNBOOK.md` wording is stale (above).

## Walks not done

- No run against DCS (by rule). Unknown until the human runs it: the real per-chunk cost on the sim thread, whether
  `os.clock` exists in the Eval environment, `_APP_VERSION` availability (the header then says `""`), what
  `land.getHeight` returns off the map's edge, and validate's real agreement numbers.
- No full Playwright suite (supervisor's). Ran `terrain-contours.spec.js` and `no-maptiler.spec.js` on lane 8.
