# Supervisor handoff

## RELAUNCH HERE (2026-10-26): seven lanes merged since 10-24, nothing running

Read H165–H171 and S-ARCH-101–108 in `decisions.md` (grep them; the file is 350 KB, never read it whole). Merged into
`efsp-wp5-correlation`: U-BEACON-ONLY (H165, ADR 0142: no callsign correlation; a typed AI synthetic code correlates;
`CODE_REISSUED`), U-VFR-MTMA (H166, ADR 0143: optional airspace class, per-area `vfrService`, MTMA unclassified
IFR_SEPARATED, LTAG-CZ Class D, CD `CreateVfrDeparture` + Block 9K DIR), U-DRAG-CLICK (H167/H168: drop follows the ghost,
16 px tab threshold, left-edge marker tooltips), R-SUA (research `docs/parallel/research/sua-types-and-transit-end.md`),
U-PANELS-RADARS (H171 FT-Q11: radar list collapsed, `0b793660` range-ring switch reverted), U-SUA (ADR 0144:
`EndTransit` / Transit complete, RANGE and DANGER removed, PROHIBITED always in force). Gates on the tip `50b19c89`:
crc-sync 2968, crc-desktop 1513, sourcedcs-web 151, walk 24/24, freeze 58/58, selfcheck PASS, wire protocol 2; sharded
Playwright: see S-ARCH-109 (run after U-SUA). Only other worktrees: `../sourcedcs-U-ROLE-POSITIONS` (held, S-ARCH-85),
`../sourcedcs-hotfix`.

**Desk** https://claude.ai/artifact/FpddWVPwTzbpnmSJhW3vdt (slug `780678dd-c784-45fd-af24-56aee794bbaf`; write with
`mcp__claude-artifacts__db_write`, read answers with `db_list`/`db_query` on `answers`). **Open:** round 17 VQ-A (CA by
VFR service, rec. a keep FAA), VQ-B (CENTER/carrier "Class E", rec. b unclassified), VQ-C (departure frequency in the
VFR read-out, rec. a). Rounds 15–16 settled (H171). **Human checks pending:** FT-Q9 cockpit HSI on LTAG RWY 05
(047 = ours; ~050 = cockpits grid-referenced, then switch reference); the parked airspace-editor report ("locked
although not active", stale-form bug found: the editor computes its locks once at open; the human will report the card's
state word next time); offered (not asked yet): Start flight following in the label menu so ATC needs no track panel.

**Deploy actions added (RUNBOOK before the next deploy):** the deployed Board keeps LTAG-RAPCON "Class C" (standing
areas import once): AP edits it (CLASS none, VFR SERVICE IFR separated) or Board reset; any live RANGE/DANGER airspace
stops start-up (none known); correlation `confidence` still accepted on restore (S-ARCH-102 D1, remove at next reset).

**Token economy (human asked 2026-10-26):** lanes cost 200–370k context, ~95k of it reasoning and 60–110k exploring;
this supervisor session reached ~275k after 486 steps. So: relaunch the supervisor every phase, give lanes file:line
pointers, tell them to batch reads and grep (not read) `decisions.md`.

**Backlog:** `v3-backlog.md` (correlation leftovers, airspace leftovers, perf); rule-9 literals for U-ROLE-POSITIONS
(`VFR_DEPARTURE_POSITIONS`, `FLIGHT_FOLLOWING_POSITIONS`, `COMPACT_BLOCKS_BY_POSITION`, S-ARCH-97/99); docs pass for the
`docs/wip/U-*.md` usage-guide texts (§8C table loses `TRK?`, VFR departure, Transit complete, area types).

## RELAUNCH HERE (2026-10-24): final test round 2 built and merged, 295/295

Read H163, H164 and S-ARCH-91–100 in `decisions.md`. Merged into `efsp-wp5-correlation` today: U-SURFACE (H162),
U-LTAG-COURSE (DCS's ruler is grid-referenced; Incirlik runway/PAR course fixed 056 → 052.7 true), U-LABEL-MENU (ADR 0140),
U-PERF (ADR 0141), U-PAR-FT (ADR 0139), U-FT-SMALL, U-FT-FIXES. Gates on the tip: crc-sync 2951, crc-desktop 1470,
walk 24/24, freeze 58/58, selfcheck PASS, wire 2, **sharded Playwright 295/295**. Only other worktree:
`../sourcedcs-U-ROLE-POSITIONS` (held, S-ARCH-85).

**Decision Desk moved** (S-ARCH-92): https://claude.ai/artifact/FpddWVPwTzbpnmSJhW3vdt (slug
`780678dd-c784-45fd-af24-56aee794bbaf`, private, db declared). The old Desk went public; the artifact db tools refuse
writes to public artifacts, so it is the read-only archive of rounds 1–14. **Open there:** FT-Q9 (magnetic reference;
rec. keep true + WMM; the cockpit HSI check on LTAG RWY 05 decides), FT-Q10 (owner's label click), FT-Q11 (which
"coverage"; (c) built: revert `0b793660` if not), FT-Q12 (PAR azimuth pan), FT-Q13 (final-heading display). Optional
human check: `CustomService/Eval` of `Airbase.getByName("Incirlik"):getRunways()` to confirm 052.7 against DCS's own runway.

**Next:** settle the open answers (small lanes if any change something), then the release checklist (RUNBOOK
"v2 launch (round 2 …): before the deploy", now incl. `alerting.json` `headingGraceSec`, the stale Incirlik facility copy,
`server-resources.json`). Backlog: rule-9 literals for U-ROLE-POSITIONS (S-ARCH-97/99 findings), perf hotspots in
`v3-backlog.md`.

## RELAUNCH HERE (2026-10-22): v2 complete, in final testing

Read S-ARCH-81–89 and H158–H161 in `decisions.md`. Everything for v2 (H159: EFSP, carrier prototype, PAR, SFA) is merged
into `efsp-wp5-correlation` (`a054ea02`): U-AIRSPACE-BADGE (0134), U-TERRAIN-DCS (0133, + `--dry-run`/`--max-chunks`,
Syria 500 m cache shipped in `crc-sync/data/terrain/`), U-SMALL-FIXES (0136), U-CARRIER (0137) + MAPFIX, U-FREQ-ROWS
(0138), U-V2-FIXES, DOCS-V2. Gates on the tip: crc-sync 2906, crc-desktop 1425, walk 24/24, freeze 58/58, selfcheck
PASS, wire protocol 2 (v1.5.0 speaks 1). The only worktree besides the main checkout is `../sourcedcs-U-ROLE-POSITIONS`.
**Held:** U-ROLE-POSITIONS (S-ARCH-85; trial merge on `merge/U-ROLE-POSITIONS`; H160's N-airfield list before it lands,
with Konya, v3). **New standing rule H160:** expandability first, design for N, ask before any architecture that fixes a
count or a default (memory `feedback_expandability_first`). Next: the human's final test; fix what it finds; then the
release checklist (RUNBOOK "v2 launch: before the deploy", CLAUDE.md release steps). v3 list: `v3-backlog.md`.

## RELAUNCH HERE (2026-10-21, usage limit): two lanes merged, one stopped

Read S-ARCH-81 and H158–H159 (v2 scope: EFSP, carrier prototype, PAR, SFA; v3 in `v3-backlog.md`) in `decisions.md`.
Merged: U-AIRSPACE-BADGE (ADR 0134), U-TERRAIN-DCS (ADR 0133). **Do this first:** (1) sharded Playwright on the tip,
2 lanes, `nice -n 19`, then `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`; (2) finish
**U-ROLE-POSITIONS** (lean, H158) with a new agent in `../sourcedcs-U-ROLE-POSITIONS` ("look at git log/status/diff
first, keep what is sound"; its wip note says where it stopped); (3) dispatch **U-SMALL-FIXES** (`next/U-SMALL-FIXES.md`,
worktree from the tip); then U-CARRIER (prototype, v2), U-FREQ-ROWS (+ FQ-Q2), docs pass (+ U-TERRAIN-DCS's
CLAUDE.md/RUNBOOK wording). Human: run `terrain:build`/`terrain:validate` (wip note `U-TERRAIN-DCS.md`).

## RELAUNCH HERE (2026-10-20): nothing running, queue on the Decision Desk

Read S-ARCH-75–80 and H155–H157 in `decisions.md`, and **ADR 0132** (binding now: lane-rules rule 9, CLAUDE.md). Tip of
`efsp-wp5-correlation`: everything merged, no lane running, the only worktree is the main checkout (lane branches kept).
Last gates: crc-sync 2873, crc-desktop 1415, walk 24/24, freeze 58/58, soak:selfcheck PASS (seed 7), wire protocol 2.
Since 2026-10-18: bundled map glyphs + OpenFreeMap basemap fallback (U-GLYPHS), e2e harness never gets the MapTiler
key, Deny activation inline (no `window.prompt` in Electron), U-SCOPE-SMALL (drawings switch, picker highlight, airport
surface). The human's live test on 2026-10-20 passed ("very successful, no bugs found").

**Standing rules from the human (this period):** every command runs under `nice -n 19`; sharded Playwright with **at
most 2 lanes** (`--lanes 1,2`); up to 4 agents, Opus; questions and the **lane queue** live on the Decision Desk
(https://claude.ai/artifact/FpddWVPwTzbpnmSJhW3vdt (new, private; old A3giz… is the public archive), collections `questions`, `answers`, `queue`; source
`docs/parallel/decision-desk.html`): update the `queue` rows (status running/next/queued/done) whenever a lane starts or
merges.

**Do this first:**
1. **Sharded Playwright is owed** on the tip (U-SCOPE-SMALL and the Deny fix touched the client; only the affected specs
   ran, 24/24): `cd crc-desktop && nice -n 19 npm run e2e:sharded -- --lanes 1,2 --rerun-failed` in the background,
   then `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`.
2. Then the queue, in this order (each needs a briefing in `docs/parallel/next/`, written from the decisions named):
   1. **U-AIRSPACE-BADGE** (H155 item 4): the Strip's airspace badge is amber only while the flight is inside its
      approved airspace and that airspace is not ACTIVE; grey otherwise (`strip-indicators.js`; reuse the entry-alert
      geometry, `airspace-entry-alert.js`).
   2. **U-TERRAIN-DCS** (H157): a whole-map terrain height cache per theater from DCS `land.getHeight` via
      `CustomService.Eval`, **built only by a command the human runs** (no automatic or background build on
      the shared server: e.g. `cd crc-sync && npm run terrain:build -- --theater Syria [--spacing 500]`, chunked,
      resumable, rate-limited, progress printed); spacing chosen by comparing grid LOS against `land.isVisible`
      (`npm run terrain:validate`); theater extents in `config/theaters.json`; radar masking (`terrain.js`) and the
      client's contour lines read the cache; MapTiler terrain removed; MapTiler keeps the basemap only (one key, H156
      MT-K1). Fold in S-ARCH-77: no per-tick retry of a failed fetch anywhere, request counter.
   3. **U-ROLE-POSITIONS** (ADR 0132 + H156): roles per Position, rules by role, no default Facility, topology in the
      facility file, facility files discovered; tests as **properties over generated holdings**, scaled to 50+
      facility files; first consumer: the airport surface follows the Positions held (SC-Q1: shown with LC/GC held,
      also with CTR/AP; not with only non-airport Facilities). Konya itself is V3; the proof is the TESTFIELD fixture.
   4. **U-SMALL-FIXES**: `vfr.js` (a cleared assigned altitude leaves an empty ACTIVE entry, still IFR);
      `airspace-entry-alert.spec.js` cleanup without `baseDefRev`; soak `skip-shadow-client` fails on seeds 15/16/23/26
      (`tools/soak/driver.js` ~201: drop a frame a later one cannot repair); H156: frequencies editable only for your
      own Facility (FQ-Q2), a transit decline stays until the requester acknowledges it (MTB-Q2), a grey "coordinate"
      mark on a flight filed through an active SUA without a transit (MTB-Q3, no 5-minute feature).
   5. **U-FREQ-ROWS** (H156 FQ-Q3): add and remove frequency rows at run time.
   6. **U-CARRIER** (U18–U22 in `live-test-2026-10-13.md`; U22 = EAT and fuel editable in MARSHAL, research first).
   7. **Docs pass, last**: every wip note since DOCS-R2 (incl. U-CLOCK, U-PAR-VALUES, U-FREQ-EDITOR, U-SMALL2,
      U-MOA-TRANSIT-BUILD, U-GLYPHS, U-SCOPE-SMALL); CLAUDE.md strict-`state/` list gains `efsp-frequencies.json`;
      CLAUDE.md/README mention the basemap fallback and bundled glyphs; `crc-desktop/README.md` ~111 (npm test checks the
      lxsrs copies); the briefing's LT-UI T3 entry names `retryErroredTiles`, which is gone.

**Open, nothing to ask now:** the Desk has no open question. Human actions still outstanding: push a backup of
`efsp-wp5-correlation`; the MapTiler quota resets on its own (one key); the release checklist further down.

## Earlier: UPDATE 2026-10-18: Playwright done, U-SMALL2 merged, U-MOA-TRANSIT-BUILD running (S-ARCH-75)

Live test unblocked. **U-MOA-TRANSIT-BUILD merged** too (S-ARCH-76); 2-lane Playwright owed/running on it. Queue: (1) small
fixes: `vfr.js` empty ACTIVE altitude counts as IFR; `airspace-entry-alert.spec.js` cleanup `baseDefRev`; soak `skip-shadow-client` on seeds 15/16/23/26 (`tools/soak/driver.js` ~201); (2) U-CARRIER (U18–U22, U22 = EAT and
fuel editable in MARSHAL, research first); (3) docs pass last (+ U-SMALL2, README ~111). Playwright: 2 lanes only (human).
Everything this session starts runs `nice -n 19` (human: CPU).

## Earlier: RELAUNCH (2026-10-17, usage limit): three lanes merged, two lanes stopped

Read S-ARCH-72–74 and H152–H154 in `decisions.md`. Merged into `efsp-wp5-correlation`: **U-CLOCK** (ADR 0129),
**U-PAR-VALUES** (ADR 0130), **U-FREQ-EDITOR** (ADR 0131). Gates on the tip: crc-sync 2842, crc-desktop 1387, walk
24/24, freeze 57/57, soak:selfcheck PASS, wire protocol 2 unchanged.

**Do this first:**
1. **Sharded Playwright is owed** (all three touched the client; `par-panel` 06 failed on lane 7, seen before):
   `cd crc-desktop && npm run e2e:sharded -- --lanes 1,2,4,5 --rerun-failed` in the background, read the summary line,
   then `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`.
2. **U-SMALL2** (stopped): worktree `../sourcedcs-U-SMALL2`; item 1 done (`dc10c201`), item 2 (soak leak case) is an
   unverified wip checkpoint `692512ad`: finish with a new agent ("look at git log/status/diff first, keep what is sound").
3. **U-MOA-TRANSIT-BUILD** (stopped before any commit): worktree `../sourcedcs-U-MOA-TRANSIT-BUILD` is clean but cut
   before U-FREQ-EDITOR merged: recreate it from the tip (`git worktree remove`, `git branch -D lane/U-MOA-TRANSIT-BUILD`,
   `git worktree add -b ...`), then dispatch from `next/U-MOA-TRANSIT-BUILD.md` (ADR 0128, E2E 7); its "Running beside
   you" line names U-FREQ-EDITOR/U-SMALL2: update it.
4. Then U-CARRIER; **docs pass last** (human, 2026-10-17): fold every wip note since DOCS-R2, incl. U-CLOCK,
   U-PAR-VALUES, U-FREQ-EDITOR (CLAUDE.md strict-`state/` list gains `efsp-frequencies.json`).

**Questions for the human** (put them on the Decision Desk, round 13): PAR (S-ARCH-73): values on an empty final? the
lower safe limit follows a changed angle or the default? threshold/course settable? AP/OPS when PAR unstaffed? H116's
glideslope setting removed: OK? Frequencies (S-ARCH-74): force an SFA change in use? who may edit? add rows at run
time? Also open: MapTiler key answers 403; CVN-72 angled deck 9° and `fixToRampSec` 6 min; live re-test of pause and
restart (S-ARCH-72) with U-CLOCK.

## Earlier: UPDATE 2026-10-17: four lanes running (U-CLOCK, U-PAR-VALUES, U-FREQ-EDITOR, U-SMALL2)

Read S-ARCH-72 and H152–H154 in `decisions.md`. Running (worktrees `../sourcedcs-<L>`, briefings `next/<L>.md`):
**U-CLOCK** (ADR 0129, E2E 8), **U-PAR-VALUES** (ADR 0130, E2E 7), **U-FREQ-EDITOR** (ADR 0131, E2E 9), **U-SMALL2**
(E2E 3). PAR-VALUES and FREQ-EDITOR may both add a synced store: expect conflicts in `stores.js`/`app.js`/`ws-hub.js`
and the wire record; merge one, re-run `wire:record`, then the other. **Queue after them:** (1) **U-MOA-TRANSIT-BUILD**
(`next/U-MOA-TRANSIT-BUILD.md`, ADR 0128, written; it names U-CLOCK as its neighbour: update that line when you
dispatch it); (2) U-CARRIER; (3) **docs pass, the very end** (human 2026-10-17; also fold the four lanes above).
Backlog: AIRAC cycles, then fix coordinates (H152). Human: MapTiler key answers 403; CVN-72 angled deck 9° and
`fixToRampSec` 6 min still to confirm; frequency editor panel vs Settings (default panel).

## UPDATE 2026-10-16: U-SMALL, U-DECLUTTER, U-MOA-TRANSIT phase 1 merged; waiting on the Desk

Merged today (S-ARCH-69–71): U-MOA-TRANSIT phase 1 (docs: research, ADR 0127 **Proposed**, mockup), U-DECLUTTER (ADR
0121: no ground vehicles; T30; ¶5-4-6 e; KEEP IFR), U-SMALL (bridge `defaultFreq`, soak REFUSE back, FAA pattern quotes,
small-items row, SFA Rack follows the frequency). Gates on `13d258e7`: crc-sync 2809, crc-desktop 1376, walk 24/24,
freeze 57/57, soak:selfcheck PASS, wire protocol 2 unchanged, **sharded Playwright 272/272** (17m27s). No lane running;
the only worktree is the main checkout.

**Desk round 12 answered and settled as H151** (read it whole): much smaller than ADR 0127 proposed: no release
record, no Resume ops button, no pass marks, no lateral feature, VFR unchanged; restrictions are ordinary Strip
assignments (`altitudeBlock` / assigned altitude); filed-through by **geometry only** (name match dropped); scope is
**MOA, WARNING and RESTRICTED**. Next: write a new ADR superseding 0127 (P4: never edit 0127) and `next/U-MOA-TRANSIT-BUILD.md`
from `docs/wip/U-MOA-TRANSIT.md`'s build plan with H151 applied (what is left: transit request → decide on the deciding
side per MT-Q1 a, route-crossing geometry, maybe a bust alert against the Strip's own assigned altitude only if
conformance does not already cover it: check first). Still unanswered: a published fix table for the stereo-route fixes
(KEMER, ERGEP, MANAZ, MUT, TARSU, DAN); with geometry only, route-crossing needs it: ask again.

**Queue now:** (1) U-MOA-TRANSIT build after the Desk; (2) **docs pass** (one DOCS lane like `next/DOCS-R2.md`): fold
`docs/wip/U-PANELS.md`, `U-JURISDICTION.md`, `U-MOA.md`, `U-PAR.md`, `U-RELEASE.md`, `U-TWR-PATTERN.md`, `U-SMALL.md`,
`U-DECLUTTER.md`, `U-MOA-TRANSIT.md`; RSU sections out of guide/briefing/glossary; §8 handoff table → ADR 0122; cite AIM
**4-3-23** where ADR 0126 says 4-3-22; guide l.~873/l.~1271 ground-vehicle text is now wrong; README `defaultFreq` row;
(3) small: a Node test diffing the two `lxsrs_v2` copies (today only manual `check-lxsrs-sync.sh`); a longer soak leak
case (seeds other than 7 can read R² < 0.9); a UI that sends `ApproveAirspaceEntry`'s `altitudeBlock` (none does);
(4) U-CARRIER last. Open for a live test: a busy field shows no vehicles, parked aircraft still show.

## UPDATE 2026-10-15 evening: U-TWR-PATTERN merged; queue is now items 4-7 below

Merged today: U-PAR (S-ARCH-66), U-RELEASE (S-ARCH-67), U-TWR-PATTERN (S-ARCH-68, ADR 0126: no RSU, H149/H150).
Gates on `9c9acb9e`: crc-sync 2800, crc-desktop 1365, walk 24/24, freeze 57/57, soak:selfcheck PASS, wire protocol 2,
**sharded Playwright 272/272** (17m55s). No lane running; the only worktree is the main checkout. Decision Desk: all
settled (round 11). Queue items 1-3 below are DONE (U-RSU replaced by U-TWR-PATTERN). Next: U-MOA-TRANSIT (H148,
research first, no briefing yet), docs pass (fold `docs/wip/U-PANELS.md`, `U-JURISDICTION.md`, `U-MOA.md`, `U-PAR.md`,
`U-RELEASE.md`, `U-TWR-PATTERN.md`; RSU sections out of guide/briefing/glossary; §8 handoff table replaced by ADR 0122),
small items (add: `lxsrs_v2` `client.py:530` hardcoded 251.000 MHz → config; soak REFUSE memory check, S-ARCH-67; quote
FAA ¶3-10-5, AIM 4-3-3/4-3-22 in a note for ADR 0126), U-CARRIER last.

**Read the section below for how to work** (dispatch shape, gates, E2E lanes, human actions), but its "Do this
first" step 1 is DONE (no Playwright run is owed) and its queue items 1-3 are DONE. Start by asking the human which of
the next items to dispatch (docs pass + small items are file-disjoint and can run together).

## RELAUNCH HERE (2026-10-14 evening): round 2, four lanes merged, queue below

**State:** everything is merged into `efsp-wp5-correlation` (`3528d3c9`); no lane is running; the only worktree is the
main checkout. Record: `decisions.md` H147–H148, S-ARCH-62–65. Decision Desk: every question settled (round 10 = RSU).
**Cap: up to 4 lanes in parallel** (human, 2026-10-14, S-ARCH-62), every agent on Opus 5.5.

Merged today: DOCS-R2 (shared docs), U-RSU-DESIGN (ADR 0120 + `docs/mockups/rsu-panel.html`), U-JURISDICTION (ADR
0125), U-MOA (ADR 0124), U-PANELS (U10/U12/U13).
Gates on `d2437f10`: crc-sync 2775, crc-desktop 1352; on `75d88a58`: walk 23/23, freeze 56/56, soak:selfcheck PASS,
wire protocol 2 (surface unchanged). Sharded Playwright on `f2b73775`: 254/258, the 4 passed alone.

**Do this first:**
1. **Sharded Playwright on this tree** (owed since U-PANELS rewrote `par-panel`/`l18-incirlik`): `cd crc-desktop && npm
   run e2e:sharded -- --lanes 1,2,4,5 --rerun-failed` in the background; summary line in the log (`N/M passed`); the
   runner exits 0 on failures; "PASSED ALONE" = load. It took 129 min next to three lanes (~26 min alone) and loads the
   CPU hard: the human noticed. Then `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`. Merge no client
   files while it runs.
2. Dispatch from the queue, up to 4 at once where file-disjoint. Worktree first: `git worktree add -b lane/<L>
   ../sourcedcs-<L> efsp-wp5-correlation`. Prompt shape: "You are lane agent <L> … briefing <abs path> … lane-rules …
   decisions <ids> … worktree … E2E_LANE=<n> (lanes 1,2,4,5 belong to the sharded run) … who runs beside you and which
   files to stay out of … commit every ~15 min … report per rule 8". Give each parallel lane its own E2E_LANE (7, 8, 9, 3).

**Queue:**
1. **U-RELEASE** (ADR 0122) — `next/U-RELEASE.md`. Now unblocked (U-JURISDICTION merged). Tell it: call
   `airspaceStore.jurisdictionAt` / `isInsideJurisdictionOf(positionId, {lat, lon, altFt})` in **feet** (the DCS track's
   `alt` is metres; the entry alert uses `indicatedAltFt`), never move control on a `null` answer, a carrier area does
   not exist while its hull is not found (ADR 0125). Also from U-RSU-DESIGN: a guard hook at offer and at control move
   keyed on the receiving Position (RSU uses it for `IFR_NOT_CANCELLED`).
2. **U-PAR** (ADR 0123) — `next/U-PAR.md`. Unblocked (U-PANELS merged; scopes untouched, `showParFlight` now called from
   `strip-menu.js`). File-disjoint from U-RELEASE except `strip-menu.js` maybe: run together.
3. **U-RSU** (ADR 0120) — after U-RELEASE. Build briefing draft in `docs/wip/U-RSU-DESIGN.md`; **write
   `next/U-RSU.md` from it with H147 applied**: no `NOT_HOME_BASED` refusal (RQ3 b); RSU frequency **255.100** and **no
   station frequency hardcoded anywhere, all editable in JSON** (RQ5: audit server + client); **GC → RSU** path for local
   departures into closed traffic, the RSU takes tower's role for local VFR pattern traffic (RQ10 b: the ADR addendum
   must say what of LC's role the RSU holds); the other answers = the ADR's defaults. Check the ADR's FAA cites (JO
   7110.65 ¶4-2-10 b, ¶3-10-12 d) before building.
4. **U-MOA-TRANSIT** (H148) — no briefing yet: research (JO 7110.65 Ch. 9 SUA, JO 7610.4) then design + mockup for the
   human, then build. Includes route-crossing geometry for the card list (replaces U-MOA's name match).
5. **Docs pass** after U-RELEASE (it replaces the guide's §8 handoff table); fold `docs/wip/U-PANELS.md` (PAR paragraph
   ~l.1639 is stale, "Landing assured"), `U-JURISDICTION.md`, `U-MOA.md`, `U-RSU-DESIGN.md`. Owner: one DOCS lane, like
   `next/DOCS-R2.md`.
6. **Small items / declutter** (LT-GROUND ADR 0121, S-ARCH-49/51/53, T30, ¶5-4-6 e, LUAW text, `KEEP IFR`; stale
   comments: `tools/soak/shadow.js` l.49 "six stores", `surveillance/par-monitor.js` l.10 "Landing assured", the
   reconciler's `tick()` docstring; check an airspace approval rewriting a frequency leaves no Strip on `ap-sfa`).
7. **U-CARRIER** (U18–U21), **last** (the human's order); includes carrier `PATTERN`/`IN_PATTERN` (H147 RQ6). Open for
   the human: RMKS on the carrier FINAL line?

Open for a live test: Missed approach in the ⋯ menu on the PAR final (U-PANELS); U-MOA's amber row only checked with an
injected frame (no DCS units in the rig).

**Human actions (add to the list further down):** a server `state/efsp-airspaces.json` replaces the shipped file whole
and lacks the jurisdiction areas: delete or extend it (S-ARCH-64); an old `state/efsp-board.json` with the RSU's PATTERN
Strips must go before U-RSU ships.

**How this session worked (keep):** merge order by overlap (U-JURISDICTION before U-MOA, both touched the airspace
card); after a merge both unit suites, freeze, walk, soak:selfcheck when Board/wire/hub moved, `wire:record`; sharded
Playwright in the background; lanes stopped by usage limits are finished by a new agent in the same worktree with
"look at git log/status/diff first, keep what is sound" (worked well for all three today). Desk answers: `ArtifactData`
list `answers` with `out_dir` (287 docs), then read the ids you need.

## Earlier: RELAUNCH 2026-10-13 night (superseded)

**State:** everything is merged into `efsp-wp5-correlation`; no lane is running; the only worktree is the main checkout.
Last gates (tree `19c0ef1c`): crc-sync 2740, crc-desktop 1296, walk 23/23, freeze 56/56, wire protocol 2 unchanged.
Record: `decisions.md` H139–H146, S-ARCH-60–61. Decision Desk: every question settled (rounds 8–9).

**Do this first:**
1. **Run the sharded Playwright on this tree** (owed since U-STRIP): `cd crc-desktop && npm run e2e:sharded -- --lanes
   1,2,4,5 --rerun-failed`, in the background; read the summary line (the runner exits 0 on failures); afterwards
   `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`. It may run while the next lane works in its own
   worktree, but merge no client files while it runs.
2. Dispatch the queue below, **one agent at a time**, Opus, each from its briefing in `docs/parallel/next/` (the prompt
   points at the file: see the U-STRIP dispatch shape in git history / earlier lanes). Create the worktree first
   (`git worktree add -b lane/<L> ../sourcedcs-<L> efsp-wp5-correlation`).

**Queue (round 2, `live-test-2026-10-13.md`; briefings ready unless noted):**
1. **U-PANELS** (U10, U12, U13) — `next/U-PANELS.md`. U-STRIP touched `strip-menu.js` and appended to `efsp-panel.css`:
   small, separate hunks.
2. **U-JURISDICTION** (ADR 0125) — `next/U-JURISDICTION.md`: jurisdiction airspace (LTAG CTR control zone from AIP
   Türkiye AD 2.17, RAPCON = Adana MTMA SFC–FL280 minus the CTR, CARRIER 50 nm on the hull, CENTER the rest; no overlap
   except the carrier, H142–H145).
3. **U-RELEASE** (ADR 0122) — `next/U-RELEASE.md`, after U-JURISDICTION: released-by-default handoffs, "Checked in"
   before any control move, not-released moves control at the receiver's airspace boundary, Request release only on a
   not-released handoff, no withdraw (H141 U-RQ2, H142).
4. **U-PAR** (ADR 0123) — `next/U-PAR.md`: azimuth in degrees only, elevation lower limit −0.5° (safety, H141).
5. **U-MOA** (ADR 0124) — `next/U-MOA.md`: flight list with Approve on the airspace card; MARSA void-before-rendezvous
   only for tanker MARSA (H140, H141).
6. **U-RSU-DESIGN → U-RSU** (ADR 0120, U14/U15, H138) — **no briefing yet**; its list shows remarks (S-ARCH-61).
7. **Docs pass** (live-test batch + round 2 wip notes, incl. usage guide §4A stereo routes).
8. **Small items / declutter** (LT-GROUND ADR 0121, S-ARCH-49/51/53, T30, ¶5-4-6 e, LUAW text, `KEEP IFR`).
9. **U-CARRIER** (U18–U21), **last** (the human's order). Open for the human: RMKS on the carrier FINAL line?

Future: `docs/parallel/v3-backlog.md` (openAIP airspace import, H146).

**Also owed:** the live-test batch's **docs pass** (every `docs/wip/LT-*.md` → usage guide, briefing, CLAUDE.md: "six
stores" → five, `modeCIntruder`, `AcknowledgeVoid`, `TANKER_DISTANCE`, `airspaceEntry`, flight following); small items
(S-ARCH-49/51/53: ATO type normalisation, wake table vs Doc 8643, TOFI target name, duplicate "Flight" heading, stale
"Landing assured" comment in `surveillance/par-monitor.js`); declutter (LT-GROUND, T30, ¶5-4-6 e code display, LUAW
text, `KEEP IFR` on flight-following Strips). Watch `l4-drag` 172 (S-ARCH-57).

**How this session worked (keep):** after a merge: both unit suites, freeze, walk, soak:selfcheck when Board/wire/hub
moved, `wire-protocol.test.mjs`, then sharded Playwright **in the background** while the next lane starts (the human:
don't hold lanes for it); **read the summary line, the runner exits 0 on failures**; failures that "PASSED ALONE" are
load, not regressions. Lanes get cut off by rate limits: tell them to checkpoint every ~15 min; when the human says
"continue" after stopping a lane, finish it with a new agent in the same worktree (memory). The scratchpad is cleared
overnight: re-create it before logging into it.

**Human actions:** delete or fix `crc-sync/state/efsp-board.json` (local and server) before running this crc-sync
(H137); push a backup (`git push -u origin efsp-wp5-correlation`); release together from `main` when ready.

## START HERE: the live test's fix batch is planned, research first (2026-10-12)

You are the supervisor ("main") of lanes in this monorepo. You dispatch background agents in git worktrees, merge their
branches into `efsp-wp5-correlation`, and keep the record. History is in git and in `docs/parallel/decisions.md`
(S-ARCH-1 to S-ARCH-47, H107 to H132); the EFSP state for any reader is `docs/efsp-briefing.md` (§1, §3K, §4, §5). This
file only holds what you need now.

**Do this first:**
1. Read `docs/parallel/live-test-2026-10-11.md` (the human's findings T1–T31 with causes and rulings) and
   `docs/parallel/next/LIVE-TEST-FIXES.md` (the lanes, order, dependencies, ADR numbers 0117–0121).
2. Read the Decision Desk answers (https://claude.ai/artifact/FpddWVPwTzbpnmSJhW3vdt (new, private; old A3giz… is the public archive), `ArtifactData` list the whole
   `answers` collection, `limit: 1000`; questions **LT-Q1…LT-Q5**, round 8). Settle them into `decisions.md` (H133+),
   mark them settled.
3. Dispatch **LT-RESEARCH** (`docs/parallel/next/LT-RESEARCH.md`, Opus, docs only) first. Then the lanes in the order of
   `LIVE-TEST-FIXES.md`. After the research lands: put its label table (T8) and its questions on the Decision Desk.
4. The human said they will "send a new batch of agents": H112 (one agent at a time) is still the standing rule. Lanes
   0–4 of `LIVE-TEST-FIXES.md` are file-disjoint, so ask the human once whether to run them together.

### Standing rules (the human's, in force)

- **H99:** merge finished lanes into `efsp-wp5-correlation` without asking. **Never push, never deploy.**
- **H112: one agent at a time.** An agent the human stopped is not resumed unless they ask; its committed work may still be
  checked and merged by the supervisor. The human sometimes stops sessions to save usage: tell every lane to **commit at
  every green step**, and stop when the human says stop.
- **Dark-cockpit UI** (memory `feedback_dark_cockpit_ui`, H115–H119): grey unless something is a problem (amber needs
  attention, orange-red failed, red past a limit); show only what the controller needs, never tell them their job; panels
  are ordinary dockable panels; app-wide font only. Label anything we invented as ours, never as real-world practice; cite
  real sources (the human asks for them).
- **Models:** every agent on Opus 5.5 (human, 2026-10-10). Lanes never merge or rebase; the supervisor merges.
- **Every lane runs both unit suites** (client and server tests read each other's files). **e2e specs reach client modules
  through `crc.<module>`**: a lane that moves a function updates every spec, including specs merged after it branched.
- Never touch `crc-sync/state/` (the human's data) or **:3000** (the human's crc-sync). Never `pkill -f`; stop by PID. In this
  shell `grep` is a wrapper that skips ignored files (the scratchpad among them): use `command grep` or `awk` on logs there.
  The scratchpad is cleared between days: re-stage artifact files from the repo before publishing.
- **Auth hardening is out of scope.**
- **After every merge:** crc-sync `npm test`, `npm run walk`, `npm run freeze` (golden conflicts: take either side,
  `freeze:update` once), `soak:selfcheck` when Board/wire/sync/hub/soak files moved, `wire:record` on any wire change
  (protocol 2; the last release speaks 1); crc-desktop `npm test` (re-record `tests/fixtures/module-graph-exports.json`
  with `GOLDEN_RECORD=1 node --test tests/module-graph.test.mjs` when exports change). After client merges:
  `cd crc-desktop && npm run e2e:sharded -- --lanes 1,2,4,5 --rerun-failed` (never merge client files while it runs; it
  serves the main checkout), then `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`.
- To check a mockup or page headless: Playwright is in crc-desktop (`NODE_PATH=crc-desktop/node_modules node script.cjs`).

### State

`efsp-wp5-correlation` is local only, about 1,580 commits ahead of `main`. Everything is merged and green; the only
worktree is the main checkout (branches `lane/QA-sync-cleanup`, `lane/AIRSP-2P-B-geometry` kept on purpose). Last gates
(tree `07749161`, HULL-STRICT; everything after it is docs): crc-sync 2647, freeze 56/56, walk 23/23, soak:selfcheck PASS,
wire 2 unchanged, crc-desktop 1254; sharded Playwright 224/228 on the CARRIER-FOLLOWUP tree (the four pass alone).

**The live test (2026-10-11):** the human ran crc-desktop against a local crc-sync on :3000 (their `crc-sync/.env`, the
shared DCS server's Syria mission, SRS). It is stopped now; `crc-desktop/config.json` is back on
`wss://asacs.sourcedcs.page` (never commit a local endpoint). `crc-sync/state/` holds the test's Board and Mutation log
(the human's data: read only; T22/T31 were read from it). To run another local test: `cd crc-sync && node server.js` in the
background (stop it by PID), point `config.json` at `ws://localhost:3000` without committing, the human starts
`crc-desktop` and logs in; the MapTiler key is in `crc-sync/.env`.

New rulings since the panels (H128–H132): **FAA model, always** (H128, memory `feedback_faa_model_always`); strip
selection no longer rings the track, "Show on map" in the ⋯ menu (H129); the RSU answers (H130) and `IN_PATTERN` renamed
(H131); an alert for entering active airspace without approval (H132).

### Next (one lane at a time, Opus)

`docs/parallel/next/LIVE-TEST-FIXES.md`: LT-RESEARCH, LT-TERRAIN, LT-UI, LT-AIRSPACE-FIX, LT-CORRELATION, LT-SFA-PAR (ADR
0117), LT-STRIP-FIELDS, LT-MARSA (0118), LT-AIRSPACE-ALERT (0119), LT-RSU-DESIGN → LT-RSU (0120), LT-GROUND (0121).
After that, the older queue (briefing §4/§5): the flaky `grpc-client-connect` timing test; `wire:record` scanning refusal
codes / op argument names (asked, not answered); mission-reset drop as traffic; a carrier recovery remembering its launch;
`definitionHistory` on the wire; a route from a DCS line drawing; the correlation seq-jump decision; a soak that rolls the
mission; the cleanup row; declutter last (now with T30, the conflict-alert drawings switch).

### Human actions outstanding


- **Push a backup** of `efsp-wp5-correlation`.
- Untracked in the repo root, the human's: `crc-sync/│` (stray file), `state-backup-2026-10-03/`, `tools.zip`, and `state-backup-2026-10-10/` (the local Board the supervisor moved aside, H122).
- **Release together from `main`** (crc-sync and crc-desktop must ship together):
  - merge, then tag `crc-desktop-vX.Y.Z`;
  - in the server's `infra/.env`: `ASACS_*` → `CRCSYNC_*`, set `AIRSPACE_SERVICE_TOKEN` and both MapTiler keys;
  - delete the server's `state/efsp-board.json` and `state/efsp-mutations*.jsonl`, and check for any `state/efsp-facility-*.json`;
  - remove `approach` (or any unknown key) from a server `state/efsp-carriers.json`, or crc-sync refuses to start (H127);
  - check the deploy digest;
  - re-enter the airspace ranges;
  - re-import the ATO each mission.
- **Live checks:**
  - the 4 h soak workflow (needs the branch pushed; watch the heap slope);
  - wind direction;
  - restart crc-sync while DCS runs a mission (the log must show no "mission reset"), then restart the `.miz` (exactly one);
  - a real carrier and FINAL track;
  - a two-controller walk;
  - a manual crc-desktop login.
- **Squadron data:**
  - the stereo routes for Incirlik's departures (T6), into `state/efsp-stereo-routes.json`;
  - Incirlik headings;
  - GND/TWR/CD/AP frequencies;
  - SFA frequencies and pads;
  - comm card;
  - the DAFMAN combining rule;
  - projection data for MarianaIslandsWWII, Afghanistan and Iraq;
  - the LTAG PAR plate (threshold, TDZE, TCH, DA, glidepath angle);
  - the carrier fix-to-ramp time (`fixToRampSec`, ours: 6 min) and CVN-72 data (the carrier glideslope is no longer needed, H125).
