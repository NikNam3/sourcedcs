# ESM-2a: split `bay-view.js` by feature

> Read `README.md` in this folder first. Rulings: R3-32 (bay-view is a first-pass god file), H87 ("split
> bay-view.js / efsp-panel.js by feature as part of" the module move). Plan: `docs/wip/ARCH-plan.md` §1.5, §2.9.

| | |
|---|---|
| Wave | W3, after the ESM-1 unit merged; beside ESM-2b, CMSG and the server lanes |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-ESM-2a` on `lane/ESM-2a-bay-view-split` |
| ADR / E2E | none (0095) / `E2E_LANE=2` |
| Size / model | 1 lane / Sonnet 5.5 |

## Goal

`js/panels/efsp/bay-view.js` (about 3,070 lines, 39% comments) keeps selection, dispatch and Bay/Rack
render-and-reconcile. Its features move verbatim into `js/panels/efsp/bay/`. **`bay-view.js` re-exports every name it
exports today**, so `strip-view.js` and every other importer stays untouched. Behaviour is identical.

## Owns

`crc-desktop/app/public/js/panels/efsp/bay-view.js`, new `js/panels/efsp/bay/**`, the bay-view-specific unit tests
and the import path of the six authority tables in the PARITY tests (import paths only), your files' entries in
`crc-desktop/tests/fixtures/module-graph-exports.json` (structure fixture: new files appear, and `bay-view.js`'s
export set must not shrink; the supervisor merges the JSON with ESM-2b's and CMSG's), `docs/wip/ESM-2a.md`.

## Frozen for you

Every other client file (CMSG owns `app.js`, `efsp-ws.js` and the panel registration lines; ESM-2b owns `efsp-panel.js`),
all of crc-sync.

## Target files (from the measured clusters; re-measure at step 0)

`bay/selection.js` (selection state, refusal seeding, advance swallow), `bay/block-edit.js` (block cells, inline
editing), `bay/strip-element.js` (drop arming, annotation chips, expanded view, `_buildStripEl`),
`bay/popover-portal.js`, `bay/popovers/{bind,marsa,coordination,tofi,airspace-entry,highlight}.js`, `bay/drag.js`
(pointer-events drag, autoscroll), `bay/ops-cards.js` (OPS filed-plan cards), and the hand-copied authority tables
(`COORDINATION_TARGETS`, `TOFI_COUNTERPARTS`, `HAND_BACK_TO`, `TOFI_ANSWERED_BY`, `AIRSPACE_ENTRY_POSITIONS`,
`CONVERT_TO_ARRIVAL_POSITIONS`) in `bay/authority-mirror.js`, where the PARITY tests point (ARCH-D7: hand copies stay).

## Steps

0. Step 0 per README: the cluster map with line ranges, the names each cluster exports and reads, and every PARITY or
   unit test that reads `bay-view.js` source text or names.
1. One cluster per commit, the module-graph test green after each, crc-desktop `npm test` green after each.
2. Point the PARITY tests at `bay/authority-mirror.js` (they read the same tables, so the assertions do not change).

## Acceptance

crc-desktop `npm test` green and the same count; crc-sync `npm test` green; full Playwright on `E2E_LANE=2` with the
same pass set as base; `bay-view.js` line count before → after (target: under about 700); no cycle between `bay/*`
files that reads a binding at top level (the module-graph test).

## Defaults (P2)

- When a helper is used by two clusters, it goes to the lower-level file (portal or strip element), never back into
  `bay-view.js`.
