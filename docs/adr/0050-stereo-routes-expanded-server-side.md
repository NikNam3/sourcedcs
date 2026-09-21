# 0050 — Stereo routes are a local table expanded server-side; the FDR carries the short name in `filed`, writing it re-files the flight, and a standing release matches that name before the route

## Context

Guide §9.10 is two paragraphs and an instruction:

> Implement a **local canned-route table keyed by short name**, resolvable to a full route, with a filing path that does not require a full flight-plan form. This is verified real practice: assigned aircraft at Kunsan file locally-defined "Pack" routes by phone or email without the international form `[Annex §12]`.
>
> This is the single most authentic-feeling military flight-data behaviour available and it maps directly onto how a DCS squadron actually operates. It is also cheap. Build it early.

It is one of WP6's eight deliverables, with a one-line acceptance criterion (§13): *"A stereo route filed by short name produces a complete FDR."* §8.2 lists "Routes | Stereo/canned route table" under what MUST be configurable, and §8.1 is blunt about the standing: *"the configurability is the specification."*

Nothing of it existed. What did exist was a hook written against it: `release-envelope.js`'s `stereoRoute` criterion, added by `docs/adr/0017` for §4.6.2's *"standing release for a named envelope — a stereo route, at or below an altitude, within a radius"*. With no table to name, it compared the envelope's stereo name to `fdr.filed.route` — the **expanded route string**. That comparison is correct only for as long as no stereo table exists, so this slice had to reconcile it deliberately rather than leave two readings of one field.

Two mis-citations in the guide, recorded here rather than edited into the source document: §6.4's M18 row (`:788`) and §8.2's Routes row (`:943`) both cite **§9.9**, which is ATO ingest. §9.10 is meant.

## Decision

### The table is its own config module, and it ships empty

`crc-sync/src/efsp/stereo-routes.js` + `crc-sync/config/efsp-stereo-routes.json`, structurally a copy of `airspace-config.js`: load-and-validate once at require time, deep-cloned reads, a `setStereoRoutes()` that validates then persists. Paths go through `statePaths()`, so `docs/adr/0048`'s split applies unchanged — shipped default in `config/`, anything written lands in `state/` on the volume, reads prefer `state/` and fall back.

A record is flat and deliberately close to `flight-plan-lookup.js`'s `toFdrFiledSeed()` output, because the briefing's own framing is that a stereo is *"the same shape with a local table instead of an HTTP lookup"*:

```jsonc
{ "name": "PACK 1", "description": "north MOA and recover",
  "departureAirport": "LTAG", "destinationAirport": "LTAG",
  "route": "LTAG DCT ADANA DCT TOROS DCT LTAG",
  "requestedAltitude": "250", "remarks": "", "active": true }
```

**It ships `[]`**, for the reason `airspace-config.js:142` already records for `DEFAULT_AIRSPACES`: the real Pack routes are squadron data the project owner supplies, and an invented "PACK 1 out of Incirlik" is the `[SOURCE-DEFINED]`-presented-as-doctrine trap defect **D11** names — which WP6's own acceptance list makes an audit criterion in its own right. The consequence is that the feature is inert until a table is installed, and §"Consequences" below says how that is discharged.

**Names normalise for lookup, and are stored verbatim.** The guide writes `"PACK 1"`; a controller types `PACK1`, `.stereo pack1`, `PACK-1`. `normalizeStereoName()` (uppercase, whitespace and hyphens stripped) keys resolution, while `name` keeps the squadron's spelling, which is what reaches the Strip. **Two records colliding after normalisation is a `VALIDATION_ERROR`, not last-one-wins** — that collision is the entire reason the normaliser exists, so silently picking a winner would defeat it.

**No facility scoping.** The guide's concept is a *local* table at one base, and `departureAirport` is the honest scoping field. An unused `facilityIds` axis is the preemptive dimension `docs/adr/0020` and `0026` both declined; an absent optional field defaults to unscoped, so adding one later is additive.

### The FDR carries the name in `filed`, and writing it re-files the flight

`fdr.filed.stereoRouteName`, not `mission.stereoRouteName`. §3.1's split is identity / **filed intent** / assigned clearance, and "the pilot filed PACK 1" is filed intent by definition — `filed.route` is already its expansion. `mission.*` is `docs/adr/0026`'s mission-*line* namespace for the `MISSION` Role, which is the one Role that will never file a stereo. `release-envelope.js` also reads `fdr.filed.*` exclusively, so the matcher stays in one namespace.

**Writing it re-files the flight.** `setField()` resolves the name against the table first — an unknown or retired one is a `VALIDATION_ERROR` with no write and no `rev` bump — then rewrites `filed.route`, `requestedAltitude`, `departureAirport` and `destinationAirport` from the record. That is the `identity.equipmentCodes → equipmentSuffix` derive-on-write shape, with `identity.trackDegradationFlag`'s inline validation.

**This field first shipped as unwritable**, with its own non-routable Block kind, on the reasoning that `nla.js`'s standing-release gate matches on it so a controller-typed name no table entry backs would waive a `HOLD_FOR_RELEASE`. That threat is real and is still closed — by resolving every written name against the table, which is a *stronger* guarantee than unwritability was, because it also makes the name and the route agree by construction rather than only by nobody being able to disturb them.

What unwritability cost was the whole switch-and-cancel case, found by walking *"VIPER11, request change to PACK 2"* by hand after the slice was otherwise done. Both remedies were bad: hand-editing Block 9 dropped the label, left the previous route's altitude behind in Block 7, and put the flight **outside** the new route's envelope (the name is empty, so the fallback compares the envelope's literal `"PACK 2"` against an expanded route string); dropping and re-filing minted a **new beacon code and CID** for an aircraft already squawking, and lost its annotations. The same gap ran the other way and that direction is more common — *"request PACK 1"* from a flight already filed the ordinary way could not be recorded at all.

Two fields are deliberately **not** rewritten by a re-file:

- `filed.remarks` — controller free text with nothing to do with the route. Clobbering it is the annotation-erasure mistake `docs/adr/0040` had to fix once already.
- `assigned.clearedRoute` — a re-file amends **filed** intent (§3.1). A clearance already issued to the pilot is a separate field and a separate conversation.

Unlike `createFdr()`'s expansion, where an explicit seed value wins, a re-file overwrites unconditionally: there the seed is the controller's entry, here the route name *is* the entry, so leaving PACK 1's `250` on a flight now filed PACK 2 would be the stale value rather than a preserved one.

**Clearing the name (`''`) un-labels without blanking the route** — cancelling a stereo must never leave a taxiing aircraft with no route; a controller who wants the route gone edits Block 9.

**Amending `filed.route` clears the name**, as a derive-on-write alongside `voidDeadlineUtc` and the EDCT windows. An amended route is no longer the canned one.

### Expansion happens server-side, in `createFdr()`, and an unknown name is refused

`createFdr()` rather than `board-store.js`'s `_applyCreateStrip` via an injected rule. It is the single place a flat seed is interpreted into `identity.*`/`filed.*`, and expanding a short name into a route *is* seed interpretation; putting it in the Board layer means a second creation path, or a test building an `FdrStore` directly, silently skips it. `fdr-store.js` already requires from `airspace-config.js`, so the require direction is not new.

- **Unknown name → `VALIDATION_ERROR`.** Deliberately unlike `flight-plan-lookup.js`'s never-block contract, and the difference is principled: that lookup fronts a remote service that can legitimately be down, so degrading to a blank Strip is the right failure. This table is local config, and "not in the table" is a wrong answer, not a transient one. A Strip that claims a stereo it is not flying is worse than no Strip.
- **Inactive route → `VALIDATION_ERROR` with its own message.** A retired route is a different mistake from a typo, and telling a controller "no such route" about one the squadron used last month sends them hunting for a spelling error. **Deactivation is not retroactive** — a flight already on the route keeps its name and its route.
- **The check runs before `_codeAllocator.allocate()`**, so a refused filing leaks no beacon code out of a finite pool. Asserted by test, not left as a code-review note.
- **Precedence: an explicitly supplied value wins.** The stereo is a template ("file me the usual"); a typed destination is an amendment. Same layering `efsp-panel.js` already applies to the DD1801 seed. In practice they barely collide, because picking a stereo client-side skips the lookup.
- **Provenance** (§10.5): fields the table filled are `COMPUTER_GENERATED`, which is already Block 9's declared pre-edit default; a field the seed supplied keeps the ordinary controller provenance.

### Block `9F`, DEPARTURE only

The guide numbers this **M18** (§6.4). It is not numbered M18 here. `MISSION_BLOCK_MAP` owns the `M`-prefixed namespace, which `docs/adr/0026` froze with different meanings — its `M4` is the beacon, the guide's `M4` is IFF Mode 1/2 — and `MISSION` is the Role that never files a stereo. `9F` follows the convention the codebase actually uses for a sub-field grouped with its parent (`3A`–`3E`, `8A`/`8B`, `9A`–`9E`, `5A`, `14A`–`14D`), and Block 9 is the route. The guide's number is recorded in the code comment so the mapping stays findable.

Plain `fdr`-routed, like `5A` and unlike `24A`: writing it is the re-file above, validated inline. Ordinary click-to-edit free text, deliberately **not** in `ENUM_SELECT_BLOCKS` despite being a restricted value set — that table is a static client-side literal and the route table is runtime config, so a picker there would need a dynamic option source `bay-view.js` has no shape for. The create-strip dropdown is where discovery happens; the server refuses a name not in the table, and `_onCreateStripAck` now carries the rejection's `detail` to the controller. A dynamic-option picker for the Block is the natural follow-on.

It went into `bay-view.js`'s `compactBlocksFor()` **before it was writable, by choice rather than test pressure** — `efsp-ui-reachability.test.js` holds only *writable* Blocks, which is the blind spot the briefing's §6 names, and a controller needs to see which canned route a flight filed because it decides whether a standing release covers it. Now that it is writable the test enforces it too.

DEPARTURE only. `ARRIVAL` shares the FDR across `ConvertToArrival` (`docs/adr/0040`), so a 9F there would show the outbound leg's label on the return leg; `OVERFLIGHT` by definition did not depart here; `MISSION` has no filed route. The field exists on every FDR regardless (§12's "a deferral leaves its fields in place"), so adding the Block elsewhere later is one line.

### The standing release matches the name first, the route as a documented fallback

```
name present  → envelope.stereoRoute must equal fdr.filed.stereoRouteName; filed.route is not consulted
name absent   → compared against fdr.filed.route, i.e. docs/adr/0017's original behaviour
```

The fallback is not laziness. `0017` shipped route-string matching, so an envelope a squadron configured before this slice still matches the flight it was written for, and a hand-filed flight is still eligible for the agreement.

Once a name is present it wins outright, with no second chance at the route.

### Two filing surfaces, one op

`GET /api/stereo-routes` on crc-sync (auth'd, active routes only), proxied by `crc-desktop/app/server.js`, fetched by `efsp-stereo-routes.js` under the same never-throws/bounded-timeout contract as `efsp-flight-plan-lookup.js`. The client list is the **picker's option source, never the authority**: the server resolves the name again at CreateStrip, so a stale client can cause a visible rejection but never a wrong FDR.

- A `<select>` beside the callsign box, hidden whenever the table is empty or the origin is not DEPARTURE — so a squadron with no table sees today's toolbar exactly.
- `.stereo <NAME> <CALLSIGN>`, handled above `_dispatchDotCommand`'s selected-Strip guard on `.find`'s precedent. The name is **one token**; normalisation is what makes that harmless (`PACK1` reaches a route spelled "PACK 1"). It shares `_createStripOrigin()` with the toolbar so the two surfaces cannot disagree about who may originate what, and sends a byte-identical op.

**Picking a stereo skips the DD1801 lookup entirely** rather than racing it: filing a canned route is an explicit choice just made, the lookup is a best-effort background guess, and §9.10's whole premise is the path taken *without* the international form.

### No editor this slice

Load / validate / persist and a read API, matching what `facility-config.js` and `airspace-config.js` actually ship — `airspace-panel.js` drives airspace *state*, never definitions, and `setAirspaces` has no UI caller at all. §8.4's *"configuration changes MUST be versioned, attributed, and recorded"* and its no-live-re-layout rule are satisfied trivially while the only edit path is a file plus a restart. **That is a deferral, not a pass:** an editor cannot simply call `setStereoRoutes()` from a button; it has to bring versioning and attribution with it.

## Alternatives considered

- **Expansion in `board-store.js`'s `_applyCreateStrip`, via an injected rule** like `standingReleases`. Rejected: it puts filed-intent knowledge in the Strip layer, inverting the FDR/Strip split `board-store.js`'s own header defends, and leaves any other creation path unexpanded. The stated reason for preferring it — keeping `fdr-store.js` free of config dependencies — turned out to be factually wrong: it already requires `airspace-config.js`.
- **Client-side expansion**, with the renderer sending a complete FDR. Rejected outright: `filed.stereoRouteName` gates a standing release, so a client able to assert both the name and the route it expands to could grant itself a release the agreement does not cover. A sortie asserts the forged-name path is refused.
- **Silently blanking an unknown name** instead of refusing, mirroring the DD1801 lookup. Rejected — see the Decision; the two failures are different in kind.
- **`mission.stereoRouteName`**, following the guide's placement of M18 among the military extension fields. Rejected: that is a Block-numbering statement, not a storage one, and §6.4's own table already maps `M3`/`M4`/`M8` onto `identity.*`/`filed.*`.
- **Block `M18`.** Rejected: the namespace is taken, with different meanings, by the one Role that never files a stereo.
- **Leaving `9F` read-only**, which is what this ADR originally decided, with re-filing done by Drop and re-create. Rejected once the switch case was walked: the cost lands on a flight that already has a squawk, and the "cancel" half of the same request (`edit Block 9`) silently took the flight out of its standing-release envelope with no indication. The deferral was made on the grounds that re-filing "needs its own answers on `filed.remarks` and an already-issued `clearedRoute`" — which was true, and those answers turned out to be two sentences each, above.
- **Re-filing as a dedicated `.refile` verb or Mutation** rather than by writing `9F`, keeping the field unwritable and giving the operation its own audit entry. Rejected: `SetBlock` on `9F` already lands in the Mutation log with the old and new values, so the audit argument is satisfied, and a second way to express "this flight is on PACK 2" is a second thing to keep consistent with the first.
- **Relabelling without re-expanding** when `9F` is written. Rejected as the unsafe reading: it lets `PACK 2` sit on a Strip still carrying PACK 1's route and altitude, which is a lie on the board *and* one `release-envelope.js` would act on.
- **A clean break to name-only matching** in `release-envelope.js`. Rejected: it silently stops matching every envelope configured before this slice, and the symptom is a flight sitting on an unexplained hold — the worst direction for a release rule to fail in.
- **Matching either the name or the route.** Rejected harder: a flight filed on PACK 1 whose route was later amended to another envelope's string would match both, and two answers to one question is the defect class, not the fix.
- **Shipping the table on the WebSocket snapshot** next to `airspaces`, which carries exactly the "small, static, theater-wide" justification and would have removed the REST route, the proxy line, the client module and two test files. A real simplification, and put to the project owner as such; the REST route was chosen so the table is reachable outside the EFSP socket.
- **Shipping two example Incirlik routes** so the feature works out of the box. Rejected by the project owner on D11 grounds, consistent with the empty `efsp-airspaces.json`.
- **Per-facility scoping** of the table. Deferred as additive; see the Decision.

## Consequences

- **The feature is inert until a squadron installs a table**, and with no editor that means editing a file and restarting crc-sync. Three things discharge that: `docs/efsp-usage-guide.md` §4A carries the schema and a copy-pasteable example with the three install paths; `tests/efsp-scenario-stereo.test.mjs`'s fixture is a second worked example; and the picker hides itself entirely when the table is empty, so the absence reads as "not configured" rather than as a broken control.
- **`tests/efsp-scenario-stereo.test.mjs` is the sortie file**, five walks: the acceptance criterion asserted verbatim and then flown to `PUSHBACK`; the name-vs-route standing-release matrix including the forged-name refusal; refusals costing no beacon code; deactivation not being retroactive; and §8.3 rule 5 — a stereo name is **local symbology and MUST NOT appear in any inter-facility message**, so CENTER's replica shows the expanded route.
- **`efsp-stereo-panel.test.js` is the reachability half**, and it needed a new harness: `efsp-ui-reachability.test.js` renders a *Strip* with `document.getElementById: () => null` and cannot reach the toolbar at all. Its `makeElement` stub is duplicated there; lifting the shared one into a `tests/helpers/` this package does not yet have is the follow-up.
- **Walking the switch/cancel cases by hand, after the suite was green, is what produced the re-file design and both client fixes below.** The briefing's §6 habit paid again, and in the same place it always does — not in a mutation, but in a transition nobody had walked.
- **Two pre-existing bugs were fixed in passing**, both found by writing that test, both of the same silent-failure shape:
  - `_wireDotCommand`'s Enter handler cleared the preview line immediately after dispatch, so **every dot-command error message was erased the instant it was written** — `.bind`'s "needs a track id" has never once been visible, making a mistyped `.bind` indistinguishable from the input not registering.
  - `_onCreateStripAck` printed `result.reason` and dropped `result.detail`, so a rejected CreateStrip read "Rejected: VALIDATION_ERROR" with the only informative part discarded.
- **Two more fell out of walking the switch case**, both in code this ADR introduced:
  - **`.stereo` skipped §3.6's duplicate-origination guard**, justified in its own comment as "a controller who typed a verb, a route name and a callsign has been explicit enough." Wrong: that guard is not about how deliberate the request was, it is about state the controller cannot see — a replica already live at another Facility that should be `ACCEPT`ed rather than re-originated with a second beacon code. It now shares the button's guard and its confirm latch.
  - **The route picker went stale and stayed stale.** The list was fetched once at panel init, so a squadron could edit the table, restart crc-sync, and leave every controller on the old picker until they reloaded the whole app. It refetches on every `efsp-snapshot` now, which is precisely the "crc-sync may have restarted" signal, behind an in-flight latch so a flapping connection cannot stack fetches. The original reasoning — *"a restart drops every socket, so there is no window a refresh would catch"* — was written for the snapshot transport this ADR considered and did not take, and did not survive the move to fetch-once REST.
- **`efsp-block-map-parity.test.js` needs no change.** It compares `target.path` for every `fdr`-routed Block and iterates both maps, so `9F` is covered automatically. It briefly needed a `stereo` branch while the Block had its own read-only kind — that branch went away with the kind, which is the small argument for reusing an existing kind over inventing one.
- **`release-envelope.js`'s stereo criterion now has two readings of one config field**, name-preferred and route-fallback, and both are tested. If a future slice ever wants to retire the fallback, the envelopes in `standingReleases` have to be migrated first, not the matcher.
- **No `.env.example` change.** `CRCSYNC_EFSP_STEREO_ROUTES_PATH` is a test-only override, the same standing `CRCSYNC_EFSP_AIRSPACES_PATH` has; only `CRCSYNC_CONFIG_DIR`/`CRCSYNC_STATE_DIR` are listed there. No compose change either — `config/` is baked into the image and `/app/state` is already a volume.
- **WP6 now has three of eight deliverables built** (§9.11 airspace activation authority `0036`, §6.4 military extension Blocks, §9.10 stereo routes). The briefing's "where to start" moves on to WP6 proper.
