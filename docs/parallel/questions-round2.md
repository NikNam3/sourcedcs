# Questions — round 2 (wave 1 in flight)

Written by the questioner on 2026-09-30, after H1–H50, S-Q*, S-L11, S-L3a, S-W1–S-W3, S-L1a–c,
S-L2a and S-LG were in `decisions.md`. Sources: the plan, `decisions.md`, `questions-round1.md`,
the handoff, all eleven wave-1 briefings, the code at `cfcf344`, and the lane worktrees as they
stood at the time of writing (commits and `docs/wip/`).

Nothing already ruled is re-asked. Where a lane has visibly already applied a later decision, it is
listed in §A only so the integrator knows the briefing line is dead.

## Summary

| Tag | Count | Ids |
|---|---|---|
| HUMAN | 3 | R2-9, R2-11, R2-16 |
| SUPERVISOR | 14 | the rest |
| **Blocking** | 1 | **R2-1** (L1: runway-queue placement needs `board-store.js` edits the briefing forbids) |

---

## A. Briefing lines that later decisions superseded (no question; for the record)

| Lane | Briefing line | Superseded by | Lane status seen |
|---|---|---|---|
| L1 | §2 "a controller at OPS can suspend"; §5.6 `FIELD_STATE_OP_OWNERS` (Close/Open/BeginBarrierChange = OPS); §11 Q4 | S-L1b (TWR closes/opens/begins; others `RequestRunway…`) | not yet visible |
| L1 | §5.2 per-direction records with `reciprocalRunwayId`; §11 Q1 (b) | S-Q23 (one record per pavement) | applied (`runwayId:'05/23'`, `ends`) |
| L1 | §11 Q6 ship `BAK_12` at each end, `activeRunwayId:'05'` seed | H17 / S-L1a (gear `[]`), H22 (wind) | applied |
| L1 | §11 Q8 "self-coordinated ack recorded on the ack" | S-Q24 (one-input `SelfCoordinateRunwayChange`) | not yet visible |
| L1 | §11 Q5 "leave `rackIds[0]`" | round-1 Q26/Q27 via S-ALL — **contradiction, see R2-1** | — |
| L4 | §11 Q1 `CVN-1` / `CVN_75` Truman; `config/efsp-carriers.json` one `CVN_75` entry (`L4.md:868`) | H13 / H26: **CVN-72, DCS unit `UNION`** | no hull default in code yet — L4 must ship `CVN_72`/`UNION`, not `CVN_75` |
| L4 | §11 Q3 radial = BRC + 180; `L4.md:506` "no `marshalRadial` is ever stored" | H27 (settable, default final bearing + 180) | applied (`setMarshalRadial`) |
| L4 | T7 `L4.md:1209` "EFSP stores use wall-clock"; §6.8 "magnetic conversion out of scope" | H11; H15 / S-W3 | applied (`toMagnetic`, variation injected) |
| L5 | §5.6 metrics body `sessions[]` carrying `controllerId` (`L5.md:605`) | H35 (per-person breakdowns hidden) — see R2-4 | — |
| L6 | §5.2 crew of 9 sessions, 30 flights/h realistic | H46, H12 — see R2-6 | not started |
| L10 | §5.4 / Q4 A1 ground-clutter rule (`L10.md:232`, `:319`, `:485–496`) | H6 (A2: no hiding) | applied (`presentation.js` has no on-ground drop) |
| L10 | addendum "Mode 4 own = interrogating session's coalition" | H42 (server coalition) | applied (`mode4For:['own']`) |
| L10 | nothing about declutter | H6 (formation declutter off) | applied, forced off once for saved settings (`declutterOffH6`) — see R2-16 |
| L11 | `L11.md:16` "A1 open"; Appendix A "not in scope unless…" (`:1090`) | H43 (Appendix A in scope) | — |
| L11 | `L11.md:549` non-UNCLAS classification kept verbatim with a warning | H44 (always `UNCLAS`) | — |
| L3 | §5.8 atobrief adapter | H1 + L3's first addendum (USMTF only) | — |
| L2 | §5.3 / Q2 MTR times as `HHMM` strings | S-L2a (epoch) | applied (`zulu-time.js`, nearest ±12 h) |
| L8 | Q6 B5 "decision needed" | H40 (bug) | applied |

## B. Cross-lane collisions the plan §2 table misses (for the integrator; no ruling needed unless noted)

| File | Lanes | What | Merge note |
|---|---|---|---|
| `crc-sync/tests/ws-hub-wire-strictness.test.mjs` | L7 (+46), L10 (+96) | both append tests at the end | EOF conflict, keep both |
| `crc-desktop/app/public/js/app.js` | L7 (deletes the `efsp-obligation-alert` case), L10 (edits `DEFAULTS.declutter` and `loadSettings`) | neither is an append (S-Q3 said append-only) | different hunks; accept both |
| `crc-sync/src/efsp/nla-status-monitor.js`, `correlation-store.js` | L7 (comment rewrites) | L1 calls `nlaStatusMonitor.tick()` after field-state ops (L1 §5.8) | comments only; no conflict expected |
| `crc-sync/tests/helpers/efsp-scenario.mjs` | L7 (rewrote `obligationAlerts` to return `monitor.getAll()`), L1/L8 (append) | not append-only, but the element shape (`stripId`, `obligationType`, `severity`) is unchanged | new L1/L8 callers keep working |
| mission identity | L1 (`missionKeyOf` in `field-state.js`), L5 (`missionSessionOf` injected into `traffic-count.js`) | **two lanes inventing the same concept** | see R2-2 |
| `crc-sync/server.js` | L7 → L5 → L1 (S-L1c) | three hunks | as ruled |

---

## C. Questions

### R2-1 — L1 cannot route runway-queue placement without editing `board-store.js` beyond `_nlaCtx`   [lane: L1]  [who: SUPERVISOR]  [blocking: yes]
- Context: The L1 briefing restricts `board-store.js` to `_nlaCtx` (`L1.md:791`, plan §4 L1 "Shared: … `board-store.js` (`_nlaCtx` only)") and its Q5 default is "leave `rackIds[0]`, document it" (`L1.md:1018–1027`). But S-ALL adopted round-1 **Q26 (a)** (route TAXI→RUNWAY_QUEUE into the Rack of the Strip's resolved runway: `board-store.js:598`, `1092`, `1314`, `1616`) and **Q27 (a)** (the drag path computes NLA against the *target* Rack, `board-store.js:768`). Both are `board-store.js` edits outside `_nlaCtx`. The handoff lists "NLA always queues to `rwy-05`" as an L1 bug. Without it, after 05→23 every NLA-queued departure sits in `rwy-05` and rule 1 judges it against the inactive end. L1 already exports `runwayRackFor` from `field-state.js`, so it is heading there.
- Question: May L1 edit those four placement sites and the drag validation in `board-store.js`?
- Options: (a) yes, through one helper (`runwayRackFor(strip, fdr, fieldState, bay)`, falling back to `rackIds[0]`), plus the target `{bayId, rackId}` passed into the drag-path ctx, listed in L1's report; (b) no: L1 takes its briefing Q5 default, and a wave-2 lane (L1b) makes the change; (c) placement yes, drag no.
- **Recommended: (a).** No other wave-1 lane edits those functions (L5/L6/L8 only read `board-store.js`), and splitting it leaves L1's acceptance ("inhibited on the button **and** the drag path") true only for Rack `rwy-05`.

### R2-2 — What counts as "a new mission"? One shared definition, not two private ones   [lanes: L1, L5, wave-2 archiver (H36), L15]  [who: SUPERVISOR]  [blocking: no]
- Context: `grpc-client.js` emits `mission-load` on **every** crc-sync start (`connect()` → `_fetchMissionWithRetry`, `grpc-client.js:105`) and again on a DCS `mission_start` event (`:305–307`). DCS-gRPC gives no mission id. Three decisions hang on "mission change": H22 (active runway from the wind at load), H32 (a metrics session is one mission load to the next), and H36 (archive DROPPED Strips at mission change). L1 wrote `missionKeyOf(missionData)`, an FNV hash of theater, waypoint and drawing names (`sourcedcs-L1/.../field-state.js:291–309`). L5 takes an injected `missionSessionOf()` (`sourcedcs-L5/.../traffic-count.js:305`). With L1's hash, restarting the **same** `.miz` for tomorrow's sortie counts as the same mission, so the wind is not re-read and H32/H36 would not roll over. A plain `mission-load` would count every crc-sync restart as a new mission.
- Question: Where does mission identity live, and what starts a new one?
- Options: (a) one small crc-sync module (`mission-session.js`, persisted under `state/`): a new session starts on a `mission_start` event, or at `mission-load` when the fingerprint differs from the persisted one, or when the mission clock steps backwards by more than 5 min. A plain reconnect or restart of the same running mission keeps the session. L1 and L5 inject it; the integrator hoists L1's `missionKeyOf` into it; (b) each lane keeps its own notion, reconciled later; (c) every `mission-load` is a new mission.
- **Recommended: (a).** It is the only reading under which H22, H32 and H36 agree. Until the module lands, L1 and L5 keep their injected seams and name it in their wip.

### R2-3 — Which clock stamps a client metric event (L5 ↔ L15)?   [lanes: L5, L15]  [who: SUPERVISOR]  [blocking: no]
- Context: L5 accepts a client event only when its `at` is within ±10 min of the server's `now()` (`L5.md:334`), and buckets it by `at`. Under H11, `now()` is the mission clock, and a mission set at 0240Z but flown at 1900Z is hours away from any wall-clock stamp. So every L15 event stamped with `Date.now()` would be rejected.
- Question: What does the client put in `at`?
- Options: (a) the client's mission-Zulu estimate (the last `game-time` `zuluMs` plus elapsed `performance.now()`), and the server re-stamps late events rather than rejecting them; (b) the client sends wall time and the server converts it (`at − wallNow + clock.now()`); (c) the server ignores the client `at` and stamps on receipt.
- **Recommended: (c).** Events are reported within seconds, bucket granularity is an hour, and the result has no clock mismatch and nothing to validate. L5 defines the message and L15 inherits it.

### R2-4 — L5's read body vs H32 and H35   [lane: L5 (L15 later)]  [who: SUPERVISOR]  [blocking: no]
- Context: The metrics body is 24 rolling UTC hours (`windowHours: 24`, `L5.md:570`), with no mission-session axis, although H32 makes "one DCS mission load to the next" the unit, with rolling one-hour windows beside it. It also serves `rejectedMutations.sessions[]` with each `controllerId` (`:605`), which H35 hides ("everyone authenticated, per-person breakdowns hidden"). L5 already tags traffic records with `missionSession`.
- Question: How does the body carry H32, and what does H35 remove?
- Options: (a) add `missionSession` to every hour bucket and a `?missionSession=` filter, defaulting to the current session plus a rolling last-hour block. Drop `controllerId` and `sessions[]` from the served body: keep them in memory for the log and tests, never on the wire; `byPosition` stays; (b) as (a), but keep `sessions[]` with anonymous ids; (c) as briefed.
- **Recommended: (a).** A per-WS-session record is a per-person breakdown in all but name.

### R2-5 — Field-state refusals, and inhibited NLA, in L5's tap   [lanes: L1, L5]  [who: SUPERVISOR]  [blocking: no]
- Context:
  - L5's tap logs `NOT_HOLDING_POSITION` for **any** `-mutation` type (`L5.md:318–323`).
  - L1 audits "every field-state op, success and refusal" (`L1.md` §5.8), and its handler rejects `NOT_HOLDING_POSITION` before the store (§5.9 step 3). If L1 also logs that refusal, `efsp-field-state-mutation` refusals are written twice.
  - Separately, L5 counts an `InvokeNla` as a transfer attempt when `nlaStatusFor` has `transferTo` (`:300–306`). After L1, a Strip on a suspended runway still has `transferTo` (GND→TWR) but is inhibited. A press is then a "transfer failure", and the §11.1 99.5 % target counts runway suspensions as system faults.
- Question: Who logs wire-level refusals of the field-state message, and does an inhibited NLA count as a transfer attempt?
- Options: (a) L1 logs only from the store onward (step 2 on), and L5's tap owns `NOT_HOLDING_POSITION` for every type. An `InvokeNla` whose pre-status is `inhibited` is not a transfer attempt; L5 counts it as `inhibitedPress` instead; (b) L1 logs everything, and L5 exempts `efsp-field-state-mutation`; inhibited presses count as failures.
- **Recommended: (a).** One owner per log line, and an inhibit is the system working, not failing.

### R2-6 — L6's soak profile under H46 and H12   [lane: L6]  [who: SUPERVISOR]  [blocking: no]
- Context: L6 has not started. Its crew is 9 sessions, one per Position plus an observer, with 30 new flights/h and ~10–25 live Strips (`L6.md:323–395`). H46 says 12 concurrent flights, 3 controllers, plus a 3× stress mode. H12 gives 3–20 aircraft and a worst case of one controller holding every Position.
- Question: How do the profiles map?
- Options: (a) `realistic` = 3 sessions (e.g. `OPS+CD+GND+TWR`, `APP+CTR`, `TAC_C2+range`), arrivals tuned so live flights hover around 12. `stress` = 3× the rate (≈36 live) with `--crew solo`, one session holding every Position, which is H12's worst case. The 9-session crew stays as `--crew full`; (b) keep the briefing's profiles and add H46 as a fourth.
- **Recommended: (a).** The default run should be the squadron's reality, and the solo crew is where self-coordination and one socket's fan-out bite hardest. Stress above H12's 20 is on purpose: it looks for the limit.

### R2-7 — L3 cannot see L11's fixture during wave 1   [lanes: L3, L11]  [who: SUPERVISOR]  [blocking: no]
- Context: S-L3a and H16 say L11 commits the trimmed `ojw1v5` and its USMTF export "for you [L3] to parse". The two lanes run in parallel on separate branches, and L11's is uncommitted (`sourcedcs-L11/atobrief/test/fixtures/usmtf/ojw1v5-trimmed.yaml`, untracked). L3 has no way to test against it before merge.
- Question: How is the L3↔L11 round trip proved?
- Options: (a) L3 tests against the research fixture only (addendum 2). The integrator adds one cross-test after both merge: L11's committed export → L3's parser, zero `error`-level warnings, every acceptance field present for the fixture's missions; (b) L3 reads L11's branch with `git show` mid-wave; (c) L3 waits for L11.
- **Recommended: (a).** It has no cross-branch reads, and the shared research doc already binds both shapes (L3 addendum 4).

### R2-8 — L3's output keys: the briefing's `MissionLine` or S-Q50's `{fdrSeed, military, extras, warnings}`?   [lanes: L3, L14]  [who: SUPERVISOR]  [blocking: no]
- Context: The briefing specifies `{ lineId, seed, identityAto, military, ato, sourceLines, provenance, … }` per `MSNACFT` (`L3.md:554–590`). S-Q50 ruled `{ fdrSeed, military, extras, warnings }` per mission. L14 builds against whichever lands.
- Question: Which shape ships?
- Options: (a) S-Q50's four keys at the top, with the briefing's richer content nested: `fdrSeed` (= `seed`), `military`, `extras` (`{ ato, identityAto }`), `warnings`, plus `lineId`, `sourceLines` and `provenance` as metadata; (b) the briefing's shape, recorded as superseding S-Q50 in ADR 0063; (c) S-Q50 literally, dropping provenance.
- **Recommended: (a).** It honours the ruling without losing provenance, which L16's "source on hover" will want.

### R2-9 — The ATO's date vs the mission's date   [lanes: L3, L11, L14]  [who: HUMAN]  [blocking: no]
- Context: L3 resolves DTGs against the ATO's own `TIMEFRAM` (`sourcedcs-L3/.../usmtf-time.js:8–12`), and L11 takes `TIMEFRAM`/`ASOF` from `header.ato_date`. Nothing ties that date to the DCS mission's date. `ojw1v5.yaml:799` has `ato_date: '2026-07-04'`, while miztoyaml reads only the `.miz` start time and never its date (`tools/miztoyaml/extract.py:73–79`). Under H11 every vul window is compared with the mission clock (in-game Zulu **including its date**), which could be 2016. As it stands, every imported vul window could be days or years away from "now" on the scope.
- Question: When an ATO's date and the mission's date differ, which one is right?
- Options: (a) **the mission's**. An ATO DTG's day-of-month and time are kept, and month and year are taken from the mission clock (nearest matching day), with a warning when `TIMEFRAM`'s date disagrees. Later, miztoyaml fills `ato_date` from the `.miz` date so they agree at source; (b) the ATO's, and the planner must set the mission date to match; (c) ignore dates entirely and use time of day only.
- **Recommended: (a).** H11 already makes in-game time authoritative, and a planner reasonably dates an ATO by the real calendar. L3 keeps the raw DTG (round-1 Q54), so only L14 changes.

### R2-10 — Should miztoyaml fill the H43 fields?   [lanes: L11 (atobrief only), a later Python lane]  [who: SUPERVISOR]  [blocking: no]
- Context: H43 adds tankers/AWACS as missions, TACAN, datalink, Mode 1/2 and the rest to atobrief. L11 is atobrief-only, with "No change to miztoyaml" (`L11.md:82`). miztoyaml skips AWACS and tanker flights (`build_missions.py:640–645`), although the `.miz` holds their groups, TACAN channels and many datalink settings. So every package imported from a mission still needs these typed by hand.
- Question: Is that a follow-up lane?
- Options: (a) yes: a small independent Python lane after L11 merges, where miztoyaml emits tankers/AWACS as missions and TACAN/datalink where the `.miz` has them, and never IFF Mode 1/2 (not in the `.miz`); (b) no, planners type them; (c) fold it into L11 now.
- **Recommended: (a).** It touches only `tools/`, so it can run in any wave. L11 must stay tolerant of missing fields either way.

### R2-11 — How accurate must magnetic variation be?   [lanes: F2 (pre-wave-2), L4, L17, L22, every heading display]  [who: HUMAN]  [blocking: no (blocks wave 2's heading displays)]
- Context: H15 says magnetic always, with variation from "a per-theater source". S-W3 builds "the per-theater table" before wave 2 (`config/theaters.json` already reserves the slot). One number per theater is good to about ±1° over Syria, but not over large or high-latitude maps: Kola's variation spans roughly 10°+ east to west, and the South Atlantic/Falklands spans several degrees. DCS itself computes variation from a world magnetic model for the mission's date and position. Runway numbers, TACAN radials and the marshal radial (H27) are all read against it.
- Question: What does "per-theater source" mean?
- Options: (a) one constant per theater in `theaters.json` (simple; wrong by degrees on Kola and the Falklands); (b) a per-theater table **plus** a position term (a coarse grid per theater, interpolated); (c) the World Magnetic Model computed from position and mission date, with no table and matching what DCS shows in the cockpit, plus a per-theater override in `theaters.json` for a squadron correction.
- **Recommended: (c).** It is the only option that matches the cockpit on every theater (H13: every theater is coming). It is a small pure module with public coefficients, and `theaters.json` stays the override the human asked for.

### R2-12 — Who builds the variation/convergence module (F2), and what it hands to lanes   [lanes: supervisor pre-wave-2, L4, L17, L22, clients]  [who: SUPERVISOR]  [blocking: no]
- Context:
  - S-W3 says "outside the lanes, before wave 2", without saying where.
  - L4 found that DCS-gRPC's `heading` is **grid**, not true (`sourcedcs-L4/.../angles.js:12–14`, `gridToTrue(grid, convergence)`). A true→magnetic table alone is therefore not enough: the server also needs grid convergence, which today only the client computes (`crc-desktop/.../geo.js`).
  - The manual `hdgCorrection` (`app.js:143`, applied in `topbar.js:155,172`, `track-panel.js:275`, `geojson.js:538`, synced from the APRT panel) is what H15 retires.
  - L4 stores the marshal radial in **true** (`marshal-stack.js:496–500`) while controllers type it magnetic.
- Question: What is F2's scope?
- Options: (a) one pre-wave-2 fix by the supervisor: `crc-sync/src/magnetic.js` exporting `variationAt(lat, lon, dateMs)` and `convergenceAt(lat, lon, theatre)`, carried to clients on the `game-time` message. `hdgCorrection` and its APRT field are removed, and every client heading display converts with it. Typed magnetic inputs, such as the H27 radial, are converted to true on the server with the same function, never in the client; (b) F2 only adds variation to `theaters.json`, and each lane converts as it goes.
- **Recommended: (a).** One conversion point, used for both directions, avoids a round-trip drift between what is typed and what is shown.

### R2-13 — H36 archiving: which lane, and which FDRs   [lanes: wave 2 (unassigned), L5, L6]  [who: SUPERVISOR]  [blocking: no]
- Context: H36 archives DROPPED Strips, and FDRs with no live Strip, after 2 h or at mission change, "scheduled in wave 2". But no wave-2 lane in plan §3 owns it. Three points need a rule:
  1. **"FDR with no live Strip"** also matches a flight plan filed but not yet stripped (EFSP flight-plan lookup, `CRCSYNC_SOURCEDCS_WEB_URL`), which would be deleted after 2 h.
  2. **Undo of a Drop** (`board-store.js:1341–1367`) and L5's `VOID` must never target an archived Strip.
  3. **L5's boot backfill** classifies a missing count record "from the FDR as it is now" (`L5.md:462–465`), and that FDR may already be archived.
- Question: Who builds it, and what are the rules?
- Options: (a) it goes to **L1b**, which already holds `board-store.js`-adjacent client/server work after L1. Rules: only FDRs that have had at least one Strip and whose every Strip is DROPPED or archived; the 2 h is **wall** time since the drop (`wallAt`); "mission change" means R2-2's session roll-over; nothing already archived can be undone; and L5's backfill treats a missing FDR as `UNKNOWN` locality with basis `ARCHIVED`; (b) a new small lane L23 with the same rules; (c) defer to wave 4.
- **Recommended: (b) with (a)'s rules.** L1b is already the wave-2 long pole, and L6's 4-hour verdict fails by design until this lands.

### R2-14 — Owners and timing for L8's B1–B7, and the `SetState` escape hatch   [lanes: L8 (reporter), L1, wave 2]  [who: SUPERVISOR]  [blocking: no]
- Context: L8 reproduced the following (`sourcedcs-L8/docs/wip/L8.md`), all pinned as `todo` tests in `efsp-scenario-tactical.test.mjs`:
  - B1: JTAC cannot transfer back.
  - B2: TAC_C2 cannot answer a TOFI EXIT on an AIC-held line (L8 took fix (ii)).
  - B3: covering reassignment moves the owner but not the Bay, including at Incirlik GND→TWR.
  - B4: a transfer into another Position's Bay is accepted.
  - B5: JTAC binds and declares MARSA.
  - B6: JTAC is sent every Strip.
  - B7: AIC advances state through `SetState`, and it leaves a Strip in a Bay that contradicts its state.

  The handoff separately lists "SetState bypasses runway suspension" for L1. The files involved (`permission.js`, `board-store.js`, `efsp-ws.js`, `ws-hub.js`) are serialised, and wave 2 gives `permission.js` to nobody (L17 in wave 3).
- Question: Who fixes which, and when, and what is `SetState` allowed to do?
- Options: (a) a wave-2 lane **LT (tactical permissions)**, after L1 merges, owns `permission.js`/`board-store.js` for B1, B2 (fix ii), B3, B4, B5 and B7. `SetState` becomes owner-checked (refused where `STATE_OWNERS_BY_ROLE` gives the acting Position no entry for the target state, so AIC and JTAC lose it) and honours the runway inhibit (H19: the Strip waits). B6 (a per-session read filter on snapshot, resync and deltas) needs a design ADR, so it becomes its own lane after L10 and before L22, since both touch `ws-hub.js`; (b) L1 fixes the `SetState` inhibit now, and the rest waits for L17; (c) everything goes to L20.
- **Recommended: (a).** Wave 1 stays as briefed. B3 bites at Incirlik today, and (a) is the earliest slot that doesn't break the serialisation.

### R2-15 — The acknowledger that reverts across Facilities   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: L1's config sends APP's runway-change acknowledgement to `{facilityId:'CENTER', positionId:'CTR'}` when APP is unmanned (`sourcedcs-L1/.../facility-config.js`, `acknowledgerReversion`, from H20). The field-state handler checks `primaryOf(msg.actingPositionId)` **at the message's Facility**, INCIRLIK (`L1.md` §5.9 step 3). As written, CTR's ack is refused `NOT_HOLDING_POSITION`, and the permission table has no CTR row.
- Question: How does a reverted acknowledger act?
- Options: (a) the ack message carries `actingFacilityId`, and the handler checks Primary there when, and only when, the proposal's frozen acknowledgers name that `{facilityId, positionId}` pair; `FIELD_STATE_OP_OWNERS.AckRunwayChange` gains the reverted pair; (b) drop reversion and use H20's "skipped and audited" for an unmanned APP; (c) CTR acks by holding APP as an Observer.
- **Recommended: (b)** for wave 1, recorded in ADR 0061. Coordination isn't permission (H20), so skipping and auditing loses nothing safety-relevant, and (a) is a cross-Facility permission path that deserves its own review.

### R2-16 — Does H6's "every declutter behaviour" include navpoint declutter?   [lane: L10 (client settings)]  [who: HUMAN]  [blocking: no]
- Context: H6 disables "every declutter behaviour … (ground clutter, and the formation label declutter)". L10 did exactly that: the formation declutter defaults off and is forced off once for saved settings (`declutterOffH6`, `sourcedcs-L10` `app.js`). The same settings tab has **Navpoint Declutter** ("Hide numbered navpoints", "5-letter names only"; `index.html:637–656`, `geojson.js:344–345`), both on by default. It hides map navpoints, not contacts.
- Question: Does it stay on?
- Options: (a) yes: H6 is about contacts and labels, and navpoint filtering is map hygiene; (b) no: turn it off too, forced once like the formation one.
- **Recommended: (a).** It hides nothing about traffic, and switching it off floods the map with `WP1`/`NAV003` points.

### R2-17 — The existing typed time Blocks still store strings (round-1 Q43/Q45)   [lanes: L2, L8, L16]  [who: SUPERVISOR]  [blocking: no]
- Context:
  - S-ALL adopted Q45 (c): L8 pins the bug with a `todo`, and L16 fixes it. L8's briefing never picked this up, and its wip has no such test.
  - `setField` still writes `_startBlockEdit`'s string into `assigned.voidTimeUtc`, `releaseTimeUtc`, `edctTimeUtc` and `callForReleaseTimeUtc`. `voidDeadlineUtc` is derived from it (`fdr-store.js:626–630`), and `nla.js`'s HELD gates and the obligation monitor do epoch arithmetic on it.
  - L2 has meanwhile written the exact resolver needed (`sourcedcs-L2/crc-sync/src/efsp/zulu-time.js`, `resolveZuluHhmm(text, missionNow)`).
- Question: When are the existing time paths fixed?
- Options: (a) right after L2 merges, as a one-commit supervisor fix before wave 2: `setField` runs `resolveZuluHhmm` for every `…TimeUtc` writable path when given a string, plus a scenario test that a typed void time expires; (b) L16 in wave 2, as planned; (c) L2 extends it now.
- **Recommended: (a).** A typed void time that never expires is a live defect on every sortie. The fix is one path list plus a helper that will already be merged, and L16 then inherits correct data.
