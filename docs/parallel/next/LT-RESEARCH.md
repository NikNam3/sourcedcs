# Briefing: LT-RESEARCH (research only, no code) — the live test's FAA questions

Written 2026-10-12 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-LT-RESEARCH`, branch `lane/LT-RESEARCH`, commit at every step). **Runs first**: the fix
lanes marked [R] in `LIVE-TEST-FIXES.md` wait for it.

## Why

The human's live test on 2026-10-11 (`docs/parallel/live-test-2026-10-11.md`, T1–T31) found designs that had been built
from our own guide instead of the FAA orders. The human's rule since then, **H128: "FAA model, always"**: where an FAA
order covers a behaviour, build what the order says; anything we invent is labelled ours. Every answer below must quote
the paragraph (number and words), name the edition, and say plainly when an order is silent (then the human decides).

## How to read the orders

- faa.gov blocks WebFetch (HTTP 403). `curl -sL -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" <url>`
  works; HTML chapters: `https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap<N>_section_<M>.html` (JO
  7110.65BB); PDFs via `pdftotext -layout`. Put downloads in a new directory in the scratchpad, never in the repo.
- Already confirmed by the supervisor (quote, don't redo): JO 7110.65BB ¶4-7-3 (SFA), ¶4-7-4, TBL 2-3-3/2-3-4 Block 3 and
  ¶2-3-6; JO 7610.14 (with Chg 1, 3-21-24) ¶7-1-5 (SFA).
- Air Force sources (AETCI 11-204 on RSUs) are on e-publishing.af.mil, which blocks downloads; summaries only.

## Questions (one section each in the output)

| # | For | Question |
|---|---|---|
| Q1 | T1 | SFA under JO 7610.14 ¶7-1-5 / JO 7110.65 ¶4-7-3: how does the radar approach controller hand an SFA aircraft to the GCA (PAR) controller — the strip/transfer side, and which three of the five frequencies rotate; anything in JO 7110.65 Chapter 5 Section 10/12 on the approach-to-GCA handoff |
| Q2 | T5 | What ends the PAR (GCA final) controller's part of an approach that lands: the landing clearance relay from the tower, "landing assured"-type phraseology (does it exist in JO 7110.65?), when the flight leaves the PAR controller, and what happens on a missed approach (¶5-12-x, ¶5-10-x) |
| Q3 | T11 | During a PAR final: does the controller issue headings (course guidance) and are they "assigned headings"; what the approach clearance does to a previously assigned altitude (¶4-8-1, ¶5-12-x); so: should altitude/heading conformance alerts run on a flight on the PAR final, and against what |
| Q4 | T7 | The **wake category indicator** in strip Block 3 (TBL 2-3-3/2-3-4): which letters (heavy `H/`, super `J/`, the consolidated wake categories of ¶5-5-4?), with the strip examples (FIG 2-3-x); the format of Block 3 with and without a count and an indicator (e.g. `2/H/B763/L`, `F16/G`) |
| Q5 | T8 | The **full block lists** of terminal strips (TBL 2-3-3 arrival, 2-3-4 departure, 2-3-5 overflight, and the en-route TBL 2-3-1 where we copy it), each block's name; common FAA abbreviations (P-time, …); then a **mapping table** from our block ids/labels (`crc-desktop/app/public/js/panels/efsp/strip-template.js` and `crc-sync/src/efsp/block-map.js`) to the FAA name, marking ours (military blocks) |
| Q6 | T16, T17, T18 | Air refueling and MARSA: JO 7110.65 Chapter 9 (air refueling, MARSA), JO 7610.14 (aerial refueling); when ATC's separation responsibility ends between tanker and receiver; whether tanker and receivers become a **formation** (P/CG FORMATION FLIGHT, ¶2-1-13) at join-up or stay MARSA only; what that means for the receiver's assigned altitude and for conflict alerts between them. The human's account of the procedure: ATC places the receiver about 1 NM behind and 1,000–2,000 ft below, hands it to the tanker, which clears the join-up; not a formation Join that would void the receiver's flight plan |
| Q7 | T16 | Conflict alert between aircraft of one formation (standard/nonstandard formation): does any FAA rule or system (STARS CA) exclude them |
| Q8 | T27 | Special use airspace roles: **controlling agency** vs **using agency** (P/CG; JO 7400.10, JO 7400.2, JO 7610.14): who creates/schedules/activates/releases a MOA; so whether a using agency (Incirlik OPS) should create or only book a MOA that CENTER controls |
| Q9 | T29 | Any FAA automation that alerts on an aircraft entering active SUA/SAA without authorization (ERAM airspace/SAA probe, STARS) — if yes, its behaviour, so our alert follows it (H132: built either way) |
| Q10 | T4 | Which radars present ground vehicles: ASR/ARSR and military approach radars (MTI/clutter), surveillance for GCI/AWACS; surface movement radar (ASDE). Sources, not memory |
| Q11 | T12 | Beacon-code correlation: how STARS/ERAM acquire a track by the **assigned** code (JO 7110.65 ¶5-2-x, ¶5-3-x); whether an earlier flight's association blocks it |

## Output

- `docs/parallel/research/live-test-faa.md`: one section per question — the quotes with paragraph numbers and editions,
  the answer in plain words, what it means for the lane (one short paragraph), and "silent — the human decides" where so.
- The Q5 label table as its own section, ready for the human to approve.
- A list of any question for the human, phrased with options (the supervisor puts them on the Decision Desk).
- Final message per lane-rules rule 8 (no test counts needed: docs only; still run nothing that touches `state/`).
