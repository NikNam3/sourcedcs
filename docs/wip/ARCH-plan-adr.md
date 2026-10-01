# 0095 — EFSP code structure: capabilities register into tables, the Board splits by concern, and a golden master freezes behaviour first

> **Draft, not committed as an ADR.** Lane ARCH wrote this for the human's decision (S-5, D-10, D-9). If
> accepted, the lane that runs phase S1 copies it to `docs/adr/0095-…md` with the human's choices filled in
> (marked ⟨D…⟩ below). Plan and evidence: `docs/wip/ARCH-plan.md`.

## Context

The EFSP server and client grew wave by wave, and every capability landed inside a handful of shared files:

- `crc-sync/src/efsp/board-store.js`: 3,149 lines and one class with 79 methods. 40% of the lines are comments.
  The 1,699 code lines have 97.6% line and 83.6% branch coverage.
- `efsp-ws.js`: 1,158 lines with six hand-written wire handlers that share one skeleton.
- `index.js`: a 43-key `rules` object per Facility, and `_persist`/`_restore` with 8 and 9 positional stores.
- `server.js`: 11 module-level `setInterval`s, 6 mid-file `require`s, a closure that references a const
  declared 300 lines later, and no unit coverage. `tools/soak/host-core.js` re-implements its monitor wiring.
- `crc-desktop` `bay-view.js` (3,066 lines) and `app.js` (20 `efsp-*` cases): classic scripts sharing one global
  scope. On `integ/wave3-dry` a duplicate `const finite` stops `final-panel.js` from loading at all.

Size is not the main cost. The main cost is **fan-out**. One capability (L18S's SFA rotation) edited
`board-store.js`, `index.js`, `efsp-ws.js`, `permission.js`, `facility-config.js`, `replay-cache.js` and
`ws-hub.js`. One lifecycle change (L28) edits seven files. The parallel plan therefore serialises lanes on
those files (`docs/efsp-parallel-plan.md` §2; decisions S-L8, S-R2-1, S-L6), and its merges conflict where
registrations collide (S-M24, S-M27).

The second cost is **repetition**. The session binding is typed 7 times, `unaudited: true` 12 times and the
replay lookup 6 times. Per the file's own comments, a new dispatch path is "exactly where that check gets
forgotten". The same four-line "rev, updatedAt, updatedBy, touch" block appears 32 times. Forty
`this._rules.x &&` guards switch a check off without any error when its rule is not wired.

Where the code already uses tables, adding a capability is cheap: `nla.js` `COMPUTE_BY_ROLE`, `permission.js`'s
capability tables (ADR 0080), `CARRIER_TRANSFER_EFFECTS` (ADR 0074), the Bay descriptor `view` flags (ADR 0093)
and `strip-view.js`'s `_stripAlerts`.

## Decision

### 1. Behaviour is frozen before anything moves

A golden-master suite (`crc-sync/tests/golden/`) drives a real `createEfsp()` behind the real `WsHub` with
fake sockets. It records, per step, every message each socket receives (in order), the Mutation-log lines
appended and the persisted snapshot. Clocks, `Date.now` and `crypto.randomUUID` are deterministic. The corpus
is: the op × outcome matrix; the scenario walks; seeded random traffic with reconnects, resyncs and restarts;
the crash and NotPersisted path; and monitor ticks. A self-check proves it fails on at least eight seeded source
mutations. Alongside it come: a wiring-completeness test (every rule board-store reads is wired by
`createEfsp`), a frozen list of the Board's externally used members, a frozen list of `Date.now()` sites, and on
the client a global-surface test (every `index.html` script loads, no top-level name is declared twice, and the
set of names is frozen).

**A refactor phase compares against the fixtures and never re-records them.** A behaviour change re-records
them in its own commit and lists the diff in the lane report. ⟨D6⟩

### 2. A capability registers. It does not branch

- **Wire families.** Each `efsp-<x>-mutation` family is one file in `src/efsp/wire/families/`, declaring its
  types, replay kind, subject, gate, `apply`, ack fields, broadcasts, and optionally a snapshot key and a
  read-scope filter. `wire/efsp-ws.js` is the one skeleton that enforces the session binding, `unaudited`, the
  replay cache, persist-on-ok and broadcast order. `replay-cache.js`'s kinds come from the registry. A handler
  result carries `broadcasts: [...]` in today's order, and `ws-hub.js` sends the list.
- **Persisted stores.** `src/efsp/stores.js` lists `{ key, build, snapshot, restore, after? }` in today's order.
  `_persist` and `_restore` loop over it. The snapshot's key order and the restore order do not change.
- **Board ops.** `board/ops/<op>.js` exports `{ kind, authorize?, apply, auditFields? }`, registered in
  `board/ops/index.js`. `_dispatch` looks an op up instead of switching on it.
- **Role-change transfers.** The carrier's four hand-overs and the SFA rotation are rows in one `transfers`
  table with one implementation. Each row keeps its own audit keys and refusal wordings. ⟨optional S2c⟩
- **Role families.** `src/efsp/roles/<role>.js` holds a Role's states, initial state, NLA, state owners,
  creators, countable states, replica state on receipt and coordination/TOFI eligibility. `nla.js` and
  `permission.js` stay as facades with unchanged exports. ⟨S3, after L28⟩
- **Client messages.** Each family script calls `registerEfspMessage(type, handler)`, and `app.js` dispatches
  through the registry. ⟨C1a⟩

### 3. The Board splits by concern, by moving code verbatim

`board/board-store.js` keeps the kernel: the Strip map, `_bump`/`_touch`/`_insertStrip`, the seq ring, the epoch,
idempotency, dispatch, audit, the position-lifecycle methods, archive, and snapshot/restore. Coordination, TOFI,
NLA application, retirement, placement, order keys and the ops move out as **prototype mixins**
(`Object.assign(BoardStore.prototype, …)`). Method bodies, `this` and every name a test or tool reaches stay
as they are. A source-scan test forbids a mixin from reading the kernel's private state (`_strips`, `_log`,
`_seq`, `_epoch`, `_touchedSinceDrain`, `_appliedMutations`) directly. The `rules` object keeps its shape.

### 4. Wiring is a function, not a module load

`src/runtime.js` `createRuntime(deps)` builds what `server.js` builds today, in dependency order, and returns
`{ wsHub, efsp, monitors, tickers: [{ name, periodMs, tick }], start(), stop() }`. `server.js` parses the
environment, mounts the routes, calls `start()` and listens. The soak calls `createRuntime` with fakes and
drives `tickers` by name.

### 5. The client keeps classic scripts

There is no ES-module migration and no namespace rename. Every script `index.html` loads must declare unique
top-level names (a test). New files prefix their private names. ⟨D4⟩ `bay-view.js` may be split by feature into
classic scripts that keep the same global names, only inside a client freeze. ⟨optional C1b⟩

### 6. Client mirrors

Code-constant tables are generated into `efsp-tables.generated.js` (one global, `EFSP_TABLES`), checked in and
kept fresh by a test. Config-derived data stays on the wire. Behaviour mirrors stay hand-written under their
parity tests. ⟨optional C2, D7⟩

### 7. Order and freeze

P0 and C0 start now. The server-core phases (S1 → S2a → S2b → S3) run in one freeze window after L20 merges.
During the window no other lane edits `board-store`, `efsp-ws`, `index`, `nla`, `permission`, `replay-cache`,
`coordination`, `traffic-count` or `ws-hub`. S4 and C1a run in parallel, because their files are disjoint.
⟨D1 scope, D2 window, D3 AIRSP⟩

## What does not change

The wire format and message order (ADR 0001, 0004, 0022, 0081); epoch, replay and resync semantics (0006,
0081); audit semantics (0065, 0081, 0083); the persisted snapshot shape and key order (0002, 0048, 0081);
mission-clock time and its four documented wall-time exceptions (0079); one Board per Facility (0013, 0015);
read scope (0080); one carrier hand-over implementation (0074); Bay descriptor flags (0093). Each is checked by
the golden master and by the existing contract, soak and Playwright suites.

## Alternatives considered

- **Leave it.** The code is well tested and well commented, but each new capability keeps serialising lanes on
  the same files, and the copy-paste gate class keeps recurring. Rejected for the server core. Accepted for
  `fdr-store.js` and `metrics.js`, which are not on the serialisation path.
- **Split `BoardStore` into collaborating classes with typed ports** (`FacilityView`, `PermissionPolicy`,
  `RoleRegistry`, …). It reads better on paper, but it rewrites `this` across 2,000 lines and every one of the
  84 `rules` fixtures in the board-store unit tests. The risk is out of proportion to the gain. It can still be
  done later, file by file, once the mixins exist.
- **An event bus between the Board and its side stores** (MARSA, carrier, SFA). This would change the
  synchronous, one-event-one-broadcast semantics ADR 0081 depends on. Rejected.
- **ES modules on the client.** Rejected for now (test-harness churn across 800 tests, load-order change,
  conflict with every UI lane). Revisit with a build step.
- **Serve every table on the wire instead of generating it.** Rejected for code constants: it would add a
  message and couple client startup to it. Data that comes from config is already served.

## Consequences

- A new capability is new files plus one appended registry line per extension point. The ownership table in
  plan §2 shrinks to the registries' index files and the Block Map.
- The session binding, `unaudited` and the replay cache cannot be forgotten on a new path.
- `board-store.js` drops to about 750 lines. Coordination and TOFI are one file each.
- The soak exercises the production wiring.
- Every behaviour lane carries a golden re-record step. ⟨D6⟩
- The client keeps its build-step-free classic scripts, guarded by a uniqueness test.
