# L20-BOARD wip

Branch `lane/L20-BOARD`, base 277e65f. Gate: `l20-codecheck.mjs 277e65f` -> `comment-only: no code change`.

## Counts at base -> end (l20scan, L20-BOARD column)
| metric | base | end |
|---|---|---|
| comment lines | 1496 | 1501 |
| stale file ptr / stale _method ptr | 0 / 7 | 0 / 0 |
| board-store mention | 23 | 18 (all verified: `BoardStore` still exists; names the class or board-store.js as the facade) |
| vocab total | 102 | 4 (kept senses below) |
| SOURCE-DEFINED | 1 (board/board-state.js, L27 replay-window marker area) | 1 |

Tests: crc-sync 2118 tests before and after; 1 failure each run, a different timing test each time (`ato tokenize: pathological inputs finish fast`, then a gRPC retry-delay test), under `nice` load: pre-existing flakes, not from this lane. board-seam, clock-policy, required-rules 12/12. crc-desktop 883 / 881 pass / 0 fail.

## Code as found
board-store.js header (FDRs, "Phase 1 ... four Positions", "Doctrinal decisions"); placement.js:5-9 (`_touch`); strip-ops.js:26,55,28-29 (deps JSDoc); coordination.js:19 and tofi.js:20 (`touch`); placement.js:200 (`_apply*`); strip-ops.js `_rejectedReplicaOpRefusal`/`_isRejectedReplica`/`_applySetState`; tofi.js:92 `_nlaPrecheck`; coordination.js:426 `_isRejectedReplica`; set-state.js:14 `_applySetState`.

## Row table
| row | before | after | commit |
|---|---|---|---|
| D1 board-store "Doctrinal decisions" | present | "Rule decisions" | 2nd |
| D2/D3 "doctrine check NLA enforces" | placement.js, ops/transfer-strip.js | "lifecycle check" | 2nd |
| D4 tofi.js "genuinely separable in real operations" | present | "separable in our model" | 2nd |
| SYNC (placement `_touch`; strip-ops deps JSDoc; coordination/tofi `touch`) | stale | kernel's `recordTouch`; Maps named by owner (BoardPersistence owns droppedWallAt) | 2nd |
| BOARD-3 (`_dispatch`, `_nlaPrecheck`, `_isRejectedReplica`, `_rejectedReplicaOpRefusal`, `_rejectedReplicaRefusal`, `_applySetState`, `_apply*`) | old private names | `StripOps#dispatch` etc.; "any op in board/ops/" | 2nd |
| board-store header | FDRs, Phase 1 | lists the collaborators, present tense | 2nd |
| L27 marker | 1 | kept (1) | - |
| vocab (FDR 42, Role 23, TWR/GND/APP 16, covering 8) | | reworded | 1st, 2nd |

Also: `_applyX` mentions of an op in another file now name its file (`board/ops/invoke-nla.js's _applyInvokeNla`; those functions still exist as module-local functions). "WP4A"/"Phase 1/2" narration dropped where it was only history; coordination.js:47 quote of the guide replaced by a paraphrase (the quoted sentence is not in the current guide, rule 4).

## Kept senses (vocab)
- "claim" (3): beacon code re-claim (allocator), "the client's flag is a claim" (not a Position/JWT).
- "covering" (1): an interlock covering a Block (set-block.js).
- `carrier-handoff.js`/`transfer-strip.js` local variable `covering` is code, untouched (Findings).

## Findings
- Code locals `covering` in ops/transfer-strip.js and ops/carrier-handoff.js are old vocabulary (owner: a later code lane).
- ops/*.js keep module-local `_applyX` names, and coordination.js/tofi.js keep `_applyCoordination*`/`_applyTofi*` methods: the old `_` convention survives in code (owner: none needed).
- Comments still cite WP6/WP7/Phase-2 work-package ids in a few places (history, kept where an ADR is cited).

## ADR errata
none. Mirror lines: none.
