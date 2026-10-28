# L20-GUIDE: the usage guide's sourced/ours wording, guide §4.8, the glossary, and ADR 0077

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the docs on your base win over the L9 line numbers.

| | |
|---|---|
| Wave | 2: start in the first slot a wave-1 lane frees; write ADR `0077` only after every wave-1 lane has reported |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-GUIDE` on `lane/L20-GUIDE` |
| Model / size | Sonnet 5.5 / M: usage guide (1,481 lines) L9 B1-B18 + F45 + the facility section, `EFSPImplementationGuide.md` §4.8 relief wording, the glossary note, one new ADR with ~6 errata rows plus the lanes' finds |
| Wip | `docs/wip/L20-GUIDE.md` |
| ADR / E2E lane | **`0077`** (reserved for L20 since L20PREP; take no other number) / none |

## Goal

A controller reading the usage guide can tell what is ours and what is sourced (guide §13, D11; S-L9 E9); the
implementation guide calls a controller replacing another at a Position **position relief**, not a handoff (S-RENA1);
the glossary says so; and ADR `0077` records every correction to an earlier ADR that L9, the prep and the L20 lanes
found (P4: ADRs are never edited), plus the `[SOURCE-DEFINED]` conventions the README fixes.

## Owns

`docs/efsp-usage-guide.md`, `EFSPImplementationGuide.md`, `docs/glossary.md`, the new
`docs/adr/0077-<slug>.md`, `docs/wip/L20-GUIDE.md`. (These docs were the integrator's in the prep's plan; in L20 this
lane owns them, so the prep's "draft in `docs/wip/L20.md`" step is replaced by editing them directly.)

## Frozen for you

Every committed ADR, every code file, `CLAUDE.md`/READMEs/briefing (L20-DOCS), history docs.

## Steps

0. **Step 0.** Re-find every L9 B row (`docs/wip/L9-source-defined-inventory.md` Group B, B1-B18) and F45 in the
   current usage guide by its quoted text: DOCFOLD and RENAME-C rewrote much of it, and the guide already has several
   "*What is ours, not doctrine:*" paragraphs (`grep -n "What is ours"`). Classify each row: already done / still to
   do / moot (B12: TA made the transition altitude per theater, Syria 10,000 ft, H62: check the wording names
   `config/theaters.json`). Step-0 note to "main".
1. **Usage guide B rows** (still-to-do ones), with the L9 wording adapted to the new vocabulary (LC/GC/AP, strip type,
   runway status, CA). F45: "guide §4.2" cited for Rack order is the `[SOURCE-DEFINED]` Bay table; cite guide §1
   "Rack" and Annex §9. Commit.
2. **"What is ours and what is sourced"** (B18, E9, after the surveillance section): one section listing once the
   SOURCE-defined things a controller sees without a marker: the state sets and labels (`RUNWAY_GATED_STATES`, the
   runway-status button labels), the Bay sets and facility data (from L20-CORE's facility-notes list: Incirlik
   headings 056/236, `LTAG`, acknowledgers, inspection authority, pad names, gear, accessRoute: "squadron data to
   verify"), the synthetic code block 6000-6777, radar figures and kinds, the alerting thresholds, the SFA/carrier/
   pattern thresholds, "SOURCE practice" (what the phrase means), and the H61 "kept, labelled" figures. Link each to
   its ADR. Fold any existing "*What is ours, not doctrine:*" paragraph by linking to the section, not by deleting it.
   Commit.
3. **`EFSPImplementationGuide.md` §4.8** (S-RENA1): where §4.8 (heading "Position staffing, combination and
   handoff", §4.8.1 "... makes handoff nearly free") means one controller replacing another at a Position, say
   **position relief** (find the FAA source in `docs/parallel/research/vocabulary.md`; cite it as that file does);
   where it means a Strip/radar handoff, keep "handoff". Section numbers and anchors stay (code cites `§4.8.x`);
   grep `docs/` and the code for links to a changed heading anchor. Commit.
4. **Glossary.** The hand-over row's note: "handoff" is a strip/radar handoff (P/CG, JO 7110.65 §5-4-5/6); a
   controller replacing another is position relief. Add a line under the header: "Corrections to committed ADRs:
   ADR 0077". Commit.
5. **ADR `0077`** (after every wave-1 lane has reported; read their wips' "ADR errata" and "Mirror" sections). Title
   along the lines of "`[SOURCE-DEFINED]` markers: house style, and errata to earlier ADRs". Context (guide §13, D11,
   L9, the refactor). Decision: the marker house style and where markers are required (README rule 5 verbatim in
   substance), "SOURCE practice" as a string convention, mirrored pairs, the "What is ours and what is sourced"
   section. Errata table (`ADR:line` | says | is | evidence): `0033:21` (E5: "GND and CD are not radar positions in
   any facility, real or simulated" is the squadron's model), `0042` (names `radar-specs.json`; the file is
   `config/sensor-specs.json`), `0048:14` and `0079:80-85` (describe `theater-settings.js`, removed by ADR 0085),
   `0081` (the reply is `efsp-resync-reply` with `answer: snapshot|delta`, R3-47, not a bare `efsp-resync`
   answer), and every row the wave-1 lanes listed. New ADRs use the new vocabulary only. Commit.
6. **Close.** `grep -n` every ADR number and § you cited resolves; `git diff --stat <base>.. -- docs/adr` shows only
   the new file. Report.

## Acceptance

- Every B row and F45 in the wip table: applied (commit) / already done (where) / moot (why).
- The usage guide has one "What is ours and what is sourced" section, linked from the existing "What is ours, not
  doctrine" paragraphs.
- §4.8 says position relief for relief and handoff for handoffs; no section number changed.
- `docs/adr/0077-*.md` exists, no other ADR changed; every errata row has evidence.

## Defaults (P2)

- When the L9 suggested wording and DOCFOLD's later wording disagree, keep DOCFOLD's if it is true and add the marker
  sense only.
- An errata row needs evidence (a file path or a decision row); a suspicion without it goes to the wip, not the ADR.
- The ADR's status line is "Accepted"; L20 lanes' findings that need a code change are not ADR material.
