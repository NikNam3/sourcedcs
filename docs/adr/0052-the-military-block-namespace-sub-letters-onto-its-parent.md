# 0052 — the guide's `M`-numbers are not Block ids: the military extension namespace sub-letters onto its parent Block, `fdr.military` becomes an object in one pass, and the deferred half has no write path

## Context

Guide §6.4 publishes a "military extension Block Map" — nineteen numbered fields, `M1`–`M19`, covering everything from ALTRV references to ordnance state to arresting-gear requirements. WP6's four remaining deliverables all need fields out of it: §9.7 wants the hook requirement (`M15`), §9.5 the ordnance state (`M14`), §9.6 the alert status (`M16`), §9.4 the MTR fields (`M10`/`M11`).

`fdr.military` has been the literal `null` since WP0, with a `// WP6 hook` comment beside it. Turning it on is not interesting; **deciding what to call the fields is**, and that question has now been asked four separate times:

- `docs/adr/0026` froze `MISSION_BLOCK_MAP`'s `M1`–`M8` with **its own meanings**, which differ from §6.4's table. Its `M4` is the beacon; the guide's `M4` is IFF Mode 1/2. Its `M5` is the controlling agency; the guide's `M7` is.
- `docs/adr/0050` hit it for the stereo route, which the guide numbers `M18`, and declined the number.
- `docs/adr/0051` hit it for the hook requirement and made a one-line decision (`3F`) in passing.
- §9.5/§9.6/§9.4 each need more.

Each time it was re-derived from scratch, and each time the same answer came out. A fifth re-derivation is a design smell, not a coincidence.

Doing this as its own pass also has a second motive. Four deliverables adding fields to one sub-object, one at a time, means four chances to disagree about whether a field is generic-path writable, whether it is validated, and what happens to an FDR restored from a snapshot written before it existed. Settling the shape once means §9.5, §9.6, §9.7 and §9.4 add **behaviour** rather than schema.

## Decision

### `M1`–`M8` stay exactly as `0026` froze them, and the guide's `M`-numbers are never Block ids on an ATC Block Map

Renumbering a shipped Block Map is worse than the divergence: it would break every persisted annotation cell keyed by Block id, every facility config narrowing, and every test that names one — to buy agreement with a table whose numbers are already spoken for locally.

So the `M`-prefix namespace belongs to `MISSION_BLOCK_MAP` and nothing else. An `M14` on `DEPARTURE_BLOCK_MAP` would be ambiguous by construction: two maps, one id, two meanings, and no way to tell from the id which you have. `efsp-block-map.test.mjs` asserts no ATC Role uses an `M`-prefixed id at all, so this cannot drift back in.

### The convention is: sub-letter the field onto its parent Block, and cite the guide's `M`-number in the comment

This is not a new rule — it is the one this codebase has actually followed every time: `3A`–`3E` (identity), `8A`/`8B` (airports), `9A`–`9F` (route and its restrictions), `5A` (track degradation), `14A`–`14D` (the release cluster). `0050` reached it for `9F` and `0051` for `3F` independently.

| Guide | Field | Block id | Why that parent |
|---|---|---|---|
| `M14` | `military.ordnanceState` | **`3G`** | the 3-family *is* the airframe (3A type, 3B wake, 3C tail, 3D unit, 3E home station); an ordnance state is its configuration |
| `M15` | `military.hookRequired` | **`3F`** | same — a hook requirement is a fact about the airframe |
| `M18` | `filed.stereoRouteName` | `9F` | already shipped (`0050`); a stereo route *is* Block 9's route, named |
| `M10` | `military.mtr` (designator / entry fix / entry time) | `9G-*` **reserved** | 9 is the route, and an MTR *is* a route |
| `M11` | `military.mtr` (exit fix / exit estimate / altitude after exit) | `9H-*` **reserved** | same |
| `M16` | `military.alertStatus` | none yet | no natural parent; §9.6's own decision |
| `M9`, `M12`, `M13`, `M17`, `M19` | `altrvRef`, `arInfo`, `scl`, `fuelState`, `releaseAuthority` | none | WP6 does not deliver these |

The table lives in code as `MILITARY_BLOCK_NAMESPACE` in `block-map.js`, not only in this file. A comment drifts; `efsp-block-map.test.mjs` holds every entry claiming a concrete Block id to naming one that exists and routes where the table says, holds every `military`-kind Block on any Map to having an entry, and holds every field with no Block to being one `setMilitary` refuses.

### `3F` and `3G` are on all three ATC Roles

`0051`'s lesson, applied rather than remembered: OVERFLIGHT had no assignment Block at all, so §9.2's acceptance criterion passed on DEPARTURE and ARRIVAL and quietly did not hold on the third Role. A hook requirement and an ordnance state are facts about the airframe, so there is no ATC Role they stop being true for — and the test asserts all three rather than whichever one a scenario happened to use.

**Neither is on `MISSION_BLOCK_MAP`**, and that is a decision too. A MISSION Strip shares its `fdrId` with the ATC Strip it is TOFI-linked to (`0025`), so a write from either surface is a write to the same flight. A MISSION Block for these would need an id in the very `M`-namespace this ADR exists to stop reusing, *and* would add a second place one aircraft's ordnance can be declared from — `0045`'s "two answers to one question" in a new costume. When §9.8's mission line grows richer (WP7), that is the ADR that should settle it.

### A dedicated `military` target kind and one `setMilitary()` patch setter

`{ kind: 'military', field: 'hookRequired' }`, resolved by `resolveBlockTarget` and routed by `board-store.js` to `fdrStore.setMilitary()`. This is `tofi`'s shape exactly — several Blocks, one target kind, `field` carrying which key of one sub-object each writes — and `setTofi`'s shape for the setter: one method taking a partial patch, structurally excluded from `WRITABLE_PATHS`, so there is no generic-path route to these fields even by accident.

The exclusion earns itself twice over here. `ordnanceState` is a restricted enum. `hookRequired` is a **bare boolean**, which is defect D15's own shape: "hook" alone does not say whether the aircraft *has* one or *requires* one, and only the second reading gates an arrival on a runway's gear being rigged (§9.7 rule 4). Routing it through a named method makes the reading structural rather than a convention in a comment — the same argument `setAirspaceOwner` made for `0018`.

`setMilitary` **refuses an unknown key rather than merging it.** The patch key arrives from a Block Map `field` on the wire, and §12's deferred fields sit in the same object, so "not writable yet" has to fail loudly rather than become writable by accident.

### The deferred half is present, unpopulated, and has no write path at all

`defaultMilitary()` seeds `mtr` (all six sub-fields null), `altrvRef`, `arInfo`, `scl`, `fuelState` and `releaseAuthority` — §12's rule that a deferral leaves its fields in place rather than absent, exactly as `identity.modeOne`/`modeTwo` already do. No Block resolves to any of them and `setMilitary` refuses them by name, which is what "present and unpopulated" has to mean in practice rather than only at seed time.

`alertStatus` is the one deliberate middle case: the enum is settled (§9.6 publishes `NONE`/`ALERT`/`SCRAMBLE`) and `setMilitary` validates it, but it gets **no Block**. Its parent is the one genuinely open question in the table, and picking one is §9.6's decision made with §9.6 in hand.

### `restore()` seeds the namespace onto an FDR that predates it

Every board that has ever run has FDRs on disk whose `military` is the literal `null` of the old hook. §12's "present rather than absent" is a promise about the shape a reader sees, and a restored snapshot is a reader — so `restore()` seeds on the way in. Without it, a §9.5 advisory reading `fdr.military.ordnanceState` throws on exactly the flights that were already airborne when the service restarted, which is the worst possible set. The client's `resolveBlockValue` guards the same case for the same reason: nothing reseeds an FDR already sitting in a connected client's cache.

### Two gaps the briefing had listed as known, closed here because they were one line each

- **`efsp-block-map-parity.test.js` now compares `interlock`** (the gap `0051` left) **and `target.field` for the `tofi`/`military` kinds.** The parity test compared existence, `required`, writable-kind, `path` and `provenance` only, so the server could tag a Block and the client would never know. Adding the assertion **immediately failed**: the client had never carried the `interlock` tag at all. It carries it now. The `field` check matters for the same reason a wrong `path` does — a mismatch sends the controller's edit to the wrong key of the right object, and `isWritableKind` lumps every dedicated kind together as "not directly writable", so nothing was looking.
- **`efsp-ui-reachability.test.js` now counts a boolean-toggle Block as writable.** `isBooleanToggleBlock` was missing from the disjunction in the one test whose whole job is noticing an unreachable Block. It cost nothing while `IFR` was the only such Block and `IFR` happened to be in the compact view; `3F` is the second, and the next one would not have been noticed by luck.

## Alternatives considered

**Use the guide's `M`-numbers and renumber `MISSION_BLOCK_MAP`.** Agreement with the published table, at the price of breaking every persisted annotation, config narrowing and test keyed by `M1`–`M8` — to fix a divergence that costs a comment line per Block.

**A `military.*` family in `WRITABLE_PATHS`, like `mission.*` has.** Cheaper, and wrong for the same reason `setTofi` exists: a validated enum and a bare boolean both need a structurally distinct write path, not a documented convention. It would also leave `military.mtr.*` and `military.scl` one allow-list edit away from being writable while nothing reads them.

**Three setters — `setOrdnanceState`, `setHookRequired`, `setAlertStatus`.** Rejected on `setTofi`'s own stated reasoning: a controller fills these in incrementally from separate Block edits, and one write path keeps `rev`/provenance bookkeeping in one place rather than three.

**Add the `9G-*`/`9H-*` MTR Blocks now, as the WP6 plan's table proposed.** The *mapping* is the part that needed settling and it is settled above; the Blocks are not added yet. The guide is explicit that `M11`'s exit fix and exit estimate are "what a controller asks for by voice and must post", so they want prominent placement rather than a collapsed sub-field — and that placement is §9.4's design decision, made with §9.4 in hand. Adding six Blocks now would mean either six more chips on every Strip or six entries on `DELIBERATELY_NOT_IN_COMPACT_VIEW` whose only honest reason is "not designed yet", which is the promissory note that list exists to refuse. The **fields** are seeded either way, so the shape is settled in one pass even though the surface is not. This is a deliberate deviation from `docs/efsp-wp6-plan.md`'s Phase 2 table, noted here so the next reader does not think it was missed.

**A migration step for old snapshots instead of seeding in `restore()`.** More machinery for the same result, and it would have to run before anything reads an FDR — which is what `restore()` already is.

## Consequences

- `fdr.military` is an object on every FDR, new or restored. Anything that reads it can assume the shape; anything that writes it goes through `setMilitary`.
- Two new Blocks on three Roles: `3F` (HOOK, a click-to-toggle boolean) and `3G` (ORDNANCE, a four-value picker), both in the compact Strip view. §9.7's gear-mismatch check and §9.5's hung-ordnance advisory now have data to read, and a controller has somewhere to enter it.
- **`3G` accepts `HUNG` and nothing yet acts on it.** That is §9.5's deliverable. Until then the value is recorded, audited and broadcast, and no advisory is raised — which is a visible half-feature, not a silent one.
- **`alertStatus` is unreachable from the UI.** Deliberate, and it stays that way until §9.6 picks a Block. The field being validated but unroutable is the honest shape of "the enum is known, the surface is not".
- The `M`-namespace question should not need a sixth answer: `MILITARY_BLOCK_NAMESPACE` is in code, asserted against the Block Maps and against `setMilitary`'s allow-list, so an entry that drifts fails a test rather than misleading a reader.
- The parity test is stricter than it was, which means the next Block added with a dedicated kind has one more way to be caught and one more line to write.
- **Nothing here has been clicked in a browser.** The reachability tests render the real `bay-view.js` against a DOM stub and prove that `3F` toggles and `3G` opens a four-option picker; they say nothing about how two more chips look on a Strip that already carries seven badge/indicator slots (`0051` left the same caveat). Browser automation was not available this session either.
