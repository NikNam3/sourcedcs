# BOARD-1: the Board facade, its kernel, audit and Placement

> Read `README.md` in this folder first. Ruling: H87 / R3-8, "facade plus collaborators: `BoardStore` keeps its
> public API and delegates to Placement (order keys, Bays), StripOps, Coordination and Tofi objects that receive
> explicit dependencies; this replaces the ARCH plan's prototype mixins". Plan: `docs/wip/ARCH-plan.md` §1.1, §2.3.

| | |
|---|---|
| Wave | W2, beside WIRE, STORES, APP (disjoint files). Merges after WIRE and STORES, before APP |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-BOARD-1` on `lane/BOARD-1-facade` |
| ADR | **0095**: copy `docs/wip/ARCH-plan-adr.md` to `docs/adr/0095-efsp-and-crc-code-structure.md` (drop the blockquote) in your first commit |
| Size / model | 1 lane / Opus 5.5 (you set the collaborator pattern BOARD-2, BOARD-3 and SYNC copy) |

## Goal

`board-store.js` becomes the facade, and three collaborators move out verbatim: the kernel, the audit and Placement.
Output is golden-identical. BOARD-2 (coordination, TOFI) and BOARD-3 (ops) follow your pattern.

## Owns

`crc-sync/src/efsp/board-store.js`; new `src/efsp/board/{board-state,audit,placement,strip-util}.js`;
`tests/freeze/selfcheck/{M3,M4,M7}.mjs` (audit field, the `_touch` in SetFlag, `causedBy`); board-store unit tests
only where they reach a private member you moved; `tests/freeze/golden/guard-board-surface.json` (structure
fixture); `docs/adr/0095-*.md`; `docs/wip/BOARD-1.md`.

## Frozen for you

Every other `src/` file (in particular `index.js`, `efsp-ws.js`, `ws-hub.js`, `replay-cache.js`), `server.js`,
`tools/soak/**` (note `host-core.js:112` patches `bs._touch` and `:266` reads `bs._log.length`: they must keep
working **without** an edit), `tests/freeze/` apart from your three mutations and the surface fixture.

## Design you implement

- `new BoardStore(fdrStore, rules, { clock })` is unchanged, and so are all public methods (incl. merge4's
  `setAirborneObserver`). The facade builds:
  `state = new BoardState({ clock })`, `audit = new BoardAudit({ state, clock, mutationLog: () => this._mutationLog,
  activeCmid: () => this._activeCmid })`, `placement = new Placement({ state, rules, clock, fdrStore, touch })`.
- **`touch` is `(id) => this._touch(id)`**, late-bound. Collaborators call it, never the state's touch directly.
  `this._touch` on the facade delegates to `state.touch`. Keep `get _log()`, `get _strips()` and `get _cidSeq()` on
  the facade as getters onto `state` (tools and tests read them; SYNC replaces them).
- `BoardState` (cluster: strips map, `_log` ring, `_seq`, `_epoch`, `_touchedSinceDrain`, `_cidSeq`, `getDeltaSince`,
  `drainTouched`, `_pruneLog`, `_nextCid`) plus **`bump(strip, by)`** (rev+1, `updatedAt = clock.now()`, `updatedBy`,
  touch) and **`insert(strip)`** (replica minting). Replace the 31 repeated blocks with `bump` **only where the four
  lines are exactly that sequence**, and keep the read of `clock.now()` where it was. Where a site reads `now` once and
  reuses it (`_applyCarrierTransfer`, create), keep it as it is and list it.
- `BoardAudit`: `recordAudit`, `recordPeer`, verbatim.
- `Placement`: the order keys (`_resolveOrderKey`, `_keyAfterRebalance`, `_rebalanceRack`, `_appendOrderKey`) and the
  Bays (`_placementRack`, `_roleBayFor`, `_validateBayImpliedTransition`, `_requireKnownBay`, `_bayFullRefusal`,
  `_bayForNewOwner`, `_relocateForImpliedState`, `_fieldStateView`, `_nlaCtx`). The facade's remaining methods call
  `this._placement.x(...)`.
- `strip-util.js`: `deepClone`, `newFlags`, `_validateAltitudeBlock`, `_frequencyFromBlockValue`. `_replayRecord` and
  `REPLAY_PERSIST_WINDOW_MS` stay in the facade (SYNC moves them).
- Collaborators read rules as `this._rules.X` (FREEZE guard 1 sees them). `tests/board-seam.test.mjs` must pass,
  strictly, for every file you create.

## Steps

0. Step 0 per README. Re-find every method above by symbol on your base (merge4 moved line numbers). List the private
   members tests and tools reach (`guard-board-surface.json`), and decide for each one: getter on the facade, moved
   (test updated), or kept.
1. Commit 0095.
2. `strip-util.js`, then `BoardState` + `bump`/`insert`, then `BoardAudit`, then `Placement`: one commit each, every
   one golden-identical, with both suites and soak:selfcheck green.
3. Retarget M3, M4 (now: drop the `touch` from `bump`, or from SetFlag's call) and M7. `npm run freeze:selfcheck`
   catches every mutation.
4. Update `guard-board-surface.json` for the private members that moved, listed.

## Acceptance

Golden identical (no `behaviour(...)` commit expected); both suites green; `soak:selfcheck` all detectors fire;
`freeze:selfcheck` all applied and caught; `board-seam` strict on `board/*`; `board-store.js` line count before → after
in the report.

## Defaults (P2)

- When a private member reached only by tests moves, update the test to reach it through the collaborator
  (`board._placement._bayForNewOwner`) rather than add a facade shim. Shims only for tools (`_touch`, `_log`,
  `_strips`, `_cidSeq`).
- When `bump` would change the order of a `clock.now()` read relative to other statements, do not use it there.
