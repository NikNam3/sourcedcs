# AIRSP-2S-B: service API, booking pull, drawing names (crc-sync edges of the registry)

## Code as found (step 0, base c15fcf3c)

- 2S-A is merged: `efsp.applyAsService(principal, msg)` -> `{ack, broadcasts}`, `airspaceStore.listTheaters()/getAllFor()`, `currentTheater()`. No stub needed.
- 2W is merged: `sourcedcs-web/routes/airspaces.js`, `crcsync-client.js`, `GET /api/bookings/service/upcoming` (`requireAirspaceService`).
- `app.js` `createApp` builds the hub, the tickers array and `express.static` last; `flight-plan-lookup.js` is the never-throws pattern.
- `grpc-client.js` `_getDrawings` exported no names; `missionFingerprint` (mission-session.js) hashes `x.name || x.id`.

## What was built

- `src/airspace-service.js`: router mounted at `/api/airspace-registry` in `createApp` (one line plus the calendar). Bearer `AIRSPACE_SERVICE_TOKEN`
  (sha256 then `timingSafeEqual`); no token configured -> 503 on every route; wrong/missing -> 401. `GET /theaters`, `GET /?theater=`, `POST /mutation`
  `{theater, clientMutationId, airspaceId?, baseRev?, baseDefRev?, op, actor{sub,name}}` (strict, length-capped). Ack status: 200 ok, 409 STALE_REV,
  404 NOT_FOUND, 400 VALIDATION_ERROR, else 422 (never 401/403: the web reads those as a bad service token). Broadcasts go to
  `WsHub.broadcastEfspFrames` (new; also runs the obligation re-check).
- `src/efsp/booking-lookup.js` `listUpcomingAirspaceBookings` (never throws, token = `AIRSPACE_SERVICE_TOKEN`, rows normalised, junk rows dropped).
- `src/efsp/airspace-calendar.js` `AirspaceCalendar`: cache, per-airspace next 3 for the loaded theater, ended bookings dropped on the wall clock,
  sent on change only (theater change and expiry count), a failed pull keeps the cache. Ticker `airspace-calendar` 60 s plus one pull at `start()`.
  `WsHub.broadcastAirspaceCalendar` also stores the last message, sent on connect after the EFSP snapshot.
- `grpc-client.js` `_getDrawings`: `name`, `layerName` (own commit, `behaviour(2S-B)`, F1). **`missionFingerprint` is unchanged but its input is not**: a mission with
  named drawings gets a new fingerprint once, so one mission session roll on the first connect after deploy.
- `.env.example`: `AIRSPACE_SERVICE_TOKEN`, `CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL`, `CRCSYNC_SOURCEDCS_WEB_URL`.
- Web reconciled to the real contract: `baseDefRev` (integer) sits beside `op`, not inside it (page, `crcsync-client`, route validation, tests).
  Everything else of 2W's assumptions held: `blockers` strings and `occupied` objects render, `ack.airspace` null after delete is not read, 409/404/400 acks are shown as refusals.

## Defaults taken

- `bookingUrl` is `<CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL>/bookings.html` (the briefing said "comes from" the variable; a bare site root is a worse link). Omitted when unset.
- The calendar message carries `version: 1` like every frame, and only the loaded theater's bookings (a booking in another theater has no card on this mission).
- Refusal status codes as above; the body is always the ack.
- The service path takes `baseRev`/`baseDefRev` only as top-level integers.
- The calendar pulls with `AIRSPACE_SERVICE_TOKEN`; with none set no network call is made.

## Wire / goldens

`npm run wire:record`: surface re-recorded (`efsp-airspace-calendar`), `WIRE_PROTOCOL` stays 2 (already ahead of the last release). Freeze golden changed:
`tests/freeze/golden/tables-wire-message-types.json` only (the new type literal in ws-hub/efsp sources). The client ignores the unknown frame until 2P.

## End-to-end check (AIRSP-2W step 6), done

Local crc-sync (createApp with fake gRPC, mission `Syria`, :3412, temp state) + sourcedcs-web (:7412): create a MOA through `POST /api/airspaces/mutation` as an admin
to an ack (refusal first, then ok), edit (defRev 2), stale edit (ack STALE_REV with conflicts), member 403, direct crc-sync route 401 without the token; a booking made on the web
appeared in `/api/bookings/service/upcoming` and in a connected panel socket as `efsp-airspace-calendar` after the next 60 s pull; a web edit reached the same socket as
`efsp-airspace-delta`. Not done: a real browser on `/airspace-admin.html` (no Playwright by rule), and a real crc-desktop panel (2P lanes).

## Findings

- Release note: "crc-sync serves `/api/airspace-registry/*` for sourcedcs-web behind `AIRSPACE_SERVICE_TOKEN`; mission drawings export their names (session id of a mission with named drawings changes once)."
- 2P-A: handle `efsp-airspace-calendar {theater, byAirspace, bookingUrl?}` (sent on connect and on change, never changes state).
- Briefing 3A: the section for the service API and calendar; usage guide: nothing controller-visible until 2P shows the calendar.
