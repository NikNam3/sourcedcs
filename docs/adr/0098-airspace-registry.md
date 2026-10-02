> Amended for H100 (2026-10-01): DA-5 (b) one-time migration of legacy ranges (§9); other DA answers as recommended.

# 0098. The airspace registry: editable definitions per theater, AREA and ROUTE, geometry, one source of truth

Status: **Accepted** (DES-AIRSP, 2026-10-01; built by AIRSP-2S-A). Choices marked **settled H100 (DA-n …)** are the human's answers (decisions.md H100) to the questions in `docs/wip/DES-AIRSP.md` § "Questions for the human".

Vocabulary is the post-RENAME one (H96, H98, `docs/parallel/research/vocabulary.md`): a controller **signs on** to a
Position (was "holds" / "is Primary at"), "flight data" (was FDR), Positions are staffed or unstaffed. EFSP, Strip,
Board, Bay and the `efsp-*` wire names stay. Position ids are written as they are today (CTR, APP, OPS, TAC_C2). The
RENAME mapping table decides their final spelling. **"Occupied airspace"** keeps its meaning of "flights are working
in it". R2 (staffed) renames Position staffing, not airspace occupancy.

## Context

- ADR 0034 put airspace state in a third store (`AirspaceStore`). ADR 0035 derived the RANGES Facility's Positions
  from the definitions. ADR 0036 placed activation authority per airspace (controlling vs using). ADR 0038 kept
  `type` descriptive. In all of them the definitions are "static configuration": `airspace-config.js` reads
  `config/efsp-airspaces.json` once, and it ships `[]`.
- `setAirspaces()` never had a caller and could not have worked. The store seeds records only in its constructor, so
  a new id had a definition and no record. Nothing bumped `airspaceSeq`. The audit entry's `after` omitted the
  definition, and `facilityId` was `null` on create. `_validateAirspaceReferences` (in `index.js`) only warns, once,
  at startup. Source: `docs/wip/AIRSP.md` §1.
- The human's rulings: H79 (AIRSP-1..7, R3-11, R3-12, R3-22..26 and the AIRSP-2 note about sourcedcs-web), S-R3-80
  (MTRs are airspace: one registry with `kind: AREA | ROUTE`), H97 (the TOFI separation regime takes effect only
  inside an airspace ACTIVE for that MRU), H84 R3-72/S3-6 (JSON is the single source of data, and code holds rules
  and interactions), and S-desk3 (no state versioning now, R3-2 clean start).
- The refactor (ADR 0095) provides the seams this ADR builds on: the store registry (`stores.js`), one `SyncLog` per
  syncing store, the wire family registry (`wire/families/*.js`), the authority registry (`authority/`), the client
  message registry (`registerEfspMessage`) and `createApp(deps)`.

## Decision

### 1. One registry, owned by crc-sync **settled H100 (DA-1 a)**

crc-sync's airspace store is the **only writer and the only source of truth** for airspace definitions and their
state. Every edit is a Mutation through `AirspaceStore.apply`, whatever its origin: the crc-desktop panel, the
sourcedcs-web admin page, the shipped standing list, or a later ACO import. All of them get the same validation,
authority check, `defRev` conflict check, audit entry, persistence and live delta.

sourcedcs-web holds **no copy** of the definitions. Its admin page and booking tool read them from crc-sync, and the
admin page writes them through crc-sync, over a server-to-server HTTP API (§9). Why crc-sync rather than the web:
the audit (ADR 0083), the delete guard, the occupied-airspace warning and live push all exist only where the flights
are. If the web were the source of truth, it would need a second audit, polling and a two-writer conflict story.
crc-sync also keeps working when sourcedcs-web is down, the same degrade-gracefully rule as
`flight-plan-lookup.js`.

### 2. Keyed by theater (R3-22)

Definitions are stored per theater: `byTheater: { [theater]: [entry] }`. The key is the name DCS-gRPC's
`GetTheatre` returns, the same key `config/theaters.json` uses. An `airspaceId` is unique within its theater. Two
theaters may reuse an id, and nothing references across theaters.

The **current theater** is the loaded mission's theater (`MissionSession.theatre`, ADR 0086), injected as
`currentTheater: () => string | null`. Everything a controller sees is scoped to it: snapshot, delta,
`getAirspace`/`airspaceFor`, occupancy, containment, and Create from the panel. With no mission loaded, the panel
shows an empty list that says so. The web admin page picks a theater explicitly and may edit any theater.

Operational state (`SCHEDULED/ACTIVE/RELEASED/RETURNED`) is kept per (theater, airspaceId) and is **not** reset by a
session roll. That is unchanged from today, and a reset rule would be its own ADR.

### 3. The definition

```
{ airspaceId,                 // ^[A-Z0-9][A-Z0-9-]{1,23}$, immutable after create (AIRSP Q10)
  name,                       // 1..40 chars, unique case-insensitively within the theater
  kind: 'AREA' | 'ROUTE',     // S-R3-80; default AREA
  type,                       // descriptive only (D14, ADR 0038). AREA: MOA RANGE DANGER RESTRICTED PROHIBITED WARNING;
                              //   ROUTE: IR VR SR LLTR. Never read for behaviour
  controllingFacilityId, controllingPositionId,   // hard-checked against the facility JSON on every write (gap 4)
  usingPositionId?,           // a RANGES Position (range control of its own). Takes effect at restart (R3-24)
  usingFacilityId?,           // NEW: a Facility that is the using agency as a whole (the MRU, e.g. TACTICAL). H97/I1
  workingFrequencyMhz?, controlFrequencyMhz?,     // unchanged rule: 30..400 MHz, at most 3 decimals
  altLowerFt?, altUpperFt?,   // indicated feet (§6). ROUTE: derived envelope, never sent by a client
  geometry,                   // AREA only, see §5; null = no outline (UNKNOWN for containment)
  segments?, defaultWidthNm?, // ROUTE only, see §5
  source }                    // 'PANEL' | 'WEB' | 'STANDING' | 'ACO': who created it (provenance, display only)
```

- **Using agency: at most one** of `usingPositionId` and `usingFacilityId`. Both may be empty. Then the controlling
  Position acts for both sides, as today (`_isUsing`). Setting both is a `VALIDATION_ERROR`. `usingFacilityId` must
  name an existing Facility, and not the controlling Facility or RANGES. Unlike `usingPositionId`, it creates no
  Position, so it takes effect live, within the R3-23 limit below.
- **Which of a using Facility's Positions act for it** (Schedule, RequestActivation, ReleaseAirspace) is a capability
  in the authority registry, not a definition field: the `airspaceUse` capability **settled H100 (DA-7 a): TAC_C2 only**.
- `activation` is **not** a stored field. It is a rule keyed by `kind` (`ACTIVATION_BY_KIND = { AREA: 'APPROVE',
  ROUTE: 'CONFIRM' }`, in code). That is the same treatment ARCH-plan §2.7 gives occupancy. A stored field could
  disagree with `kind`.

### 4. Ops (R3-25: one audited op per airspace, with a revision)

All ops ride the existing airspace wire family (`efsp-airspace-mutation` → `efsp-airspace-ack`, delta
`efsp-airspace-delta`). The family's skeleton gate keeps "the session is signed on to `actingPositionId`" for panel
traffic and gains a **service principal** for the HTTP path (§9). No second family is added (this deviates from
ARCH-plan §2.7's `airspace-definition.js`; one wire type means one replay cache kind, one seq and one handler).

| `op.kind` | Fields | Notes |
|---|---|---|
| `CreateAirspace` | `definition` (`airspaceId` included; theater = current, or `msg.theater` on the service path) | Skips the NOT_FOUND check. An existing id is a `VALIDATION_ERROR`. The record starts RETURNED, `defRev: 1`. |
| `EditAirspace` | `baseDefRev`, `patch` (changed fields only; `null` clears an optional field) | `airspaceId` and `kind` are not patchable. Per-field conflict check (below). |
| `DeleteAirspace` | `baseDefRev` | Hard delete, guarded (AIRSP-5, §8). |
| `ImportAirspaces` | `theater`, `source: 'STANDING' \| 'ACO'`, `definitions[]` | **Additive** (R3-26): an existing id is skipped and reported, never overwritten. Every definition is validated, and one invalid definition refuses the whole import. One Mutation is one audit entry, with `created[]` and `skipped[]`. Service path and seed only in v1. The panel's ACO paste is a later lane. |
| `DelayActivation` | `note` | ROUTE only: the controlling side's answer to a route activation request. "ATC should not deny, only delay" (JO 7610.14 6-6-5, S-R3-80). It stamps `pendingRequest.delay = {note, at, by}` and the request stays pending. |
| existing six | unchanged | For a ROUTE, `ApproveActivation` is labelled **Confirm** and `DenyActivation` is refused (`VALIDATION_ERROR`, "a route cannot be denied, delay it"). |

**`defRev`**: the record carries `defRev` (the definition revision) next to the state `rev`. A definition edit never
makes an in-flight state op `STALE_REV`, and the reverse holds too. R3-25's "a rev" is `defRev` for definition ops.

**Conflicts, per field** (AIRSP.md §7). The record keeps `definitionHistory`, append-only and bounded to the last 50
entries (an engineering constant). Each entry is `{defRev, at, by, positionId, via, changes:[{field, from, to}]}`.
An edit at `baseDefRev` < `defRev` applies if no history entry after `baseDefRev` touched a patched field. Otherwise
the answer is `STALE_REV` with `conflicts: [{field, base, theirs}]`, and nothing is written. If the base is older than
the bounded history, the edit is refused `STALE_REV` with every patched field listed as a conflict. Last writer wins
is rejected on purpose.

**R3-23, edits while not RETURNED**: when the record is SCHEDULED, ACTIVE or RELEASED, or has a `pendingRequest`, a
patch may contain only `name`, `workingFrequencyMhz` and `controlFrequencyMhz`. Any other field is refused
(`VALIDATION_ERROR`). The detail names the state and, for an AREA, the flights working it.

**AIRSP-3**: edits are immediate, stamped with the mission clock (ADR 0079). There are no drafts and no scheduled
edits. The form buffer is the draft.

### 5. Geometry (AIRSP-7, R3-12)

Coordinates are WGS84 decimal degrees `[lat, lon]`.

- **AREA**: `geometry` is one of
  - `{ source: 'POLYGON', points: [[lat, lon], …] }`, drawn on the crc-desktop map or typed as a coordinate table on
    the web. At least 3 points, at most 200 (an engineering constant), not closed (the first point is not repeated),
    no self-intersection;
  - `{ source: 'DCS_DRAWING', drawingRef: { layerName, objectName, missionFingerprint }, points: [[lat, lon], …] }`,
    a mission drawing the controller picked in the panel. **The points are copied at selection settled H100 (DA-2 a)**. The
    reference is provenance, and the panel offers "Refresh from drawing" while that drawing is in the loaded
    mission. A circle or oval is turned into a 64-point polygon by the picker. Containment therefore never depends on
    which mission is loaded, and a standing airspace keeps its outline in a mission that lacks the drawing;
  - `null`: no outline (every record from before this ADR, and any airspace whose shape nobody has entered). Allowed.
    Containment answers *unknown*.
- **ROUTE**: `segments: [{ fix: {name, lat, lon}, altLowerFt, altUpperFt, widthNm? }, …]` and `defaultWidthNm`
  (required, greater than 0). Element *i* is the leg from `segments[i].fix` to `segments[i+1].fix`. The **last element
  is the exit fix only**: its altitudes and width must be null. There must be at least 2 elements. `fix.name` is free
  text, a navpoint name or a designator letter, because there is no fix database (H23). The coordinates are what
  count. The definition's `altLowerFt`/`altUpperFt` are **derived** by the server as the envelope (min of the lows,
  max of the highs) so that "a block must fit" keeps one meaning.

### 6. Altitudes are indicated feet (I4)

`altLowerFt`, `altUpperFt` and the segment bands are on the **same basis as an altitude block on a Strip and as
conformance**: `altimetry.js`'s `indicatedAltFt`, that is feet on QNH below the theater's transition altitude and
pressure altitude (a flight level × 100) at and above it. A limit shown as FL230 is stored as 23000. `null` lower
means the surface, and `null` upper means unbounded. Bounds are inclusive.

### 7. Queries other code may call (the H97 interface, agreed with DES-RELEASE for ADR 0102)

These are pure and synchronous, do no I/O, and read the current theater only. They are exposed on the store and
handed to collaborators through `ctx`/deps, never `require`d across modules.

```
isActiveFor(airspaceId, usingFacilityId) → boolean
  // record.state === 'ACTIVE' && (def.usingFacilityId === F || def.usingPositionId is a Position of F)

activeContaining({ lat, lon, altFt }, { usingFacilityId }) →
  { inside:  [{ airspaceId, kind, name }],     // ACTIVE for F, and the point is inside
    unknown: [{ airspaceId, kind, name }] }    // ACTIVE for F, containment cannot be evaluated (geometry null)
  // AREA: point in polygon (local equirectangular projection about the polygon's centroid; boundary counts as
  //       inside) AND altLowerFt <= altFt <= altUpperFt (null = unbounded)
  // ROUTE: distance from the point to some leg's centreline <= (leg.widthNm ?? defaultWidthNm) / 2
  //       AND that leg's band contains altFt
  // altFt is indicated feet (§6); the caller converts with indicatedAltFt, as conformance does

containing({ lat, lon, altFt }) → [{ airspaceId, kind, name, state }]   // any state; map/QA use, same geometry rules
```

The caller (the TOFI monitor, ADR 0102) chooses the point and polls it every tick. No change listener is needed.
Which position the TOFI monitor passes (the correlated track's) is ADR 0102's decision.

### 8. Effects on references, occupancy, delete

- `airspaceId` never changes, so no reference is rewritten. Strips keep their `airspaceEntry` copies (frequency,
  block). An edit is not pushed into them.
- **AREA occupancy** is unchanged: `occupancyFor` counts non-DROPPED Strips whose `airspaceEntry` names the id.
  Editing an occupied AREA **warns and lists the flights** (AIRSP-4): the ack carries `warning:
  'AIRSPACE_EDITED_OCCUPIED'`, `occupied`, and `staleEntries` (Strips whose entry frequency differs from the new
  one).
- **ROUTE occupancy** is a count, shown and never warned on (S-R3-80). It counts non-DROPPED Strips whose flight data's
  `military.mtr.designator` resolves to the route: the same normalisation, matched against `airspaceId`, read-only.
  An unknown designator stays free text (ADR 0062, H23). A route flight never gets an `airspaceEntry`.
- **Delete** (AIRSP-5): hard delete. It is refused (`VALIDATION_ERROR`, with the blockers listed) unless the record is
  RETURNED, has no `pendingRequest`, and (AREA) `occupancyFor` is 0. On success the record goes, and the delta carries
  `airspaces.removed: [airspaceId]`. The audit entry's `before` keeps the full definition. The id may be reused.
  Archived Strips show the bare id.
- **RANGES Positions** stay derived at load from the restored definitions of **every** theater (R3-24: a change takes
  effect at restart, and the panel marks it "after restart"). `_validateAirspaceReferences` becomes a callable hard
  check used by every write, and a loud startup error for the seed (ARCH-D5).

### 9. sourcedcs-web: admin page and booking tool (AIRSP-2 note)

- **crc-sync → web, and web → crc-sync, inside the stack.** crc-sync gains a small HTTP router
  (`/api/airspace-registry/*`) for one caller, sourcedcs-web. It is gated by a shared bearer token
  `AIRSPACE_SERVICE_TOKEN` (same pattern as `FLIGHT_PLAN_SERVICE_TOKEN`, with a separate secret). The web reaches it at
  `SOURCEDCS_CRCSYNC_URL` (`http://crc-sync:3000` in compose).
  - `GET /api/airspace-registry/theaters` → `[{ theater, count }]`
  - `GET /api/airspace-registry?theater=T` → `{ theater, airspaces: [{ definition, defRev, state, window,
    pendingRequest }] }`
  - `POST /api/airspace-registry/mutation` with `{ theater, clientMutationId, airspaceId, op, actor: { sub, name } }`
    → the same ack body as `efsp-airspace-ack`.
- **The service principal**: the web has already checked the user's role **settled H100 (DA-3 a): the booking admins,
  `admin` and `squadronlead`]**. In crc-sync the principal has the `SQUADRON_ADMIN` authority row: create, edit and
  delete any airspace in any theater. It is still subject to R3-23, the delete guard, `defRev` and validation. Its
  audit entries carry `actingPositionId: null`, `actorId: actor.sub` and `via: 'WEB'`. A web edit runs through the same
  family skeleton as a panel edit, so persistence, the replay cache and the broadcast to every connected session
  happen once, in one place.
- **The booking tool** books **registry airspaces** instead of its own `ranges` list. A booking stores
  `airspaceRef: { theater, airspaceId }`, and the altitude bounds come from the registry. **Legacy `ranges` are migrated
  once (settled H100 (DA-5 b))**: an admin maps each legacy range to a registry airspace on the airspace admin page, and
  that range's bookings move to the airspace (`resourceType: 'airspace'`, `airspaceRef`, `migratedFromRangeId` kept on the
  booking). The migration is all-or-nothing per range, refuses a mapping whose airspace limits do not contain a booking's
  altitude or whose merged bookings would break the 999 ft deconfliction rule (the admin sees the list and resolves it),
  and is idempotent. After the migration no legacy range remains, creating a booking on a legacy range is refused, and the
  one-time tool is removed in a follow-up chore once production has been migrated. Controller-position bookings are
  unchanged. No data is lost and nothing stays read-only.
- **Calendar bookings in crc-desktop** **settled H100 (DA-6 a): information only**: crc-sync pulls upcoming airspace
  bookings from the web (`GET /api/bookings/service/upcoming`, the same token, never-throws like
  `listFiledFlightPlans`). It caches them on a ticker and sends `efsp-airspace-calendar` to every session. The panel
  shows the next booking on the card in grey, with real UTC and a link to the booking page. A booking never changes
  the airspace state: a booking is real-world time, while the airspace window is mission time (ADR 0079).

### 10. Persistence, seed and import

- The airspace store's `stores.js` entry snapshots `{ byTheater: { [theater]: [{ definition, defRev,
  definitionHistory, ...record }] }, seeded: { [theater]: [airspaceId] } }`. It goes inside the one atomic Board
  snapshot write, so a definition and its record cannot disagree after a crash (AIRSP.md gap 2). The ADR 0083 log-tail
  reconcile covers an audited edit that was never persisted. `state/efsp-airspaces.json` is no longer written. The old
  array shape is not read (R3-2, clean start; the release note says to wipe `state/efsp-*`).
- **The standing list** (R3-26) is `config/efsp-airspaces.json`, now an object keyed by theater (`{}` shipped until
  the human supplies it). On each start it is applied as `ImportAirspaces { source: 'STANDING' }` **for ids not yet in
  `seeded[theater]`**. An id is seeded once. A later delete is not resurrected, and a later addition to the shipped
  file does land. A `state/` copy of the file overrides the shipped one, whole (ADR 0048, DATA-1's no-merge rule).
- A later **ACO import** uses the same op with `source: 'ACO'`, and is additive.

### 11. Authority (S3-2: rows in the authority registry)

| Who | Create | Edit | Delete | Use (schedule, request, release) |
|---|---|---|---|---|
| The controlling Position (AIRSP-2) | yes, as itself | every field of its airspaces (R3-23 applies) | its airspaces | approve/confirm/deny/return, as today |
| OPS of the controlling Facility (R3-11) | yes, for a Position of its Facility | every field of its Facility's airspaces | its Facility's | none |
| A RANGES Position named `usingPositionId` | no | `controlFrequencyMhz` of its airspaces | no | as today |
| A Position with `airspaceUse` at the `usingFacilityId` Facility (DA-7: TAC_C2) | no | no (AIRSP-6) | no | schedule, request, release |
| `SQUADRON_ADMIN` (web service principal) | any theater | any | any | none |
| Everyone else, and a session signed on to nothing | no | no | no | no; reads everything (airspaces are not flights) |

A patch with one denied field is refused whole. Client mirror: a hand copy plus a parity test (ARCH-D7).

### 12. Audit (ADR 0083)

Every outcome of every op is one Mutation-log entry. On success, `before`/`after` **include the definition**. An edit
carries `changes[]` and an import carries `created[]`/`skipped[]`. `facilityId` comes from the op's definition (create)
or from `before` (delete), never `null` for a known airspace. `via` is `'PANEL' | 'WEB' | 'SEED'`. The new op kinds
are classified in `metrics.js` and none counts as traffic.

## Consequences

- The panel and the web edit one list. Neither can drift from the other, and every change has an audited author.
- ADR 0035's and 0036's "static configuration" framing is superseded by this ADR (P4: the earlier ADRs are not
  edited). ADR 0062's MTR fields stay free text, and a designator becomes an optional read-only lookup.
- The web admin and booking tool need crc-sync running. In the production stack it always runs. Local web
  development shows "crc-sync unreachable".
- One shared secret more (`AIRSPACE_SERVICE_TOKEN`), and two env keys (`SOURCEDCS_CRCSYNC_URL`,
  `CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL` for the booking link). Hardening is out of scope, as for every service token
  here.
- The TOFI regime (ADR 0102) can be gated on real geometry. Where an airspace has no outline, the result is
  *unknown*, never a guess, and the manual "entered" mark covers it.
- Not done here: a session-roll reset of airspace state, scheduled edits, a soft delete, an ACO import UI, an "active
  route crosses active area" conflict, and per-segment lost-communications altitudes (ADR 0062 future).
