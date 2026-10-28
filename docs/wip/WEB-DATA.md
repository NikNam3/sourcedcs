# WEB-DATA

## Code as found
- Three `loadJSON`/`saveJSON` copies: `store.js` (atomic, no fsync), `discord-gateway.js` and `activity-daily-job.js` (plain `writeFileSync`), plus a fourth read/write in `scripts/backfill-activity-scores.js`. All loaders returned the fallback on any error.
- Web `airspace-coords.js` accepted only 2 or 6 bare numbers; crc-desktop `coords.js` accepts 2, 4 or 6.
- Admin form refused `lower > upper` only; booking altitude checked with `Number.isFinite` and the band (unbounded when the airspace has no limits); `Number(null)`/`Number('')` coerced to 0.
- Range migration checked the range exists before `await listAirspaces`, not after.

## Done
- `sourcedcs-web/json-file.js`; all four sites use it. Corrupt file -> `<name>.corrupt-<iso>` and `log.error`.
- Rule for DM without hemisphere: crc-desktop's (4 numbers = signed deg + decimal minutes), the web follows.
- `crc-desktop/tests/web-airspace-parity.test.mjs` runs the web UMD parser and booking altitude rule against crc-desktop `coords.js` and crc-sync `airspace-schema.js`.

## Findings
- The admin form's `>=` check is browser-DOM code and has no parity test; only the altitude/coords rules do.
- `bookingLimiter` (20/min per process) is shared by every test in a file; `bookings-airspace.test.js` is at its budget.
- Range (legacy) booking altitude path still uses `Number(...)` without the integer rule; legacy and being retired.
