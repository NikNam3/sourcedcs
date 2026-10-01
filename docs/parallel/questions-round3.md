# Questions — round 3 (wave 3 in flight: L17/L19/UI-A done, L18 server half, L28, UI-B, E2E hardening, L20, the real merge)

Written by the questioner on 2026-10-01. Read-only: nothing here changed code. Sources: `decisions.md` to S-UIA, `questions-round2.md`
(format), `wave2/L28.md`, L17/L19/UI-A/L18/L20PREP wip notes (read from their lane branches), `docs/efsp-briefing.md` §4,
`docs/wip/E2E-fix.md`, `E2E.md`, and the code in the dry-run worktree `../sourcedcs-INTEG` (`integ/wave3-dry`, 8e22e61: GRPC, SOAK, DOCFOLD,
TA, HYG, PARITY, L17, L19 merged on top of the wave-2 integration branch). File:line below are in that worktree unless a path says otherwise.

Nothing in `decisions.md` is re-asked. Where a question touches a ruled item (H19, H36, H65, S-L23 ...) it asks about the part the ruling did
not reach, and says so.

## Summary

| Tag | Count | Ids |
|---|---|---|
| HUMAN (squadron practice or a live walk) | 15 | Q3-2, 4, 6, 8, 10, 13, 15, 18, 19, 21, 22, 23, 24, 27, 34 |
| SUPERVISOR | 22 | the rest |
| **Blocking** | 5 | **Q3-1** (L18 server half), **Q3-3** (UI-B), **Q3-5** (the real merge), **Q3-7** (UI-B), **Q3-14** (E2E lane) |

The ten most valuable are first; §B onward is grouped by lane.

---

## A. The ten that matter most

### Q3-1 — The shipped `efsp-facility-*.json` shadows `DEFAULT_CONFIG`, so L18's server half (and a few earlier lanes) may never appear   [lanes: L18-server, L23, L20, integrator]  [who: SUPERVISOR]  [blocking: yes, for L18 server half]
- Context: L18's spec puts RSU/SFA/PAR into `facility-config.js` `DEFAULT_CONFIG` ("All in `facility-config.js` `DEFAULT_CONFIG` (INCIRLIK)", `docs/wip/L18.md` step 1-6). But `_loadOne` does `{ ...deepClone(defaults), ...onDisk }` (`facility-config.js:580`): any top-level key present in the file replaces the default **wholesale**. The committed `crc-sync/config/efsp-facility-incirlik.json` has the keys `facility, positions, coveringChain, bays, hiddenBlocks`, so `positions`, `coveringChain` and `bays` in `DEFAULT_CONFIG` are dead for Incirlik; the same for `efsp-facility-center.json` (`positions, coveringChain, bays, dataOnly, standingReleases, aitAuthorized, hiddenBlocks`). Worse, `_persist` (`:599`, called at `:756`) writes the **whole merged config** to `state/` after any config change, and a `state/` copy beats the shipped file (`readPath`), so after that the shipped defaults for every key, `fieldState` pads and `positionRadars` included, are frozen on the server. CLAUDE.md promises "a new default added by an image update lands with no migration"; that holds for files nobody ever wrote, not for these. The L18 spec's own test line ("positions load and validate") would pass on `DEFAULT_CONFIG` while the running server shows five Positions.
- Question: Where does Incirlik's Position/Bay inventory live, and how does a new default reach a server that has already persisted?
- Options: (a) L18-server edits **both** `DEFAULT_CONFIG` and the two shipped JSON files, and a startup test fails if a shipped JSON key differs from the default for the same key (drift test); `_persist` stops writing keys equal to the default (so a later default lands); (b) delete `positions/coveringChain/bays` from the shipped JSON files so `DEFAULT_CONFIG` is the single source; (c) leave as is and document "delete state/efsp-facility-*.json after each release".
- **Recommended: (b) plus the persist rule from (a).** One source of truth; the JSON files are where drift already happened. Check `state/` on the real server before the deploy; if a copy exists, the human decides whether to delete it (it is theirs).
- Evidence: `facility-config.js:580`, `:599-606`, `:756`; `node -e` key lists of the two JSON files; `docs/wip/L18.md` §"Server half" 1-6; CLAUDE.md "crc-sync has three directories".

### Q3-2 — H36 archives an FDR two hours after its Strip is dropped, but a DEPARTURE is dropped at HANDED_OFF and the sortie is 1.5-3 hours long   [lanes: L24 (merged), L5, L14, L17, L28, UI-B]  [who: HUMAN]  [blocking: no, but the first long live session hits it]
- Context: The usual flight is departure Strip handed off and **dropped** (`FLIGHT 1`), the flight flies 1.5-3 h (H12: session 2-3 h), then an ARRIVAL Strip is created for it. `archiver.js:11-14`: an FDR is archived in the sweep that archives its last Strip, 2 h wall time after the drop (`ARCHIVE_AFTER_MS`, `:27`). After that: (1) the returning flight has no FDR to bind to (callsign/squawk lookup finds nothing, so a new FDR is made and the plan, ATO line `fdr.ato`, MARSA and `military` Blocks are gone); (2) `ConvertToArrival` needs a live HANDED_OFF DEPARTURE Strip (`board-store.js:746-748`), so the local/transient classification `CONVERTED_ARRIVAL` (`traffic-count.js:134`) is lost and the count falls to `NO_AIRPORT_DATA`/`UNKNOWN`; (3) L14's mission-line to FDR bind and L14's `notInThisAto` list lose their target. The archive clock is **wall** time (`wallNow`), not the mission clock, so an accelerated or paused DCS mission skews it either way. S-R2-13 judged the FDR rule only against "a flight plan filed and never stripped".
- Question: What is "finished" for a flight that is airborne between its two Strips?
- Options: (a) an FDR is archived only when its flight is finished: its **last** Strip is a DROPPED ARRIVAL/RECOVERY (or an OVERFLIGHT), or its DEPARTURE was dropped and **N hours of mission time** (default 6) have passed with no contact in the picture; (b) keep H36 as ruled and accept a new FDR on return; (c) 2 h → 6 h.
- **Recommended: (a).** Archiving exists to bound memory, which a dropped departure's FDR costs nothing to keep for six hours at 20 aircraft; keeping the MISSION line bound is worth more than 2 h of memory.
- Evidence: `archiver.js:11-14, 27, 83`; `board-store.js:746`; `traffic-count.js:132-146`; decisions H36, H12, S-R2-13, S-L24.

### Q3-3 — UI-B's `sendEfspResync()` repairs only the Board; carrier, field-state, ATO and metrics have their own sequence numbers and no resync   [lanes: UI-B, L17, L1b, L14]  [who: SUPERVISOR]  [blocking: yes, for UI-B]
- Context: S-PARITY rules "wire it" for the resync path (ADR 0081). `_handleResync` (`efsp-ws.js:335-380`) answers with a board delta or a full snapshot, nothing else. The full snapshot also carries `fieldStates` (`:944`) and `carriers` (`:947`), but a **delta** answer carries none, and `efsp-carrier-delta` (`:700`, `carrierSeq`) and the field-state delta (`:1022-1026`, `fieldStateSeq`) are separate streams a client cannot ask to replay. So a client that reconnects within the ring window gets the Board delta, and a runway closure, a Case change or a marshal re-sequence made during the gap is never delivered; the dock panel shows the old runway status until the next change. Today that bug is hidden only because no client resyncs (it always takes a snapshot).
- Question: What does a wired resync do for the non-Board stores?
- Options: (a) any resync reply (delta or snapshot) always includes the full current `fieldStates`, `carriers` and (when set) the ATO summary, since they are tiny; the client replaces them; (b) full snapshot on every reconnect, no delta (delta path stays dead for the shipped client); (c) add replay rings for each store.
- **Recommended: (a).** The state is small (one record per runway/hull); (c) is machinery for no cost saving, and (b) leaves the work L27 did unused.
- Evidence: `efsp-ws.js:335-380, 700, 944-947, 1022-1026`; S-PARITY; ADR 0081.

### Q3-4 — A DCS server crash or mission restart in the middle of a session: what happens to the live Strips?   [lanes: F3, L24, L5, L1, L17, L19]  [who: HUMAN]  [blocking: no]
- Context: F3's session roll-over (`mission_start`, a changed fingerprint, a clock step-back) archives only DROPPED Strips (archiver rule 3, `archiver.js:15-16`). Live Strips (TAXI, INBOUND, a marshal stack, an open runway-works suspension, ALERT/SCRAMBLE flags, MARSA, a TOFI link) all survive the restart on the Board. After a restart the aircraft are respawned (new unit ids, `LINGERING_TRACK` territory), the wind and the active runway are re-derived (H22) over a Board that still has departures queued in the old runway's Rack, and a ship's Case/stack state is for a recovery that no longer exists. A squadron that flies DCS sees a server crash or a restart for "the next sortie" far more often than a quiet three hours.
- Question: At a mission roll-over, what happens to live Strips, field-state suspensions, carrier stack and links?
- Options: (a) nothing is auto-removed; a one-click "New mission: clear the board" for whoever holds OPS (and TAC_C2), which DROPs everything live in one audited Mutation, with live count shown in the confirm; (b) auto-DROP every live Strip at roll-over with an audit line; (c) status quo: controllers drop each by hand.
- **Recommended: (a).** (b) can destroy a real picture when `mission-load` fires spuriously on a crc-sync restart (F3's fingerprint decides, and the human's own `mission_start` live check is still owed); the confirm costs one input.
- Evidence: `archiver.js:15-16`; ADR 0086; S-F3 ("the human checks once, live, whether DCS-gRPC sends `mission_start` to a stream that connects mid-mission"); H22.

### Q3-5 — The real merge deploys to production on push to `main`: server first, old autoupdated clients second, with no test gate and a changed wire   [lanes: integrator]  [who: SUPERVISOR]  [blocking: yes, for the real merge]
- Context: `deploy.yml` runs on any successful crc-sync/atobrief/sourcedcs-web image build on `main` or `dev` (`environment` differs per branch), and `crc-sync-docker.yml` builds on push; neither runs `npm test`, and Playwright is in no workflow (grep of `.github/workflows` finds none). The wave changed the wire (boardEpoch and `strips.gone` in resync, `theater` message, `hdgCorrection` gone, carrier and field-state messages, new Roles/Positions/states, L28's removal of `TRANSITING`). Installed crc-desktop instances autoupdate only against a release tagged `crc-desktop-vX.Y.Z`, so for some hours or days the production server speaks the new wire to old clients (S-M-*: "no backwards compatibility" is lane policy, not a deploy plan). The crc-sync-state volume also holds the human's real Board, so the first start restores it under the new code (see Q3-9).
- Question: How does `efsp-wp5-correlation` reach the squadron?
- Options: (a) push to `dev` first (a separate environment and tag exist), exercise it, then fast-forward `main`, and cut the crc-desktop tag **before** merging to `main` so the clients autoupdate to the matching release (its release job already forces a crc-sync redeploy); add `npm test` as a required step before the image build; (b) merge to `main` directly; (c) tag crc-desktop first, merge after.
- **Recommended: (a).** The deploy pipeline already supports it. Add the test step in the same merge so the next lane is gated.
- Evidence: `.github/workflows/deploy.yml`, `crc-sync-docker.yml`, `crc-desktop-release.yml`; CLAUDE.md "How to build and release crc-desktop"; lane-rules.

### Q3-6 — Carrier flights have no path into the ATO, the traffic count or the home-airport rule   [lanes: L17, L14, L5, L15, L24]  [who: HUMAN]  [blocking: no]
- Context: The ATO import creates MISSION lines on TACTICAL only (`ato-board.js:33` `ATO_IMPORT_ORIGIN`); `DEPLOC/ARRLOC` is `writePathToday: 'none'` (`ato-mapping.js:63`), and nothing in `ato/` mentions a carrier (grep `carrier|CVN|ship`: only unrelated USMTF set names). A UNION-based flight therefore has an ATO mission line and, separately, an FDR that L17's launch/recovery Strips are made from; nothing joins them except the callsign. `config/efsp-instrumentation.json:7` has `homeAirports: { "INCIRLIK": ["LTAG"] }` only, so every CARRIER and CENTER Strip is classified `UNKNOWN / NO_HOME_AIRPORT_CONFIGURED` (`traffic-count.js:135-136`), although L17 Q9 ruled a launch, a trap and a recovered pattern flight each count once. H33 ("departs and lands at the same Facility's airfield") has no answer for a ship.
- Questions: (1) Who creates the launch Strip and FDR for a carrier flight, and how does it meet its ATO line? (2) Is a UNION cycle (launch and recovery) LOCAL?
- Options: (a) `homeAirports` gains `"CARRIER": ["UNION"]` (the hull is the field); a `LAUNCH` is created by the Position named in 0064 with a bind-by-callsign to the ATO FDR exactly as L14 does for BIND candidates, and a launch plus recovery by the same FDR is LOCAL; (b) carriers classify UNKNOWN until the human lists the squadron's carrier rules; (c) a carrier flight is always TRANSIENT.
- **Recommended: (a)** for the config row and the bind; ask the human (this question) only whether launching from UNION and recovering at Incirlik, which they do fly, should be LOCAL (recommend: no, TRANSIENT, same as any other field).
- Evidence: `ato-board.js:33`, `ato-mapping.js:63`, `config/efsp-instrumentation.json:7`, `traffic-count.js:132-146`; `docs/wip/L17.md` Q9; H13, H26, H33.

### Q3-7 — The L19 "AIRBORNE?" chip is refused while the runway is suspended, for a fact that has already happened   [lanes: UI-B, L1b, L19]  [who: SUPERVISOR]  [blocking: yes, for UI-B]
- Context: S-L19 left this open for UI-B. `SetState` to DEPARTED is refused by `_setStateRunwayRefusal` (H19), so after TWR forgets Airborne and then opens works on the runway, the chip's click fails with a runway reason while the aircraft is 3 miles out. H19 was written about a clearance ("the Strip waits"), not about a recorded fact. A related walk from the same note: a chip is only shown for a DEPARTURE in PUSHBACK/TAXI/RUNWAY_QUEUE/LUAW; a departure from Konya or Akrotiri (outside the 5 km footprint of the airfield the code knows, see Q3-8) is "airborne by speed alone", the chip fires if the aircraft is 60 kt on the ramp.
- Question: May an observed departure bypass the runway inhibit?
- Options: (a) yes, only for the chip's own `SetState(DEPARTED)` (a flag `source:'SURVEILLANCE_HINT'` on the op, audited), never for the NLA or a typed SetState; (b) no, the controller drops the Strip or waits; (c) the chip is hidden while the runway is suspended.
- **Recommended: (a).** The inhibit exists to stop a clearance, and the aircraft has already used the pavement; the audit line keeps the distinction.
- Evidence: `docs/wip/L19.md` "Walks done and not done"; `board-store.js` `_setStateRunwayRefusal`; H19, S-L19.

### Q3-8 — Konya and Akrotiri have no Facility, no runway inventory, no home airport and no airfield footprint for L19   [lanes: L1, L5, L19, L20, F2 (theaters)]  [who: HUMAN]  [blocking: no]
- Context: H13: "Incirlik (LTAG) is the main field; Konya (LTAN) and Akrotiri (LCRA) are used from time to time." The only Facility with a field is INCIRLIK (`facility-config.js:118-119` radars `LTAG`; `config/efsp-instrumentation.json:7`). `data/icao.json` maps Akrotiri to LCRA, nothing else names the fields. So: a departure created by CTR or APP for Konya has no OPS/GND/TWR to receive it, no runway state (`fieldState` is per Facility), no scope (`positionRadars` airport selector), and every Strip from or to it is TRANSIENT (H33). L19's airborne rule is relative to "the nearest airfield" from mission data (`airborne.js:25`), which exists for Konya, but only Incirlik has the Positions that act on the chip.
- Question: How do the squadron's occasional days at Konya or Akrotiri work in the EFSP?
- Options: (a) nothing: they are worked from CTR/APP as en-route traffic, a runway is not tracked, and the guide says so (a documented limit); (b) a "remote field" Facility template: one Position set (TWR+GND merged as `TWR`), the field-state record and a radar, instantiated per field from the theater table (H13: no hardcoded Syria); (c) a full second Facility copy of INCIRLIK per field.
- **Recommended: (a) now, (b) as the next lane if the human flies a full Konya night.** Ask the human how often the whole squadron operates from Konya/Akrotiri (not just lands there).
- Evidence: `facility-config.js:118-119`, `config/efsp-instrumentation.json:7`, `data/icao.json:25`, `airborne.js:25`; H13, H33.

### Q3-9 — Before the real merge, has the merged tree been started against a copy of the human's live `state/` and the production volume?   [lanes: integrator, L28, F3, L24, L17, L26]  [who: SUPERVISOR]  [blocking: no, but do it before Q3-5's deploy]
- Context: Every lane of the wave added a persisted shape: Board snapshot (L27's `replay` cache and `boardEpoch`, L24's `droppedWallAt`), `mission-session.json` (F3), `efsp-traffic-count.jsonl`/`efsp-metrics.json` with L5's old session numbers (S-F3 "accept the repeats"), carrier state, the audit log format (L26's `facilityId`/`fdrId`). L28's `TRANSITING → IN_SECTOR` migration is the only restore migration anyone has designed; none of the unit suites boots the whole server on a real snapshot (the soak boots a synthetic one). The human's `crc-sync/state/` (`efsp-board.json`, `efsp-metrics.json`, `efsp-mutations*.jsonl`, `efsp-traffic-count.jsonl`, `mission-session.json`, `efsp-stereo-routes.json`) is the right test input, and the compose volume `crc-sync-state` on the server is a different, real one.
- Question: Is there a restore-compat step in the merge?
- Options: (a) the integrator copies `crc-sync/state/` to the scratchpad, starts the merged crc-sync on a spare port with `CRCSYNC_STATE_DIR` (or equivalent) pointing at the copy, connects the e2e client, and asserts the Board count, no restore warnings, and the metrics endpoint; the same step is documented for the server volume; (b) unit tests with fixtures only; (c) skip.
- **Recommended: (a).** Reading the copy is read-only for the human's data (P3). Includes the check for the `TRANSITING` migration and the `efsp-facility-*.json` question of Q3-1.
- Evidence: `crc-sync/state/` listing; `docs/wip/L28.md` plan §5.7; S-F3; ADR 0048, 0081, 0082, 0086.

### Q3-10 — A pilot on an OVERFLIGHT Strip asks to land, divert or hold: there is no path from OVERFLIGHT to ARRIVAL   [lanes: L28, L23, UI-B]  [who: HUMAN]  [blocking: no]
- Context: `ConvertToArrival` requires `role === 'DEPARTURE'` and `state === 'HANDED_OFF'` (`board-store.js:746-748`). An overflight that diverts to Incirlik or requests a missed approach and a stop-and-go has no conversion; the controller must DROP it and `CreateStrip` an ARRIVAL, losing the FDR bind unless the callsign matches, and the traffic count books it TRANSIENT/`OVERFLIGHT` plus one ARRIVAL. L28's design (four states, handoff to the next Facility) does not mention a landing request, and `ConvertToArrival`'s APP/CTR-only gate is the only cross-role conversion that exists.
- Question: Does an overflight need a way to become an ARRIVAL (or the reverse)?
- Options: (a) add `OVERFLIGHT IN_SECTOR → ARRIVAL INBOUND` to `ConvertToArrival` at APP/CTR (same stripId; the overflight count record is voided, one ARRIVAL counted); (b) no: drop and recreate, document it; (c) only at APP.
- **Recommended: (a)** if the squadron ever tells the human about diverts through Incirlik (ask); otherwise (b) and one guide paragraph. It needs L28 to choose before its ADR is written.
- Evidence: `board-store.js:746-748`; `docs/parallel/wave2/L28.md` §5.2, §5.6; ADR 0023.

---

## B. L28 — the OVERFLIGHT lifecycle

### Q3-11 — At CENTER, the new IN_SECTOR NLA says "Hand Off" and moves nothing, beside a Coordinate "HANDOFF" that moves the flight   [lane: L28]  [who: SUPERVISOR]  [blocking: no]
- Context: L28 §5.2 (Q2 (a)): IN_SECTOR's NLA is `Hand Off` → HANDED_OFF with no `transferTo`, "the flight leaves airspace this server does not model"; `Coordinate` HANDOFF is the route to CTR→APP. ARRIVAL's INBOUND at CENTER deliberately **inhibits** the same press with "cross-Facility HANDOFF required" (V4, `nla.js:319`), because pressing the wrong one stranded a flight in the earlier sorties. Under (a) a controller who presses the big NLA button for a flight that should go to APP marks it HANDED_OFF and the receiver never gets a Strip, with no refusal. Under the guide `HANDED_OFF` also means "drop next".
- Question: How is the wrong-button case prevented?
- Options: (a) the NLA button is labelled "Leaves sector" (not "Hand Off") and the Strip, when `coordination` could reach a next Facility from this Position, shows Coordinate as the primary and Leaves sector in the menu; (b) as briefed, "Hand Off", plus a confirm if a Facility exists that the flight's route enters; (c) as ARRIVAL: inhibit at CENTER.
- **Recommended: (a).** The two words describe different facts; the 8-character-label rule is fine.
- Evidence: `L28.md` §5.2, §11 Q1-Q2; `nla.js:319`; ADR 0022.

### Q3-12 — One overflight handed CTR→APP is counted twice (once per Facility Strip), and the traffic count's "countable states" move with it   [lanes: L28, L5, L15]  [who: SUPERVISOR]  [blocking: no]
- Context: L28 §5.6 counts an OVERFLIGHT once it reached IN_SECTOR or HANDED_OFF, per Strip (`countIdFor` = `stripId:clientMutationId`, `traffic-count.js:154`). Under H74 the receiver's replica is a new Strip that walks INBOUND→IN_SECTOR→HANDED_OFF→DROPPED again, so one aircraft crossing CENTER into Incirlik's APP is two counted flights, once at each Facility (`facilityId` on the record, `:534`), and the "traffic count" in the metrics panel adds them. For an ARRIVAL/DEPARTURE replica the existing rule (a coordination replica's drop is `NOT_COUNTED`?) is not stated for OVERFLIGHT in L28.
- Question: Is a coordinated overflight one flight or two in the count?
- Options: (a) one: a replica Strip's drop is never counted (`excludedReason: 'COORDINATION_REPLICA'`), the originator's drop is; (b) two, one per Facility, and the dashboard says "per Facility" (as the table already is); (c) count the receiver only (the flight ended there).
- **Recommended: (a)**, whatever the existing ARRIVAL/DEPARTURE rule is; L28 reads `countability` first (V7) and aligns OVERFLIGHT with it, and the supervisor confirms.
- Evidence: `traffic-count.js:154, 534`; `L28.md` §5.4, §5.6; H34.

### Q3-13 — Tankers, AWACS and MTR flyers cross CENTER without a Strip: who creates their OVERFLIGHT?   [lanes: L28, L25, L14, L2]  [who: HUMAN]  [blocking: no]
- Context: After L14 and L25 a tanker or AWACS is a MISSION line at TAC_C2 (ATO). The squadron flies MTRs (H23) and AAR. Nothing says whether an orbiting tanker or an MTR flight crossing the CENTER sector also gets an OVERFLIGHT Strip at CTR (and so counts as TRANSIENT traffic in metrics), or whether its MISSION line is enough. If both, there are two Strips for one FDR and TOFI's `ifrActive` pairing (`tofiCoordination.peerStripId`, UI-A U8) can pick the wrong one.
- Question: Which flights get an OVERFLIGHT Strip?
- Options: (a) only flights not on the ATO and not an MTR user: anything with a MISSION line is represented by that line only; (b) every flight CTR works, both Strips, kept in step by a join; (c) the controller decides (as today).
- **Recommended: (c)** and write it in the guide; revisit if a walk shows duplicated lines. Ask the human what a CTR controller does today with a tanker.
- Evidence: `ato-board.js:33`; `docs/parallel/wave2/L28.md` §2 (out of scope: overflight FDR fields); H23, H43, S-R2-10.

---

## C. E2E hardening, CI and the merge

### Q3-14 — Specs share one crc-sync for the whole run, so a failing spec poisons every later one   [lane: E2E hardening (L28 owns E2E lane 8 per S-UIA)]  [who: SUPERVISOR]  [blocking: yes, for the E2E lane]
- Context: `docs/wip/E2E-fix.md`: of 13 consistent failures, seven were "cross-file state leaks" (a suspended runway, a scramble, `VIPER11`, `L####` MISSION Strips); the fix is a throwaway `_freshField` fixture on the first test of each file plus a rule "retire what you create". The UI-A report adds `ordnance-hung` "pilot walks" **fails alone on the base** because it depends on an earlier spec having set the active runway. `E2E.md` third run: all five `l4-drag` tests failed on a RECONNECTING page. Convention-based cleanup does not survive a failing spec.
- Question: How is isolation enforced?
- Options: (a) a test-only reset (`POST /__test/reset`, mounted only when `E2E=1` and never in the Docker image) that clears Boards, field state, carriers, ATO and metrics, called by a global per-file `beforeAll`; (b) restart the crc-sync web server per spec file (about +8 s each, ~25 files); (c) keep the convention.
- **Recommended: (a).** It is the only one that makes "runs alone" and "runs in sequence" the same thing; write a spec that proves it (run `ordnance-hung` alone, then after `field-state`, same result).
- Evidence: `docs/wip/E2E-fix.md` (causes table); `docs/wip/UI-A.md` "Report numbers"; `E2E.md` third full run; S-M-e2e9.

### Q3-15 — The shipped crc-desktop UI loads `dockview` and `maplibre` from public CDNs   [lanes: E2E, crc-desktop packaging]  [who: HUMAN]  [blocking: no]
- Context: `crc-desktop/app/public/index.html:7,8,12` loads `maplibre-gl@3.6.2` from unpkg.com and `dockview-core@5.1.0` from cdn.jsdelivr.net. E2E-fix vendored them for the **tests** (`page.route` from `node_modules`), while the product still depends on two public CDNs at every launch: a CDN hiccup, a firewalled network or a squadron member on a flaky link yields an app with no map and no docking (`toggleDockPanel` reads a null `dock`, E2E.md). `packaging-config.test.js` can't see it. The app also ships an offline-capable Python bridge, so offline is a plausible state.
- Question: Vendor them into the app?
- Options: (a) vendor both (and the CSS) into `crc-desktop/app/public/vendor/` pinned, with a packaging test asserting no external `<script src>`; (b) leave and add a visible "could not load X" banner; (c) leave.
- **Recommended: (a).** Small, removes a class of flake from both the product and the tests.
- Evidence: `crc-desktop/app/public/index.html:7-12`; `docs/wip/E2E-fix.md` (CDN row); `docs/wip/E2E.md` runs 2-4.

### Q3-16 — Which pilot requests become permanent specs? (the walks nobody did)   [lanes: E2E hardening, L12-L19, UI-A]  [who: SUPERVISOR]  [blocking: no]
- Context: The standing feedback is "trace switch/cancel/late-arrival of every new field". Not walked in any wip note (each says "not done" or covers only the happy path): (1) HUNG: pilot reports, then **cancels** ("negative, it fell off"), then reports again after a runway change; (2) ALERT/SCRAMBLE: set, then **cancelled on the ground** (S-L13 classification), then set on a Strip handed to another owner; (3) runway works begun while a departure holds a HUNG advisory; (4) ATO re-import after Strips exist (Q3-20); (5) a mission-line callsign changed after BIND; (6) `KEEP IFR` toggled during an active TOFI; (7) a Marshal slot dragged while a Strip is COMMENCED; (8) a Case change with a flight already on FINAL; (9) the L19 chip clicked at the same moment TWR presses Airborne (both advance; `_swallowRepeatAdvance`); (10) a typed time retyped as the actual (W5) after F4's ±12 h resolve, near midnight Zulu; (11) an OVERFLIGHT handed off then the receiver drops it (S-L23's test) in the browser; (12) controller disconnect/reconnect with Strips (Q3-21).
- Question: Does the E2E hardening lane write these as specs?
- Options: (a) yes, one spec file per Role ("pilot-requests-<role>.spec.js"), each a switch/cancel/late-arrival triple for every new field, with the twelve above as seeds; (b) only the ones with a wire-level scenario test missing today; (c) leave to the human's live walks.
- **Recommended: (a) for 1, 2, 3, 6, 7, 8, 9, 11 and 12**; (4), (5) and (10) are scenario tests, not browser specs.
- Evidence: `docs/wip/L12.md`/`L13.md` (walks), `docs/wip/L17.md` ("Not done"), `docs/wip/L19.md`, memory `feedback_walk_pilot_requests_not_just_lifecycle`.

### Q3-17 — No CI step runs a test before an image is built and deployed   [lanes: integrator, E2E hardening]  [who: SUPERVISOR]  [blocking: no]
- Context: `.github/workflows/crc-sync-docker.yml` has only build/metadata steps (no `npm test`), atobrief's and sourcedcs-web's the same; only the crc-desktop release workflow runs `npm test`. The CLAUDE.md `Commands` claim a test suite per service; none gates a deploy to production. The lane-run suites exist (crc-sync 1884+ tests, crc-desktop 764) and `soak:selfcheck` runs in ~40 s.
- Question: What does CI gate?
- Options: (a) one `test` job per service (`npm ci && npm test`) required by the docker job (`needs:`) plus `soak:selfcheck` for crc-sync; Playwright stays a manual/integrator run (needs a display and 12 min); (b) add Playwright to a nightly workflow; (c) nothing.
- **Recommended: (a).** The unit suites already pass on the dry-run branch.
- Evidence: `.github/workflows/*`; CLAUDE.md "Commands".

---

## D. Pilot-request walks nobody did

### Q3-18 — A scramble on a suspended runway waits behind the works   [lanes: L1, L13, L19]  [who: HUMAN]  [blocking: no]
- Context: H19: "the Strip waits" when a runway is suspended (`FINAL → LANDED` uninhibited, but a departure into the runway queue is inhibited). ADR 0070 / H56: alert and scramble are flags, "never order", "no inhibit, no reordering". Combined: a SCRAMBLE departure at the alert pad is held like any other by a runway-works suspension, and the controller's only exits are the Drop or a runway change. L19's chip makes the same point in the other direction (a recorded departure can't be recorded).
- Question: Does an active SCRAMBLE override a runway suspension?
- Options: (a) no, as ruled; the advisory text says "SCRAMBLE: runway 05/23 suspended" in the scramble line (already there?) and TWR can lift the works; (b) yes: a SCRAMBLE Strip's state changes are never inhibited by field state, with an audit line `inhibitOverridden`; (c) TWR gets a one-input "clear for alert departure" on the Strip.
- **Recommended: (a).** The runway inhibit is a controller's call about a physical runway (works, FOD); the flag must not decide it. Ask the human whether the squadron does scramble drills.
- Evidence: decisions H19, H56, S-L13; ADR 0070; `docs/efsp-briefing.md` §4 ("An audited override ... not built").

### Q3-19 — A pilot reports hung ordnance after landing: the Strip may already be dropped   [lanes: L12, UI-A]  [who: HUMAN]  [blocking: no]
- Context: H55 lets any Position the pilot is talking to record HUNG (3G); UI-A U1 lets OPS write it on "any non-DROPPED departure". The advisory ("after landing, taxi to the hot cargo pad") matters most **after** touchdown: the pilot says it on the roll or at the hold, usually to TWR/GND. A landed ARRIVAL goes `LANDED`, then ground ownership, then DROPPED by whoever is last (often immediately). `docs/wip/UI-A.md` explicitly limits the OPS rule to departures because "OPS has no ARRIVAL Bay"; whether GND/TWR can write 3G on an ARRIVAL in `LANDED`, and what happens to the advisory once the Strip is dropped, is not walked.
- Question: Can 3G still be recorded and seen on a landed or just-dropped arrival?
- Options: (a) yes for any non-DROPPED Strip at any Position (the Strip must not be dropped while 3G is not CLEAN: Drop is refused with "hung ordnance: taxi to <pad>" until CLEAN or an override); (b) as built, and the guide says to leave the Strip open; (c) the advisory is also a Facility-level banner (field-state panel) for N minutes.
- **Recommended: (a)** if the human confirms hot-pad routing is part of how they fly it; otherwise (b).
- Evidence: `docs/wip/UI-A.md` U1 "Defaults taken"; decisions H21, H55, S-L12; `docs/wip/L12.md` walk notes.

### Q3-20 — Re-importing an ATO leaves the old lines on the Board forever   [lanes: L14, UI-B]  [who: SUPERVISOR]  [blocking: no]
- Context: H65: "a new import replaces the previous one". The code lists the earlier ATO's flights that the new one does not mention in `notInThisAto` and says "listed, never dropped (Q55(a))" (`ato-board.js:355-364`). So after a second ATO (the squadron's second sortie of the night), yesterday's MISSION lines at TAC_C2 are still there, still counted as live, and still shown in the AR join and the "with AIC/JTAC" tab. A controller has to drop each one by hand. Q55(a) was ruled before H65 said "replaces".
- Question: What does "replaces" mean for the Strips of lines no longer in the ATO?
- Options: (a) the preview offers a default-on checkbox "drop N mission lines not in this ATO" (only those not yet airborne/ON_STATION), one Mutation each, audited; (b) as built; (c) drop all unconditionally.
- **Recommended: (a).** It matches H65 without risking an airborne flight.
- Evidence: `ato-board.js:355-364`; decisions H65, S-L14.

### Q3-21 — A controller's connection drops for 30 s: which Positions and Strips come back?   [lanes: L23, L27, UI-B]  [who: HUMAN]  [blocking: no]
- Context: `onDisconnect` releases every Position the controller held and auto-promotes where it can (`index.js:376-378`, guide §4.8.6). H12: 1-4 controllers, so with one controller `OPS+CD+GND+TWR+APP+CTR+TAC_C2` all go at once, Strips move down the covering chain, and on reconnect the controller has to re-select the Positions (nothing remembers the set). L23's fix for F10 returns CD Strips on retake; with the Marshal chain (Q3-25) and TAC_C2 cover the "return" path is untested in a browser (E2E has none) and the UI has no "restore my last Positions" button. A WebSocket drop is the most common live failure; the human's own `LG` live check is about the same event.
- Question: What does a returning controller see?
- Options: (a) the client remembers the last held Position set and offers one-input "Restore N Positions" on reconnect (server unchanged, covering-chain return as built); (b) the server keeps a Position reserved for the same controllerId for 60 s after an abrupt disconnect (Strips stay put); (c) status quo.
- **Recommended: (b)** with (a) as the fallback if the 60 s lapses: it removes the churn at the cost of a short unattended window, which is the common case (a blip).
- Evidence: `index.js:376-378`; `position-store.js:176-202`; decisions H12, S-L23; `docs/efsp-briefing.md` §4 ("never been walked against the rendered UI").

### Q3-22 — With 1-4 controllers and 16+ Positions, there are no Position presets   [lanes: UI-B]  [who: HUMAN]  [blocking: no]
- Context: H12 (1-4 controllers) vs the Position inventory: OPS, CD, GND, TWR, APP, RSU, SFA, PAR, CTR, TAC_C2, AIC, JTAC, GCI, RANGE and the four CV Positions (CV_PRIFLY, CV_MARSHAL, CV_APP, CV_FINAL after L17). The Position picker is one by one (grep `preset|bundle` in `panels/efsp/` finds only an unrelated word in `bay-view.js`). A solo controller selects Positions at every start and every drop (Q3-21).
- Question: Does the squadron want named Position sets (for example "Tower cab = OPS+CD+GND+TWR", "Approach = APP+CTR", "Carrier = CV x4", "Tactical = TAC_C2+AIC+JTAC") in the picker?
- Options: (a) client-local presets (a personal setting like the ATC map background), defaults for the three or four obvious ones; (b) a server config table by crew size; (c) none.
- **Recommended: (a).** One client file and no server change.
- Evidence: `panels/efsp/` grep; decisions H12, H41 (personal client settings precedent); L17 report (four CV Positions).

### Q3-23 — A runway change with arrivals already inbound and departures already queued   [lanes: L1, L1b, UI-B]  [who: HUMAN]  [blocking: no]
- Context: S-Q25 resolves a Strip's runway as Rack, then FDR field, then the Facility's `activeRunway`. An ARRIVAL in APP's INBOUND Bay has no runway Rack and typically no 8A, so it resolves via `activeRunway`: when TWR changes 05→23 it silently flips to 23 in the NLA inhibit and the Strip's runway chip, though the pilot is flying the 05 ILS. Departures queued in `rwy-05` stay in their Rack (S-R2-1). Neither the guide nor the wip notes walk "TWR changes runway at 2 NM" or "a 4-ship holding".
- Question: Does a runway change re-resolve in-flight arrivals, or are they pinned?
- Options: (a) at the change, every Strip already past INBOUND (BASE/FINAL/IN_PATTERN) stays pinned to its resolved runway (the resolver stores it in the FDR once, source `RESOLVED_AT_CHANGE`), and a banner lists "N arrivals on 05, N departures queued for 05"; (b) as built; (c) refuse the change while any arrival is on FINAL for the old end.
- **Recommended: (a).** It matches practice (a landing aircraft finishes its approach) and it makes the Rack placement coherent. Ask the human whether TWR ever changes with traffic inside 5 NM.
- Evidence: decisions S-Q25, S-R2-1, S-L1d; `docs/wip/L1.md`/`L1b.md`.

### Q3-24 — The marshal radial's default follows the ship's turn   [lanes: L17, L4]  [who: HUMAN]  [blocking: no]
- Context: H27: radial settable, default final bearing + 180. `docs/wip/L17.md`: "Enter sets, empty Enter on the radial returns to the default". The default is computed from the live ship heading; a ship that turns into the wind after the radial was passed to the first flights moves the default under them. L17 stores a radial only when typed (0064: "no marshalRadial is ever stored" superseded by H27). Nobody walked "ship maneuvers after commence". The squadron's real marshal procedure gives a radial by BRC at Case time, held for the recovery.
- Question: Is the default radial frozen when the first flight is told it?
- Options: (a) the default is captured (stored, source `DEFAULT`) when the first Strip enters the stack, and re-capturing is the controller's button; (b) live default as built; (c) captured at Charlie time.
- **Recommended: (a).** A published radial that moves is worse than one the controller re-sets deliberately.
- Evidence: decisions H27; `docs/wip/L17.md` "What the guide should say"; ADR 0064.

### Q3-25 — The carrier's covering chain ends at the Marshal, who then holds approach Strips it cannot advance   [lanes: L17, UI-B]  [who: SUPERVISOR]  [blocking: no]
- Context: S-L17 watch item (1): APP2 → APP1 → Marshal; "confirm in a walk". With the carrier staffed by 1-2 people this is the situation whenever the Final controller steps away: all FINAL/BALL Strips drop to the Marshal, who owns none of those states (`CV_MARSHAL` owns LAUNCH/IN_STACK/COMMENCED). The Strips are stuck until someone takes the Position back. There is no alert for it. L6's F10 was the same shape at Incirlik and got a fix (L23); this one was kept by design (0064).
- Question: Accept, or fix?
- Options: (a) accept and add an `efsp-alerts` line "N carrier Strips with no controller who can advance them" (the L7 obligation pattern, no new state); (b) stop the chain at APP1 so the Strips stay owned by the departed Position's last holder; (c) chain to PriFly.
- **Recommended: (a).** A hard design change is not justified by one unmanned case, but the stranded state must be visible.
- Evidence: `docs/wip/L17.md` Q11; S-L17; L6 F10; `facility-config.js` carrier block.

---

## E. Soak, live checks, L20 and the paperwork

### Q3-26 — The 4-hour soak does not exercise anything built in waves 2-3   [lanes: SOAK owner, L17, L19, L28, L14]  [who: SUPERVISOR]  [blocking: no]
- Context: `tools/soak/traffic.js` scripts: arrival, departure, overflight (L28 will change it), tactical (AIC/JTAC?). Not driven: carrier launch/recovery and the carrier tick, field-state operations (runway works, change, ordnance), ATO import, scramble, the L19 hint monitor (the harness has no contact: "the harness has no gRPC"), the metrics tap's NLA path. The human runs the 4 h workflow once (H37); `memory.slope` is judged only on 3 h+ with 2 h warm-up (S-SOAK, branch `lane/SOAKW-warmup-default`), so a 4 h run is a rare asset.
- Question: Which scripts join the soak before the human's run?
- Options: (a) add three scripts: `carrier` (launch, stack, commence, final, ball/bolter), `field` (runway works and change, ordnance, scramble flag), `ato` (import, re-import, mission-line walks), each ~5 % of traffic; (b) only `carrier` (largest new store); (c) none: unit tests cover them.
- **Recommended: (a).** The failures a soak finds (unbounded maps, replay-cache growth, `_nlaHistory`) are exactly in the new stores. Ten virtual minutes each in `soak:smoke`.
- Evidence: `crc-sync/tools/soak/traffic.js`; `docs/wip/L17.md` "Not done" ("the four-hour soak"); S-SOAK; H37.

### Q3-27 — Five live-DCS checks are owed; a single planned session would close them   [lanes: human, LG, F2, F3, L17, L19, UI-A]  [who: HUMAN]  [blocking: no]
- Context: owed by decisions/wip: (1) LG: 10 min of the unit stream without the "stream ended" loop (S-LG); (2) F3: does DCS-gRPC send `mission_start` to a stream that connects mid-mission (S-F3); (3) S-F2b: the ATIS wind against the mission editor's, `grpc-client.js:764` `heading·180/π + 270` possibly 90° off; (4) L17: UNION found (`hull not found` otherwise) and the banner/marshal tick against a real ship (S-L17 watch (4)); (5) L19: taxi, line up, take off without pressing Airborne and watch the chip appear 5 s after rotation; (6) UI-A U2: two controllers, one holding APP and CTR, a coordinated arrival notification; (7) the L5/L26 metrics against a live mission (no real contact in any harness).
- Question: Does the human want one scripted live session (about 1.5 h, one mission with Incirlik traffic and UNION) with the supervisor as note-taker, and in what order?
- Options: (a) yes: order (2) (3) (1) at boot, (5)+(6) with two clients and a few flights, (4) with a Hornet recovery on UNION, results written to `docs/wip/LIVE.md`; (b) check separately as time allows; (c) after the real merge.
- **Recommended: (a), before the real merge.** Several of these change code (the wind formula, Case defaults, the `mission_start` gate), which is cheaper before the deploy than after.
- Evidence: S-LG, S-F3, S-F2b, S-L17, S-L19, S-UIA.

### Q3-28 — L20 "runs alone, last" but touches comments across every file, and three more lanes are queued behind its inputs   [lanes: L20, L28, UI-B, E2E, integrator]  [who: SUPERVISOR]  [blocking: no]
- Context: the L20 draft (`L20-prep-inventory.md` D-5, "Shared-file rules") needs L17, L18 server, L19, UI-A, L28 and UI-B merged first and then "runs alone"; it edits comments and `_comment` keys in `permission.js`, `nla.js`, `board-store.js`, `ws-hub.js`, `efsp-ws.js`, `facility-config.js`, `strip-view.js`, `bay-view.js`. It also instructs: add `_comment` to config files "if the loader accepts them" (S-L9), "Do not add `_comment` keys to `efsp-facility-*.json`" (C-14), and the loaders are not all verified: `config/efsp-instrumentation.json` and `efsp-airspaces.json` are read by different loaders (`airspace-config.js`, `instrumentation-config.js`). A comment-only diff in 30 files conflicts with any code lane running at the same time.
- Question: What is L20's slot, and how is "comments only" verified?
- Options: (a) L20 starts only after L18-server, L28 and UI-B have merged (the real merge's order), and its acceptance runs `git diff -U0 | grep '^[-+]' | grep -v '^[-+]\s*\(//\|\*\|/\*\)'` on **code** files, empty except named exceptions (the prep file's own check), plus a test per config loader that a `_comment` key is accepted; (b) split L20 per directory and run it earlier in parallel; (c) skip the comment-only constraint.
- **Recommended: (a).** L20PREP already wrote the check; make it part of acceptance and add the loader test.
- Evidence: `L20-prep-inventory.md` §3 "Shared-file rules", "Acceptance" 3-5, §5 D-5; decisions S-L9, S-L20PREP.

### Q3-29 — Who owns ADR numbers and the shared docs after the real merge?   [lanes: integrator, L20, UI-B, E2E]  [who: SUPERVISOR]  [blocking: no]
- Context: ADR numbers in the tree: 0074 L17, 0075 L18-client, 0076 L19, **0077 L20 (reserved)**, 0087 L28 (reserved), **0090 unused** (UI-A's note: "0090 stays free"), 0091 U6. UI-B and the E2E lane have none assigned; the TA lane changed the behaviour of 0091's block text (a P4 correction: needs its own ADR, no number given). The "to fold" list is long and has three owners: DOCFOLD (done to wave 2), the integrator (L17, L19, UI-A, TA, SOAK, the L26/L18 text), L20 (CLAUDE.md `soak:selfcheck`, theaters.json, `HYG` edits). CLAUDE.md is stale in four places per S-DOCFOLD/S-HYG. P3 bars lanes from shared docs.
- Question: Who writes which, and which numbers?
- Options: (a) 0090 = UI-B (resync, RUNWAY_CHANGE label, chip override), 0092 = TA's correction of 0091, 0093 = E2E (the reset hook, if Q3-14 (a)); the integrator folds the shared docs in one commit after the real merge, L20 only text inside code; CLAUDE.md edits by the integrator in that same commit; (b) all by L20; (c) per lane.
- **Recommended: (a).** One owner for each file removes the merge conflicts DOCFOLD already hit.
- Evidence: `ls docs/adr` (gaps 0074 on lane branch, 0077, 0087, 0090); S-DOCFOLD, S-HYG, S-UIA, S-TA; P3, P4.

### Q3-30 — Carrier, field state and the JTAC read scope: what is a JTAC sent that is not a Strip?   [lanes: L23 (merged), L17, UI-B]  [who: SUPERVISOR]  [blocking: no]
- Context: ADR 0080/`read-scope.js:9-13`: "Everything else in a message (Positions, Bays, airspaces, field state, config) is not a flight and goes to everybody". Since then L17 added the `carriers` snapshot key and `efsp-carrier-delta`, L14 added `efsp-ato-*` previews, L19 added the `surveillance` slice (filtered by visible Strip, correct) and L5/L15 the metrics. H59: "the JTAC's UI shows only what a JTAC knows." A JTAC session is sent the ship's full Case/stack (flight callsigns on the marshal board, ETA/angels) and the ATO `fdr.ato` of every FDR it is not handed? (`visibleFdrIdsOf` filters FDRs by visible Strip, so that part is fine). The carrier stack lists flights by callsign and push time, i.e. other flights' identities.
- Question: Are the carrier stack and ATO previews filtered for OWNED read scopes?
- Options: (a) yes: `efsp-carrier-*` and the snapshot's `carriers` are sent to a session only if it holds a CARRIER Position or reads ALL; ATO preview results only to the requester (already true); (b) accept: "the carrier is a ship, not a flight"; (c) filter only the stack's flight list.
- **Recommended: (a).** One line in `read-scope.js`, and a test in the PARITY style (a JTAC-only session's wire contains no callsign it was not handed).
- Evidence: `read-scope.js:9-13`; `efsp-ws.js:700, 944-947`; H40, H59, ADR 0080.

---

## F. Smaller, from a read of the merged code and docs

### Q3-31 — L28's restore migration plus F3's mission roll-over both fire on the first start of the merged tree   [lanes: L28, F3, L24]  [who: SUPERVISOR]  [blocking: no]
- Context: `docs/wip/L28.md` (plan §5.7) maps `TRANSITING → IN_SECTOR` once at restore in `index.js` `_restore`. The first start after the merge has a persisted `mission-session.json` from F3 only if F3 already ran on that machine; if the fingerprint differs (a new mission the next night) the roll-over archives all DROPPED Strips **while** the migration is changing live ones. The order is unspecified (`_restore` vs the session init).
- Question: Order and idempotence?
- Options: (a) migrate first (the Board is made legal), then roll over; the archiver checks only DROPPED so no interaction; add a test that restores a snapshot with a TRANSITING Strip and a changed fingerprint; (b) leave to chance.
- **Recommended: (a).** Cheap, one test.
- Evidence: `docs/parallel/wave2/L28.md` §5.7; `archiver.js:15-16`; ADR 0086.

### Q3-32 — `soak:selfcheck`/`soak` flags: the "not judged under 3 h" rule exists only as a branch   [lanes: SOAK owner, integrator]  [who: SUPERVISOR]  [blocking: no]
- Context: S-SOAK ruled `memory.slope` is judged only on runs of 3 h or more with a warm-up of at least the retention; "implement as the default in a follow-up". `lane/SOAKW-warmup-default` exists (checked out as a worktree) but is not in any S- row and not merged in `integ/wave3-dry` (merge list: GRPC, SOAK, DOCFOLD, TA, HYG, PARITY, L17, L19). Until it merges, `npm run soak:smoke` reports a memory failure on every short run (S-M-soak), which will be read as a regression by the next lane.
- Question: Merge it with the batch?
- Options: (a) yes, with GRPC/SOAK; (b) after the human's 4 h run; (c) drop.
- **Recommended: (a).**
- Evidence: `git branch -a` (`lane/SOAKW-warmup-default`); S-SOAK, S-M-soak.

### Q3-33 — Two tuning files and a persisted facility config, with no startup log of what was actually loaded   [lanes: L19, L17, L20, integrator]  [who: SUPERVISOR]  [blocking: no]
- Context: P5 says tuning files are read once at startup and never written. The new ones (`efsp-surveillance-hints.json`, `efsp-carriers.json` with a `state/efsp-carriers.json` override, `efsp-instrumentation.json`, `theaters.json`, the facility files) have different override rules and no single log line of which file (shipped or `state/`) each was read from. The Q3-1 shadowing is invisible to the human for the same reason.
- Question: Log it once at startup?
- Options: (a) one `[config] <name>: shipped|state/<name>|defaults (reason)` line per config at startup, and a `GET /api/config-sources` (controller-authenticated) the guide can point at; (b) log lines only; (c) no.
- **Recommended: (b).** The line costs nothing; the endpoint is optional.
- Evidence: `facility-config.js:563-598` (`console.warn` only on failure); `readPath` in `state-paths.js`; P5.

### Q3-34 — `CRCSYNC_COALITION` and a squadron that flies red and blue on the same night   [lanes: L10, L17, HYG]  [who: HUMAN]  [blocking: no]
- Context: H42 settled "two crc-sync servers, one per coalition", and HYG wired `CRCSYNC_COALITION` (default 3) through compose as one variable. The carrier config says `coalition: 'own'` (efsp-carriers.json) and Mode 4 is modelled on the same coalition. Nothing in `infra/docker-compose.yml` (one `crc-sync` service) shows how a second server is declared (second service, second Casdoor client, second hostname, second `crc-sync-state` volume), and crc-desktop's default endpoint is one URL (deliberate per memory). If the squadron ever flies a Red-vs-Blue night this is a deployment task with a name.
- Question: Is a second coalition server planned in 2026, and does the human want its compose block written now?
- Options: (a) yes: add a commented `crc-sync-red` block with its own state volume and URL; the desktop's endpoint becomes a settings field; (b) no: write one paragraph in the guide; (c) defer.
- **Recommended: (c)** unless the human has a date. The paragraph in (b) costs minutes and prevents the next questioner asking.
- Evidence: decisions H42, S-HYG; `infra/docker-compose.yml`; memory `feedback_crc_desktop_default_endpoint`.

### Q3-35 — The overflight lifecycle and the ATC scope: what does L22 draw for IN_SECTOR vs INBOUND?   [lanes: L28, L22]  [who: SUPERVISOR]  [blocking: no]
- Context: L22 merged with the owner letter and the CST/`+` rules and keys the target's ownership letter by the Position that **owns the Strip**; the scope shows `INBOUND`/`HANDED_OFF` data tags for ARRIVAL/DEPARTURE by state name (check `track-label.js`). L28 renames OVERFLIGHT's states to names those two Roles already use (T1: "any check that compares a state without the Role is now wrong"). `track-label.js` and the `iff`/presentation code was not in L28's V1 grep list (it greps `server and client mirrors` of the states, but the list names `efsp-nla.js`, not `track-label.js`/`geojson.js`).
- Question: Does L28's V1 sweep include scope/label code that switches on bare state names?
- Options: (a) yes: add `track-label.js`, `geojson.js`, `strip-template.js`, `conformance.js` and `stca.js` to V1 and a test per file that an OVERFLIGHT in `INBOUND` is not drawn as an ARRIVAL; (b) trust the existing test suite; (c) the grep in §2 point 1 only.
- **Recommended: (a).** Cheap and exactly the trap L28 §9 T1 names.
- Evidence: `docs/parallel/wave2/L28.md` §4 V1, §5.1, §9 T1; `crc-desktop/app/public/js/track-label.js`.

### Q3-36 — The ATC scope after a runway change, and Konya/Akrotiri radars   [lanes: L22, L1b]  [who: SUPERVISOR]  [blocking: no]
- Context: `positionRadars` select by `airport: 'LTAG'` (`facility-config.js:118-119`) and CENTER `airport: '*'` (`:264`). A flight operating from Konya (LTAN) or Akrotiri (LCRA) sits in no Incirlik radar's range (distance ≫ coverage) so CTR's STARS scope (with H41's per-Position scheme) sees it only through CENTER's `*` approach selector and the ATC scheme's "hostile SA indicator" (H47); the Position held for the field (Q3-8) has no scope at all. This is the radar-picture counterpart of Q3-8.
- Question: Is a per-theater airfield list of "airfields with a radar" a theater table item?
- Options: (a) yes: `theaters.json` lists the fields the squadron uses with their ICAO, radar type and home flag, and the radar selectors, the `homeAirports` default (Q3-6) and L19's airfield table read it; (b) leave per-config; (c) defer.
- **Recommended: (a)** with Q3-8 (b) as the consumer; H13 already says theater-specific values sit in per-theater tables.
- Evidence: `facility-config.js:118-119, 264`; `config/theaters.json`; H13, H62, H69.

### Q3-37 — Metrics: an alert scramble and a cancelled scramble after the E2E reset, and "inhibited press" for the L19 chip   [lanes: L5, L26, L19]  [who: SUPERVISOR]  [blocking: no]
- Context: S-R2-5 counts an inhibited NLA press as `inhibitedPress`, not a transfer failure. The L19 chip's `SetState` is not an NLA, so when it is refused for the runway reason (Q3-7) it is counted by L5's tap as an ordinary refused Mutation (a failure against the §11.1 99.5 % target), which is the very thing S-R2-5 wanted to avoid for NLA presses.
- Question: Does a refused hint chip count as a failure?
- Options: (a) the op carries `source: 'SURVEILLANCE_HINT'` (needed for Q3-7 anyway) and the tap files a refusal with that source under `inhibitedPress`; (b) as is; (c) the chip is hidden when it would be refused (Q3-7 (c)).
- **Recommended: (a).**
- Evidence: decisions S-R2-5, S-L19; `docs/wip/L19.md` "Walks".

---

## G. Index of owners (for the supervisor)

| Lane | Questions |
|---|---|
| L28 | Q3-10, 11, 12, 13, 31, 35 |
| UI-B | Q3-3, 7, 21, 22, 23 |
| E2E hardening | Q3-14, 15, 16, 17 |
| L18 server half | Q3-1 (blocking), 8 |
| L20 | Q3-1, 28, 29, 33 |
| Integrator (real merge) | Q3-1, 5, 9, 17, 29, 32 |
| Human (practice and live walks) | Q3-2, 4, 6, 8, 10, 13, 15, 18, 19, 21, 22, 23, 24, 27, 34 |
