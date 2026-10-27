# DOCS-V2B: every merged wip note since DOCS-V2 folded into the shared docs, before the v2 deploy

Docs only, branch `lane/DOCS-V2B` from `0785de96` (the briefing commit on the tip `e7b46423`). Files: `docs/efsp-usage-guide.md`,
`docs/efsp-briefing.md`, `CLAUDE.md`, `docs/glossary.md`, `crc-sync/README.md`, `infra/RUNBOOK.md`, `crc-desktop/build-assets/release-notes.md`.
`crc-desktop/README.md` needed nothing. Every name written was checked with `command grep` in `crc-sync/src`, `crc-sync/config`,
`crc-desktop/app/public/js` (and the freeze goldens / soak traffic for the test-coverage claims). No code, no ADR, no other wip note touched.
U-ROLE-POSITIONS is not documented (held). The guide body carries no lane or H-numbers.

## What was folded, per note

| Note | Usage guide | Briefing | Other |
|---|---|---|---|
| U-V2-FIXES | §8L "With an empty final" (header, active runway end, picks row); "show only while an aircraft is on your final" removed; §8A badge paragraph: `UNACTIVATED AIRSPACE ENTRY` by the badge rule; §8 obligations intro | §3N; §4 two DOCS-V2 findings closed (PAR row rewritten, obligation row removed) | release note |
| U-SURFACE | §8O airport surface by Position (GC/LC at Incirlik), black-scope grey, `airportSurfacePositions` | §3N | RUNBOOK (other facility copies); release note |
| U-LTAG-COURSE | §8J "The DCS ruler reads differently"; §8F1 runway row 52.7/232.7 | §3N; §4 HSI-check row; smaller-list 056/236 line fixed | release note |
| U-LABEL-MENU | §8F ATC scope: click the block → HDG/SPEED/ALT menu, TRACK / Shift+click, tactical label too; §1 bullet; §8F1 row | §3N | release note |
| U-PERF | §10 METRICS "Server (crc-sync) · last 60 s", `GET /api/server/resources`, endpoint count; §1 metrics bullet; §8F1 metrics row | §3N (hotspots to v3 in §5) | CLAUDE.md crc-sync bullet; crc-sync README; RUNBOOK curl line; release note |
| U-PAR-FT | §8E "On a final" rewritten, `GP ↓/↑` row; §8L Begin descent / glidepath alert, fixed ±3° azimuth, FIN HDG and heading scale; §8O APRT centreline | §3N (incl. `windFromMagnetic` vs ADR text); §4 PAR row, APRT row | glossary §6; release notes (stale "altitude only until Begin descent" removed) |
| U-FT-SMALL | §8E turn time (keys named); §3 CD "A departure with nothing at OPS", LC departure face; §8L pattern cells; §8O bullseye readout; §8F1 conformance row (AIM ¶5-3-8) | §3N; §4 `atcOnlySession` row | RUNBOOK item already had `headingGraceSec`; glossary §6; release note. Range-ring switch not documented (reverted, H171) |
| U-FT-FIXES | §4B arrival flash continues across a rebuild; §4B fields: read-only cells, OPS 14E/3G exception | §1 coverage-frame wait; §3N; §4 closed list; rule-9 debts | release note |
| U-BEACON-ONLY | §8C table (no `TRK?`, NO TRK covers `CODE_REISSUED`, TRK ×2 = two contacts on the code), "never matched by its callsign", "Correlating an AI flight"; §6 beacon pair; §8E CA bullet, §8F `COLT31?` row and `?` sentence, "Detected airborne" | §3C lead bullet + history notes; PROVISIONAL lines annotated; §3N; §4 AI-flight row closed | glossary §6; RUNBOOK `confidence`; release note |
| U-VFR-MTMA | §3 CD VFR departure; §4B DIR (9K); §8A jurisdiction (class optional, VFR service, MTMA, CZ Class D, Edit… CLASS/VFR SERVICE); §8C2 VFR departure + `.term` wording; §9 `.vfr`; §8F1 rows | §3N; §4 VQ-A/B/C row | glossary §6; RUNBOOK LTAG-RAPCON step; release note |
| U-DRAG-CLICK | §9 drag (ghost top edge, no-move, 16 px tab) and left-edge tooltips; §1 bullet | §3N; §4 watch row (selected-word drag) | release note |
| U-PANELS-RADARS | §8B PANELS order and `RADARS · n · k GND ▸`, "Coverage list" renamed (two places); §8O range ring always draws | §3N | release note |
| U-SUA | §8A types bullet + "A range is not an airspace type", example JSON retyped RESTRICTED, prohibited always in force, card list types, transit heading/lead, **Transit complete**, `COORD` after a completed transit, alert table; §1 bullets | §3N; §3M `TRANSIT_TYPES` annotated; §5 v3 items | glossary §6 + `COORD` row; CLAUDE.md strict list; RUNBOOK RANGE/DANGER; release note |
| research `sua-types-and-transit-end.md` | background only (FAA citations in §8F1 checked against ADR 0144) | — | — |

Briefing §1 (tip `e7b46423`, gates from S-ARCH-108/109, ADRs to 0144), §4 (rows closed and added), §5 (lanes merged, v3 additions) rewritten from
decisions.md H161-H171 and S-ARCH-86-109. RUNBOOK section renamed "v2 launch (round 2, crc-sync ADRs 0121-0144): before the deploy".

## Contradictions found, and how they were resolved

1. **ADR 0139 §3 `windFrom` vs the wire `windFromMagnetic`** (U-PAR-FT): the briefing names the wire key and says the ADR text differs (P4).
2. **"Settings → Declutter → Airport surface"** (U-SURFACE's wording) vs the RADAR tab (H161 V2-Q3 a, `index.html`): the guide keeps "the switch
   above" in Settings → RADAR → Map.
3. **APRT centreline "not fixed"** (U-LTAG-COURSE) vs fixed by U-PAR-FT (`airportIcao`, `facilityRunwayTrueDeg`): documented as fixed, with the
   reference-point start and the designator fallback.
4. **The range-ring switch** (U-FT-SMALL item 4) was reverted (U-PANELS-RADARS, H171): not documented; the guide says the ring always draws.
5. **The `CODE_REISSUED` text**: the server detail says "6012 is now squawked by a different AI aircraft", the client tooltip "this code now belongs
   to a different AI aircraft"; the guide quotes the client.
6. **The label menu on "the STARS scope"** (U-LABEL-MENU) vs the code, which binds both `unit-labels` and `atc-labels`: the guide says a tactical
   label answers the same click.
7. **`atcOnlySession()`**: the briefing for U-FT-SMALL described "every Position held is ATC"; it is radar-based (S-ARCH-97). Documented as built
   ("while every radar you have is an ATC one"); the GC/CD gap is a §4 row.
8. **Release notes** still said "altitude only until Begin descent" (unreleased, now false under ADR 0139) and listed "range or danger area":
   both corrected.
9. **Freeze coverage**: my first draft said `ControlRelease` is not driven by the soak; it is (`tools/soak/traffic.js`, random-seed goldens).
   The trap now names only `CreateVfrDeparture` and `EndTransit` (no hub-op-matrix golden; `EndTransit` is in `scenario-transit`).
10. **U-VFR-MTMA's "two minutes after it leaves the Class D control zone"**: written as "a few minutes" (no source for the two).

## Defaults taken

- Guide: no new top-level sections; new text joins §3 (CD), §4B, §8A, §8B, §8C, §8C2, §8E, §8F, §8J, §8L, §8O, §9, §10 and §8F1.
- Briefing: a new **§3N**, as DOCS-V2 made §3M; older paragraphs annotated in place, not rewritten.
- Glossary: a new **section 6**.
- Release notes: a new "Changed: after the final tests" heading and further "New" bullets, in the file's format.
- CLAUDE.md: only `server-resources.js` (one sentence) and RANGE/DANGER in the strict list; `airportSurfacePositions` not added (CLAUDE.md lists
  no facility-file keys).
- VQ-A/B/C (open on the Desk) are documented as built: CA unchanged by VFR service, CENTER and the carrier area Class E, no departure frequency in
  the read-out (the guide gives the full phraseology).

## Gates

Docs only. Tests that read these docs: `crc-desktop/tests/patch-notes.test.js` (reads the release notes) 9/9. Both unit suites on the lane head
under `nice -n 19`: see the report.

## Left for a later pass

- Commit `674df278` carries the §8E/§8L message but holds only the unactivated-obligation edit (a failed scripted edit ran first); `60f816d1` has
  the §8E/§8L text. Cosmetic, no rewrite (no rebase).
- The guide's §1 bullet "The `RANGE` Position" still reads right (the Position stays), but could be reworded once roles land.
- `docs/wip/U-*.md` since DOCS-V2 can move to a `docs/wip/folded-*` directory when the supervisor wants.
- The briefing's §3K note that the guide's coverage of ADRs `0098`-`0106` is unverified still stands.
