# Briefing: U-LABEL-MENU (client, maybe server): assign heading, speed, altitude from the track label (H164 FT-Q4 a)

Written 2026-10-24 by the supervisor. One agent, Opus 5.5. `docs/parallel/lane-rules.md` binds (worktree
`/home/nklx/dev/personal/sourcedcs-U-LABEL-MENU`, branch `lane/U-LABEL-MENU`, `E2E_LANE=9`). **ADR 0140** (yours).
v2 scope, lean. H160 binds. Dark cockpit.

## What
A click on a track's label (data block) opens a small menu to assign **heading, speed, altitude** for the flight's
correlated Strip, offered to **whichever Position owns that Strip** (any Facility; the rule names the acting Position,
never an id). The entries are the Strip's own assignment cells (the same ops the Strip cells send: find them in
`strip-template.js`/`strip-fields.js` and the cell editors), so conformance, release attestation (H100 DR-1/DR-10) and
the Mutation log behave exactly as when typed on the Strip; refusals show the same way. No Strip, not the owner, or an
uncorrelated contact: today's behaviour (H71 default 7: a click on the block opens the track panel; keep that reachable,
e.g. as a menu item or a modifier). Keyboard: typing the value and Enter, Esc closes; one input where possible (H95
one-input ceiling style).

## Beside you
U-FT-SMALL (topbar bullseye, STARS letters in `atc-scope.js`), U-PAR-FT (PAR panel, APRT line), U-PERF (metrics).
The STARS data block lives near `atc-scope.js`: add, don't reshape.

## Gates
Unit tests for the rule (owner/non-owner, N facilities) and the menu; both unit suites; new spec on `E2E_LANE=9` plus
`l22-stars-scope`, smoke. `nice -n 19`. Output `docs/wip/U-LABEL-MENU.md`, ADR 0140; report per rule 8.
