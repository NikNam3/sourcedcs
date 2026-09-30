# 0065 — WP8: the §11.5 metric set, the §11.4 traffic count, and Mutation-log retention

## Context

WP8 asks for an audit log, a traffic count (§11.4), the §11.5 metric set with a dashboard, staleness
detection (§10.4) and a soak test. Before this ADR:

- The Mutation log (`mutation-log.js`) was one JSONL file that grew for ever. §11.3 asks for a
  retention period and says it must be configurable rather than encoding any one number.
- The only §11.5 hooks were in-memory counters that reset on every restart: the correlation
  reconciler's `getStats()` and the obligation monitor's `getComplianceStats()`. Search invocations
  were a client-side `console.log`. Nothing measured time-to-find, inputs per gesture, rejected
  Mutations, transfer outcomes or staleness.
- `board-store.js` logged none of its refusals. Most return before `_recordAudit` is reached, and
  `NOT_HOLDING_POSITION` never reaches a store. The airspace, correlation and MARSA stores already
  logged theirs (`0040` found airspace refusals invisible and fixed exactly that).
- There was no traffic count, and a `DROPPED` Strip was never deleted, so the data was there.

This ADR covers the server half. The dashboard is L15 (ADR `0072`), staleness detection is L19 and
the soak harness is L6.

## Decision

### Retention is configuration (§11.3)

`config/efsp-instrumentation.json` is a new tuning file. It is read once at startup and never
written by code (decisions.md P5), so a change applies on restart. It holds three retentions and the
home airports:

| Knob | Default | Measured on |
|---|---|---|
| `mutationLog.retentionDays` | 30 | wall clock |
| `metrics.retentionDays` | 30 | wall clock |
| `trafficCount.retentionDays` | 400 | wall clock |
| `trafficCount.homeAirports` | `{ "INCIRLIK": ["LTAG"] }` | — |

All four are **SOURCE policy choices, not doctrine**. An invalid value warns and falls back to its
default field by field, so a typo can never mean "keep for ever". Retention is a storage lifetime,
like a TTL, so it runs on the wall clock. Mission time can jump years between two missions
(decisions.md H11 draws exactly this line).

**The log is rotated by day segment and never rewritten.** Before each append, a live file whose
last write fell on an earlier UTC day is renamed to `efsp-mutations.<YYYY-MM-DD>[.n].jsonl`. The
segment is named by its **newest** entry, the file's mtime. Retention deletes whole segments older
than `today − retentionDays`, both at rotation and once at boot. A legacy file spanning weeks is
therefore kept until its newest entry expires. Pruning matches this log's exact base name, never
`*.jsonl`. `MutationLog` gains `onRecord(listener)`, which fires only after a successful append, so
anything built from it is a subset of the log.

### Refusals now reach the log

A wire-level tap (below) writes one entry for every refused `efsp-mutation` and for every
`NOT_HOLDING_POSITION` on any `…-mutation` type (S-R2-5). Each entry has `ok: false`,
`source: 'wire'`, `type`, `reason` and `detail`. Refusals that the airspace, correlation and MARSA
stores already log are not logged twice. Every consumer of the log filters on `ok !== false`.

### The tap, by reassignment

`createEfspInstrumentation()` (in `metrics.js`) reassigns `efsp.handleMessage` and
`efsp.onDisconnect` on the facade. `ws-hub.js` looks both up on every message, and nothing connects
before `server.listen`, so every EFSP message, its session and its ack pass through the tap with no
edit to `efsp-ws.js`, `ws-hub.js`, `index.js` or any store. Those files are shared by other lanes
this wave. The tap never throws and returns exactly the wrapped result. It:

- counts Mutation attempts and refusals by matching the type suffix `-mutation$` rather than a
  list, so a new dispatch path is counted without anyone remembering to add it (the `0041` lesson);
- counts each `clientMutationId` once (bounded at 5000), because a reconnect replays its queue and
  the store answers from cache;
- scores a transfer as a `TransferStrip`, or an `InvokeNla` pressed by the Strip's **owner** whose
  `nlaStatusFor` names a `transferTo`. An owner's press against an inhibited NLA is an
  `inhibitedPress`, not an attempt (S-R2-5). A cross-Facility HANDOFF is a coordination decision,
  not a transfer.

### The §11.5 metric set

The metrics are kept in UTC-hour buckets inside **metrics sessions**. A metrics session runs from
one DCS mission load to the next (H32). The hour is taken from the mission clock (H11). A mission
load that is the same mission carrying on (a crc-sync restart or a gRPC reconnect: same theater,
clock continuous within 5 minutes) is not a new session. A mission clock that steps back by more than
5 minutes is a new session. Session identity is an in-module seam until the shared
`mission-session.js` (F3, S-R2-2) replaces it.

Every metric carries a `status`: `COLLECTING`, `NO_DATA` or `NOT_INSTRUMENTED`. A metric with no
source is never shown as a healthy zero. Every rate or percentile with no data is `null`.

| § 11.5 metric | Source |
|---|---|
| Search invocations per Position per manned hour | client `efsp-metrics-report` `SEARCH`; manned minutes sampled by the 60 s tick |
| Time-to-find, p95 < 3 s | client `TIME_TO_FIND`; nearest-rank percentiles; 500 samples per Position-hour, overflow counted |
| Inputs per paper gesture = 1 | client `GESTURE`; cross-checked against successful `SetFlag`s |
| Correlation rate ≥ 95 % | `getStats()` sampled each minute, weighted by what was eligible; `rate: null` samples are skipped |
| Rejected Mutations per session | the tap |
| Staleness detections | L19's hook: `declareSource('staleness')` once, then `recordStaleness({...})`. `NOT_INSTRUMENTED` with `total: null` until then |
| Transfer failures and causes, ≤ 0.5 % | the tap |

Two more rows are reported: obligation compliance (L7's `getComplianceStats()`, verbatim, as counts
only, because `met` is meaningful for only two types, `0067`) and system reassignments.

**Client events are stamped by the server on receipt.** The client's `at` is ignored (S-R2-3). The
reporter must hold the Position right now, as Primary or Observer, which is the `0029` binding.

**Persistence.** Hour buckets, the session list and the `sources` stamps live in
`state/efsp-metrics.json`. The 60 s tick writes the file by sibling-and-rename, and only when
something changed, so **up to one minute is lost on a crash**. The rolling last hour is kept in
one-minute buckets in memory only. None of this is in `efsp-board.json`: `_persist` runs after every
Mutation, and a metrics bug must never be able to reach the Board snapshot.

**No per-person data on the wire** (H35, S-R2-4). Nothing served is keyed by controller.
Per-connection records exist in memory only.

### The §11.4 traffic count — `[SOURCE-DEFINED]` throughout

- **Unit.** There is one record per `DROPPED` Strip per Facility. Reports show both `flights`, the
  headline, and `aircraft`, which is the sum of `flightSize`. A formation is one operation (H34).
  A departure converted in place to its return is one record with `legs: 2`. A flight handed from
  INCIRLIK to CENTER is counted once at each Facility, as two real facilities would each count it.
- **Countability.** This is a pure function of the log entry's own before/after Strip.
  - DEPARTURE counts if dropped from `DEPARTED` or `HANDED_OFF`.
  - ARRIVAL counts if dropped from `LANDED` or `TAXI_IN`.
  - OVERFLIGHT always counts.
  - MISSION never counts (it shares the ATC Strip's FDR).
  - A rejected coordination replica never counts.
  - A drop that does not count is still recorded, with an `excludedReason`.
  - A test holds every Role in `nla.js` to having an entry, so a new Role forces a decision.
- **Locality** is `LOCAL`, `TRANSIENT` or `UNKNOWN`, and these three partition `flights`.
  - A flight is local if it departs and lands at the Facility's own airfield (H33): both filed
    airports are home airports, or it is an ARRIVAL from one, or it is a converted arrival.
  - An OVERFLIGHT is always transient.
  - A Facility with no configured home airport gets `UNKNOWN`. That is CENTER and TACTICAL out of
    the box.
  - An FDR archived before a backfill gets `UNKNOWN` with basis `ARCHIVED` (S-R2-13).
  - Real tower counts also call pattern work local, and the EFSP has no data for that.
- **Formation, SUA traversal and alert scramble are overlapping subsets**, not further partitions.
  - SUA traversal is every airspace the Strip was approved into (`ApproveAirspaceEntry`), latched,
    because `airspaceEntry` is cleared on exit.
  - Alert scramble is `SCRAMBLE` seen at the drop or at any logged Mutation while the Strip was
    live. `noteFdr(fdrId)` is L13's escape hatch for writes made outside a Strip Mutation.
- **Hour** is the UTC hour of the drop, on the mission clock.
- **Persistence** is append-only `state/efsp-traffic-count.jsonl`. An Undo appends a `VOID`. It is
  compacted past retention at boot only, atomically. `actorId` stays in the file and is stripped
  from the wire.

**Reconciliation (WP8 acceptance bullet 3).** `reconcileTrafficCount(log, count, {from, to})` replays
the log with the same two predicates the live counter uses, and reports `missing`, `extra` and
`mismatched`. By default it compares the window both stores still hold. It checks only
**log-derivable** fields: strip, drop time, hour, role, counted, excluded reason, SUA traversal and
drop op. Locality, formation, aircraft type and alert scramble come from the FDR, which the log does
not carry. They are covered by the classifier's unit tests, **not** by the reconciliation. At boot,
`missing` records are backfilled with `backfilled: true`, and `extra` and `mismatched` records are
warned about and kept.

### Exposure — a contract

The contract is two HTTP GETs, `/api/efsp/metrics` and `/api/efsp/traffic-count` (with
`auth.requireAuth`, 400/404/503 on errors, never a throw), and two WS messages:
`efsp-metrics-request` → `efsp-metrics`, and `efsp-metrics-report` → `efsp-metrics-report-ack`. Each
answers the sender only. `tests/efsp-metrics-contract.test.mjs` freezes the body keys. **L15
(`0072`) builds against them. Keys may be added. Renaming or removing one needs a new ADR.** By
default the body shows the current metrics session with a rolling last hour beside it; the query
`?missionSession=` picks a different session (S-R2-4).

## Alternatives considered

- **Hooks inside `efsp-ws.js` or the stores.** Rejected: those files are serialised through other
  lanes this wave, and a tap sees every message, including dispatch paths added later.
- **Rotating the log by rewriting it, or pruning by the oldest entry.** Rejected: rewriting breaks
  append-only, and pruning by the oldest entry would delete last week's audit trail on the first
  rotation of a legacy file.
- **Metrics in the Board snapshot.** Rejected: they would cost every Mutation and expose the Board
  to a metrics bug.
- **In-memory metrics only.** Rejected: "trending down" means nothing if every restart resets it.
- **Per-connection "sessions" on the wire.** Rejected by H35 and S-R2-4.
- **Home airports in `facility-config.js`.** Rejected: that file is serialised L1 → L13 → L17, and
  this is policy, not a Facility's shape. A later move is a new ADR.

## Consequences

- Retention changes need a restart, and there is deliberately no endpoint for them.
- The log now holds `ok:false` entries from the Strip path as well.
- Two refusal kinds remain unlogged: `efsp-ws.js`'s class-based `PERMISSION_DENIED` on the
  airspace, correlation and MARSA paths, and its `VALIDATION_ERROR` for a missing store.
- The airspace store's own refusal entries carry no `clientMutationId`, because `efsp-ws.js` does
  not pass it. That is recorded for the integrator.
- Staleness reports `NOT_INSTRUMENTED` until L19 wires its detector, so WP8's first acceptance
  bullet is met on the server for six of the seven metrics, and the "visible" half is L15's.
- Keying by `positionId` is safe while Position ids are unique across Facilities. A test asserts
  this, and a reuse makes the key `facilityId/positionId` under a new ADR.
