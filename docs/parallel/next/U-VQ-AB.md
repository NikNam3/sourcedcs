# Briefing: U-VQ-AB: Conflict Alert suppress for a pair (VQ-A) and no invented "Class E" (VQ-B)

Written 2026-10-27 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-VQ-AB`, branch `lane/U-VQ-AB`; **`E2E_LANE=2`**). Everything under `nice -n 19`.
Running beside you: U-PANELS-GHOST (E2E 1, `crc-desktop/app/public/js/dock.js` and dock CSS; do not touch those).
Shared docs are not yours: write `docs/wip/U-VQ-AB.md`. Grep `decisions.md` (H173 is this lane's ruling), never read it whole.

## The rulings (H173, Decision Desk round 17, human 2026-10-27)

- **VQ-A: a**, keep the FAA definition: Conflict Alert fires on every tracked pair, IFR or VFR, whatever the area's VFR
  service. Note, verbatim: "but an option for the controller to cancell the ca so its not blinking in its face the whole
  time".
- **VQ-B: b**, CENTER's fallback and the carrier control area become **unclassified, `ADVISORY`** (same behaviour, no
  invented letter). Note, verbatim: "CCA is special use and is always handled via altter of agreeent also navy rulings
  hold so very complicated dont want to worrie about that for v2 we can keep it unclassifed for now".

## Part 1: suppress a Conflict Alert for a pair (VQ-A)

FAA model first (memory rule: check the paragraph). Read JO 7110.65BB ¶5-14 (ERAM/STARS automation: CA, MCI,
suppression; 5-14-6 c is already cited for groups) and JO 7210.3 for what a controller may suppress and for how long. Quote
what you use in the ADR. Today `crc-sync/src/conflict-alert.js` suppresses only by standing rules (formation, MARSA,
per-Position inhibit, ADR 0118); there is no controller action.

Defaults (P2; take them unless the FAA text clearly says otherwise, and log it):
- A controller who sees the CA at their Position may **suppress it for that pair** from the alert itself (the track
  label's menu, ADR 0140, and wherever the CA is listed, e.g. the track/alert rows). One click, no dialog.
- The suppression ends by itself when the pair stops alerting (no stale suppressions) or when either track drops; it
  holds for that pair only, never for a third aircraft.
- Scope: the suppressing Position (the one acting Position, rule 9); other Positions still see the alert.
- Suppressed is not hidden: the flashing stops and a grey `CA` stays on both labels (dark cockpit), so it can be seen.
- Server-side and synced (the alert is delivered by `deliverableTo`): a new op or message; refusal codes join
  `REFUSAL_CODES`; then `cd crc-sync && npm run wire:record` (check the protocol: the last release shipped 1, the tree
  carries 2; no further bump if the record says none). Mission clock, not `Date.now()` (rule 5).
- New ADR **0145**; the next free number. MCI: same action if it costs nothing extra, else leave it and say so.

## Part 2: unclassified CENTER and carrier area (VQ-B)

- `crc-sync/src/efsp/airspace/jurisdiction.js:33` `FALLBACK_AIRSPACE_CLASS = 'E'` → unclassified with `vfrService`
  `ADVISORY`; `airspace-store.js:~303` comment; `config/efsp-airspaces.json` `CVN-72-CCA` (`airspaceClass` gone,
  `vfrService: ADVISORY`; fix its `sourceText` and the file's `_comment` "CENTER's (Class E)", "its class E ours").
- Every client place that prints the class (card, badge, VFR read-outs) must show nothing invented for these
  (`command grep -rn -i "class" crc-desktop/app/public/js/panels/efsp | command grep -i airspace`).
- Deploy note for the wip note: the deployed Board imported `CVN-72-CCA` as Class E once (standing areas import once),
  same as LTAG-RAPCON's "Class C": AP edits it (CLASS none, VFR SERVICE advisory) or Board reset.
- Freeze goldens: if they move, `npm run freeze:update` in its own commit, diff checked small.

## Gates

The test files you touched while working; once before the report: both unit suites, freeze, walk (`npm run walk` only if
you touched the authority tables), `soak:selfcheck` if you touched `wire/**`, `ws-hub.js` or `board/**`; Playwright only
the specs for what you changed (a new spec for the suppress click) on E2E lane 2. Final message per rule 8.
