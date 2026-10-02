# L20-CLIENT: comments in the EFSP client (`panels/efsp/**`)

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 (start it first: one of the two large lanes) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-CLIENT` on `lane/L20-CLIENT` |
| Model / size | Sonnet 5.5 / L: 54 files, 4,151 comment lines, 35 stale pointers (30 `.test.js` names, 5 `_method`), 27 `board-store` lines, 139 vocab hits (TWR/GND/APP 47, FDR 32, Strip Role 32), 26 markers, 14 rows |
| Wip | `docs/wip/L20-CLIENT.md` |
| ADR / E2E lane | none / none (comments only: no Playwright) |

## Goal

The EFSP client's comments describe native ES modules (H87, ADR 0095 §6: imports and exports, no `module.exports`
guard, no "loaded after X" script order), name the current server files they mirror (`authority/**`, `board/**`,
`runway-status.js`, ...), name the current test files (`*.test.mjs`), use the glossary's words, and carry the L9/prep
markers for the client mirrors.

## Owns

`crc-desktop/app/public/js/panels/efsp/**` (including `bay/**`, `bay/popovers/**`, `panel/**`). Comments only.
`docs/wip/L20-CLIENT.md`, `docs/wip/L20-CLIENT/**`.

## Frozen for you

Every other file (the rest of `public/**` and the tests are L20-DESK's); every string, including validation and banner
texts (L20-STR) and the always-true `typeof` guards (ESM-GUARDS, wave 3: do not remove them, and do not add comments
explaining them, the lane deletes them).

## Steps

0. **Step 0** as in the README (`(cd crc-desktop && npm ci) && (cd crc-desktop/app && npm ci)`, baseline `cd
   crc-desktop && nice npm test`, tools, counts, `--sites L20-CLIENT`, markers, "Code as found", step-0 note). Read the
   Mirror lines that L20-WIRE/DOMAINS/CORE write to their wips as they appear (`git -C <their worktree> show
   HEAD:docs/wip/L20-<X>.md`) and match their meaning.
1. **ES-module headers (ESM-1 finding).** Headers that describe the removed `module.exports` guard or the classic
   script order: `efsp-state.js`, `carrier-state.js`, `runway-status-rules.js`, `sfa-state.js`, `strip-view.js:18`
   ("Loaded after bay-view.js"), and any "every script here shares one global" (`ordnance-advisory.js:13`, the `_ord`
   prefix: say why the prefix stays, or that it is history). Commit.
2. **Pointers.** The 30 `*.test.js` names → the actual file (`ls crc-desktop/tests`; five CommonJS tests keep `.test.js`);
   `board-store.js's _rejectedReplicaOpRefusal`/`_isRejectedReplica` (`bay/popovers/coordination.js`),
   `board-store.js's _applyInvokeNla/_validateBayImpliedTransition` (`efsp-nla.js:102`), `permission.js`/`nla.js`
   names where the table now lives in `authority/**`, `squawk-panel.js` (gone: `efsp-panel.js:42`,
   `panel/create-strip.js:15`), `board.js`/`view.js` (`efsp-state.js:450`, `strip-template.js:19`),
   `_refreshStereoRoutes` (`panel/create-strip.js:43`), every `board-store` line. Commit.
3. **Rows.** C14 and C15 (`efsp-nla.js` per-State and MISSION authority mirrors: markers as in the L9 rows, matching
   L20-WIRE's C13/C16 wording), D2's client half (`efsp-panel.js` "it'd skip a doctrine check" → "lifecycle check": if
   it is a string, it is L20-STR's; record which), D6 (`bay-view.js` "small doctrinal tables" → "small rule tables"),
   U7 (`efsp-metrics-client.js` constants: one `// [SOURCE-DEFINED] (docs/adr/0072)` above the frozen object for
   `TTF_CAP_MS`, "the rest are engineering bounds"), U10 (`final-panel.js` `FINAL_PROMPT_HOLD_S = 4`: marker), U17
   (`marsa-badge.js:88` "fire-and-forget alert, which cannot retract": stale since L7), C-1 (`bay-view.js`
   `HIGHLIGHT_SWATCHES`: "costs 2 inputs against §7.3's ceiling of 1; accepted for now (S-L15), one-input entry
   points are a later UI lane"; the same note at `efsp-metrics-client.js` `GESTURE_INPUT_COST`), C-10 (the button
   label set in `runway-status-rules.js`: marker; Mirror from L20-DOMAINS), C-13 (the comment above the
   owners-table fallback in `runway-status-rules.js` says it is a fallback for a record without
   `runwayChangeAcknowledgers`/`inspectionAuthorityPositionId`; removing it is a UI lane's). Keep every existing
   L2/L13/L16/L18/L22 marker. Commit.
4. **Vocabulary.** TWR/GND/APP → LC/GC/AP (Position meaning), FDR → flight data, Strip Role → strip type, "held"/
   "covering" → signed on / consolidated at, "field state" → runway status, SQUAWK label → BEACON. Commit per
   sub-directory.
5. **Close.** `node --check` (they are ES modules: `node --check` accepts them by the `package.json` `type` in
   `public/js`); codecheck `comment-only`; `node --test tests/module-graph.test.mjs
   tests/overflight-shared-state-names.test.mjs tests/client-mirror-parity.test.mjs tests/efsp-block-map-parity.test.mjs
   tests/bay-descriptor-parity.test.mjs`; `nice npm test` once. Counts, row table, Mirror lines, report.

## Acceptance

- codecheck `comment-only`; crc-desktop `npm test` identical before → after; no Playwright run.
- L20-CLIENT column: stale pointers 0 (or listed); 27 `board-store` lines verified; `module.exports` mentions 0;
  vocab reworded or covered by kept-sense lines; markers ≥ 26 and rising (C14, C15, U7, U10, C-10).
- Every Mirror line from the server lanes answered in your wip ("matched" or "not applicable, because").

## Defaults (P2)

- When a client comment says "mirrors X verbatim (drift test Y)", keep that sentence and fix X and Y's names; it is the
  most useful line in a mirror file.
- If a server lane has not finished its Mirror line when you reach the row, write the marker with the ADR from the
  L9 row and note "check against L20-<X>" for the supervisor.
