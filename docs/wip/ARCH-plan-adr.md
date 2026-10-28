# 0095 — EFSP and CRC code structure: a Board facade with collaborators, registries for every extension point, one composition root, native ES modules on the client, JSON as the single source for facility data, and golden replay as the refactor's acceptance

> **Ready to commit.** Lane BOARD-1 copies this file to `docs/adr/0095-efsp-and-crc-code-structure.md` in its first
> commit, without the blockquote. It encodes the human's rulings S-ARCH, H78, H80, H84, H86, H87 and S-desk3
> (`docs/parallel/decisions.md`). Plan, measurements and phases: `docs/wip/ARCH-plan.md`.

## Context

The EFSP server and the CRC client grew one wave at a time, and every capability landed inside a few shared files:

- `crc-sync/src/efsp/board-store.js`: 3,310 lines, one class, 40% comments, 97.6% line coverage. Size is not the
  cost. Fan-out is: one capability (L18S's SFA rotation) edited seven shared files, and one lifecycle (L28) edited seven.
  The parallel plan therefore serialised lanes on those files, and its merges conflicted where registrations collided.
- Repetition: seven wire handlers re-type the same skeleton (session binding, `unaudited`, replay, persist, ack,
  broadcast). The four-line "rev, updatedAt, updatedBy, touch" block appears 31 times. A `rules` object of 49 optional
  closures switches a check off silently when one is not wired.
- `index.js` persists and restores through 9 and 10 positional parameters. `server.js` has 11 module-level timers and
  no unit coverage, and the soak re-implements its monitor wiring.
- The client is 55 classic scripts sharing one global scope (1,187 names). Duplicate names have already stopped a
  panel from loading (`finite`) and still silently override each other (`_callsignOfFdr`, `_el`).
- Squadron facility data lives twice: as JSON in `config/` and as literals in `facility-config.js`, merged at load.

## Decision

### 1. Acceptance: golden replay, with output changes kept separate

The characterization suite (`crc-sync/tests/freeze/`, `docs/wip/FREEZE.md`) is the refactor's acceptance check. No
surface (wire, snapshot, audit) is frozen as a principle: this is alpha software, and everything may change. Inside the
refactor window:

- a **structural** commit leaves every behaviour golden byte-identical;
- an **output change** is its own explicitly approved commit, which re-records the fixtures in that commit and lists
  the changed traces;
- structure fixtures (the Board surface list, the clock allow-list, the client module-graph export list) may change
  with the structure, listed in the commit.

The fixtures are kept up only during the refactor window. When it closes, the suite leaves `npm test` and becomes an
opt-in script.

### 2. The Board is a facade over collaborators

`BoardStore` keeps its public API (`applyMutation`, the queries, `getDeltaSince`/`drainTouched`, the `receive*` peer
methods, `nlaStatusFor`, the Position-lifecycle methods, `archiveStrip`, `snapshot`/`restore`, `setMutationLog`,
`setAirborneObserver`) and its constructor signature. It delegates to collaborators in `src/efsp/board/`:
`BoardState` (the kernel: the Strip map, bump, insert, touch), `BoardAudit`, `Placement` (order keys, Bays, implied
state), `StripOps` (the op table, one file per op, NLA and Undo, retirement), `Coordination`, `Tofi`, and
`BoardPersistence` (snapshot, restore, archive, the replay window). Each collaborator receives its dependencies in its
constructor, including any sibling it calls. A source-scan test forbids a collaborator from requiring the facade or a
sibling, from reading another object's underscore-prefixed members, and from holding module-level state. This replaces
the prototype mixins the first draft proposed.

### 3. Capabilities register; they do not branch

- **Wire families:** `src/efsp/wire/families/<family>.js` declares type, ack, replay kind, subject, gate, apply, ack
  fields, broadcasts, and optionally a snapshot key and a read-scope filter. `efsp-ws.js` is the one skeleton. A handler
  result carries `broadcasts: [...]` in today's order, and `ws-hub.js` sends the list.
- **Persisted stores:** `src/efsp/stores.js` lists `{key, build, snapshot, restore, after?}` in today's order.
  Persist and restore loop over it.
- **Board ops:** `board/ops/<op>.js` exports `{kind, authorize?, apply, auditFields?}`.
- **Authority:** one registry (`src/efsp/authority/`). Position families (civil ATC, Incirlik military ATC, tactical,
  carrier) register their capabilities and read scopes. Role families (departure, arrival, overflight, mission, marshal,
  final, pattern) register their states, initial state, NLA, state owners, creators, countability, replica state on
  receipt and coordination/TOFI eligibility. `permission.js`, `nla.js` and `coordination.js` remain as facades with
  unchanged exports.
- **Sync:** one `SyncLog` (seq, ring, epoch, touched set) and one replay cache, used by the Board and by every store
  that syncs.
- **Client messages:** each family module calls `registerEfspMessage(type, handler)`, and `app.js` dispatches through
  the registry.

### 4. One composition root

`src/app.js` `createApp(deps)` builds everything `server.js` builds today, in dependency order, and returns
`{ http, wsHub, efsp, monitors, tickers: [{name, periodMs, tick}], start(), stop() }`. `server.js` parses the
environment, calls `createApp`, `start()` and `listen`. The soak and the tests call `createApp` with fake gRPC and SRS
clients and drive the tickers by name. No module in `crc-sync/src` does anything when it is required: no timers, no
file reads, no paths fixed at require time.

### 5. Facility data has one source: JSON

The `DEFAULT_*_CONFIG` literals are removed. `config/efsp-facility-<id>.json` is the shipped source, and a `state/`
copy, when one exists, replaces it whole (ADR 0048's split is kept: reads prefer `state/`, then the shipped file). Code
holds the schema (`facility-schema.js`), the rules and the interactions. A missing or invalid file stops start-up with
the validation message. Tuning defaults that have a JSON twin move to it. Engineering constants stay named in code.
Doctrine tables are rules and live in the authority registry. UI code is exempt. Derived data (RANGES' Positions from
the airspaces) stays derived.

### 6. The client uses native ES modules, with no bundler

Every client file is an ES module with explicit imports and exports. `app/public/js/package.json` scopes
`"type":"module"` so that `app/server.js` stays CommonJS. `index.html` loads the CDN globals and `/js/config.js` as
classic scripts, then one `<script type="module" src="./js/main.js">`. Node tests import the files directly. Packaging
has no build step, and a bundler can be added later without changing the modules. `bay-view.js` and `efsp-panel.js`
are split by feature into `panels/efsp/bay/` and `panels/efsp/panel/`, each entry re-exporting its public names. Hand
copies of server tables stay, guarded by the PARITY tests. They are not generated.

### 7. Logging

crc-sync gets a logging system: module-level loggers, levels (error/warn/info/debug, `LOG_LEVEL`), and structured
context, configured once by `createApp`. ADR 0097 records the details.

### 8. Order and freeze

The refactor runs after the current integration and before L20, in six waves. During the window no feature lane runs
(H78), and each core file has exactly one owning lane at a time (`docs/parallel/refactor/README.md`). The back-compat
code (`efsp.boardStore`/`positionStore` aliases, the pre-WP4A `data.board` restore, the optional-rule guards, the legacy
`blockVisibility` list) is removed in a small last lane, and a rule missing from a Board's wiring becomes a loud
start-up error.

### 9. Room for state versioning

There is no snapshot versioning or migration now: production starts clean, and EFSP is part of crc-desktop/crc-sync
v2. The store registry and `BoardPersistence` are the single place where a `version` key and per-store upgrade hooks
will go. Nothing may assume the snapshot is unversioned.

## What does not change in a structural commit

The wire format and frame order (0001, 0004, 0022, 0081); epoch, replay and resync semantics (0006, 0081); audit
semantics (0065, 0081, 0083); the persisted snapshot shape and key order (0002, 0048, 0081); one Board per Facility
(0013, 0015); read scope (0080); one carrier hand-over implementation (0074); Bay descriptor flags (0093). These can
still change, but only by an approved output change with its own ADR where one is due. Clock policy changes in ADR
0096, not here.

## Alternatives considered

- **Prototype mixins** (this ADR's first draft). They keep `this` and every private name, so they are the smallest
  diff. They are also a single object with hidden coupling under a new file layout. Rejected by the human (H87) in
  favour of collaborators with explicit dependencies.
- **Plain functions taking a `board` argument.** They read well but give no place for a collaborator's own state
  (placement caches, the NLA latch). Collaborators can hold their state privately and still be passed explicitly.
- **Typed ports and a DI container.** These are machinery the codebase does not need. Rejected.
- **An event bus between the Board and its side stores.** It would break the synchronous one-event-one-broadcast
  semantics of ADR 0081. Rejected.
- **Classic scripts plus a name-uniqueness test.** This catches duplicates but leaves 1,187 implicit globals and
  load-order coupling. Rejected (H87).
- **A bundler on the client.** It would add a build step to packaging and to every test run. Deferred. ES modules
  leave the door open.
- **Generated client tables.** Rejected (ARCH-D7). PARITY's tests already catch drift.

## Consequences

- A new capability is new files plus one registry line per extension point. The parallel plan's serialised shared
  files shrink to the registries' index files and the Block Map.
- The session binding, `unaudited` and replay cannot be forgotten on a new wire path.
- `board-store.js` becomes a facade of a few hundred lines. Coordination, TOFI, placement and each op have their own
  files.
- The soak and the tests exercise the production wiring.
- The client's dependencies are visible in its imports, and a duplicate name can no longer override another file's
  function.
- A facility change is a JSON edit, validated at start-up. The shipped JSON and the code cannot disagree.
- The golden fixtures cost a re-record step for approved output changes during the window, and nothing after it.
