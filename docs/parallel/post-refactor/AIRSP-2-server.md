# AIRSP-2 server: the airspace registry in crc-sync (lanes 2S-A and 2S-B)

> Read `docs/parallel/refactor/README.md` (the conventions) and `docs/wip/DES-AIRSP-adr-0098.md` (the ADR, which
> wins over this briefing). Rulings: H79 (AIRSP-1..7, R3-11, R3-12, R3-22..26), S-R3-80, H97, H84 R3-72/S3-6,
> S-desk3, H96/H98 (write with the post-RENAME names). Design history: `docs/wip/AIRSP.md`,
> `docs/wip/DES-AIRSP.md`. **Starts after the refactor window closes and L20 merges** (H78, ARCH-D3). Open questions
> DA-1..DA-9 are in `docs/wip/DES-AIRSP.md`. Take the marked defaults unless the supervisor relays an answer.

Two lanes run in parallel and own disjoint files. 2S-A owns the store, its rules and its persistence. 2S-B owns the
edges: the HTTP service API, the calendar pull, and the drawing export. 2S-B codes against the ADR's interface and
merges **after** 2S-A.

The cited symbols are from `165a517`, before the refactor. Step 0 re-finds each one by symbol on your base. The
refactor moved them into `stores.js`, `wire/families/airspace.js`, `authority/positions/*.js`, `facility-schema.js`
and `createApp`.

---

## Lane 2S-A: store, rules, authority, persistence, queries

| | |
|---|---|
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-AIRSP2SA` on `lane/AIRSP-2S-A-registry` |
| ADR | **0098**: copy `docs/wip/DES-AIRSP-adr-0098.md` to `docs/adr/0098-airspace-registry.md` in your first commit, after applying any relayed DA answers |
| Size / model | 1.5 lanes / Sonnet 5.5 |

### Goal

The airspace store becomes the registry described in ADR 0098 §2–§8, §10–§12: definitions per theater live inside
the store with `defRev` and `definitionHistory`, and the new ops are Create, Edit, Delete, Import and DelayActivation,
plus Confirm semantics for ROUTE. It also gains `usingFacilityId`, geometry validation, the pure containment queries,
the seed from the standing list, authority rows in the registry, and complete audit entries.

### Owns

- `crc-sync/src/efsp/airspace-store.js`: the registry. It is the only writer of definitions.
- `crc-sync/src/efsp/airspace-config.js`: becomes the **schema and seed loader only**. `validateAirspaceDefinition(def,
  ctx)` is pure. `loadStandingList({paths})` reads the theater-keyed file. `setAirspaces` and the require-time load are
  deleted. Rename the file to `airspace-schema.js` if ARCH-plan §2.7's name is wanted. That is your call; list it in
  the report.
- New `crc-sync/src/efsp/airspace/containment.js`: pure geometry. It contains point-in-polygon on a local
  equirectangular projection, point-to-leg distance in NM, and band checks. Engineering constants are named: the
  polygon vertex cap of 200, the history cap of 50, and the 64-point circle polygon if the server ever converts one.
- The airspace store's entry in `crc-sync/src/efsp/stores.js` (snapshot and restore of the new shape, and the
  `seeded` map) and its wiring in `createEfsp`: `currentTheater`, `occupancyFor`, a new `routeOccupancyFor`, the
  facility lookups for the hard reference check, and the standing-list seed as an `ImportAirspaces` with `via: 'SEED'`.
- `_validateAirspaceReferences`: it becomes a callable hard check (used by every write) and a loud startup error for
  the seed (ARCH-D5).
- The airspace rows in `crc-sync/src/efsp/authority/positions/*.js`: `airspaceCreate`, `airspaceEdit`,
  `airspaceDelete` and `airspaceUse`, plus a `SQUADRON_ADMIN` service row (ADR §11). The store's
  `_isControlling`/`_isUsing` read the registry. AUTH listed these store-local checks as a follow-up, and this lane
  closes it.
- `crc-sync/src/efsp/wire/families/airspace.js`: new op kinds through the existing family. Create skips NOT_FOUND.
  The ack gains `conflicts`, `warning`/`occupied`/`staleEntries`, and `created`/`skipped`. The delta gains
  `airspaces.removed`. The family exposes `applyAsService(principal, msg)` for 2S-B: the same skeleton with the
  service gate, so persistence, replay and broadcast are shared. Add it in the family or skeleton file, whichever your
  base makes the single place.
- `crc-sync/src/efsp/metrics.js`: classify the new op kinds (none count as traffic).
- `crc-sync/config/efsp-airspaces.json`: change `[]` to `{}` (theater-keyed, empty until the human supplies it).
- Tests: `crc-sync/tests/airspace-*.test.mjs` (new and existing), plus the airspace cases of the scenario/manning tests.
- `docs/adr/0098-airspace-registry.md`, `docs/wip/AIRSP-2S-A.md`.

### Frozen for you

The client (lanes 2P-A, 2P-B), `sourcedcs-web/**` (2W), the 2S-B files (`src/airspace-service.js`,
`src/efsp/booking-lookup.js`, `src/grpc-client.js`, `src/app.js` route mounting), `board/**` except the one read you
need (below), and the TOFI collaborator (`board/tofi.js`, which belongs to the release+TOFI lane that consumes your
queries).

### Design notes

- **Record shape** (one per theater and id): `{ airspaceId, theater, definition, defRev, definitionHistory[], rev,
  state, window, pendingRequest, lastDenial, transitions[], updatedAt, updatedBy }`. `getAirspace(id)` and `getAll()`
  read the current theater only and return `{...record, definition}`, the shape the client already renders.
  `airspaceFor` on the Board rules is unchanged in signature.
- **Theater**: `currentTheater()` is injected from `MissionSession`. When it is null, `getAll()` is `[]`, panel ops
  answer `NOT_FOUND` with the detail "no mission loaded", and service ops name their theater explicitly.
- **Validation order** inside `apply`: authority first, then the R3-23 field gate, then the schema, then the
  cross-references (Facility and Positions, `usingFacilityId` exists and is neither the controlling Facility nor
  RANGES, at most one using agency), and finally the `defRev` conflict check. Every refusal is audited (ADR 0083).
  A patch with one denied field is refused whole.
- **ROUTE**: derive `altLowerFt`/`altUpperFt` from the segments on every write, and refuse them in a client patch.
  `ApproveActivation` on a ROUTE is Confirm, and is allowed with or without a request. `DenyActivation` on a ROUTE is
  refused. `DelayActivation` on an AREA is refused.
- **`activeFor` predicate** (ADR §7, agreed with DES-RELEASE): `isActiveFor(id, F)` is true when the record is ACTIVE
  and either `def.usingFacilityId === F` or `def.usingPositionId` is in F's Position set.
- **Route occupancy**: count the non-DROPPED Strips whose flight data's `military.mtr.designator`, normalised the way
  the flight-data store normalises MTR values, equals the `airspaceId`. Read it through an injected
  `routeOccupancyFor`. Do not reach into Boards from the store.
- **Occupied-edit warning** (AIRSP-4): AREA only. It carries `occupied` and `staleEntries`, which are the Strips whose
  `airspaceEntry.frequencyMhz` differs from the new working or control frequency.
- **RANGES Positions** stay derived at load from every theater's restored definitions. When an edit changes
  `usingPositionId`, the definition and the history record it, and the ack carries `effectiveAtRestart: true`.
- **Seed**: for each theater in the standing list, import the ids that are not in `seeded[theater]` and add them to
  `seeded`. A failed validation is a startup error that names the theater and the id.

### Steps (a failing test first for each, per S-TEST)

0. Step 0 per the README: suite counts, "Code as found" by symbol, and a note to the supervisor.
1. Copy the ADR. Schema and validator table: every rule in ADR §3/§5, including that `type` is never read for
   behaviour, the both-using-agencies refusal, and route segment shape and envelope derivation.
2. The record moves into the store per theater, with snapshot/restore through `stores.js` and the `seeded` map.
   Create→restart and delete→restart round trips. No old-shape read.
3. Create/Edit/Delete with `defRev`, history, and per-field conflicts (disjoint fields merge, overlapping fields are
   refused, a base older than the history is refused). A state op and a definition edit never make each other
   `STALE_REV`.
4. The R3-23 gate, the delete guard, and the occupied warning with `staleEntries`.
5. Authority rows: the controlling Position, OPS of the controlling Facility, the RANGES frequency, `airspaceUse`
   (default TAC_C2), `SQUADRON_ADMIN`, TAC_C2 not editing (AIRSP-6), and a session signed on to nothing reading
   everything.
6. ROUTE: Confirm, the Deny refusal, `DelayActivation`, and route occupancy as a count with no warning.
7. Containment: polygon (including boundary and altitude-band edges), route legs (width from the leg or the default,
   per-leg band), `unknown` for null geometry, current theater only. Include a case at a transition-altitude boundary
   to show that the basis is indicated feet.
8. `ImportAirspaces` (additive, skip reported, one invalid refuses all, one audit entry) and the seed once per id.
9. Audit: `before`/`after` include the definition, `facilityId` is never null on create, `via`, and a cached replay
   writes nothing. Metrics classification.

### Walks (memory: walk the requests, not just the lifecycle)

- Edit the frequency of an ACTIVE MOA with two flights, then re-approve one.
- Try to change the limits of an ACTIVE MOA: refused by R3-23, with the flights named.
- Delete with a pending activation request.
- Two controllers race the same field, and then different fields.
- Reassign the controlling Position on a RETURNED airspace while the old owner has the form open.
- The server restarts in the middle of an edit, then the log-tail reconcile runs.
- Reconnect with an open form buffer: refused `NOT_HOLDING_POSITION`, not replayed.
- A RANGES Position edits its control frequency.
- `type` is changed to RESTRICTED on a RETURNED airspace: nothing in the behaviour changes (D14).
- A route is requested by TAC_C2, delayed by CTR, then confirmed. A Strip whose MTR designator matches shows in
  the count.
- A theater change between missions: the other theater's list disappears from `getAll()`, and its records keep their
  state.
- The standing list gains an id and the server restarts: the id lands. A seeded id is deleted and the server
  restarts: it does not come back.

### Acceptance

Both suites are green. `soak:selfcheck` fires every detector: the airspace seq is on a `SyncLog`, so a soak detector
must still see it. The ADR is copied. `docs/wip/AIRSP-2S-A.md` has "what the briefing (3A) and usage guide (8A) should
now say", for the docs owner. The report lists any golden or structure fixture this lane changes, and why: behaviour
lanes do not maintain the goldens after the window (S-desk3).

---

## Lane 2S-B: service API, calendar pull, drawing names

| | |
|---|---|
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-AIRSP2SB` on `lane/AIRSP-2S-B-service` |
| ADR | 0098 (2S-A commits it; you cite it) |
| Size / model | 0.75 lane / Sonnet 5.5 |

### Goal

sourcedcs-web can read and write the registry server to server (ADR §9). crc-sync pulls upcoming airspace bookings
and pushes them to sessions as information. Mission drawings carry their names, so the panel can pick one.

### Owns

- New `crc-sync/src/airspace-service.js`: an Express router for `GET /api/airspace-registry/theaters`,
  `GET /api/airspace-registry?theater=`, and `POST /api/airspace-registry/mutation`. It sits behind a bearer
  `AIRSPACE_SERVICE_TOKEN` compared in constant time. With no token configured, every route answers 503 "not
  configured" and nothing is open. Body limits and validation follow the existing routes. The actor is taken from
  `body.actor {sub, name}` (both required strings, length-capped). POST calls 2S-A's `applyAsService` and returns
  the ack body.
- One mounting line in `crc-sync/src/app.js` (`createApp`), and one ticker entry `airspace-calendar` with a 60 s
  period (an engineering constant) in the same file.
- New `crc-sync/src/efsp/booking-lookup.js`: `listUpcomingAirspaceBookings({fetchImpl, baseUrl, timeoutMs,
  serviceToken})`. It never throws, and has the same contract as `listFiledFlightPlans`. It calls `GET
  {CRCSYNC_SOURCEDCS_WEB_URL}/api/bookings/service/upcoming`, with the token in the header.
- The calendar message: `efsp-airspace-calendar { theater, byAirspace: { [airspaceId]: [{ startUtc, endUtc, by,
  altitudeFt }] (next 3) }, bookingUrl }`. It is sent on change and on connect, through a small calendar family or
  a hub broadcast, whichever your base makes one line. `bookingUrl` comes from
  `CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL` and is omitted when that is unset.
- `crc-sync/src/grpc-client.js` `_getDrawings`: add `name = obj.name` and `layerName = layer.name` to each exported
  drawing (finding F1). **Do not change `missionFingerprint` in this lane.** Report that the fingerprint input
  changes (names no longer empty), which changes session ids for the same mission once, and let the supervisor
  decide whether that needs its own approved commit.
- `crc-sync/.env.example`: `AIRSPACE_SERVICE_TOKEN`, `CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL`. Tests:
  `crc-sync/tests/airspace-service.test.mjs` and `booking-lookup.test.mjs`. Notes: `docs/wip/AIRSP-2S-B.md`.

### Frozen for you

Everything 2S-A owns, the client, and `sourcedcs-web/**`. `infra/**` and the root `.env.example` belong to 2W
(one owner for compose).

### Steps

0. Step 0, then write `applyAsService` and the store queries as a stub matching the ADR, so you can test before 2S-A
   merges. Never rebase. The supervisor merges 2S-A first, then cuts your follow-up commit (stub removed, tests
   pointed at the real store) on the merged tree.
1. Router auth: missing, wrong and unconfigured tokens. Actor validation.
2. GET theaters and GET list: the current shape, any theater.
3. POST mutation: success, refusal, a conflict passed through, an idempotent replay, and a connected session
   receiving the delta (an integration test through `createApp` with fake gRPC and SRS).
4. Calendar pull: web down, web slow, malformed data, the cache, and the broadcast on change only.
5. Drawing export names, tested with a fixture through the Lua string or the parsing side, whichever your base
   allows.

### Acceptance

Both suites are green. No route opens without the token. A web edit reaches a connected panel as an
`efsp-airspace-delta` in the integration test.
