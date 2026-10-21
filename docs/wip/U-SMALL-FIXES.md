# U-SMALL-FIXES (lane note)

Briefing: `docs/parallel/next/U-SMALL-FIXES.md`. Decisions S-ARCH-75, S-ARCH-76, H156 (MTB-Q2 b, MTB-Q3).

## Item 1: a cleared assignment is no clearance (`vfr.js`, S-ARCH-76)

- `setClearance` records clearing an altitude or heading as an ACTIVE entry with an empty value (ADR 0058's
  append-only history, the docstring says so). Kept at the source: the clearing is an amendment and stays in the cell.
- `hasNoClearance` (server and client hand copy, parity test) now counts only an ACTIVE entry with a non-empty value;
  an entry with no string value (hand-built shapes) counts when it has a parsed value or a block.

## Defaults taken

- Item 1: clearing stays an entry (not removed at the source); the reader is fixed instead.
- Item 3: judge at once after the skipped frame rather than pick an unrepairable frame (none exists).

## Item 2: spec cleanup sends `baseDefRev` (S-ARCH-76)

- `crc-desktop/e2e/airspace-entry-alert.spec.js` sends `{ baseDefRev: a.defRev }` with `DeleteAirspace` and now polls
  that the airspace is gone (so a refused cleanup fails the spec). The other specs that delete airspaces
  (`airspace-badge`, `moa-transit`, `u-moa`) already sent it; `airspace-panel` checks the UI sends it. Passed on lane 7.

## Item 3: soak `skip-shadow-client` on every seed (S-ARCH-75)

- Why seeds 15, 16, 23, 26 failed: the dropped frame is a Drop's delta (`gone: [id]`), and a later delta that touches
  the DROPPED Strip lists it in `gone` again (`wire/frames.js` `touchedStrips`), so the shadow was already right at the
  next 60 s checkpoint (seed 15: dropped at 187.8 s, repaired by seq 127 at 223.6 s, checkpoint at 240 s).
- No frame is beyond repair (any later touch re-sends the `gone`), so the fix is the one drop-broadcast already uses:
  `send()` judges the client that missed the frame at once (`where: 'post-skip'`), while the withheld Drop is the newest
  truth. Seeds 1–30: all ok (drops 1, staleness 1, cause UNKNOWN).
