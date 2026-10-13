# Briefing: U-RESEARCH (research only, no code): release, transfer of control, PAR display, MARSA in a MOA

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-RESEARCH`, branch `lane/U-RESEARCH`, **commit at every step, at least every ~15
minutes**: the human stops sessions to save usage and rate limits cut lanes off). **Runs first** of round 2: U-RELEASE
(U5–U8) and the PAR half of U-PAR (U11) wait for it.

## Why

The human's round-2 findings (`docs/parallel/live-test-2026-10-13.md`, U1–U21; rulings in `decisions.md` **H138**) ask how
release, transfer of control and transfer of communications really work, and say the PAR display is wrong. The standing
rule is **H128: "FAA model, always"**: where an FAA order covers a behaviour, we build what the order says; anything we
invent is labelled ours. Every answer quotes the paragraph (number and words), names the edition, and says plainly when the
orders are silent (then the human decides).

## Read first

- `docs/parallel/research/control-release.md`: an earlier fact-check of release/handoff/comms (JO 7110.65BB Ch 2-1, 5-4,
  ICAO Doc 4444, EUROCONTROL). **Build on it, don't redo it**: re-verify its quotes against the current edition (JO
  7110.65BB with its latest change), fill its gaps, correct it where wrong.
- `docs/parallel/research/live-test-faa.md` (round 1, for the format and the editions already used).
- What we built, so the answer can say what changes: ADR 0017, 0039, 0101 (handoff accept moves radar ID only; control
  and release are separate), 0053/0102 (TOFI), 0051 and 0118 (MARSA), 0119 (airspace entry). Code:
  `crc-sync/src/efsp/board/ops/control-release.js`, `transfer-strip.js`, `coordination.js`, `tofi.js`;
  `crc-sync/src/efsp/authority/` (who may do what); client buttons in
  `crc-desktop/app/public/js/panels/efsp/` (search for "Request release", "Comms to", "Take control").

## How to read the orders

- faa.gov blocks WebFetch (HTTP 403). `curl -sL -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" <url>`
  works; HTML chapters: `https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap<N>_section_<M>.html` (JO
  7110.65BB), P/CG at `.../atpubs/pcg_html/`; PDFs via `pdftotext -layout`. Downloads go in a new directory in the
  scratchpad, never in the repo.
- Military radar/GCA sources (AFMAN 13-204, DAFMAN 13-204 vol 3, NAVAIR / FAA-STD for PAR displays, TM/FM for the
  AN/FPN-63, AN/TPN-22, AN/GPN-22): e-publishing.af.mil blocks downloads; use what is reachable, cite it, and say what
  could not be read.

## Questions (one section each in the output)

| # | For | Question |
|---|---|---|
| R1 | U9, U5 | **Release, transfer of control, transfer of communications** in JO 7110.65BB (¶2-1-14, ¶2-1-15, ¶5-4-3 to ¶5-4-6, ¶5-4-7 point out) and the P/CG (RELEASE TIME, TRANSFER OF CONTROL, RADAR HANDOFF, HANDOFF, POINT OUT): what each one moves, in what order they normally happen, and which may happen together. Can a transferring controller hand off **already released** ("handoff with control", "control for turns/descent" at the handoff, LOA-defined transfers ¶2-1-15 b)? What the receiver then needs to do (nothing?). |
| R2 | U9 | **Withdrawing an approved release**: can the transferring controller cancel or limit a release after granting it, before control is transferred? Quote, or "silent". After transfer of control, can it be taken back other than by a new handoff the other way? |
| R3 | U9 | **Does an approved (full) release move control and comms by itself**, or are they still separate steps? i.e. after "released" does the receiver still need to "take control" and "take comms"? Distinguish partial release (turns / climb / descent) from full. |
| R4 | U6 | **Can a receiving controller take control and comms without asking the transferring controller?** (¶2-1-15 c "assume control … only after it is in your area of jurisdiction unless specifically coordinated"; boundary/fix/time transfers; ¶5-4-5 comms "when the handoff has been accepted"). So: which of our buttons should the server refuse for the receiver, in which state, and which are legitimate (e.g. control at the boundary without asking). Read our code and list each receiver action with the FAA ruling beside it. |
| R5 | U7, U8 | Given R1–R4, what the receiver's Strip should show in each state (dark cockpit, H115–H119: show only a problem): which states are a problem the controller must act on and which are normal. Confirm U8 (Request release still offered after a full release) is a bug against the model, and name the code path. |
| R6 | U11 | **PAR display conventions**: azimuth scope scale (degrees from centreline vs feet), the elevation scope, cursor/tolerance lines, range marks; how the FAA/USAF PAR (AN/FPN-63, AN/TPN-22, AN/GPN-22 / STARS PAR) presents azimuth; whether "B-scope" is the right term. Compare with our panel (`crc-desktop/app/public/js/panels/efsp/par-model.js`, `par-panel.js`, mockup `docs/mockups/par-panel.html`, H115/H116: ±1° tolerance per axis, DA). Say what to change. |
| R7 | U17 | **MARSA in a MOA**: (a) FAA: JO 7110.65BB ¶2-1-11 (Use of MARSA), P/CG MARSA, JO 7610.14A, 7400.2R on MOA use: can two military flights in one MOA declare MARSA between themselves, and who must agree. (b) Ours: read the MARSA store (`crc-sync/src/efsp/marsa-store.js` and the client) and say whether two Strips in one MOA can declare MARSA today, **how** (click by click), and what ADR 0118's CA/MCI and ADR 0119's airspace alert then do between them. If not possible, say exactly what is missing. |

U16 is already answered (LT-VFR, H136), no section needed.

## Output

- `docs/parallel/research/release-and-par.md`: one section per question: the quotes with paragraph numbers and
  editions, the answer in plain words, **what it means for our build** (one short paragraph naming the files/ops), and
  "silent — the human decides" where so. R4 includes the receiver-action table (our action | state | FAA ruling | keep /
  refuse / change).
- Corrections to `control-release.md` go in the new file (a "Corrections to control-release.md" section), not as edits
  to the old file.
- **Questions for the human**, each with 2–4 options and a recommendation (the supervisor puts them on the Decision
  Desk as `U-RQ<n>`).
- A short **build sketch for U-RELEASE** (U5–U8: the ops/buttons/refusals to add or change) and for U-PAR's U11, so the
  supervisor can write those briefings from it.
- Final message per lane-rules rule 8 (docs only: no test counts; still never touch `crc-sync/state/` or :3000).
