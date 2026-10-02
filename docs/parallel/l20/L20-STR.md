# L20-STR: the string and test-identifier items routed to L20 (not comment-only)

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers. **This is the one L20 lane that changes string literals
> and test-local identifiers.** Its gate is not `comment-only` but "every code change is on the list below".

| | |
|---|---|
| Wave | 2: after all eight wave-1 code lanes (BOARD, WIRE, CORE, DOMAINS, SYNCTOP, SYNCTESTS, CLIENT, DESK) are merged |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-STR` on `lane/L20-STR` |
| Model / size | Sonnet 5.5 / M: ~25 server reason/log strings, 2 UI strings (A1, A2), 1 refusal, ~260 test titles (≈196 crc-sync, ≈64 crc-desktop `tests/`), ~24 test locals, 1 test-hygiene fix |
| Wip | `docs/wip/L20-STR.md` (with `docs/wip/L20-STR/*.tsv` review files) |
| ADR / E2E lane | none / none (the supervisor's sharded Playwright run after this lane and BRIDGE merge covers the visible strings) |

## Goal

The server's prose strings (refusal `detail`s, log messages), the two UI strings L9 flagged, and test titles and test
locals use the glossary's words, so a controller, an operator reading the log, and a developer reading a failing test
all see the same vocabulary as the UI and the docs. Wire **values** (reason codes, ids, keys) do not change.

## Owns (by site, not by file)

- String literals in `crc-sync/src/**` and `crc-sync/tools/**` that are prose: refusal `detail`/message text and log
  message text containing an old word (`referenced FDR not found`, `unknown FDR …`, `no field state at …`, `field state
  is at rev …`, `restored ... FDR is gone`, `until the wind or TWR sets it`, `archived Strips and FDRs`, `orphan FDRs`,
  `handed to APP` in `tools/soak/traffic.js`, the refusal `unknown Strip Role: ${role}` ("unknown strip type: …"),
  and every hit of the step-0 grep). **Not** reason codes, ids, keys, radar labels (`${aptLabel} APP` names an
  approach radar, keep), or `carrier-slot-occupied`/pad `occupied` (kept senses).
- L9 A1 (`code-allocator.js` refusal detail: `'reserved for uncontrolled traffic'` → `"reserved for AI aircraft
  (crc-sync's synthetic block 6000–6777)"`), A2 (`crc-desktop/app/public/js/panels/radar-panel.js` range: keep the
  text, add the title per the L9 row), and the client half of D2/D5 if L20-CLIENT recorded it as a string.
- Test titles (first argument of `test`/`it`/`describe`) and test-local identifiers (`twr`, `gnd`, `app` as a Position
  handle, `twrBays`, `gndOnly`, `twrOnly`, `gndPushback`, …) in `crc-sync/tests/**` and `crc-desktop/tests/**`;
  the assertions that check a string you changed. **Not** `crc-desktop/e2e/**` (BRIDGE owns it), not
  `crc-sync/tests/freeze/**` trace names or anything that keys a golden, not goldens.
- RENAME-A finding 1: `crc-sync/tests/efsp-block-altitude.test.mjs` calls `createEfsp()` with the default paths and
  reads/writes the real `crc-sync/state/`; give it temp paths like its neighbours.
- `docs/wip/L20-STR.md`, `docs/wip/L20-STR/**`.

## Frozen for you

Comments (wave 1 did them; if a comment quotes a string you change, update that quote in the same commit), wire
values, the client UI strings RENAME-B already reviewed (only A2 and D2/D5 are yours), `e2e/**`, goldens, ADRs, docs.

## Steps

0. **Step 0.** Install (`(cd crc-sync && npm ci) && (cd crc-desktop && npm ci) && (cd crc-desktop/app && npm ci)`),
   baseline both suites (`nice`, sequential). Inventory, scripted, into `docs/wip/L20-STR/`:
   ```
   git grep -n -E "['\"\`][^'\"\`]*\b(TWR|GND|APP|FDRs?|Strip Role|Role|field state|covering|covered by|occupied|unmanned|manned|STCA|hand-?over|held by)\b[^'\"\`]*['\"\`]" -- crc-sync/src crc-sync/tools crc-desktop/app/public/js | grep -v -E "^\S+:[0-9]+:\s*(//|\*|/\*)" > strings.txt
   git grep -n -E "^\s*(test|it|describe)(\.todo|\.skip)?\(\s*['\"\`][^'\"\`]*\b(TWR|GND|APP|FDRs?|Roles?|field state|covering|covered|held|occupied|unmanned|manned|seat|STCA|hand-?over)\b" -- crc-sync/tests crc-desktop/tests > titles.txt
   git grep -n -E "\b(const|let|var) (twr|gnd|app|twrBays|gndOnly|twrOnly|gndPushback|\w*Twr\w*|\w*Gnd\w*)\b" -- crc-sync/tests crc-desktop/tests > locals.txt
   ```
   Turn each into a review TSV (`site<TAB>Y|N<TAB>new text or reason`); N for kept senses (radar "APP" labels,
   "occupied" pads/slots/airspace, Casdoor roles, ARIA `role`, `getByRole`). Step-0 note to "main" with the counts.
1. **Server strings** (one commit): apply the Y rows of `strings.txt`, update every test that asserts one (grep the
   old text in `crc-sync/tests` and `crc-desktop/tests` first), and any comment quoting it. Mirrored strings change
   on both sides in the same commit (README rule 6), and their drift test must pass. Run the touched test files.
2. **A1, A2, D2/D5** (one commit), with their asserting tests.
3. **Test hygiene** (one commit): `efsp-block-altitude.test.mjs` temp paths; run it.
4. **Test titles** (one commit per suite) and **test locals** (one commit per suite). Renaming a local is a pure
   rename inside one test file: `node --test` that file after each.
5. **Close.** Both unit suites once (`nice`); `npm run soak:selfcheck` once if a string in `board/**`, `efsp-ws.js`,
   `wire/**`, `sync/**` or `ws-hub.js` changed (S-TEST gates). The gate: `node l20-codecheck.mjs <base>` lists only
   files that appear in your TSVs (paste its output in the wip and tick each file). Report, with the full list of
   changed user-visible strings for the release note (L20-DOCS's successor or the next release).

## Acceptance

- Both suites: same pass/fail counts as the base, the changed assertions listed.
- Every `CODE CHANGED` file of the codecheck is in a TSV with Y rows; no reason code, wire key, id or golden changed
  (`git diff <base>.. -- crc-sync/tests/freeze/golden` empty).
- The step-0 greps re-run on the result show only N rows.
- The opt-in freeze goldens carry some of these `detail` strings; since the window closed, behaviour lanes do not
  maintain them (S-M-BACKCOMPAT, S-desk3). Do not run `npm run freeze:update`; list the traces that would change
  (`npm run freeze` once, at the end) in the wip.

## Defaults (P2)

- "FDR" in a refusal becomes "flight data" ("referenced flight data not found"); "field state" becomes "runway
  status"; Position ids follow the Position (LC/GC/AP).
- A test title that is also a golden key, a trace name or a Playwright grep target is left (list it).
- If a string change makes a Playwright spec's text assertion wrong, record the spec and line for BRIDGE; do not edit
  `e2e/**`.
