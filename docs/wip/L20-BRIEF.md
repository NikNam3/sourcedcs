# L20-BRIEF: notes behind the L20 briefings

Branch `lane/L20-BRIEF`, cut from `efsp-wp5-correlation` at `7b8f04c` (S-M-W7). Docs only; no test suite or
Playwright was run (a full Playwright run was in progress on the machine). Output: `docs/parallel/l20/README.md` and
eleven lane briefings `docs/parallel/l20/L20-*.md`.

## How the split was chosen

- L20 as planned before the refactor (`docs/wip/L20-prep-inventory.md` §3) was one lane: the `[SOURCE-DEFINED]` audit,
  ADR 0077, with all doc changes drafted for an integrator. After H87/H96 it is also the comment-prose half of the
  rename (rename-map §5.1, 1,027 prose sites counted at `165a517`) and the pointer repair the refactor deferred
  ("comments move verbatim ... That is L20's job, on the new layout"). That is too much for one lane, and it is all
  file-local, so it splits by directory with disjoint Owns (no merge conflicts by construction).
- The directory split follows the task's suggestion with two changes: `src/efsp/` rest is split into CORE and DOMAINS
  (it was the biggest bucket: 59 files, 5,564 comment lines, most prep rows), and crc-desktop's non-EFSP code, tests
  and e2e are one lane (DESK) so wave 1 fits 9 lanes plus the questioner (cap 10). atobrief, sourcedcs-web and
  `tools/miztoyaml` had no real hit (every "claim"/"role" is JWT/Casdoor), so they are check-only inside SYNCTOP
  (U16 is the one edit).
- Docs split in two: DOCS (CLAUDE.md, READMEs, briefing, release note: wave 1) and GUIDE (usage guide, implementation
  guide, glossary, ADR 0077: wave 2, because ADR 0077 collects every lane's errata rows). In the prep's plan these
  docs were drafted in a wip and folded by an integrator (rule 3); here the owning lane edits them directly.

## Measurements at `7b8f04c` (scan in the README; read-only)

| Lane | files | comment lines | stale file ptr | stale `_method` ptr | board-store lines | vocab hits | markers |
|---|---|---|---|---|---|---|---|
| BOARD | 26 | 1,496 | 0 | 7 | 23 | 102 | 1 |
| WIRE | 33 | 1,515 | 1 | 5 | 37 | 184 | 15 |
| CORE | 30 | 3,486 | 3 | 6 | 40 | 196 | 17 |
| DOMAINS | 29 | 2,078 | 0 | 1 | 22 | 89 | 42 |
| SYNCTOP (crc-sync part ≈63 files, 2,305 lines) | 264 | 7,163 | 12 | 2 | 7 | 51 | 12 |
| SYNCTESTS | 172 | 3,497 | 7 | 15 | 30 | 281 | 8 |
| CLIENT | 54 | 4,151 | 30 | 5 | 27 | 139 | 26 |
| DESK | 159 | 5,526 | 49 | 1 | 9 | 150 | 6 |

Total `[SOURCE-DEFINED]` in code/config/tools: 116. Strings with old words outside comments: ~25 in crc-sync
src/tools, 0 real in the client beyond A2 (the `GND` radar suffix and the pad `occupied` are kept senses). Test titles
with old words: 196 crc-sync, 64 crc-desktop tests, 13 e2e. Test locals: 21 / 3 / 13. Always-true `typeof` guards in
the client: 362 in 52 files (ESM-1 said 336; re-count in ESM-GUARDS). The comment stripper in the README's codecheck
was proven on every tracked JS file (648/648 still parse) and on a seeded comment edit (passes) and code edit
(caught).

## Facts checked while writing (so the lanes do not re-derive them)

- ADR `0077` is still free (ADRs 0001-0076, 0078-0089, 0091, 0093-0097 exist).
- TA (S-TA) merged: `BLOCK_FL_FROM_FT` is gone and the client's duplicate 18000 fallbacks were removed; 12 `18000` /
  `DEFAULT_TRANSITION_ALT_FT` hits remain (U5 is smaller now).
- The `drop-broadcast` selfcheck detector fires again (CLAUDE.md already says so): C-6's CLAUDE.md rewording is moot.
- crc-desktop's local server (`app/server.js`) requires `http`/`https`, not Express (S-ARCH2 16 confirmed).
- crc-sync's Express app is `src/app.js` `createApp()`; `server.js` is 21 lines. CLAUDE.md still describes
  `server.js` as the Express app.
- `ship-state.js:26-27` still mentions "the 1° re-broadcast step"; `:233` has a re-broadcast predicate: DOMAINS checks
  whether that is the step.
- `permission.js` header still says "Phase 1 ... HANDOFF/POINT_OUT/TOFI aren't even in the Mutation op union yet".
- `marsa-store.js:39` still says the obligation alert "cannot retract".
- `facility-config.js` has 0 markers now; `8476c41^` had 47 lines of citations/markers on the literals.
- `tuning-file.js` skips `_`-prefixed keys; the facility schema has no such rule, so the "no `_comment` in
  `efsp-facility-*.json`" rule stands.
- `crc-desktop` `npm test` is `tests/*.test.{js,mjs}`; CLAUDE.md's line says `tests/*.test.js` and points at a "crc-desktop
  internals" section that does not exist.
- `host-core.js:120` still wraps `_rebalanceRack` by name.

## Defaults taken (P2)

- The `typeof` guards (ESM-1) are **not** L20: removing them changes code bodies in 52 files. Own lane ESM-GUARDS,
  after L20-CLIENT/DESK/STR, with the latent ReferenceErrors in the same files.
- The bridge removal and e2e spec migration is its own lane BRIDGE (as the supervisor said), and it also takes the e2e
  test titles and locals, so no L20 lane edits `e2e/**` code.
- Strings and test identifiers routed to L20 (RENAME-A findings 1-3, L9 Group A, "unknown Strip Role") form one
  wave-2 lane, L20-STR, after the code lanes, because they change string literals and assertions.
- History docs (`efsp-wp6-plan.md`, `efsp-parallel-plan.md`) keep their `DEFAULT_CONFIG` prose (rename-map §5.2 lists
  them as history), although S-M-DATA1 named them.
- The facility literals' lost doctrine comments are restated in `facility-schema.js` beside `REQUIRED_KEYS` (CORE) and
  summarised for controllers in the usage guide's "What is ours and what is sourced" (GUIDE), not in JSON.
- Comment-only edits are allowed in `tests/helpers/efsp-scenario.mjs` (append-only protects its code).
- Briefing history sections (§3I, §3J) keep their pointers; only current-state sections are repointed.
- Wave-1 lanes run no soak and no freeze: the codecheck proves no code changed.
- Model per lane Sonnet 5.5, one Opus questioner per wave (memory: questioner + supervising main session).

## Open questions

None for the human. For the supervisor (defaults above apply if unanswered): whether ESM-GUARDS and BRIDGE get
briefings from a prep agent or from the supervisor directly, and whether the hygiene items (report.js constants, the
U18 test, host-core's `_rebalanceRack` wrap) ride with BRIDGE/ESM-GUARDS's wave or wait for a later hygiene lane.
