> Amended for H100 (2026-10-01): DA-5 (b) one-time migration of legacy ranges (scope, steps, tests, size 1.25); other DA answers as
> recommended.

# AIRSP-2 web: airspace admin and booking tool on sourcedcs-web (lane 2W)

> Read `docs/parallel/refactor/README.md` (the conventions) and `docs/wip/DES-AIRSP-adr-0098.md` §9 (the ADR wins).
> Rulings: the H79 AIRSP-2 note ("airspaces configurable from the admin panel on sourcedcs-web; the booking tool
> updated and linked into this"), R3-22 (per theater), R3-26 (a standing list, and ACO import later). Questions
> DA-1, DA-3..DA-6 shape this lane and are answered (decisions.md H100): **DA-5 (b), a one-time migration of legacy ranges, changed
> it**; the rest as recommended. **Starts after
> the refactor window. It may run alongside 2S-A/2S-B** against the ADR's HTTP contract, and its integration check
> runs after 2S-B merges.

| | |
|---|---|
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-AIRSP2W` on `lane/AIRSP-2W-web` |
| Size / model | 1.25 lanes / Sonnet 5.5 (+0.25 for the DA-5 migration) |

## Goal

1. A squadron admin manages a theater's airspaces on sourcedcs-web: list, create, edit and delete, with the same
   rules and conflict answers as the crc-desktop panel. Every change goes **through crc-sync**. The web stores no
   copy (DA-1).
2. The booking tool books registry airspaces instead of its own ranges. Legacy ranges are **migrated once** to registry
   airspaces by an admin, and their bookings move with them (settled H100, DA-5 b).
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
  - `POST /api/airspaces/mutation`: `requireAuth` plus `requireBookingAdmin` **settled H100 (DA-3 a)** and
    `writeOpsLimiter`. It forwards `{theater, clientMutationId, airspaceId, op}` and `actor: {sub, name}`, taken from
    the token, **never from the body**. crc-sync's ack is returned as it came (refusals, `conflicts`, `warning`).
    When crc-sync is unreachable the answer is 503 "crc-sync unreachable".
- `sourcedcs-web/routes/bookings.js`:
  - `resourceType: 'airspace'` with `airspaceRef: {theater, airspaceId}`. The altitude must lie inside the airspace's
    `altLowerFt..altUpperFt` (null = unbounded), read through the client cache. The 999 ft deconfliction rule and the
    Discord embed are kept, and the embed names the theater and airspace.
  - Legacy `range` resources: creating a new booking on one is refused with "legacy range: migrate it to an airspace".
    **One-time migration (settled H100, DA-5 b):**
    - `GET /api/booking-resources/ranges/legacy`: `requireAuth` plus `requireBookingAdmin`; the remaining legacy ranges
      with their booking counts and future-booking counts.
    - `POST /api/booking-resources/ranges/:id/migrate` `{ theater, airspaceId, allowOutOfBand? }`: `requireAuth`,
      `requireBookingAdmin`, `writeOpsLimiter`. It reads the target through the client (cached list is not used here:
      one fresh read), then **all or nothing**: every booking of the range becomes `resourceType: 'airspace'` with
      `airspaceRef: { theater, airspaceId }` and `migratedFromRangeId`; the legacy range is removed from
      `bookingResources.ranges`; the Discord embed is unchanged. It refuses (409 with the list, nothing changed) when the
      target is unknown, when a booking's altitude lies outside the airspace's `altLowerFt..altUpperFt` (unless
      `allowOutOfBand` is true, which the page offers only after showing the list), or when the merged bookings would
      break the 999 ft deconfliction rule at the target (two ranges mapped to one airspace); the admin edits or cancels
      those bookings first. Idempotent: a range already migrated answers 200 with `alreadyMigrated`. Past bookings move
      too (history keeps its meaning); the audit is a log line with the admin's name, the range id, the target and the
      count.
    - After every legacy range is migrated or deleted the migration section of the admin page hides itself, and the
      legacy `ranges` create/update/delete routes answer 410. A follow-up chore (not this lane) removes the tool and the
      routes once production has been migrated.
  - New `GET /api/bookings/service/upcoming`: `requireAirspaceService` (a new `auth.js` guard, the same shape as
    `requireFlightPlanService`, reading `AIRSPACE_SERVICE_TOKEN`). It returns airspace bookings that end in the
    future, as `[{airspaceRef, startUtc, endUtc, by, altitudeFt}]`. No user ids are returned beyond the display name.
- `sourcedcs-web/auth.js`: `requireAirspaceService`, exported.
- New `sourcedcs-web/public/airspace-admin.html` and `public/js/airspace-admin.js`:
  - a theater picker;
  - a table of airspaces (kind, type, id, name, controlling Facility/Position, using agency, frequencies, limits,
    state read-only);
  - the editor: the same fields and order as the panel. Polygon points and route fixes are a coordinate table that
    accepts decimal degrees and DMS paste, with a read-only SVG outline preview **settled H100 (DA-4 a): no map**. A DCS
    drawing outline shows as a read-only "from DCS drawing <layer>/<name>" with its points;
  - the conflict view (yours, theirs, base, per field), the delete blockers, and the R3-23 lock (when crc-sync's
    record is not RETURNED, only name and frequencies can be edited: the same rule, enforced again by crc-sync).
  - the **legacy range migration section** (only while legacy ranges exist): a table of each legacy range (id, name,
    bookings, future bookings) with a theater picker and an airspace picker (from the registry) and a `Migrate` button,
    which shows the 409 list when refused;
  The page shows only to booking admins. It is linked from `bookings.html`'s admin bar ("Manage airspaces") and from
  `wing-admin.html`'s admin bar.
- `sourcedcs-web/public/bookings.html`, `public/js/bookings.js`: the resource picker for range bookings becomes
  theater, then airspace, from `/api/airspaces`. The board groups airspace bookings under "AIRSPACES" and legacy ones
  under "LEGACY RANGES (migrate)" only while any remain. The admin panel's "ADD RANGE" button is replaced by a link to the
  airspace admin page.
- `infra/docker-compose.yml`: pass `AIRSPACE_SERVICE_TOKEN` to both `main-website` and `crc-sync`, set
  `SOURCEDCS_CRCSYNC_URL=http://crc-sync:3000` on `main-website`, and pass `CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL` to
  `crc-sync`. Root `.env.example`: the two new keys, documented. `CLAUDE.md`'s environment table: the two rows, "must
  match" noted as for `FLIGHT_PLAN_SERVICE_TOKEN`.
- Tests: `sourcedcs-web/test/airspaces-route.test.js` (role gate, actor taken from the token not the body, ack
  passed through, 503 when crc-sync is down), `test/bookings-airspace.test.js` (altitude bounds from the registry,
  legacy refusal, the service endpoint's token and shape), `test/ranges-migration.test.js` (maps one range and moves its
  bookings; all-or-nothing on a refusal; target unknown; altitude outside the band refused, then allowed with
  `allowOutOfBand`; two ranges into one airspace tripping the 999 ft rule; idempotent re-run; role gate; past bookings
  move; the legacy routes 410 once none remain), `test/crcsync-client.test.js`. Infra: extend the nginx and
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
3. Bookings: airspace resources, the legacy refusal, the service endpoint.
3b. The one-time range migration (routes and tests), then its admin-page section (step 4).
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
- A legacy range with a future booking: the admin maps it to an airspace, the booking moves and shows under the airspace;
  the range is gone from the legacy list.
- Two legacy ranges mapped to one airspace whose bookings overlap at less than 999 ft: refused with the list, nothing moves.
- A booking whose altitude is outside the target's band: refused, then moved after the admin confirms `allowOutOfBand`.

## Acceptance

`npm test` is green in `sourcedcs-web`, and in `infra` if touched. The integration check is done once by hand and
written up in `docs/wip/AIRSP-2W.md`. No secret reaches the browser (`/js/config.js` gains nothing).
