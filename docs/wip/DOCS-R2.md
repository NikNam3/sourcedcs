# DOCS-R2: the live-test batch and U-STRIP folded into the shared docs

Docs only, branch `lane/DOCS-R2` from `543c1c1f`. Files: `docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`, `CLAUDE.md`,
`docs/glossary.md`, `crc-desktop/build-assets/release-notes.md`. Every name written was checked with `command grep` against
`crc-sync/src`, `crc-sync/config`, `crc-sync/tests/fixtures/wire-surface.json` and `crc-desktop/app/public/js`.

## What was folded, per note

| Note | Usage guide | Briefing | Other |
|---|---|---|---|
| LT-TERRAIN | (nothing visible beyond "masking works") | §3B: `0044`'s PNG premise out of date, `webp-lossless.js`, `.webp` cache; layout block | release note |
| LT-UI | §4B ⋯ list; §8 send-button names; §8C Show on map; §8D1 no SPLIT chip; §8M combination line rewritten (citations moved to background); §4A greyed picker; §10 30 s time-to-find, one column under an hour, "(ours)" header; §8F1 metrics row | §3L | release note |
| LT-AIRSPACE-FIX | §6 ARSPC clears (`transitions`); §8A who defines, editor "Creating as", refusal text, drawing hidden under its airspace | §3L | release note |
| LT-CORRELATION | §8C `NO TRK` row, "the assigned code finds the jet" paragraph, AI by callsign/binding only; §8F former-holder bullet narrowed to the callsign | §3C (H135, same-rung wording corrected) | release note |
| LT-SFA-PAR | §1, Facility table, §3 `ap-sfa`, §8L rewritten (no SFA Position, pool header, Hand off to PAR, one aircraft on final, FINAL line HDG/ALT and the four calls), §8E "On a final", §8J (no SFA rotation reset), §8M (hat lists), §8F1 rows, §9 Undo list | §3L; layout block; historical §3J/§3K SFA paragraphs marked superseded in brackets | CLAUDE.md five stores; glossary §4; release note |
| LT-PAR-MISSED | §8L Missed approach to AP, `par-missed` "Back to AP", calls fresh per approach; §8K carrier FINAL has no HDG/ALT | §3L (S-ARCH-54/55 rulings) | |
| LT-STRIP-FIELDS | §4B Labels (ACID, FAA hovers), TYPE as one field, HHMM placeholder; §6 wake L/M/H/J; §8F1 wake-table row | §3L | glossary §4; release note |
| LT-VFR | new §8C2 Flight following (start, refusals, VFR the FAA way, Radar service terminated, Undo); §3 Overflight Bays; §9 `.ff`/`.term`; §8E nothing to check without a clearance | §3L | release note |
| LT-MARSA | §8D void Acknowledge, tanker watch (`AR ↓`, `AR −700`, `AR 3.8 NM`); §8E CA/MCI eligibility, groups, base altitudes, chip names; §8F line 0 | §3L (`modeCIntruder`, `TANKER_DISTANCE`, `AcknowledgeVoid`) | glossary §4; release note |
| LT-AIRSPACE-ALERT | §8A type now decides the alert, using agency approves entry, new subsection "The airspace-conflict alert"; §8F `SAA` on line 0; §8F1 airspace row | §3L (`efsp-alerts.airspaceEntry`, `isAirspaceUsingAgency`, wire-surface scan); §4 using-agency reach row | glossary §4; release note |
| U-STRIP | §4B long values cut, Remarks paragraph, ⋯ Edit remarks…; §8 COMMS/CTRL grey; §4A rewritten (no remarks, names only, strict keys, start-up refusal); §8K carrier FINAL remarks | §3E strictness bullet; §3L; §4 RMKS-where-no-face row | CLAUDE.md strict stereo table; release note |
| U-RESEARCH | (background only) | §4 PAR −0.5° safety finding with the Incirlik row; §5 U-RELEASE note | |

Briefing §1 (gates on `19c0ef1c`, Playwright 249/249 at S-ARCH-58, runner exit-code trap, ADR range), §4 (state notes for `sfaRotation` and the
stereo table, new rows for live walks not done, T22, the small-items list, AI by code, RMKS where there is no Strip face) and §5 (running and
queued lanes, four in parallel since S-ARCH-62) were rewritten from decisions.md and `supervisor-handoff.md`.

## Contradictions found, and how they were resolved

1. **`sfaRotation` in an old Board snapshot.** LT-SFA-PAR default 2 says it restores (`DROPPED_KEYS`); H137 LT-PQ2 b removed that, and
   `stores.js` l.344 confirms it refuses. Documented: it refuses start-up.
2. **HDG/ALT on the carrier FINAL.** LT-SFA-PAR default 9 and ADR 0117 decision 6 give them to every FINAL; S-ARCH-54/55 and the code
   (`PAR_FINAL_ONLY_BLOCKS`) make them airfield-only, refused and hidden at the carrier. Documented the ruling.
3. **Missed approach.** LT-SFA-PAR's guide wording sends it to `par-missed`; LT-PAR-MISSED (H137) sends it to AP. Documented the later one.
4. **Stereo table load failure.** The guide said a malformed file logs a warning and starts empty; `stereo-routes.js` `_load` throws (since
   DATA-2) and U-STRIP made unknown keys refuse. Documented: start-up stops naming the file.
5. **Correlation same-rung ties.** The briefing (§3C, from `0046`) and the reconciler's `tick()` docstring say two flights claiming one contact
   both lose; the code gives it to the first in sweep order (LT-CORRELATION). Briefing corrected to the code; the docstring stays queued.
6. **ADR 0119** says Clear checks the airspace in `apply`; the lane added an early gate. Briefing §3L says both.
7. **Conflict chip text.** The guide said `CA SNAKE21 0:55`; `strip-alerts.js` writes `Conflict Alert SNAKE21 0:55` (and `Mode C Intruder …`).
   Guide follows the code.
8. **Store count.** `tools/soak/shadow.js` l.23 says five stores, its l.49 comment still says six (code, not edited: listed in briefing §4).
   CLAUDE.md now says five synced stores (`STORE_SYNC`: airspaces, correlations, marsa, runwayStatuses, carriers).
9. **The briefing named ADRs 0117-0121** as sources; only 0117-0119 are merged. 0120-0125 are recorded as reserved.
10. **U-STRIP said CLAUDE.md needs nothing**; CLAUDE.md lists the strict `state/` files, and the stereo table is now one, so one clause was added.

## Defaults taken

- Flight following is a new **§8C2**, after §8C1 (TOFI), not renumbering existing sections.
- Older briefing sections (§3J's L18 paragraph, §3K's consolidation lists, NON_LOCAL, WIRE-RECORD, PAR) are history: annotated in brackets with
  "`0117`" rather than rewritten.
- The glossary got a short **section 4** (words retired after the live test) instead of new rows in section 1, which is the W7 rename table.
- No wip note had a "Release note" line; the release-note bullets were written from the notes' usage-guide wording, in the file's own format
  (a "Changed" heading plus "New" bullets), with the two operator steps (`efsp-board.json`, stereo `remarks`).
- Documented the handoff/release model only as merged (COMMS/CTRL grey, send-button names); nothing from U-RELEASE, U-JURISDICTION or U-MOA.
- Guide body avoids lane and H-numbers for new text (existing H116/H111 references left as they were).

## Gates

No test reads these docs (`command grep` for `CLAUDE.md`, `efsp-usage-guide`, `efsp-briefing`, `glossary.md`, `release-notes.md` in
`crc-sync/tests`, `crc-desktop/tests`, `infra/tests`: none; no `*docs*`/`*glossary*` test files exist). No code changed, so no suite was run.

## Left for the next docs pass

- U-PANELS (U10 PAR Bay as Strip faces, U12, U13), U-JURISDICTION (`0125`), U-MOA (`0124`) once merged; U-RELEASE (`0122`) replaces the guide's
  §8 handoff/ControlRelease table entirely (name the FAA steps as U-RESEARCH R1: radar ID, comms, control); U-PAR (`0123`) changes §8L's
  tolerance and azimuth text; U-RSU (`0120`) rewrites §8L's RSU bullet; U-CARRIER (U19 removes PriFly's pattern section, §8K).
- The briefing still says the guide's coverage of ADRs `0098`-`0106` is unverified (§3K); not checked here.
- `docs/wip/LT-*.md` and `U-STRIP.md` can move to `docs/wip/folded-*` when the supervisor wants (not done: wip notes are not this lane's).
