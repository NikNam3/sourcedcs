# ESM-2b: split `efsp-panel.js` by feature

> Read `README.md` and `ESM-2a.md` (the same pattern) in this folder first. Ruling: H87. Plan:
> `docs/wip/ARCH-plan.md` §1.5, §2.9.

| | |
|---|---|
| Wave | W3, after the ESM-1 unit merged; beside ESM-2a, CMSG and the server lanes |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-ESM-2b` on `lane/ESM-2b-efsp-panel-split` |
| ADR / E2E | none (0095) / `E2E_LANE=3` |
| Size / model | 0.75 lane / Sonnet 5.5 |

## Goal

`js/panels/efsp/efsp-panel.js` (about 1,598 lines, 95 top-level names) keeps the panel's init and mount. Its features
move verbatim into `js/panels/efsp/panel/`. `efsp-panel.js` re-exports every name it exports today, so its importers
(`dock.js`, `app.js`, `strip-view.js` and the rest) stay untouched. Behaviour is identical.

## Owns

`crc-desktop/app/public/js/panels/efsp/efsp-panel.js`, new `js/panels/efsp/panel/**`, the efsp-panel-specific unit
tests (import paths only), `crc-desktop/tests/fixtures/module-graph-exports.json` (structure fixture, shared with
ESM-2a: each lane edits only its own files' entries, and the supervisor merges the JSON), `docs/wip/ESM-2b.md`.

## Frozen for you

`bay-view.js` and `bay/**` (ESM-2a), `app.js`, `efsp-ws.js` and the registration lines (CMSG), all of crc-sync.

## Steps

0. Step 0 per README: cluster the file by feature (creation and origins, search and filters, tabs, the board-wide
   indications, the import action, the callsign helpers, and whatever else you find), with the names each cluster
   exports and reads.
1. One cluster per commit, the module-graph test and crc-desktop `npm test` green after each.
2. The `_callsignOfFdr` decision from ESM-1 (queue item 3) is not yours. Keep whatever ESM-1 left, and keep its comment.

## Acceptance

crc-desktop `npm test` green and the same count; crc-sync green; full Playwright on `E2E_LANE=3` with the same pass
set as base; `efsp-panel.js` line count before → after.
