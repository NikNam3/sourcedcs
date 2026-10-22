# Briefing: DOCS-V2 (docs only): fold every merged wip note since DOCS-R2 into the shared docs, for the v2 launch

Written 2026-10-22 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-DOCS-V2`, branch `lane/DOCS-V2`; no `E2E_LANE`, no Playwright). **Commit at every
green step, at least every ~15 minutes; one commit per shared doc where you can.** No other lane is running: the shared
docs are yours.

v2 = a working EFSP panel, a first working prototype of the carrier panels, PAR and SFA (H159). The guide is what the
squadron's controllers will read at launch: correct and complete for v2 beats long.

## You own (rule 3 exception)

`docs/efsp-usage-guide.md`, `docs/efsp-briefing.md`, `CLAUDE.md`, `docs/glossary.md`, `crc-desktop/README.md`,
`crc-sync`'s README if it has one, `infra/RUNBOOK.md`, `crc-desktop/build-assets/release-notes.md` (fold the wip notes'
release-note lines; keep the file's own format). No code, no ADR edits (P4), no `docs/wip/*` edits except your own
`docs/wip/DOCS-V2.md`.

## Sources (merged work only; read each whole)

- `docs/wip/`: `U-PANELS`, `U-JURISDICTION`, `U-MOA`, `U-PAR`, `U-RELEASE`, `U-TWR-PATTERN`, `U-SMALL`, `U-DECLUTTER`,
  `U-MOA-TRANSIT` (background) and `U-MOA-TRANSIT-BUILD`, `U-CLOCK`, `U-PAR-VALUES`, `U-FREQ-EDITOR`, `U-SMALL2`,
  `U-GLYPHS`, `U-SCOPE-SMALL`, `U-AIRSPACE-BADGE`, `U-TERRAIN-DCS`, `U-SMALL-FIXES`, `U-CARRIER`, `U-FREQ-ROWS`;
  `U-RSU-DESIGN` only to remove RSU text (there is no RSU, ADR 0126).
- **Not merged, do not document:** U-ROLE-POSITIONS (held until after v2, S-ARCH-85). CLAUDE.md's sentence that
  `DEFAULT_FACILITY_ID` "is being removed by U-ROLE-POSITIONS" stays true; leave it.
- Rulings in `docs/parallel/decisions.md` H147–H160 and S-ARCH-62–85 (a ruling wins over a wip note; the merged code
  wins over both: check every name you write with `command grep` in `crc-sync/src` / `crc-desktop/app/public/js`).
- ADRs 0120–0138 as merged (0127 is superseded by 0128; 0120 by 0126).

## Known items (from the supervisor handoffs)

1. **Usage guide:** every controller-visible behaviour above, in the guide's voice and section layout (no lane or
   H-number jargon in the guide body). Includes: jurisdiction areas, release and transfer of control (ADR 0122, it
   replaces the old §8 handoff table), PAR panel and its values, the tower pattern (no RSU), the MOA flight list,
   transits (request/approve/decline/acknowledge, the grey COORD mark), the airspace badge rule, the frequency editor
   with added rows and own-Facility editing, the SFA, the carrier prototype (Marshal creates Strips, Recovered Bay,
   EAT/fuel in MARSHAL, the carrier map), declutter (DCS drawings, airport surface, no ground vehicles), the mission
   clock (pause/restart), the fallback basemap. Fix known stale text: the guide's ground-vehicle lines (~l.873,
   ~l.1271), PAR "Landing assured" (~l.1639), RSU sections, the §4A stereo routes; cite AIM **4-3-23** where ADR 0126
   text says 4-3-22.
2. **Briefing** (`docs/efsp-briefing.md` §1/§3/§4/§5): the state as of the v2 tip; wire/store names added since
   DOCS-R2; LT-UI T3 names `retryErroredTiles`, which is gone; what is held (U-ROLE-POSITIONS) and what is v3
   (`docs/parallel/v3-backlog.md`).
3. **CLAUDE.md** (keep it terse, it is read every session): the strict-`state/` list gains `efsp-frequencies.json`;
   terrain is from DCS now (`npm run terrain:build` / `terrain:validate`, human-run only; `CRCSYNC_MAPTILER_KEY` is no
   longer a terrain key, only the client basemap fallback; the env table rows for `CRCSYNC_MAPTILER_KEY` and
   `CRCSYNC_TERRAIN_CACHE_DIR`; wording in `docs/wip/U-TERRAIN-DCS.md`); the basemap fallback (OpenFreeMap) and bundled
   glyphs; any count that moved.
4. **`crc-desktop/README.md` ~l.111:** `npm test` checks the two `lxsrs_v2` copies (U-SMALL2); the fonts/glyphs README
   wording (merged stacks, U-GLYPHS); the `defaultFreq` row (U-SMALL).
5. **`infra/RUNBOOK.md`:** the terrain build on the server (`docker compose exec crc-sync npm run terrain:build -- --theater
   Syria`), and the MapTiler key wording.
6. Glossary: any new term (transit, COORD, Recovered Bay, EAT override, …) only if the guide uses it.

## Output

Commits; `docs/wip/DOCS-V2.md` (what you folded from each note, contradictions found and how you resolved them, what is
left for a later pass). Gates: docs only, but run the tests that read docs
(`ls crc-sync/tests crc-desktop/tests | command grep -i -e doc -e gloss -e claude -e readme`) and both unit suites once
before the report (`nice -n 19`). Final message per rule 8.
