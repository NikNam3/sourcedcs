# AIRSP-2 web: airspace admin and booking tool on sourcedcs-web (lane 2W)

> Read `docs/parallel/refactor/README.md` (the conventions) and `docs/wip/DES-AIRSP-adr-0098.md` §9 (the ADR wins).
> Rulings: the H79 AIRSP-2 note ("airspaces configurable from the admin panel on sourcedcs-web; the booking tool
> updated and linked into this"), R3-22 (per theater), R3-26 (a standing list, and ACO import later). Open questions
> DA-1, DA-3..DA-6 shape this lane. Take the marked defaults unless the supervisor relays an answer. **Starts after
> the refactor window. It may run alongside 2S-A/2S-B** against the ADR's HTTP contract, and its integration check
> runs after 2S-B merges.

| | |
|---|---|
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-AIRSP2W` on `lane/AIRSP-2W-web` |
| Size / model | 1 lane / Sonnet 5.5 |

## Goal

1. A squadron admin manages a theater's airspaces on sourcedcs-web: list, create, edit and delete, with the same
   rules and conflict answers as the crc-desktop panel. Every change goes **through crc-sync**. The web stores no
   copy (DA-1).
2. The booking tool books registry airspaces instead of its own ranges. Legacy ranges become read-only (DA-5).
3. crc-sync can read the upcoming airspace bookings through a service endpoint (the calendar shown in crc-desktop,
   DA-6).

## Owns

- New `sourcedcs-web/crcsync-client.js`: `listTheaters()`, `listAirspaces(theater)` and `mutateAirspace(theater,
  msg, actor)`. It never throws (`{ok:false, reason}` on timeout, network failure or a non-JSON body), with the
  `flight-plan-lookup.js` discipline mirrored. It uses `SOURCEDCS_CRCSYNC_URL` (default `http://localhost:3000`;
  compose sets `http://crc-sync:3000`) and `AIRSPACE_SERVICE_TOKEN`. A short read cache (30 s, an engineering
  constant) serves the booking form.
- New `sourcedcs-web/routes/airspaces.js`, mounted with one line in `server.js`:
  - `GET /api/airspaces/theaters`, `GET /api/airspaces?theater=`: `requireAuth`. Members need the list to book.
  - `POST /api/airspaces/mutation`: `requireAuth` plus `requireBookingAdmin` **[default DA-3]** and
    `writeOpsLimiter`. It forwards `{theater, clientMutationId, airspaceId, op}` and `actor: {sub, name}`, taken from
    the token, **never from the body**. crc-sync's ack is returned as it came (refusals, `conflicts`, `warning`).
    When crc-sync is unreachable the answer is 503 "crc-sync unreachable".
- `sourcedcs-web/routes/bookings.js`:
  - `resourceType: 'airspace'` with `airspaceRef: {theater, airspaceId}`. The altitude must lie inside the airspace's
    `altLowerFt..altUpperFt` (null = unbounded), read through the client cache. The 999 ft deconfliction rule and the
    Discord embed are kept, and the embed names the theater and airspace.
  - Legacy `range` resources: creating a new booking on them is refused with "legacy range: book an airspace
    instead". Existing bookings still list and can still be cancelled. The admin can delete a legacy range once its
    bookings have passed.
  - New `GET /api/bookings/service/upcoming`: `requireAirspaceService` (a new `auth.js` guard, the same shape as
    `requireFlightPlanService`, reading `AIRSPACE_SERVICE_TOKEN`). It returns airspace bookings that end in the
    future, as `[{airspaceRef, startUtc, endUtc, by, altitudeFt}]`. No user ids are returned beyond the display name.
- `sourcedcs-web/auth.js`: `requireAirspaceService`, exported.
- New `sourcedcs-web/public/airspace-admin.html` and `public/js/airspace-admin.js`:
  - a theater picker;
  - a table of airspaces (kind, type, id, name, controlling Facility/Position, using agency, frequencies, limits,
    state read-only);
  - the editor: the same fields and order as the panel. Polygon points and route fixes are a coordinate table that
    accepts decimal degrees and DMS paste, with a read-only SVG outline preview **[default DA-4: no map]**. A DCS
    drawing outline shows as a read-only "from DCS drawing <layer>/<name>" with its points;
  - the conflict view (yours, theirs, base, per field), the delete blockers, and the R3-23 lock (when crc-sync's
    record is not RETURNED, only name and frequencies can be edited: the same rule, enforced again by crc-sync).
  The page shows only to booking admins. It is linked from `bookings.html`'s admin bar ("Manage airspaces") and from
  `wing-admin.html`'s admin bar.
- `sourcedcs-web/public/bookings.html`, `public/js/bookings.js`: the resource picker for range bookings becomes
  theater, then airspace, from `/api/airspaces`. The board groups airspace bookings under "AIRSPACES" and legacy ones
  under "LEGACY RANGES (read-only)". The admin panel's "ADD RANGE" button is replaced by a link to the airspace admin
  page.
- `infra/docker-compose.yml`: pass `AIRSPACE_SERVICE_TOKEN` to both `main-website` and `crc-sync`, set
  `SOURCEDCS_CRCSYNC_URL=http://crc-sync:3000` on `main-website`, and pass `CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL` to
  `crc-sync`. Root `.env.example`: the two new keys, documented. `CLAUDE.md`'s environment table: the two rows, "must
  match" noted as for `FLIGHT_PLAN_SERVICE_TOKEN`.
- Tests: `sourcedcs-web/test/airspaces-route.test.js` (role gate, actor taken from the token not the body, ack
  passed through, 503 when crc-sync is down), `test/bookings-airspace.test.js` (altitude bounds from the registry,
  legacy refusal, the service endpoint's token and shape), `test/crcsync-client.test.js`. Infra: extend the nginx and
  compose test if one asserts env keys.
- `docs/wip/AIRSP-2W.md`.

## Frozen for you

crc-sync and crc-desktop (2S-A/B, 2P-A/B), and other `sourcedcs-web` routes.

**nginx (you own this one edit).** At `165a517`, the crc-sync vhost in `infra/nginx/templates/default.conf.template`
proxies `location /` wholesale. crc-sync's `/api/airspace-registry` would therefore be reachable from the internet
(token-gated, but it is meant for in-stack use only). Add `location /api/airspace-registry { return 404; }` to the
crc-sync server block, and extend `infra/tests` if they render the template. The web calls crc-sync inside the stack
(`http://crc-sync:3000`), so it needs no public route.

## Steps

0. Step 0 per the README. Re-read `routes/bookings.js` and `public/js/bookings.js` on your base. Check how nginx
   routes crc-sync's `/api`.
1. `crcsync-client.js` with a fake fetch, failing tests first.
2. `routes/airspaces.js` and the guard.
3. Bookings: airspace resources, the legacy freeze, the service endpoint.
4. The admin page and the booking page.
5. Compose, the env example and the CLAUDE.md rows.
6. An integration check after 2S-B merges: a local crc-sync and web, a create from the web page, and the airspace
   appearing in a connected crc-desktop panel.

## Walks

- An admin creates a MOA for Syria while a mission in Caucasus is loaded: the panel does not show it, and it appears
  on the next Syria mission.
- An admin edits the frequency of an ACTIVE airspace (allowed, with the occupied warning shown), then edits its
  limits (refused, with the flights named).
- An admin and a controller edit the same field: the web shows the conflict view.
- A member books an airspace at an altitude outside its limits: refused.
- crc-sync is down: the admin page and airspace booking say so, and controller-position bookings still work.
- A legacy range with a future booking: the booking is shown and can be cancelled, but cannot be re-booked.

## Acceptance

`npm test` is green in `sourcedcs-web`, and in `infra` if touched. The integration check is done once by hand and
written up in `docs/wip/AIRSP-2W.md`. No secret reaches the browser (`/js/config.js` gains nothing).
