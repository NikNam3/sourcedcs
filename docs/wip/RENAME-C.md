# RENAME-C report (docs, glossary, env keys, infra)

Branch `lane/RENAME-C-docs-env`, base `8c1347a` (RENAME-A commit 1). No ADR, no E2E lane. Never deployed.

```
f11cbc2 docs(RENAME-C): CLAUDE.md pointer wording
0defc63 docs(RENAME-C): glossary (H96), CLAUDE.md env rows, release note
7f2790c docs(RENAME-C): FAA vocabulary in docs/efsp-briefing.md
5dd0343 docs(RENAME-C): FAA vocabulary in docs/efsp-usage-guide.md
d6d2bb3 docs(RENAME-C): FAA vocabulary in EFSPImplementationGuide.md
ffa61f7 docs(RENAME-C): mechanical prose renames (flight data, strip type, runway status, LC/GC/AP)
1202f25 docs(RENAME-C): token renames in the living docs
e75eacd refactor(RENAME-C): env names in crc-desktop files
a1d5e5b refactor(RENAME-C): one spelling for the crc-sync env keys (R3-35)
```

**Tests** (before -> after, no code changed beyond env tokens): crc-desktop 883 (881 pass, 2 todo) -> 883 (881); sourcedcs-web
103 -> 103; infra 4 -> 4 (two assertions flipped: compose has `CRCSYNC_DOMAIN=${CRCSYNC_DOMAIN}` / `CRCSYNC_URL=${CRCSYNC_URL}` and
no `ASACS_` text at all); crc-sync 2111 (2110 pass, 1 todo), unchanged. `infra/tests/nginx-t.sh` not run (needs Docker; only
a compose comment and two env lines changed). crc-desktop boot: `app/server.js` with `CRCSYNC_URL=ws://127.0.0.1:9`
serves `var CRCSYNC_URL = "ws://127.0.0.1:9";` in `/js/config.js`. No Playwright.

## Done
- Env commit (R3-35): ASACS fallbacks deleted from compose, `.env.example`, `sourcedcs-web/store.js` (`store.CRCSYNC_URL`, page global
  `var CRCSYNC_URL`; `sourcedcs-web/public` has no reader). Separate commit for the crc-desktop files (S-RENC0): `CRC_SYNC_URL` ->
  `CRCSYNC_URL` in main.js, app/server.js, public/js/sync.js, auth-callback.html, playwright.config.js, tests/helpers/client-env.mjs,
  tests/server-proxy-routes.test.js; the `config.json` key `crcSyncUrl` stays. If B's merge conflicts on these: take B's side, then
  `python3 docs/wip/RENAME-C/rename_tool.py apply --lane C --kind structural --rows N08,N09`.
- Docs token commit (`apply --lane C --kind docs`), review files `docs/wip/RENAME-C/review-N03/N04/N11/N13.tsv` (only code tokens quoted in docs are Y).
- Mechanical prose rules (`prose_rules.py`) then per-doc reviewed edits (`prose-*.tsv`, applied by `prose_apply.py`, which fails when a fragment is gone).
- `docs/glossary.md`; CLAUDE.md env rows (`CRCSYNC_DOMAIN`, `CRCSYNC_URL`) and glossary pointer; top entry in `crc-desktop/build-assets/release-notes.md`.
- Step-0 counts: `docs/wip/RENAME-C/step0-count.txt`; `K` rows: none found.

## Docs rewritten / left
Rewritten: CLAUDE.md, EFSPImplementationGuide.md (section numbers unchanged, RP-4/H101), docs/efsp-usage-guide.md,
docs/efsp-briefing.md (historical sections keep "transfer"/"release" wording; strip type, Position, sign-on, consolidation, Conflict Alert renamed),
crc-desktop/build-assets/release-notes.md, new docs/glossary.md. Checked, nothing to rename: README.md, crc-sync/README.md,
crc-desktop/README.md, infra/RUNBOOK.md. Left: docs/adr/** (`git diff --stat 8c1347a.. -- docs/adr` is empty), docs/wip/** (other lanes), docs/parallel/**,
efsp-parallel-plan.md, efsp-wp6-plan.md, efsp-ui-catalogue-*.md, efsp-ui-findings.md, docs/ui-findings, docs/atobrief, older release notes.

## Defaults taken (P2)
- "station" in the guide means a *radar station* (host radar selection): kept; only "station" = Position renamed.
- Bare "held" for a Position -> "signed on to"; "held"/"holds" for a Strip (ownership), a departure hold, a held line: kept.
- "transfer": headings and first uses -> "strip transfer"; remaining uses inside strip-transfer sections and NLA tables stay (`TransferStrip` is kept).
- "Position handover" (guide 4.8) became "handoff" through row N06 (tool); the meaning there is a Position changing hands, not a Strip handoff. Supervisor may want a better word.
- FDR defined term in guide section 2 is now "**Flight data**" (mass noun: "one flight's flight data").
- Quoted UI strings the guide cites (for example "NO RADAR COVERAGE - HOLD A RADAR POSITION", "ACTING AS") left as is: RENAME-B owns UI text.
- README.md and the two sub-READMEs do not mention EFSP, so no glossary link was added there (CLAUDE.md links it).
- Acceptance greps: `ASACS_*`/`CRC_SYNC_URL` still appear deliberately in `.env.example` (retired-name notes), CLAUDE.md env rows, the release note,
  the glossary and `infra/tests/nginx-render.test.js` (the test asserts their absence, and the old-fixture renderer maps the fixture's `ASACS_DOMAIN`).
  `rename_tool.py count` column D is 1-2 for old-token rows because the glossary and CLAUDE.md row quote them on purpose; every other living-doc site is renamed or a KEEP (runway/pad "occupied", radar coverage, HELD state).

## Findings / for the supervisor
- Guide/usage-guide quotes of UI text must be re-checked against B's final UI strings after merge (`NO RADAR COVERAGE`, `Hand Off to AP`, `ACTING AS`, `with AIC/JTAC`).
- Release note says "Your saved panel layout may reset once": confirm whether RENAME-B bumped `crc-desktop-dock-layout`; if not, delete that clause.
- Release-notes.md has no history (one block per release); the new block is on top of the previous one.
- Doctrine question RP-F1 (is consolidating GC into LC right) is recorded in the glossary.

## For the human before deploy (R3-79: nothing was deployed)
1. On the server, edit `infra/.env` (checkout root `/<PATH>/infra/.env`): rename `ASACS_DOMAIN` to `CRCSYNC_DOMAIN` and `ASACS_URL` to `CRCSYNC_URL` if either is set
   (`grep -n ASACS infra/.env`). Values do not change. The old keys are no longer read: with `CRCSYNC_DOMAIN` unset the nginx crc-sync vhost renders with an empty `server_name`.
2. Do this before the deploy workflow's `git pull` + `docker compose up -d` lands this branch.
3. Wipe the `efsp-*` files in the `crc-sync-state` volume (R3-2, no migration; client and server must go together): stop crc-sync, remove `/app/state/efsp-*` in that volume, start it.
   (RENAME-A's wire commit changes snapshot and audit names; the old files would not load.)
4. Deploy client (tag `crc-desktop-vX.Y.Z`) and server together; a crc-desktop release already forces a crc-sync rebuild.
5. Optional check: `docker compose config | grep -E "CRCSYNC_(DOMAIN|URL)"` shows both populated before `up -d`.
