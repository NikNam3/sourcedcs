# AIRSP-2W: airspace admin and booking tool (sourcedcs-web)

## Code as found (step 0, base 4e90958)

- `routes/bookings.js` (317 lines): resources are `bookingResources.ranges` (id, name, frequency, minAltitude, maxAltitude) and
  `.controllers`; bookings carry `resourceType` 'range' | 'controller', `resourceId`, `altitude` (ranges only). The 999 ft
  rule is `findRangeConflict` (same range, overlapping window, |dAlt| < 999). Range delete cascades its bookings.
  Discord embed is posted on create, a plain line on cancel.
- `public/js/bookings.js` (588 lines): the form picks type then resource from `/api/booking-resources`; the board has two
  sections (ranges, controllers); the admin panel owns range/controller modals.
- There is no `flight-plan-lookup.js` on the web side (it is crc-sync's caller of the web). The web-side token pattern is
  `requireFlightPlanService` in `auth.js` over `checkReleaseUploadToken` (constant-time, empty expected token refuses).
- nginx: `infra/nginx/templates/default.conf.template` (a tracked template since the refactor, not inline in compose);
  the crc-sync vhost proxies `location /` wholesale, so `/api/airspace-registry` would be public without a deny.
  `infra/tests/nginx-render.test.js` compares the template against an old fixture (so the deny edit needs its test updated).
- Tests: `node --test` over `test/`; `store.js` loads `data/` at require time, so route tests monkeypatch `store.saveJSON`
  and mutate `store.state`, never writing files.
- crc-sync's ack shape (`wire/families/airspace.js`): `{airspace, reason, detail, warning, occupied, airspaceSeq}`; the
  registry draft adds `conflicts`. The web passes it through untouched.

## Defaults taken
