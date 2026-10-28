# APP: `createApp(deps)`, one composition root for the server, the soak and the tests

> Read `README.md` in this folder first. Ruling: R3-29, "extract a `createApp(deps)` with start()/stop(), shared by
> server, soak and tests". Plan: `docs/wip/ARCH-plan.md` §1.4, §2.5. **Auth hardening is out of scope**: auth routes
> move verbatim.

| | |
|---|---|
| Wave | W2, beside BOARD-1, WIRE, STORES. **Merges last in W2** (it needs WIRE's `WsHub.stop()` and STORES's `paths`) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-APP` on `lane/APP-create-app` |
| ADR | none (0095) |
| Size / model | 1 lane / Sonnet 5.5 |

## Goal

`server.js` parses the environment, calls `createApp(deps)`, `app.start()` and `listen`. Everything else moves into
`src/app.js`, built in dependency order. Timers become named tickers installed by `start()` and cleared by `stop()`.
The soak host (`tools/soak/host-core.js`) calls `createApp` with fakes instead of re-implementing the monitor wiring.

## Owns

`crc-sync/server.js`, new `src/app.js`, `tools/soak/{host-core,host,host-env}.js`, `tests/freeze/{freeze-world,
freeze-hub-runner}.mjs` (host wiring only; the goldens stay identical), new `tests/app-boot.test.mjs`,
`docs/wip/APP.md`.

## Frozen for you

`src/efsp/**`, `src/ws-hub.js`, every other `src/` module (you construct them; you do not edit them). If a module
starts a timer or reads a file when required and that blocks you, list it and ask "main".

## Design

- `createApp({ env, grpcClient, srsClient, clock?, now?, fs?, … }) → { http /* express app */, wsHub, efsp, monitors,
  tickers: [{ name, periodMs, tick }], start(), stop() }`. Routes are mounted inside (so tests can drive them).
  `listen` stays in `server.js`.
- Build order: today's order, with the 7 mid-file `require`s hoisted and the forward reference (the mission-load
  closure → `correlationReconciler`) gone, because the reconciler is built before the handler that uses it.
- The 11 `setInterval`s become tickers with today's periods and names you choose (list them). The `grpcClient.on(...)`
  handlers are attached in `start()`. `stop()` clears every ticker, detaches the handlers and calls `wsHub.stop()`.
- merge4 additions move unchanged: `setAirborneObserver` wiring (UI-B), the `src/test-reset.js` mount (only when
  `CRCSYNC_TEST_RESET === '1'`, with the same refusals).
- `createEfsp(...)` receives `paths` (STORES) at your merge. Add the one-line pass-through then.
- `host-core.js` builds the world through `createApp` with fake gRPC/SRS and drives `tickers` by name. Keep the
  functions `freeze-world.mjs` imports, or update `freeze-world.mjs`/`freeze-hub-runner.mjs` to the new names. The hub
  goldens must stay identical (R0 removed `uncarried`, the one field the host's accounting moved).

## Steps

0. Step 0 per README: the server.js inventory (every `require`, timer with period, `grpcClient.on`, route, closure that
   captures a later `const`); what `host-core.js` re-implements; what `freeze-world.mjs` imports from it.
1. `src/app.js` with everything moved, and `server.js` thin. Run a manual local start on a non-3000 port
   (`PORT=3999 node server.js` with no DCS: it must boot and serve `GET /js/config.js`). **Never touch :3000** (P3).
2. `tests/app-boot.test.mjs`: `createApp` with fakes; ticker names and periods equal today's list; one `tick()` of
   each runs; `stop()` leaves no handle open (the test process exits without `--test-force-exit`).
3. The soak host on `createApp`.

## Acceptance

Golden identical; both suites green; `soak:selfcheck` all fire; `soak:smoke` PASS (memory "not judged" is fine); the
boot test; `server.js` line count before → after; `host-core.js` lines removed.

## Defaults (P2)

- Ticker phase (the offset between timers) is not behaviour. The soak drives ticks explicitly. Do not try to keep it.
- Express route handlers move verbatim, including their comments.
