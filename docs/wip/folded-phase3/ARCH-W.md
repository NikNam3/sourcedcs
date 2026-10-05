# ARCH-W: architecture check of sourcedcs-web, infra, the cross-service seams and the test/tooling setup (H103)

Lane ARCH-W, read-only, worktree `sourcedcs-ARCH-W` cut from `efsp-wp5-correlation` at `562d5724` (2026-10-03).
The sibling lane ARCH-S covers crc-sync's internals. The crc-desktop client is checked by a later lane, so this report
touches `crc-desktop/app/public/js` only at the seams (mirrors, IPC, e2e).

What was run: `npm ci` and `npm test` in `sourcedcs-web/`, `crc-sync/` and `crc-desktop/` (all green: 141/141, 2403/2403,
1106/1106), each one with a snapshot of `/tmp` before and after. No Playwright run. Paths are relative to the repo root.
Effort is S (under half a day), M (one lane) or L (several lanes). **BUG** marks a real defect, not just a smell.

## Top 10, ranked by cost

Cost here means what leaving the item in place costs per wave of lanes: hours lost, wrong deploys, or data lost.

| # | Finding | Section | Effort | Kind |
|---|---|---|---|---|
| 1 | **The Playwright suite is load-sensitive by construction.** Eight specs sleep 450 ms against a 400 ms wall-clock double-tap guard. There are 54 `waitForTimeout`s, assertion timeouts shorter than the default, and a crc-sync reset only once per spec file, so one failure cascades through the rest of its file. Every full run so far fails 10 to 24 tests in parallel that pass alone. | 5.3 | M | BUG (race) |
| 2 | **Golden churn comes from granularity, not from behaviour.** One global `randomUUID` counter numbers every id, and each record is hashed whole. So "six more randomUUID calls" or one new empty field rewrites 35 to 44 golden files (13.7 MB, about 23k lines in one commit). That has happened about 15 times in 30 days, mostly at integration. Since S-M-BACKCOMPAT the freeze suite is opt-in, yet integrators still re-record it every merge. | 5.4 | M | churn |
| 3 | **The deploy gate checks one thing and deploys another.** It reads `WIRE_PROTOCOL` from the checked-out *source* at `head_sha`, then pulls the mutable `:latest` tag. It fails *open* when `sourcedcs.page` cannot be read, although ADR 0103 says "fails closed". A half-published release holds crc-sync indefinitely. The gate script has no test, and the RUNBOOK's own manual commands bypass the gate. | 3.4 | M | BUG (narrow race) + doc drift |
| 4 | **No gate catches "crc-sync no longer boots with the e2e harness's files".** `371bedde` (every spec dead after ADR 0098) would have failed a 2-second unit test that boots crc-sync with the env `playwright.config.js` builds. The atobrief image also builds with no test step at all. | 5.5 | S | missing gate |
| 5 | **sourcedcs-web can lose data.** Two non-atomic `saveJSON` copies write the voice-activity history and the activity scores. `loadJSON` turns a corrupt file into `{}`/`[]` without a word, and the next save writes that empty value over the file. | 3.1 | S | **BUG** |
| 6 | **The "Update required" overlay's download link is dead in Electron.** The external-link gate allows only the booking origin, so `CRCSYNC_DOWNLOAD_URL` is denied. | 1.5 | S | **BUG** |
| 7 | **Service-to-service auth has three copies of the bearer check and two status policies.** An unset token answers 401 on the web and 503 on crc-sync. The calendar pull folds 401/403 into "returned N". A missing token looks like an outage, and the calendar silently stays empty. | 1.1 | S | **BUG** (low) |
| 8 | **The web's copies of airspace rules have no parity test, and they already differ.** DM coordinate pairs without hemisphere letters are accepted by crc-desktop and refused by the web admin. Lower == upper altitude passes the web form. Booking altitudes have no integer or range check. | 1.2 | S | **BUG** ×3 |
| 9 | **Test runs fill `/tmp`.** One crc-sync `npm test` leaves 146 dirs (24 MB). The freeze suite has left 624 `freeze-*` dirs (212 MB) behind. crc-desktop leaves 12 per run, sourcedcs-web 6, and the Playwright config one per process. `/tmp` holds 2,939 entries (878 MB) today. | 5.1 | S | hygiene |
| 10 | **Env names are inconsistent.** The web reaches crc-sync through `SOURCEDCS_CRCSYNC_URL`, which is undocumented, and crc-sync reaches the web through `CRCSYNC_SOURCEDCS_WEB_URL`. `CRCSYNC_URL` means an https link on the web and a wss endpoint in crc-desktop. Compose renames three keys. There are 20 undocumented `CRCSYNC_*_PATH` overrides. Four modules read env at require time, which bypasses `createApp`'s injected `env`. | 1.4 | S–M | naming |

Outside the ranking, reported only (auth is out of scope for this lane): crc-desktop's local server accepts a
cross-site `POST /api/sync-config` from any web page, which can redirect the crc-sync URL and the Casdoor endpoint (§3.3).

What is fine, briefly:
- sourcedcs-web's `server.js` is 244 lines, with routes already in `routes/*.js`, so there is no god file on the web server side.
- `store.js` `saveJSON` is atomic. The "known item" is fixed.
- The mirror mechanism in crc-desktop is mature and mostly behavioural.
- The external-link gate is one tested implementation.
- The nginx config has a render-and-`nginx -t` CI check.
- crc-sync's suite runs in 23 s and isolates `state/`.
- No ASACS_* variable is read anywhere.

---

## 1. Wiring

### 1.1 Service-to-service: two tokens, four flows, three copies of one check

There are four flows between the two services:

| Flow | Client | Server check | Unset token | Wrong token |
|---|---|---|---|---|
| crc-sync → web, filed plans (`GET /api/fpl1801/service/all`, `FLIGHT_PLAN_SERVICE_TOKEN`) | `crc-sync/src/efsp/flight-plan-lookup.js:129-164`. 3 s timeout. Token read at require time (`:30`). | `sourcedcs-web/auth.js:190-196` → `checkReleaseUploadToken` | **401** | 401 |
| crc-sync → web, plan by callsign (`GET /api/fpl1801/by-callsign/:cs`) | `flight-plan-lookup.js:37-65` | **none** (`routes/fpl1801.js:55-61`, public, redacted) | n/a | n/a |
| crc-sync → web, booking pull (`GET /api/bookings/service/upcoming`, `AIRSPACE_SERVICE_TOKEN`) | `crc-sync/src/efsp/booking-lookup.js:15-53`. 3 s timeout. Token read per call. | `sourcedcs-web/auth.js:198-204` | **401** | 401 |
| web → crc-sync, registry (`/api/airspace-registry/*`, `AIRSPACE_SERVICE_TOKEN`) | `sourcedcs-web/crcsync-client.js:25-48`. 5 s timeout. | `crc-sync/src/airspace-service.js:41-47` | **503** | 401 |

- **BUG (low), `auth.js:190-204` vs `airspace-service.js:42`.**
  - **What is wrong:** an unset token answers 401 on the web and 503 on crc-sync. The calendar pull, `booking-lookup.js:29`, reports every non-2xx as `sourcedcs-web returned N`. A token missing from the web's `infra/.env` therefore looks like a flaky peer, and the calendar silently stays empty.
  - **Fix:** one policy in both services: unset → 503 "not configured", wrong → 401. `booking-lookup.js` and `flight-plan-lookup.js` then name 401/403 as "service token rejected", as `crcsync-client.js:39` already does.
  - **Effort:** S. **Risk:** low (tests: `crcsync-client.test.js` and the crc-sync booking-lookup tests).
- **Duplication.** The same bearer check exists three times on the web (`auth.js:181`, `:190`, `:198`) and once more in crc-sync with a different comparison:
  - The web uses `releases.js:41-47`. It is named `checkReleaseUploadToken` but used for all three tokens, and its early return on a length mismatch leaks the token length.
  - crc-sync uses `airspace-service.js:22-24`, which hashes both sides with SHA-256 and then compares.

  **Fix:** one `requireServiceToken(name, getToken)` per service, built on the hash-then-compare version, plus one shared test table (unset/empty/wrong/right → 503/401/401/next) that both suites run. The Docker build contexts are per service, so the helper stays a hand copy with a parity test, like the other mirrors (§1.3). **Effort:** S. **Risk:** low.
- **Should the two tokens be one?** No. Separate secrets per purpose are fine, and ADR 0098 §9 chose it. The *pattern* should be one, and today it is not:
  - The read time differs (require time vs per call).
  - The timeouts differ (3 s vs 5 s).
  - The error mapping differs (crc-sync's two pulls collapse every non-2xx into one string; the web client separates the token, timeouts, non-JSON and 5xx).
  - The retry model differs (a 60 s ticker vs none).

  **Fix:** a tiny `service-client` per service, `{call(method, path, body) → {ok, status, body} | {ok:false, reason}}`, that every flow uses. `crcsync-client.js`'s `call()` is the template. **Effort:** S. **Risk:** low.
- **Small.** A timed-out web `POST /mutation` may still have been applied on crc-sync. The web answers 503 "unreachable" (`routes/airspaces.js:44`), and the admin page does not resend with the same `clientMutationId`. Fine for now, because crc-sync's replay cache would make a resend idempotent. Note it in the admin page's error text. S.
- **Fine:** every client never throws and uses an AbortController timeout. nginx returns 404 for `/api/airspace-registry` on the public crc-sync vhost (`infra/nginx/templates/default.conf.template:134`). crc-sync never uses 401/403 for a business refusal (`airspace-service.js:27-28`).

### 1.2 Duplicated airspace validation across three services

| Copy | Where | Parity test |
|---|---|---|
| Authority | `crc-sync/src/efsp/airspace-schema.js:44-55,181`, `airspace/containment.js:12,81` | (n/a) |
| crc-desktop mirror | `crc-desktop/app/public/js/panels/efsp/airspace-validate.js:15-30,182` | **Yes, behavioural**: `crc-desktop/tests/airspace-validate-parity.test.mjs:88-131`, about 50 cases with a deepEqual on the full result. It is the strongest parity test in the repo. No divergence found. |
| crc-desktop `diffDefinitions` | `airspace-validate.js:267` vs the store's inline diff `airspace-store.js:543` | **None.** Field order differs (`DEFINITION_FIELDS` vs `Object.keys(next)`). |
| Web admin form (a subset of the rules) | `sourcedcs-web/public/js/airspace-admin.js:244-292` | **None** |
| Web coordinate parser (hand copy of `coords.js`) | `sourcedcs-web/public/js/airspace-coords.js:14-130` vs `crc-desktop/app/public/js/coords.js:36-99,172-212` | **None** (`sourcedcs-web/test/airspace-coords.test.js` tests only its own file) |
| Web booking rules | `sourcedcs-web/airspace-bookings.js:9-20`, `routes/bookings.js:282-284` | (web-only rule, 999 ft) |

- **BUG, `airspace-coords.js:110`.**
  - **What is wrong:** a DM pair without hemisphere letters ("36 12.5 36 45.0", four numbers) is accepted by crc-desktop (`coords.js:94`, `nums.length === 6 || nums.length === 4`) and refused by the web ("could not read line"). DM is the default display format (H102 AP2B-Q2), so a controller who copies a readout into the web admin hits it. The MGRS, decimal and DMS paths agree (the mirrors lane checked them on 20,000 random MGRS strings).
  - **Fix:** port the `h = nums.length / 2` branch. Add a cross-parser test in `crc-desktop/tests` that loads the web's UMD file, which works in Node as the web's own test shows, and runs one input table through both.
  - **Effort:** S. **Risk:** low.
- **BUG, `airspace-admin.js:269`.** The form checks `lower > upper`, but the schema refuses `hi <= lo` (`airspace-schema.js:122`). Lower == upper passes the form and comes back as a server refusal after Save. **Fix:** `>=` and the server's wording. S, no risk.
- **BUG, `routes/bookings.js:282,309`.** A booking altitude is checked only with `Number.isFinite` and against the band. With no limits the band is ±Infinity (`airspace-bookings.js:13-16`), so -5000, 1e9 or 1500.5 ft is stored. crc-sync then relays it unvalidated in `efsp-airspace-calendar` (`airspace-calendar.js:46`). **Fix:** require an integer in 0..100000, the schema's bounds. S, low risk.
- **Structural.** The web form re-implements about a third of the rules, and the rest arrive as a refusal after Save. That is acceptable because crc-sync stays the authority (ADR 0098 §1). **Fix (later):** generate a UMD `airspace-rules.js` for the web from the same source as the desktop mirror (§1.3), so the form shows the same messages before Save. M.

### 1.3 crc-desktop mirrors of crc-sync tables and logic

| # | Client | Server | Parity test | Strength |
|---|---|---|---|---|
| 1 | `js/wire-protocol.js` | `src/wire-protocol.js` | `tests/wire-protocol-parity.test.mjs` | Constant. Adequate. |
| 2 | `js/altimetry.js` | `src/altimetry.js` | `tests/altimetry-parity.test.mjs:16-39` | 8 constants plus 3 samples. `ISA_T0` is not checked. |
| 3 | `panels/efsp/airspace-validate.js` | `efsp/airspace-schema.js`, `airspace/containment.js` | `airspace-validate-parity.test.mjs` | Behavioural. Strong. |
| 4 | `panels/efsp/airspace-capabilities.js` | `efsp/authority/airspace.js` + facility config | `airspace-capabilities-parity.test.mjs` | Behavioural over real config. |
| 5 | `panels/efsp/bay/authority-mirror.js` | `efsp/authority/**` | `client-mirror-parity.test.mjs` | Source-text literal extraction (`tests/helpers/mirror-source.mjs:23`). Loud on rename. `COORDINATION_TARGETS` (`authority-mirror.js:19-22`) is a hard-coded 2-Facility topology. |
| 6 | `panels/efsp/efsp-nla.js` | `efsp/nla.js`, `authority/` | `client-mirror-parity.test.mjs` | Tables. |
| 7 | `panels/efsp/strip-template.js` (Block Maps) | `efsp/block-map.js` | `efsp-block-map-parity.test.mjs` | Tables; asymmetries documented. |
| 8 | `runway-status-rules.js`, `ordnance-advisory.js` | `efsp/runway-status.js` | `client-mirror-parity`, `efsp-ordnance-client` | Tables plus a fixture run. |
| 9 | `panels/efsp/scramble.js` | `efsp/alert-scramble.js` | `efsp-scramble-client.test.mjs` | Fixture through both. |
| 10 | `panels/efsp/time-chains.js` | `efsp/time-chains.js` | both suites plus `crc-sync/tests/fixtures/time-chains.json` | **Byte-identical** body. |
| 11 | `formation-rules.js` | `authority/index.js` | `efsp-formation-rules.test.mjs` | Tables. |
| 12 | `sfa-state.js`, `carrier-state.js` | `permission.js`, `sfa.js`, `hull-config.js` | `efsp-sfa-client`, `efsp-carrier-client` | Tables. |
| 13 | `efsp-stereo-routes.js` `normalizeStereoNameClient` | `stereo-routes.js` | `efsp-stereo-routes-client.test.mjs` | Behaviour. |
| 14 | `airspace-geometry-model.js:138` `missionFingerprint` | `mission-session.js` | `airspace-geometry.test.mjs` | Behaviour (the FNV hash must match). |
| 15 | `iff.js:22` `IFF_STATES` | `surveillance/iff.js:22` | `client-mirror-parity` | Constant. |
| 16 | `magnetic.js` | `magnetic.js` | **in crc-sync**: `crc-sync/tests/theater-context.test.mjs:173` | Behaviour. Runs only under crc-sync's suite. |
| 17–18 | `formatZuluHhmm`, `geo.js haversineM` | `zulu-time.js`, `geo.js` | `client-mirror-parity` | Behaviour. |
| 19 | `efsp-state.js:592` getRack "exactly like board-store" | `board-store.js` | **none** | A claim in a comment only. |
| 20 | web `airspace-coords.js` | desktop `coords.js` | **none** | See §1.2 (BUG). |

- **Assessment.** ADR 0001 / ARCH-D7, "hand copy plus parity test", works. 18 of 20 mirrors are guarded, and the airspace and time-chains ones are strong. Mirrors #19 and #20 and `diffDefinitions` are the gaps. **Fix:** add the two tests and either delete or test `diffDefinitions`. S, no risk.
- **Could one shared module replace them?**
  - **Constraints:** crc-sync is CommonJS while the renderer is ESM. crc-sync's Docker context is `./crc-sync` only (`crc-sync-docker.yml:94`, `Dockerfile` `COPY . .`). electron-builder packages only `build.files` (`crc-desktop/package.json:37-47`, pinned by `packaging-config.test.js`). A runtime `shared/` directory would therefore need the Docker context moved to the repo root and a pre-pack copy, since a symlink breaks the NSIS build. That is L and fragile.
  - **Recommendation:** for the *pure* files (#1, #2, #3, #9, #10, #13, #14), make the ESM file the source and generate the CJS twin with a committed `scripts/sync-shared.js` and a "generated, do not edit" header. The parity tests become "generated files are up to date". No Docker or packaging change is needed.
  - **Not worth it** for the authority tables (#5, #6, #11, #12). The server refuses anyway. The real fix there is sending the permission table on the wire, which is L and a later decision.
  - **Effort:** M for the generator plus #3 and #10, then S per file. **Risk:** low.
- **Fine:** `wire-protocol.js` as a hand copy. It is one integer, and the deploy gate reads both files as text (§3.4).

### 1.4 Env var sprawl

Source: root `.env.example`, `crc-sync/.env.example`, `infra/docker-compose.yml`, and every read in code. crc-sync reads
through an injected `env` (`src/app.js:126`) *and* through bare `process.env`, so a grep for `process.env` misses about half.

- **No orphans.** Every uncommented key in `.env.example` is read. No `ASACS_*` variable is read anywhere. The surviving `asacs` strings are the hostname `asacs.sourcedcs.page`, which is intentional.
- **Inconsistent names for the same concept** (S, low risk; a rename needs an `infra/.env` step in the release note):

  | Concept | Name | Problem |
  |---|---|---|
  | web → crc-sync base URL | `SOURCEDCS_CRCSYNC_URL` (`sourcedcs-web/crcsync-client.js:95`, compose `:152` hardcoded) | In neither `.env.example` nor the CLAUDE.md table. The default `localhost:3000` is not obvious for local web development. |
  | crc-sync → web base URL | `CRCSYNC_SOURCEDCS_WEB_URL` | The mirror-image name has `_WEB_`; the other does not. |
  | crc-sync public link (web page) vs crc-sync WebSocket (desktop) | both `CRCSYNC_URL` | https on the web (`store.js:157`), wss in crc-desktop (`main.js:89`). |

  **Fix:** name the server-to-server pair by direction, `CRCSYNC_INTERNAL_URL` (read by the web) and `SOURCEDCS_WEB_INTERNAL_URL` (read by crc-sync), or document the pair in one CLAUDE.md row. The documentation route is S.
- **Compose renames** `CRCSYNC_DCS_GRPC_HOST/SRS_HOST/SRS_PORT` → `DCS_GRPC_HOST/SRS_HOST/SRS_PORT` (compose `:195,198,199`). Their sibling `DCS_GRPC_POLL_RATE` is not prefixed, and `CRCSYNC_COALITION`/`CRCSYNC_MAPTILER_*` keep the prefix inside the container.
  - **Cost:** it already caused a real bug, in which the e2e harness set the `CRCSYNC_*` names and silently connected to production DCS (comment at `crc-desktop/playwright.config.js:63-69`).
  - **Fix:** have crc-sync read `CRCSYNC_DCS_GRPC_HOST ?? DCS_GRPC_HOST`, so compose passes names straight through, and drop the rename. S, low risk.
- **Undocumented:**
  - 20 `CRCSYNC_*_PATH` overrides (`efsp/index.js:80-81`, `facility-config.js:177-180`, `metrics.js:54`, …) plus `CRCSYNC_TEST_RESET`, `CRCSYNC_CONTROL_INVARIANT` and `DCS_GRPC_PROTO_PATH`. Most duplicate `CRCSYNC_STATE_DIR` (ADR 0048).
  - `FLIGHT_PLAN_SERVICE_TOKEN` is missing from `crc-sync/.env.example`, so a local crc-sync cannot pull filed plans.

  **Fix:** an "advanced/test only" block in `crc-sync/.env.example` (S). Longer term, have the e2e harness use `CRCSYNC_STATE_DIR` and delete the per-file overrides (M).
- **Env read at require time, bypassing `createApp`'s injected env:** `flight-plan-lookup.js:28,30`, `grpc-client.js:9-19`, `srs-client.js:7-8`, `surveillance/iff.js:24`. `booking-lookup.js:17,19` already reads per call. **Fix:** read from the injected `env` inside the function. S, low risk (ARCH-S may own the crc-sync side).
- **Stale comment:** `atobrief/server.js:52` says crc-sync reads the USMTF export. CLAUDE.md and `.env.example:70` correctly say nothing sends it. S.

### 1.5 Electron main/preload IPC and the external-link gate

The surface is small:
- `contextIsolation: true` (`crc-desktop/main.js:101-106`).
- The preload exposes `window.crcUpdate` (5 functions) and `window.crcLinks.allowBookingUrl` (`app/preload.js:5-16`).
- There are 5 ipcMain handlers (`main.js:213,219,232,233,239`).
- `shell.openExternal` is called once (`main.js:125`) through one Electron-free, tested gate (`crc-desktop/external-link.js`).

- **BUG, `app/public/js/update-required.js:63` with `main.js:120-127`.**
  - **What is wrong:** the overlay renders `<a href=downloadUrl target="_blank">`. That goes to `setWindowOpenHandler`, which opens only the Casdoor authorize URL or the *booking* origin. The download link (`CRCSYNC_DOWNLOAD_URL`, compose default `https://sourcedcs.page/download.html`) is denied, so clicking it does nothing. "Check for update" works over IPC, so only the "no update published yet" path is stranded.
  - **Fix:** let the gate hold a set of origins, with an `allowDownloadUrl` channel the overlay calls, or have the overlay report its URL through the existing channel. Extend `external-link.test.js`.
  - **Effort:** S. **Risk:** low.
- **BUG (narrow), `main.js:121`.**
  - **What is wrong:** the Casdoor popup is allowed by `startsWith(process.env.CASDOOR_ENDPOINT + '/login/oauth/authorize')`, a prefix match (not an origin compare), on a value `main.js` set once from `config.json`. The connection widget can change the endpoint at runtime (`POST /api/sync-config`, `app/server.js:86-102`). After that change the login popup is denied.
  - **Fix:** parse with `new URL`, compare origin plus pathname, and read the endpoint from the local server's live `syncConfig`.
  - **Effort:** S.
- **Not exploitable today, worth closing:**
  - `external-link-allow` trusts any frame. The Casdoor popup inherits the parent's webPreferences, including the preload. `allowBookingUrl` can therefore be called by any script in the renderer or the popup.
  - There is no `will-navigate`/`will-redirect` guard.

  **Fix:** give the popup `webPreferences: { preload: undefined, sandbox: true }`, check `event.senderFrame.url` in the handlers, and add a `will-navigate` handler that keeps the main window on the local origin. S, low risk. This is an IPC trust boundary, not auth hardening; the owner decides.
- **Fine:** one gate implementation; non-http(s) schemes, userinfo and lookalike hosts are refused; DevTools only when unpackaged. Make `sandbox: true, nodeIntegration: false` explicit so a default change shows up in review (S).

### 1.6 Other wiring

- **Dead code, `crc-sync/src/app.js:64,699`.** `PUBLIC_DIR` plus `express.static(PUBLIC_DIR)` serve a directory that does not exist. CLAUDE.md and `crc-sync/README.md:5` document the leftover instead of removing it. **Fix:** delete both lines and the "own public/ frontend" CORS comment (`:66-69`). S, no risk. ARCH-S may take it.
- **Three copies of `loadJSON`/`saveJSON` in sourcedcs-web**: `store.js:46-62`, `discord-gateway.js:35-40`, `activity-daily-job.js:22-27`. Two of them are wrong (§3.1).

## 2. God files

- **sourcedcs-web server side: none.**
  - `server.js` is 244 lines. Its only handlers left are `/health`, the release upload/latest and `/auth/token` (`:151-203`); 12 routers are mounted at `:204-215`.
  - Optional (S): move releases and `/auth/token` to `routes/releases.js` and `routes/auth.js`, and the legacy squadron-override migration (`:55-81`) to a startup module.
  - The largest router is `routes/bookings.js` at 437 lines. It mixes controller bookings, airspace bookings and the one-time range migration (`:125-198`). Delete the migration once production is migrated, as ADR 0098 §9 already says.
- **sourcedcs-web front end.** `public/css/style.css` is 1,720 lines. `form1801.js` (745), `flightplan.js` (716) and `bookings.js` (669) each mix rendering, validation and fetch. No action before a feature needs it.
- **infra.** `docker-compose.yml` is 250 lines and fine. `nginx/templates/default.conf.template` is 144 lines and fine. `infra/RUNBOOK.md` (295 lines) mixes MapTiler key rotation, the wire gate, a release checklist, the 2026-08 wiki-scraper incident, a secrets incident and a test log. **Fix:** split it into `infra/runbooks/<topic>.md` with RUNBOOK as an index. S.
- **e2e helpers.**
  - `crc-desktop/e2e/helpers/app.js` is 317 lines. It mixes login and panel bootstrap, seeding, locators, assertions and cleanup. Not a god file; an optional split into `session/seed/locators/expects` is S.
  - The largest specs are `l3-coordination` (461), `runway-status` (433), `airspace-geometry` (408) and `l2-block-editing` (353). Shards are file-granular, so splitting the long-running ones (spec-timings: `mtr-fields` 284 s, `l4-chain` 264 s, `l2-block-editing` 251 s) by describe also balances shards.
- **Tools.**
  - `crc-sync/tools/soak/driver.js` (1,328 lines) mixes the scenario script, traffic generation and assertions, although `traffic.js`/`report.js`/`ledger.js` exist. ARCH-S scope; noted.
  - `tools/miztoyaml/build_missions.py` (771 lines) is fine.
- **Workflows.** All under 120 lines; fine.

## 3. Bad paradigms

### 3.1 Non-atomic writes and silent corruption in sourcedcs-web

- **BUG, `sourcedcs-web/discord-gateway.js:38-40` and `activity-daily-job.js:25-27`.** These plain `fs.writeFileSync` calls write `voice-activity.json`, every 5 min and on SIGTERM, and `activity-scores.json`. A kill mid-write truncates the file.
- **BUG, all three `loadJSON` copies (`store.js:46-48`, `discord-gateway.js:35-37`, `activity-daily-job.js:22-24`).** They return the fallback on *any* error, a parse error included. A truncated or corrupt `members.json`, `bookings.json` or voice history boots as empty, and the next save writes over the only evidence. crc-sync handles the same case by renaming the bad file aside as `<file>.<ts>.bad` and logging (`collab-store.js`, `mission-session.js`, `metrics.js`).

  **Fix for both:** one `sourcedcs-web/json-file.js` with `saveJSON` (store.js's tmp-plus-rename, add an fsync of the tmp file) and `loadJSON` (ENOENT → fallback; parse error → rename aside, `log.error`, fallback). Import it from the three files and from `scripts/backfill-activity-scores.js:65`. **Effort:** S. **Risk:** low.
- **Mutate-then-save without rollback.** About 60 route sites change `store.state` and then save. A failed save (disk full) answers 500 while memory keeps the change, and the change vanishes at restart. Only `routes/bookings.js:187-197` and `gallery.js` roll back. **Fix:** a `commit(mutator)` helper. M, medium risk, per route file. Low priority.
- **Fine:** a single process with synchronous writes, so handlers do not interleave inside a read-modify-write. The awaits in `bookings.js` re-check after the await (`:307`, `:380`). One exception: the legacy range migration checks before its await (`bookings.js:153-165`). It is admin-only and being retired; add the same re-check (S).
- **crc-sync comparison.** There is no shared atomic-write helper there either. Each store inlines tmp plus rename (`collab-store.js:278-285`, `efsp/index.js:612-627`, `metrics.js`, `traffic-count.js`, `mission-session.js`), and none fsyncs. That is for ARCH-S to judge.

### 3.2 Inconsistent error/status mapping between services

- The token statuses are covered in §1.1 (401 vs 503).
- crc-sync maps refusals by `STATUS_BY_REASON` (`airspace-service.js:26-28`): 409/404/400, else 422. The web routes turn any crc-sync failure into 503 `UNREACHABLE` (`routes/airspaces.js:21,29,44`), while a crc-sync 4xx ack is passed through. That is consistent and fine.
- The web's own routes use `{ error }` bodies. crc-sync's EFSP uses `{ ok, reason, detail }`. Two shapes are acceptable at a service boundary. Document the mapping in ADR 0098 §9 rather than change it.

### 3.3 Secrets handling (report only; auth hardening is out of scope)

- No secret values are tracked. `crc-desktop/config.json:3` is a public OAuth client id.
- `sourcedcs-web/server.js:193` and `atobrief/server.js:145` log the first 200 characters of the token response when `access_token` is missing. A partial response may carry a `refresh_token`. Log the keys only (S).
- All secrets are plain compose `environment:` entries, visible through `docker inspect`. Acceptable on one host.
- `infra/casdoor_entrypoint.sh:10` writes the DB password through an unquoted heredoc, so a `$` or backtick in the password is expanded (S).
- **crc-desktop local server.**
  - **What is wrong:** `POST /api/sync-config` (`app/server.js:86-102`) is unauthenticated, and `/srs-api/` answers `Access-Control-Allow-Origin: *` (`:125,135`). Any web page the user visits can send a no-cors text/plain POST to `http://localhost:<port>`. That POST rewrites `crcSyncUrl` and `casdoorEndpoint`, which redirect the next login, and it can drive the SRS radios.
  - **Fix:** a per-process random token in `/js/config.js` and the preload, and an `Origin` check.
  - **Effort:** S–M. Reported for the owner, as with the other auth items.

### 3.4 Deploy-pipeline fragility (`deploy.yml`, `.github/scripts/protocol-gate.sh`)

- **BUG (narrow race), `deploy.yml:44-50,74-82`.**
  - **What is wrong:** the gate reads `WIRE_PROTOCOL` from the *checked-out source* at `head_sha`, but the deploy pulls the mutable `ghcr.io/…/crc-sync:latest`. Example: a revert of a wire change is merged. A sourcedcs-web deploy for a later commit finishes while the revert's crc-sync image is still building. The gate sees the source's old number, passes, and recreates crc-sync from a `latest` that still speaks the new protocol.
  - **Fix:** build the image with a label, `org.sourcedcs.wire-protocol=<n>` (set in `crc-sync-docker.yml` from the file). Have the gate read the label of the exact image it will deploy (`docker buildx imagetools inspect`), and deploy that digest or the `sha-<short>` tag the metadata action already pushes (`crc-sync-docker.yml:87`), not `latest`.
  - **Effort:** M. **Risk:** medium (the SSH script changes).
- **Fail-open versus the ADR (doc drift plus a design question).**
  - **What is wrong:** ADR 0103 line 37 says the gate "fails closed". The script fails *open* when `https://sourcedcs.page/api/releases/latest` cannot be read (`protocol-gate.sh:34-39`). That was the questioner's ruling S-QA-A, and the RUNBOOK (`:41`) matches the script. The endpoint is served by the stack being deployed, so a web container that is down opens the gate.
  - **Fix:** take the published version from the newest `crc-desktop-v*` tag in the checkout, which the gate already fetches with full tags, and use the API only as a cross-check. Then correct ADR 0103 with an erratum.
  - **Effort:** S. **Risk:** low.
- **A half-published release holds crc-sync (`protocol-gate.sh:42-56` with `crc-desktop-release.yml:34,111`).**
  - **What is wrong:** with `fail-fast: false`, the Windows leg can upload while the Linux leg fails. `/api/releases/latest` then lists two versions, and the gate holds on the old one. Windows clients auto-update and are refused, and nothing automatic recovers.
  - **Fix:** gate on the newest published version, and make the release workflow fail loudly, without dispatching crc-sync, when one leg is missing.
  - **Effort:** S.
- **The gate script has no test.** Its header says "file:// works for tests", but no test exists. It parses the two files with two different regexes (`:28` `WIRE_PROTOCOL:` vs `:49` `WIRE_PROTOCOL =`); a reformat of either file silently changes the outcome. **Fix:** a `node --test` table in crc-sync (or `infra/tests`) that runs the script against a temp git repo with tags and a `file://` releases JSON: equal, different, no tag, unreachable, skip. S, no risk.
- **The RUNBOOK bypasses the gate.** MapTiler rotation step 3 (`infra/RUNBOOK.md:17`) and the release checklist (`:57`) say `docker compose pull crc-sync && docker compose up -d`. That pulls whatever `latest` is, including a held image. **Fix:** recreate crc-sync by re-running the Deploy workflow, and say so in both places. S.
- **Smaller items** (S each):
  - The `git pull --ff-only` under `set -e` (`deploy.yml:63-65`) aborts the whole deploy on a dirty server checkout.
  - `appleboy/ssh-action` has a 10-min default `command_timeout`.
  - `TAG` is exported only in the SSH session (`:67`), so a manual `up -d` on a dev host silently switches to `latest`.
  - Nothing triggers a deploy on an infra-only change (compose, nginx). It waits for the next image build or a manual dispatch, while CLAUDE.md implies the `git pull` delivers such changes.
  - dev and main use separate concurrency groups. If both environments are one host they can recreate concurrently, the failure the comment at `:16-21` describes. Confirm the hosts differ.
- **`atobrief-docker.yml` has no test step** (sourcedcs-web's and crc-sync's do). A failing atobrief suite still reaches production. S.
- **Fine:**
  - The pull is scoped to our three images, with the reason recorded.
  - The hold path deploys everything else (`--no-deps`, every service but crc-sync).
  - `verify-main` is on every tag workflow.
  - crc-sync's image needs both unit suites.
  - Blockmaps upload before manifests.
  - The `!cancelled()` release-to-crc-sync dispatch matches CLAUDE.md.

### 3.5 e2e specs depending on order or load

See §5.3. The two concrete classes this session hit:
- **Locator specificity.** `popover.locator('select').first()` (`marsa-popover.spec.js:106`, `l1-popovers.spec.js:236`) picks whichever select renders first. `l3-coordination.spec.js:92,100` uses strict `locator('select')`, which throws the day a second select appears. CR-C's target picker broke these and was fixed in `5dbf4c61`.
- **Fixture or format drift.** See §5.5.

## 4. Naming and stale docs

| Claim | Where | Holds? |
|---|---|---|
| "five CommonJS tests (packaging, lxsrs-setup, patch-notes, proxy routes, sharded runner)" | `CLAUDE.md:61` | **No.** There are seven; `external-link.test.js` and `no-maptiler-key.test.js` are missing from the list. S. |
| deploy.yml runs `git pull`, `docker compose pull main-website atobrief crc-sync`, `up -d` | CLAUDE.md "How the docker-image services deploy" | Mostly. It omits the main-only gate step and the hold branch (`deploy.yml:74-79`), `--remove-orphans` and the `TAG` export. S. |
| Gate "fails closed" | `docs/adr/0103…md:37` | **No.** It fails open on an unreachable API (§3.4). Erratum. |
| nginx scraper rules live in "the `nginx` service `command:`" | `infra/RUNBOOK.md:77` | **No.** The config is the mounted template (`docker-compose.yml:33` says "No `command:`"). S. |
| "crc-sync has no public/ (src/app.js still names one)" | CLAUDE.md, `crc-sync/README.md:5` | True, but it documents dead code; delete the code (§1.6). |
| `trust proxy` 1 in all three apps; nginx sends `X-Forwarded-For`; `client_max_body_size 350M` | CLAUDE.md | Yes (`sourcedcs-web/server.js:18`, `atobrief/server.js:44`, `crc-sync/src/app.js:133`, template `:5,98,117,140`). |
| sourcedcs-web defaults to port 3000 | CLAUDE.md | Yes (`server.js:19`). |
| `pruneReleases` keeps 3 | CLAUDE.md | Yes (`releases.js:67`). |
| USMTF token: "crc-sync never reads it" | CLAUDE.md | Yes, but `atobrief/server.js:52` says otherwise (stale comment). |
| Env table | CLAUDE.md | Missing `SOURCEDCS_CRCSYNC_URL` (§1.4). |

Naming of the same concept across services:
- The service URLs: §1.4.
- `checkReleaseUploadToken` guards three unrelated tokens (§1.1). Rename it `checkServiceToken`.
- crc-sync's `airspace-service.js` vs web's `crcsync-client.js` vs `booking-lookup.js`/`flight-plan-lookup.js`: four names for "the client or server of a server-to-server call". When §1.1's helper lands, call both sides `service-client.js`/`service-auth.js`.

## 5. Tests and tooling

### 5.1 Temp dirs left in `/tmp` (snapshot before and after each suite)

| Suite | New `/tmp` entries per run | Size | Cause |
|---|---|---|---|
| sourcedcs-web | 6 `seed-*` | small | `test/seed.test.js:8` `tmp()`, no cleanup |
| crc-sync `npm test` | **146** (88 prefixes; e.g. 16 `efsp-mutation-log-test-*`, 12 `efsp-facility-load-*`, 10 `crcsync-terrain-*`) | **24 MB** | 70 of 90 test files that call `mkdtempSync` never remove it. `control-release-inv-*` (the I11 walk) is 7.7 MB per run. |
| crc-sync `npm run freeze` | accumulated today: 468 `freeze-hub-*`, 156 `freeze-drv-*` | **212 MB** | `freeze-world.mjs:113`, `freeze-traces.mjs:21` |
| crc-desktop | 7 `lxsrs-setup-test-*`, 5 `patch-notes-test-*` | small | `tests/lxsrs-setup.test.js:21`, `tests/patch-notes.test.js:21` |
| Playwright | one `crc-e2e-lane<N>-*` per config load (42 present) | 1 MB | `playwright.config.js:44` runs `mkdtempSync` at module load, in the runner *and* every worker |

**Fix (S, no risk):**
- In `crc-sync/tests/helpers/isolate-state.mjs`, which every crc-sync test process already preloads, also set `process.env.TMPDIR` to a per-process `mkdtemp` root and remove it on `exit`. `os.tmpdir()` reads `TMPDIR` at call time, so all 90 files are cleaned without touching them.
- Do the same in a `--import` preload for crc-desktop and sourcedcs-web.
- In the Playwright config, `process.env.E2E_STATE_DIR ??= mkdtemp…`, so workers reuse the runner's directory, and remove it in a `globalTeardown`.

### 5.2 Test runtime

| Suite | Wall | Note |
|---|---|---|
| sourcedcs-web | 2 s | 141 tests |
| crc-sync | 23 s | 2,403 tests. **One test is 19 s of it**: `tests/control-release-invariant.test.mjs:555`, "I11 bounded exhaustive walk". The next slowest are 6 s (the traffic-count reconcile) and 5.2 s. |
| crc-desktop | 59 s | 1,106 tests. The top one is `tests/module-graph.test.mjs:169` (8.6 s), then `efsp-ui-reachability` (3.4 s) and `no-maptiler-key` (2.6 s, a scan of tracked files). The rest is spread out. |

All three are acceptable. The one cheap win is the I11 walk, which sets crc-sync's critical path: keep depth 4 in an opt-in `npm run walk` (or the freeze job) and run depth 3 in `npm test`. That would take crc-sync to about 7 s. S, low risk, because the exhaustive depth still runs before merges.

### 5.3 The sharded Playwright runner and its load sensitivity

**Setup:**
- `crc-desktop/e2e/tools/run-sharded.js` splits by `spec-timings.json`. It lists only 29 of 40 specs; the other 11 are balanced by test count.
- Each shard is a Playwright child on its own lane (crc-sync `3010+L`, app `3110+L`) with `workers: 1` and `retries: 0`.
- `--rerun-failed` reruns each failure alone.
- `e2e/helpers/test.js:57-73,95-98` resets crc-sync once per *spec file*: `POST /__test/reset` → exit 75 → `sync-supervisor.js` wipes and respawns.

**Recent record:** 114/140, 119/140, 125/143 and 128/140 in parallel. In every run all, or all but 1–2, of the failures pass alone. **Why it fails under load, most damaging first:**

1. **A real race against a wall-clock guard.** `crc-sync/src/efsp/board/ops/invoke-nla.js:16-18` refuses a second NLA on the same Strip within 400 ms of *server receipt* (`Date.now()`). Eight specs sleep 450 ms *client-side* before the second press: `alert-scramble.spec.js:57`, `l19-surveillance-hints.spec.js:49`, `l17-carrier.spec.js:176`, `l4-chain.spec.js:39`, `l5-arrivals.spec.js:46`, `overflight-lifecycle.spec.js:34`, `ordnance-hung.spec.js:44`, `runway-status.spec.js:176`. Under load the first message is processed late and the second on time, the server sees under 400 ms, and the press is swallowed. **Fix:** an e2e-only knob `CRCSYNC_NLA_GUARD_MS`, read only with `CRCSYNC_TEST_RESET=1` and set to 0 by the harness, with one dedicated spec that keeps 400 ms and asserts the guard. Or have the helper poll until the first NLA's state change is visible before the second press. **Effort:** S. **Risk:** low.
2. **Per-file reset with cross-test state.** Tests in a file share one Board. When a test fails, Playwright restarts the worker, and the marker file (`test.js:42,61`) deliberately skips the reset, so the next tests start on a dirty Board. One failure becomes three or four. **Fix:** reset per test for files whose tests are independent. The reset is about 0.8 s; flag the dependent files instead, as `runway-status.spec.js:28` already declares serial. After a failed test, always reset. **Effort:** S. **Risk:** low.
3. **Settle sleeps instead of conditions.** There are 54 `waitForTimeout`s in 25 files. The helpers do it too (`helpers/app.js:165` 250 ms, `:284` 400 ms in `dropStrips`, a cleanup that already broke `l14-ato-import`). Cross-controller checks wait 300–800 ms on a second page, but track deltas ride the 500 ms hub tick (`crc-sync/src/ws-hub.js:16`). **Fix:** one `settle(page)` helper that waits on a deterministic signal, such as an ack counter the client already keeps for `window.__e2eSent`, or `expect.poll` on the store. Start with the two helper sleeps, which every spec uses, then `l4-drag` (8 sleeps up to 1.5 s), `l4-chain`, `l3-coordination` and `mtr-fields`. **Effort:** M overall, S per file. **Risk:** low.
4. **Assertion timeouts below the default.** `l2-block-editing.spec.js:58,70,104,121,139,154,164,215,241,269,338` use 1–2 s, and `helpers/app.js:156-166`/`:264-268` click with 3 s, which shrinks the retry budget exactly when the box is busy. **Fix:** use the 5 s default. A test whose *point* is "fast" belongs in a separate named check. S.
5. **Ambiguous locators** (§3.5). Give the popover selects stable hooks (a class or `data-testid`). Add a grep rule to the existing `tests/e2e-spec-hygiene.test.mjs` that bans bare `locator('select')` and `locator('select').first()` in specs. S.
6. **Negative waits.** `update-required.spec.js:43,48,66` wait 5 s, 4.5 s and 1.5 s to prove "nothing happened". Use `page.clock` or a server-side counter instead. S.

**Proposal, in order:**
1. Items 1, 2 and 5. All S, and they remove the known causes.
2. Then item 3 in the helpers.
3. Record `spec-timings.json` for the 11 missing specs on a quiet machine.
4. Only then consider `workers: 2`.

Separately: the supervisor's practice of running a full suite at load 30–90 on 22 cores will keep producing noise until items 1–3 land. Until then, `--rerun-failed` is the source of truth and the parallel count is not.

### 5.4 Golden/fixture churn: the granularity is wrong

**Facts:**
- There are 44 goldens in `crc-sync/tests/freeze/golden/` (13.7 MB; `table-mutations.json` alone is 2.45 MB).
- Each golden records every message's `in`, its full `out` and its audit entries (`freeze-lib.mjs:99-117`). Strips and flight data are collapsed to one line with a sha1 of the *whole* normalised record (`freeze-lib.mjs:55-70`).
- Ids come from one process-wide counter (`freeze-determinism.mjs:17-22`) and are canonicalised to `#n` in call order.
- 58 commits touched goldens in 30 days, and about 15 of them rewrote 13–44 files. The reasons recorded in those commits, `git log -- crc-sync/tests/freeze/golden`:
  - `ba8d107f`: "six more randomUUID calls renumber ids; new epoch keys", 38 files, 23,373 lines.
  - `76f15bf7`: "empty clearance.speed cell on every flight data", 37 files.
  - `311ca9af`: "every flight data trace gains the four tofi fields".
  - `f17307ec`, `e913687f`, `7910864b`, `b49a66af`: integration re-records of 35–36 files each.

**Diagnosis.** Two mechanisms turn every additive change into a whole-corpus rewrite:
- Call-order id numbering: one extra `randomUUID` anywhere renumbers every later id.
- Whole-record hashes: one new field changes every line that mentions a Strip.

Since S-M-BACKCOMPAT (2026-10-02) the suite is opt-in, and "behaviour lanes do not maintain the goldens". Integrators still re-record them on every merge, so the cost moved to the integrator instead of going away.

**Fix:**
1. In `canonical()`, number ids by **first appearance within each golden**, not by call order, so an extra call elsewhere renumbers nothing. S.
2. Hash a **projection** per record kind: Strip (`stripId, state, ownerPositionId, bayId, rackId, orderKey, rev`) and flight data (`identity`, filed fields). Put every other field in an unhashed `ext` that a lane promotes on purpose. M.
3. Keep a named list of cross-cutting volatile keys (epochs, `boardSeq`, `undoable`) in the normaliser, so a cross-cutting addition is one line, not 35 files. S.
4. Split `table-mutations.json` and `hub-op-matrix.json` per op, so a change to one op touches one file. M.
5. Decide whether the freeze suite still earns its keep outside refactor windows. The refactor it protected is closed, and the 26 `scenario-*` goldens duplicate `tests/efsp-scenario*.test.mjs`, which assert intent. Recommendation: keep the 13 `hub-*` traces (crash replay, random seeds, resync), and retire the scenario goldens or run them only on branches named `refactor/*`.

Prove 1–3 with `npm run freeze:selfcheck` (M1–M17 must still fire). **Effort:** M. **Risk:** medium (it weakens sensitivity, which the selfcheck measures).

### 5.5 Which gates would have caught this session's integration breaks earlier

| Break | Gate that would have caught it | Effort |
|---|---|---|
| `371bedde`: Playwright's crc-sync wrote the pre-0098 `[]` airspace file and refused to start; every spec died, and no AIRSP lane ran Playwright | **`crc-desktop/tests/e2e-boot.test.mjs`**: build the env exactly as `playwright.config.js` does (export `syncEnv` and the seeding from a small module that both use), write the seed files as `sync-supervisor.js` does (move `wipeState`'s literals into that module too), then call crc-sync's `createApp` (or spawn `server.js` on an ephemeral port) and assert it reaches listening. About 2 s in `npm test`, and any lane that changes a state or config shape trips it. Also replace the hand-written `'{}'` with a copy of `crc-sync/config/efsp-airspaces.json`, so the harness follows the shipped default. | S |
| `5dbf4c61`: a popover gained a second `select` | The hygiene rule in §5.3 item 5, plus stable hooks in the popovers | S |
| `S-WIREfix`: the hub iterated `result.broadcasts` that some handlers did not return, which killed crc-sync at the first metrics report | Already followed up (CMSG's `wire-payload-contract`). The generic gate is the same e2e-boot test extended with one `/feed` round-trip, which would have thrown at once. | S |
| `5b279d4f`: tests read and wrote the checkout's real `crc-sync/state/` | Fixed by `isolate-state.mjs`. Add an assertion in that preload's `exit` hook that `crc-sync/state/` mtimes are unchanged. | S |
| AIRSP-2P-B's "7 sourcedcs-web failures" that were its worktree environment | A `sourcedcs-web` test preload that clears the env keys tests depend on (`AIRSPACE_SERVICE_TOKEN`, `SOURCEDCS_CRCSYNC_URL`, …) so a developer's shell cannot leak in | S |
| A wire change without a release | The deploy gate exists, but is untested and checks the source rather than the image (§3.4) | S + M |
| atobrief regressions | A test step in `atobrief-docker.yml` | S |
| Cross-lane integration in general | A **merge-time Playwright smoke**: `smoke.spec.js` plus one spec per touched area, run on one quiet lane by the integrator before `git merge` lands on dev. The full sharded suite stays the supervisor's job. | S (process) |

## Proposed fix lanes (for the supervisor)

1. **E2E-STAB** (S–M, crc-desktop plus one crc-sync test hook): §5.3 items 1, 2, 4, 5 and 6; the e2e-boot test from §5.5; the Playwright tmp dir.
2. **FREEZE-GRAIN** (M, crc-sync tests only): §5.4 items 1–3, then a decision on item 5.
3. **DEPLOY-GATE-2** (M, `.github` plus the RUNBOOK): image label and digest deploy; gate on the newest tag; the gate test table; a loud release failure on a missing leg; the RUNBOOK commands; the ADR 0103 erratum; an atobrief test step.
4. **WEB-DATA** (S, sourcedcs-web): `json-file.js` (atomic plus corrupt-aside); the three airspace BUGs from §1.2; the parser parity test; the booking migration re-check.
5. **SEAMS** (S, both services): one service-token helper and status policy; the service clients; env naming and docs (§1.4); the dead `PUBLIC_DIR`; the CLAUDE.md and RUNBOOK corrections in §4.
6. **DESK-LINKS** (S, crc-desktop main/preload): the download-link BUG, the Casdoor-endpoint BUG, popup webPreferences, `will-navigate`. The localhost `sync-config` CSRF is listed only for the owner's decision.
7. **TMP-HYGIENE** (S): the `TMPDIR` preloads from §5.1 and the depth split of the I11 walk from §5.2.
