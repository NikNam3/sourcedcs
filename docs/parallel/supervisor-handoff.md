# Supervisor handoff

## UPDATE 2026-10-15: round 2 lanes all merged; RSU dropped (H149)

U-PAR (`76dadb38`, S-ARCH-66) and U-RELEASE (`de5b4a0d`, S-ARCH-67) merged; no lane running; sharded Playwright after
U-RELEASE: **270/270** on `d28dd76e` (14m38s). Open on the Decision Desk: **REL-Q1** (release model inside a
Facility) and **TWR-Q1** (how LC sees pattern traffic). **H149: no RSU**: queue item 3 (U-RSU) is replaced by
**U-TWR-PATTERN** (new ADR 0126, supersedes 0120's RSU model): remove the RSU Position and everything it owns (code
touchpoints: `command grep -rln RSU crc-sync/src crc-sync/config crc-desktop/app/public/js`, ~20 files), give LC the
pattern features per TWR-Q1, audit that no station frequency is hardcoded (H147 RQ5 stands); write its briefing after
TWR-Q1 (and REL-Q1, if AP→LC check-in changes the flow). Also queued: soak REFUSE memory check (S-ARCH-67).

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
2. Read the Decision Desk answers (https://claude.ai/artifact/A3gizEgbwfqCnnU831G4Y7, `ArtifactData` list the whole
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
