# Questions — round 1 (before wave 1 dispatch)

Written by the questioner on 2026-09-29, against `49e6bb2` (`efsp-wp5-correlation`). Sources read:
`docs/efsp-parallel-plan.md`, `docs/efsp-briefing.md`, `docs/efsp-wp6-plan.md`, the guide sections the
lanes cite, ADRs 0045–0059, `docs/parallel/decisions.md` (P1–P6, D1), the finished wave-1 briefings
(`wave1/L7.md`, `L9.md`, `L10.md`, plus the open-question sections of `L2.md` and `L4.md`), and the
code each lane touches.

Where a briefing already asks a question with a default, it is repeated here only if it needs the
human, or if this questioner found something the briefing did not. What P1–P6 and D1 settle is not
re-asked: branch naming, ADR numbering, never editing ADRs, restart-only tuning files, and L7's new
ADR.

Every question carries a recommended answer. A lane that finds no ruling in `decisions.md` takes
the recommendation (P2).

## Summary

| Lane | Questions | HUMAN | SUPERVISOR | Blocking |
|---|---|---|---|---|
| X | 22 | 9 | 13 | 2 |
| L1 | 18 | 6 | 12 | 3 |
| L2 | 5 | 3 | 2 | 0 |
| L3 | 10 | 3 | 7 | 2 |
| L4 | 8 | 6 | 2 | 0 |
| L5 | 12 | 4 | 8 | 1 |
| L6 | 6 | 3 | 3 | 0 |
| L7 | 7 | 2 | 5 | 1 |
| L8 | 5 | 2 | 3 | 1 |
| L9 | 2 | 0 | 2 | 0 |
| L10 | 7 | 5 | 2 | 1 |
| **Total** | **102** | **43** | **59** | **11** |

**Ask these HUMAN questions first; each blocks a lane's core work:**
- **Q46**: L3. Is the squadron's ATO the atobrief YAML package (a real one, `Flashbang 1.6.yaml`, sits at the repo root) rather than USMTF text?
- **Q89**: L8. What does the AIC actually do with a mission line (the scenario's script)?
- **Q96**: L10. Approve the per-session classification table, which changes colours on every controller's scope.

**Blocking SUPERVISOR questions (rule before dispatch):** Q1, Q3, Q23, Q24, Q25, Q50, Q65, Q82.

**High-value HUMAN questions that do not block, but shape several lanes:** Q13 (which
clock EFSP times mean), Q78 (DROPPED Strips are never freed, so the 4-hour soak
fails by design), Q47 (the real package has no IFF codes, times or agencies),
Q6 (which ADRs you read before merge, given P4), Q57 (marshal radial
convention).

**Contradictions found between the guide, the ADRs, the plans and the code:**
- Q1: the plan and the briefings are untracked, but worktrees only see commits.
- Q2: the briefing's test and ADR counts are stale.
- Q3: `ws-hub.js`, `server.js`, `app.js` and the harness are shared but absent from plan §2.
- Q24: the WP6 plan's D21 test contradicts guide §4.8.3 rule 3 (self-coordination is one input).
- Q25 and Q26: rack-first runway resolution plus `rackIds[0]` placement make rule 1 check the wrong runway, or none.
- Q43: guide §3.7 requires append-only history, and plain `fdr` Blocks overwrite.
- Q45: typed time Blocks write strings into epoch fields.
- Q57: the guide's "180 relative to BRC" vs the reciprocal of the final bearing.
- Q63: a new `fdr.carrier` vs 0052's single military namespace.
- Q53: the atobrief doc's stale squawk formula, and codes in crc-sync's synthetic block.
- Q78: WP8's "no memory growth" vs never-freed DROPPED Strips.

---

## X — cross-cutting, process, squadron reality

### Q1 — The lane plan and `docs/parallel/` are untracked, so worktrees will not see them   [lane: X]  [who: SUPERVISOR]  [blocking: yes]
- Context: `git status` shows `?? docs/efsp-parallel-plan.md` and `?? docs/parallel/` (decisions, these questions, the wave-1 briefings). P1 cuts each lane's worktree from the integration branch, and a worktree only contains committed files.
- Question: How do lanes get the plan, their briefing and `decisions.md`?
- Options: (a) commit the plan and the briefings to the integration branch before cutting worktrees; lanes read `decisions.md` by absolute path from the main checkout; (b) everything by absolute path; (c) paste into each prompt.
- Recommended: (a). A committed briefing is stable. Reading `decisions.md` by absolute path means a mid-wave update reaches lanes without a rebase.

### Q2 — The briefing's baselines are stale   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: `efsp-briefing.md` §1 says "crc-sync 1068, crc-desktop 390, ADRs 0001–0055". The plan says 1151 / 488 / 0059. The WP6 plan's Verification says "grow from 1052 / 361". Every lane reads the briefing first.
- Question: Which baseline do lanes report against?
- Options: (a) re-measure in the fresh worktree and report start and end counts; (b) the briefing's figures.
- Recommended: (a).

### Q3 — `ws-hub.js`, `server.js`, `app.js` and the scenario harness are shared, but not in §2   [lane: X]  [who: SUPERVISOR]  [blocking: yes]
- Context:
  - The L7 briefing edits `ws-hub.js` (`_efspAlertsMsg`, the connect send, a new `setOnEfspChange` hook in `_onMessage`) and `server.js` (the obligation block `:432–456` and the alerts block `:477–506`).
  - The L10 briefing's step 7 edits `ws-hub.js`'s label fingerprint (`:245`).
  - L5 will wire metrics "near the monitors" in `server.js`.
  - L7 also deletes a case in `app.js:746`.
  - L1, L8 and possibly L7 will want helpers in `crc-sync/tests/helpers/efsp-scenario.mjs`.
  - None of these files is in plan §2.
- Question: What rule governs them?
- Options: (a) add them to §2: the harness and `app.js` are append-only; `ws-hub.js` is serialised L7 → L10; `server.js` is serialised L7 → L5; (b) forbid them, and make lanes route around them.
- Recommended: (a). L10 and L5 rebase their small hunks onto L7.

### Q4 — Merge order inside wave 1   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: P1 says to merge "in the order of §3", which is L1…L10. That order is independent of Q3's serialisation, and L5 consumes L7's new compliance semantics.
- Question: What is the actual order?
- Options: (a) L1→L10 as written, with conflicts resolved by the integrator; (b) L9 (read-only), L7, then L1, L2, L3, L4, L5, L6, L8, L10.
- Recommended: (b). The order stays the same for everything else. L7 simply moves ahead of L5 and L10.

### Q5 — Naming new e2e specs, and the L7 briefing's e2e lane   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: Existing specs are named `l1-marsa.spec.js` … `l5-arrivals.spec.js`, where `l` is a UI level rather than a lane. The plan gives L7 "no e2e lane", but the L7 briefing (its Q7) asks for lane 7 for `l4-badges.spec.js` and a new `obligation-retract.spec.js`. Lane 7 belongs to L16 in wave 2, so there is no clash in wave 1.
- Question: What are new specs called, and does L7 get lane 7 in wave 1?
- Options: (a) new specs must not start `l1-`…`l9-`; name them after the feature (`obligation-retract.spec.js`, `mtr-fields.spec.js`); L7 gets lane 7 for wave 1; (b) no e2e for L7.
- Recommended: (a).

### Q6 — Which lane ADRs need your review   [lane: X]  [who: HUMAN]  [blocking: no]
- Context: P6 assigns 0061 (L1), 0062 (L2), 0063 (L3), 0064 (L4), 0065 (L5), 0066 (L10) and 0067 (L7). P4 says an ADR is never edited once committed, so a review after merge can only lead to a new ADR.
- Question: Which ones do you want to read before they merge?
- Options: (a) the product-facing ones only: 0061 (runway change and field-state behaviour), 0062 (MTR placement), 0064 (carrier design), 0066 (what every scope's colours mean); the supervisor accepts the rest; (b) all; (c) none, you read at wave end.
- Recommended: (a). Because of P4, "before merge" is the only cheap review point.

### Q7 — How far a lane may deviate from the WP6 plan   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: Plan §4 says the WP6 plan's decisions are settled, but the code has moved since: `0058` moved ALT/HDG to `fdr.clearance`, `0059` rebuilt the wire, and line numbers have shifted.
- Question: When code and plan disagree, what does a lane do?
- Options: (a) follow the code, record the deviation in its ADR and wip file, and carry on; stop only if the deviation changes a §13 acceptance line or crosses another lane's files; (b) always stop and ask.
- Recommended: (a). This is P2 applied to the plan.

### Q8 — Commit granularity and message style   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: History is one prose commit per slice ("EFSP: assigned ALT/HDG, …"). The WP6 plan orders L1 in steps, and the L7 and L10 briefings say "commit after each step, green".
- Question: What granularity?
- Options: (a) one green commit per briefing step, message `EFSP L<n>: <what>`, with the Co-Authored-By trailer; the integrator may squash at merge; (b) one commit per lane.
- Recommended: (a).

### Q9 — Test expectations per lane   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: The plan says only "must grow".
- Question: Is there a floor?
- Options: (a) no numeric floor, but: every §13 acceptance line asserted verbatim; every behaviour lane adds a sortie via `advance()` (never `InvokeNla`); anything a controller can reach gets a reachability or client test; (b) numeric floors.
- Recommended: (a).

### Q10 — What you want to see from wave 1   [lane: X]  [who: HUMAN]  [blocking: no]
- Context: Wave 1 is almost entirely server-side. L2 (MTR fields on the Strip) is its only new UI. L7 changes one badge's lifetime, and L10 changes scope colours for everybody.
- Question: What do you want to see at the wave-1 merge?
- Options: (a) L2's Playwright screenshots at full and narrow width, L10's before/after colour table, L9's inventory Group E (needs your answers), and the ADRs from Q6; (b) everything; (c) only a live walk.
- Recommended: (a).

### Q11 — Does L2 need an approved mockup first, as 0058 had?   [lane: X]  [who: HUMAN]  [blocking: no]
- Context: `0058` was "mocked and approved (reference artifact)". `0056` and `0057` fix the Strip's zones and type scale. The L2 briefing already specifies a conditional MTR row with `M11` first.
- Question: Mockup and wait, or implement within the rules and show screenshots?
- Options: (a) mockup first; (b) implement, then screenshots; (c) implement the server now and hold the client for your look.
- Recommended: (b). The rules constrain it enough, and a mockup round trip idles the lane.

### Q12 — UI wording conventions for new text   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: Labels are short capitals (`ALT`, `HDG`, `CRUS ALT`, `HOOK`). 0058's reason lines are full sentences. `nla.js` inhibit strings are lower-case phrases ("no receiving Position present").
- Question: What should new lanes follow?
- Options: (a) labels in capitals, 8 characters or fewer; NLA inhibit strings in `nla.js`'s lower-case style; Strip reason lines as sentences naming what clears them; anything `[SOURCE-DEFINED]` shown to a controller says "SOURCE practice" and never cites FAA or USAF; (b) free.
- Recommended: (a). It is consistent with the L9 briefing's classification.

### Q13 — Which clock EFSP times mean   [lane: X]  [who: HUMAN]  [blocking: no]
- Context:
  - EFSP gates on `Date.now()`, which is wall-clock UTC (`nla.js`, `forwarding-obligations.js`).
  - The CRC's top-bar Zulu clock shows **DCS mission time** minus `gameTimeOffset` (`topbar.js:199–215`).
  - The squadron's real package `Flashbang 1.6.yaml` (repo root, gitignored) has `ingame_start_time: '0240'` and `local_offset_hours: 3`, so its times are in-game.
  - A mission set at 0240Z and flown at 1900Z makes the Strip's clock and the top-bar clock disagree by 16 hours.
  - This affects vul windows (L3/L14), Charlie and push time (L4/L17), hourly traffic counts (L5), and MTR times (L2).
- Question: Which clock is authoritative?
- Options: (a) wall-clock UTC; in-game times are converted by the mission offset on import; (b) DCS mission time everywhere, which needs a server mission clock and touches every time gate; (c) wall clock for wave 1, with the mission-clock decision before L14/L17.
- Recommended: (c). L3 emits raw ATO times unconverted, L4 takes "now" as a parameter, and L5 buckets by wall-clock hour. Please say whether missions normally run real-time-synced.

### Q14 — Squadron reality: manning and session length   [lane: X]  [who: HUMAN]  [blocking: no]
- Context: L6 needs a traffic profile, L5 a "session", and L1's acknowledgers assume OPS and APP are held.
- Question: On a typical night, how many controllers are there, holding which Positions, how many aircraft at peak, and for how long?
- Options: (a) you give numbers; (b) default: 2–4 controllers, often one holding OPS+CD+GND+TWR+APP; 8–16 aircraft at peak; 2–3 hour sessions.
- Recommended: (b) until told.

### Q15 — Squadron reality: types, bases, map   [lane: X]  [who: HUMAN]  [blocking: no]
- Context: `Flashbang 1.6.yaml` shows F-16Cs from LTAG, FA-18Cs from CVN-75 Truman (`CVN-1`), and KC-135/MPRS tankers, on the Syria map. L1, L4, L5 and L10 all read this.
- Question: Is that representative: Incirlik the only EFSP airfield, Truman the carrier, F-16C/FA-18C the main types?
- Options: (a) yes; (b) you correct it.
- Recommended: (a), taken as the default everywhere.

### Q16 — Is the own coalition always BLUE?   [lane: X]  [who: HUMAN]  [blocking: no]
- Context: `CRCSYNC_COALITION` sets one own coalition (BLUE by default). L10's Mode 4 crypto model and the synthetic transponder both key off it.
- Question: Does the squadron ever fly RED, or put both sides on one server?
- Options: (a) always one side per server; (b) both sides on one server.
- Recommended: (a). (b) would be a new design, outside wave 1.

### Q17 — Retired wire messages and installed clients   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: L7 retires `efsp-obligation-alert` (L7 briefing Q8), and L1 adds `efsp-field-state-delta`. A crc-desktop release always redeploys crc-sync.
- Question: Dual-send for one release?
- Options: (a) no. Server and client ship together, and old clients ignore unknown types through the `switch` default; (b) dual-send.
- Recommended: (a). It matches the L7 briefing default.

### Q18 — The inert `ops-field-state` Bay   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: `facility-config.js:136` marks it "WP6 hook, inert". The WP6 plan says the board is its own panel (L1b), not this Bay. The shipped `config/efsp-facility-incirlik.json` has its own `bays` key, which wins over DEFAULT in `_loadOne`'s shallow merge.
- Question: Keep it?
- Options: (a) keep it, and rewrite its comment to point at the panel; (b) remove it from DEFAULT and the shipped JSON.
- Recommended: (a) in L1. Removal is churn in a shipped file for no gain.

### Q19 — Lanes and `crc-sync/state/`   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: The main checkout's `crc-sync/state/` holds the human's live board and mutation log. L5's retention job prunes logs.
- Question: Must every test use temp paths?
- Options: (a) yes: env-var overrides only (`CRCSYNC_EFSP_MUTATION_LOG_PATH` and so on), and no lane runs anything against the main checkout's `state/`; (b) no rule.
- Recommended: (a), as an extension of P3.

### Q20 — Magnetic vs grid (the plan's §5 "decision for you first")   [lane: X]  [who: HUMAN]  [blocking: no]
- Context: `0058` and `0059` leave it open. Course is grid plus a manual `hdgCorrection` (`theater-settings.json`, `geo.js:44`). L4's BRC, final bearing and marshal radial are bearings spoken to pilots, and real TACAN and marshal radials are magnetic.
- Question: What reference do displayed headings and bearings use?
- Options: (a) magnetic, from a per-theater variation value; (b) grid, as today; (c) decide before L17; L4 computes in true with a variation parameter.
- Recommended: (c) for wave 1.

### Q21 — The `docs/wip/<lane>.md` template   [lane: X]  [who: SUPERVISOR]  [blocking: no]
- Context: P2 adds "Defaults taken". The briefings each have their own report format.
- Question: Fixed headings?
- Options: (a) *Start/end test counts · ADR · What changed · Usage-guide text · Briefing text · Walks not done · Defaults taken · Bugs found in other lanes' areas*; (b) free.
- Recommended: (a), so the integrator folds ten files mechanically.

### Q22 — May lanes use `Flashbang 1.6.yaml` as a fixture?   [lane: X]  [who: HUMAN]  [blocking: no]
- Context: The only real squadron ATO in the tree is at the repo root and gitignored (`.gitignore:29 *.yaml`). The L4 briefing already cites it for the carrier, and L3 needs a fixture. It is labelled `classification: CLASSIFIED` (play-acting, but still a squadron document).
- Question: May a copy, trimmed and renamed, be committed under `crc-sync/tests/fixtures/`?
- Options: (a) yes, as-is; (b) yes, with callsigns anonymised; (c) no, and lanes write synthetic fixtures modelled on it.
- Recommended: (b).

---

## L1 — field state, server (§9.7)

### Q23 — One runway record per direction, or per physical runway?   [lane: L1]  [who: SUPERVISOR]  [blocking: yes]
- Context: Incirlik has one physical runway, 05/23, while the Racks are per direction (`rwy-05`, `rwy-23`, `facility-config.js:152`). A barrier change closes the pavement in both directions. Gear `APPROACH_END|DEPARTURE_END` only means something relative to a direction. A §9.7 rule 3 "runway change" at a one-runway field is a direction change.
- Question: What is a `Runway` record, and where do status, gear and the active direction live?
- Options: (a) per physical runway, `{id:'05/23', ends:['05','23'], status, arrestingGear:[{end:'05', position, distanceFt, type, state}]}`, plus Facility-level `activeRunway:'05'`, with each Rack mapped to an end; (b) per direction, with a barrier change suspending both through a `physicalRunwayId` link; (c) per direction and independent.
- Recommended: (a). Status belongs to the pavement. (c) lets 23 stay OPEN while 05 is suspended for the same cable.

### Q24 — A solo controller's runway change vs the plan's D21 case   [lane: L1]  [who: SUPERVISOR]  [blocking: yes]
- Context: The WP6 plan asks for a test that a controller holding TWR and APP "must not satisfy `BeginRunwayChange` from one acting Position". Guide §4.8.3 rules 1–3 say a boundary event between two Positions held by one controller MUST be **one input**, recorded as self-coordinated. Under low manning (Q14) one person holds OPS+TWR+APP, and the plan's machine needs four inputs from them. The airspace precedent (`airspace-store.js:291`) keeps separate inputs and only flags `selfCoordinated`.
- Question: How does a controller holding every acknowledger Position change runway?
- Options: (a) a one-input `SelfCoordinateRunwayChange`, legal only when the session is Primary on TWR and on every acknowledger Position; it writes PROPOSED→ACKNOWLEDGED in one Mutation naming each Position with `selfCoordinated:true`; the D21 test becomes "an ack sent as TWR never counts as APP's"; (b) the airspace precedent: separate inputs, each flagged; (c) the plan as written.
- Recommended: (a). It is §4.8.3 rule 3, and D21 still holds per acting Position.

### Q25 — A Strip with no runway rack and no 8A   [lane: L1]  [who: SUPERVISOR]  [blocking: yes]
- Context: The plan resolves the rack first, then the FDR field, and fails open. A TAXI departure sits in `gnd-taxi-out`/`main`, and nothing auto-assigns `filed.departureRunway` (§10.2 is unbuilt), so 8A is usually empty. Rule 1 would then inhibit almost no TAXI Strip and few arrivals, and the acceptance walk ("taxi it into `rwy-05`") would pass only because of the Rack.
- Question: What does resolution fall back to?
- Options: (a) rack, then FDR field, then the Facility's `activeRunway`, then fail open, recording which source resolved it; (b) the plan as written, with the gap documented; (c) implement §10.2 default assignment in L1.
- Recommended: (a). The fallback is field-state data, not invention. (c) is its own slice.

### Q26 — NLA from TAXI always files into `rwy-05`   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: NLA and implied-state moves place a Strip in `targetBay.rackIds[0]` (`board-store.js:598`, `1092`, `1314`, `1616`), so TAXI→RUNWAY_QUEUE always lands in `rwy-05`, even with 23 active. Rack-first resolution then reads 05.
- Question: Does L1 route runway-queue placement by runway?
- Options: (a) yes: when the target Bay's Racks map to runway ends, choose the Strip's resolved runway (8A, else `activeRunway`), else `rackIds[0]`; (b) no, later.
- Recommended: (a). Without it rule 1 checks the wrong runway after every runway change.

### Q27 — A drag checks the current rack, not the target rack   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: `_validateBayImpliedTransition` computes NLA against where the Strip is now (`board-store.js:768`). Dragging a TAXI Strip into `rwy-23` while 23 is suspended resolves its runway from `gnd-taxi-out`.
- Question: Does the drag path use the target rack?
- Options: (a) yes: pass the target `{bayId, rackId}` into the field-state ctx on the drag path; (b) no.
- Recommended: (a). §3.5 rule 4 is the reason the plan gates drags at all.

### Q28 — Does `CLOSED` inhibit?   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: Guide rule 1 names only `SUSPENDED_*`, but the schema also has `CLOSED`.
- Question: Does `CLOSED` inhibit takeoff and landing NLA?
- Options: (a) yes, reason "runway 05/23 closed", marked `[SOURCE-DEFINED]` as an extension of rule 1; (b) no.
- Recommended: (a).

### Q29 — Is a runway change also a suspension?   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: The plan's machine ends `IN_PROGRESS → CompleteRunwayChange → PENDING_INSPECTION → OPS CompleteInspection`, but never says what runway `status` is meanwhile.
- Question: Do `IN_PROGRESS` and `PENDING_INSPECTION` change status?
- Options: (a) `IN_PROGRESS` changes nothing; `CompleteRunwayChange` switches `activeRunway` and sets the pavement `SUSPENDED_INSPECTION` until OPS inspects, so rule 1 and rule 2 cover it with no new inhibit path; (b) bookkeeping only; (c) suspended throughout.
- Recommended: (a).

### Q30 — Strips left in the old direction's rack   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: §10.3's spirit is that nothing moves a Strip. After 05→23, Strips in `rwy-05` stay put.
- Question: Does L1 flag them?
- Options: (a) no; (b) a pure `runwayAdvisoryFor()` in `field-state.js` ("queued for inactive runway 05") for L1b to render; (c) auto-move.
- Recommended: (b). Never (c).

### Q31 — Incirlik's arresting gear (squadron data)   [lane: L1]  [who: HUMAN]  [blocking: no]
- Context: `DEFAULT_CONFIG` needs a gear inventory (§8.2), and nothing in the repo gives Incirlik's.
- Question: What gear does the squadron's Incirlik have (type, end, distance, normal state)?
- Options: (a) you give it; (b) a `[SOURCE-DEFINED]` placeholder: a BAK-12 about 1,500 ft from each threshold, normally UP (rigged), plus a departure-end overrun barrier typed `OTHER`.
- Recommended: (b), labelled, until told.

### Q32 — Who may close and open a runway   [lane: L1]  [who: HUMAN]  [blocking: no]
- Context: `FIELD_STATE_OP_OWNERS` needs owners. The guide makes OPS the owner of field-state actions, but a real tower stops runway operations at once for a disabled aircraft or FOD.
- Question: OPS only, or TWR too?
- Options: (a) OPS only; (b) OPS and TWR may close, only OPS may reopen (reopening implies an inspection); (c) both, both ways.
- Recommended: (b), `[SOURCE-DEFINED]`.

### Q33 — An emergency that must land on a suspended runway   [lane: L1]  [who: HUMAN]  [blocking: no]
- Context: With the plan's design, `HANDED_TO_TOWER → FINAL` is inhibited on NLA and on drag. At one-runway Incirlik there is nowhere else to go, and a fuel emergency still lands.
- Question: What does the board do?
- Options: (a) nothing special: the Strip waits for OPS (`FINAL → LANDED` stays uninhibited, per the plan); (b) an audited override op with a required reason, one Strip at a time; (c) the landing inhibit applies only while the gear itself is being worked (`SUSPENDED_BARRIER_CHANGE`), not `SUSPENDED_INSPECTION`.
- Recommended: (a) in L1, with (b) written down in `docs/wip/L1.md` as a candidate. No invented override in wave 1.

### Q34 — A runway change when OPS or APP is unmanned   [lane: L1]  [who: HUMAN]  [blocking: no]
- Context: The acknowledgers come from `runwayChangeAcknowledgers: ['OPS','APP']`. §4.1 says an unmanned APP reverts to CTR, and OPS has no covering Position (`coveringChain` has none).
- Question: Who acknowledges for an unmanned acknowledger?
- Options: (a) the covering Position, else waived and audited "no OPS present"; (b) CTR for an unmanned APP (the §4.1 reversion), and a waiver for OPS; (c) strict: the change cannot start.
- Recommended: (b). A waiver beats a deadlock that pushes controllers off the board.

### Q35 — Withdraw, reject, time out   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: The plan makes `REJECTED` terminal but never says who rejects, whether TWR can withdraw, or whether an ack can be retracted.
- Question: What are the edges?
- Options: (a) either acknowledger may Reject; TWR may Withdraw while PROPOSED or ACKNOWLEDGED; acks are not retractable (reject instead); no timeout; a new proposal is allowed once the previous one is terminal; (b) Reject only.
- Recommended: (a).

### Q36 — Seed `hotCargoPad` and `alertPad` now?   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: §9.7's schema has both, and L12 and L13 (wave 2) read them. §12 says present-and-unpopulated, not absent.
- Question: Does L1 put them in the config shape and the record?
- Options: (a) yes: config `pads: {hotCargo: null, alert: null}` and store `{occupied:false, occupantFdrId:null}`, with no ops; (b) leave them to L12/L13.
- Recommended: (a). It spares L12 and L13 a `restore()` seed.

### Q37 — Incirlik's hot cargo pad, alert pad, preferred hung-ordnance direction   [lane: L1]  [who: HUMAN]  [blocking: no]
- Context: L12 needs the "designated" runway config for hung ordnance (§9.5, Kunsan practice). L13 needs the alert-pad access taxiway (§9.6).
- Question: Does the squadron use these at Incirlik, and which?
- Options: (a) you name them; (b) placeholders, names only, with no preferred direction configured (the advisory then states the fact without recommending a runway).
- Recommended: (b) until told. No invented geometry.

### Q38 — The default active runway at boot   [lane: L1]  [who: HUMAN]  [blocking: no]
- Context: Needed if Q23 (a) holds. Winds vary by mission.
- Question: How is it set?
- Options: (a) config `defaultActiveRunway: '05'`, then persisted in store state; (b) derived from mission wind at load; (c) unset until TWR's first runway change.
- Recommended: (a). (b) is §10.2 automation nobody has asked for yet.

### Q39 — A gear failure outside a planned barrier change   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: The plan makes `SetGearState` legal only while `SUSPENDED_BARRIER_CHANGE`. A cable that fails is not a planned reconfiguration.
- Question: May OPS set a gear `OUT_OF_SERVICE` without suspending the runway?
- Options: (a) yes, that single transition, audited; every other gear edit needs the barrier family; (b) no.
- Recommended: (a). L1b's hook-mismatch check needs to see it.

### Q40 — The exact inhibit reason strings   [lane: L1]  [who: SUPERVISOR]  [blocking: no]
- Context: Acceptance requires "the reason shown". `nla.js` strings are lower-case phrases.
- Question: What are the strings?
- Options: (a) `runway 05/23 suspended — barrier change`, `runway 05/23 suspended — awaiting inspection`, `runway 05/23 closed`; (b) sentence style.
- Recommended: (a). L1b's Strip reason line may expand them.

---

## L2 — MTR fields (§9.4)

The L2 briefing (`docs/parallel/wave1/L2.md` §11) already carries Q1–Q9 with defaults. Only the ones
that need the human, or where this questioner disagrees, are repeated here.

### Q41 — Does the squadron fly MTRs, and are the designators a list?   [lane: L2]  [who: HUMAN]  [blocking: no]
- Context: MTRs (IR/VR) are a US-airspace construct. Over Turkey and Syria in DCS they would be squadron-defined low-level routes. The plan and the L2 briefing (its Q8) make `9G-MTR` free text with no format validation.
- Question: Are there named squadron low-level routes worth a picker, as stereo routes have?
- Options: (a) free text now, with a table later if routes exist; (b) a config table now, shipped empty; (c) you give the list.
- Recommended: (a).

### Q42 — Which Positions show the MTR group   [lane: L2]  [who: HUMAN]  [blocking: no]
- Context: L2 briefing Q3 default: OPS gets designator and entry; CD gets designator; APP and CTR get all six on DEP/OVF (designator plus `M11` on ARR); GND and TWR get none; a conditional row with `M11` first (its Q4). This is `[SOURCE-DEFINED]`.
- Question: Does that match how the squadron would work an MTR flight?
- Options: (a) the briefing's default; (b) APP/CTR only; (c) you adjust.
- Recommended: (a).

### Q43 — Should MTR amendments keep §3.7 history?   [lane: L2]  [who: HUMAN]  [blocking: no]
- Context: Guide §3.7 rule 1 says amending a Block MUST append, not overwrite. Plain `fdr` Blocks (route, stereo, remarks) overwrite today. The briefing's pilot walk ("request a different exit fix") is exactly an amendment. L2 briefing Q1 defaults to overwriting and recording the gap.
- Question: Is "the old exit fix disappears from the Strip; the log keeps it" acceptable for now?
- Options: (a) yes, and record the gap (briefing default); (b) build a `clearance`-style history cell (0058's shape) for the `9H-*` fields in L2.
- Recommended: (a). The guide conflict is real, and it is shared with every plain `fdr` Block, so it is better fixed once, later.

### Q44 — `HHMM` strings next to epoch `*TimeUtc` fields   [lane: L2]  [who: SUPERVISOR]  [blocking: no]
- Context: L2 briefing Q2 and T9 store `entryTimeUtc`/`exitEstimateUtc` as `'HHMM'` strings. The briefing also found that typed time Blocks already write strings into fields that other code treats as epoch ms (`assigned.voidTimeUtc` and the rest, `fdr-store.js:622–626`), which is a pre-existing bug, left to L16.
- Question: Is a `…TimeUtc` field holding a string acceptable, given its name promises epoch?
- Options: (a) accept the briefing's default, but say so in the ADR and the field's comment; (b) rename the stored fields (`entryTimeHhmm`), which touches the §12 seed from 0052; (c) epoch.
- Recommended: (a). The T9 bug should also be raised with the supervisor now as a real defect (a string void time makes `voidDeadlineUtc` NaN-ish), not only deferred to wave 2.

### Q45 — The T9 typed-time bug found by the L2 briefing   [lane: L2]  [who: SUPERVISOR]  [blocking: no]
- Context: `_startBlockEdit` sends a trimmed string (`bay-view.js:460,472`), and `setField` writes it as-is to `assigned.voidTimeUtc` and similar, whose readers do epoch arithmetic (`fdr-store.js:622–626`, `nla.js` HELD gates, `forwarding-obligations.js`). So a void time typed in the panel may never expire correctly.
- Question: Who fixes it, and when?
- Options: (a) L16 (wave 2, §10.5 times), as the briefing says; (b) a small bugfix lane now, since it bites void-time and EDCT in production; (c) L8 writes a `todo` test that pins it now, and L16 fixes it.
- Recommended: (c), and move it earlier than L16 if the test confirms it.

---

## L3 — ATO parser (§9.9, part 1)

### Q46 — Is the ATO the squadron actually uses the atobrief YAML package?   [lane: L3]  [who: HUMAN]  [blocking: yes]
- Context: The plan asks for a USMTF-style set parser (`AMSNDAT`, `MSNACFT`, …). The squadron's real ATO is the atobrief YAML package (`docs/atobrief/yaml-format.md`, produced by `tools/miztoyaml`). A real one sits at the repo root (`Flashbang 1.6.yaml`). A USMTF parser would parse a format nobody in the squadron produces.
- Question: What does L3 parse?
- Options: (a) atobrief YAML only; (b) USMTF only, as §9.9 says; (c) both, into one normalised `AtoMission`: YAML as the real path, USMTF as the §9.9 path.
- Recommended: (c) if L3 has the time, else (a) first. Please say whether USMTF text ever appears.

### Q47 — The real package carries almost none of WP7's acceptance fields   [lane: L3]  [who: HUMAN]  [blocking: no]
- Context: In `Flashbang 1.6.yaml`, every mission has `mission_number`, callsign, type and count. But `control.agency_id: null`, `takeoff_time: null`, `targets: null` (so no TOT/TOS vul window), no package id, and `spins.sections: []`, so no Mode 3 codes at all. WP7's acceptance needs mission number, package, vul window, controlling agency and IFF codes, and ATO↔Strip binding is on Mode 3/A.
- Question: Will real packages populate these, or does binding need to work without Mode 3?
- Options: (a) planners will fill SPINS C3 and control agencies, and a synthetic fixture proves acceptance meanwhile; (b) binding must fall back to callsign when there is no Mode 3 (L14's call, but L3 must then output callsigns normalised for matching); (c) both.
- Recommended: (c). L3 always emits a normalised callsign and flags missing fields per mission.

### Q48 — A fixture with every acceptance field   [lane: L3]  [who: HUMAN]  [blocking: no]
- Context: See Q47 and Q22.
- Question: Can you provide one package with SPINS IFF, control agencies and times filled, or may L3 synthesise it?
- Options: (a) you provide one; (b) L3 adds IFF/control/time sections to an anonymised copy of Flashbang, marked synthetic; (c) L3 writes one from scratch, plus a USMTF text modelled on the community wiki.
- Recommended: (b), plus (c) if USMTF is in scope.

### Q49 — One FDR per flight or per aircraft   [lane: L3]  [who: SUPERVISOR]  [blocking: no]
- Context: A mission is a flight of N (`aircraft.count: 4`) that may carry N Mode 3 codes. EFSP's FDR is per flight, with Block 3 carrying the count and one `beaconAssigned`.
- Question: How does a 4-ship map?
- Options: (a) one mapping per mission line: the lead's code as the seed beacon, every code kept in extras for L14; (b) one per aircraft.
- Recommended: (a). It matches every Strip today.

### Q50 — Output shape for data with no FDR home   [lane: L3]  [who: SUPERVISOR]  [blocking: yes]
- Context: `fdr.mission` has only `missionNumber`, `packageId`, `controllingAgency`, `vulWindowStartUtc` and `vulWindowEndUtc` (`fdr-store.js:492`). Mission type, package commander, report-in point, on-station time, Mode 1/2 (`identity.modeOne/modeTwo`, with no setter), datalink, AR (`military.arInfo`), SCL, loadout and steerpoints have no writable home. L3 must not wire into the Board.
- Question: What does the mapping return?
- Options: (a) `{ fdrSeed: {…only what createFdr accepts today}, military: {…§12 fields for L14}, extras: {…verbatim}, warnings: [...] }` per mission; (b) extend the FDR schema in L3; (c) a flat record.
- Recommended: (a). L14 decides which extras get a home.

### Q51 — Parser strictness   [lane: L3]  [who: SUPERVISOR]  [blocking: no]
- Context: Hand-edited packages are messy.
- Question: Does a bad mission fail the whole file?
- Options: (a) no: tolerant per mission, with warnings that carry the path or line; a mission with no mission number or callsign is skipped with a warning; (b) strict.
- Recommended: (a).

### Q52 — Controlling agency format   [lane: L3]  [who: SUPERVISOR]  [blocking: no]
- Context: `registry.control_agencies` (and USMTF `CONTROLA`) carry type, callsign and frequency. `fdr.mission.controllingAgency` is one string (`M5`).
- Question: What goes in the string?
- Options: (a) `DARKSTAR (AWACS) 251.000`, with the structured parts in extras; (b) callsign only.
- Recommended: (a).

### Q53 — Mode 3 codes the allocator refuses   [lane: L3]  [who: SUPERVISOR]  [blocking: no]
- Context: atobrief now generates random octal codes (`build_doc.py:193`, `editor-spins.js:33`). These can land in crc-sync's synthetic block 6000–6777 (0059), which the allocator refuses, or duplicate an FDR's code. `docs/atobrief/yaml-format.md:1185` still documents a stale `4701 + 10·i` formula that would produce the invalid 4781.
- Question: What does L3 do with such codes?
- Options: (a) keep them and warn per problem (reserved, synthetic block, non-octal, duplicate within the ATO); L14 decides; (b) drop them.
- Recommended: (a). Put two backlog items on the supervisor: atobrief should avoid 6000–6777, and the stale doc formula needs fixing.

### Q54 — Time conversion   [lane: L3]  [who: SUPERVISOR]  [blocking: no]
- Context: See Q13. Package times are in-game (`ingame_start_time`, `local_offset_hours`). USMTF uses `DDHHMMZ`.
- Question: Does L3 convert to epoch?
- Options: (a) no: emit `{day, hhmm, zulu:true, raw}`; L14 converts under whatever Q13 decides; (b) convert to wall clock now.
- Recommended: (a).

### Q55 — Re-importing an edited ATO   [lane: L3]  [who: SUPERVISOR]  [blocking: no]
- Context: Packages get re-saved during planning.
- Question: Does L3 diff?
- Options: (a) no: missions are keyed by mission number (trimmed, upper-cased), and L14 diffs; (b) a diff API in L3.
- Recommended: (a).

---

## L4 — carrier model, pure (WP7A part 1)

The L4 briefing (`wave1/L4.md` §11) carries Q1–Q11 with defaults (Truman `CVN_75` as hull
`CVN-1`, 9° deck angle, radial = BRC+180, `maxIndex` 19, default Case III, and so on). These are
the ones that need the human, plus two the briefing does not cover.

### Q56 — The carrier and its recovering types   [lane: L4]  [who: HUMAN]  [blocking: no]
- Context: L4 briefing Q1 defaults to one hull, Truman (`CVN_75`, from `Flashbang 1.6.yaml:30–33`). Recovering types are FA-18C in that package. Supercarrier use is unknown.
- Question: Is Truman representative, is it ever more than one hull, and is the Supercarrier module used?
- Options: (a) the briefing's default: one hull, FA-18C and F-14, Supercarrier; (b) you correct it.
- Recommended: (a).

### Q57 — The marshal radial convention   [lane: L4]  [who: HUMAN]  [blocking: no]
- Context: Guide §9.12 says "the 180 relative to BRC", and L4 briefing Q3 takes radial = BRC+180. Most real Case III references put marshal on the reciprocal of the **final bearing**, which differs by the deck angle (about 9°). The guide also asks for a check that "marshal radial [is] roughly reciprocal to final bearing".
- Question: BRC+180, or final bearing + 180?
- Options: (a) BRC+180, literal to the guide (briefing default); (b) FB+180, as squadron pilots will have been taught from the NATOPS/CV NATOPS style.
- Recommended: (b), unless the squadron briefs BRC+180. It makes the consistency check exact rather than 15°-tolerant. Your call, because pilots will hear it.

### Q58 — When an aircraft leaves the stack, does everyone above move down?   [lane: L4]  [who: HUMAN]  [blocking: no]
- Context: The guide specifies insertion (renumber everyone above, one gesture) but not removal (a divert, or a bolter sent to the tanker).
- Question: On removal, do the aircraft above keep their altitude and push, or compress?
- Options: (a) no automatic compression: the gap stays until the controller re-sequences in one gesture; (b) compress automatically.
- Recommended: (a). Changing a pilot's assigned angels and push silently is exactly what a controller must say out loud.

### Q59 — One stack or several   [lane: L4]  [who: HUMAN]  [blocking: no]
- Context: The guide models one Case III stack. Real recoveries often split stacks by type or squadron (different radials).
- Question: Does the squadron need more than one stack?
- Options: (a) one in v1, keyed by stack id so more is additive; (b) several now.
- Recommended: (a).

### Q60 — FACSFAC, and the APP1/APP2 split (guide OQ8, OQ9)   [lane: L4]  [who: HUMAN]  [blocking: no]
- Context: L4's design ADR fixes how the CARRIER Facility wires in (L17). L4 briefing Q9 defaults: alternate by push ordinal (even → APP1), covering chain APP2 → APP1 → MARSHAL, PriFly outside the chain, all four `MILITARY_ATC`. FACSFAC (OQ9) is not addressed.
- Question: FACSFAC yes or no? Is the APP split alternating?
- Options: (a) no FACSFAC in v1; `DUE_REGARD` inside the CCA; the carrier never coordinates with CTR; alternate APP lanes, `[SOURCE-DEFINED]`; (b) add a FACSFAC Position (a nineteenth Position).
- Recommended: (a).

### Q61 — Approach button numbers   [lane: L4]  [who: HUMAN]  [blocking: no]
- Context: §9.12 rule 6 says store a button, not a frequency. L4 briefing Q7 validates buttons 1–20.
- Question: Which buttons does the squadron brief for marshal and approach?
- Options: (a) you say; (b) validated integer only, with no defaults.
- Recommended: (b).

### Q62 — Where "night" and the Case recommendation come from   [lane: L4]  [who: SUPERVISOR]  [blocking: no]
- Context: §9.12 makes all night operations Case III. L4 briefing Q5 leaves `night` as an input for L17. Deriving it from DCS game time needs the mission clock (Q13).
- Question: Does the ADR say where night comes from?
- Options: (a) yes: L17 derives it from DCS mission time plus sun elevation at the ship, since that is the one place mission time is needed even under Q13 (a); (b) PriFly declares it.
- Recommended: (a), stated in 0064 as L17's job.

### Q63 — Where EEAT lives   [lane: L4]  [who: SUPERVISOR]  [blocking: no]
- Context: §9.12 rule 7 says EEAT must survive from the departure Strip to recovery. L4 briefing Q10 puts it on `fdr.carrier`, which is a new FDR sub-object. 0052 settled that military fields go in `fdr.military` and sub-letter onto a parent Block.
- Question: Is it `fdr.carrier.eeatUtc`, or `fdr.military.eeatUtc`?
- Options: (a) `fdr.military.eeat…`, following 0052's single namespace, with its Block id chosen by L17 via `MILITARY_BLOCK_NAMESPACE`; (b) a new `fdr.carrier` object, as the briefing says.
- Recommended: (a), unless L4's ADR argues that carrier state is a separate family. Either way, 0064 must say why, because it touches 0052's "settled once" namespace.

---

## L5 — metrics, traffic count, retention (§11.3–§11.5, server)

### Q64 — What a "session" is   [lane: L5]  [who: HUMAN]  [blocking: no]
- Context: §11.1 and §11.5 speak of "per session", but crc-sync runs for days and missions reload.
- Question: What delimits a session?
- Options: (a) one DCS mission load to the next; (b) crc-sync uptime; (c) an explicit start/stop by a controller; (d) a UTC evening.
- Recommended: (a), with rolling one-hour windows beside it.

### Q65 — The source of truth for metrics   [lane: L5]  [who: SUPERVISOR]  [blocking: yes]
- Context: Compliance stats are in-memory and reset on restart (`forwarding-obligations.js:220`). The Mutation log is durable but read whole by `readAll()` (`mutation-log.js`). WP8 acceptance: "the traffic count reconciles against the Mutation log".
- Question: Counters, log-derived values, or both?
- Options: (a) in-memory counters fed at dispatch, snapshotted per session to `state/efsp-metrics.json`, plus a reconcile function that recomputes the traffic count from the log (used by the test and on demand); (b) always recompute from the log; (c) counters only.
- Recommended: (a). (b) reads an ever-growing file on every dashboard poll.

### Q66 — Local vs transient   [lane: L5]  [who: HUMAN]  [blocking: no]
- Context: §11.4 needs both categories and defines neither. The FDR has `3E` home station and departure/destination airports.
- Question: What makes a flight local?
- Options: (a) it departs and lands at the same Facility's airfield; (b) `3E` equals the Facility's airfield.
- Recommended: (a), labelled `[SOURCE-DEFINED]`.

### Q67 — How a formation counts   [lane: L5]  [who: HUMAN]  [blocking: no]
- Context: DAFMAN treats formations as a distinct category. A 4-ship is one Strip.
- Question: One count or four?
- Options: (a) one operation in `formation`, with the aircraft count recorded; (b) four.
- Recommended: (a).

### Q68 — Deriving SUA traversal and alert scramble   [lane: L5]  [who: SUPERVISOR]  [blocking: no]
- Context: SUA traversal can come from approved airspace entries (`strip.airspaceEntry`, 0036–0038). Alert scramble needs `alertStatus === 'SCRAMBLE'`, which becomes reachable only with L13.
- Question: How are they counted?
- Options: (a) SUA: the FDR ever had an approved airspace entry; scramble: `fdr.military.alertStatus` was ever `SCRAMBLE` (from the log), zero until L13; (b) leave them out.
- Recommended: (a). The categories exist from day one.

### Q69 — What is counted, and where   [lane: L5]  [who: SUPERVISOR]  [blocking: no]
- Context: One FDR can have several DROPPED Strips: replicas, a MISSION line, an arrival converted in place.
- Question: What is the unit?
- Options: (a) per Facility, per FDR, once, at its last Strip's drop there; MISSION and rejected replicas excluded; the TACTICAL and RANGES Facilities count nothing; (b) per Strip.
- Recommended: (a).

### Q70 — Retention mechanics   [lane: L5]  [who: SUPERVISOR]  [blocking: no]
- Context: §11.3 wants retention as config, default 30 days, stated as SOURCE policy (D-6: no requirement). The log is one append-only JSONL, and reconciliation reads it.
- Question: How is it pruned?
- Options: (a) daily files `efsp-mutations-YYYY-MM-DD.jsonl`, with files older than `retentionDays` deleted at boot and daily; per-session aggregates kept in their own small file indefinitely; (b) rewrite one file in place; (c) config key only, no pruning.
- Recommended: (a). Pruning is O(1), and reconciliation then only ever spans retained days.

### Q71 — Who may see metrics   [lane: L5]  [who: HUMAN]  [blocking: no]
- Context: crc-sync has no roles: every endpoint is `auth.requireAuth` (`server.js`). L15 will add per-controller time-to-find.
- Question: Is the dashboard visible to every authenticated member, and does it show per-person numbers?
- Options: (a) everyone, aggregated by Position; (b) everyone, per-person breakdowns hidden; (c) staff only (needs a Casdoor group check that does not exist).
- Recommended: (b). Per-person metrics among volunteers want your explicit say.

### Q72 — What a transfer and a transfer failure are   [lane: L5]  [who: SUPERVISOR]  [blocking: no]
- Context: §11.1 needs success of at least 99.5%. There are `TransferStrip`, transfer-shaped NLAs, HANDOFF/POINT_OUT and TOFI.
- Question: Definitions?
- Options: (a) a transfer is any ownership-change attempt; a failure is a refusal or rejection, or a PROPOSED one whose Strip dropped before acceptance; causes are the refusal `reason`; (b) HANDOFF only.
- Recommended: (a).

### Q73 — Transport for L15   [lane: L5]  [who: SUPERVISOR]  [blocking: no]
- Context: The plan says "a read endpoint or WS message". `efsp-ws.js` and `index.js` are L1's busiest shared files this wave.
- Question: Which?
- Options: (a) `GET /api/efsp/metrics` (authed), polled by L15 every 10–30 s; (b) a WS push.
- Recommended: (a). It touches neither `efsp-ws.js` nor `app.js`.

### Q74 — The client-metric message (defined by L5, sent by L15)   [lane: L5]  [who: SUPERVISOR]  [blocking: no]
- Context: Search invocations, time-to-find and inputs per gesture are measured client-side.
- Question: What is the shape?
- Options: (a) `POST /api/efsp/metrics/client` with `{metric:'SEARCH'|'TIME_TO_FIND'|'GESTURE_INPUTS', positionId, value, at}[]`, batched every 30 s or less, validated and rate-capped; (b) a WS message.
- Recommended: (a), which is consistent with Q73. The handler exists in wave 1 but has no caller until L15.

### Q75 — Consuming L7's new compliance semantics   [lane: L5]  [who: SUPERVISOR]  [blocking: no]
- Context: The L7 briefing redefines "missed" as *raised episodes* and makes only `ADVANCE_FORWARDING` and `VOID_TIME_EXPIRED` ever "met". L5 reports compliance.
- Question: Does L5 code against L7's semantics before L7 merges?
- Options: (a) yes: read `getComplianceStats()` as-is, and write L7's definitions into 0065 by reference to 0067; (b) wait for L7.
- Recommended: (a), with L7 merged first (Q4).

---

## L6 — soak harness

### Q76 — The traffic profile   [lane: L6]  [who: HUMAN]  [blocking: no]
- Context: "Simulated traffic" needs a rate. See Q14.
- Question: What load?
- Options: (a) default: 12 concurrent flights, 3 controllers, a Strip lifecycle every 2 minutes per flight, correlation churn every second, a coordination every 5 minutes, plus a 3× stress mode; (b) you give numbers.
- Recommended: (a).

### Q77 — What the harness drives   [lane: L6]  [who: SUPERVISOR]  [blocking: no]
- Context: "No dropped Mutations" is about dispatch, ack, delta and resync (`efsp-ws.js`), not the stores alone. L6 owns only `crc-sync/tools/soak/`.
- Question: What does it drive?
- Options: (a) the real `efsp/index.js` composition plus the `efsp-ws.js` handlers with fake in-process sessions (no network), persisting to a temp `state/`, with scheduled disconnect and resync; (b) the stores directly; (c) a real server over WebSocket.
- Recommended: (a).

### Q78 — DROPPED Strips and FDRs are never removed   [lane: L6]  [who: HUMAN]  [blocking: no]
- Context: A DROPPED Strip "stays queryable via `getStrip()`/`getAll()`" (`board-store.js:147`), and `releaseFdr` frees only the code (`fdr-store.js:905`). The snapshot is rewritten after every Mutation. A 4-hour soak will show linear memory and snapshot growth by design, which fails WP8's "no memory growth".
- Question: How long should a finished flight stay on the server?
- Options: (a) archive DROPPED Strips (and FDRs with no live Strip) out of memory and the snapshot after N hours (default 2) or at mission change, once L5 has counted them; the log keeps the history; (b) keep them, and measure growth per flight instead; (c) purge at mission change only.
- Recommended: (a). L6 measures and reports only. The supervisor schedules the fix in wave 2 (it touches `board-store.js`, `fdr-store.js` and `index.js`).

### Q79 — The memory pass criterion   [lane: L6]  [who: SUPERVISOR]  [blocking: no]
- Context: "No memory growth" needs an operational definition in garbage-collected Node.
- Question: What passes?
- Options: (a) run with `--expose-gc`, forcing GC before sampling heap every minute; fit a slope over the second half of the run; pass if it is under 1% of baseline per hour; report separately the part explained by retained DROPPED Strips; (b) eyeball it.
- Recommended: (a).

### Q80 — Who runs the 4-hour soak, and where   [lane: L6]  [who: HUMAN]  [blocking: no]
- Context: The default run is 10 minutes, and §13 needs 4 hours.
- Question: Where does the 4-hour run happen?
- Options: (a) you run it locally once; (b) a manual-dispatch GitHub workflow; (c) the integrator runs it in the background at the end of wave 1.
- Recommended: (c), with the report under `docs/wip/`.

### Q81 — Order-key exhaustion   [lane: L6]  [who: SUPERVISOR]  [blocking: no]
- Context: `order-key.js` plus `_rebalanceRack` should prevent exhaustion. Only an adversarial pattern (always inserting between the same two Strips) stresses it.
- Question: Should the soak include that pattern?
- Options: (a) yes, a phase reporting maximum key length and rebalance count; (b) random moves only.
- Recommended: (a).

---

## L7 — obligation alerts retract

The L7 briefing (`wave1/L7.md`) settles the shape: obligations ride `efsp-alerts` as a third key,
composed in one `server.js` function; ADR `0067` (D1). Its §10 carries Q1–Q8. Those that need a
supervisor ruling, or the human, are below.

### Q82 — Confirm: obligations as a third key of `efsp-alerts`   [lane: L7]  [who: SUPERVISOR]  [blocking: yes]
- Context: The briefing chose (a), one more key in `efsp-alerts`, over (b) a separate `efsp-obligations` full-state message. The cost it names: two producers on different cadences (1 s conformance/STCA, 15 s obligations) feed one message that `broadcastEfspAlerts` replaces wholesale, so every caller must go through one compose function or silently erase the other's keys.
- Question: Confirm (a)?
- Options: (a) as the briefing says, with a test that a conformance-only tick does not clear obligations; (b) a separate message.
- Recommended: (a). The per-session builder, the connect send and the client re-render already exist. The trap is real but one test holds it.

### Q83 — `AMENDMENT_INSIDE_30MIN` now shows for about 60 s   [lane: L7]  [who: HUMAN]  [blocking: no]
- Context: It is "recently amended" = `updatedAt` within 60 s (`forwarding-obligations.js:75`). It used to latch forever. With retraction it vanishes after 60 s whether or not anyone coordinated. L7 briefing Q3 default: accept, and flag it. L2's MTR edits (Q43) will also trigger it.
- Question: Is a 60-second flash acceptable, or should it stay until coordinated?
- Options: (a) accept for now (briefing default); (b) stamp a `lastAmendedAt` and keep the alert until a coordination Mutation for that Strip or the proposed departure time passes (a later slice).
- Recommended: (a) now, (b) as a follow-up. Tell us whether the reminder matters to you.

### Q84 — Who receives obligations   [lane: L7]  [who: SUPERVISOR]  [blocking: no]
- Context: L7 briefing Q2 default: everybody, like conformance.
- Question: Scope them per session, by the Facilities the controller holds?
- Options: (a) everybody for now; (b) per Facility.
- Recommended: (a). It is one line in `_efspAlertsMsg` later.

### Q85 — Re-evaluating after every broadcasting EFSP message   [lane: L7]  [who: SUPERVISOR]  [blocking: no]
- Context: L7 briefing Q4 adds `WsHub.setOnEfspChange(fn)`, called in `_onMessage` after the broadcasts, so a badge clears with the Mutation rather than up to 15 s later. It edits `ws-hub.js`'s `_onMessage`, which L10 also touches (Q3).
- Question: Accept the hook?
- Options: (a) yes, and merge L7 before L10; (b) the tick only.
- Recommended: (a).

### Q86 — Which obligations can be "met"   [lane: L7]  [who: SUPERVISOR]  [blocking: no]
- Context: L7 briefing Q5: only `ADVANCE_FORWARDING` and `VOID_TIME_EXPIRED` have an observable lead window; the other four are missed-only; missed means raised episodes, so one that re-fires counts twice.
- Question: Accept?
- Options: (a) as the briefing says; (b) count every clearance as met.
- Recommended: (a). It is honest, and L5 reads it (Q75).

### Q87 — Several obligations on one Strip   [lane: L7]  [who: SUPERVISOR]  [blocking: no]
- Context: L7 briefing Q6: one badge, the most severe (OVERDUE, then earliest `dueAt`), with `getEfspObligations` for later, and no `strip-view.js` change.
- Question: Accept?
- Options: (a) yes; (b) render all of them now.
- Recommended: (a). `strip-view.js` belongs to later waves (§2).

### Q88 — Should a controller be able to acknowledge an obligation?   [lane: L7]  [who: HUMAN]  [blocking: no]
- Context: `DATA_ONLY_VERIFICATION` stays raised because no verification action exists. `UNACTIVATED_AIRSPACE_ENTRY` stays while the board lags reality.
- Question: Do you want an audited "acknowledge" that hides one?
- Options: (a) no: alerts clear only when their condition clears (L7 as briefed); (b) yes, later.
- Recommended: (a) for L7, and your call for later.

---

## L8 — test debt, AIC and JTAC scenarios

### Q89 — What the AIC actually does with a mission line   [lane: L8]  [who: HUMAN]  [blocking: yes]
- Context: AIC holds `NON_CREATE_OPS` (`permission.js:181`) but appears in no `MISSION_STATE_OWNERS` row (`permission.js:376`), so it can own a Strip it cannot advance. Its Bays are `aic-on-station` (which implies ON_STATION) and `aic-committed` (no implied state). Guide §4.1 says only "works under TAC_C2's TOFI". The scenario needs a script.
- Question: What is the squadron's AIC workflow?
- Options: (a) TAC_C2 transfers the mission line to AIC at check-in; AIC moves it between On Station and Committed and annotates; AIC transfers it back to TAC_C2 to go OFF_STATION; AIC never advances state; (b) AIC only watches; (c) AIC advances ON_STATION↔OFF_STATION itself.
- Recommended: (a). It matches today's permissions, so the scenario tests the design. If you say (c), that is a recorded bug for a later lane, not an L8 fix.

### Q90 — What the JTAC sees   [lane: L8]  [who: HUMAN]  [blocking: no]
- Context: JTAC's grant set is empty and it has one Bay, `jtac-mission`. It is unclear how a Strip gets into that Bay.
- Question: What is the JTAC's view?
- Options: (a) every TACTICAL MISSION Strip read-only, and the scenario asserts every mutation is refused; (b) only CAS missions assigned to it, which is a new concept.
- Recommended: (a) for the scenario, with (b) recorded as a design question.

### Q91 — Committing a scenario that finds a bug   [lane: L8]  [who: SUPERVISOR]  [blocking: no]
- Context: L8 records bugs and does not fix them, but commits must be green.
- Question: How is a found bug committed?
- Options: (a) `test(..., { todo: 'L8-B<n>: <line>, see docs/wip/L8.md' })` with the assertion intact, so `node --test` reports TODO and stays green; (b) `skip`; (c) red.
- Recommended: (a). The owning lane removes the `todo` when fixing it.

### Q92 — Harness helpers   [lane: L8]  [who: SUPERVISOR]  [blocking: no]
- Context: `tests/helpers/efsp-scenario.mjs` is shared (Q3).
- Question: May L8 append `aicAct`/`jtacAct` and a crew with AIC/JTAC?
- Options: (a) yes: append only, no signature changes; (b) a separate helper file.
- Recommended: (a).

### Q93 — DOM-stub migration vs L2 and L7 in the same test file   [lane: L8]  [who: SUPERVISOR]  [blocking: no]
- Context: L8 migrates the stub at the top of `efsp-ui-reachability.test.js`. L2 appends tests at its end, and the L7 briefing edits `:194–198` and appends one test.
- Question: How are three lanes kept apart in one file?
- Options: (a) L8 changes only the harness block (top) and may extend `tests/helpers/dom-stub.js` additively; L7 keeps to its lines; L2 appends; the integrator merges L7, then L2, then L8; (b) serialise them.
- Recommended: (a).

---

## L9 — `[SOURCE-DEFINED]` inventory (read-only)

The L9 briefing (`wave1/L9.md` §9) carries Q1–Q8 with defaults. It settles scope (tests and
non-EFSP services out, ADRs counted rather than audited unless a UI string or the usage guide cites
them) and the format (Groups A–F). One question needs the supervisor, and one is worth recording.

### Q94 — Who answers Group E, and when   [lane: L9]  [who: SUPERVISOR]  [blocking: no]
- Context: Group E is "needs a squadron/human answer before it can be worded" (for example `positionRadars`' defaults, and which Positions sit at which console). L20 runs last, in wave 4.
- Question: When do Group E items reach the human?
- Options: (a) the supervisor folds Group E into the next `questions-round*.md` as soon as L9 reports, so the answers exist long before L20; (b) at L20 time.
- Recommended: (a).

### Q95 — Keeping the inventory current as wave 1 adds items   [lane: L9]  [who: SUPERVISOR]  [blocking: no]
- Context: L9 inventories `49e6bb2`, but L1, L2, L4, L5 and L10 each add `[SOURCE-DEFINED]` behaviour in the same wave.
- Question: How do later items reach L20?
- Options: (a) every lane lists its new `[SOURCE-DEFINED]` items in its wip file under a fixed heading, and L20 unions them with L9's inventory and re-runs L9's grep; (b) L9 re-runs after the wave.
- Recommended: (a). Add the heading to the wip template (Q21).

---

## L10 — IFF from interrogation

The L10 briefing (`wave1/L10.md`) recommends Option A: per-session classification in `presentTrack`,
a new `caps.mode4`, `mode4Of()` in the transponder model with coalition standing in for crypto keys,
and a ground-clutter rule replacing `invisible`. Its §5.3 table lists every behaviour change against
today. **Every one of those changes is visible on every controller's scope**, so the briefing's
open questions are almost all yours.

### Q96 — Approve the classification table   [lane: L10]  [who: HUMAN]  [blocking: yes]
- Context: `wave1/L10.md` §5.3, evaluated top to bottom:
  1. a declaration;
  2. datalink PPLI → friendly;
  3. valid Mode 4 to a Mode-4 radar → friendly;
  4. Mode 3/C to an SSR radar → **neutral**;
  5. anything else → bogey.

  Coalition is used only inside the transponder model, as the crypto key (an enemy player's Mode 4 fails). The bold rows in its worked-outcomes table are what changes today, for example: own AI on the approach radar shows **neutral**; own player with Mode 4 off shows **neutral**; hostile player squawking shows **neutral**; a neutral airliner on a primary-only radar shows **bogey**.
- Question: Do you accept this model and its visible consequences?
- Options: (a) accept as briefed; (b) accept, but Mode 3/C-only reads bogey rather than neutral (briefing Q3's alternative); (c) keep coalition-based IFF for now.
- Recommended: (a).

### Q97 — Do own AI aircraft and ships answer Mode 4?   [lane: L10]  [who: HUMAN]  [blocking: no]
- Context: L10 briefing Q1 and Q5. DCS AI has no IFF switch. The default is `transponder.mode4For: ['own']` for AI aircraft and ships, and ground vehicles answer nothing (own vehicles become **bogey** unless declared).
- Question: Accept?
- Options: (a) yes, as briefed; (b) own AI yes, own vehicles friendly too.
- Recommended: (a).

### Q98 — Do ATC radars interrogate Mode 4?   [lane: L10]  [who: HUMAN]  [blocking: no]
- Context: L10 briefing Q2 default: no. On TWR, APP and CTR scopes cooperative traffic is then neutral (grey) and non-cooperative traffic bogey, own or not. Flipping `approach: {mode4:true}` is one line if you want own traffic blue on the RAPCON scope.
- Question: Grey-for-everyone on ATC scopes, or blue for own traffic?
- Options: (a) no Mode 4 on ATC radars (briefing default); (b) approach and airport radars interrogate Mode 4.
- Recommended: (a). ATC separates everybody, and colour is a tactical concern.

### Q99 — Replacing `invisible` with a ground-clutter rule   [lane: L10]  [who: HUMAN]  [blocking: no]
- Context: L10 briefing Q4 and Q6 default (A1): an aircraft on the ground with no cooperative answer is not presented, whatever its coalition. The accepted cost: **an own player parked with no SRS client disappears from the airport radar** (today it is shown friendly). No MTI for taxiing aircraft.
- Question: Accept that cost?
- Options: (a) A1 as briefed; (b) A2: show everything on the ground (the 40 NM airport radar then shows every ramp nearby, enemy ones included); (c) A1 now and A3 (a surface range gate in `coverage.js`) later.
- Recommended: (c).

### Q100 — Players with no SRS client   [lane: L10]  [who: HUMAN]  [blocking: no]
- Context: Under the model, an own player without SRS has no transponder and no Mode 4. Airborne they are bogey to everybody without a datalink grant (friendly to a datalink session if their type is a participant), and on the ground they are invisible (Q99). This already partly holds today for airborne players.
- Question: Is that the intended nudge toward running SRS?
- Options: (a) yes; (b) no, treat an own player without SRS as friendly.
- Recommended: (a). Option (b) reintroduces coalition-as-answer.

### Q101 — Should the wire say why a contact is friendly?   [lane: L10]  [who: SUPERVISOR]  [blocking: no]
- Context: L10 briefing Q7: no `MODE4` entry in `sources`, because it changes the wire vocabulary and the client.
- Question: Accept?
- Options: (a) not in L10, follow-up; (b) now.
- Recommended: (a).

### Q102 — Automatic IFF changes arrive with the next fresh return   [lane: L10]  [who: SUPERVISOR]  [blocking: no]
- Context: L10 briefing §5.4: automatic `iffState` leaves the global fingerprint, so a Mode 4 switch-on shows at the next sweep; declarations still relabel at once. The change to `ws-hub.js` is serialised after L7 (Q3).
- Question: Accept the sweep-latency and the serialisation?
- Options: (a) yes; (b) keep automatic IFF in the fingerprint per session (more state).
- Recommended: (a).
