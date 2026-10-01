# AIRSP: an airspaces panel where controllers edit airspace definitions (concern S-3), phase 1 design

Branch `lane/AIRSP-panel-mockup`, cut from `integ/wave3-dry`. Phase 1 only: this file and
`docs/wip/AIRSP-mockup.html`. No production code. Phase 2 (the build) starts after the human approves the
mockup (H49 precedent). The human's words: "we need an airspaces panel i guess such that airspaces can be
edited by the controllers as they change".

Everything below was read from the code on this branch, not from memory. File and line facts are marked
(code). Proposals are marked **Proposal**. Open questions are in section 13 with a recommendation each; if
they stay unanswered phase 2 takes the recommendation (P2) and logs it under "Defaults taken".

## 1. What exists today (code)

| Piece | Where | State |
|---|---|---|
| Definitions | `crc-sync/src/efsp/airspace-config.js`, `crc-sync/config/efsp-airspaces.json` (ships `[]`) | Read once at `require` time. `setAirspaces(next)` replaces the whole list and writes `state/efsp-airspaces.json`, but **has no caller** (its own comment: "No editing UI calls this yet"). |
| Mutable state | `airspace-store.js` (`AirspaceStore`) | One record per definition: `rev`, `state` (SCHEDULED / ACTIVE / RELEASED / RETURNED), `window`, `pendingRequest`, `lastDenial`, append-only `transitions`. Seeded from config **in the constructor only**. Persisted inside `state/efsp-board.json` under `airspaces`; `restore()` skips ids no longer in config. |
| Ops | `AirspaceStore.apply` | `ScheduleAirspace`, `RequestActivation`, `ApproveActivation`, `DenyActivation`, `ReleaseAirspace`, `ReturnAirspace`. Authority is per airspace: `_isControlling` / `_isUsing` (ADR 0036). Optimistic concurrency on the record `rev` (`STALE_REV`). Audited in `_recordAudit` (ADR 0040, 0083). |
| Wire | `efsp-ws.js` `_handleAirspaceMutation` | `efsp-airspace-mutation` in, `efsp-airspace-ack` back, `efsp-airspace-delta {airspaceSeq, airspaces:{updated:[...]}}` broadcast to **everyone**. Session must be Primary at `actingPositionId` somewhere (ADR 0029). Idempotent by `clientMutationId` (`_cachedOutcome`, ADR 0081). Snapshot key `airspaces` sent whole, no `efsp-resync` branch. |
| Client | `crc-desktop/app/public/js/panels/efsp/airspace-panel.js` | The AIRSPACE dock panel: a card per airspace, actions from `airspaceActionsFor`. It mirrors the server authority split proactively. No editing. |
| References | `board-store.js` `_applyApproveAirspaceEntry` | A Strip carries `airspaceEntry {airspaceId, frequencyMhz, altitudeBlock, approvedAt, approvedBy}`; the FDR carries `comms.workingFrequencyMhz`. **Both are copies taken at approval.** `occupancyFor` counts non-DROPPED Strips naming the id. Unknown id is a `VALIDATION_ERROR` at approval. |
| Positions | `facility-config.js` | The `RANGES` Facility's Position set is **derived at load time** from every distinct `usingPositionId` (`getRangePositionIds`), class `USING_AGENCY`, which `permission.js` refuses every Strip op by class. |

### The definition (code)

| Field | Required | Validation today | Notes |
|---|---|---|---|
| `airspaceId` | yes | non-empty string, unique | No format rule. It is the key everywhere (record, Strips, log). |
| `name` | yes | non-empty string | No length or uniqueness rule. |
| `type` | yes | one of MOA, RANGE, DANGER, RESTRICTED, PROHIBITED, WARNING | **Purely descriptive**, never drives behaviour (D14, ADR 0038). `[SOURCE-DEFINED]`. |
| `controllingFacilityId` | yes | non-empty string | Cross-checked against real Facilities only at startup, and only as a warning (`_validateAirspaceReferences`). |
| `controllingPositionId` | yes | non-empty string | Same. The Position that approves activation and takes the block back. |
| `usingPositionId` | no | string or null | Present only for a range with control of its own. Creates a `RANGES` Position. |
| `workingFrequencyMhz` | no | finite number 30 to 400 | MHz as a number, everywhere in EFSP. |
| `controlFrequencyMhz` | no | same | The range tower's own frequency. Wins over working frequency at entry approval. |
| `altLowerFt`, `altUpperFt` | no | whole feet 0 to 100000; upper above lower when both set | Neither set = unbounded. A flight's altitude block must fit inside them when set. |

**There is no geometry.** No polygon, centre or radius. The map and atobrief carry airspace drawings
separately; the EFSP definition is a label, an owner, two frequencies and a vertical range. This design
keeps it that way (question Q9).

### Gaps found while reading (these shape the design)

1. **`setAirspaces` cannot work as it stands.** It swaps the config array, but `AirspaceStore` only seeds
   records in its constructor, so a new id has a definition and no record (`apply` answers `NOT_FOUND`), and
   nothing bumps `airspaceSeq` or broadcasts. Phase 2 must not build on it; the store owns edits.
2. **Two files, no shared atomicity.** Definitions (`efsp-airspaces.json`, plain `writeFileSync`) and state
   (`efsp-board.json`, atomic temp+rename after every Mutation, ADR 0081's log-tail reconcile) can drift
   across a crash. A definition delete and the record drop must not.
3. **The audit entry's `after` is the record, not the definition** (`_recordAudit`). A definition edit would
   log "ok" with no visible change. `facilityId` is looked up in config, so a create (id not yet known)
   would log `facilityId: null`.
4. **`_validateAirspaceReferences` only warns, once, at startup.** A live edit needs it as a hard check.
5. **`RANGES` Positions are derived at load.** Editing `usingPositionId` live would need a dynamic Position
   set, which `facility-config.js`, `permission.js` and the Position store do not support.
6. **Strips and the FDR hold copies** of frequency and altitude block, so an edit cannot reach them by
   itself (section 8).

## 2. Scope

In: create, edit and delete airspace definitions from the AIRSPACE panel, per Position authority, audited,
persisted, pushed live, conflict-safe. Out: authentication (assumed as today, ADR 0029), geometry, scheduled
or draft edits on the server (Q4), changing an existing airspace's `usingPositionId` (Q3), bulk import.

## 3. Who may edit what (Proposal)

Same capability-table pattern L23 (`TACTICAL_CAPABILITIES`), L17 and L18 use: one table in `permission.js`,
one row per Position, small accessors, and the client receives the table on the snapshot (config, like
`positionLetters`) to mirror it proactively. The server decides.

```js
// permission.js (phase 2)
const AIRSPACE_CAPABILITIES = {
  CTR:  { create: true,  controlled: 'ALL',   using: [],                      delete: 'CONTROLLED' },
  APP:  { create: true,  controlled: 'ALL',   using: [],                      delete: 'CONTROLLED' },
  // A range Position (class USING_AGENCY, derived) is not listed; it gets the class row below.
};
const USING_AGENCY_ROW = { create: false, controlled: [], using: ['controlFrequencyMhz'], delete: null };
// every other Position: no row = no edit. Read: everybody (airspaces are not flights, read-scope.js).
```

| Position | Create | Edit | Delete |
|---|---|---|---|
| CTR | yes | every field of an airspace it controls | one it controls |
| APP | yes | every field of an airspace it controls | one it controls |
| A range Position (`USING_AGENCY`) | no | `controlFrequencyMhz` of airspaces it uses | no |
| OPS, CD, GND, TWR, CARRIER Positions | no | none | no |
| TAC_C2, GCI, AIC, JTAC | no | none (Q1) | no |
| Session holding no Position (H58) | no | none (reads everything) | no |

- "Controls" means `definition.controllingPositionId === actingPositionId`, the same test `_isControlling`
  already makes. Reassigning an airspace to another controlling Position is an edit by its current
  controlling Position (a handover); the new Position must exist in the named Facility.
- Create names its controlling Position, and the actor must hold that Position (you cannot create an
  airspace owned by somebody else). So a create is always "I now own this".
- Accessors: `canCreateAirspace(actingPositionId, def)`, `canEditAirspaceFields(actingPositionId, definition,
  fields) -> {ok, deniedFields}`, `canDeleteAirspace(actingPositionId, definition)`. A refusal names why
  (`PERMISSION_DENIED`, detail "only CTR may edit MOA TOROS", like L23's refusals).
- The server checks per **field**, so a patch containing one denied field is refused whole (no partial edit).
- Unmanned owner: nobody else edits; the controller takes the Position (Q2).

## 4. Per-Facility ownership

An airspace already names one `controllingFacilityId` and has one home in the shared store (ADR 0034). Phase 2
keeps that. The panel groups by Facility (CENTER, INCIRLIK, ...) and defaults to "Mine" (airspaces whose
controlling Position the session holds) with an "All" toggle. Editing never moves a record between stores
(there is one). Changing the controlling Facility is part of the same handover edit, validated as a pair.

## 5. Edit lifecycle (Proposal)

**There is no draft and no scheduled effective time on the server in v1 (Q4).** A definition edit takes
effect when it is acked, and is stamped with the mission clock (`at`, ADR 0079, never `Date.now()`).

- **Draft** is the form's own buffer in the client: a controller can open the editor, type, and nothing is
  sent until Save. Validation runs client-side as they type (same rules, a shared pure function, so the two
  cannot drift) and again on the server, which is the authority.
- **Operational state stays separate from the definition.** SCHEDULED / ACTIVE / RELEASED / RETURNED
  (`record.state`, `rev`) is untouched by a definition edit. Editing an ACTIVE airspace is allowed (a
  frequency changes while it is hot, which is when it matters).
- **A new `defRev`** on the record counts definition edits, independent of `rev`. A frequency typo fix must
  not make a controller's in-flight `ApproveActivation` answer `STALE_REV`.
- **Create** makes the record at state RETURNED (available), `defRev 1`. **Delete** is section 8.

## 6. Wire and persistence (Proposal)

### Ops

All three ride the existing `efsp-airspace-mutation`, so the session binding, idempotency and ack shape are
reused and no fifth dispatch path appears.

| `op.kind` | Fields | Notes |
|---|---|---|
| `CreateAirspace` | `definition` (all fields, id included) | `msg.airspaceId` = the new id. The "unknown airspace" `NOT_FOUND` check is skipped for this kind only; an existing id is `VALIDATION_ERROR` (duplicate). |
| `EditAirspace` | `baseDefRev`, `patch` (only the fields changed) | `airspaceId` and `usingPositionId` are not patchable (Q3). A `null` clears an optional field. |
| `DeleteAirspace` | `baseDefRev` | Guarded (section 8). |

Ack: the existing `efsp-airspace-ack` with `airspace` (the current merged record), `warning`
(`AIRSPACE_EDITED_OCCUPIED`, with `occupied` count and `staleEntries`, section 8) and, on conflict,
`conflicts: [{field, base, theirs}]`.

### Validation (Proposal)

One pure `validateAirspaceDefinition(def, ctx)` shared by server and client. Hard errors (refuse):

| Field | Rule |
|---|---|
| `airspaceId` | on create: `^[A-Z0-9][A-Z0-9-]{1,23}$`, unique; immutable afterwards. |
| `name` | 1 to 40 characters after trim; unique case-insensitively (two blocks with one name is a briefing hazard). |
| `type` | in `AIRSPACE_TYPES` (unchanged). Never read for behaviour. |
| `controllingFacilityId` | an existing Facility, not `RANGES`. **Now a hard check** (gap 4). |
| `controllingPositionId` | in that Facility's Position set. |
| `workingFrequencyMhz`, `controlFrequencyMhz` | unchanged rule, 30 to 400 MHz, at most 3 decimals. |
| `altLowerFt`, `altUpperFt` | unchanged rule (whole feet 0 to 100000, upper above lower). |

Soft notes (shown, never refuse, in the spirit of ADR 0038's "warn, never refuse reality"):
another airspace uses the same frequency; altitude limits narrower than a flight's current block (counted);
`controlFrequencyMhz` set with no `usingPositionId`.

### Persistence

**Proposal: the definitions move into the store's own snapshot** (`airspaces: [{definition, ...record}]`)
inside the single atomic `state/efsp-board.json` write that already follows every successful Mutation. One
file, one atomic rename, so a definition and its record can never disagree after a crash, and ADR 0083/0081's
log-tail reconcile covers an edit audited but not persisted with no new machinery.

- First boot with no `definition` in the snapshot: seed from `getAirspaces()` (shipped `config/efsp-airspaces.json`,
  or `state/efsp-airspaces.json` by the ADR 0048 read rule if one exists from an earlier release).
- Once the snapshot holds definitions it wins. `airspace-config.js` becomes the seed loader and validator
  only; `setAirspaces` is deleted (no backwards compatibility, no caller).
- The `RANGES` Position set stays derived at load from the restored definitions, so a restart picks up a
  changed range Position. This is why `usingPositionId` is not live-editable (Q3).
- `state/efsp-airspaces.json` is not written any more. ADR 0048's rule ("everything the service writes is in
  `state/`") is kept; the file is simply folded into the Board snapshot. P5 does not apply: these are squadron
  data edited by controllers, not tuning files.
- A deleted record is dropped from the snapshot; `restore()` no longer needs the "dropped from config" guard.

The new ADR (phase 2, number to be given) records: edits live in the store, one snapshot, `defRev`, and that
this supersedes the "static configuration" framing in ADR 0035 by new prose (P4).

## 7. How clients get updates, and conflicts

- **Snapshot:** unchanged, `airspaces` sent whole. Each element is `{...record, definition, defRev,
  definitionHistory}`.
- **Delta:** the existing `efsp-airspace-delta {airspaceSeq, airspaces:{updated:[...]}}`, plus a new
  `airspaces.removed: [airspaceId]` for a delete. Every definition edit bumps `airspaceSeq` (`_touch`).
  Broadcast to everyone, unfiltered, like today (not flights; read-scope.js leaves airspaces alone, so a JTAC
  sees the list too).
- **Reconnect:** snapshot whole, no resync branch (unchanged). Per the standing decision in
  `efsp-scenario-manning.test.mjs`, airspace ops are **not replayed** on reconnect; an edit sent while
  disconnected is refused `NOT_HOLDING_POSITION`. The panel keeps the open form buffer, so re-sending is one
  click. That test stays as is and gains an edit case.
- **Other consumers** of the list (the Block 22 airspace picker in Strip fields, `airspaceFor`) read the same
  store and see the edit on the next delta.

### Two controllers edit the same airspace

Optimistic, **per field**:

1. The form opens at `defRev N` and sends `baseDefRev: N` with a patch of only the fields the user changed.
2. The server keeps `definitionHistory` (append-only, bounded to the last 50, each entry `{defRev, at, by,
   positionId, changes:[{field, from, to}]}`). On a patch it finds the entries after `baseDefRev`.
3. If none of them touched a patched field, the patch applies cleanly even though `defRev` moved (two
   controllers changing different fields do not collide).
4. If one did, the answer is `STALE_REV` with `conflicts` and the current airspace. Nothing is written. The
   audit entry records the refusal (ADR 0083: store logs what reaches it).
5. The client shows the conflict state (mockup 3): per conflicting field, your value against the other
   controller's, and the base you started from; "Use theirs" / "Keep mine"; non-conflicting fields are
   listed as applying cleanly. Resolving re-sends with `baseDefRev` = current.

Same-field last-writer-wins is rejected on purpose: a silently reverted frequency is the failure that matters
here.

## 8. What happens to Strips, ranges and bookings

An airspace is referenced by `strip.airspaceEntry.airspaceId`, `fdr.comms` (via the entry), its own booking
`window` / `pendingRequest`, and historic Strips (archived, ADR 0082) and log entries. The **id never
changes**, so no reference is rewritten.

| Edit | Effect |
|---|---|
| `name`, `type` | Display only; every reference follows on render. |
| `workingFrequencyMhz` / `controlFrequencyMhz` | **Not pushed into Strips or FDRs.** The Strip's `frequencyMhz` is what the pilot was actually told. The ack carries `warning: AIRSPACE_EDITED_OCCUPIED`, `occupied: n`, and `staleEntries` (Strips whose `airspaceEntry.frequencyMhz` differs from the new frequency). The panel lists them ("2 flights on 138.000") so the controller re-approves them (`ApproveAirspaceEntry` already amends in place). The Strip view marking such a Strip is a follow-up, not in v1 (finding F2). |
| `altLowerFt` / `altUpperFt` | Existing Strip blocks are left alone; the ack counts blocks now outside the new limits (soft note, same as releasing an occupied block). New approvals validate against the new limits (`_validateAltitudeBlock` reads the live definition). |
| `controllingPositionId` / Facility | A `pendingRequest` or SCHEDULED window stays; the new controlling Position can approve it, the old one cannot. Recorded in `definitionHistory`. |
| `usingPositionId` | Not editable (Q3). |
| **Delete** | Refused (`VALIDATION_ERROR`, detail lists blockers) unless the record is RETURNED (not SCHEDULED, ACTIVE or RELEASED), no `pendingRequest`, and `occupancyFor` is 0. So a booked range or a flight on its frequency blocks it; the panel shows the blockers and the actions that clear them (Return, Clear entry). On success the record is removed, and a delta carries `removed`. |
| **Archived Strips and the log** | Keep the id as written. The panel and Strip view show the bare id when no definition exists any more (never an error). The deleted definition is preserved in the audit entry's `before`. |
| **Id reuse** | Allowed after a delete (Q6). History stays distinguishable because the log carries the full `before`/`after` and mission time. |
| **Range bookings (`RANGE` station, briefing 3A)** | Untouched by a definition edit: `window`, `state`, `pendingRequest`, `transitions` are on the record, not the definition. A range given a new control frequency keeps its booking. |

## 9. Audit (ADR 0083 one-outcome-one-entry)

Every outcome of the three new ops is one Mutation-log line through `AirspaceStore._recordAudit`:

- Success: `op` = `CreateAirspace` / `EditAirspace` / `DeleteAirspace`, `airspaceId`, `facilityId`,
  `actingPositionId`, `actorId`, `at` (mission clock), `ok: true`, `before`/`after` **including the
  definition** (fix to gap 3), plus `changes: [{field, from, to}]` for an edit and `occupied` /
  `staleEntries` when relevant.
- Refusals (`PERMISSION_DENIED`, `VALIDATION_ERROR`, `STALE_REV` with `conflicts`, `NOT_FOUND`) are logged by
  the store, as `NOT_FOUND`/`STALE_REV` already are. Pre-store refusals (`NOT_HOLDING_POSITION`) are logged by
  the metrics tap with `unaudited: true`. A cached replay (same `clientMutationId`) writes nothing.
- `facilityId` for a create comes from the op's definition, for a delete from `before`, never `null` for a
  known airspace (the ADR 0083 rule, extended).
- One edit that changes five fields is **one** entry (a `changes` array), not five.
- The new op strings are classified in `metrics.js` (the L23/L26 finding: unclassified strings break the
  tap); none count as traffic.

The panel's **History** view (mockup 4) merges the record's `transitions` and its `definitionHistory` into one
timeline, newest first. It shows accepted changes only; refused attempts live in the Mutation log (Q7).
`definitionHistory` is bounded in the snapshot; the log is the unbounded record (ADR 0065).

## 10. Client (Proposal)

The AIRSPACE panel keeps its card list and its existing actions (`airspaceActionsFor` untouched).

- Header: Facility grouping, "Mine / All" toggle, "New airspace" (only if `canCreate`).
- Card ⋯ menu: Edit..., History, Delete... Items the session may not use are a dashed outline with the reason
  ("Owned by CTR"), the same disabled rule as everywhere (ADR 0056).
- Edit opens an inline editor in the card (same field grid; no modal). One filled blue button (Save), grey
  Cancel. Changed fields are marked with the old value in grey ("was 138.000"), not coloured. Errors are
  `--efsp-bad`, shown on the field and summarised beside Save. Save is disabled while invalid, with the reason.
- Colour follows ADR 0056/0058: grey by default, orange-red only for something wrong (validation error,
  conflict, refused delete). The impact note ("2 flights keep 138.000") is grey, not amber, because it is
  information, not a fault.
- Unit tests (phase 2): the shared validator; `airspaceActionsFor` untouched; a new `airspaceEditActionsFor`
  mirroring the capability table (a test that the client table and `permission.js` agree, like L23's).

## 11. Phase 2 build plan (for the supervisor)

Files, once approved: `permission.js` (table and accessors), `airspace-config.js` (validator, seed loader,
`setAirspaces` removed), `airspace-store.js` (`apply` cases, `defRev`, `definitionHistory`, snapshot/restore,
audit `after` fix, create/delete), `efsp-ws.js` (skip `NOT_FOUND` for Create, `removed` delta, ack
`conflicts`), `index.js` (`_persist`/`_restore`, `_validateAirspaceReferences` as a callable hard check),
`metrics.js` (classify op strings), client `airspace-panel.js` plus a new `airspace-editor.js` and a shared
validator module, one ADR, tests (below), one Playwright spec on `E2E_LANE=3` only if needed. Shared docs
(briefing 3A, usage guide 8A) are not edited by the lane; the build adds a `docs/wip/AIRSP.md` section on what
they should say.

Tests to write first (each a failing test before code): validator table (every rule above, including type
never read for behaviour); capability table per Position; per-field conflict (disjoint fields merge,
overlapping refuse); `STALE_REV` does not occur between a state op and a definition edit; delete blockers;
create then restart restores the definition and record together; delete then restart does not resurrect it;
audit: one entry per outcome incl. refusals and `facilityId` on create; replay (`clientMutationId`) writes
nothing; edit while disconnected refused and not replayed; occupied-edit warning and `staleEntries`.

Walks (memory "walk requests, not just the lifecycle"): edit frequency of an ACTIVE MOA with two flights and
re-approve one; delete with a pending activation request; two controllers racing the same field and
different fields; reassign controlling Position while a request is pending; server restart mid-edit;
reconnect with an open form buffer; a range Position editing its control frequency; type changed to
RESTRICTED while a flight is in it (must change nothing, D14).

## 12. Defaults that are decisions already made

Airspace ops are not replayed (existing test); audit via the store (ADR 0083); mission clock only (H11);
`type` descriptive only (D14, ADR 0038); `[SOURCE-DEFINED]` labelling kept for `type` and frequencies
(D11); airspaces go to every session (read scope); authentication out of scope.

## 13. Open questions for the human, each with a recommendation

1. **Who may edit?** Proposed: only the controlling Position of that airspace (CTR, APP), plus a range
   Position for its own control frequency. Alternative: any ATC Position at the owning Facility. *Recommend:
   the proposal.* A controller who needs to edit takes the seat.
2. **Unmanned owner.** If the owning Position is vacant, can a covering Position edit? *Recommend: no in v1*
   (defer until a walked scenario hurts, per the defer-work-packages rule).
3. **Changing `usingPositionId` (giving a MOA a range-control Position, or removing one).** It creates or
   deletes a `RANGES` Position, which is derived at load. *Recommend: not live-editable in v1*; a controller
   asks for a config change and a restart. Create may set it only if the Position already exists.
4. **Drafts and scheduled effective times.** Do you want an edit that applies at a future in-game time
   ("from 14:00Z the working frequency is 139.0")? *Recommend: no*, edits are immediate and stamped; a draft
   is just the open form. Scheduled edits are a later ADR.
5. **Tactical Positions** (TAC_C2, GCI, AIC). May TAC_C2 define or edit a tactical MOA/range on the fly?
   *Recommend: no* in v1; they ask CTR/APP, or we add a row to the table when a scenario needs it (one line).
6. **Delete and id reuse.** Hard delete, guarded to RETURNED with no occupants, id reusable. Alternative:
   soft delete (retired, hidden, id reserved). *Recommend: hard delete* (fewest node kinds); history is in the
   log with the full definition.
7. **Does the History view show refused attempts?** Today it would show accepted changes only. *Recommend:
   accepted only* in the panel, refusals in the Mutation log.
8. **Frequency and altitude edits on occupied airspace.** Warn and list the flights (proposed) versus refuse
   while occupied. *Recommend: warn and list*, because reality may already have changed (ADR 0038's stance).
9. **Geometry.** Should a definition carry an outline (for map drawing, or to detect entry automatically)?
   *Recommend: no*, defer until a walked scenario shows the cost; today entry is declared by a controller.
10. **Name uniqueness and id format.** Proposed: id `^[A-Z0-9][A-Z0-9-]{1,23}$`, name unique case-insensitive.
    *Recommend: as proposed.*
11. **Seed file.** Once the snapshot holds definitions the shipped `config/efsp-airspaces.json` is ignored,
    so a later shipped default never lands. *Recommend: accept*; it ships empty and the real data is squadron
    data anyway.

## 14. Findings for other lanes and the supervisor

- **F1 (airspace-config).** `setAirspaces` has no caller and cannot work (gap 1); phase 2 deletes it.
- **F2 (Strip view).** A Strip whose `airspaceEntry.frequencyMhz` differs from its airspace's current
  frequency has no marker. A UI follow-up, not required by v1 (the panel lists them).
- **F3 (audit).** `_recordAudit`'s `after` omits the definition and `facilityId` is null for an unknown
  airspace; both change in phase 2 (ADR 0083 amended by new prose, never edited).
- **F4 (lane-rules).** `docs/parallel/lane-rules.md` item 4 says commit trailers read `Claude Opus 5.5`; this
  lane's briefing says `Claude Sonnet 5.5` and the commits use the briefing's, per the CLAUDE-level attribution
  rule. Supervisor may want the rules file aligned.
- **F5 (Playwright).** No lane number is needed in phase 1; if phase 2 needs a spec it uses `E2E_LANE=3`.

## Defaults taken (P2)

- Section 13 defaults: all recommendations above, none yet answered by the human.
- Mockup shows sample airspace names and numbers that are invented; real data is squadron data (D11).
- The mockup shows a light variant although ADR 0056 says the panel "stays dark in both themes"; the task asked
  for both. The light tokens are new and would need the follow-up ADR 0056 mentions.
