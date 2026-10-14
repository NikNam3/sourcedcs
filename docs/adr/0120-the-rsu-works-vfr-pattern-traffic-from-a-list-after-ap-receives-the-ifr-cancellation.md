# 0120: The RSU works VFR pattern traffic from one list; AP receives the IFR cancellation, then hands the flight over

**Status.** Proposed (lane U-RSU-DESIGN, 2026-10-14), for the human's approval; the build lane **U-RSU** follows it and
must build on **ADR 0122** (U-RELEASE, H142). Decisions marked **pending the human** take the recommended answer of the
question named beside them (`docs/wip/U-RSU-DESIGN.md`, "Questions for the human"). Mockup:
`docs/mockups/rsu-panel.html`.

Rulings: decisions.md **H130** (the RSU stays, ours, modelled on AETCI 11-204; controls while active; own frequency; AP
hands over directly; home-based training traffic only; the tower has no pattern board), **H131** (rename `IN_PATTERN`;
its "columns keep the leg" is superseded), **H138** (U14: the RSU works visually and only VFR; AP cancels the IFR
clearance before handing over; the RSU's only Bay is a list with pattern / straight-in and touch-and-go / full stop /
low approach; no leg columns; U15: a pattern breakout calls APP as a new VFR aircraft), **H136** (VFR the FAA way: no
flight-rules field, a flight with no assigned altitude and heading), **H142** (handoffs released by default, control
moves only after "Checked in"), **H18** (LC alone opens and closes runways), **H128** (FAA model, always), **S-ARCH-61**
(the list shows remarks), dark cockpit (H115–H119).

**Supersedes** ADR 0075 decisions 1 and 2 for the RSU (the pattern board, its leg Racks and its advisories; PriFly's
pattern board is left to the carrier batch, U19) and decision 6's "RSU's advisory nature" (H130 (2): it controls).
ADR 0093's `view`/`replacesRacks` descriptor flags are reused, not changed.

## Context

Live test T25 (2026-10-11): AP could not hand an arrival to the RSU (an ARRIVAL at `INBOUND` may only go to
`HANDED_TO_TOWER`; the RSU's Bay implied `IN_PATTERN` on a `PATTERN` Strip), and `IN_PATTERN` names a place, not who has
the flight. Round 2 (2026-10-13, U14/U15) then fixed the model: the RSU is a visual controller of VFR training traffic
in the pattern, with one list as its whole Bay.

Real Incirlik has no RSU (H130); the squadron flies it as a pilot-training wing would. **Everything about the RSU as a
Position is ours**, modelled on AETCI 11-204 (not an FAA order). Where the FAA has a rule for a step (IFR cancellation,
touch-and-go, closed traffic, transfer of communications), it is quoted and followed below.

What the FAA says (JO 7110.65BB with Chg 1–3 and the AIM, read on faa.gov 2026-10-14):

- **JO 7110.65BB ¶4-2-10 b**, CANCELLATION OF IFR FLIGHT PLAN: *"Respond to a pilot's cancellation of his/her IFR
  flight plan as follows: PHRASEOLOGY- (Call sign) IFR CANCELLATION RECEIVED."* (¶4-2-10 a is about non-towered
  airports and does not apply.)
- **AIM 5-1-15 b**: *"An IFR flight plan may be canceled at any time the flight is operating in VFR conditions outside
  Class A airspace by pilots stating 'CANCEL MY IFR FLIGHT PLAN' to the controller ... Immediately after canceling an
  IFR flight plan, a pilot should take the necessary action to change to the appropriate air/ground frequency, VFR
  radar beacon code and VFR altitude or flight level."* **c**: *"ATC separation and information services will be
  discontinued, including radar services (where applicable)."* **e** (with an operating tower): *"the flight plan is
  automatically closed upon landing."*
- **JO 7110.65BB ¶3-10-12 d**, OVERHEAD MANEUVER: *"An aircraft conducting an overhead maneuver is VFR and the IFR
  flight plan is canceled when the aircraft reaches the 'initial point' on the initial approach portion of the
  maneuver."*
- **JO 7110.65BB ¶3-8-2**: *"Consider an aircraft cleared for touch-and-go, stop-and-go, or low approach as an arriving
  aircraft until it touches down (for touch-and-go), or makes a complete stop (for stop-and-go), or crosses the landing
  threshold (for low approach), and thereafter as a departing aircraft."*
- **JO 7110.65BB ¶3-10-11**, CLOSED TRAFFIC: *"Approve/disapprove pilot requests to remain in closed traffic for
  successive operations subject to local traffic conditions."*
- **JO 7110.65BB ¶2-1-17 a**: *"Transfer radio communications before an aircraft enters the receiving controller's area
  of jurisdiction unless otherwise coordinated ..."*; **b 1** TERMINAL: *"Omit the location name when transferring
  communications to another controller within your facility"*.
- **JO 7110.65BB TBL 2-3-1, block 18** (en route strips): *"... or symbol indicating cancellation of IFR flight plan for
  arriving aircraft"*. The FAA marks a cancellation on the strip; it has no flight-rules block (H136).

## Decision

### 1. Who the RSU is (ours, AETCI 11-204 model)

- A Position of Facility **INCIRLIK** (`RSU`, letter `R`, class `MILITARY_ATC`), as today
  (`crc-sync/config/efsp-facility-incirlik.json`).
- **Active** = signed on, or held as a hat by the Position its `consolidation` row names (`"RSU": ["LC"]`, ADR 0110).
  While the RSU is not active, AP hands pattern traffic to LC as ordinary arrivals; a flight already on the RSU's list
  when the RSU signs off goes with the hat offer like any other Position's Strips (ADR 0110), so whoever takes the hat
  works the list (pending the human, **RQ4**).
- It controls **VFR pattern traffic only** (H138), **home-based training traffic only** (H130 (5)): a handoff to the RSU
  of a flight whose home station (Block `3E`, `identity.homeStation`) names another airfield is refused; an empty home
  station passes (pending the human, **RQ3**).
- It has **its own frequency** (H130 (3)): a `positionFrequencies.RSU` entry (label `RSU`; the value is a placeholder
  until the human names one, **RQ5**). AP's handoff shows it, so AP can say "contact RSU, (frequency)" (¶2-1-17 b 1:
  no location name inside the facility).
- **LC keeps runway status authority** (H18, H130 (2)). The RSU may only request a runway status change
  (`requestsRunwayStatus: true`, unchanged). The list shows the active runway's status in its header, grey while open,
  amber when suspended or closed; nothing is refused on it (a landing is an observation, as at LC).
- The tower has **no pattern board** (H130 (7)): a tower aircraft flying circuits stays an ordinary ARRIVAL with LC.

### 2. The strip state: `HANDED_TO_RSU` on the ARRIVAL Strip (the H131 rename)

A flight with the RSU keeps **its own ARRIVAL Strip** (same flight data, code, ATO line, remarks); no conversion to
another strip type. ARRIVAL gains one state, **`HANDED_TO_RSU`**, owned by **RSU**:

`INBOUND (AP) → HANDED_TO_RSU (RSU) → TAXI_IN (GC) → DROPPED`

The name follows `HANDED_TO_TOWER` and says who has the flight (H131), not where in the pattern it is (H138: no legs).
The RSU no longer uses the **PATTERN** strip type at all:

- `incirlik-military.js`: RSU's `createsStripTypes` becomes `[]` (its traffic arrives by AP's handoff, H130 (4)) and
  its `ownsStates` becomes `{ ARRIVAL: ['HANDED_TO_RSU'] }`.
- `PATTERN` and its `IN_PATTERN` / `RECOVERED` states become **the carrier's only** (CV_PRIFLY, the Case I and Case II
  handoffs in `carrier/handoff-effects.js` and `strip-types/marshal.js`). Whether the carrier renames `IN_PATTERN` (to
  say PriFly has the flight) or drops `PATTERN` when U19 removes PriFly's pattern section is the **carrier batch's**
  call (H138: carrier fixes last; pending the human, **RQ6**). U-RSU removes `RSU` from the client's
  `PATTERN_STATE_OWNERS` (`efsp-nla.js`) and the "shared with RSU" comments, and touches nothing else carrier-side.

Every place `IN_PATTERN` reaches today, and what U-RSU does there:

| Where (verified with `command grep -rn IN_PATTERN`) | U-RSU |
|---|---|
| `crc-sync/src/efsp/authority/positions/incirlik-military.js` RSU `ownsStates` | → `{ ARRIVAL: ['HANDED_TO_RSU'] }` |
| `crc-sync/src/efsp/authority/strip-types/pattern.js` | carrier only; comments lose "shared with RSU" |
| `crc-sync/src/efsp/authority/strip-types/marshal.js`, `carrier/handoff-effects.js` | unchanged (carrier) |
| `crc-sync/src/efsp/surveillance-hints.js` `EXPECTS.ARRIVAL` | add `HANDED_TO_RSU: AIRBORNE`; `UNEXPECTING.PATTERN` unchanged |
| `crc-sync/config/efsp-facility-incirlik.json` RSU Bay `rsu-pattern` (`impliesState: IN_PATTERN`) | replaced, §4 |
| `crc-sync/config/efsp-facility-carrier.json` `cv-prifly-pattern` | unchanged (carrier, U19) |
| `crc-desktop/app/public/js/panels/efsp/efsp-nla.js` labels and `PATTERN_STATE_OWNERS` | ARRIVAL label for `HANDED_TO_RSU`; owner `RSU` dropped from PATTERN |
| `crc-desktop/app/public/js/panels/efsp/pattern-board.js` (`LONG_IN_PATTERN` advisory) | RSU stops using it; PriFly still does until U19 |
| `crc-desktop/app/public/js/panels/efsp/carrier-map-model.js` | unchanged (carrier) |

Other ARRIVAL state lists the new state must join: `strip-types/arrival.js` (`ARRIVAL_STATES`,
`ARRIVAL_STATE_OWNERS`, `computeArrivalNla`), client `efsp-nla.js` (`ARRIVAL` labels and owners, a hand copy under the
NLA parity test), `runway-status-rules.js` `RUNWAY_STATUS_RUNWAY_STRIP_STATES.ARRIVAL` (the RWY chip: the flight still
uses the runway), and the soak's `tools/soak/traffic.js` only if it drives the RSU (it does not today).
`splitEligibleStates`/`joinEligibleStates` derive from `ARRIVAL_STATES`, so a formation with the RSU can split for
individual landings (ADR 0099) with no extra row; the RSU already holds the formation op kinds.

### 3. The AP → RSU handoff: IFR cancellation received, then an ordinary H142 handoff

**Step 1, IFR cancellation (FAA: ¶4-2-10 b, AIM 5-1-15).** The pilot cancels IFR; AP answers "IFR cancellation
received" and records it with one action on the Strip, **`CancelIfr`** (a new Board op, AP or whoever holds control of
the Strip). It ends every ACTIVE assigned altitude and assigned heading entry on the flight data in one audited
Mutation (AIM 5-1-15 c: separation services end; the VFR pilot picks his own altitude), stamped with the mission clock;
Undo restores the entries. Nothing new is stored: the flight now reads as VFR the way H136 defines it (`vfr.js`
`hasNoClearance`), and the Mutation log is the record of when IFR was cancelled (pending the human, **RQ1**: a stored
cancellation mark instead).

The Strip shows it as H136 already does: ALT and HDG empty. No new chip (dark cockpit). On AP's handoff popover, when
the flight still has a clearance, the RSU target shows the cancellation as the step before Handoff (mockup, "AP side").

Our model differs from the FAA in one place, deliberately: ¶3-10-12 d cancels IFR **automatically at the initial
point** of an overhead. H138 has AP cancel **before** handing over, so the RSU only ever holds VFR flights; an overhead
then starts VFR. Recorded as ours.

**Step 2, the handoff.** An ordinary intrafacility handoff on **ADR 0122**'s model (H142): Handoff (released by
default; "not released" possible), the flight's row appears on the RSU's list as offered; the RSU accepts; the RSU marks
**Checked in** when the pilot calls on the RSU frequency; control moves then (released) or when the aircraft is inside
the RSU's airspace (not released). **The RSU's airspace is the tower area** (H143's Class D shape around the field;
pending the human, **RQ2**). The NLA on AP's `INBOUND` stays "Hand to Tower"; the RSU is a second target in the ⋯ menu
and by drag onto the RSU, as AP→PAR is.

**What the server refuses** (new `REFUSAL_CODES` entries, `refusal-codes.js`):

| Code | When |
|---|---|
| `IFR_NOT_CANCELLED` | a handoff to the RSU (offer, and again at the control move) of a flight with an ACTIVE assigned altitude or heading |
| `NOT_HOME_BASED` | a handoff to the RSU of a flight whose `identity.homeStation` names another airfield (RQ3) |
| `NOT_WITH_RSU` | `LeavePattern` or a pattern Block on a Strip that is not `HANDED_TO_RSU` |

The RSU state is reached only by that handoff: `SetState`/a drag onto the list to `HANDED_TO_RSU` from anything but an
accepted handoff is refused as today's invalid transitions are. Once the RSU has the flight, AP setting an altitude or
heading on it is refused by the ordinary ownership checks (AP no longer holds control).

### 4. The list: the RSU's only Bay

`efsp-facility-incirlik.json` RSU: one Bay **`rsu-list`**, `rackIds: ["main"]`, `impliesState: "HANDED_TO_RSU"`,
`view: "rsu-list"`, `replacesRacks: true` (ADR 0093 flags). `rsu-pattern` and its four leg Racks go. The client mounts a
new view `rsu-list` in `bay-views.js` (beside `pattern`, `final`, `sfa-freqs`), a pure model plus renderer like
`pattern-board.js`.

**One row per Strip** (a formation is one row with its count until split), ordered by check-in (then by offer).
Columns, all grey unless a problem:

| Column | Source | Set by |
|---|---|---|
| Callsign (and `2×` for a formation) | Block 1, `flightSize` | — |
| Type | Block `3A` | — |
| **PAT / STR** (pattern or straight-in) | new Block **`9J-ENTRY`**, enum `PATTERN`, `STRAIGHT_IN` | RSU (and AP before the handoff) |
| **T&G / FS / LA** (touch-and-go, full stop, low approach) | new Block **`9J-OPTION`**, enum `TOUCH_AND_GO`, `FULL_STOP`, `LOW_APPROACH` | RSU (and AP before the handoff) |
| Remarks | Block `9E`, cut at a word boundary, click opens the remarks popover (`strip-remarks.js`, H139, S-ARCH-61) | owner, as everywhere |
| Action | the one action due: **Accept**, **Checked in**, or **Landed** on a full-stop row | — |

The two Blocks are Strip-scoped choices (`target: { kind: 'pattern', field: 'entry' | 'option' }` on the Strip, an
enum validated server-side, empty allowed and shown as `–`), set by an ordinary `SetBlock` (audited, Undo, no new op
kind); a click on the cell toggles PAT/STR and cycles T&G/FS/LA. They exist on the ARRIVAL Block Map only and are
not drawn on the Strip face (`strip-fields.js` gives them no cell): the list is where they are read (dark cockpit:
only the RSU and AP before its handoff need them; AP sets them from its ⋯ menu).
Stop-and-go (¶3-8-2) is not offered (H138 lists three; **RQ7**).

Not on the list, deliberately (dark cockpit, H138): legs, the time in the pattern, the beacon code, an approach count,
the `LONG_IN_PATTERN` and "crowded final" advisories of ADR 0075. The header shows the runway in use and its status.

**Colour.** Amber: a row offered and not accepted, or accepted and not checked in, after ADR 0122's threshold; the
runway status not open (header). Red: none of its own (Conflict Alert and the airspace alerts stay on the radar display).
Blue: the one action due on a row.

**How a row leaves:**

| Event | Action on the row | Effect |
|---|---|---|
| Full stop, landed | **Landed** (the NLA on a `FULL_STOP` row; on any row from the ⋯ menu, since a pilot may land anyway) | `HANDED_TO_RSU → TAXI_IN`, transfer to GC (or GC's hat), the same path as LC's Landed → Taxi in; inhibited "no receiving Position present" as there |
| Touch-and-go or low approach, staying | none | the row stays; the RSU changes the option for the next one (¶3-10-11 closed traffic, ¶3-8-2) |
| **Pattern breakout** (U15) | ⋯ **Breakout** | new op **`LeavePattern { reason: 'BREAKOUT' }`**: retires the Strip like `DropStrip` (code released, correlation binding ended, Undo); the pilot flies the breakout, then calls APP as a new VFR aircraft and AP starts flight following the normal way (`StartFlightFollowing`, LT-VFR, H136) |
| Leaves the pattern to depart (after a low approach or touch-and-go) | ⋯ **Leaves pattern** | `LeavePattern { reason: 'DEPARTED' }`, the same retirement; the pilot calls APP like a breakout (pending the human, **RQ8**) |

`LeavePattern` is one op with a reason so the Mutation log tells a breakout (a safety event) from a planned departure;
the client shows the two words, never a reason picker. Only the RSU, holding control, on a `HANDED_TO_RSU` Strip.

### 5. Wire, freeze and `state/`

- **Wire changes.** New Board op kinds `CancelIfr` and `LeavePattern` (the op table is scanned, so
  `npm run wire:record` records them and bumps both `WIRE_PROTOCOL` copies if the last `crc-desktop-v*` tag shipped
  the current number). The new state, Blocks, Bay view and refusal codes are not scanned (ADR 0103's list): they ride
  in the same bump.
- **Freeze.** Goldens that hold the RSU's Bay, its PATTERN grants or the ARRIVAL tables move:
  `tables-permission-data`, `tables-permission-decisions`, `tables-nla-coordination-config`, `scenario-incirlik-l18`;
  re-record with `freeze:update`, separate commit, explained.
- **`state/` (the human).** `state/efsp-board.json` holding a PATTERN Strip in RSU's `rsu-pattern` Bay: drop those
  Strips before the upgrade (or delete the Board snapshot; start-up is strict, ADR 0095). A `state/` copy of
  `efsp-facility-incirlik.json` that still names `rsu-pattern` / `IN_PATTERN`: update it to §4 or delete it.

## Consequences

- AP's handoff to the RSU works (T25), on the same Strip, and the RSU holds VFR flights only.
- A flight AP had cleared for an approach with its altitude and heading entries already ended passes `IFR_NOT_CANCELLED`
  without a `CancelIfr`: the check is the FAA-shaped one (no clearance), not a memory of the radio call. Accepted;
  RQ1 is the alternative.
- A breakout or a departure from the pattern ends the Strip; the flight's next Strip is a new one from AP, so remarks
  and the ATO line do not carry over (U15 asks for "the normal way").
- PriFly's pattern board and `PATTERN`/`IN_PATTERN` live on for the carrier until the carrier batch (U19, U20).
- `pattern-board.js` loses its RSU half (`RSU_LEGS`, the RSU defaults); deleting the file is the carrier batch's.

## Alternatives considered

- **Keep the PATTERN strip type for the RSU and convert the ARRIVAL on handoff** (as AP→PAR converts to FINAL).
  Rejected: the list needs nothing PATTERN has, a conversion needs its own handoff kind, and the strip-type change would
  keep tying the RSU to the carrier's state names.
- **A stored flight-rules or "IFR cancelled" field.** Rejected by default (H136: no flight-rules field); it is RQ1's
  alternative because the FAA does mark a cancellation on an en route strip (TBL 2-3-1 block 18).
- **Hand the Strip back to AP on a breakout.** Rejected: U15 says the pilot calls APP as a new VFR aircraft.
- **Leg columns or a sequence the RSU drags.** Rejected by H138 (no legs); the RSU sees the aircraft.
