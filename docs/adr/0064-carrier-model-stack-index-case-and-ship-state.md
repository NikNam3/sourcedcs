# 0064 — The carrier is modelled as one stack index, one Case and one ship banner, all derived and none typed; the CARRIER Facility that wires it in is designed here and built by L17

**Status.** Part A is **built** in this ADR's commits (`crc-sync/src/efsp/carrier/`, pure functions with
tests). Part B is a **proposal**: lane L17 builds it in wave 3 and records what it built in its own ADR
`0074`. Under decisions P4 this ADR is never edited. If L17 departs from Part B, 0074 says so and why.

## Decisions at a glance

For a product reader. Each line is argued below.

1. **The stack position is the only number a Marshal controller sets for a flight.** Its altitude
   (angels), holding distance (DME) and push time are always computed from it. They cannot be
   typed, stored or edited one by one.
2. **Re-sequencing is one gesture.** Inserting a low-fuel aircraft low moves everyone above it up a
   slot together: altitude, DME and push time. Pushing never moves anyone. Taking an aircraft out
   leaves a gap until the controller closes it (decisions H28).
3. **The recovery Case is one setting for the whole ship, owned by PriFly.** Changing it changes
   every carrier Strip at once. The weather only *advises* ("the weather says Case III"). It never
   blocks PriFly.
4. **Case I is a list of squadron-assigned altitudes, not a timed stack.** It has no push times, no
   DME and no radial.
5. **Ship state is a banner computed from the ship in DCS**: heading, final bearing, speed, position,
   time. The only thing a controller may enter is the altimeter.
6. **Final bearing = ship heading − 9°** (the Nimitz-class angled deck, a `[SOURCE-DEFINED]` value).
   The marshal radial defaults to final bearing + 180, and Marshal may set it (decisions H27).
7. **Every bearing is computed in true and shown magnetic.** The magnetic variation is supplied from
   outside the model (decisions H15, S-W3).
8. **EEAT, approach button, bingo and low state belong to the flight, not the Strip.** EEAT set
   before launch therefore survives to recovery by construction. The approach is stored as a button
   number, never a frequency.
9. **The four carrier hand-overs are four different buttons**, each tagged with what prompted it:
   Commence, Radar contact, Ball, See you. Every one is a controller action. None fires automatically.
10. **The carrier is CVN-72, DCS unit `UNION`, one hull and one stack in v1** (decisions H13, H26,
    H29). There is no FACSFAC Position, and the carrier never coordinates with Centre (H30).

## Context

Guide §9.12 is binding and quite specific. It says:

- "The recovery Case is global session state owned by `CV_PRIFLY` … never a per-Strip attribute."
- "Case III — one integer drives four displayed fields."
- "Store the index; compute the display. Do not let a controller hand-edit DME."
- "Ship state is a banner, not a field … final bearing is computed from ship heading, not typed."
- Store the approach button, not a frequency. EEAT "MUST survive from the departure Strip through
  to recovery".
- The four hand-overs "MUST NOT be unified behind one button".

WP7A's acceptance bullets (§13) turn these into tests. This ADR's commits satisfy bullets 1, 2 and 5
outright, and the pure halves of 3 and 8. L17 satisfies the rest at the wire and in the UI.

Before this slice there was no carrier code in the EFSP. Outside it, `radars.js` already gives every
ship a search radar (`carrier:<id>`) and every CVN an approach radar (`cvapp:<id>`), both with
`type: 'carrier'`. The DCS ship track carries a grid heading and a ground speed, and that is all the
model needs.

Three rulings changed the briefing this lane started from, and the code follows them:

- **The hull** is CVN-72 `UNION` (H13, H26), not CVN-75 Truman.
- **The marshal radial** is final bearing + 180 and Marshal may set it (H27). The briefing had
  "the 180 relative to BRC", which is the guide's literal text.
- **Headings are magnetic on every display** (H15).

## Decision — Part A: what is built

Everything lives in `crc-sync/src/efsp/carrier/` and is exported through `index.js`. The code is
pure: callers pass in the time (the mission clock's `now()`, decisions H11), there is no disk, no
store and no socket, and no function mutates its arguments. Any function that can refuse returns
`{ ok: false, reason: 'VALIDATION_ERROR' | 'NOT_FOUND', detail }` and never throws, so a store can
call it from inside `apply()`.

### The marshal stack (`marshal-stack.js`)

**The stored record holds only authoritative values:**

```
MarshalStack = { stackId, hullId, charlieTimeUtc, marshalRadialDeg, entries[] }
MarshalEntry = { fdrId, stackIndex, status: 'HOLDING'|'PUSHED', caseIAngels }
```

`validateStack` refuses any entry that carries `angels`, `marshalDme`, `pushTimeUtc` or any other
derived key, and names the key. `normalizeStack`, used on restore, drops such keys instead of
failing, so a bad snapshot never empties the carrier. That is WP7A bullet 2 enforced by the data
itself, not by the UI. It is the same move as `block-map.js` returning `null` for a `system` Block.

**Derivation.** `deriveEntry(entry, { caseValue, charlieTimeUtc, marshalRadialDeg, shipState })`
returns a new, frozen object.

| Field | Case II / III (§9.12) | Case I (§9.12 rule 3) |
|---|---|---|
| angels | `6 + stackIndex` | the squadron-assigned `caseIAngels` (≥ 2), or null ("assign altitude") |
| marshal DME | `angels + 15` | null (render "≤ 5 NM") |
| push time | `charlie + stackIndex` minutes, window ±10 s | null. "Do not build Case I around push times." |
| marshal radial | Marshal's set value, otherwise **final bearing + 180** (H27) | null (overhead) |
| expected final bearing | from ship state, never computed here | same |

`checkConsistency` is §9.12's "SHOULD validate". It checks that angels + 15 = DME, that angels is at
least 6, and that the radial lies within 15° `[SOURCE-DEFINED]` of the reciprocal of the final
bearing. The derivation can never break the first two checks. The third fires if Marshal sets a
radial far off the default.

**Operations.** Each is one call that returns the whole new stack plus `changed`: the `fdrId`s whose
display changed, in stack order. L17 sends that as one delta.

`InsertAt`, `Append`, `Move`, `Remove`, `CloseUp`, `MarkPushed`, `SetCharlieTime`, `SetCaseIAngels`,
`SetMarshalRadial`, dispatched by `applyStackOp`. No op names angels, DME or push time. `SetAngels`,
`SetDme` and anything else unknown is refused.

- **Insert** moves every occupied slot at or above the target up one, together. The ripple stops at
  the first vacancy, so a pilot above a gap is not re-cleared for nothing `[SOURCE-DEFINED]`.
  Inserting into a vacant slot moves nobody.
- **Refusals:**
  - a non-integer or negative index;
  - an insert that would leave a gap above the stack;
  - an insert that would push someone above the top slot (`maxIndex` 19, angels 25 / DME 40,
    `[SOURCE-DEFINED]`); the refusal names the top entry;
  - a flight already in the stack;
  - an insert at or below an aircraft that has already pushed, because renumbering it would
    rewrite a push time in the past.
- **Push does not renumber.** Aircraft commence bottom-up at their own times. If a push closed the
  stack, every other push time would jump a minute earlier. That is the drift defect D16 names.
- **Remove leaves a vacancy** (H28). `closeUp: true`, or a separate `CloseUp`, moves everyone above
  down one in the same op. The controller chooses; neither happens implicitly.
- **Move** is remove-without-close-up plus insert, done atomically. It is "the cheapest gesture". A
  flight moved down renumbers exactly the flights it passes.
- **Ops never read the Case.** The stack is the same in every Case, and only the derivation reads
  it. So a Case change needs no stack op, and switching I → III yields a valid timed stack
  immediately, in check-in order.

Entries are keyed by `fdrId`, never by Strip or DCS track id (ADR 0045). One flight has several
Strips over its life, and DCS re-mints track ids on every restart.

### The recovery Case (`recovery-case.js`)

`RecoveryCase = { value: 'I'|'II'|'III', setBy, setAt, history[] }`. The history is append-only.

`setCase` accepts any Case → any other Case. PriFly may go I → III when the weather closes in, and
III → I at dawn. It is still written as a table (`LEGAL_CASE_TRANSITIONS`), so a future restriction
is a one-line edit. A no-op is refused. The default is **Case III** `[SOURCE-DEFINED]`: the most
restrictive, used when nothing is known.

`caseFloor({ ceilingFt, visibilityNm, night })` applies §9.12's criteria verbatim. Night gives III;
below 1,000 ft or 5 NM gives III; below 3,000 ft gives II; otherwise I. Unknown weather gives
`null`; it never guesses. `caseAdvisory` speaks only when the set Case is *less* restrictive than
the floor (ADR 0058: indicators only when something is wrong).

**`setCase` never consults the weather.** Guide §4.1 makes PriFly the one who sets the Case, and the
model's weather inputs are not reliable. Refusing PriFly's call on the model's reading would be
defect D11, fabricating authority.

### Ship state (`ship-state.js`)

**The hull.** A hull config (`{ hullId, match: { unitName, type, coalition }, angledDeckDeg }`) is
matched to a live ship track by DCS **unit name first, then type**, and never by track id. Only ships
(`category 4`) of the server's own coalition are considered. The own coalition is injected, and H42
makes it the server's one coalition. If two ships of the type qualify, the match is `null` with
"hull ambiguous — configure unitName"; it never guesses. `DEFAULT_HULL` is CVN-72, unit `UNION`,
type `CVN_72`.

**`buildShipState({ hull, track, now, inputs, weatherPa, gridConvergenceDeg })`** produces the
banner:

- **heading and BRC.** BRC is the ship's heading, rounded to a whole degree.
- **final bearing.** `BRC − angledDeck`. The landing area is angled to port, so the final bearing
  is left of the heading. Worked example: BRC 5° → 356°.
- **speed** in knots, **position**, and **time** (`now`).
- **the altimeter.** Its source is labelled: `SET` by a controller, otherwise `THEATER_WEATHER`
  from sea-level pressure.
- **`stale` / `found` flags**, and a reason whenever the final bearing is unavailable: no ship
  track, no heading, or "angled deck not configured for <type>".

The **angled-deck offset** is not in the guide. The model ships 9° for `CVN_71`–`CVN_75` as a
`[SOURCE-DEFINED]` table that a hull config can override. Every other type (`CV_59`, `LHA_Tarawa`,
`Kuznetsov`, …) gets `null`, so there is no final bearing and the banner says why. It does not guess
(D11).

`applyShipStateInput` is the only controller-writable path into the banner. It accepts exactly
`{ altimeterInHg }` (27.00–32.00, or null to fall back to the weather). Any other key is refused with
"final bearing is computed from ship heading (§9.12 rule 5) and cannot be entered". That is WP7A
bullet 5.

`shipStateChanged` re-broadcasts only on a whole-degree change of BRC, a change of speed or
altimeter, or a stale/found flip. A ship in a turn therefore does not flood the wire.

**Heading references (decisions H15).** Every bearing the model holds is **true**. DCS-gRPC's
`orientation.heading` is a *grid* heading on DCS's flat world (`common.proto:418-424`). The
difference from true is the theater projection's grid convergence, a few degrees towards the edges of a map.

- The builder converts grid to true when given `gridConvergenceDeg`.
- Without it, the heading stays grid and is labelled `headingRef: 'GRID'`, rather than being passed
  off as true.
- `displayBearing(deg, { ref, magneticVariationDeg })` is the one conversion to magnetic. It returns
  the magnetic value (`ref 'M'`) when the variation is known. Otherwise it labels the value `T` or
  `G`. It never prints a true bearing as if it were magnetic.

### The flight's carrier fields (`flight-record.js`)

`fdr.military.carrier = { eeatUtc, approachType, approachButton, bingoField, bingoFuelLb, lowStateLb }`.

**On the FDR, because the FDR outlives every Strip.** The launch Strip is dropped at launch and the
recovery Strip is a new one on the same `fdrId`. An EEAT held on a Strip would die with the launch
Strip, which is exactly the "field most likely to be missed" of §9.12 rule 7, missed this time by the
software.

**Inside `fdr.military`**, as a sub-object the way §9.4's `military.mtr` is. ADR 0052 settled that
military fields live in one namespace, and round-1 question Q63's default follows it.

**`lowStateLb` is not the guide's M17 `military.fuelState`.** §6.4 defines M17 as "fuel state /
playtime remaining", an endurance (a time) per the DD-175. The carrier low state is pounds of fuel.
They are two units and so two fields.

**Validators:**

- approach types `TACAN`/`ICLS`/`ACLS`/`PAR`/`VISUAL` `[SOURCE-DEFINED]`;
- the approach button is an integer 1–20 `[SOURCE-DEFINED]` range, with no default buttons until
  the squadron supplies its list (H31);
- anything shaped like a frequency (`250.3`, `"251.000"`, `251`) is refused with "store the approach
  button, not a frequency (§9.12 rule 6)".

`normalizeCarrierFlight` fills a missing namespace with defaults, so an FDR created before L17 still
renders, and it never clears a valid EEAT.

`marshalMessage(...)` returns §9.12's sixteen fields **in its exact order**. A missing value is
`null`, never omitted, so the controller *sees* a blank EEAT. The two bearings carry a magnetic
`display`.

### The four hand-overs, as data (`transfers.js`)

| Kind | Trigger type | From → to | Cases | Effect | Button |
|---|---|---|---|---|---|
| `MARSHAL_TO_APPROACH` | `CONTROLLER_INITIATED` | CV_MARSHAL → CV_APP1/2 | II, III | ownership; stack `MarkPushed` | Commence |
| `APPROACH_TO_FINAL` | `RADAR_ACQUISITION` | CV_APP1/2 → same | II, III | Role MARSHAL → FINAL | Radar contact |
| `FINAL_TO_LSO` | `PILOT_BALL_CALL` | CV_APP1/2 → LSO (not an EFSP Position) | all | state only | Ball |
| `MARSHAL_TO_PRIFLY` | `PILOT_SEE_YOU` | CV_MARSHAL → CV_PRIFLY | II | ownership; Role MARSHAL → PATTERN; remove, no close-up | See you |
| `MARSHAL_TO_PATTERN_CASE_I` `[SOURCE-DEFINED]` | `CONTROLLER_INITIATED` | CV_MARSHAL → CV_PRIFLY | I | as above | To pattern |

The fifth row exists because §9.12 gives Case I no hand-over, yet a Case I flight must reach PriFly.
It reuses the controller-initiated trigger type, so the guide's **four trigger types stay four**.

**Every trigger is a controller gesture.** "Radar acquisition" is the controller saying "radar
contact". "Ball" and "see you" are the controller recording what the pilot said. The trigger type is
metadata recorded on the transfer and rendered distinctly (bullet 4). It is never an automation hook:
guide §10.3 and D5 forbid surveillance advancing a Strip. No transfer carries a frequency; that is
SFA's business (L18).

`laneFor` / `assignLanes` feed CV_APP1 and CV_APP2 "alternately from the Marshal stack in push
order" (§9.12):

- even push ordinals go to APP1 and odd ones to APP2 (`[SOURCE-DEFINED]`, H30);
- if the preferred lane is unmanned the flight goes to the other one, and if neither is manned the
  result is `null`;
- the ordinal is the flight's rank in the stack. Pushed aircraft still in the stack count, so a lane
  does not flip when the aircraft below commences. Gaps do not count.

## Decision — Part B: the wiring L17 builds

### B1. The CARRIER Facility (`facility-config.js`)

```js
{
  facility: 'CARRIER',
  positions: ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2'],
  positionClasses: { CV_MARSHAL: 'MILITARY_ATC', CV_PRIFLY: 'MILITARY_ATC', CV_APP1: 'MILITARY_ATC', CV_APP2: 'MILITARY_ATC' },
  coveringChain: { CV_APP2: 'CV_APP1', CV_APP1: 'CV_MARSHAL' },     // [SOURCE-DEFINED]; PriFly deliberately absent
  positionRadars: { /* see below */ },
  hiddenBlocks: {},
  bays: {
    CV_MARSHAL: [
      { bayId: 'cv-marshal-stack',        rackIds: ['main'], impliesState: 'IN_STACK' },  // ordered by stackIndex
      { bayId: 'cv-marshal-departures',   rackIds: ['main'], impliesState: 'LAUNCH' },
      { bayId: 'cv-marshal-coordination', rackIds: ['main'] },
    ],
    CV_PRIFLY: [
      { bayId: 'cv-prifly-pattern', rackIds: ['initial', 'break', 'downwind', 'groove'], impliesState: 'IN_PATTERN' },
      { bayId: 'cv-prifly-deck',    rackIds: ['main'] },   // deck state: a board, inert until designed
    ],
    CV_APP1: [
      { bayId: 'cv-app1-lane',   rackIds: ['main'], impliesState: 'COMMENCED' },
      { bayId: 'cv-app1-final',  rackIds: ['main'], impliesState: 'ON_FINAL' },       // one Strip at a time (§7.10)
      { bayId: 'cv-app1-bolter', rackIds: ['main'], impliesState: 'BOLTER_WAVEOFF' },
    ],
    CV_APP2: [ /* the same three, cv-app2-* */ ],
  },
  dataOnly: false, standingReleases: [], aitAuthorized: false,
}
```

- **All four Positions are `MILITARY_ATC`.** §4.1 says "Military ATC afloat", and
  `station-coverage.js` gates STCA on `MILITARY_ATC`/`CIVIL_ATC`. A new class would silently lose
  STCA and would have to be added to every class set: ADR 0041's inclusion-list trap. PriFly's
  "supervisory, not radar control" (§4.1 rule 4) is expressed through **permissions** (B4), not
  through its class. It stays out of the covering chain so that Strips never strand on it.
- The "Case selector" of §4.2 **is not a Bay.** It is the control for the Case record, in PriFly's
  panel header.
- **No coordination primitives** (HANDOFF, POINT_OUT, …) for any CV Position. §9.13: "The carrier
  does not talk to the centre." FACSFAC is out of scope (H30). `DUE_REGARD` applies inside the
  Carrier Control Area.
- The Facility gets its entry in `FACILITY_CONFIG_FILES`, with a
  `CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER` override.
- **Hull config is not facility config.** It ships in `config/efsp-carriers.json`, seeded from
  `DEFAULT_HULL`. It is read once at startup (decisions P5). Runtime Case and stack live in the
  store's snapshot under `state/` (ADR 0048).

**Radar selectors: the honest current limit.** `selectorMatches` compares `selector.kind` to
`radar.type`, and both ship radars have type `'carrier'`. So `{ kind: 'carrier' }` matches the search
**and** approach radars of **every** ship, LHAs and Kuznetsov included. `coalition: 'own'` narrows it
only by side. v1 uses `{ kind: 'carrier', coalition: 'own' }` for all four Positions.

The recommended extension follows. L17 should build it if Approach must see only the CVN's approach
radar:

- `radars.js` tags the two ship radars `carrierRadar: 'search' | 'approach'`;
- `validateRadarSelector` accepts `{ kind: 'carrier', radar?, hull? }`;
- `selectorMatches` compares `radar`, and resolves `hull` through `matchHullTrack`;
- CV_APP1/2 then take approach + search for `CVN-72`, PriFly takes search, and Marshal takes both.

### B2. Roles and states (`nla.js`, `board-store.js`)

Three new Roles. Their state names collide with no existing state except `DROPPED`, and in
particular **not `FINAL`**, which is already an ARRIVAL *state* (`nla.js:56`). `INELIGIBLE_STATES`
and `impliesState` are role-blind string sets, so a clash would be silent.

```js
MARSHAL: ['LAUNCH', 'IN_STACK', 'COMMENCED', 'DROPPED']
FINAL:   ['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF', 'DROPPED']
PATTERN: ['IN_PATTERN', 'RECOVERED', 'DROPPED']
// DEFAULT_INITIAL_STATE_BY_ROLE: MARSHAL 'IN_STACK', FINAL 'ON_FINAL', PATTERN 'IN_PATTERN'
```

| Role | State | Next action | Notes | Owners |
|---|---|---|---|---|
| MARSHAL | `LAUNCH` | Launched → `DROPPED` | the recovery is a new MARSHAL Strip on the same `fdrId`; EEAT is on the FDR | CV_MARSHAL |
| MARSHAL | `IN_STACK`, Case II/III | Commence → `COMMENCED` | `transferTo: laneFor(…)`, occupancy-gated; stack `MarkPushed`; `MARSHAL_TO_APPROACH` | CV_MARSHAL |
| MARSHAL | `IN_STACK`, Case I | To pattern → PATTERN `IN_PATTERN` | role change + transfer to PriFly; `MARSHAL_TO_PATTERN_CASE_I` | CV_MARSHAL |
| MARSHAL | `COMMENCED` | Radar contact → FINAL `ON_FINAL` | in-place role change, as ConvertToArrival does (ADR 0023); `APPROACH_TO_FINAL` | CV_APP1/2 |
| FINAL | `ON_FINAL` | Ball → `BALL` | `FINAL_TO_LSO`; the talk-down ends | CV_APP1/2 |
| FINAL | `BALL` | Trapped → `DROPPED` | bolter/waveoff is a drag to the Bolter Bay | CV_APP1/2 |
| FINAL | `BOLTER_WAVEOFF` | Radar contact → `ON_FINAL` | | CV_APP1/2 |
| PATTERN | `IN_PATTERN` | Recovered → `RECOVERED` | racks are pattern legs, not states | CV_PRIFLY (+ RSU, L18) |
| PATTERN | `RECOVERED` | Drop → `DROPPED` | | CV_PRIFLY (+ RSU) |

- The next action from `IN_STACK` **depends on the Case record**, so `_normalizeCtx` gains a
  `carrierCase` field.
- **"See you" is not the next action.** A Strip has one next action (§3.5 rule 1). "See you" is a
  second, distinct button rendered from `CARRIER_TRANSFERS`, available only in Case II.
- **Trap for L17:** `computeNla` falls back to the DEPARTURE table for an unknown role
  (`nla.js:368-371`). A MARSHAL Strip created before its table is registered would show "Send to
  Clearance". Register `COMPUTE_BY_ROLE` entries in the same commit as the Roles.

**FINAL is shared with PAR (L18).** Its Block Map has **no writable Block during `ON_FINAL`**
(§7.10), and a test asserts that; it is bullet 6. PAR's terminal event is "landing assured / missed
approach" rather than "ball", so L18 either adds a PAR terminal state or reuses `BALL` under a
neutral label. That is L18's call. `PATTERN` is shared with RSU in the same way.

### B3. Block Maps (`block-map.js`, parity test)

The Block ids are `C`-prefixed. `M` is frozen for MISSION.

| Block | MARSHAL field | Target kind | Writable |
|---|---|---|---|
| C1 / C2 | callsign / type | `fdr` identity | yes |
| C3 | CASE | `carrier-derived` | **no** |
| C4 | APPROACH TYPE | `carrier` `approachType` | yes |
| C5 | MARSHAL RADIAL | `carrier-derived` (set through `SetMarshalRadial`, not SetBlock) | **no** |
| C6 | MARSHAL DME | `carrier-derived` | **no (D16)** |
| C7 | ANGELS | `carrier-derived` (Case I: `SetCaseIAngels`, not SetBlock) | **no** |
| C8 | EAT/PUSH | `carrier-derived` | **no (D16)** |
| C9 | EXPECTED FINAL BEARING | `carrier-derived` | **no (bullet 5)** |
| C10 | APPROACH BUTTON | `carrier` `approachButton` | yes |
| — | ALTIMETER, SHIP WX | the ship banner, not a Block (§9.12 rule 5) | — |
| C12 | FUEL/LOW STATE | `carrier` `lowStateLb` | yes |
| C13 / C14 | BINGO FIELD / FUEL | `carrier` `bingoField` / `bingoFuelLb` | yes |
| C15 | EEAT | `carrier` `eeatUtc` | yes, on the `LAUNCH` Strip too |

- `resolveBlockTarget` returning `null` for `carrier-derived` is its existing behaviour for an
  unknown kind. L17 adds a test that SetBlock on C3 and C5–C9 is `VALIDATION_ERROR`: bullets 2 and 5
  at the wire.
- A `carrier` target writes `fdr.military.carrier` through `validateCarrierFlightField`.
- Re-sequencing is **never** a SetBlock; it is a stack op.
- FINAL has C1, C2 and derived deck, final bearing and distance, with nothing writable. PATTERN has
  C1, C2 and a free annotation.

### B4. Permissions (`permission.js`)

- `PERMISSIONS`:
  - CV_MARSHAL: `NON_CREATE_OPS` + `CreateStrip`;
  - the other three: `NON_CREATE_OPS`;
  - none of them gets coordination ops, TOFI, ConvertToArrival or airspace-entry ops.
- `CREATE_ROLE_PERMISSIONS`: CV_MARSHAL creates `MARSHAL` Strips, for both launch and recovery
  check-in. FINAL and PATTERN Strips come only by conversion.
- New predicates, each taking exactly one `actingPositionId` (D21), in the style of
  `canDeclareMarsa`:
  - `canSetRecoveryCase`: CV_PRIFLY only (§4.1), and not Marshal;
  - `canSequenceMarshalStack`: CV_MARSHAL. This covers every stack op, including the marshal
    radial (H27) and Charlie time;
  - `canEditShipStateInput`: CV_PRIFLY or CV_MARSHAL;
  - `canRecordCarrierTransfer(pos, kind)`: from `CARRIER_TRANSFERS[kind].from`.

  These are predicates, **not** `OP_KINDS` entries. An `OP_KINDS` entry would be picked up silently
  by every `.filter()`-built grant.
- `STATE_OWNERS_BY_ROLE` gains MARSHAL, FINAL and PATTERN per B2.

### B5. Correlation eligibility (`correlation-reconciler.js`)

- Eligible: `IN_STACK`, `COMMENCED`, `ON_FINAL`, `BALL`, `BOLTER_WAVEOFF`, `IN_PATTERN` and
  `RECOVERED` (as ARRIVAL's `LANDED` is).
- **`LAUNCH` is eligible by default**, on the `PUSHBACK` precedent. But ship radars set
  `noGroundAircraft: true` (`radars.js:191`), so a jet on deck may never be illuminated. L17 checks
  whether a correlation rung needs illumination; the beacon rung does not. If deck aircraft never
  correlate, list `LAUNCH` as ineligible, with that reason, so that spotted jets do not drag the
  rate down.
- **The existing reconciler test does not force this decision.** It only checks that listed states
  still exist. L17 adds a test that pins every MARSHAL/FINAL/PATTERN state to an explicit
  expectation.

### B6. `CarrierStore`: a sixth store, keyed by `hullId`

The Case and the stack are facts about the ship's recovery, spanning many flights. So they live
neither on the Board nor on an FDR, for the same reason airspace (ADR 0034) and MARSA (ADR 0051) do
not.

- **Record:** `{ hullId, rev, recoveryCase, stacks: { [stackId]: MarshalStack }, shipInputs, transitions[] }`.
  In v1 `stacks` holds the one `MAIN` stack (H29), so a second stack is additive.
- **`apply(mutation, actingPositionId, by)`**, copying `marsa-store.js`: `baseRev`/`STALE_REV`, an
  audit record carrying `hullId`, refusals logged too, one never-throwing entry point. The `op.kind`
  values are:
  - `SetCase` → `setCase` (needs `canSetRecoveryCase`);
  - the `STACK_OP_KINDS` → `applyStackOp` (needs `canSequenceMarshalStack`);
  - `SetShipInput` → `applyShipStateInput` (needs `canEditShipStateInput`).

  Every time comes from the injected mission clock.
- **Ship state is derived, never stored.** A 1 Hz server tick runs `matchHullTrack` +
  `buildShipState`, and publishes only when `shipStateChanged`. It follows the correlation
  reconciler's tick pattern and is not audited per tick. The tick injects `gridConvergenceDeg` for
  the theater. On restore the track id is discarded and re-matched.
- **Night (round-1 Q62, default a):** L17 derives `night` for `caseFloor` from the mission clock
  plus the sun's elevation at the ship. Until then the advisory treats night as unknown and stays
  quiet.
- **Wire**, appended per plan §2:
  - an `efsp-carrier-mutation` message;
  - an `efsp-carrier-delta` message carrying the **whole hull record**, the current `shipState` and
    **server-derived** `derived: deriveStack(…)`. crc-desktop cannot import crc-sync, so one
    implementation beats a client copy under a parity test;
  - one snapshot key, `carriers`.
- **A Case change is one delta carrying one record.** Every client re-renders every carrier Strip
  from it. That is how bullet 3's "at once" holds without a per-Strip fan-out.
- **Stack ↔ Strip link is `fdrId`.** A stack entry whose FDR retires is removed without close-up
  (`onFdrRetired` / `evictMissingFdrs`, as MARSA has).
- **Persist** under `carriers`, and restore intact. Case and stack are controller declarations
  (MARSA's reasoning), passed through `normalizeRecoveryCase` / `normalizeStack` /
  `normalizeShipInputs`.

### B7. Client surfaces (crc-desktop)

- **Ship banner** on every carrier Position: BRC, final bearing, speed, altimeter and time. It shows
  stale / "hull not found" / "angled deck not configured" when true.
  - Bearings are shown magnetic through `displayBearing` and the per-theater variation.
  - A `T` or `G` suffix appears if the variation or convergence is missing.
- **Case selector** in PriFly's header, editable only there. The other Positions show the Case
  read-only. The advisory appears only when it is non-null.
- **Marshal Stack Bay** ordered by `stackIndex`, with vacancies shown as empty slots.
  - Re-sequencing is drag-to-slot: one gesture, one `Move`. A dragged Strip previews its new
    angels, DME and push.
  - In Case I the Bay is an altitude-keyed list with no push column.
- **Four visually distinct hand-over buttons** from `CARRIER_TRANSFERS` (bullet 4).
- **The FINAL component**, shared with PAR: no inputs.
- **The final-bearing line on the map**, from the ship along the reciprocal of the final bearing.
  It mirrors `geojson.js`'s airport centreline, but is keyed by hull, not by radar-id prefix (the
  `app:`/`cvapp:` lesson).

### B8. Out of scope

FACSFAC and the due-regard boundary (§9.13, OQ9, H30). SFA frequency rotation (L18). The contents of
the deck-state board. More than one hull or stack at once (the keys allow it; v1 has one). Sourcing
ship weather.

## Alternatives considered

- **Store angels, DME and push time, and validate them.** Rejected: §9.12 rule 1, and D16 is
  exactly this. A stored DME can drift from the index. A derived one cannot.
- **Close the stack automatically on removal or push.** Rejected (H28, and trap T4): it re-clears
  pilots silently and moves every push time.
- **Let the weather gate the Case.** Rejected: PriFly owns the Case (§4.1), and the inputs are
  unreliable (D11).
- **The marshal radial at BRC + 180, the guide's literal text.** The human chose final bearing + 180
  (H27). The two differ by the deck angle, which is why the consistency tolerance is 15°.
- **A typed BRC or final bearing.** Rejected: §9.12 rule 5 says it is computed, "as the real system
  does".
- **EEAT and bingo on the Strip, or in a new `fdr.carrier` object.** A Strip dies at launch. A new
  top-level FDR object would break ADR 0052's single military namespace (Q63).
- **One generic "transfer" button.** Forbidden by §9.12.
- **A `MILITARY_ATC_AFLOAT` class for the carrier.** Rejected: it loses STCA silently (ADR 0041).

## Consequences

- WP7A bullets 1, 2 and 5 are properties of the data. A future change cannot quietly make DME
  editable without deleting a refusal and a test.
- L17 wires a finished model. The design questions left to it are the ones named above: radar
  selector extension, `LAUNCH` eligibility, and the PAR terminal state (with L18).
- **Headings depend on two injected values** that do not exist yet: the per-theater magnetic
  variation (S-W3, built before wave 2) and the grid convergence. Until they exist, the banner
  labels its bearings `G` rather than showing a wrong magnetic value.
- `[SOURCE-DEFINED]` values are labelled in code and here: the 9° deck angle, `maxIndex` 19, Case I
  angels 2–20, the 15° radial tolerance, the ripple stopping at a gap, lane parity, approach types,
  button range 1–20, default Case III, the Case I hand-over row, the altimeter band, and the 1°
  banner step.
- **Found while building, not fixed here:** ADR 0042 calls the radar spec file `radar-specs.json`.
  It is `sensor-specs.json`. This is recorded for the errata, not edited (P4).
