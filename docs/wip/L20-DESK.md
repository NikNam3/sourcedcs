# L20-DESK wip

## Step 0 (base 277e65f)
- l20scan L20-DESK: sites 201 = 49 stale file ptr (mostly `*.test.js`, `ui.js`, `config.js` which is correct), 1 priv (`_initConnTab`), 9 board-store lines, vocab 142 (TWR/GND/APP 56, FDR 24, Role 23, held-Position 11, covering 11 (mostly the English word), claim 6, field state 5, signedOn 2, SQUAWK 1, seat 1, manned/occupancy 1, module.exports 1).
- SOURCE-DEFINED markers in the lane's Owns at base: 1 (`metrics-panel.js`) + `metrics-panel.test.mjs` = 2 files; count at base 6 lines overall (`git grep -c`).
- crc-desktop `npm test` at base: 883 tests, 881 pass, 0 fail, 2 todo.

## Code as found
- `.test.js` pointers: only 5 CommonJS tests remain `.test.js` (lxsrs-setup, packaging-config, patch-notes, run-sharded, server-proxy-routes); every other pointer is to a `.test.mjs`.
- `config.js` hits are the generated `/js/config.js` (correct, kept).

## Facts for L20-DOCS
- crc-desktop's local server (`app/server.js`) is Node `http`/`https`, not Express (verified at step 4).

## Defaults taken (P2)
- Finding (ESM-GUARDS): tools-panel.js uses _pressureAtAlt/ISA_L/ISA_INV/T_REF_ALT with no import (already the briefing's latent ReferenceError); header comment now says so.
