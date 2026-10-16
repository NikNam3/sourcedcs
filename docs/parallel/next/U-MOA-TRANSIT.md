# Briefing: U-MOA-TRANSIT, phase 1 (research + design + mockup, docs only): transiting an active MOA, ADR 0127

Written 2026-10-16 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-MOA-TRANSIT`, branch `lane/U-MOA-TRANSIT`; no `E2E_LANE`, no Playwright except
to screenshot your own mockup headless). **Commit at every green step, at least every ~15 minutes.** ADR number
**0127** (yours, written as *Proposed* in this phase). **No code in this phase**: the human reviews the design and
answers your questions first; the build is a second dispatch.

Running beside you: **U-SMALL** and **U-DECLUTTER** (code lanes). You touch only `docs/adr/0127-*`,
`docs/mockups/moa-transit.html` (+ one line in `docs/mockups/index.html`), `docs/research/moa-transit.md` and
`docs/wip/U-MOA-TRANSIT.md`.

## Why

**H148** (read it whole in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`): transiting a MOA is its own
case, IFR or VFR. A MOA not in use: transit is trivial. A MOA in use: ATC either **declines** the transit or **accepts
and guarantees separation**, usually by altitude (or lateral) deconfliction: ATC restricts the MOA aircraft on the
working frequency ("maintain block FL200–FL240"), restricts the transiting aircraft ("remain at or below FL190"), and
once it has passed clears the MOA aircraft to **resume operations**. Also H128 (FAA model, always: find and quote the
paragraph before calling a design right; label anything we invent as ours), H140/ADR 0124 (U-MOA's card list), ADR 0119
(entry alert, using agency approves), ADR 0125 (jurisdiction areas), dark cockpit H115–H119.

## Phase 1: what to deliver

1. **Research** (`docs/research/moa-transit.md`, quotes with paragraph numbers): FAA JO 7110.65 Chapter 9 Section 3
   (Special Use, ATC-Assigned Airspace and Stationary ALTRVs: ¶9-3-1 onward, separation minima from SUA, transit of
   active SUA, "the using agency", "controlling agency"), JO 7610.4 (Special Military Operations) MOA rules, JO 7400.10
   / AIM 3-4-5 (MOA: IFR traffic may be cleared through when IFR separation can be provided, VFR pilots should exercise
   caution), and whatever the real-world practice is for altitude-block deconfliction between MOA users and a transit
   (a USAF/ANG letter of agreement example if one is public). Say plainly where the FAA order is silent and the H148
   model is the squadron's own. If faa.gov answers 403, try the order's PDF mirrors / other public copies and name the
   source; never paraphrase a paragraph you have not read.
2. **Design (ADR 0127, Proposed)**, built on what exists (read first: `crc-sync/src/efsp/airspace-entry-alert.js`
   `trafficFor`/`routeNames`/`ENTRY_TYPES`, the airspace store's `jurisdictionAt`/`isInsideJurisdictionOf`, ADR 0119,
   0124, 0125, the airspace card `crc-desktop/app/public/js/panels/efsp/airspace-card.js` and `airspace-entry-list.js`):
   - **who** handles a transit request (the controlling Position vs the using agency, OPS at Incirlik) and how the
     request reaches them (the transiting flight's holder asks; FAA practice decides);
   - **decline / accept**; on accept a **temporary block restriction** on the MOA users (a record on the airspace
     activation or on each MOA flight's Strip: your call, argued) and an **altitude (or lateral) restriction** on the
     transiting flight; **"resume operations"** clears the block restriction (manually; whether the system proposes it
     once the transit has left the MOA is a question);
   - **alerting** if either side busts its restriction (dark cockpit: amber, which alert family, who sees it;
     interaction with ADR 0119's entry alert and ADR 0118's CA/MARSA);
   - a MOA **not in use**: transit needs nothing (confirm against the order);
   - **route-crossing geometry** for the card list, replacing U-MOA's name-match default: how a filed route becomes
     points (stereo routes, DCS waypoints, ATO), which data exists today, what "filed through" means when no geometry
     is available;
   - wire shape sketch (ops, frames, refusal codes) and which stores move, so the build can be sized.
3. **Mockup** `docs/mockups/moa-transit.html` in the style of `docs/mockups/lc-pattern.html`: the airspace card with a
   pending transit request, the accept dialog (block for the MOA users + restriction for the transit), the restriction
   marks on both Strips, the bust alert, "Resume ops". Check it headless (Playwright from `crc-desktop`, `NODE_PATH`).
4. **Questions for the human** in the wip note, each with options and a **recommended** answer (they go on the Decision
   Desk): at least who handles a request, where the block restriction lives, whether resume is proposed automatically,
   lateral deconfliction in scope or altitude only, VFR transit handling.

## Output

Commits on `lane/U-MOA-TRANSIT`; the research note; ADR 0127 (Proposed); the mockup; `docs/wip/U-MOA-TRANSIT.md`
(design summary, questions with recommended answers, a build plan with files and tests for phase 2, defaults taken);
final message per lane-rules rule 8.
