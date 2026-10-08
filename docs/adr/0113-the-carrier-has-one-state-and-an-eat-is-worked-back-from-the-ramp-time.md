# 0113: The carrier has one state, each value with its source, and an EAT is worked back from the ramp time

**Status.** Built (lane CARRIER-STATE, 2026-10-08). Rulings: decisions.md **H118** (Charlie and EAT follow CV NATOPS; the
EAT = Charlie + slot of ADR 0064 is replaced) and **H119** (a carrier management panel sets or overrides BRC, final bearing,
Case, the Charlie / ramp time, the marshal position, weather and the recovery tanker; PriFly and the Marshal edit it, the other
carrier Positions read it). **Replaces** the arithmetic of ADR 0064 §"push time = Charlie + stack index" and its three
separate input paths (`SetCase`, `SetShipInput`, the stack ops `SetCharlieTime` and `SetMarshalRadial`). Does not touch ADR
0064's other decisions (angels = 6 + slot, DME = angels + 15, one `MAIN` stack, a gap stays a gap). Vocabulary is the
glossary's: Position, staffed, Mutation.

## Context

Before this ADR the carrier's values were set in four places by four different people through four different ops: the Case
by PriFly (`SetCase`), the altimeter on the ship banner by PriFly or the Marshal (`SetShipInput`), the Charlie time and the
marshal radial on the **stack** by the Marshal (`SetCharlieTime`, `SetMarshalRadial`). BRC and the final bearing could not be
typed at all (ADR 0064 §9.12 rule 5: "final bearing is computed from ship heading"), and nothing held the weather at the ship
or the recovery tanker. A controller who disagrees with DCS (a ship that turns for wind but is still reported on its old
heading, a ceiling the squadron decided on) had no way to say so.

And the EAT was ours: ADR 0064 derived `pushTime = Charlie + stackIndex minutes`, the first aircraft pushing **at** Charlie.
CV NATOPS says otherwise.

## What CV NATOPS says (the part we copy)

NAVAIR 00-80T-105 (CV NATOPS Manual, July 2009, ORIGINAL), read 2026-10-08 at
`https://info.publicintelligence.net/CV-NATOPS-JUL09.pdf`. Quoted as printed.

**Glossary.**

- "**ramp time (ready deck).** Anticipated time specified by PriFly that the deck will be ready to recover aircraft and the
  first aircraft of a Case III recovery is expected to be at the ramp."
- "**expected approach time (EAT).** The future time at which an aircraft is cleared to depart inbound or penetrate from a
  preassigned fix. Aircraft depart and commence approach at assigned time if no further instructions are received."
- "**CHARLIE.** Signal for aircraft to land aboard the ship. A number suffix indicates time delay before landing."
- "**base recovery course (BRC).** The ship's magnetic heading during flight operations."
- "**final bearing.** The magnetic bearing assigned by CATCC for final approach. It is an extension of the landing area
  centerline."
- "**platform.** A point of 5,000 feet altitude in the approach pattern at which all jet and turboprop aircraft will decrease
  their rate of descent to not more than 2,000 feet per minute, continuing letdown to the 10-nm DME fix."
- "**six nautical miles DME fix.** A checkpoint in a CCA located on the final bearing 6 miles from the carrier through which
  all jet and turboprop aircraft will pass in level flight at an altitude of 1,200 feet in landing configuration."

**6.4.1.1 Marshal Procedures (p. 6-6).** "The primary TACAN marshal fix is the 180° radial relative to the expected final bearing
at a distance of 1 mile for every 1,000 feet of altitude plus 15 miles (angels +15). The holding pattern is a left-hand,
6-minute racetrack pattern. The inbound leg shall pass over the holding fix. In no case will the base altitude be lower than
6,000 feet." (Base altitude 6,000 ft: angels 6, 21 DME.)

**6.4.4 Departing Marshal (p. 6-8).** "Each pilot shall adjust his holding pattern to depart marshal at the assigned EAT."

**6.4.5 Initial Separation (p. 6-8).** "Unless weather or operating circumstances dictate otherwise, aircraft departing marshal
will normally be separated by 1 minute."

**6.4.7.2 Penetration/Approach (p. 6-9).** "Jet/turboprop aircraft shall descend at 250 KIAS and 4,000 feet per minute until
platform is reached, at which point the descent shall be shallowed to 2,000 feet per minute. Unless otherwise directed,
aircraft shall commence transition to a landing configuration at the 8-nm fix."

**6.4.2 Marshal Instructions (p. 6-7).** Marshal control shall have given each aircraft: Case recovery, type approach, expected
final bearing, altimeter, marshal holding instructions, expected approach time, ... and 6.2 (Case I) adds "Expected 'Charlie'
time (if other than briefed)". The air officer provides CATCC "the break time for Case II recoveries or ramp time for Case III
recoveries" (p. 6-21).

**6.4.9 Delta Procedures (p. 6-17).** Out of scope here (MARSHAL-BOARD, ADR 0114); quoted there.

**6.10.3 Recovery Tanking Pattern (p. 6-39).** "After the receiver is engaged, the tanker aircraft shall establish a racetrack
pattern in the vicinity of the ship. Unless special circumstances exist, the tanker should not proceed more than 10 miles ahead
of the ship. The downwind leg should be 3 to 5 miles abeam and tanking should be completed prior to reaching a point 6 miles
astern to allow for proper pattern entry."

## Decision

### 1. One state per hull; every value has a source and an optional override

The carrier store holds, per hull, an `overrides` map (the only thing a controller's typing is kept in) beside the Case record
and the stack. A view resolves each value to `{ value, source, override, default }`:

| `source` | meaning | values |
|---|---|---|
| `dcs` | read from the game | BRC (the ship's heading), wind over deck (DCS wind at the ship, plus ship speed), altimeter (the theater pressure) |
| `default` | worked out from other values, or a shipped default | final bearing (BRC less the angled deck, from the hull config), marshal radial (final bearing + 180, decisions H27), first fix (21 DME), the Case (III), the tanker's altitude (6,000 ft) and pattern side (port), on station (no) |
| `override` | a controller typed it | any of them |
| `none` | no automatic value and nobody typed one | ramp time, ceiling, visibility, the tanker's side number and give |

**Ceiling and visibility have no DCS source**: DCS-gRPC's atmosphere service gives wind, temperature and pressure and nothing
else (`protos/dcs/atmosphere/v0/atmosphere.proto`). They are `none` until somebody types them. (The Case advisory, ADR 0064
B8, now reads them: it speaks when the Case set is less restrictive than the weather floor, and still never blocks.)

The ship's own state (`ShipState`, the banner) stays what the **game** says; it no longer takes an altimeter input. Everything a
consumer reads (the banner text, the final-bearing line on the map, the Strips' derived Blocks, the stack's derivation) reads the
**value in force** from the resolved state, so an override reaches all of them at once.

Typing sets the override; **"Use DCS" / "Use default" is `value: null`**, which removes it. The DCS value keeps moving under an
override (a turn changes `default`, not what a controller typed) and the view carries both. Clearing a field that has no override
is a no-op that burns no revision. The Case is the one value with its own record (`recoveryCase`, whose history is the audit of
who set it); clearing it puts III back and counts as nobody's setting.

### 2. One op: `SetCarrierState { field, value }`

Replaces `SetCase`, `SetShipInput`, `SetCharlieTime` and `SetMarshalRadial`. The fields are `case`, `brc`, `finalBearing`,
`radial`, `rampTime`, `firstFix`, `ceiling`, `visibility`, `windOverDeck`, `altimeter`, `tankerSide`, `tankerAltitude`,
`tankerGive`, `tankerPatternSide`, `tankerOnStation`. **A bearing is typed magnetic** (decisions H15) and converted here, once,
with the magnetic variation at the ship; with no ship there is no variation and the op is refused saying so. The ramp time is a
Zulu HHMM put on the mission clock's day (ADR 0079). Numbers are bounded and rounded (`carrier/carrier-state.js`; the bounds are
sanity limits, ours). Every change is an audited Mutation (the audit line names the field; a refusal is audited too). Authority
is a new capability, `editsCarrierState`, held by **CV_PRIFLY and CV_MARSHAL**; CV_APP1 and CV_APP2 and every other Position
read. (The Case was PriFly's alone; H119 gives the panel to both.) Stack ops stay the Marshal's (`sequencesStack`).

Two editors at once: ops are per field, so a PriFly change of one value and a Marshal change of another both land; the same
field written twice is last-writer-wins, both audited. The client sends no base revision for a state op; one sent that is stale is
refused `STALE_REV` as for every carrier op.

### 3. The stack no longer holds a time or a radial

`charlieTimeUtc` and `marshalRadialDeg` leave the stack record (`STACK_KEYS`), so a ramp-time change moves nothing in the stack and
re-clears nobody; every Marshal-stack derivation reads the resolved values instead.

### 4. EAT and Charlie, per NATOPS (replaces ADR 0064's EAT = Charlie + slot)

The **ramp time** is the Charlie time as NATOPS defines it: when the first aircraft of the recovery is expected at the ramp.
Slot *N* is expected at the ramp `N × pushSpacing` after it (one minute, 6.4.5). An EAT is when an aircraft leaves its fix
inbound (glossary, 6.4.4), so it is **worked back**:

```
rampEta(N)  = rampTime + N × pushSpacing
EAT(N)      = rampEta(N) − fixToRamp
```

and `pushTimeUtc` on the derived entry is that EAT (the wire name is unchanged); `rampEtaUtc` is new beside it. With no ramp time
there is no EAT, and none is invented. Case I has neither (ADR 0064, §9.12 rule 3).

**`fixToRamp` is a tuning value, `fixToRampSec` in `config/efsp-carrier-recovery.json`, 360 s (6 minutes). It is ours, not
NATOPS's.** It stands for the profile 6.4.7.2 gives: from the first fix (21 DME) 250 KIAS and 4,000 fpm to the platform (5,000 ft,
20 DME, 1 nm and ~15 s at 250 kt), 2,000 fpm to the 10 DME fix, level at 1,200 ft through the 6 DME gate, configuration at 8 nm.
21 DME down to the 8 DME fix at 250 kt is 13 nm in 3.1 min; the last 8 nm at an assumed average of 150 kt (approach speed is ours,
NATOPS gives none for the whole of it; it varies by type) is 3.2 min: 6.3 min, taken as 6. One value for every slot: the slots'
fixes differ by a mile each, which is a quarter of a minute at 250 kt and under the spacing's own tolerance (the 10 s push window
is unchanged). The same file holds `firstFixDme` (21), `pushSpacingSec` (60) and the tanker's default altitude and side. It is a
tuning file: shipped in `config/`, a copy in `state/` overrides it key by key, an unknown key stops start-up, read at start-up,
never written by code.

**The first fix is overridable**: slot 0 holds at `firstFix` DME, each slot above it is one mile and 1,000 ft higher, so
`marshalDme = firstFix + slot` and the §9.12 consistency check compares `DME − angels` with `firstFix − 6`. Angels stay 6 + slot.

### 5. Weather at the ship and the wind over deck

The wind is asked of DCS at the ship's position, once a minute at most (`app/ship-wind.js`, the same call as the airports' weather,
at 20 m, a flight deck's height), kept in memory, never stored. Wind over deck is the air's velocity relative to the deck:
the wind vector less the ship's vector, rounded to whole knots, so a wind dead ahead is the wind **plus** the ship's speed, and
a crosswind of 15 kt on a ship making 20 is 25. A lost track keeps the last wind, as the banner keeps its last values.

### 6. The recovery tanker

Side number, altitude, give (k lb), pattern side (port or starboard) and on station are state like the rest; **no pattern is
drawn here** (CARRIER-MAP, which draws the racetrack only while the tanker is on station). The pattern's size follows 6.10.3
(downwind 3 to 5 nm abeam, not more than 10 nm ahead, finished 6 nm astern); the altitude default (6,000 ft) and a port pattern
are ours, labelled so in the panel.

### 7. What was removed

`SetCase`, `SetShipInput`, `SetCharlieTime`, `SetMarshalRadial`, `applyShipStateInput` and its `inputs` argument of
`buildShipState`, the stack's two keys, the banner's Case selector and altimeter input, the stack board's Charlie and radial inputs
(the board shows `RAMP` and `RADIAL` read-only), and the capabilities `setsCase` and `editsShipInput`. **No migration**
(decisions H88): a Board snapshot with a `shipInputs` key or a stack with `charlieTimeUtc` stops start-up naming the key; delete
`state/efsp-board.json` and `state/efsp-mutations.jsonl` to start clean. `WIRE_PROTOCOL` is unchanged by this lane: the hull
view's shape changed, but protocol 2 is already ahead of the last release (1), so they ship together.

## Consequences

- One place to read what the ship is doing, and every Position sees the same values, with the reason for each.
- The carrier management panel (crc-desktop, `panels/efsp/carrier-management-panel.js`) is a client of the resolved state and
  holds none of it; the carrier map and the recovery board read `view.state` and add no state of their own.
- **Not built here** (later lanes; seams in `docs/wip/CARRIER-STATE.md`): the recovery board and its `pushedAt`, Delta and Back to
  stack (ADR 0114); the carrier map and its tanker and bolter patterns; a per-controller settings tab (this panel has none).
- Open, ours: `fixToRampSec` wants a squadron measurement; the approach speed under it is an assumption.
