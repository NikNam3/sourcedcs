# MAPKEY: the client's MapTiler key comes from crc-sync at login, and the key is rotated

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**) and
> `docs/parallel/lane-rules.md` first. Rulings: decisions.md **H82 R3-39** ("the client gets the MapTiler key from
> crc-sync at login, and the key is rotated"), **S-QAC** (QAC D-3 made `app/maptiler.js` the one key source; "the
> shipped default MapTiler key is still a literal in `maptiler.js` … rotate it"), `docs/wip/QAC.md` D-3. UI code is
> exempt from "no magic values" (S3-6), but a credential is not a magic value: it must not be in the repository at all.

| | |
|---|---|
| Wave | A (first free slot; it is small) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-MAPKEY` on `lane/MAPKEY-key-from-sync` |
| ADR | none (the RUNBOOK section and this lane's wip record it) |
| Size / model | 0.5 lane / Sonnet 5.5 |
| E2E lane | `E2E_LANE=4` (boot smoke, plus one map spec of your choice) |

## Code as found (re-find at step 0)

- `crc-desktop/app/maptiler.js`: `DEFAULT_MAPTILER_KEY` (a literal key that has been in git history for months, so it is
  public), `maptilerKey(env)` (`CRC_MAPTILER_KEY` else the default), `renderStyle(text, key)` (fills
  `__MAPTILER_KEY__`).
- `crc-desktop/app/server.js` reads it once at start (`MAPTILER_KEY`). It writes `var MAPTILER_KEY` into `/js/config.js`
  and serves `/crc-desktop-scope-style.json` with the placeholder filled.
- Renderer: `map-setup.js` creates the map with `style: '/crc-desktop-scope-style.json'` at boot, before login.
  `elevation.js` builds terrain-rgb tile URLs with the global `MAPTILER_KEY`. `los.js` reuses elevation's tiles.
- `crc-desktop/tests/server-proxy-routes.test.js` tests the key, the override and the "no copy in the client" rule.
- crc-sync has its own key for terrain masking: `CRCSYNC_MAPTILER_KEY` (`src/terrain.js`, optional, in `.env.example`
  and compose).

## Goal

The crc-desktop package holds **no MapTiler key**. After the controller has logged in, the renderer asks crc-sync
(through the local server's proxy table) for its client config and gets the key. Every MapTiler request is then made
with that key. Before login there is no basemap, and the login gate covers the map anyway. The squadron can rotate the
key by changing one value in `infra/.env` and restarting crc-sync, with no client release. The lane prepares the
rotation. A human performs it.

## Design

- **crc-sync** `src/app.js`: `GET /api/client-config`, `auth.requireAuth`, `Cache-Control: no-store`, returns
  `{ maptilerKey: string|null }`. The key comes from a new optional env var `CRCSYNC_MAPTILER_CLIENT_KEY`, falling back to
  `CRCSYNC_MAPTILER_KEY`. So one key works today, and a second one (browser-restricted at MapTiler, separate quota) can
  be added later without code. Read the env once in `createApp` (deps/env, like the other env reads there). The rate
  limit is the same as `/api/ws-ticket`'s, if that one has a limiter.
- **crc-desktop local server**:
  - `app/proxy-routes.js` gains `{ match: exact('/api/client-config'), method: 'GET', path: '/api/client-config' }`.
  - `server.js` stops writing `MAPTILER_KEY` into `/js/config.js`. It serves the style JSON **as-is**, with no key in
    it at all: remove the `key=__MAPTILER_KEY__` query parameters from `crc-desktop-scope-style.json`.
  - `maptiler.js` is deleted, along with `CRC_MAPTILER_KEY`. One source is the point; a dev who wants a key sets it on
    their local crc-sync.
- **Renderer**:
  - New `js/maptiler-key.js`: `let key = null; export function maptilerKey()`, plus `export async
    function loadMaptilerKey()`. The latter fetches `/api/client-config` with the bearer token the way
    `fetchSyncTicket` does, sets `key`, and returns it. It never throws: `null` on any failure, with one console warning.
  - Call it once after a successful ticket in `getSyncFeedUrl()`. That is the "at login" moment: the first time a
    token works, and again after a re-login.
  - `map-setup.js`: pass `transformRequest(url)` to `new maplibregl.Map`. For `https://api.maptiler.com/…` it appends
    `key=<maptilerKey()>` (or replaces it). With no key it returns the URL unchanged, which gets a 403 and no tiles.
  - When the key first arrives, `map-setup.js` exports `refreshMaptilerSources()`, which reloads only the sources whose
    URLs are MapTiler's. Use the public API at your maplibre version (`setTiles`/`setUrl` on the source). If the
    pinned 3.6.2 has neither for a source type, re-add that source, and say so in the wip. **Never `map.setStyle()`**:
    it destroys the custom GeoJSON layers (`map-setup.js` comment near its style-reload note).
  - Found while briefing, so check it at step 0: the style's vector source is a **TileJSON URL**
    (`https://api.maptiler.com/tiles/v3/tiles.json?key=…`), so without a key the TileJSON request itself fails at style
    load. Its `glyphs` URL carries the key too, and its `sprite` URL does not. `transformRequest` sees glyph and
    sprite requests as well. Find out whether maplibre retries a failed glyph range after the key arrives. If it does
    not, the label layers stay blank, and the fallback is to hold map creation until `loadMaptilerKey()` settles,
    behind the login gate. Record which approach was used, and why, in the wip.
  - `elevation.js` builds its URL with `maptilerKey()`. With no key it skips the fetch and leaves the contour or LOS
    cache empty, and retries on the next request after the key arrives. It does not cache a failure forever.
- **Tests**:
  - crc-sync: the route requires auth; it returns the client key, falls back to the server key, and returns `null`
    with neither.
  - crc-desktop: rewrite `server-proxy-routes.test.js`'s maptiler cases. The proxy forwards `/api/client-config` with
    `Authorization`. `/js/config.js` has no `MAPTILER_KEY`. The style JSON has no `key=`.
  - New `tests/no-maptiler-key.test.js`: no tracked file under `crc-desktop/` matches a MapTiler key pattern
    (`/key=[A-Za-z0-9]{16,}/`, plus the old literal's exact length and shape, **without writing the old literal into
    the test**).
  - A unit test of `transformRequest` and `maptilerKey`.
- **e2e**: the Playwright crc-sync instances get no key, so no tile request leaves the machine (today they use the
  shipped key). Step 0 checks that the boot smoke's "zero script errors" does not count maplibre's tile 403s or
  missing glyphs as script errors. If the style's glyphs/sprite are MapTiler URLs, with no key the labels do not
  render; that is acceptable in e2e. Check that no spec asserts a basemap.

## The rotation (prepared, not performed)

`infra/RUNBOOK.md` gains "Rotating the MapTiler key":

1. In the MapTiler account, create a new key. Optionally restrict it, since the client loads from
   `http://localhost:<port>`.
2. Set `CRCSYNC_MAPTILER_CLIENT_KEY` (and/or `CRCSYNC_MAPTILER_KEY`) in `infra/.env` on the server.
3. Deploy crc-sync. The human approves every deploy (R3-79), and VERSION's gate applies. Clients pick the key up at
   their next login.
4. **Delete the old key in MapTiler.** It is in git history, so only revocation retires it.

Also note that every crc-desktop older than this lane keeps using the old key until step 4, and loses its basemap after
it. VERSION refuses those clients anyway once the protocol is bumped. Add one row for `CRCSYNC_MAPTILER_CLIENT_KEY` to
CLAUDE.md's env table and to `.env.example` and compose (a pass-through line like `CRCSYNC_MAPTILER_KEY`'s). Write a
release-note line in the wip.

## Owns

- crc-sync:
  - `src/app.js` (the one route and its env read);
  - `tests/client-config.test.mjs`;
  - `crc-sync/.env.example`.
- crc-desktop:
  - `app/maptiler.js` (deleted);
  - `app/server.js` (`/js/config.js` lines and the style route);
  - `app/proxy-routes.js`;
  - `app/public/crc-desktop-scope-style.json` (key parameters only);
  - new `js/maptiler-key.js`;
  - `map-setup.js` (map construction and `refreshMaptilerSources` only);
  - `elevation.js` (the URL builder only);
  - `sync.js` `getSyncFeedUrl`: one call line. Coordinate with VERSION, which edits the same function: whichever
    merges second rebases one line, and the supervisor resolves it.
  - `tests/server-proxy-routes.test.js` (maptiler cases), new tests.
- Root `.env.example`, `infra/docker-compose.yml` (one env line), `infra/RUNBOOK.md` (the section), CLAUDE.md (one env row).
- `docs/wip/MAPKEY.md`.

## Frozen for you

Everything else. ESM-GUARDS may touch guards in `map-setup.js`/`elevation.js`, but not the functions you own. Do not
edit `terrain.js`: the server key's use is unchanged.

## Steps

0. Step 0 per the refactor README:
   - re-find every symbol above, and every `MAPTILER`/`maptiler.com` hit in `crc-desktop/` and `crc-sync/`;
   - which style sources, glyphs and sprite URLs are MapTiler's;
   - maplibre 3.6.2's API for changing a source's tiles or URL;
   - whether any e2e spec depends on tiles.
1. Server route and its test.
2. Client: proxy row, config/style cleanup, `maptiler-key.js`, `transformRequest`, source refresh, `elevation.js`.
   Delete `maptiler.js`. Tests.
3. Boot smoke and one map spec on `E2E_LANE=4`. Then run the app once against a local crc-sync with a real key (your
   own dev key from the environment, never committed). Screenshot the basemap after login into
   `docs/wip/MAPKEY/`. If no key is available on the machine, say so and skip.
4. RUNBOOK, CLAUDE.md row, `.env.example`, compose line, wip with the release-note line. Both unit suites once.

## Acceptance

- `git grep` finds no MapTiler key in `crc-desktop/`, and the new test pins it.
- With a key on crc-sync, the basemap and the contours appear after login without a reload. Without one, the app
  boots with zero script errors and no basemap.
- `/api/client-config` needs a valid token.
- Both suites green.

## Defaults (P2)

- Two env names with a fallback, rather than one: the fallback means no operator change is required.
- No key before login, with no "public" pre-login key.
- The key is not cached in `localStorage`: it is fetched again each login.
