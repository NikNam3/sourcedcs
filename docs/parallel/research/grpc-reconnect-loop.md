# crc-sync: `[grpc] unit stream ended, reconnecting` loop

Status: diagnosed. Nothing has been fixed yet. Investigated 2026-09-30 on `efsp-wp5-correlation`.

## TL;DR

**Root cause (high confidence):** crc-sync requests `StreamUnits({ poll_rate: 0 })`. DCS-gRPC's
`stream_units()` sends its initial full sync of every unit and then calls
`tokio::time::interval(Duration::from_secs(0))`, which panics on a zero period. The panic kills
the spawned task and drops the channel sender, so tonic ends the RPC with status **OK**. crc-sync
sees a normal `end` rather than an `error`, waits a fixed 1000 ms and asks again. One cycle takes
about 1.5 s, which works out to 40 cycles a minute.

**The catch:** this loop is accidentally what keeps stationary units alive. A healthy DCS-gRPC unit
stream sends a unit only when it **changes**. crc-sync's track reaper deletes anything not updated
for 12 s. Fixing only `poll_rate` would make every parked aircraft, SAM site and static ground unit
disappear 12 s after connect. The fix has to change both sides together.

## Evidence

1. **The request carries an explicit zero.** In `crc-sync/src/grpc-client.js:10`,
   `const POLL_RATE = parseInt(process.env.DCS_GRPC_POLL_RATE) || 0;`. Nothing sets that variable:
   it is absent from `.env`, `.env.example` and `infra/docker-compose.yml`. `:145` then sends
   `StreamUnits({ poll_rate: POLL_RATE })`. `poll_rate` is a proto3 `optional uint32`, so
   protobufjs serialises an explicitly present 0. The fake server captured the raw request as
   **`0x0800`** (field 1, value 0), so DCS-gRPC receives `Some(0)` and not `None`. `None` would
   default to 5.
2. **DCS-gRPC panics on a zero period.** In rust-server `src/stream.rs`, `stream_units()` runs
   `poll_rate = opts.poll_rate.unwrap_or(5)` (giving 0), then `Duration::from_secs(0)`. It does
   the full sync (GetGroups ×3 coalitions, GetUnits per group, one `unit` message per unit) and
   then `tokio::time::interval(poll_rate)`. The tokio source has
   `assert!(period > Duration::new(0, 0), "`period` must be non-zero.")`.
   `src/rpc/mission.rs` runs this in `tokio::spawn`. A panic is not an
   `Err(Error::Status)`, so no error is sent. The task dies, `tx` is dropped, `ReceiverStream`
   ends, and tonic sends trailers with `grpc-status: 0`. That means grpc-js emits `end` and not
   `error`, which matches the log line.
3. **Production logs match the model exactly.** These are crc-sync run logs under
   `/tmp/claude-1000/.../tasks/*.output`:
   - `bo4qt3n9l` (the reported run): 5,066 `ended` lines and 4,206 `connected` lines.
   - `boc8cqhpw`: 1,347 `ended` and 1,347 `connected`, with 0 errors.
   - Every `ended` is preceded by `[grpc] connected`. So data arrives on every stream first (the
     full sync), and then the stream closes cleanly. This is not a deadline and not a transport
     error.
   - Counting `ended` lines between 60 s weather ticks gives 39 to 41 per minute (mode 40). That is
     a period of about 1.5 s: the 1000 ms `_scheduleUnit` timer plus about 500 ms of full-sync
     round trip.
   - 5,066 cycles at 40 a minute is about 2 h 7 min of session.
   - Separately, `bo4qt3n9l` also has 863 `unit stream error: 14 UNAVAILABLE ... ENETUNREACH`
     lines. That was a network outage, retried at the same fixed 1 s with no backoff.
4. **The repro reproduces it with the real client.** The repro scripts are in
   `/home/nklx/.claude/jobs/142e4342/tmp/grpc/`. `fake-dcs.js` is a MissionService that mimics
   `stream_units`: it full-syncs N units and then ends OK when `poll_rate == Some(0)`.
   `run-client.js` drives the unmodified `src/grpc-client.js` against it.

   | scenario | StreamUnits calls | ends/min | `unit` events (60 units) | `gone` | `status` emits |
   |---|---|---|---|---|---|
   | default env (`poll_rate` 0), 500 ms sync, 15 s | 10 | **40** | 600 (full resync every cycle) | 0 | 10 × `connected` |
   | `DCS_GRPC_POLL_RATE=1`, 15 s | **1** | 0 | 60 (then only changes) | 0 | 1 |
   | `poll_rate` 0, instant sync, 10 s | 10 | 60 | 600 | 0 | 10 |

5. **Stationary units depend on the loop.** `tracks.js:10` sets `STALE_MS = 12000`, and the reaper
   at `server.js:441-448` runs every 5 s. DCS-gRPC `update_unit()` sends only when
   position, orientation or velocity changed. Unchanged units back off to `max_backoff` (30 s by
   default) and are never re-sent. `stale-demo.js` shows a unit sent once is expired by
   `expireStale()` 13 s later. The 12 s eviction came from crc-desktop's original client
   (`server.js:436` comment), and the loop has hidden this mismatch ever since.

`DCS_GRPC_POLL_RATE` and `|| 0` date back to `5c599e8` ("crc-test v2", 2026-04-30). The zero was
probably meant as "as fast as possible". Baseline `npm test` in crc-sync: 1171/1171 pass.

## Impact

- **DCS server (the real cost).**
  - Every 1.5 s, DCS-gRPC does a full re-sync: 3 × GetGroups plus one GetUnits per group. Each of
    these is a Lua call executed on the DCS simulation thread and throttled by its
    `throughputLimit`.
  - With 100 groups, that is about 4,000+ mission-env calls a minute, spent re-sending units that
    didn't move. It competes with every other gRPC call: Eval for navpoints and datalink,
    weather, ATIS.
  - A Rust panic backtrace is also logged per cycle (about 40 a minute) in DCS-gRPC's log.
- **crc-sync CPU.** This is small. The repro measured about 0.4 s CPU per 15 s for 60 units,
  including startup; it scales with unit count × 40/min, because every unit is re-emitted,
  re-filtered and passed to `trackStore.update`.
- **Status traffic.** Each cycle flips `reconnecting` to `connected`. `_setState('connected')`
  (`grpc-client.js:582-584`) logs `[grpc] connected` and emits `status`, and
  `server.js:311` → `wsHub.setGrpcStatus` broadcasts it. That is a status frame to **every WS
  client** 40 times a minute, carrying no information.
- **Log volume.** About 80 lines a minute (`connected` + `ended`), roughly 115k lines a day. It
  drowns out real errors: the 863 ENETUNREACH lines were hard to spot inside it.
- **Lost unit updates.**
  - Position updates are **not** lost. Each re-sync delivers all active units, so tracks refresh
    about every 1.5 s, which is faster than DCS-gRPC's default of 5 s.
  - **`gone` events are never delivered.** DCS-gRPC emits `Gone` from its event loop
    (Dead/UnitLost) and from polling NotFound, and both are after the panic. A killed or
    despawned unit lingers until the 12 s reaper removes it, which is 12 to 17 s of a ghost
    track. `transponders.release(id)` (`server.js:240`) never runs from `gone`.
  - A unit born mid-cycle can wait up to about 1.5 s to appear.
  - For about 1 s of every 1.5 s cycle there is no live stream at all.
- **Masked outages.** The loop logs `ended` rather than `error`, and the fixed 1 s retry hides
  a genuinely failing upstream until the 4 s "prolonged" debounce happens to trip.

## Proposed fix (minimal, all in crc-sync)

The two changes must land together. A test pins each one.

### 1. Request a valid poll rate: `crc-sync/src/grpc-client.js:10` and `:145`

```js
// :10: DCS-gRPC panics (tokio interval) on poll_rate 0 and ends the stream OK.
const POLL_RATE   = Math.max(1, parseInt(process.env.DCS_GRPC_POLL_RATE, 10) || 1); // seconds
const MAX_BACKOFF = Math.max(POLL_RATE, parseInt(process.env.DCS_GRPC_MAX_BACKOFF, 10) || 5);
// :145
const stream = this._missionSvc.StreamUnits({ poll_rate: POLL_RATE, max_backoff: MAX_BACKOFF });
```

`poll_rate` 1 keeps about 1 s update latency for moving units, which is no worse than today.
`poll_rate` is whole seconds, so 1 is the floor.

### 2. Keep unchanged units alive without resyncing: `crc-sync/src/grpc-client.js`

This is a keepalive in the gRPC client. It needs no change to `tracks.js` or the reaper.

- In the `data` handler (`:153-182`), cache the last emitted payload:
  `this._lastUnits.set(u.id, payload)`. On `res.gone`, call `this._lastUnits.delete(id)`.
- Add a 5 s interval, started in `connect()`. It re-emits `unit` for every cached payload while
  `this._state === 'connected'`. `TrackStore.update` is idempotent apart from keeping
  `firstSeenAt`, so re-emitting is safe.
- In the `end` and `error` handlers (`:185-197`), call `this._lastUnits.clear()` so a lost stream
  still lets tracks age out through the 12 s reaper. The next stream's full sync repopulates the
  cache.

A cleaner alternative is to make `TrackStore` evict only on `gone` or on stream loss. It is more
invasive because `expireStale` also drives `collabStore.evictStale` and `surveillance.forget`, so
the keepalive is the smaller change.

### 3. Backoff with jitter and quiet logs: `_scheduleUnit` at `grpc-client.js:287-293`, and the handlers at `:185-197`

- Replace the fixed `1000` with `delay = min(30000, 1000 * 2 ** this._unitRetries) * (0.5 + Math.random() / 2)`.
- Reset `this._unitRetries = 0` on the first `data` of a stream. Increment it in `end` and
  `error`.
- Treat an `end` that arrives within a few seconds of the stream starting, especially after data,
  as abnormal. Log it once per minute with a count, using the existing `_evalErrorLoggedAt`
  pattern at `:260-264`: `[grpc] unit stream ended N times in last 60s`.
- Apply the same backoff to `_scheduleEvent` at `:323-329`.

This makes any future "server completes immediately" bug cost one line a minute rather than 80.

### Optional

`_setState('connected')` could skip the `status` emit when the gap since the last `connected` was
under the 4 s debounce. That stops the WS status frames during any residual flapping.

## Test that proves it

Add `crc-sync/tests/grpc-client-stream.test.mjs`, modelled on the repro's `fake-dcs.js`.

The test starts an in-process `grpc.Server` with MissionService. It gives `StreamUnits` a raw
`requestDeserialize: b => b` so the wire bytes can be asserted. It sets
`process.env.DCS_GRPC_HOST` to the fake **before** `createRequire(...)('../src/grpc-client.js')`,
because the module reads env at load time.

1. **Valid request.** The first StreamUnits request bytes start with `08 01` or higher, and are
   never `08 00`. This fails today with `0x0800`.
2. **No loop.** The fake holds the stream open and sends 3 units once. Over 5 s it records exactly
   **1** StreamUnits call. This fails today: the fake ends on `poll_rate` 0, which gives 4 calls.
3. **Stationary units survive.** Wire the client's `unit` and `gone` events into a real
   `TrackStore`. Advance time with `mock.timers` or an injected keepalive interval, then call
   `expireStale()` at 13 s. All 3 unchanged units are still present. After the fake sends
   `{ gone: { id } }`, that unit is removed immediately. This proves both the keepalive and that
   `gone` now arrives.
4. **Backoff.** Make the fake end every stream immediately. Assert the intervals between
   successive StreamUnits calls are non-decreasing up to the cap, each within its jitter window,
   and that at most one "ended" log line appears per 60 s window. Use a `console.log` spy.

Before merging, run a live check against the real DCS-gRPC with the fix in place. Watch for 10
minutes and check four things: exactly one `[grpc] connected` line; parked units still on scope
after 15 s or more; a destroyed unit disappearing in about 1 s rather than about 12 s; and no
panic lines in DCS-gRPC's log.

## Sources

- DCS-gRPC rust-server, `src/stream.rs` (`stream_units`, `update_unit`) and `src/rpc/mission.rs`:
  https://github.com/DCS-gRPC/rust-server
- tokio `time::interval`, which panics on a zero period:
  https://github.com/tokio-rs/tokio/blob/master/tokio/src/time/interval.rs
- The repo proto `crc-sync/protos/dcs/mission/v0/mission.proto:578-595`, whose `poll_rate` field
  comment says "Default: 5".
