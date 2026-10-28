# L20-WIRE: comments in the wire families, sync, authority, efsp-ws and permission

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-WIRE` on `lane/L20-WIRE` |
| Model / size | Sonnet 5.5 / M: 33 files, 1,515 comment lines, 6 stale pointers, 37 `board-store` lines, 184 vocab hits (TWR/GND/APP 87, Strip Role 61), 15 markers, 10 rows |
| Wip | `docs/wip/L20-WIRE.md` |
| ADR / E2E lane | none / none |

## Goal

The comments of the server's edge and rule tables describe the post-refactor layout: one file per wire family
(`wire/families/*.js`, `wire/skeleton.js`, `wire/frames.js`, `wire/slots.js`), the sync kernel (`sync/sync-log.js`,
`sync/replay-cache.js`), the authority registry (`authority/index.js`, `classes.js`, `op-kinds.js`, `primitives.js`,
`positions/*.js`, `strip-types/*.js`), and what remains in `efsp-ws.js`, `permission.js`, `nla.js`,
`required-rules.js`. The permission header stops describing Phase 1. The L9 marker rows for these files are applied.

## Owns

`crc-sync/src/efsp/wire/**`, `crc-sync/src/efsp/sync/**`, `crc-sync/src/efsp/authority/**`,
`crc-sync/src/efsp/efsp-ws.js`, `permission.js`, `nla.js`, `required-rules.js`. Comments only. `docs/wip/L20-WIRE.md`,
`docs/wip/L20-WIRE/**`.

## Frozen for you

Everything else. In particular the client mirrors (`efsp-nla.js`, `bay/authority-mirror.js`, `sfa-state.js`: L20-CLIENT)
and every string, including refusal `detail`s and log messages (L20-STR).

## Steps

0. **Step 0** as in the README: `(cd crc-sync && npm ci)`, baseline `nice npm test`, tools, counts, `--sites L20-WIRE >
   docs/wip/L20-WIRE/sites-base.txt`, marker count, "Code as found" for every row, step-0 note to "main".
1. **Headers.** `permission.js` (C-7): its header still says "Phase 1 had only Military ATC-class Positions (OPS, CD,
   GND, TWR) ... HANDOFF/POINT_OUT/TOFI aren't even in the Mutation op union yet (see board-store.js's module
   comment)", and "every Position a controller happens to hold". Rewrite to the present: coordination primitives
   exist (guide §4.6, `board/coordination.js`, `board/tofi.js`), HANDOFF/POINT_OUT/TOFI are ops
   (`authority/op-kinds.js`), MRU Positions exist with the capability table of ADR 0080; "signed on to". The guide
   quote "never as the union of the held set" must match the guide's current wording (grep `EFSPImplementationGuide.md`
   §4.8.4). Then every other owned header (what `permission.js` and `nla.js` are now: facades over `authority/`?
   read the code). Commit.
2. **Pointers.** `efsp-ws.js`: `theater-settings.js` (C-4: "formerly `theater-settings.js` (removed, ADR 0085)" or
   name `theaters.json`/`aptConfigSet`), `_applyCoordinationPropose`/`_applyTofiPropose`/`receiveTofiProposal` named
   as board-store's (BOARD-2: now `board/coordination.js`, `board/tofi.js`), `_pruneLog` (gone; the ring is
   `sync/sync-log.js`). `authority/strip-types/departure.js:30` `_validateBayImpliedTransition` (BOARD-1: find
   where the Bay-implied check lives now). `wire/families/correlation.js:9, :32` and `marsa.js:39` cite
   `_handleAirspaceMutation`'s comment (gone: name `wire/families/airspace.js` and quote what it now says, or drop the
   cross-reference). `authority/classes.js:12` "config.js's per-Position positionClasses map" (the facility JSON's
   `positionClasses`, read through `facility-config.js`). `wire/skeleton.js:5` `_subject` (check it is a field name,
   keep if so). Every `board-store` line (37). Commit.
3. **Rows.** C13 (per-State authority table: prefix `// [SOURCE-DEFINED] (guide §3.4) —`; "guide-sourced one" →
   "guide-given one"; the table now lives under `authority/`), C16 (`nla.js` "Guide-specified lifecycle ... not
   invented" → the marker wording in the L9 row), D10 (the OVERFLIGHT "no guide-published state table" sentence:
   **re-check first**, ADR 0087 moved overflight onto the guide's four-state lifecycle, so the sentence may be gone or
   now wrong the other way). Keep the L23 TACTICAL capability-table marker. For each, write a Mirror line (README
   rule 6) for L20-CLIENT (`efsp-nla.js` C14/C15). Commit.
4. **Vocabulary.** TWR/GND/APP (87) → LC/GC/AP where they name Positions (not inside a quoted identifier or test
   name); Strip Role (61) → strip type; FDR → flight data; held/holds a Position → signed on; covering →
   consolidated at; "Peer" ops are `InterfacilityCoordination*`/`Tofi*` now. Commit per directory.
5. **Close.** `node --check`; codecheck `comment-only`; `node --test tests/board-seam.test.mjs
   tests/wire-payload-contract.test.mjs tests/required-rules.test.mjs tests/clock-policy.test.mjs`; `nice npm test`
   once. Counts at end, row table, Mirror lines, ADR errata rows (if any), report.

## Acceptance

- codecheck `comment-only`; crc-sync `npm test` identical before → after.
- L20-WIRE column: stale pointers 0 (or listed with a reason); all 37 `board-store` lines verified; vocab hits reworded
  or covered by a kept-sense line; marker count ≥ 15.
- C-7, C13, C16, D10 (applied or "no longer applies, because ..."), BOARD-1/BOARD-2/C-4 pointers in the row table.

## Defaults (P2)

- `permission.js` header: describe what the file does now in at most ~15 lines and point to ADR 0080 (capability
  table) and ADR 0095 (registry); the D21 "per acting Position, never a union" rationale stays, it is still true.
- A cross-file "see X's comment" reference whose target comment no longer exists is replaced by the reason itself in
  one sentence, not by a new pointer.
