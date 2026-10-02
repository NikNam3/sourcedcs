# L20-SYNCTESTS wip

Report: branch lane/L20-SYNCTESTS, base 277e65f. Comment-only (codecheck: "comment-only: no code change").
Counts (scan, my column): stale file ptrs 7 -> 3 (all valid: board-seam fixture string `drop.js`, `/js/config.js` is server-generated, glob `test.mjs`); _method ptrs 17 -> 2 (`_hidden` fixture string, `_buildAllRadars` kept as history); board-store lines 30 -> 19 (the rest are the facade's own name, verified); vocab 280 -> 24 (kept: claim 9, station 2, covering 5 not-Position senses, quotes). SOURCE-DEFINED 9 lines unchanged (8 scan count).
Tests: crc-sync 2117/2118 pass (1 todo) both before and after; crc-desktop 881/883 pass, 0 fail.

## Pointer fixes
validateBayImpliedTransition -> board/placement.js; nlaPrecheck, isRejectedReplica -> board/strip-ops.js; resolveOrderKey -> board/placement.js; stampStrip -> wire/frames.js; _handleMarsaMutation -> wire/families/marsa.js; _applyCoordinationPropose -> board/coordination.js; `_applyInvokeNla` guard -> board/ops/invoke-nla.js; tofiEligibleState guard -> board/tofi.js; canMutate -> board/strip-ops.js; efsp-time-chains.test.js -> .mjs; los-math.test.js -> .mjs; board-store.test.mjs -> efsp-board-store.test.mjs.

## Findings (not mine)
- Test titles still carrying old words (TWR/GND/APP, Strip Role, FDR, covering, "transfer-shaped"): for L20-STR; e.g. efsp-board-store.test.mjs:570 names `_applyTransferStrip`, efsp-marsa-store.test.mjs:409 "for board-store to drain".
- Not converted on purpose: single-quoted/double-quoted text, backtick names, freeze-lib.mjs:42 format example `@APP`.
## Mirror / ADR errata
none
