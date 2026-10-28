# RENAME-C: docs, the glossary, env vars, config keys and infra

> Read `README.md` in this folder first, then [rename-map.md](rename-map.md) (§1 rules, §4 kept terms, §5 prose).
> Rulings: H96 (glossary plus renames; committed ADRs are never edited, P4), H98, H82 R3-35 (hard rename of the ASACS
> env keys: drop the fallbacks), R3-79 standing rule (always ask the human before deploying to prod), S-TEST. Prep
> notes and the open questions RP-1..RP-6: `docs/wip/RENAME-PREP.md`; the map on your base wins over this briefing.

| | |
|---|---|
| Wave | W7, beside [RENAME-A](RENAME-A.md) and [RENAME-B](RENAME-B.md). Cut from **RENAME-A's commit 1**. Merges last |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-RENAME-C` on `lane/RENAME-C-docs-env` |
| ADR | none. You write `docs/glossary.md` (H96's glossary; it is the key for reading every ADR) |
| E2E lane | none |
| Size / model | 1 lane / Sonnet 5.5 (≈30 env occurrences, ≈420 doc tokens, ≈830 prose sites in eight docs, the glossary) |

## Goal

The env keys have one spelling (`CRCSYNC_DOMAIN`, `CRCSYNC_URL`) and no ASACS fallback; the living docs use the new
words and the new file names; `docs/glossary.md` maps every old word to the new one with its FAA source, so the ADRs
and archived notes stay readable without being edited.

## Owns

- **By token:** every occurrence of an `E` row (N08, N09) and a `K` row (none at prep time; step 0 re-checks), in every
  tree: `.env.example`, `infra/docker-compose.yml`, `infra/tests/*.test.js` (not `infra/tests/fixtures/`, a historical
  fixture), `sourcedcs-web/store.js` and `sourcedcs-web/server.js` (the `ASACS_URL` constant and page global),
  `crc-desktop/main.js`, `crc-desktop/app/server.js`, `crc-desktop/app/public/js/sync.js`,
  `crc-desktop/app/public/auth-callback.html`, `crc-desktop/playwright.config.js`, the crc-desktop tests that set the
  env or name the page global (`server-proxy-routes.test.js`, the module-graph or global-surface fixture), and any
  `.github/workflows/*.yml` that sets one of them.
- **Docs (area D):** `CLAUDE.md`, `README.md`, `crc-sync/README.md`, `crc-desktop/README.md`, `infra/RUNBOOK.md`,
  `docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`, `EFSPImplementationGuide.md` (RP-4), a new entry at the top of
  `crc-desktop/build-assets/release-notes.md`, and the new `docs/glossary.md`.
- `docs/wip/RENAME-C.md`, `docs/wip/RENAME-C/**`.

## Frozen for you

Every `W`, `S`, `A`, `B`, `U` token outside `*.md`; `crc-sync/src/**`; `docs/adr/**` (P4, never edited);
`docs/wip/**` other than your own, `docs/parallel/**` (history), `docs/efsp-parallel-plan.md`, `docs/efsp-wp6-plan.md`,
`docs/efsp-ui-catalogue-*.md`, `docs/efsp-ui-findings.md`, `docs/ui-findings/**`, `docs/atobrief/**`, older
release-notes entries, `infra/tests/fixtures/**`, the `asacs.sourcedcs.page` hostname and the default `wss://asacs…`
endpoint (intentional; never "fix" them).

## Steps

0. **Step 0** per README (install; record crc-desktop and sourcedcs-web `npm test` counts and `node --test
   infra/tests/*.test.js`). Copy rename-map §8 as `rename_tool.py`; `python3 rename_tool.py count > docs/wip/RENAME-C/step0-count.txt`.
   Inventory, scripted:
   ```
   git grep -n -I -E "ASACS_|CRC_SYNC_URL|CRCSYNC_(URL|DOMAIN)" -- . ':!docs/adr' ':!docs/wip' ':!docs/parallel' ':!infra/tests/fixtures'
   for f in CLAUDE.md README.md crc-sync/README.md crc-desktop/README.md infra/RUNBOOK.md docs/efsp-usage-guide.md docs/efsp-briefing.md EFSPImplementationGuide.md; do
     grep -n -o -E "\b(seats?|station|occupied|unoccupied|occupancy|unmanned|manned|held|holds?|claim\w*|cover\w*|hand-?over\w*|STCA|FDRs?|fdr\w*|[Rr]oles?|[Ff]ield[ -]state|FIELD STATE|release state|releaseState|Peer[A-Z]\w+|TWR|GND|APP|squawk)\b" "$f" | sed "s#^#$f:#"
   done > docs/wip/RENAME-C/prose-sites.txt
   git grep -n -E "station-coverage|fdr-store|field-state|stca\.js|carrier/transfers|transfer-effects|authority/roles" -- '*.md' ':!docs/adr' ':!docs/wip' ':!docs/parallel'
   ```
   (the last line: doc references to files RENAME-A moved). Send "main" the step-0 note.
1. **Env commit**, `refactor(RENAME-C): one spelling for the crc-sync env keys (R3-35)`.
   `python3 rename_tool.py apply --lane C --kind structural --rows N08,N09`, then by hand-reviewed patch (it is a
   deletion, not a rename): compose `CRCSYNC_DOMAIN=${CRCSYNC_DOMAIN:-${ASACS_DOMAIN}}` → `CRCSYNC_DOMAIN=${CRCSYNC_DOMAIN}`,
   the same for `CRCSYNC_URL`; `.env.example` loses `#ASACS_DOMAIN=` and the "still honoured" comments;
   `sourcedcs-web/store.js` reads `process.env.CRCSYNC_URL` only (the tool's WARN lines are exactly these sites); the
   page global becomes `var CRCSYNC_URL` and every reader follows (`sourcedcs-web/public` has none at prep time:
   re-check). The `infra/tests` assertions that pin the fallback flip to assert that no `ASACS_` key is left in the
   compose file. In crc-desktop, `process.env.CRC_SYNC_URL` and the `config.js` global `CRC_SYNC_URL` become
   `CRCSYNC_URL`; the user's `config.json` key `crcSyncUrl` stays (installed clients). Gates: `node --test
   infra/tests/*.test.js`, sourcedcs-web `npm test`, crc-desktop `npm test`, and one crc-desktop boot (`npm start` or
   the boot smoke on any free lane the supervisor names) to see the client still reaches crc-sync.
2. **Docs token commit**, `docs(RENAME-C): token renames in the living docs`. For each `?` row,
   `python3 rename_tool.py review <ROW> --area D > docs/wip/RENAME-C/review-<ROW>.tsv`, mark `Y`/`N`; then
   `python3 rename_tool.py apply --lane C --kind docs`. This renames code names, file paths, Position ids and Bay ids
   where the docs quote them. Fix the file references from the step-0 grep (the paths RENAME-A moved).
3. **Prose commit(s)**, one per doc, `docs(RENAME-C): FAA vocabulary in <doc>`. From `prose-sites.txt`, write
   `docs/wip/RENAME-C/prose-<doc>.tsv` (`line<TAB>old sentence fragment<TAB>new fragment`, or `KEEP` and why: a
   quotation of an ADR title, "On Station", Navy/MRU vocabulary, "hold" in the HELD/holding senses) and apply it with a
   script that fails if the line no longer holds the old fragment. Rules: rename-map §3 and §5; "covering Position" →
   "the Position it is consolidated at"; a Position is "staffed", controllers "sign on/off"; "STCA" → "Conflict Alert
   (CA)" on first use per section; "FDR" → "flight data"; "Strip Role" → "strip type"; "field state" → "runway status";
   bare "state" of a Strip → "strip state"; never a bare "transfer" or "release" (name its object); `ControlRelease`
   for H94's future control release. Section numbers and headings' anchors in `EFSPImplementationGuide.md` and the
   usage guide stay where code or ADRs cite them (`guide §4.5`): rename words, not numbers; where a heading's anchor
   changes, grep for links to it.
4. **`docs/glossary.md`**, `docs(RENAME-C): glossary (H96)`. One table: old word or name → new word or name → FAA
   source → note, for every row of rename-map §3 and every Position of §2 (with the long names), then the kept terms
   of §4 with one-line definitions (Bay, Rack, Primary = the controller "signed on and responsible", JO 7210.3 ¶2-2-3;
   EFSP, and the FAA's EFS), the "bare transfer/release" rule, and a header: "ADRs 0001-<last before W7> and the notes
   in `docs/wip/` and `docs/parallel/` use the old words; read them through this table". Link it from `CLAUDE.md` and
   both READMEs that mention EFSP.
5. **Release note** (top entry of `crc-desktop/build-assets/release-notes.md`, in the existing style): the new names a
   controller sees (Position ids LC/GC/AP, RUNWAY STATUS, CA, BEACON), that the server's state is reset with this
   release (no migration, R3-2), the dock layout reset if RENAME-B bumped the key, and for the operator: **edit the
   server's `infra/.env` (rename `ASACS_DOMAIN`/`ASACS_URL` to `CRCSYNC_DOMAIN`/`CRCSYNC_URL` if set) and wipe the
   `crc-sync-state` volume's `efsp-*` files before deploying client and server together**. Deploying is the human's
   call (R3-79): write the note, never deploy.
6. After A and B merged (the supervisor tells you), rebase is the supervisor's: re-run
   `python3 rename_tool.py count` on the merged tree and fix any doc token a late map row added (column D must be 0 for
   every exact and stem row). Report.

## Ordering with A and B

- You are cut from A's commit 1 and merge last. A and B never edit `*.md`, so the docs never conflict.
- Your env edits touch crc-desktop files A and B also edit (`sync.js`, `app/server.js`, a test). A conflict is
  resolved by taking their side and re-running `apply --lane C --kind structural --rows N08,N09` plus your patch.

## Acceptance

- `git grep -n -E "ASACS_(URL|DOMAIN)|CRC_SYNC_URL"` outside `docs/adr`, `docs/wip`, `docs/parallel` and
  `infra/tests/fixtures` returns nothing.
- infra tests, sourcedcs-web and crc-desktop `npm test` green (counts before → after; the flipped infra assertions
  explained).
- `python3 rename_tool.py count` on the merged tree: column D is 0 for every exact and stem row; the prose files show
  only `KEEP` lines left.
- `docs/glossary.md` covers every row of rename-map §2 and §3; no file under `docs/adr/` changed
  (`git diff --stat <base>.. -- docs/adr` is empty).

## Defaults (P2)

- When a doc quotes a committed ADR's wording, keep the quotation and add the new word in brackets once.
- `docs/efsp-briefing.md`'s historical sections (findings already fixed, dated notes) keep their words; only the
  current-state sections and every code name are renamed.
- If a sentence needs more than a word swap to stay true (the guide's "an operating role a controller signs into"),
  rewrite that sentence only.
