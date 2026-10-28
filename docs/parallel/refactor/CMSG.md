# CMSG: the client message registry

> Read `README.md` in this folder first. Ruling: ARCH-D3 ("the airspace panel waits for S1 **and the client
> registry**"). Plan: `docs/wip/ARCH-plan.md` §2.4. R3-47's follow-up (merge4) is already in `app.js`/`efsp-ws.js`:
> keep its behaviour exactly (epoch trigger, Board heartbeat trigger, no reconnect resync, the `efsp-resync` reply).

| | |
|---|---|
| Wave | W3, after the ESM-1 unit merged; beside ESM-2a, ESM-2b and the server lanes |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-CMSG` on `lane/CMSG-client-messages` |
| ADR / E2E | none (0095) / `E2E_LANE=4` |
| Size / model | 0.5 lane / Sonnet 5.5 |

## Goal

`app.js`'s 22 `case 'efsp-…'` branches become one `dispatchEfspMessage(msg)` call. Each family's handler is registered
with `registerEfspMessage(type, handler)` in `js/panels/efsp/efsp-messages.js`, or in the family module that owns it.
Behaviour is identical. A future family (airspace definitions) adds one registration and no `app.js` edit.

## Owns

`crc-desktop/app/public/js/app.js` (the `ws.onmessage` efsp cases), `js/panels/efsp/efsp-ws.js` (client), new
`js/panels/efsp/efsp-messages.js`, the registration lines in `airspace-panel.js`, `carrier-panel.js`,
`field-state-panel.js` and `metrics-panel.js`, `crc-desktop/tests/ws-message-contract.test.mjs`, your files' entries
in `crc-desktop/tests/fixtures/module-graph-exports.json` (a structure fixture shared with ESM-2a/2b; the supervisor
merges the JSON), `docs/wip/CMSG.md`.

## Frozen for you

`bay-view.js`, `panels/efsp/bay/**` (ESM-2a), `efsp-panel.js`, `panels/efsp/panel/**` (ESM-2b), every other client
file, all of crc-sync.

## Steps

0. Step 0 per README: the 22 cases with what each calls; which cases share code; the order of side effects inside each
   case (state update, then render, then resync checks).
1. `efsp-messages.js`: `registerEfspMessage(type, handler)`, `dispatchEfspMessage(msg)` (an unknown type is ignored
   as today), and `registeredEfspTypes()` for the contract test. Registering the same type twice throws at load.
2. Move each case body verbatim into a handler. Register it in the module that owns the family's state, unless that
   module is `bay-view.js` or `efsp-panel.js`: then register it in `efsp-messages.js`.
3. `ws-message-contract.test.mjs` reads `registeredEfspTypes()` instead of scraping `case` labels. Keep the server-side
   half of the contract unchanged.

## Acceptance

crc-desktop `npm test` green; crc-sync `npm test` green (`wire-payload-contract` scans client files: keep it passing,
and if its regex needs the new file, ask "main" to give you that one line); full Playwright on `E2E_LANE=4` with the
same pass set as base, `ui-b-resync` included.

## Defaults (P2)

- A handler keeps its exact call order. Registration does not reorder side effects.
