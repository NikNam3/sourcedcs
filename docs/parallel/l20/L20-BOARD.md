# L20-BOARD: comments in the Board facade and its collaborators

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 (parallel with the other eight wave-1 lanes; files disjoint) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-BOARD` on `lane/L20-BOARD` |
| Model / size | Sonnet 5.5 / S: 26 files, 1,496 comment lines, 7 stale `_method` pointers, 23 `board-store` lines, 102 vocab hits, 1 marker |
| Wip | `docs/wip/L20-BOARD.md` |
| ADR / E2E lane | none / none |

## Goal

Every comment in the Board's files describes the Board as it is after BOARD-1/2/3 and SYNC (ADR 0095 §2, H87 "facade
plus collaborators"): `BoardStore` is a facade that keeps the public API and delegates to Placement, StripOps,
Coordination, Tofi, the op table in `board/ops/`, persistence and audit; ops are module functions registered in
`board/ops/index.js`, not `_applyX` methods; the touch callback is the kernel's `recordTouch` (`observeTouches`),
not a facade `_touch`. Every comment uses the glossary's words. The L9/prep rows for these files are applied.

## Owns

`crc-sync/src/efsp/board-store.js`, `crc-sync/src/efsp/board/**` (`audit.js`, `board-state.js`, `coordination.js`,
`persistence.js`, `placement.js`, `strip-ops.js`, `strip-util.js`, `tofi.js`, `ops/*.js`). Comments only.
`docs/wip/L20-BOARD.md` and `docs/wip/L20-BOARD/**`.

## Frozen for you

Everything else, including `tests/**` (L20-SYNCTESTS), `efsp-ws.js` and `sync/**` (L20-WIRE), `tools/soak/**`
(L20-SYNCTOP), every golden and structure fixture. No code token, no string literal.

## Steps

0. **Step 0.** `(cd crc-sync && npm ci)`; baseline `cd crc-sync && nice npm test` (count into the wip). Copy the two
   tools from the README to your scratchpad; `python3 l20scan.py` (your column into the wip, "Counts at base");
   `python3 l20scan.py --sites L20-BOARD > docs/wip/L20-BOARD/sites-base.txt`; `git grep -c SOURCE-DEFINED -- <Owns>`.
   "Code as found": re-find each row below by its quoted text and write file:line. SendMessage "main" a one-paragraph
   step-0 note (the questioner reads it).
1. **Headers.** Read the header comment of every owned file in full and rewrite what is no longer true. Known:
   `board-store.js` (`FDRs` → flight data; "Phase 1 has at most ... four Positions" → present tense or delete; the list
   of what the facade does now, pointing at the collaborator files), `board/placement.js` (says host-core patches
   `_touch`; SYNC), `board/strip-ops.js` (`deps.touch`/`deps.droppedWallAt` JSDoc "the facade's Map"; SYNC),
   `board/coordination.js` and `board/tofi.js` constructor notes (`touch` is the kernel's `recordTouch`; SYNC).
   Commit.
2. **Pointers.** Every `board-store.js`/`BoardStore`/`_applyX`/`_dispatch`/`_isRejectedReplica`/
   `_rejectedReplicaOpRefusal`/`_nlaPrecheck`/`_applySetState`/`_apply*` mention: name the function and file that
   exist now (BOARD-3: "the moved files still name `_dispatch`, `_applyX` and `board-store.js`"). A pattern like
   "before any `_apply*` method runs" becomes "before any op in `board/ops/` runs". Commit.
3. **Rows.** D1 (`board-store.js` "Doctrinal decisions (block routing, Bay-implies-state, NLA, ..." → "Rule
   decisions"); D2 and D3 ("every doctrine check NLA enforces" → "every lifecycle check NLA enforces", now in
   `board/strip-ops.js` / `board/ops/*.js`); D4 ("genuinely separable in real operations (a MOA can stay hot ...)" →
   "separable in our model"); keep the L27 marker (`board-store.js` replay window, 10 min). Commit.
4. **Vocabulary.** Work through `sites-base.txt` vocab lines: FDR (43) → flight data; Strip Role (26) → strip type;
   TWR/GND/APP (21) → LC/GC/AP when they name a Position, unchanged inside a quoted identifier; covering (9) →
   consolidated at; "held/holds a Position" → signed on. Commit per file group.
5. **Close.** `node --check` every changed file; `node l20-codecheck.mjs <base>` must print `comment-only`; run
   `node --test tests/board-seam.test.mjs tests/clock-policy.test.mjs tests/required-rules.test.mjs`; then `nice npm
   test` once. Re-run `l20scan.py`, write "Counts at end" and the row table (row, before, after, commit) in the wip.
   Report (README rule 12).

## Acceptance

- `l20-codecheck.mjs <base>`: `comment-only: no code change`.
- L20-BOARD column: stale file and `_method` pointers 0; every `board-store mention` line verified (it names
  something `board-store.js` still has, or it was repointed); every vocab hit reworded or covered by one "kept
  sense" line in the wip.
- Rows D1-D4 and the SYNC/BOARD-3 items applied, each in the wip's row table. Marker count ≥ base.
- crc-sync `npm test` count identical before → after; the three scanner tests green.

## Defaults (P2)

- Where a header narrates history that a reader no longer needs ("Phase 1 ...", "WP4A added ..."), delete it rather
  than rewrite it; keep one "see ADR NNNN" pointer if the history explains a design choice.
- A comment that cites a method by the old private name of a now-public collaborator method uses the new name in
  backticks (`Placement#rebalanceRack`), the house form for a method of a class.
- If a comment can only be made true by a code change, leave the comment's claim out (say less) and record a
  finding.
