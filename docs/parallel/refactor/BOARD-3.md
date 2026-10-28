# BOARD-3: StripOps, the op table, NLA and retirement

> Read `README.md` and `BOARD-1.md` (the pattern) in this folder first. Rulings: H87 / R3-8, S3-2 (the authority
> registry, built by AUTH). Plan: `docs/wip/ARCH-plan.md` §1.1, §2.3, §2.4.

| | |
|---|---|
| Wave | W4, after BOARD-2 and AUTH merged; beside LOG-2 and TIME-B. Merges first in W4 |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-BOARD-3` on `lane/BOARD-3-strip-ops` |
| ADR | none (0095) |
| Size / model | 1.25 lanes / Sonnet 5.5 |

## Goal

`_dispatch`'s switch becomes a table of op modules (`board/ops/<op>.js`: `{kind, authorize?, apply(ctx, strip, op,
meta), auditFields?}`) owned by the `StripOps` collaborator. NLA (precheck, rejected-replica rules, `nlaStatusFor`,
InvokeNla, Undo) and retirement (Drop, `_retireStrip`, `_releaseFdrIfLastStrip`) move into `StripOps` too; the NLA⇄ops
knot stays inside one collaborator. The per-Role tables in the facade are replaced by reads from the authority
registry. The facade keeps `applyMutation`, `nlaStatusFor`, `reassignPositionStrips`, `returnCoveredStrips` and
`setAirborneObserver` as delegations. Output is golden-identical.

## Owns

`crc-sync/src/efsp/board-store.js` (ops, NLA, retirement, dispatch, the Position lifecycle, the per-Role constants),
new `src/efsp/board/strip-ops.js` and `src/efsp/board/ops/**`, `tests/freeze/selfcheck/{M1,M2,M6,M15}.mjs`, unit tests
that reach a private member you moved, `guard-board-surface.json` (structure fixture), and the one `console` call in
`board-store.js` (convert it to LOG-1's logger), `docs/wip/BOARD-3.md`.

## Frozen for you

`board/{coordination,tofi}.js` (BOARD-2's: replace their `retire` callback with `ops.retire` only if that is a one-line
change in their constructor wiring inside the facade), `board/{board-state,audit,placement,strip-util}.js` (call their
methods; ask before adding one), `authority/**` (read only), the kernel, idempotency and persistence regions of
`board-store.js` (SYNC, W5), every file outside the Board.

## Design

- `_recordAudit`'s per-op extras become each op's `auditFields(result)`, emitting **the same keys in the same order**
  (the audit lines are in the goldens).
- The authorization special cases before `canMutate` (CarrierTransfer, SfaRotation, the observed-departure bypass in
  merge4's gated SetState) become each op's `authorize`.
- `DEFAULT_INITIAL_STATE_BY_ROLE`, `REPLICA_STATE_ON_RECEIPT` and `SENDER_STATE_ON_ACCEPT` are read from AUTH's role
  families. Default: the facade requires `authority/index.js` and passes the accessors to `StripOps`, `Coordination` and
  `Tofi` in their constructors, so collaborators stay dependency-injected. The seam test does allow a collaborator
  to require `authority/` (it is not a sibling), but prefer injection and say which you chose.
- **Optional last step, only if it is golden-identical:** `_applyCarrierTransfer` and `_applySfaRotation` become one
  role-change transfer over a table, with each row keeping its audit keys (`carrierTransfer`/`carrierTrigger`,
  `sfaTransfer`/`sfaTrigger`) and refusal wording. Skip it if any golden moves.

## Steps

0. Step 0 per README: every op kind and its `_apply*` method, each op's audit extras, the authorization special cases,
   NLA's callers and callees, and the private members tests reach (`_retireStrip`, `_nlaHistory`, …).
1. `StripOps` with the dispatch table, ops moved one or two per commit, golden identical, soak:selfcheck green.
2. NLA and Undo, then retirement.
3. The per-Role constants from the registry.
4. Retarget M1, M2, M6 and M15.

## Acceptance

Golden identical; both suites green; `soak:selfcheck` all fire; `freeze:selfcheck` all caught; `board-seam` strict on
every `board/` file; `board-store.js` line count before → after (expected: a facade of a few hundred lines, plus the
kernel and persistence regions SYNC takes).
