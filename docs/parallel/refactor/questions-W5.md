# Questioner, wave W5: points for SYNC (one sync log, one replay cache, `observeTouches`, persistence)

Base read: `efsp-wp5-correlation` at `2b055d4` (the SYNC worktree's base). Pre-check written before SYNC's step 0;
the step-0 review is appended below it. Each point carries a **recommended answer** the lane can take as its default
(P2). Owner tags: `lane` means the lane settles it, `supervisor` means the supervisor rules, `human` means the human
decides. Line numbers are on `2b055d4`.

## Pre-check (before step 0)

### Inventory as found (for the lane to check its step 0 against)

| Where | Seq | Ring | Epoch | Touched set | Idempotency |
|---|---|---|---|---|---|
| Board (`board/board-state.js`) | `_seq`, +1 per ring entry (`recordTouch` :58, `logGone` :98) | `_log`, >2000 → keep last 1000 (:93-95) | `randomUUID` on construction (:29) and `newEpoch()` (:138, called by `restore`) | `_touchedSinceDrain` Set, drained by efsp-ws (:88) | `_appliedMutations` in `board-store.js` (:105), per Board, key `cmid`, cap 5,000 (:42, :235-241), persisted 10 min (:48, :426-436), restored whole (:456-459) |
| airspace, correlation, MARSA, field-state, carrier, SFA stores | plain `_seq` counter each (`airspace-store.js:70,147`, `correlation-store.js:84,182,388,420`, `marsa-store.js:116,196`, `field-state-store.js:77,223`, `carrier-store.js:64,198,229,347`, `sfa-store.js:49,148`) | none | none | none | families' shared `ReplayCache` (`replay-cache.js`, built once at `index.js:290`), key `kind|cmid`, cap 5,000 total, memory only, consulted after gate and `permit` (`wire/skeleton.js:79-91`) |
| ATO import | (Board's) | | | | a third cache: `_atoAckCaches` WeakMap per ctx, cap 200, **whole acks** (`wire/families/ato.js:24-30, 100-101, 125`) |
| Resync decision | `_deltaCanServe` (`efsp-ws.js:272-277`): epoch equal, `lastSeq >= 0`, not ahead, `current - last <= RESYNC_RING_WINDOW` (900, `efsp-ws.js:45`) | | | | |

Client (`crc-desktop/app/public/js`): reads `boardSeq`/`boardEpoch` only (`efsp-state.js:268-315`); **no client file
reads `airspaceSeq`, `correlationSeq`, `marsaSeq`, `fieldStateSeq`, `carrierSeq` or `sfaSeq`** (grep: zero hits).
Resync triggers: epoch change on a delta/ack, two heartbeats ahead (default Facility only, `ws-hub.js:542`), never on
reconnect (R3-47). `efsp-resync-reply` = `{...inner, type, answer: 'snapshot'|'delta'}` (`efsp-ws.js:206-208`),
unwrapped by `answer` (client `efsp-ws.js:248-254`; soak `driver.js:172`).

**W5-1 Six stores keep a sequence; only one is in Owns (`supervisor`).**
Evidence: the table above. The briefing says "the airspace store's `airspaceSeq`; find any others", but Owns lists only
`airspace-store.js`. Five more counters exist, and three of them bump outside their `_touch`: correlation's silent
rev bumps (`correlation-store.js:386-389`, `:418-421`), carrier's quiet stack op (`:347`) and `setShipState` (`:198`,
no record at all, driven by the carrier ticker). Why it matters: S3-1 says "every store". Moving one of six leaves
five hand-rolled counters, and the plan's §2.4 row ("a store that syncs owns a `SyncLog`") is then false on merge.
**Recommended:** extend Owns to the five other store files, "the seq lines only" (each a one-line swap to
`this._sync.advance()` plus the `currentSeq` getter), and list them. If the supervisor prefers to keep W5 small, say so
explicitly and name the five as SYNC-B's first commit instead.

**W5-2 `SyncLog` must not add an epoch, a ring or a touched set to a store that has none (`lane`).**
Evidence: `crypto.randomUUID` is a counter in the goldens (`tests/freeze/freeze-determinism.mjs:17-21`) and seeded in
the soak (`tools/soak/host-env.js:63`). The only `randomUUID` calls on the sync paths are `board-state.js:29` and `:138`.
APP already hit this once: a load-time `randomUUID` shifted the soak's seeded ids (`app.js:632`, S-M-APP). A touched
set that nobody drains grows by one id per distinct record for the process lifetime (correlation is keyed by fdrId),
which no golden sees and only a 3-hour soak would. Why it matters: one extra epoch shifts every later Strip/FDR id in
every golden (loud), and an undrained set is a silent leak. **Recommended:** a counter-only mode is the default
(`new SyncLog()` → `seq`, `advance()`); ring, touched set and epoch are opt-in (`{ ring: true, touched: true, epoch:
true }`), and only `BoardState` turns them on. Mint the epoch with `crypto.randomUUID()` looked up at call time, never
destructured at import (the soak patches the property after load).

**W5-3 `newEpoch()` changes only the epoch (`lane`).**
Evidence: `restore()` (`board-store.js:437-449`) mints a new epoch but keeps `_seq`, the `_log` ring and the touched
set (`board-state.js:138` replaces `_epoch` only). Why it matters: "a new lifetime resets the counter" is the natural
`SyncLog` design and would renumber every seq after a restore. Production restores only at boot (seq 0 anyway), so it
would pass most tests and still be a behaviour change. **Recommended:** `newEpoch()` touches nothing but the epoch;
pin that with a unit test (touch, restore, assert seq kept and the ring still serves the old entries).

**W5-4 The ring's semantics are pinned by no golden and no unit test (`lane`).**
Evidence: the highest `boardSeq` in any hub golden is about 109 (`hub-op-matrix.json`), so no golden reaches the prune
(2,000 → 1,000) or the 900 window. `efsp-ws.test.mjs:243` only asserts the answer is a delta or a snapshot. Unwritten
invariants: every ring entry takes exactly one seq, `gone` included (so `current - last` counts entries); the window
(900, `efsp-ws.js:45`) must stay below the post-prune length (1,000, `board-state.js:94`), and the two constants live in
different files; `getDeltaSince` keeps the first-appearance order of ids but the last entry per id (`:117-125`). The soak
copies both constants by hand as gates (`tools/soak/report.js:20-21`, `logRingMax: 2000`, `appliedMax: 5000`). Why it
matters: an off-by-one in a ported prune or window is golden-identical and ships. **Recommended:** before step 1, write
a characterisation test against the base `BoardState`: 2,001 touches leave 1,000 entries; a delta from exactly 900
behind serves and from 901 behind does not; `logGone` advances seq without a touch; the dedupe order. Keep it green
through every commit. Put the window next to the prune in `sync-log.js` (`canServeFrom(epoch, lastSeq)`), and keep
`efsp-ws.js` re-exporting `RESYNC_RING_WINDOW` (the test imports it). Leave `report.js` alone but name it in Findings.

**W5-5 "One replay cache" means one class, not one map (`lane`; the ATO part `supervisor`).**
Evidence: (a) the Board cache is per Board and keyed by `cmid` alone (`board-store.js:105`); the families' cache is one
instance keyed `kind|cmid` (`replay-cache.js:24`, `index.js:290`). Folding the Boards into the shared map changes
eviction (5,000 per Board vs 5,000 total) and lets one Facility's record answer another Facility's cmid. (b) The Board
normalises absent fields to `null` (`board-store.js:58-72`), the families to `undefined` (`replay-cache.js:43-49`), and
the families' `undefined` drops keys from the JSON ack. A shared normaliser changes ack bytes or snapshot bytes. (c)
`_key` throws on a kind outside `REPLAY_KINDS` (`replay-cache.js:28`), and the Board is no family. `replay-cache.js:19`
also requires `wire/families` at import, which pulls `permission`, `read-scope` and the ATO modules. Make the Board
require it and that whole chain loads with `board-store.js`. (d) The Board lookup must stay inside `applyMutation`:
`ato/ato-board.js:497` calls it directly with derived cmids `${cmid}#${lineId}` (per-line idempotency), and
`index.js:444` asks `hasApplied`. (e) A third cache exists in a file frozen for you (`wire/families/ato.js:24-30`), and
it stores whole acks rather than compact records (ADR 0081's rule). **Recommended:** one `ReplayCache` class with an
injected record builder and an optional kind set (passed in by the owner, not required from `wire/families`). Build one
instance per Board (cmid keys, the null builder, `recentSince(horizon)` for the persist window, `load()` on restore with
no cap and no re-normalising, as `:456-459` does now) and one shared instance for the families (kind keys, the
undefined builder). Leave the ATO cache in place and list it as a finding for after the window.

**W5-6 Owns misses the files the moves force (`supervisor`).**
Evidence: removing `src/efsp/replay-cache.js` breaks `index.js:51` (frozen for you), `tests/efsp-ws-replay.test.mjs:28`
and `tests/wire-skeleton.test.mjs:11`. `wire/skeleton.js:58-63` calls the cache and is neither owned nor frozen.
`host-core.js` reads more than "touch observer and `_log`": `_appliedMutations.size` (`:209`, `:212`, feeding the soak
gate `appliedMax`), `_strips`, `_cidSeq`, `_nlaHistory` (`:202-214`), and its `prune` command deletes from `_strips` and
`_nlaHistory` (`:399-401`). Selfcheck M13 targets the `efsp-resync` dispatch line in `efsp-ws.js` and M15 targets
`  getDeltaSince(` in `board-store.js`, both in SYNC's regions, but Owns lists M8 only. **Recommended:** approve in
advance: the one `require` line in `index.js` (better than a re-export stub at the old path, which would contradict
"removed into `sync/`"); `skeleton.js` only if the cache's `get/set(kind, cmid)` API changes (keep it, and it doesn't);
host-core's `_appliedMutations`/`_strips`/`_cidSeq`/`_nlaHistory` reads; M13 and M15 if their target lines move.

**W5-7 `observeTouches` must reproduce the patched `_touch` exactly (`lane`).**
Evidence: `host-core.js:111-112` calls the original first, then records `{fid, id, cause}`. The cause comes from a stack
pushed by the by-name wraps of `_rebalanceRack`, `reassignPositionStrips` and the five `receive*` (`:113-128`). The
host's `uncarried` reply (`:422-430`) and `soak:selfcheck`'s `drop-broadcast` read it. Placement, Coordination and Tofi
are frozen for you and take `touch` (and Placement `rebalanceRack`) as constructor deps (`board-store.js:112-136`).
BOARD-1's finding (`docs/wip/BOARD-1.md:151-153`) suggests replacing the `_rebalanceRack` wrap too, but that needs
Placement. **Recommended:** the contract is: called synchronously, after the ring entry, once per `recordTouch`
(`bump`, `insert`, every collaborator touch), never for `logGone`, per Board, observers in registration order. The
collaborators get `touch: (id) => this._state.recordTouch(id)` (still a function, so the frozen files are untouched).
`_rebalanceRack`, `reassignPositionStrips` and `receive*` stay on the facade as wrap targets. Prove it with a test:
one Mutation that rebalances a Rack yields the same `{id, cause}` list through `observeTouches` as through the old patch.
When you regenerate `guard-board-surface.json`, `_log` will stay listed as "used by src" because `traffic-count.js:329`
has its own `this._log` (a name collision); that is expected, not a leftover.

**W5-8 Persistence: the Maps are replaced, not mutated (`lane`).**
Evidence: `restore()` assigns new Maps to `_appliedMutations` (`:456`) and `_droppedWallAt` (`:464`), which is why
StripOps reads `droppedWallAt` and `nlaHistory` through late accessors (`:152-160`). `archiveStrip` also deletes from
`_nlaHistory` (`:411`), which is not persisted. The snapshot's key order is `{strips, cidSeq, replay, droppedWallAt}`
(`:435`). The `Date.now()` sites at `:228`, `:389`, `:430` and `:465` are on the clock allow-list.
`REPLAY_PERSIST_WINDOW_MS` is imported from `board-store.js` by `tests/efsp-crash-replay.test.mjs:32`, and M8's `find`
is that literal line. **Recommended:** `BoardPersistence` owns `droppedWallAt` and the replay window. The facade passes
late accessors (`() => this._persistence.droppedWallAt`), never a captured Map. Snapshot key order and record key
order stay byte-identical. The allow-list entries change file and function only. Keep `REPLAY_PERSIST_WINDOW_MS`
exported from `board-store.js` (re-export), so only M8's `file`/`find` move.

**W5-9 S-WIREfix's "no golden sends a resync" is stale; the real blind spots are elsewhere (`supervisor`).**
Evidence: hub traces now send `efsp-resync` nine times (`tests/freeze/freeze-traces.mjs:330-334`: delta, wrong epoch,
from zero, owned scope, unknown Facility; `:416-417`; `:469` after restart; `:500` after archive). What no golden sends:
`efsp-metrics-report`/`-request` through the hub (only `tables-wire-message-types.json` names them); a resync with a valid
epoch more than 900 behind; a ring prune; a cap eviction in either cache; a resync **delta** carrying an archive `gone`
(`:500` sends no epoch, so it gets a snapshot; only `efsp-archiver.test.mjs:310` covers that path). **Recommended:** SYNC
covers the ring, window and caps with unit tests (W5-4, W5-5), not new golden traces in a structural commit. A
metrics-report hub trace is worth adding as its own `test(...)` commit that adds a new golden file and changes no existing
one; the supervisor approves it separately and need not hold SYNC for it.

**W5-10 Step 7's SYNC-B proposal has to start from what the client actually does (`lane`).**
Evidence: the client reads no non-Board seq (inventory above); all resync logic is Board-only (`efsp-state.js:268-315`,
client `efsp-ws.js:210-254`); the heartbeat names the default Facility only (`ws-hub.js:542`, WIRE-B's item); family
state reaches a client only in full snapshots (`efsp-ws.js:434-438`) and per-op deltas; the client is being moved to
ES modules on `lane/ESM-1-client-modules`. **Recommended:** write the proposal per store as `{seqKey, epochKey,
deltaType}`, plus an `efsp-resync` that carries a `stores: {key: {lastSeq, epoch}}` map. Name the client changes by the
ESM module exports, not the globals. Say what a family delta must carry for a gap to be detectable (seq stride and a
heartbeat per store or per Facility, sequenced after WIRE-B). Say which stores would need a ring at all: most are a
handful of records and could answer every resync with their own snapshot, which keeps the "two paths" rule.

## Step-0 review (`sourcedcs-SYNC/docs/wip/SYNC.md`, base `2b055d4`)

The inventory matches the pre-check, and it adds the metrics `BoundedSet`, correctly classed as a dedupe set, not a
replay cache. Already answered by the design: W5-2 (ring and epoch opt-in, `advance()` for a bare counter), most of
W5-5 (one class, two modes, the Board's record built by the caller, `load()` with no cap), W5-6 for host-core (the
facade keeps an `_appliedMutations` getter, so host-core needs no edit there) and M13/M15 (their target lines stay),
and W5-8 (accessor for `droppedWallAt`, `REPLAY_PERSIST_WINDOW_MS` moves with M8). W5-1 and Q2 are the same question:
the supervisor's call. Still open from the pre-check: **W5-3** (state in the design that `newEpoch()` touches nothing
but the epoch), **W5-4** (no characterisation test is planned; see W5-12) and **W5-10** (step 7). New points:

**W5-11 Keep the `_rebalanceRack` wrap; `observeTouches(fn)` reports the id only (`lane`).**
Evidence: Design 5 adds `fn(stripId, { rebalance })`. The facade would set a "rebalance running" context around
`placement.rebalanceRack`, and host-core would derive `stats.rebalances` from distinct context objects and
`rebalancedStrips` from touches. Placement still needs its late-bound `rebalanceRack` callback (`placement.js:31,60`,
frozen), so the facade's `_rebalanceRack` stays anyway. Why it matters: this puts a soak-only cause channel into the
production kernel. A generic `SyncLog` observer then carries a Board/Placement concept. The equivalence of the two stats
rests on an argument ("an empty-Rack rebalance is unreachable"), not on construction. And `report.js:191`'s H1
verdict reads `byCause.REBALANCE_SIDE_EFFECT`. It also goes past the briefing, which replaces only the `_touch` patch,
and past host-core's Owns ("touch observer and `_log` reads"). **Recommended:** `observeTouches(fn)` calls `fn(stripId)`
after the ring entry. host-core swaps only its `_touch` patch for `bs.observeTouches(id => touched.push({fid, id,
cause: top of causeStack}))`. The by-name wraps (`_rebalanceRack`, `reassignPositionStrips`, `receive*`) stay exactly
as they are. Cause attribution and both stats are then unchanged by construction. BOARD-1's suggestion to drop the
`_rebalanceRack` wrap goes to after the window, when Placement is no longer frozen.

**W5-12 `index.js:290` builds `new ReplayCache()` with no arguments, so the default mode decides the families' cache
(`lane`, Q1 to `supervisor`).**
Evidence: Design 3 makes the families' mode depend on `kinds`, and "without `kinds`" means a Board cache (cmid key,
caller-built record). `index.js:290` passes nothing and is frozen. Q1 asks for the `require` line only. Why it
matters: if `index.js` keeps `new ReplayCache()`, either the families get the Board mode (the skeleton's
`set(kind, cmid, rec)` then lands on the wrong signature, breaking every family's replay) or `sync/replay-cache.js`
requires `wire/families` for a default `kinds`. That reverses the dependency direction (sync → wire) and keeps the
import chain W5-5(c) warned about. **Recommended:** make the default the families' mode (`kinds` defaults to the
registry's `REPLAY_KINDS`, read lazily inside the constructor, not at module load), and give the Board an explicit
`ReplayCache.forBoard({ cap })` (or `{ keyed: 'cmid' }`). Then `index.js` changes by the `require` line only, as Q1
asks. Better still, two small classes over one shared map helper (`FamilyReplayCache`, `BoardReplayCache`), so neither
caller can reach the other's `set` signature. Either way, a test where a family replay goes through the skeleton with
`ctx.replayCache` built exactly as `index.js` builds it.

**W5-13 A characterisation test, not only a hub trace, for the ring (`lane`).**
Evidence: Design 8's new hub trace covers the window ("too old" needs about 901 ring entries) and the metrics frames.
It does not cover the prune (more than 2,000 entries, leaving 1,000), the dedupe order of `getDeltaSince`, the
`gone`-takes-a-seq rule, or either cap's eviction. Moving the constants (`RING_MAX`, `RING_KEEP`, the window) into one
file is exactly the kind of edit an off-by-one hides in. **Recommended:** before step 1, a unit test of these
boundaries written against the base `BoardState`, and still green after `SyncLog` lands: 2,001 touches leave 1,000
entries and the oldest seq kept is 1,002; window 900 serves and 901 does not; a delta after `logGone` lists the id in
`gone` and the seq advanced by one; the dedupe order; both caches evict the first key at cap + 1; `load()` ignores
the cap. Add a `RING_KEEP > RESYNC_RING_WINDOW` assertion in `sync-log.js` itself (module-level, pure, no I/O).

**W5-14 The new hub trace is a golden addition outside Owns; set its conditions (`supervisor`).**
Evidence: Design 8 puts `resync-metrics` in a `test(SYNC)` commit. `tests/freeze/freeze-traces.mjs` and
`tests/freeze/golden/` are not in Owns. `UPDATE_GOLDEN=1` (`freeze-lib.mjs:16`) rewrites every golden the run touches.
`metrics.js:53` fixes `METRICS_PATH` at import from `CRCSYNC_EFSP_METRICS_PATH`, so a hub trace that sends a metrics
report writes a state file unless the world sets that variable. **Recommended:** approve it, on four conditions. (1) It
is its own commit, before any move. (2) It is recorded with `UPDATE_GOLDEN=1` on `freeze-hub` only, and `git diff
--stat` shows one new golden file plus `freeze-traces.mjs` and no other golden changed. (3) The world points the
metrics path into its temp dir. (4) It is listed in the report as a fixture added outside Owns. It also closes
S-WIREfix's open lesson.

**W5-15 Persistence's `mutationLog` must be an accessor, and the public `syncLog` getter should be smaller (`lane`).**
Evidence: Design 4 lists `mutationLog` among `BoardPersistence`'s constructor deps. But `setMutationLog()` runs after
construction (`board-store.js:163`), and `archiveStrip` records `Archive` through it (`:413-421`). Audit, Coordination
and StripOps all take `mutationLog: () => this._mutationLog` for this reason (`:109`, `:127`). Design 5 also adds a
public `get syncLog()` exposing `.ring`. That is a new public facade member: `guard-board-surface.json`'s "all public
methods" row grows, and the ring becomes reachable by any `src` caller. **Recommended:** `mutationLog: () =>
this._mutationLog` (a captured `null` would silently drop every `Archive` audit line; only a golden with the archiver
and a mutation log would notice, `hub-monitors`). For the reads, add only what host-core and the archiver test need:
`ringLength` for host-core's `log.<fid>` count, and `ringHas(id, type)` (or the test reads `syncLog.ring` through
`_state`, which tests may reach under R3-31). List the fixture change either way.
