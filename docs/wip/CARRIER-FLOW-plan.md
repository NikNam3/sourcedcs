# Carrier strip flow: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The carrier flow of ADR 0156: two carrier strip types, a Case per flight, one Marshal panel for every arrival,
carrier-only labels, no conflict alert between carrier aircraft, assignments with conformance, and the carrier map's
measure line and cursor readout.

**Architecture:** crc-sync's authority registry gets two strip-type families (`CV_LAUNCH`, `CV_RECOVERY`) in place of
MARSHAL and PATTERN (FINAL keeps only its PAR branch). The flight's Case lives on its Marshal-stack entry, the one place
the stack derivation already reads; NLA, handoff validation, correlation and the client read it from there. The client
renders what the server derives (Blocks, buttons, rows); no flow rule is decided twice.

**Tech stack:** Node (crc-sync, CommonJS, `node:test`), crc-desktop renderer (native ES modules, SVG panels), Playwright e2e.

**Spec:** `docs/adr/0156-the-carrier-strip-flow-two-strip-types-a-case-per-flight-and-one-marshal-panel.md` and
`docs/wip/CARRIER-FLOW.md`. Read both before any task.

## Global constraints

- Strip types are `CV_LAUNCH` and `CV_RECOVERY` (not `CV_DEP`/`CV_ARR`: `CV_DEP` is already a Position id).
- States: `CV_LAUNCH` = `ON_DECK, CV_AIRBORNE, KILO, DROPPED`; `CV_RECOVERY` = `STACK, COMMENCED, FINAL_APPROACH, DIRTY,
  BULLSEYE, CV_PATTERN, DROPPED`. Shown as ON DECK, AIRBORNE, KILO, STACK, COMMENCED, FINAL APP, DIRTY, BULLSEYE, PATTERN.
- Button labels, exactly: `COMMENCE`, `TO APPR`, `DIRTY UP`, `FLY BULLS`, `TO PATTERN`, `DROP` (recovery);
  `LAUNCHED`, `KILO`, `DROP`, `TO MARSHAL` (launch).
- Nothing reads `Date.now()` for EFSP times (mission clock, ADR 0079). No `window.*` globals; no import cycle (bound 0).
- Every new EFSP frame through `wire/frames.js` and `WsHub#deliverEfsp`; a new refusal code joins `REFUSAL_CODES`.
- Tests run under `nice -n 19`; Playwright at most 2 shards. Lane agents run no gates; the supervisor runs the suites
  (both unit suites after any edit on either side).
- `npm run wire:record` after the wire changes; `npm run freeze:update` as its own commit after the code commits.
- No migration of persisted carrier Strips (mission reset clears them).

## Review focus

1. A Case change while flights are in the stack: a Case I flight and a Case III flight in one stack must keep their
   own derivation (Case I: no slot, no EAT; III: slots counted among II/III entries only). Test in Task 2.
2. A departure handed to the Marshal keeps its Strip id, flight, squawk and correlation, and gets one launch count and
   later one recovery count, never two launches. Test in Task 3 and Task 5.
3. Back to stack from FINAL_APPROACH (entry PUSHED, Strip owned by a lane) and from DIRTY: new slot, new EAT,
   overrides and HDG/SPD/ALT cleared, Strip back to the Marshal at STACK. Test in Task 3.
4. A carrier Strip with no callsign never shows a name on a non-carrier scope, and gains one at TACTICAL only after
   Set callsign. Test in Task 6.
5. An unstaffed receiver (Departure, PriFly or both lanes unstaffed): the button is inhibited with "no receiving
   Position present" or goes to the consolidated hat (ADR 0110), never throws. Test in Task 3.

---

## Lane 1: server model (Tasks 1–5, in order)

### Task 1: the two strip-type families

**Files:**
- Create: `crc-sync/src/efsp/authority/strip-types/cv-launch.js`, `cv-recovery.js`
- Delete: `crc-sync/src/efsp/authority/strip-types/marshal.js`, `pattern.js`
- Modify: `authority/index.js:58-65` (registration), `final.js` (drop the `ctx.facilityId === 'CARRIER'` branches and
  `BALL`/`FINAL_TRAPPED`; owners come from PAR's `ownsStates`; `CV_LANES` moves to `cv-recovery.js`), `nla.js:38-40,101`
  and `permission.js:46,84-86,218` re-exports, `positions/carrier.js` (`CREATE_STRIP_TYPE_PERMISSIONS`: PriFly
  `CV_LAUNCH`, Marshal `CV_RECOVERY`; `REPLICA_ON_RECEIPT`: ARRIVAL/INBOUND to CV_MARSHAL becomes `CV_RECOVERY`/`STACK`)
- Test: rewrite `crc-sync/tests/efsp-carrier-strip-types.test.mjs`; update `authority-registry.test.mjs`

**Interfaces:**
- Produces: `STRIP_TYPE_CV_LAUNCH = 'CV_LAUNCH'`, `STRIP_TYPE_CV_RECOVERY = 'CV_RECOVERY'`; `CV_LANES` exported from
  `cv-recovery.js`; NLA ctx gains `carrierCaseOf(strip) -> 'I'|'II'|'III'|null` (Task 2 builds it; default null in
  `nla.js:55-77`).
- State owners: `ON_DECK: [CV_PRIFLY]`, `CV_AIRBORNE, KILO: [CV_DEP]`, `STACK, COMMENCED: [CV_MARSHAL]`,
  `FINAL_APPROACH, DIRTY, BULLSEYE: CV_LANES`, `CV_PATTERN: [CV_PRIFLY, ...CV_LANES]` (the Strip's owner is the one who
  acts; listing both is how Case I and II/III share the state).

NLA (`computeNla(strip, fd, now, ctx)`), with `c = ctx.carrierCaseOf(strip)` for recovery and the ship's
`ctx.carrierCase()` for a launch at ON_DECK:

| Type / state | Result |
|---|---|
| CV_LAUNCH ON_DECK, ship I | `{toState:'DROPPED'}` (label DROP) |
| CV_LAUNCH ON_DECK, ship II/III | `{toState:'CV_AIRBORNE', transferTo:'CV_DEP', carrierHandoff:'LAUNCH_TO_DEPARTURE'}` |
| CV_LAUNCH CV_AIRBORNE | `{toState:'KILO'}` |
| CV_LAUNCH KILO | `{toState:'DROPPED'}` |
| CV_RECOVERY STACK, c II/III | `{toState:'COMMENCED', carrierHandoff:'COMMENCE'}`; inhibited if not in the stack |
| CV_RECOVERY COMMENCED | `{toState:'FINAL_APPROACH', transferTo: lane, carrierHandoff:'TO_APPROACH'}` (lane = `ctx.carrierLaneFor(strip)`) |
| CV_RECOVERY FINAL_APPROACH | `{toState:'DIRTY'}` |
| CV_RECOVERY DIRTY | `{toState:'BULLSEYE'}` |
| CV_RECOVERY BULLSEYE | `{toState:'CV_PATTERN'}` |
| CV_RECOVERY STACK, c I | `{toState:'CV_PATTERN', transferTo:'CV_PRIFLY', carrierHandoff:'CASE_I_TO_PRIFLY'}` |
| CV_RECOVERY CV_PATTERN | `{toState:'DROPPED'}` |

Any transfer to an unstaffed, unconsolidated Position: `{inhibited:'no receiving Position present'}`.
Family flags: both `creatorOwnsInitialState: true`; `CV_LAUNCH.initialState 'ON_DECK'`, countable `['CV_AIRBORNE','KILO',
'ON_DECK']`, `excludedWhenNotCountable 'NEVER_DEPARTED'`; `CV_RECOVERY.initialState 'STACK'`, countable `['CV_PATTERN']`,
`'NEVER_LANDED'`; split/join/ground `[]`.

- [ ] **Step 1: Failing tests** in `efsp-carrier-strip-types.test.mjs`: `CARRIER_STRIP_TYPES` is `['CV_LAUNCH',
  'CV_RECOVERY']`; their states collide with no other family's but DROPPED; the owner table above; one `computeNla`
  assertion per row of the NLA table (ctx stubs as in today's test); `MARSHAL` and `PATTERN` are not registered;
  `computeFinalNla` at `facilityId:'CARRIER'` is no longer special.
- [ ] **Step 2:** `cd crc-sync && nice -n 19 node --test tests/efsp-carrier-strip-types.test.mjs` fails.
- [ ] **Step 3:** Implement the two families and the edits above. Grep `src/` for `'MARSHAL'`, `'PATTERN'` (carrier
  meaning only: `flight-data-store.js:53` and `arrival.js:72` are the airfield's), `LAUNCHED`, `IN_STACK`, `IN_PATTERN`,
  `RECOVERED`, `BOLTER_WAVEOFF` and change each carrier use; the list is in this plan's appendix A.
- [ ] **Step 4:** the test passes.
- [ ] **Step 5:** commit `feat(carrier): CV_LAUNCH and CV_RECOVERY strip types (ADR 0156)`.

### Task 2: the Case per flight and the stack overrides

**Files:**
- Modify: `crc-sync/src/efsp/carrier/marshal-stack.js`, `carrier-store.js`, `facility-rules.js:158-166`,
  `required-rules.js`
- Test: `tests/efsp-carrier-stack.test.mjs`, `tests/efsp-carrier-set-eat.test.mjs`, new `tests/efsp-carrier-overrides.test.mjs`

**Interfaces:**
- `ENTRY_KEYS` gains `caseValue` (`'I'|'II'|'III'`, always present), `angelsOverride` and `dmeOverride` (numbers,
  present only while set). `caseIAngels` is renamed `angelsOverride` (one override for every Case).
- `appendFlight(flightDataId)` stores the ship's Case as the entry's `caseValue`. A Case I entry has `stackIndex: null`
  and takes no II/III slot; II/III slots, push times and lane alternation (`assignLanes`) count II/III entries only.
- `deriveEntry` reads `entry.caseValue`, not `inputs.caseValue`. `angels = angelsOverride ?? (6 + slot)` (Case I:
  `angelsOverride ?? null`); `marshalDme = dmeOverride ?? (firstFixDme + slot ?? angels + 15)` (Case I: null);
  `angelsSet` / `dmeSet: true` while overridden. The derived entry keeps `caseValue`.
- New stack ops (in `STACK_OP_KINDS`, `_DISPATCH`; refused without `sequencesStack`):
  `SetAngels {flightDataId, angels: int 1..40 | null}` (any Case), `SetDme {flightDataId, dme: int 1..99 | null}`
  (II/III only). `SetCaseIAngels` is removed. `SetEat` is refused by the flight's Case (I), not the ship's.
- `carrierStore.caseOf(flightDataId) -> caseValue | null`; facility rules gain `carrierCaseOf(strip)` reading it.
- `RETURN_TO_STACK` (`BackToStack`) accepts a HOLDING or PUSHED entry; it takes the next free II/III slot, clears
  `pushedAtUtc`, `eatOverrideUtc`, `angelsOverride`, `dmeOverride`, and sets `unpassed: ['angels','eat']`.
- New effect `RECASE_TO_STACK`: sets `caseValue` to the ship's Case (refused if the ship is in Case I), then as
  `RETURN_TO_STACK`.
- An entry stays in the stack until its Strip is dropped (`carrierRetireFlight` on drop, unchanged).

- [ ] **Step 1: Failing tests:** mixed stack (append Case III A, ship to I, append B, ship to III, append C): A slot 0,
  C slot 1, B `stackIndex null`, B's derived `eatUtc`/`marshalDme` null, A and C push one spacing apart; `SetAngels` on
  B gives `angels` and `angelsSet`; `SetDme` on B refused (Case I); `SetDme` on A gives `marshalDme` and `dmeSet`;
  `BackToStack` on a PUSHED entry with overrides yields HOLDING at the top slot with no overrides; `RECASE_TO_STACK` on B
  with the ship in III gives `caseValue 'III'` and a slot, and with the ship in I is refused; `SetEat` on A succeeds after
  the ship goes to Case I.
- [ ] **Step 2:** run the three files, they fail.
- [ ] **Step 3:** implement. `validateStack` still refuses `DERIVED_KEYS` on an entry; `angelsOverride`/`dmeOverride`
  are not derived keys. `Delta` moves overrides of EAT only.
- [ ] **Step 4:** pass. **Step 5:** commit `feat(carrier): a Case per flight on the stack entry; SetAngels, SetDme`.

### Task 3: the handoffs, the conversion and the NLA wiring

**Files:**
- Modify: `crc-sync/src/efsp/carrier/handoffs.js` (table replaced), `handoff-effects.js` (`state` becomes `states[]`),
  `board/ops/carrier-handoff.js`, `permission.js` (`mayActBesideOwner`), `positions/carrier.js` (`canRecordCarrierHandoff`)
- Test: rewrite `tests/efsp-carrier-handoffs.test.mjs`, `tests/efsp-scenario-carrier-l17.test.mjs`

**Interfaces:** the new `CARRIER_HANDOFFS` (each row keeps `trigger: 'CONTROLLER_INITIATED'`, `label`, `source:
'[SOURCE-DEFINED]'`, `guide: 'docs/adr/0156 …'`) and `CARRIER_HANDOFF_EFFECTS`:

| Kind | From → to | Case checked | Strip | Stack effect | Label |
|---|---|---|---|---|---|
| `LAUNCH_TO_DEPARTURE` | CV_PRIFLY → CV_DEP | ship II/III | CV_LAUNCH ON_DECK → CV_AIRBORNE | – | LAUNCHED |
| `LAUNCH_TO_MARSHAL` | CV_PRIFLY → CV_MARSHAL | ship I | CV_LAUNCH ON_DECK → CV_RECOVERY STACK | `APPEND` | TO MARSHAL |
| `DEPARTURE_TO_MARSHAL` | CV_DEP → CV_MARSHAL | any | CV_LAUNCH CV_AIRBORNE or KILO → CV_RECOVERY STACK | `APPEND` | TO MARSHAL |
| `COMMENCE` | CV_MARSHAL → SAME | flight II/III | STACK → COMMENCED | `MARK_PUSHED` | COMMENCE |
| `TO_APPROACH` | CV_MARSHAL → CV_APP1/2 | flight II/III | COMMENCED → FINAL_APPROACH | – | TO APPR |
| `CASE_I_TO_PRIFLY` | CV_MARSHAL → CV_PRIFLY | flight I | STACK → CV_PATTERN | – | TO PATTERN |
| `RETURN_TO_STACK` | CV_MARSHAL or the owning lane → CV_MARSHAL | flight II/III | COMMENCED, FINAL_APPROACH, DIRTY → STACK | `RETURN_TO_STACK` | BACK TO STACK |
| `ABORT_TO_STACK` | CV_MARSHAL → CV_MARSHAL | flight I, ship II/III | STACK or CV_PATTERN → STACK | `RECASE_TO_STACK` | ABORT TO CASE II/III |

- A row carries `caseOf: 'SHIP' | 'FLIGHT' | 'BOTH'`; `validateCarrierHandoff(kind, {shipCase, flightCase,
  fromPositionId, toPositionId})` checks the right one(s). `TO_APPROACH` accepts an explicit `toPositionId` (the lane
  override); without one it uses `carrierLaneFor`.
- The lane may send `RETURN_TO_STACK` from FINAL_APPROACH or DIRTY only; the Marshal from all three states
  (`mayActBesideOwner` gains the FINAL_APPROACH and DIRTY rows for CV_MARSHAL).
- The conversion (`LAUNCH_TO_MARSHAL`, `DEPARTURE_TO_MARSHAL`): in `_applyCarrierHandoff`, as ConvertToArrival does
  (`board/ops/convert-to-arrival.js:32-146`): keep stripId, flightDataId and code; archive `previousLeg`; then
  `APPEND` calls `rules.carrierAppendFlight(flightDataId)`. A full stack refuses the handoff (new refusal
  `MARSHAL_STACK_FULL` in `REFUSAL_CODES`), nothing changes.
- `RETURN_TO_STACK` and `ABORT_TO_STACK` also cancel the flight's active heading, speed and altitude clearance entries
  (the path `SetBlock` with an empty value takes for Blocks `9A-VECTOR`, `9A-SPEED`, `7`).
- The second button: the NLA result for CV_LAUNCH at ON_DECK (ship I) and at KILO carries `alsoHandoff:
  'LAUNCH_TO_MARSHAL'` / `'DEPARTURE_TO_MARSHAL'`; the client draws it beside DROP (Task 9).
- Removed kinds: `MARSHAL_TO_APPROACH`, `APPROACH_TO_FINAL`, `FINAL_TO_LSO`, `MARSHAL_TO_PRIFLY`, `COMMENCED_TO_MARSHAL`,
  `MARSHAL_TO_PATTERN_CASE_I`, `FINAL_TRAPPED`; `GUIDE_TRANSFER_KINDS` goes.

- [ ] **Step 1: Failing tests** (`efsp-carrier-handoffs.test.mjs`, pure): every row legal in its Case and refused in
  the other(s), by sender and receiver. Scenario (`efsp-scenario-carrier-l17.test.mjs`, rewritten with
  `tests/helpers/efsp-scenario.mjs`): (a) Case III launch ON_DECK → LAUNCHED → KILO → TO MARSHAL: same `stripId`,
  `flightDataId`, `beaconAssigned`, now `CV_RECOVERY/STACK` at CV_MARSHAL in `cv-marshal-stack`, in the stack;
  (b) Case III recovery COMMENCE → TO APPR (lands at CV_APP1, then the next at CV_APP2) → DIRTY UP → FLY BULLS →
  TO PATTERN → DROP; (c) Case I recovery TO PATTERN at PriFly, DROP; (d) Case I recovery, ship to II, ABORT: STACK,
  `caseOf` II, slot; (e) Back to stack from FINAL_APPROACH by the Marshal and by the lane, from DIRTY by the lane;
  assigned HDG/SPD/ALT gone; (f) BULLSEYE has no back-to-stack (refused); (g) TO APPR with CV_APP1 and CV_APP2
  unstaffed: inhibited; CV_DEP unstaffed and consolidated at the Marshal: LAUNCHED goes to the hat.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass.
- [ ] **Step 5:** commit `feat(carrier): the ADR 0156 handoffs; a departure becomes the recovery in place`.

### Task 4: creation by side number, Set callsign, departure radial, squawk by Case

**Files:**
- Modify: `crc-sync/src/efsp/flight-data-store.js` (`createFlightData` :596-664), `carrier/flight-record.js`,
  `board/ops/create-strip.js` (:47-73, :167), `block-map.js` (carrier maps), `board/ops/set-block.js` (C1 on a carrier
  Strip triggers the ATO bind), `carrier/ato-bind.js`
- Test: `tests/efsp-carrier-flight-record.test.mjs`, `tests/efsp-scenario-carrier-ato.test.mjs`, new
  `tests/efsp-carrier-create.test.mjs`

**Interfaces:**
- `CreateStrip` for `CV_LAUNCH`/`CV_RECOVERY` takes `flightData: {sideNumber, aircraftType, callsign?}`, plus
  `departureRadialDeg` (CV_LAUNCH, 0..360, magnetic as typed) or `lowStateLb` (CV_RECOVERY). `sideNumber` is required
  for these types (1–8 letters or digits, refusal `VALIDATION_ERROR`); `callsign` optional. Every other strip type
  still requires a callsign (`CALLSIGN_RE`).
- `military.carrier` gains `departureRadialDeg`. Block `C20` (DEP RAD, `{kind:'carrier', field:'departureRadial'}`).
- Squawk: `seed.noCode = true` when the flight's Case is I (ship's Case at create; for a recovery, the entry's Case).
  A converted Strip keeps its code; ABORT to II/III with no code allocates one (`assignDiscreteCode`).
- Set callsign: `SetBlock C1` on a carrier Strip writes `identity.callsign` and then calls
  `atoFlightForLaunch(ctx, {callsign})` for a Strip with no ATO line; an unambiguous match binds it (warning
  `BOUND_TO_ATO`, as today). The create-time ATO bind (`create-strip.js:69-73`) runs only when a callsign is given.
- Block maps (server; the client copy in Task 9 must match): `CV_LAUNCH`: chrome, `C1` (callsign, not required),
  `C2` (type, required), `C18` (side, `carrier`, required), `C20`, `5`, `9A-VECTOR`, `9A-SPEED`, `7`
  (clearance altitude, as ARRIVAL's). `CV_RECOVERY`: chrome, `C1`, `C2`, `C18`, `C12` (fuel), `C7` (angels,
  `carrier-derived`), `C8` (EAT, `carrier-derived`), `5`, `9A-VECTOR`, `9A-SPEED`, `7`. `SetBlock` on `9A-VECTOR`,
  `9A-SPEED`, `7` or `5` is refused for a Case I flight (`VALIDATION_ERROR`, "Case I: no radar service").

- [ ] **Step 1: Failing tests:** create CV_RECOVERY with `{sideNumber:'301', aircraftType:'FA18C'}` and no callsign:
  ok, side 301, no callsign, a code in Case III, none in Case I; without `sideNumber`: refused; CV_LAUNCH with
  `departureRadialDeg: 90`: stored; `SetBlock C1 'VIPER11'` binds the one matching ATO MISSION line and warns
  `BOUND_TO_ATO`; two matches: no bind; `SetBlock 9A-VECTOR` on a Case I flight refused.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5:** commit `feat(carrier): create by side number; Set callsign binds the ATO`.

### Task 5: facility file, counting, hints, correlation

**Files:**
- Modify: `crc-sync/config/efsp-facility-carrier.json` (Bays), `src/efsp/traffic-count.js:134,163`,
  `src/efsp/surveillance-hints.js:60-62`, `src/efsp/correlation-reconciler.js` (:51-65, :209), `src/efsp/board/strip-ops.js:648`,
  `src/efsp/board/coordination.js:236`, `src/efsp/undo/scopes.js:30`
- Test: `tests/efsp-facility-config.test.mjs`, `tests/efsp-traffic-count*.test.mjs`,
  `tests/efsp-correlation-reconciler.test.mjs`

**Interfaces:**
- Bays: CV_PRIFLY `cv-prifly-launch` (ON_DECK), `cv-prifly-pattern` (CV_PATTERN), `cv-prifly-deck` (none);
  CV_DEP `cv-dep-departures` (CV_AIRBORNE; KILO stays in it: a Bay implies one state, the NLA moves the state only);
  CV_MARSHAL `cv-marshal-stack` (STACK; COMMENCED stays), `cv-marshal-coordination`; CV_APP1/2 `cv-appN-approach`
  (FINAL_APPROACH; DIRTY and BULLSEYE stay), `cv-appN-pattern` (CV_PATTERN). Gone: `cv-marshal-airborne`,
  `cv-prifly-recovered`, the lane `final` and `bolter` Bays.
- Counting: `CARRIER_STRIP_TYPES = ['CV_LAUNCH','CV_RECOVERY']`; a CV_LAUNCH drop counts a launch (hull = departure);
  a CV_RECOVERY drop from CV_PATTERN counts a recovery (hull = destination). The conversion itself counts the launch
  (a Strip that was CV_LAUNCH and is now CV_RECOVERY has launched): record it in the conversion's Mutation as the
  count path for a pre-drop CV_AIRBORNE/KILO/ON_DECK does.
- Correlation: the beacon rung (`correlation-reconciler.js:209`) skips a flight whose live carrier Strip has Case I
  (`carrierStore.caseOf`, or the ship's Case for a CV_LAUNCH); the binding rung (manual `BindTrack`) is unchanged.
- Surveillance hints: every CV_* state expects nothing (UNEXPECTING), as the carrier states do today.

- [ ] **Step 1: Failing tests:** facility config loads with the Bays above and no Bay implies a removed state; a
  converted departure dropped from CV_PATTERN counts one launch and one recovery; a CV_LAUNCH dropped at ON_DECK counts
  one launch; a Case I recovery with a code is not auto-correlated, a Case III one is; `BindTrack` on the Case I one
  correlates it.
- [ ] **Step 2–4.** **Step 5:** commit `feat(carrier): Bays, counting and correlation for ADR 0156`.

## Lane 2: server surveillance (after Task 1)

### Task 6: carrier labels only where they belong

**Files:**
- Modify: `crc-sync/src/surveillance/identity.js:50-63`, `presentation.js:117-164`, `src/ws-hub.js:442-457,499`
- Test: `tests/presentation.test.mjs`, `tests/identity.test.mjs`

**Interfaces:**
- `Identity.identify(trackId)` also returns `carrierFlight: boolean` (the correlated flight has a live CV_LAUNCH or
  CV_RECOVERY Strip; from `stripsOfFlight`).
- `presentTrack` ctx gains `tacticalSession: boolean` (`session.coverage.signedOnPositions` has a Position of Facility
  `TACTICAL`). The coverage key (`ws-hub.js:499`) includes it.
- Rule: when `who.carrierFlight`, the FLIGHT_DATA label (callsign, type) is given only if `tacticalSession` and the
  callsign is set; otherwise the label falls through to datalink, tag, track number as for an uncorrelated contact.
  Code and Mode C follow the sensors, unchanged. The carrier map's side-number label is the client's
  (`carrier-map-panel.js _flightOfTrack`) and needs no server change.

- [ ] **Step 1: Failing tests:** carrier flight, callsign VIPER11, ATC session: `label.callsign` not VIPER11, `source`
  not FLIGHT_DATA; same at a tactical session: VIPER11; carrier flight with no callsign at a tactical session: no
  FLIGHT_DATA label; a non-carrier correlated flight at an ATC session: unchanged (FLIGHT_DATA).
- [ ] **Step 2–4.** **Step 5:** commit `feat(surveillance): a carrier Strip names its contact only at TACTICAL (ADR 0156)`.

### Task 7: no conflict alert between two carrier aircraft

**Files:** Modify `crc-sync/src/conflict-alert.js` (`_roles` :342-363, `pairKind` :133-138), `src/app/monitors.js:166-200`.
Test: `tests/conflict-alert.test.mjs`.

**Interfaces:** a role gains `group: 'CV'` when `trackControlOf(flightDataId)` names a live CV_LAUNCH/CV_RECOVERY
Strip; `pairKind` already returns null for two known tracks in one group. A formation's or MARSA's own group wins
only if it is not CV (a carrier aircraft in a formation is still CV).

- [ ] **Step 1: Failing tests:** two converging carrier flights: no alert; carrier vs non-carrier: alert; carrier vs
  uncorrelated intruder: alert; MCI unchanged.
- [ ] **Step 2–4.** **Step 5:** commit `feat(conflict-alert): no alert between two carrier aircraft (ADR 0156)`.

### Task 8: conformance for Case II/III carrier Strips

**Files:** Modify `crc-sync/src/efsp/conformance.js` only if a test fails. Test: `tests/conformance.test.mjs`.

**Interfaces:** the monitor already checks every correlated flight with an ACTIVE clearance entry (`:364-414`), so a
heading or altitude typed in `9A-VECTOR`/`7` on a carrier Strip is checked with no new code. Speed is not checked
(see the open question at the end).

- [ ] **Step 1: Test:** a correlated CV_RECOVERY flight with heading 270 assigned flying 180 raises HEADING; with
  altitude 8000 assigned at 12000 raises LEVEL_BUST; with nothing assigned at 9000 while its angels are 7: no alert.
- [ ] **Step 2:** run. If it passes, commit the test only (`test(conformance): carrier Strips`).

## Lane 3: client (after Tasks 1–4)

### Task 9: carrier Strips, create form, menu, NLA buttons

**Files:**
- Modify: `crc-desktop/app/public/js/panels/efsp/strip-template.js` (:304-358, `BLOCK_MAPS` :388, `BLOCK_TITLES`,
  `isParFinalOnlyOnCarrier` removed with its three callers), `strip-fields.js:52-54,130-187`, `efsp-nla.js:65-107,226-247`,
  `carrier-panel.js:84-114`, `panel/create-strip.js:134-160,403-534`, `index.html:216-226`, `panel/state.js`,
  `strip-menu.js`
- Test: `crc-desktop/tests/efsp-block-map-parity.test.mjs`, `efsp-strip-fields.test.mjs`, `efsp-nla-client.test.mjs`,
  `client-mirror-parity`, `efsp-ui-reachability`

**Interfaces:**
- Client block maps equal Task 4's server maps (parity test over `['CV_LAUNCH','CV_RECOVERY']`).
- `COMPACT_BLOCKS_BY_STRIP_TYPE`: CV_LAUNCH `['C18','C2','C20','5','9A-VECTOR','9A-SPEED','7']`; CV_RECOVERY
  `['C18','C2','C12','C7','C8','5','9A-VECTOR','9A-SPEED','7']`. `compactBlocksFor(strip, ctx)` drops `C8`, `5`,
  `9A-VECTOR`, `9A-SPEED`, `7` for a Case I flight (the flight's `caseValue` from the carrier view's derived entry; a
  CV_LAUNCH uses the ship's Case). `C1` is never on the face. Side number always leads (`_swapSideAndCallsign` goes).
- `efsp-nla.js CARRIER_HANDOFFS` mirrors Task 3's kinds and labels; `nlaButtonLabel` gives the plain labels (`DIRTY UP`,
  `FLY BULLS`, `TO PATTERN`, `DROP`, `KILO`) for the non-handoff rows. `carrierExtraNlaButtons(strip)` draws the
  `alsoHandoff` button (TO MARSHAL) and no longer "See you".
- Create: at a carrier Position the form shows SIDE (`#efsp-new-strip-side`, `^[A-Z0-9]{1,8}$`) and TYPE; PriFly adds
  DEP RAD (3 digits), the Marshal FUEL (as the panel's `fuelBlockOp` reads it). No callsign field there. Origins:
  `CV_PRIFLY → cv-prifly-launch, CV_LAUNCH`; `CV_MARSHAL → cv-marshal-stack, CV_RECOVERY`.
- Menu ("…", group `Carrier`): `Set callsign` (owner, any carrier Strip: prompt, `SetBlock C1`); `Back to stack`
  (Marshal at COMMENCED/FINAL_APPROACH/DIRTY, II/III flight; lane owner at FINAL_APPROACH/DIRTY):
  `CarrierHandoff RETURN_TO_STACK`; `Abort to Case II/III` (Marshal, Case I flight at STACK/CV_PATTERN, listed
  disabled with reason "Case I is active" while the ship is in Case I): `ABORT_TO_STACK`; `Approach: other lane`
  (Marshal at COMMENCED): `CarrierHandoff TO_APPROACH` with `toPositionId` the other lane.

- [ ] **Step 1: Failing tests:** block parity; compact blocks per type and Case; `nlaButtonLabel` for each NLA row of
  Task 1; menu items present/disabled per the rules above (`_stripMenuItems` with stub strips).
- [ ] **Step 2–4.** **Step 5:** commit `feat(crc-desktop): carrier Strips, create by side number, carrier menu`.

### Task 10: the Marshal panel

**Files:**
- Modify: `crc-desktop/app/public/js/panels/efsp/marshal-board-model.js`, `marshal-panel.js`, `marshal-picture.js`,
  `carrier-map-panel.js:10,23,172,177,192` (drop `fuelLevel`/margin), `carrier-map-model.js:243-268` (`occupancy` kinds),
  `css/marshal-panel.css:74-75,104-105`
- Create: `crc-desktop/app/public/js/panels/efsp/marshal-circle.js` (Case I circle, SVG)
- Test: `crc-desktop/tests/marshal-board-model.test.mjs`, `carrier-map-model.test.mjs`

**Interfaces:**
- `buildBoard({view, strips, flightDataOf, trackOf, now})` returns `{caseI: Row[], sequenced: Row[], vacancies, toGo}`;
  rows are every live CV_RECOVERY Strip, split by the entry's `caseValue`. Row: `flightDataId, stripId, ownerPositionId,
  seq, side, type, fuelLb, angels, angelsSet, eatUtc, eatSet, marshalDme, dmeSet, state, bearingDeg, rangeNm`
  (bearing/range from the ship to the correlated track, null if none). `fuelLevel`, `marginKlb`, `statusOf`, `kind` go.
- `actionOf(row) -> {label, op}`: STACK II/III `COMMENCE`, COMMENCED `TO APPR`, FINAL_APPROACH `DIRTY UP`, DIRTY
  `FLY BULLS`, BULLSEYE `TO PATTERN`, CV_PATTERN `DROP`, STACK I `TO PATTERN`; `op` is `{kind:'InvokeNla'}` sent as
  the owner. The panel shows it live only when `getActingPositions()` holds `ownerPositionId`, else the same label
  greyed (it is the status).
- Columns: Case II/III `SEQ SIDE TYPE FUEL EAT ANG DME` + action; Case I `SEQ SIDE TYPE FUEL ANG` + action.
  Click-to-edit for the Marshal on rows the Marshal owns: FUEL (`fuelBlockOp`, unchanged), EAT (`SetEat`), ANG
  (`SetAngels`), DME (`SetDme`, II/III); an empty value clears an override. Overrides underlined (`angelsSet`, `dmeSet`,
  `eatSet`), grey.
- `renderMarshalCircle(svg, rows, {brcDeg})`: the overhead stack as a ring, ship at the centre, ship-up (rotate by
  `-brcDeg`); each row with a bearing/range drawn at it, label `side A<angels>`; rows without a track are not drawn.
  Scale: ring radius = 2.5 nm (the 5 nm Case I circle), view out to 6 nm.
- The settings `marshalLowStateMarginKlb` and the bingo classes are removed.

- [ ] **Step 1: Failing tests** (`marshal-board-model.test.mjs`, rewritten): rows split by Case; a Case I row after the
  ship goes III stays in `caseI`; `actionOf` for each state; no `fuelLevel` export; editable cells per owner;
  `carrier-map-model` occupancy from the new states.
- [ ] **Step 2–4.** **Step 5:** commit `feat(crc-desktop): the Marshal panel for every arrival (ADR 0156)`.

## Lane 4: carrier map (independent, any time)

### Task 11: measure line and cursor readout on the carrier map

**Files:**
- Modify: `crc-desktop/app/public/js/panels/efsp/carrier-map-model.js`, `carrier-map-panel.js` (`_build` :95-135,
  `_draw` :212-342), `crc-desktop/tests/fixtures/module-graph-exports.json`
- Test: `crc-desktop/tests/carrier-map-model.test.mjs`, `crc-desktop/e2e/carrier-map.spec.js`

**Interfaces:**
- Model (leaf, no imports): `fromPixel({x, y}, {cx, cy, k}) -> {e, n}`; `bearingRangeOf({e, n}) -> {trueDeg, nm}`
  (`trueDeg` in [0,360), 0 shown as 360); `braText(magDeg, nm) -> 'RRR/DDD'` (both padded to 3, `'---'` for an unknown
  bearing).
- Panel: an overlay `<svg data-cm="overlay">` over `cm-svg` inside `cm-wrap`, not cleared by `_draw`.
  - Cursor readout: on `mousemove` over `wrap`, text `braText(magnetic, nm)` at the cursor +14 px (flipped near the
    right edge), fill `COL.ringText`, the panel's font; hidden on `mouseleave`. Magnetic from `magneticText(trueDeg,
    ship.lat, ship.lon)` (`magnetic.js`), which the panel may import (no cycle: `magnetic.js` imports `sync.js` only).
  - Measure line: right-button drag (as the main map, `map-interactions.js:191-207`): `mousedown` button 2 starts at
    the point, `mousemove` draws a dashed line and `RRR / DDD` at its midpoint (variation at the start point), button-2
    `mouseup` clears; `contextmenu` suppressed on `wrap`. Same colours as the main map's measure line (white 0.7,
    dash 6 4, 11 px label).

- [ ] **Step 1: Failing tests:** `fromPixel` inverts the panel's forward map (`P` at :220) for four points;
  `bearingRangeOf({e:0,n:5})` = 360/5, `({e:5,n:0})` = 090/5; `braText(5.4, 12.6)` = `'005/013'`. e2e (append to
  `carrier-map.spec.js`): moving the mouse 10 nm north of the ship shows a readout matching `/^\d{3}\/010$/` in
  `[data-cm="cursor-bra"]`; right-drag draws `[data-cm="measure"]`, release removes it.
- [ ] **Step 2–4.** **Step 5:** commit `feat(crc-desktop): carrier map measure line and cursor radial/range`.

## Closing (supervisor, after all lanes)

### Task 12: wire, goldens, e2e, docs

- [ ] `cd crc-sync && npm run wire:record` (expect `WIRE_PROTOCOL` 3 → 4 if 3 has shipped in a `crc-desktop-v*` tag;
  otherwise it stays). Commit with the fixture.
- [ ] Rewrite `crc-desktop/e2e/l17-carrier.spec.js` (tests 01–07: create by side number, the Case III and Case I walks,
  the round trip, abort, back to stack, refusals) and `e2e/marshal-board.spec.js` (test 02 low state removed; the new
  buttons and editable ANG/DME); fix `carrier-map.spec.js:206-208` (bingo).
- [ ] Both unit suites (`nice -n 19 npm test` in crc-sync and crc-desktop); the e2e carrier specs, 2 shards.
- [ ] `npm run freeze:update`; check the diff is limited to carrier states, Bays, permission tables and the protocol
  number; commit alone.
- [ ] `npm run soak:selfcheck` (the Board ops changed).
- [ ] Docs: `docs/efsp-usage-guide.md` carrier chapter; `crc-desktop/build-assets/release-notes.md`; ADR 0156 status to
  Built with the date; `docs/glossary.md` if it lists carrier states; CLAUDE.md needs no change.

## Appendix A: carrier names to change in crc-sync/src

`authority/index.js:62-64`; `nla.js:38-40,101`; `permission.js:46,84-86,218`; `carrier/handoffs.js`;
`carrier/handoff-effects.js:14-24`; `board/ops/create-strip.js:69,167`; `board/coordination.js:236`;
`board/strip-ops.js:648`; `undo/scopes.js:30`; `traffic-count.js:134,163`; `surveillance-hints.js:60-62`;
`correlation-reconciler.js:52-64`; `block-map.js:468-560,647`; `config/efsp-facility-carrier.json:83-182`;
`positions/carrier.js:45-57`. PAR keeps `par-final.js`, `final-position.js`, `board/ops/final-call.js`,
`surveillance/par-monitor.js`.

## Open question (blocks only Task 8's speed part)

Speed conformance: crc-sync gets ground speed only from DCS (`tracks.js:49`), no indicated airspeed, and checks speed
nowhere today. An assigned 250 KIAS is about 300+ kt over the ground at altitude with a tailwind, so a ground-speed
check would alarm on aircraft doing exactly what they were told. The plan assigns and shows SPD and does not check it.
