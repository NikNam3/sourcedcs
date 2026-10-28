# STORES: the persisted-store registry and call-time paths

> Read `README.md` in this folder first. Plan: `docs/wip/ARCH-plan.md` §1.3, §2.4. Rulings: S3-4/R3-2 (no state
> versioning now, but design nothing that blocks it).

| | |
|---|---|
| Wave | W2, beside BOARD-1, WIRE, APP. Merges after WIRE, before BOARD-1 and APP |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-STORES` on `lane/STORES-registry` |
| ADR | none (0095) |
| Size / model | 0.5 lane / Sonnet 5.5 |

## Goal

Adding a persisted store means appending one entry to `src/efsp/stores.js`. `_persist` and `_restore` loop over the
registry instead of taking 9 and 10 positional parameters. `createEfsp` resolves its file paths when it is called,
not when it is required. The persisted body and the restore order are byte-identical.

## Owns

`crc-sync/src/efsp/index.js`, new `src/efsp/stores.js`, the tests of persistence/restore/`createEfsp`,
`tests/freeze/selfcheck/{M9,M10}.mjs`, `docs/wip/STORES.md`.

## Frozen for you

`board-store.js`, `board/**`, `efsp-ws.js`, `wire/**`, `ws-hub.js`, `replay-cache.js`, `server.js`, `tools/soak/**`,
`facility-config.js` (DATA-1, W3), every store's own file.

## Design

- Entry: `{ key, build(deps), snapshot(store) → json, restore(store, data, all), after?(all) }`, in today's persist
  order (`persistedWallAt`, `boards`, `fdr`, `airspaces`, `correlations`, `marsa`, `fieldStates`, `carriers`, `sfa`:
  re-read the literal). Array order = JSON key order = restore order. The restore steps that cross stores
  (`_reconcileRestored`, `_reconcileLogTail`, `migrateClearanceAnnotations`, `migrateOverflightStates`, the
  `setMutationLog` calls) keep their exact sequence, as `after` hooks or as an explicit list in `_restore`: whichever
  keeps the order visibly identical.
- `createEfsp({ clock, transitionAltFt, paths = statePaths() })`: paths come from the argument, defaulted at call time
  (`BOARD_SNAPSHOT_PATH` and friends stop being module constants). APP passes them later. The default keeps today's
  behaviour.
- The `ctx` object keeps every key it has (WIRE's families read them) and gains `ctx.stores` (key → instance).
- The back-compat aliases (`efsp.boardStore`, `positionStore`) and the pre-WP4A `data.board` restore **stay** (BACKCOMPAT
  removes them in W6).
- Leave a one-line comment where a future `version` key and per-store upgrade hook would go. Do not add either.

## Steps

0. Step 0 per README: the persist literal, the restore sequence line by line, every call site of `_persist`/`_restore`,
   and every module-level path constant in `index.js`.
1. The registry and the loop. Golden identical (the hub goldens hash the persisted body every step).
2. Call-time paths.
3. Retarget M9 (swap two registry entries) and M10 (drop `liveStripsForFdr` from the rules literal, wherever it lives
   now).

## Acceptance

Golden identical; both suites green; `freeze:selfcheck` all caught; `index.js` line count before → after.

## Defaults (P2)

- The 49-key `rules` literal keeps its shape. Moving rules into the authority registry is AUTH's or BOARD-3's job,
  not yours.
