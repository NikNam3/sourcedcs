# GRPC-CONNECT: bound the DCS-gRPC connect attempt

Live finding (2026-10-05): DCS offline at crc-sync start, first error 2 min 14 s later (`connect ETIMEDOUT`).

## Root cause (grpc-js 1.14.4)
`transport.js` `tcpConnect()` calls `net.connect(address, cb)` with no timeout, so a host that drops SYNs holds the
subchannel CONNECTING for the kernel's SYN retry window (~127 s). The channel only reaches TRANSIENT_FAILURE, and
the stream's `error`, after that, so crc-sync's backoff never starts earlier.

## Design (`src/grpc-client.js`)
- One `grpc.Channel` shared by all eight clients (`channelOverride`), `grpc.use_local_subchannel_pool: 1`.
- `_watchChannel` follows `watchConnectivityState`. The first non-READY state arms a 10 s timer
  (`CONNECT_TIMEOUT_MS`, `connectTimeoutMs` in tests); READY clears it. CONNECTING <-> TRANSIENT_FAILURE flips do
  not re-arm it, so the bound is the time since the channel was last READY (also covers a DCS restart).
- Timer fires: `_abandonAttempt` cancels both streams (stale-guard: the fields are nulled first), clears stream timers,
  nulls the service fields and closes the channel; after a jittered backoff (1 s doubling, capped at 5 s,
  `connectBackoffCapMs`) `_buildClients` + new streams. Weather, game-time, SRS, Eval and the mission fetch read
  `this._xxxSvc` at call time, so they use the new clients; the first four already guard null.
- Mission fetch parks (no call, no warning) while the channel is not READY and runs the moment it is READY.
- Logging: first abandon `WARN`, then one summary a minute (`_logAbandon`). `retryInMs` null on "unit stream ended"
  now logs `retry='already scheduled'`.
- Verified in source: `Channel.close()` -> `unrefUnusedSubchannels()` -> subchannel unref -> CONNECTING -> IDLE
  (`transport.shutdown()` only sets `isShutdown`; it does NOT destroy an in-flight `net.connect` socket). With the
  local pool a rebuilt channel makes a fresh subchannel and socket, so the stuck one is no longer waited on. The
  abandoned SYN socket lingers until the kernel gives up (<= ~127 s, no handle to destroy it). Measured by hand
  against 10.255.255.1: `getActiveResourcesInfo` after close shows the pending ConnectWraps; a process that closes the
  client keeps running until they die (production never closes).

## Defaults taken
- Connect timeout 10 s; abandon backoff capped at 5 s (not the streams' 30 s: retrying a blackholed host is free and
  a long gap delays recovery after DCS is back).
- Mission-fetch park fallback re-check 5 s.

## Second item
`efsp/index.js` first-run line now logs `willWriteTo` (state/) and `alsoLookedAt` only if the read path differs.

## Not done
Destroying the abandoned in-flight socket (not reachable through grpc-js's public API).
