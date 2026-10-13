# Briefing: U-MOA (server + client): OPS approves from the airspace card; MARSA in a MOA survives assignments — ADR 0124

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-MOA`, branch `lane/U-MOA`, `E2E_LANE=7`). **Commit at every green step, at least
every ~15 minutes.** ADR number **0124** (yours; amends ADR 0119 §1 and ADR 0051/0118's void rule, never edit them).

## Why

Rulings **H140** (LT-AQ1 b) and **H141** (U-RQ6 a), `decisions.md`. Research: `docs/parallel/research/release-and-par.md`
R7 (MARSA in a MOA: works today, one gap). H128 (FAA model), dark cockpit.

## What to build

### 1. Flight list on the airspace card (LT-AQ1 b, H140)

OPS is Incirlik's using agency and may approve entry (ADR 0119, `isAirspaceUsingAgency`), but its Bays hold only its own
Strips, so it cannot reach AP's or CTR's flights. The **airspace card lists the aircraft inside the airspace or filed
through it**, each with **Approve** (and the approved state shown grey once done; amber only while inside unapproved, the
same condition that raises the alert). Shown to whoever may approve entry for that airspace (the using agency, the
controlling Position); others see no list (dark cockpit). Approve goes through the existing approve-entry op
(`board/ops/approve-airspace-entry.js`) with the same rights and refusals; the server already allows OPS (S-ARCH-58).
"Inside" = what the airspace-entry monitor already computes (`airspace-entry-alert.js`); "filed through" = route crosses
the airspace (reuse whatever the alert/MTR code has for route-vs-polygon; if nothing exists, inside-only plus flights
whose Strip already names the airspace, and log it as a default). An uncorrelated contact has no Strip and cannot be
approved here (ADR 0119 stands). Server: the card needs the list per session — add it to the existing per-session
airspace delivery (`airspaceEntryFor`) rather than a new frame if you can; any wire change → `npm run wire:record`.

### 2. MARSA void before rendezvous only for tanker MARSA (U-RQ6 a, H141)

`crc-sync/src/efsp/marsa-store.js` `voidForAssignment` (l.~558, reached from `set-block.js` via `ctx.marsaVoidFor`) voids
every MARSA without `rendezvousAt` on the first heading/altitude assignment. The FAA void rule is refueling's (¶9-2-13 d
NOTE). Apply it **only when `startEvent === 'TANKER_ACCEPTED'`**; `LOCAL_DECLARATION` and `MTR_ENTRY` relations survive
assignments. Client: if the MARSA popover tells a non-tanker MARSA to "Mark rendezvous", drop that hint.

## Tests and gates

- Unit: marsa-store void cases (tanker voids before rendezvous; local declaration does not); airspace card list
  (inside, filed-through, approved, not shown to a Position without approval rights; OPS approves AP's flight). Both
  unit suites; `npm run walk`; `npm run freeze` (+ `freeze:update`, small explained diff, separate commit);
  `soak:selfcheck` if Board/wire/hub moved; `wire:record` on any wire change.
- e2e: OPS opens a MOA card, sees AP's flight inside it unapproved (amber), presses Approve, the alert clears on AP's
  side; two Strips declare a local MARSA, a heading is assigned, the MARSA stays. `E2E_LANE=7`, your specs only.

## Output

Commits on `lane/U-MOA`; ADR 0124; `docs/wip/U-MOA.md` (usage-guide wording incl. the R7 click-by-click for MARSA in a
MOA, defaults taken, findings); final message per lane-rules rule 8.
