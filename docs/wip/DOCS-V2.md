# DOCS-V2: every merged wip note since DOCS-R2 folded into the shared docs, for the v2 launch

Docs only, branch `lane/DOCS-V2` from the v2 tip `07c15a3c`. Files: `docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`, `CLAUDE.md`,
`docs/glossary.md`, `crc-desktop/README.md`, `crc-desktop/app/public/fonts/README.md` (briefing item 4 names it), `infra/RUNBOOK.md`,
`crc-desktop/build-assets/release-notes.md`. `crc-sync/README.md` needed nothing (it names no terrain, RSU or release model). Every name written
was checked with `command grep` against `crc-sync/src`, `crc-sync/config`, `crc-sync/tools` and `crc-desktop/app` (public/js, `*.js`). No code,
no ADR, no other wip note touched. U-ROLE-POSITIONS is not documented (held): CLAUDE.md's `DEFAULT_FACILITY_ID` sentence is unchanged.

## What was folded, per note

| Note | Usage guide | Briefing | Other |
|---|---|---|---|
| U-PANELS | §8L PAR final as an ordinary Strip (HDG/ALT, Landed, next call, ⋯ Final group, Show in PAR panel); §4B remarks parenthetical (only the carrier FINAL is a line); §8O "every panel scrolls" | §3M; §3L trap 4; layout (`bay-views` = carrier FINAL line) | release note |
| U-JURISDICTION | §8A new "Jurisdiction areas" subsection; §1 bullet | §3M; §4 state row | glossary §5 (jurisdiction area, LTAG CTR (control zone) never bare CTR); RUNBOOK v2 checklist item 3 |
| U-MOA | §8A "The airspace card's flight list"; §8D tanker-only interlock and "MARSA in a MOA, click by click" | §3M | release note |
| U-PAR | §8L PAR panel: azimuth in degrees, readout, ±15° window, clamp; colours with 1° above / 0.5° below; Shift+wheel "the angle"; §8F1 SFA/PAR row (`0123`) | §3M | glossary §5; release note |
| U-RELEASE | §8 HANDOFF steps 2/4, cheat-sheet row, the whole "HANDOFF after Accept" subsection rewritten (Released, Checked in, Request release…, Release, Unable, amber list, intrafacility = plain transfer, attestation kept, carrier); §9 Undo list | §3M; §4 intrafacility row | glossary §1 rows (transfer of communications, control release) and §5 |
| U-TWR-PATTERN | §1, Facility table (no RSU, PAR → AP only), §2 ARRIVAL lifecycle, §3 `lc-pattern` row, §8L "The tower's pattern" (cells, NLA, Closed traffic, Leave pattern, AIM 4-3-23), §8F1 rows, §8M combination line (no RSU) | §3M (with the 4-3-23 correction); §3J/§3K RSU paragraphs annotated as superseded | glossary §2 RSU row "removed", §5; RUNBOOK item 2 |
| U-SMALL | §4 step 5 (designators), §4B wake table (Doc 8643), ⋯ list (TOFI to CTR, groups once), §8C1 TOFI naming, §8L "A flight follows its frequency", §8M LUAW text | §3M; §4 small-items row closed | README `defaultFreq` row |
| U-DECLUTTER | §8B no ground vehicles (LC row fixed), §8E Show predicted paths, §8F code only on mismatch (tactical row and ATC line 3), tags line, ground-vehicle bullets, §8C2 KEEP IFR | §3M; §4 declutter bullet | glossary §1 `gnd-red` note, §5 |
| U-MOA-TRANSIT (background), U-MOA-TRANSIT-BUILD | §8A "Transit through…" (request, decide, marks, Transit… picker, "(approve)" when holding both, Entry block…, filed-through by geometry); §8A "Sharing a block" (Entry block…, conformance on the block) | §3M | glossary §5; release note |
| U-CLOCK | §8J "The topbar clock: PAUSED and WALL" (and `?`) | §3M (0129 replaces 0079's pause text) | release note |
| U-PAR-VALUES | §8L "Approach values"; Settings → PAR is four settings; "Default glideslope" removed; placeholders paragraph | §3M; §4 squadron-data row (no plate owed), PAR row | glossary §5; release note |
| U-FREQ-EDITOR, U-FREQ-ROWS | new §8N FREQUENCIES panel; §8M Frequencies bullet points to it; §8L SFA note | §3M; layout `frequency-table.js` | CLAUDE.md strict list gains `efsp-frequencies.json`; RUNBOOK item 4; release note |
| U-SMALL2 | — | §3M | README l.111 rewritten (npm test diffs the two lxsrs copies; check-lxsrs-sync.sh the deeper manual check) |
| U-GLYPHS | §8O basemap, labels | §3L LT-UI T3 marked gone; §3M; layout | CLAUDE.md crc-desktop map bullet; README "The map"; fonts README (merged stacks, Mono by weight); RUNBOOK MapTiler section |
| U-SCOPE-SMALL | §8F Declutter subsection, §8O Map group, picker highlight | §3M | release note |
| U-AIRSPACE-BADGE | §8A "The airspace badge"; §1 bullet | §3M; §4 new obligation row (finding 2) | release note |
| U-TERRAIN-DCS | §8B terrain line, §8O terrain/contours | §3M; layout (terrain.js, terrain-grid.js, tools/terrain; `webp-lossless.js` gone); §4 terrain row | CLAUDE.md (commands, crc-sync bullet, theaters `terrainExtent`, env rows for both MapTiler keys and the cache dir); RUNBOOK "Building the terrain cache" and the key wording; release note (stale WebP bullet removed) |
| U-SMALL-FIXES | §8A decline stays until Acknowledge, COORD mark, emptied ALT/HDG is no clearance (also §8C2) | §3M | glossary §5 COORD |
| U-CARRIER | §1 carrier bullet, §8K (Marshal creates Strips, side-number list, fuel/EAT by hand, the stack racetrack and approach path, pattern while holding, Trapped and the Recovered Bay, PriFly's Bays) | §3M; §4 carrier-defaults row | glossary §5 (Recovered Bay, hand EAT); release note |
| U-RSU-DESIGN | RSU text removed everywhere (§1, §3, §8F1, §8L, §8M) | ADR line: 0120 superseded by 0126 | glossary §5 |

Briefing §1 (v2 tip gates, Playwright 288/289 then the mapfix, 2-lane cap, ADR list 0120-0138 with 0135 unused), §4 (rows closed, rows added) and §5
(nothing running, U-ROLE-POSITIONS held with its trial branch and H160's list, v3) were rewritten from decisions.md S-ARCH-62-86 and H147-H160. H160
(design for N) is stated in §3M's lead and §5's "keep true" list.

## Contradictions found, and how they were resolved

1. **"Settings → Declutter".** U-SCOPE-SMALL and `settings.js` comments say Declutter; the tab button in `index.html` reads **RADAR** (`stab-radar`), the
   new switches sit in its **Map** group. The guide says Settings → RADAR → Map (the code).
2. **Contours still MapTiler?** U-GLYPHS (earlier) says contours still need MapTiler; U-TERRAIN-DCS (later, and the code: `elevation.js`/`los.js` import
   `terrain-grid.js`) moved them to the DCS grid. Documented the later.
3. **PAR values with an empty final.** H156 PV-Q1 a records "values settable with an empty final … as built"; U-PAR-VALUES lists it as not built, and
   `par-panel.js` hides `#par-body` with no sample. The guide says the values show only while an aircraft is on the final; briefing §4 carries it as a
   finding for the supervisor.
4. **Badge grey before entry vs the obligation.** H155 / ADR 0134 make the badge grey until the aircraft is inside; `forwarding-obligations.js` still
   raises `UNACTIVATED_AIRSPACE_ENTRY` (OVERDUE, orange-red) from the approval. The guide documents both; briefing §4 asks whether H155 meant that too.
5. **AIM 4-3-22 → 4-3-23** (S-ARCH-71): the guide cites 4-3-23; the briefing says ADR 0126's citation is wrong; the ADR is untouched (P4).
6. **The 5-minute decline** (U-MOA-TRANSIT-BUILD) is gone (U-SMALL-FIXES, ADR 0136): documented the acknowledge.
7. **TOFI naming.** U-SMALL's wording ("TOFI to CTR" from the one-counterpart side; CTR's picker "TOFI to TAC_C2") was taken verbatim; the code's
   `tofiSendLabel` builds both.
8. **"Unable…" vs "Unable".** U-RELEASE's note says "Unable…"; `control-release-rules.js` labels it `Unable` (with a reason form). The guide says Unable.
9. **The release note file** still claimed "Terrain masking works again: crc-sync now decodes MapTiler's WebP elevation tiles" (unreleased, now false):
   removed, replaced by the DCS-terrain bullet.
10. **"The airspace list ships empty"** (guide §8A, older than ADR 0098 §10): rewritten; the shipped list is theater-keyed with the three jurisdiction areas.
11. **crc-desktop CommonJS test count** in CLAUDE.md said five; there are eight (`glyph-route`, `external-link`, `no-maptiler-key` added). Fixed.

## Defaults taken

- New guide sections are **§8N** (frequencies) and **§8O** (the map), after §8M, rather than renumbering; §8L keeps its number with new subsections.
- The briefing's round 2 is a new **§3M**, as DOCS-R2 made §3L; older RSU paragraphs are annotated in brackets, not rewritten.
- The glossary got a **section 5** (round-2 words), like DOCS-R2's section 4.
- Release notes: a new "Changed: for the v2 launch" heading and further "New" bullets, in the file's own format; no lane or H-numbers.
- RUNBOOK: the section title "Rotating the MapTiler key" kept (a test comment cites it); a new "Building the terrain cache" and a "v2 launch: before the
  deploy" checklist.
- `CRCSYNC_EFSP_FREQUENCIES_PATH` left out of CLAUDE.md's env table (it lists the key variables; no other `*_PATH` override is there).
- The fonts README was edited although not on the owned list: briefing item 4 asks for its wording.

## Gates

Tests that read these docs: none (`ls crc-sync/tests crc-desktop/tests | grep -i -e doc -e gloss -e claude -e readme` finds nothing; a wider
`grep` finds only comments naming the RUNBOOK and README). Both unit suites run once on the lane head (results in the report).

## Left for a later pass

- `docs/wip/U-*.md`, `DOCS-R2.md` and `LT-*.md` can move to a `docs/wip/folded-*` directory when the supervisor wants (wip notes are not this lane's).
- The briefing's §3K still says the guide's coverage of ADRs `0098`-`0106` is unverified; not checked here either.
- The guide's older sections keep a few H-numbers from before (`H116`, `H111` in §8F1/§8K); new text uses none.
- Once U-ROLE-POSITIONS lands: the guide's literal-Position wording where rules change (H160's list), CLAUDE.md's `DEFAULT_FACILITY_ID` sentence.
