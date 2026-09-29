# LG: gRPC unit-stream reconnect loop

Branch `lane/LG-grpc-stream`, cut from `efsp-wp5-correlation`. This is a bugfix lane outside the EFSP plan.
The diagnosis is in `docs/parallel/research/grpc-reconnect-loop.md`.

Commits `f355b60`, `469e5f8` and `7a48947` must land together. The first one on its own would make
stationary units disappear 12 s after connect.

## What changed

The code changes are in `crc-sync/src/grpc-client.js` only. The new test is
`crc-sync/tests/grpc-client-stream.test.mjs`.

1. **A valid poll rate.** `StreamUnits` now sends `poll_rate = max(1, DCS_GRPC_POLL_RATE)` with a
   default of 1, and `max_backoff = max(poll_rate, DCS_GRPC_MAX_BACKOFF)` with a default of 5. On the
   wire that is `08 01 10 05`; before, it was `08 00`. DCS-gRPC no longer panics after the full sync,
   and the stream stays open.
2. **Unit keepalive.** The client caches each unit's last `unit` payload and re-emits all of them
   every 5 s while the state is `connected`. A healthy stream only sends units that changed, and the
   12 s reaper in `tracks.js` would otherwise drop parked aircraft and SAM sites.
   - `gone` removes the unit from the cache.
   - A stream `end` or `error` clears the cache, so the reaper still ages everything out when DCS is
     lost.
   - After `mission-load` clears the TrackStore, stationary units return within 5 s.
3. **Backoff and quieter logs.**
   - The unit and event streams reconnect after `min(30 s, 1 s · 2^n)`, jittered to 50–100 %.
     Before, the delays were a fixed 1 s and 3 s.
   - **Deviation from the report:** the backoff resets when a stream has stayed up for 5 s, not on
     the first `data`. With a reset on first data, the exact failure seen here (full sync, then an
     immediate OK end) would never back off. A stream that stays up is healthy either way.
   - `[grpc] unit stream ended` is logged the first time. After that it appears at most once a
     minute, as `unit stream ended N times in last 60s, reconnecting in Xs`.
   - Stream `error` lines are not rate-limited. The backoff already bounds them to about 2 a minute
     at the cap.
4. **`GrpcClient.close()`** stops every stream, timer and channel. The server never calls it; the
   test needs it. The constructor takes optional timing overrides for tests (`keepaliveMs`,
   `backoffBaseMs`, `backoffCapMs`, `stableMs`). `new GrpcClient()` behaves as described above.

Not done: the report's optional status-frame debounce. Residual flapping still emits a `status`
event on every `connected`.

## New env vars (for `.env.example` / docs, not edited here)

| Variable | Default | Meaning |
|---|---|---|
| `DCS_GRPC_POLL_RATE` | `1` | Seconds between DCS-gRPC unit polls. Already existed, but defaulted to 0, which crashed the stream. Floor is 1. |
| `DCS_GRPC_MAX_BACKOFF` | `5` | New. The longest DCS-gRPC waits before re-polling a unit that isn't changing (seconds, at least `DCS_GRPC_POLL_RATE`). |

Neither needs to be set; the defaults are the intended values.

## Results

- **crc-sync suite:** 1171 tests before, 1176 after (5 new tests), all passing. The full suite was
  run 3 times in a row, green each time.
- **Fake DCS-gRPC.** `fake-dcs.js` with 60 units and a 500 ms sync, driven by the real client for
  60 s:

  | scenario | StreamUnits calls in 60 s | `ended` log lines | `unit` events | status emits |
  |---|---|---|---|---|
  | before (poll_rate 0) | **40** | 40 | 2400 | 40 |
  | after (poll_rate 1, stream held) | **1** | 0 | 720 (60 + 11 keepalive ticks × 60) | 1 |
  | after, fake ends *every* stream at once | 7 (+1.1, 2.6, 4.6, 7.7, 13.3, 29.4, 58.3 s) | 1 | 420 | 10 |

## Live check (a human, against real DCS-gRPC, 10 minutes)

Run the fixed crc-sync against the real DCS server with no `DCS_GRPC_POLL_RATE` or
`DCS_GRPC_MAX_BACKOFF` set. Use a separate instance: not the dev crc-sync on :3000 unless you
mean to restart it. Watch for 10 minutes and confirm all four of these:

1. The crc-sync log shows exactly **one** `[grpc] connected` line, and no `unit stream ended` lines.
2. **Parked units stay on scope** for 15 s or more, and indefinitely after that. Check static
   aircraft on a ramp, a SAM site and ground vehicles.
3. **A destroyed or despawned unit disappears in about 1 s**, not about 12 s. That shows `gone`
   events now arrive.
4. **DCS-gRPC's log has no panic lines** (`` `period` must be non-zero ``, or a backtrace from
   `stream.rs`).

Also worth a glance: a moving aircraft still updates about once a second, and the DCS server's
frame time is unchanged or better. The old loop cost about 4,000 Lua calls a minute.
