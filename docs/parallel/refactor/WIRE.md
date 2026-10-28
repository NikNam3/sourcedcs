# WIRE: one file per wire family, one skeleton, `broadcasts[]`

> Read `README.md` in this folder first. Rulings: ARCH-D1 (S1 is Tier A), ARCH-D3 (the airspace panel waits for this
> registry). Plan: `docs/wip/ARCH-plan.md` §1.2, §2.4.

| | |
|---|---|
| Wave | W2, beside BOARD-1, STORES, APP. **Merges first in W2** (APP needs `WsHub.stop()`) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-WIRE` on `lane/WIRE-families` |
| ADR | none (0095) |
| Size / model | 1 lane / Sonnet 5.5 |

## Goal

Each `efsp-<x>-mutation` family lives in `src/efsp/wire/families/<x>.js`, registered in `families/index.js`.
`efsp-ws.js` keeps one generic skeleton that enforces the session binding, `unaudited`, the replay cache, persist on
ok, the ack and the broadcast order. `ws-hub.js` sends `result.broadcasts[]`. The frames are identical.

## Owns

`crc-sync/src/efsp/efsp-ws.js`, new `src/efsp/wire/**`, `src/efsp/replay-cache.js` (`KINDS` derived from the
registry), `src/ws-hub.js` (the broadcast loop at `:603–626`, and a new `stop()` clearing the timer `attach()` starts),
the ws-hub/efsp-ws tests that read the named broadcast keys, `tests/freeze/freeze-tables.test.mjs` (only the
client-to-server dispatch scraper: read the registry plus `efsp-ws.js`'s remaining cases, and keep the golden
identical), `tests/freeze/selfcheck/{M5,M5b,M13,M17}.mjs`, `docs/wip/WIRE.md`.

## Frozen for you

`board-store.js`, `board/**`, `index.js` (keep the `ctx` keys as they are: STORES only **adds** `ctx.stores`),
`server.js`, `tools/soak/**`, every store file.

## Design

- Family module: `{ type, ackType, deltaType?, replayKind, subject(msg), gate: 'primary-at-facility' |
  'primary-somewhere' | fn, apply(ctx, session, msg), ack(result, ctx, msg), broadcasts(result, ctx) → [frame…],
  snapshotKey?, snapshot?(ctx, session), filter?(ctx, session, msg) }`.
- The skeleton: dispatch by type → gate → replay lookup → apply → remember → persist on ok → ack (with `_subject`) →
  broadcasts. The families today (re-find on your base): airspace, correlation, MARSA, field state, ATO preview, ATO
  mutation, carrier, SFA. The Board path (`_handleMutation`), resync (with merge4's `efsp-resync` reply), set-positions,
  the snapshot and read scope stay in `efsp-ws.js`.
- Any handler whose shape does not fit (ATO preview has no replay, the ATO import broadcasts a board delta with
  `boardEpoch`) declares that in its family file (`replayKind: null`, custom `broadcasts`). Do not bend the skeleton for
  one family. List each exception.
- Result: `{ ack, broadcasts: [primary, peer, marsa, carrier, sfa] (only those present, in that order) }`. `ws-hub.js`
  sends them in a loop, and `onEfspChange` fires when the list is non-empty.
- `snapshotMessage`'s keys come from the families' `snapshotKey`/`snapshot`, **in today's key order** (the snapshot
  frame is in the hub goldens).

## Steps

0. Step 0 per README: the family list, each handler's skeleton deviations, the snapshot key order, the `filterForSession`
   switch cases.
1. The skeleton and the registry, with one family moved (airspace). Golden identical.
2. The remaining families, one commit each.
3. `replay-cache.js` `KINDS` from the registry.
4. `broadcasts[]` and `WsHub.stop()`. Retarget M5/M5b/M17 (swap two entries of the list) and M13 (drop the resync case).

## Acceptance

Golden identical; both suites green; `soak:selfcheck` all fire; `freeze:selfcheck` all caught;
`wire-payload-contract` and `ws-message-contract` green; `efsp-ws.js` line count before → after; a 10-line "how to
add a family" note in `docs/wip/WIRE.md` (AIRSP phase 2 is the first reader).

## Defaults (P2)

- `_subject` stays one function in the skeleton, reading `family.subject(msg)`.
- A per-Facility heartbeat is **not** in scope (plan §6 queue item 5). Note it as WIRE-B in the report.
