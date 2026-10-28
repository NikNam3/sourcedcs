# Briefing: DOCS-V2B (docs only): fold every merged wip note since DOCS-V2 into the shared docs, before the v2 deploy

Written 2026-10-27 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-DOCS-V2B`, branch `lane/DOCS-V2B`; no `E2E_LANE`, no Playwright). **Commit at every
green step, at least every ~15 minutes; one commit per shared doc where you can.** No other lane is running: the shared
docs are yours. Everything runs under `nice -n 19`.

Same shape as the last pass: read `docs/parallel/next/DOCS-V2.md` (its briefing) and `docs/wip/DOCS-V2.md` (its
report, incl. "Left for a later pass") first, and follow their conventions (guide voice, no lane or H-number jargon in
the guide body, a per-note fold table in your wip note).

**Token economy:** `docs/parallel/decisions.md` is 350 KB: never read it whole, `command grep -n` the rows named below.
Batch your reads; check names with `command grep`, do not read source files whole.

## You own (rule 3 exception)

`docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`, `CLAUDE.md`, `docs/glossary.md`, `crc-desktop/README.md`,
`crc-sync/README.md`, `infra/RUNBOOK.md`, `crc-desktop/build-assets/release-notes.md` (keep its format). No code, no ADR
edits (P4), no `docs/wip/*` edits except your own `docs/wip/DOCS-V2B.md`.

## Sources (merged work only; read each whole, ~1200 lines in all)

- `docs/wip/`: `U-V2-FIXES`, `U-SURFACE`, `U-LTAG-COURSE`, `U-LABEL-MENU`, `U-PERF`, `U-PAR-FT`, `U-FT-SMALL`,
  `U-FT-FIXES`, `U-BEACON-ONLY`, `U-VFR-MTMA`, `U-DRAG-CLICK`, `U-PANELS-RADARS`, `U-SUA`; research
  `docs/parallel/research/sua-types-and-transit-end.md` as background only.
- **Not merged, do not document:** U-ROLE-POSITIONS (held, S-ARCH-85).
- Rulings in `decisions.md` **H161–H171** and **S-ARCH-86–109** (a ruling wins over a wip note; the merged code wins over
  both: check every name you write with `command grep` in `crc-sync/src`, `crc-sync/config`, `crc-desktop/app/public/js`).
  Note H171: FT-Q11 reverted the range-ring switch (`0b793660`); do not document that switch.
- ADRs **0139–0144** as merged.

## Known items

1. **Usage guide:**
   - §8C correlation: no callsign correlation and no `TRK?` / provisional `?` any more (ADR 0142); a typed AI synthetic
     code correlates; `CODE_REISSUED`. Remove every `TRK?`/`?`/confidence text.
   - VFR (ADR 0143): optional airspace class, per-area VFR service, the MTMA unclassified IFR-separated, LTAG-CZ Class D;
     CD's VFR departure and its read-out (Block 9K DIR). VQ-A/B/C on the Desk are open: document as built.
   - SUA (ADR 0144): Transit complete (who may end it, the approver's grey `transit complete` line with Acknowledge,
     re-entry alerts again); area types are the FAA SUA types only (no RANGE/DANGER; a range controller is the using
     agency); PROHIBITED is always in force (`IN FORCE`, no activate/release, entry alerts always).
   - Track-label menu (ADR 0140, FT-Q10 a menu only), PAR final heading display and glidepath-only alerts (ADR 0139,
     FT-Q13), LTAG course 052.7 true, airport surface (H162), drag/click (16 px tab threshold, drop follows the ghost,
     left-edge marker tooltips), PANELS radar list collapsed, METRICS panel Server section (ADR 0141), and the
     final-test small fixes (H163/H164 items) wherever controllers see them.
2. **Briefing** (`docs/efsp-briefing.md`): state as of the tip `e7b46423`; new wire/store names since DOCS-V2; held
   U-ROLE-POSITIONS and the v3 list (`docs/parallel/v3-backlog.md`).
3. **`infra/RUNBOOK.md`, section "v2 launch (round 2 …): before the deploy"** (rename to cover ADRs up to 0144) gains:
   - the deployed Board keeps LTAG-RAPCON as "Class C" (standing areas import once): AP edits it (CLASS none, VFR
     SERVICE IFR separated) or a Board reset;
   - any live RANGE or DANGER airspace in the Board or a `state/efsp-airspaces.json` stops start-up (ADR 0144; none
     known): delete or retype;
   - correlation `confidence` is still accepted on restore (S-ARCH-102 D1) and goes at the next reset;
   - anything else the 13 notes list as a deploy step (`command grep -n -i -e deploy -e "state/" -e reset` in them).
4. **CLAUDE.md** (terse): only what moved, e.g. a new strict `state/` file, new counts, `server-resources.json`.
5. **Release notes:** the controller-facing lines from all 13 notes.
6. **Glossary:** new terms only if the guide uses them (transit complete, VFR service, synthetic code, …).

## Output

Commits; `docs/wip/DOCS-V2B.md` (fold table per note, contradictions and how resolved, what is left). Gates: docs only,
but run the tests that read docs (`ls crc-sync/tests crc-desktop/tests | command grep -i -e doc -e gloss -e claude -e
readme`) and both unit suites once before the report (`nice -n 19`). Final message per rule 8.
