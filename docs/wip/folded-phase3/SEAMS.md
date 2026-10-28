# SEAMS (phase 3): service-token helper, service clients, env naming

## Done
- B15: `requireServiceToken(name, getToken)` in `sourcedcs-web/service-token.js` and `crc-sync/src/service-token.js` (byte-identical, hash-then-compare, token read per request). Unset/empty -> 503 "<name> not configured", wrong/missing -> 401. Shared table `tests/fixtures/service-token-table.json` runs in both suites; `infra/tests/service-token-parity.test.js` keeps helper and table identical. `checkReleaseUploadToken` is gone (its length-leaking early return with it); web `auth.js` gates read `process.env` per request.
- crc-sync's two web pulls share `src/efsp/web-call.js` (the mirror of the web's `crcsync-client.js` `call()`): 401/403 -> "rejected the service token (HTTP n)", abort -> "timed out", other -> "unreachable", else "returned n". `flight-plan-lookup.js` no longer reads env at require time.
- Airspace admin page: a failed mutation says a timeout may still have applied and that resending is safe (idempotent); the web client names crc-sync's own 5xx error text (e.g. "airspace service token not configured").
- Env: `GrpcClient`/`SrsClient` take `{env}` (app.js passes its injected env, a two-line wiring change) and read `CRCSYNC_DCS_GRPC_HOST || DCS_GRPC_HOST`, same for SRS host/port, poll rate and backoff, at connect time. Compose passes the three `CRCSYNC_*` keys unrenamed.
- Docs: CLAUDE.md env table (pair `SOURCEDCS_CRCSYNC_URL`/`CRCSYNC_SOURCEDCS_WEB_URL`, the two meanings of `CRCSYNC_URL`, DCS/SRS names, token statuses), both `.env.example` files, an "advanced / test only" block in `crc-sync/.env.example` (17 `*_PATH` overrides, `CRCSYNC_TEST_RESET`, `CRCSYNC_NLA_GUARD_MS`, `CRCSYNC_CONTROL_INVARIANT`, `DCS_GRPC_PROTO_PATH`), `FLIGHT_PLAN_SERVICE_TOKEN` in crc-sync's example.
- Stale comment `atobrief/server.js` fixed.

## Release note for the server's `infra/.env`
None needed: the root `.env` keys keep their names (`CRCSYNC_DCS_GRPC_HOST`, `CRCSYNC_SRS_HOST`, `CRCSYNC_SRS_PORT`); only the container-side names changed, which compose handles. A server env with a stale bare `DCS_GRPC_HOST` is not read by compose.

## Defaults taken
- P2 documentation route for the env pair; no production key renamed.
- `||` not `??` for the host fallback so an empty `CRCSYNC_DCS_GRPC_HOST=` (compose with the key blank) still falls through to the bare name / default.
- `DCS_GRPC_PROTO_PATH` is still read at require time in `grpc-client.js` (documented only; SERVER-SEAMS-1's).
- Timeouts in crc-sync's pulls are now reported "timed out" instead of "unreachable".
- The old message "airspace service not configured" is now "airspace service token not configured".

## Findings
- Rename worth considering (needs an `infra/.env` step, not done): `CRCSYNC_INTERNAL_URL` / `SOURCEDCS_WEB_INTERNAL_URL` for the server-to-server pair. The documented pair is enough today.
- Compose still hardcodes `SOURCEDCS_CRCSYNC_URL` and does not forward it from `.env`.
- Remaining require-time env reads (SERVER-SEAMS-1): `iff.js`, `radars.js` sensor-specs path, `mutation-log.js`, `metrics.js`, `traffic-count.js`, `facility-config.js`, `DCS_GRPC_PROTO_PATH`.
- `docs/adr/0098` §9 could note the status policy (503 not configured / 401 / refusals never 401-403); ADRs are not edited here.
