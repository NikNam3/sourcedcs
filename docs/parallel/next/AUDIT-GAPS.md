# AUDIT-GAPS: the audit and authority loose ends the refactor lanes reported

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**) and
> `docs/parallel/lane-rules.md` first. Rulings: ADR **0083** and decisions.md **S-L26** (one outcome, one audit entry;
> stores log what reaches them, and the metrics tap logs pre-store refusals with `unaudited: true`), ADR **0095** and
> S-M-AUTH (the authority registry is the one home of "who may"), H88 (doctrine stays in code, in the registry), the
> findings of **WIRE** (`docs/wip/WIRE.md` F1), **AUTH** (`docs/wip/AUTH.md` "Findings / follow-ups"), **BOARD-2**
> (`docs/wip/BOARD-2.md` "Defaults taken", "Findings"), **L20-BOARD** (`docs/wip/L20-BOARD.md` "Findings"), and
> **U18** (`docs/wip/L20-prep-inventory.md`, row U18 and C-8 b). Vocabulary: `docs/glossary.md`.

| | |
|---|---|
| Wave | A. **Merges first in wave A**, before UNDO-S, and before CR-S and TOFI-REGIME start, because it edits `board/coordination.js`, `board/tofi.js` and `board-store.js`, which those lanes own next |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-AUDIT-GAPS` on `lane/AUDIT-GAPS-loose-ends` |
| ADR | none. F1 applies ADR 0083's rule to two families that missed it; the registry moves are ADR 0095's |
| Size / model | 0.75 lane / Sonnet 5.5 |
| E2E lane | none (server-only) |

## Items (re-find each by symbol at step 0; line numbers from `99c9577`)

1. **WIRE F1: carrier and SFA gate refusals are not marked unaudited.** `wire/families/carrier.js` ~24 and
   `wire/families/sfa.js` ~23 set `unauditedGates: false`, so the skeleton (`wire/skeleton.js` ~73) does not mark
   their gate refusals (NOT_SIGNED_ON / no store, under their current names). The metrics tap (`metrics.js`
   ~916-925) therefore never logs them, unlike the other four mutation families.
   - Remove the flag from both families. Then remove the option from the skeleton if no family sets it any more.
   - Turn `tests/wire-skeleton.test.mjs`'s `test.todo` (~38) into a test: each of the six families' gate refusal is
     logged once with `unaudited: true`.
   - Check that the tap's subject keys (`stripId`, `airspaceId`, `flightDataId`, `marsaId`) say *what* a carrier or SFA
     refusal concerns. If an entry would carry no subject, adding the key is a one-line edit in `metrics.js`, which
     UNDO-S and 2S-A also edit: ask "main" first.
   - This is a `behaviour(AUDIT-GAPS)` commit: the Mutation log gains entries.
2. **AUTH finding: store-local authority checks outside the registry.**
   - `runway-status-store.js`:
     - the inspection authority narrowing (~386-388, `inventory.inspectionAuthorityPositionId`, "only X may sign off a
       runway inspection here");
     - the self-coordination check (~458-474, the frozen acknowledger set, "a self-coordinated runway change needs you
       Primary at …");
     - `permission.canActOnRunwayStatus` (~256) already goes through the registry.
   - `sfa-store.js` ~120 `canRotateSfa(acting) && acting === this._config.jurisdiction` (jurisdiction narrowing).
   - Target: the rule moves into the registry as named predicates exported by `authority/index.js`, implemented in a
     **new** `authority/narrowing.js`, for example `mayCompleteRunwayInspection(actingPositionId, inventory)`,
     `selfCoordinationGaps(actingSession, acknowledgers, …)` and `holdsSfaJurisdiction(actingPositionId, sfaConfig)`.
     Name them as you see fit.
   - The **data** (who the authority is) stays in the facility JSON, and the stores call the predicates.
   - Refusal reasons and detail texts stay byte-identical.
   - **Exclude the airspace store's `_isControlling`/`_isUsing`: AIRSP-2S-A owns them** (its briefing closes that
     finding). `carrier-store.js` already calls permission predicates and needs no change (AUTH).
   - Do not edit `authority/positions/*.js`: 2S-A adds airspace rows there in this wave, and CR-S/TOFI-REGIME edit them
     next.
3. **BOARD-2 duplication** (`docs/wip/BOARD-2.md`):
   - the receiver-replica mint (random id, Rack tail, orderKey, base Strip shape) repeated in
     `board/coordination.js` `receiveCoordinationProposal` (~382) and `board/tofi.js` `receiveTofiProposal` (~412);
   - the track-degradation soft interlock, three times (`coordination.js` ~133-141, `tofi.js` ~128-137 and
     ~170-173), with the detail text "track degradation (…) forces verbal coordination — a note is required".
   - Target: one helper each (`board/strip-util.js` or a new `board/replica.js`; BOARD-1's seam rule 1 lets every
     `board/` file require `strip-util.js`). Byte-identical refusals and Strips.
   - `refactor(AUDIT-GAPS)`. Prove it with `npm run freeze` once (opt-in, but it is the cheapest identity proof here).
     Report "identical", or the moved traces.
4. **System audit entries written inline → `BoardAudit`.** Inline `_mutationLog.record` calls:
   - `board/coordination.js` ~325 `SystemCoordinationEnd` (PeerGone);
   - `board-store.js` ~313 and ~348, `SystemReassign` ×2 (`position-vacated`, `position-retaken`);
   - `board/persistence.js` ~78 `Archive`.
   - Route them through one `BoardAudit` method (`recordSystem(op, fields)` in `board/audit.js`, beside `recordPeer`
     and `recordAudit`) **only where the JSONL output stays byte-identical**. The key order differs between the
     sites: `Archive` writes `flightDataId` before `facilityId`, and the `SystemReassign`s write `facilityId` first.
     So the method takes an ordered field list, or the sites keep their order explicitly.
   - Prove identity with `npm run freeze` (the goldens record Mutation-log entries) and a direct unit test that
     compares the JSONL line before and after for each site.
   - A site you cannot route without changing bytes stays inline: list it.
   - The other stores' inline `record` calls (`archiver.js`, `airspace-store.js`, `carrier-store.js`,
     `correlation-store.js`, `sfa-store.js`, `runway-status-store.js`, `marsa-store.js`, `index.js`, `metrics.js`,
     `wire/families/ato.js`) are **not** Board entries and not in scope.
5. **Code locals named `covering` (L20-BOARD finding).** Rename them to the glossary word (`consolidatedAt`, or
   `consolidationPositionId`, matching `ctx.rules.consolidatedAt`):
   - `board/ops/transfer-strip.js` ~42-47;
   - `board/ops/carrier-handoff.js` ~44-47;
   - `efsp-ws.js` ~274-278 (`SetPositions`' consolidation path; only those lines: UNDO-S edits the Board path of the
     same file).
   - Wire keys (`routedTo`) do not change. Check for test locals under `crc-sync/tests` while you are there. L20-STR
     did most of them, so list any that remain.
6. **U18: the stronger test.** `efsp/correlation-reconciler.js` ~44-60 `INELIGIBLE_STATES` is an exclusion list, and its
   comment admits that the test (`tests/efsp-correlation-reconciler.test.mjs` ~84 "every EfspState is either on the
   ineligible list or eligible") checks only that listed states are real.
   - Make the test pin the **complete** classification: an explicit `ELIGIBLE` set in the test plus the module's
     ineligible set must equal the union of `STATES_BY_STRIP_TYPE`'s states (from the authority registry). A new
     state fails until someone puts it on one side.
   - Then reword the module's comment to what is now tested (comment only, L20 rule 2).
   - It is a test change, so say it in the report (L20-prep U18: "a code change, so say so").

## Owns

- `crc-sync/src/efsp/wire/families/{carrier,sfa}.js` (the flag), and `wire/skeleton.js` (the option, if it is removed).
- `src/efsp/runway-status-store.js` and `src/efsp/sfa-store.js` (the call sites only).
- New `src/efsp/authority/narrowing.js`, plus its export lines in `authority/index.js`.
- `src/efsp/board/coordination.js` and `board/tofi.js` (the mint and degradation sites, and PeerGone's record).
- `src/efsp/board-store.js` (the two `SystemReassign` record blocks), `board/persistence.js` (Archive's record),
  `board/audit.js` (`recordSystem`), `board/strip-util.js` or new `board/replica.js`.
- `board/ops/{transfer-strip,carrier-handoff}.js` (the locals), `efsp-ws.js` ~274-278.
- `correlation-reconciler.js` (comment only).
- Tests: `tests/wire-skeleton.test.mjs`, `tests/efsp-correlation-reconciler.test.mjs`, new `tests/authority-narrowing.test.mjs`
  and `tests/board-system-audit.test.mjs`, and the touched stores' tests.
- `crc-sync/tests/freeze/golden/guard-board-surface.json` (a structure fixture; list the change), only if
  `recordSystem` or the replica helper changes the private surface.
- `docs/wip/AUDIT-GAPS.md`.

## Frozen for you

- `airspace-store.js` and `authority/positions/*.js` (AIRSP-2S-A).
- `efsp/metrics.js` (UNDO-S, 2S-A; ask before a one-line subject key).
- The `undo` declarations and `strip-ops.js` (UNDO-S).
- Everything client-side.
- The wire shape: no new keys and no renamed `routedTo`.

## Steps

0. Step 0 per the refactor README: every site above re-found by symbol; the four inline records with their exact key
   order; the predicates' callers; the families' gate paths. Run `npm run freeze` once at base, so you have a
   comparison point.
1. Item 5 (locals) and item 6 (U18): small, and both first.
2. Item 3 (duplication) and item 4 (`recordSystem`) as `refactor(AUDIT-GAPS)`. `npm run freeze` identical after each.
3. Item 2 (narrowing predicates) as `refactor(AUDIT-GAPS)`, with identical refusal texts.
4. Item 1 (F1) as `behaviour(AUDIT-GAPS)`: the new log entries, listed in the commit.
5. Both unit suites once, `soak:selfcheck` once (`board-store.js`, `board/**`, `efsp-ws.js` and `wire/**` are on its
   trigger list).

## Acceptance

- The `test.todo` is gone and passing.
- No authority narrowing is left in `runway-status-store.js` or `sfa-store.js` (grep the refusal texts: they come from
  the registry predicate's result).
- One replica mint and one degradation check.
- The four Board system records go through `BoardAudit`, or are listed as kept with the reason.
- No `covering` code identifier in `crc-sync/src`.
- The reconciler test fails on a scratch state added to a strip type (show it).
- Freeze identical for every refactor commit. Both suites and `soak:selfcheck` pass.

## Defaults (P2)

- When key order cannot be kept through one method, the site stays inline (identity wins over tidiness).
- The narrowing predicates take plain values (Position id, the inventory slice), never a store.
