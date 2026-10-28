# Briefing: R-SUA (research, read-only on code): after a transit, and how we model special use airspace types

Written 2026-10-25 by the supervisor. One agent, Opus 5.5. Research lane: **no code changes**. Worktree
`/home/nklx/dev/personal/sourcedcs-R-SUA`, branch `lane/R-SUA`; you commit only the research note. Follow
`docs/parallel/lane-rules.md` (rules 1–4, 6, 8; no E2E). Rule H128, "FAA model, always": every answer quotes the
paragraph and names the edition; where an order is silent say **silent — the human decides**; label inference.
Read the house style first: `docs/research/moa-transit.md` and `docs/parallel/research/vfr-flight-following.md`
(same sources; faa.gov HTML may answer 403 to a plain fetch: try the PDFs under `faa.gov/documentLibrary/media/Order/`,
the eCFR API, or mirrors, and say which copy you read).

## The human's questions (2026-10-25)

1. **"Once a transit through an airspace is complete, what then?"** Find what our app does today when a transit
   ends (`crc-sync/src/efsp/airspace-store.js` transit ops, TRANSIT_STATES, ADR 0127, H148; the client cards
   `airspace-entry-list.js`, `transit-rules.js`; the airspace-entry alert ADR 0119/0124): does anything close the
   transit (the aircraft leaving the volume? a controller action? the flight's Strip going?), what does the
   controlling/using agency see, does a re-entry need a new approval, what happens on the Strip. Then what the FAA
   says happens at the end of a transit/approval through SUA (JO 7110.65BB §9-3, JO 7610.14A, JO 7210.3EE,
   7400.2R ch. 21–25, AIM 3-4): notification to the using agency on exit? return of the airspace? Compare, list gaps.
2. **"Are we modelling danger, warning, restricted and prohibited areas correctly by FAA rules? (All MOAs are danger
   areas.)"** Our area types are `MOA, RANGE, DANGER, RESTRICTED, PROHIBITED, WARNING` (`airspace-schema.js`).
   For each: what the FAA defines (14 CFR 73, 7400.2R, P/CG, AIM 3-4), who may enter it (IFR / VFR / with whose
   approval), what ATC must do (separate non-participants? clear through? advise?), and what our app does today
   (entry alert by type, H136 VQ4 b: MOA/warning never alert for VFR, restricted/prohibited/range/danger alert unless
   approved; transit approval; IFR denial; MARSA etc.). **"Danger area" is not an FAA SUA type** (it is ICAO,
   Annex 11 / Doc 8126; the FAA's international-water analogue is the warning area): say exactly how the FAA treats an
   ICAO danger area, and what the human's "all MOAs are danger areas" means for us. Türkiye publishes its military
   areas in AIP ENR 5.1/5.2 (P/R/D, LTD…): find whether Turkish MOA-like areas are published as D areas, and how the
   FAA model maps onto that (the AIP server dhmi.gov.tr times out often; try, then fall back). Also `RANGE` (ours?
   FAA has no "range" SUA type: say what it maps to) and the route types `IR, VR, SR, LLTR` only if they bear on it.
   Cross-check every row of our behaviour against the quotes; mark each **matches / differs / ours / silent**.

## Output

`docs/parallel/research/sua-types-and-transit-end.md`: sources and editions table; Q1 and Q2 each with "what the
orders say" (quotes), "what our app does" (file:line), "answer in plain words", "gaps"; and a final list of proposed
**Decision Desk questions** for the human (each with options and a recommended one). Commit it on your branch. Final
message per rule 8: the plain-words answers to both questions, the gaps, the proposed questions.
