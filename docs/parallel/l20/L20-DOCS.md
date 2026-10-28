# L20-DOCS: pointers and facts in CLAUDE.md, the READMEs, the EFSP briefing and the release note

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-DOCS` on `lane/L20-DOCS` |
| Model / size | Sonnet 5.5 / M: 7 docs (~3,200 lines), ~70 code pointers to check (briefing ~50: `server.js` 11, `.test.js` 12, `permission.js` 9, `nla.js` 7, `board-store.js` 6, `theater-settings` 4, `DEFAULT_CONFIG` 2, `clearance-migration`, `efsp-resync`; CLAUDE.md ~10; READMEs ~12), 11 rows |
| Wip | `docs/wip/L20-DOCS.md` |
| ADR / E2E lane | none / none |

## Goal

The living docs a newcomer reads first describe the tree as it is after the refactor and the rename: where things
live (ADR 0095's layout), how the client loads (native ES modules), what the local server is, which tests and gates
exist, and what an operator must do before deploying this release. RENAME-C already changed their *words*; you fix
their *facts and pointers*.

## Owns

`CLAUDE.md`, `README.md`, `crc-sync/README.md`, `crc-desktop/README.md`, `infra/RUNBOOK.md`, `docs/efsp-briefing.md`,
and the **top (unreleased) entry** of `crc-desktop/build-assets/release-notes.md`. `docs/wip/L20-DOCS.md`.

## Frozen for you

`docs/efsp-usage-guide.md`, `EFSPImplementationGuide.md`, `docs/glossary.md`, ADRs (L20-GUIDE), every code file,
older release-note entries, `docs/efsp-parallel-plan.md` and `docs/efsp-wp6-plan.md` (history, rename-map §5.2: their
`DEFAULT_CONFIG` prose stays), `docs/wip/**`, `docs/parallel/**`.

## Steps

0. **Step 0.** No install needed (docs only; the scan reads files). Record in the wip every pointer in your docs that
   names a file, function, script, test or config key (`grep -n -E '`[^`]+\.(js|mjs|json|md)`|`[A-Za-z_]+\(`' <doc>`),
   and check each with `git ls-files` / `git grep`. Step-0 note to "main".
1. **CLAUDE.md.** (a) S-ARCH2 16: crc-desktop's bundled local server is plain Node `http`/`https`, not Express (the
   crc-desktop architecture bullet and the "Commands" note); crc-desktop's README says the same at its config table
   (`wsPort` row). (b) crc-sync architecture: the Express app is `src/app.js`'s `createApp()` (composition root,
   named tickers, ADR 0095 §4); `server.js` only builds the network clients and listens; the `/api/auth/token`,
   `/api/ws-ticket` and `/js/config.js` bullets point there. Name the EFSP layout in one or two lines (`board/`,
   `board/ops/`, `wire/families/`, `sync/`, `authority/`, ADR 0095). (c) Commands: crc-desktop `npm test` runs
   `tests/*.test.{js,mjs}` (five CommonJS tests, the rest ES modules), and the dangling "see crc-desktop internals
   below" (no such section) goes; crc-sync's soak-selfcheck sentence lists the files the refactor README's Gates
   name (`board-store.js`, `board/**`, `efsp-ws.js`, `wire/**`, `ws-hub.js`, `sync/**`, `tools/soak/host-core.js`);
   the freeze suite is opt-in (`npm run freeze`, S-M-BACKCOMPAT). (d) The CRC client is native ES modules
   (`index.html` loads `/js/config.js` then one `<script type="module" src="./js/main.js">`; `classic-globals-bridge.js`
   is transitional until BRIDGE). (e) S-S13: `state/collab-overlay.json` and `src/collab-wiring.js` in the crc-sync
   bullets and the `state/` paragraph. (f) Verify HYG's seven proposed edits (`docs/wip/HYG.md` "Proposed CLAUDE.md
   edits"): most are in; apply what is missing. Commit.
2. **READMEs and RUNBOOK.** `crc-sync/README.md` `server.js` bullet → `src/app.js`; `crc-desktop/README.md`
   ("bundled local Express server", test names); `README.md`, `infra/RUNBOOK.md`: check every pointer and the deploy
   steps against S-M-W7 (ship client and server together; `infra/.env` `ASACS_*` → `CRCSYNC_*`; delete
   `state/efsp-board.json`, `efsp-mutations.jsonl`, old `efsp-facility-*.json`, a `state/alerting.json` that uses
   `stca`) and S-M-BACKCOMPAT/DATA-1 (what a deployed `state/` now refuses at start-up). Commit.
3. **The release note** (top entry only): add the missing operator step (S-M-W7): "delete `state/alerting.json` in
   the `crc-sync-state` volume if it still has an `stca` key (the key is `conflictAlert` now; an unknown key stops
   start-up)", and check the entry lists the other deletions above. Commit.
4. **`docs/efsp-briefing.md`.** Current-state sections only (§1, §2, §4, §5, §6, and §3A-3H where they describe the
   present); the dated lane sections (§3I, §3J) are history and keep their pointers, except a pointer that would now
   send a reader to a file that does not exist: add the current file in brackets once. Known: §1 "State of the tree"
   still describes the pre-refactor branch ("L20 has not started", test counts, ADR list to 0094) → the refactor and
   rename are merged (ADRs 0095-0097, 0098+ per `ls docs/adr`), counts from S-M-W7, the file map gains `board/`,
   `wire/`, `sync/`, `authority/`, `app.js`; `DEFAULT_CONFIG` (~467, ~973; S-M-DATA1: facility data is the four
   `config/efsp-facility-*.json`, a missing or invalid file is a start-up error, no merge); `theater-settings.js`
   (~781-801: removed, ADR 0085); `clearance-migration.js` (~922: deleted by BACKCOMPAT); `efsp-resync` (~1105:
   the reply type is `efsp-resync-reply` with `answer: snapshot|delta`, S-M-merge4/R3-47); `board-store.js`,
   `permission.js`, `nla.js`, `.test.js` names (point at the collaborator/`authority/` file and `.test.mjs`). Commit
   per section.
5. **Close.** Re-run your step-0 pointer check: every pointer resolves (or is in a history section and marked).
   Report.

## Acceptance

- Every file/function/test/script pointer in the seven docs resolves on your base, except history-section pointers
  listed in the wip as "kept: history".
- CLAUDE.md says nowhere that crc-desktop's local server is Express; it names `src/app.js` `createApp()`; the
  soak-selfcheck file list matches the refactor README's Gates; the crc-desktop test glob is right.
- The release note's operator steps match S-M-W7's deploy list.
- `git diff --stat <base>.. -- docs/adr docs/efsp-usage-guide.md EFSPImplementationGuide.md` is empty.

## Defaults (P2)

- Where CLAUDE.md and a README say the same thing, fix both, and keep CLAUDE.md the short one.
- New facts are stated once, with the ADR or decision row; no changelog prose ("this used to ...") in CLAUDE.md.
- A count you cannot verify without running a suite (test totals) is written with its source ("S-M-W7: crc-sync
  2117/2118") rather than measured again.
