# Briefing: DOCS-R2 (docs only): fold the live-test batch and U-STRIP into the shared docs

Written 2026-10-14 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-DOCS-R2`, branch `lane/DOCS-R2`; no `E2E_LANE`, no Playwright). **Commit at every
green step, at least every ~15 minutes.** Runs alongside U-PANELS, U-JURISDICTION and U-MOA: those lanes write only
their own `docs/wip/<LANE>.md` and ADRs, so the shared docs are yours for this lane.

## You own (rule 3 exception)

`docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`, `CLAUDE.md`, `docs/glossary.md`,
`crc-desktop/build-assets/release-notes.md` (fold the wip notes' "Release note" lines; keep the file's own format).
No code, no ADR edits (P4), no `docs/wip/*` edits except your own `docs/wip/DOCS-R2.md`.

## Sources (merged work only, read each whole)

- `docs/wip/LT-*.md` (TERRAIN, UI, AIRSPACE-FIX, CORRELATION, SFA-PAR, PAR-MISSED, STRIP-FIELDS, MARSA,
  AIRSPACE-ALERT, VFR) and `docs/wip/U-STRIP.md`, `docs/wip/U-RESEARCH.md` (background only).
- Rulings: `docs/parallel/decisions.md` H133–H146, S-ARCH-48–61 (decisions win over a wip note; the merged code wins
  over both: check every name you write with `command grep` in `crc-sync/src` / `crc-desktop/app/public/js`).
- ADRs 0117–0121 (as merged).

## What to do

1. **Usage guide**: every controller-visible behaviour the batch added or changed, in the guide's voice and section
   layout (no "lane"/"H-number" jargon in the guide body). Known gaps: flight following, the airspace-entry alert
   (ADR 0119) and approving entry, MARSA (ADR 0118: `AcknowledgeVoid`, tanker distance), Mode C intruder alerts
   (`modeCIntruder`), the SFA/PAR changes (ADR 0117), Strip face round 2 (U-STRIP: blocks cut with "…", RMKS row and
   remarks popover, grey `COMMS:`/`CTRL:`), **§4A stereo routes** (now wrong: no remarks, picker shows names only;
   wording in `docs/wip/U-STRIP.md`).
2. **Briefing** (`docs/efsp-briefing.md` §1/§3/§4/§5): state of the live-test batch and round 2 (U-STRIP merged;
   U-PANELS, U-JURISDICTION, U-MOA running; U-RELEASE, U-PAR, U-RSU, small items, U-CARRIER queued, see
   `docs/parallel/supervisor-handoff.md`). Wire names (`airspaceEntry`, `TANKER_DISTANCE`, …) where the briefing lists
   wire/store facts.
3. **CLAUDE.md**: "six stores" → the actual count (check `crc-sync/src/efsp/stores.js` and the soak's
   `tools/soak/shadow.js`; fix both mentions consistently), plus any fact the batch made stale. Keep CLAUDE.md terse:
   it is read on every session.
4. **Do not document** the handoff/release model beyond what is merged: U-RELEASE (ADR 0122) replaces it soon. Do not
   document jurisdiction areas or the MOA flight list (lanes running now).
5. `docs/wip/DOCS-R2.md`: what you folded from each note, anything you found contradictory (note, ruling, code) and how
   you resolved it, items left for the next docs pass.

## Gates

Docs only: no test suites needed, but run `cd crc-sync && node --test tests/*docs*.test.mjs tests/*glossary*.test.mjs`
(whatever exists: `ls crc-sync/tests crc-desktop/tests | command grep -i -e doc -e gloss -e claude`) since some tests
read docs. Final message per lane-rules rule 8.
