# BOARD-2: the Coordination and Tofi collaborators

> Read `README.md` and `BOARD-1.md` (the pattern you follow) in this folder first. Ruling: H87 / R3-8. Plan:
> `docs/wip/ARCH-plan.md` §1.1, §2.3.

| | |
|---|---|
| Wave | W3, beside AUTH, DATA-1, DATA-2, LOG-1, CMSG, ESM-2a, ESM-2b |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-BOARD-2` on `lane/BOARD-2-protocols` |
| ADR | none (0095) |
| Size / model | 1 lane / Sonnet 5.5 |

## Goal

Cross-Facility coordination (5 primitives × PROPOSE/ACCEPT/REJECT/STAND_BY/CANCEL and four `receiveCoordination*`) and
TOFI (ENTRY/EXIT, ACCEPT/REJECT, TRANSFER_COMMS and three `receiveTofi*`) move verbatim into `board/coordination.js`
and `board/tofi.js`. The facade's `receive*` methods delegate. Output is golden-identical.

## Owns

`crc-sync/src/efsp/board-store.js` (the coordination and TOFI clusters, their dispatch lines and the `receive*`
delegations), new `src/efsp/board/{coordination,tofi}.js`, unit tests that reach a private member you moved,
`guard-board-surface.json` (structure fixture), `docs/wip/BOARD-2.md`.

## Frozen for you

`board/{board-state,audit,placement,strip-util}.js` (BOARD-1's; call their public methods, and if you need a new one,
ask "main"), `coordination.js`, `permission.js`, `nla.js` (AUTH is reshaping them right now: read their current
exports, never edit them), every file outside `board-store.js`/`board/`.

## Design

- `new Coordination({ state, audit, placement, rules, clock, fdrStore, touch, activeCmid, retire })` and the same for
  `Tofi`. `retire` is a late-bound callback into the facade (`(strip, by) => this._retireStrip(strip, by)`), because
  retirement moves to StripOps only in BOARD-3. Any other facade method you need comes in the same way, as a named
  callback listed in the wip file. Never pass the facade itself.
- A peer Board is reached through `rules.peerBoard(facilityId)`, which returns the peer **facade**. Call its public
  `receive*` methods only, as today.
- Replica minting uses `state.insert(strip)`, and every rev/updatedAt/touch uses `state.bump` or the `touch` callback.
  The per-Role tables `REPLICA_STATE_ON_RECEIPT` and `SENDER_STATE_ON_ACCEPT` stay in the facade, passed in as values
  (BOARD-3 replaces them with registry reads).

## Steps

0. Step 0 per README. List every method of the two clusters (re-found by symbol), every kernel or facade member each one
   touches, and every test that reaches into them.
1. Coordination: one commit, golden identical, soak:selfcheck green.
2. Tofi: one commit, the same gates.
3. If BOARD-1's retargeted mutations or any other mutation targets code you moved, retarget it.

## Acceptance

Golden identical; both suites green; `soak:selfcheck` all fire; `freeze:selfcheck` all caught; `board-seam` strict on
your two files; `board-store.js` line count before → after.

## Defaults (P2)

- When a coordination path and a TOFI path share a helper, the helper goes to `board/strip-util.js` only if it is pure.
  Otherwise each keeps its own copy, and you list the duplication for BOARD-3.
