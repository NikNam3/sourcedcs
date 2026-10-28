# SYNC: one sync log and one replay cache for the Board and every store; the Board's persistence collaborator

> Read `README.md` and `BOARD-1.md` in this folder first. Rulings: S3-1 ("one shared sync/replay mechanism for every
> store"), H87 ("(and persistence)" among the Board's collaborators), S3-4/R3-2 (no versioning now; do not block it).
> Plan: `docs/wip/ARCH-plan.md` §2.2, §2.3, §6 item 4, §9 points 4 and 5.

| | |
|---|---|
| Wave | W5, alone (the questioner reviews; AIRSP phase 2 may draft its design against plan §2.7, without code) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-SYNC` on `lane/SYNC-one-mechanism` |
| ADR | none (0095 §3, §9) |
| Size / model | 1 lane / Opus 5.5 |

## Goal

**Structural only.** `src/efsp/sync/sync-log.js` is the one implementation of seq, ring, epoch, touched set,
`getDeltaSince` and `drainTouched`. It is used by `BoardState` and by every store that keeps its own sequence today
(the airspace store's `airspaceSeq`; find any others). `src/efsp/sync/replay-cache.js` is the one idempotency cache
(the Board's `_appliedMutations`, `_replayRecord` and the persist window, plus the non-Board families' cache, which
replaces `src/efsp/replay-cache.js`). `board/persistence.js` takes `snapshot`, `restore`, `archiveStrip`,
`droppedWallAtOf` and the replay window. `observeTouches(fn)` replaces the soak host's monkeypatch of `bs._touch`.
Output is golden-identical: same seq numbers, same epochs (still minted on construction and restore, never
persisted), the same persisted replay records and snapshot bytes.

## Owns

`crc-sync/src/efsp/board-store.js` (kernel, idempotency, snapshot/restore regions), `src/efsp/board/{board-state,
persistence}.js`, new `src/efsp/sync/**`, `src/efsp/replay-cache.js` (removed into `sync/`), `src/efsp/airspace-store.js`
(the sequence only), `src/efsp/efsp-ws.js` (the resync path and the replay-cache calls only), `tools/soak/host-core.js`
(touch observer and `_log` reads only), `tests/freeze/selfcheck/M8.mjs`, the affected unit tests,
`guard-board-surface.json`, `docs/wip/SYNC.md`.

## Frozen for you

Every `board/ops/**`, `board/{coordination,tofi,placement,audit}.js` file (call their public methods), `wire/families/**`
(they keep calling the replay cache through the skeleton), `index.js` (the store registry stays as it is; if a store
must declare its sync, add that to its `stores.js` entry: one line each, listed).

## Steps

0. Step 0 per README: every place that keeps a seq, a ring, an epoch or an idempotency map, with its exact semantics
   (prune sizes 2,000/1,000, `RESYNC_RING_WINDOW` 900, the cap 5,000, the 10-minute persist window, cmid-less mutations
   never cached, the non-Board cache consulted after the gates). Send it to the questioner: equal semantics are the
   whole point.
1. `sync-log.js` under `BoardState`, golden identical, soak:selfcheck green.
2. The airspace store's sequence on a `SyncLog`, with identical `airspaceSeq` values.
3. One replay cache, with the persisted replay records byte-identical.
4. `board/persistence.js`.
5. `observeTouches(fn)` on the facade; `host-core.js` uses it; remove the `_touch`/`_log` shims if nothing else reads
   them (`guard-board-surface.json` updated).
6. Retarget M8.
7. Write the proposal for queue item 4 (every store gains an epoch and delta resync) as a half-page in the wip file:
   what changes on the wire, and which client code would follow. **Do not build it.**

## Acceptance

Golden identical; both suites green; `soak:selfcheck` all fire; `soak:smoke` PASS; `freeze:selfcheck` all caught;
`board-seam` strict.
