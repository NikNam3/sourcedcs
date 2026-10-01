# RENAME-B: client identifiers, CSS, HTML and UI labels

> Read `README.md` in this folder first, then [rename-map.md](rename-map.md) (§1 is the contract; §5.1 is your UI
> pass). Rulings: H96, H98, S-desk3, R3-2, S-TEST. Prep notes and the open questions RP-1..RP-6:
> `docs/wip/RENAME-PREP.md`; the map on your base wins over this briefing.

| | |
|---|---|
| Wave | W7, beside [RENAME-A](RENAME-A.md) and [RENAME-C](RENAME-C.md). Cut from **RENAME-A's commit 1** (file moves), not from the W6 merge. Merges after A, before C |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-RENAME-B` on `lane/RENAME-B-client` |
| ADR | none |
| E2E lane | `E2E_LANE=6` (boot smoke and the panels you changed; never the full suite) |
| Size / model | 1 lane / Sonnet 5.5 (≈960 mechanical occurrences, ≈1,260 review sites in area B, the UI-string pass) |

## Goal

Every client-only token (class `B`) and every controller-visible string (class `U` and the prose of rename-map §5.1)
uses the new words. You also **review the client sites of RENAME-A's `?` rows**, so A can apply them in its wire
commit. Nothing you change reaches the wire: your commits leave crc-sync and the goldens untouched.

## Owns

- **By token:** every occurrence of a `B` or `U` token (CSS classes, DOM ids, `data-*` attributes, map layer and source
  ids, client-only function and constant names, test-local names, screenshot names) in `crc-desktop/app/public/**`,
  `crc-desktop/tests/**`, `crc-desktop/e2e/**`.
- **UI strings:** string literals and HTML text a controller reads, in `crc-desktop/app/public/**`, that contain an
  old term (rename-map §3 "Old" column, the Position ids of §2, "FIELD STATE", `SQUAWK`), plus the test assertions
  on exactly those strings.
- `docs/wip/RENAME-B.md`, `docs/wip/RENAME-B/**` (review files for area B, the UI replacement file).

## Frozen for you

Every `W`, `S`, `A` token (RENAME-A edits those in your files too; never touch them, even when a line holds both),
`E`/`K` tokens (RENAME-C, including the `CRC_SYNC_URL` page global), `crc-sync/**`, all `*.md`, file moves (A did them
in commit 1), `main.js` and the Electron `build` config.

## Steps

0. **Step 0** per README (install, both suite counts; no freeze run needed, you touch no server file). Copy rename-map
   §8 as `rename_tool.py`; `python3 rename_tool.py count --tokens > docs/wip/RENAME-B/step0-count.txt`; record the
   `B`-class rows and the stem compounds whose derived class is `B` (the field-state CSS family is most of them). Then
   the **UI-string inventory**, scripted:
   ```
   git grep -n -I -E "(['\"\`>])[^'\"\`<]*\b(seat|station|occupied|unmanned|manned|held|holds|claim|covering|covered|hand-?over|STCA|FDRs?|[Rr]ole|[Ff]ield [Ss]tate|FIELD STATE|release state|SQUAWK|TWR|GND|APP)\b" -- crc-desktop/app/public > docs/wip/RENAME-B/ui-strings.txt
   ```
   Every hit gets a line in `docs/wip/RENAME-B/ui-replace.tsv`: `path:line<TAB>old text<TAB>new text` (or `KEEP` and why:
   a comment, a log line, a CSS selector that is a `W` token, "On Station"). Also record: how `dock.js` restores a saved
   layout whose panel id no longer exists (the dock panel id `fieldState` becomes `runwayStatus` in A's wire commit, and
   installed clients hold `crc-desktop-dock-layout` in `localStorage`), and whether `crc-desktop-settings` stores
   Position ids. Send "main" the step-0 note.
1. **Review files for RENAME-A.** For every `?` row (N03, N04 `held`, N11, N13, N18 part):
   `python3 rename_tool.py review <ROW> --area B > docs/wip/RENAME-B/review-<ROW>.tsv`, then mark each site `Y`/`N`
   with a reason (rules in RENAME-A step 2; the client's `held` locals in `efsp-panel.js`, `bay-views.js`,
   `airspace-panel.js` are Position lists, `Y`; ARIA `role` and `getByRole` are never `Y`). Commit
   (`docs(RENAME-B): review decisions for RENAME-A`) and **tell "main" and RENAME-A the hash**: A needs these before its
   wire commit. This is your first deliverable; do it before your own renames.
2. **Token commits:** `python3 rename_tool.py apply --lane B --kind structural`, in two commits so each is reviewable:
   (a) N04/N05/N06/N07/N10/N11/N17 exact rows, (b) the stem compounds (`field-state-*` CSS family, `FIELD_STATE_*`
   client constants). Read every WARN. The gate per commit: the client unit test files you touched, and the boot smoke
   (`E2E_LANE=6 npx playwright test e2e/smoke.spec.js` or whatever spec ESM-1 made the boot smoke).
3. **UI-string commit**, `refactor(RENAME-B): UI labels`: apply `ui-replace.tsv` with a small script (quote it in the
   wip file; it replaces the old text on the named line only, and fails if the line no longer contains it). Labels to
   use: "Position", "staffed"/"unstaffed", "sign on"/"sign off", "consolidated at", "handoff", "CA" (the scope tag
   only; elsewhere "Conflict Alert"), "flight data", "strip type", "RUNWAY STATUS" (panel title), "BEACON" (Block 5/M4
   label), and the Position ids of rename-map §2 (`LC`, `GC`, `AP`) where a label spells an id out. The label is the
   controller's, so a sentence may need rewording, not only a word swap: keep it to the sentence that held the word.
   Change the client test assertions on those strings in the same commit.
4. **Dock layout and settings.** If step 0 showed that a saved layout with an unknown panel id throws or leaves a dead
   tab, the fix is a behaviour change: tell "main" (proposed default: bump `DOCK_LAYOUT_KEY` to
   `crc-desktop-dock-layout-v2`, so every installed client starts from the default layout once). Do not ship a
   migration (R3-2). Same for stored Position ids in settings: they are refused by the server and re-picked, which is
   acceptable; write it in the release note text you hand to RENAME-C.
5. Both unit suites once (crc-desktop and crc-sync; you touched no crc-sync file, the count must not move), the boot
   smoke and the specs of the panels whose labels you changed (at most five spec files, one process; list the rest for
   the supervisor's sharded run), report.

## Ordering with A and C

- You are cut from A's commit 1, so your review keys (`path:line:token#n`) match A's tree. A applies your area-B
  decisions in its wire commit; you never apply them yourself.
- A merges first. A textual conflict in a client file is resolved by taking A's side and re-running
  `python3 rename_tool.py apply --lane B --kind structural` and the `ui-replace.tsv` script on it. Re-run your boot
  smoke after that merge.
- C owns the `CRC_SYNC_URL` page global in `config.js`/`sync.js`/`auth-callback.html` (N09); leave it.

## Acceptance

- crc-desktop `npm test` green with the same count as your base; crc-sync `npm test` unchanged.
- `python3 rename_tool.py count` on your head: 0 for every `B` exact and stem row; `ui-strings.txt` re-run shows only
  `KEEP` lines.
- Boot smoke on lane 6 passes, zero script errors; the touched-panel specs pass.
- Review files for RENAME-A committed and their hash reported, with the `Y`/`N` totals per row.

## Defaults (P2)

- When a label is an abbreviation that would lose meaning ("CA" outside the scope tag), spell it out.
- A string that is both a UI label and a `W` value (an enum shown verbatim) is A's: A's wire commit renames the value,
  and you only change a separate display label if one exists.
- Lower-case Position-handle variables in e2e specs (`twr`, `gnd`) stay; list them for L20.
