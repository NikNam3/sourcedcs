# 0074 — the carrier is wired in as three Roles, a CARRIER Facility and a seventh store, and its four hand-overs are one operation reached by four buttons

**Status.** Built. This is L17's record of Part B of ADR 0064, which it implements. Under decisions P4 neither
ADR is edited; where this one departs from 0064 Part B it says so (the list is "What differs from 0064").

## Decisions at a glance

1. **MARSHAL, FINAL and PATTERN are three Strip Roles** with their own states, owners, NLA tables and Block Maps,
   registered everywhere a Role is (`STATES_BY_ROLE`, `STATE_OWNERS_BY_ROLE`, `COMPUTE_BY_ROLE`, `BLOCK_MAPS`,
   `DEFAULT_INITIAL_STATE_BY_ROLE`, the traffic count). None of their states collides with another Role's (a test
   holds that; `FINAL` is an ARRIVAL state and is deliberately not reused).
2. **The CARRIER Facility has four `MILITARY_ATC` Positions** (`CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2`) with
   no coordination Bays and PriFly outside the covering chain, exactly as 0064 B1 proposed.
3. **The Case, the Marshal stack and the altimeter are a seventh store, the `CarrierStore`**, keyed by hull. A Case
   change is one delta carrying the whole hull record, and every carrier Strip re-renders from it.
4. **The four hand-overs are one operation, `_applyCarrierTransfer`**, reached by the NLA button or by the explicit
   `CarrierTransfer` op. Each records its own trigger type on the Strip and in the audit log. A drag into the Bay a
   hand-over implies is refused and names the button.
5. **Nothing derived can be typed.** Angels, DME, push time, the expected final bearing and the Case are
   `carrier-derived` Blocks: display only, and `SetBlock` on one is a `VALIDATION_ERROR` by the same route as a
   `system` Block. The Marshal's one number for a flight is its slot.
6. **FINAL has nothing writable, structurally.** Every Block of its map is `system`, `flag` or `carrier-derived`.
7. **EEAT, approach, button, bingo and low state are on the flight** (`fdr.military.carrier`) and so are on the
   recovery Strip because they were on the launch Strip.
8. **Authority is a capability table in L23's shape** (`CARRIER_CAPABILITIES`): PriFly sets the Case, the Marshal
   sequences the stack, PriFly and the Marshal enter the altimeter, and the model's own `from` list says who may
   record each hand-over.
9. **Every `INELIGIBLE_STATES` decision is forced by a test.** All carrier states are eligible for correlation,
   `LAUNCH` included.

## Context

L4 (ADR 0064) built the pure model and designed the wiring, and decisions.md ruled on what it asked: the hull is
CVN-72 `UNION` (H13, H26), the marshal radial is settable and defaults to final bearing + 180 (H27), no automatic
compression (H28), one stack (H29), no FACSFAC (H30), a validated button with no list (H31). L23 (ADR 0080) then
landed the capability-table pattern in `permission.js`, which this lane uses instead of a hand-written list.

## Decision

### Roles and Block Maps (`nla.js`, `permission.js`, `block-map.js`)

States as 0064 B2: MARSHAL `LAUNCH`, `IN_STACK`, `COMMENCED`; FINAL `ON_FINAL`, `BALL`, `BOLTER_WAVEOFF`; PATTERN
`IN_PATTERN`, `RECOVERED`; each ends in `DROPPED`. Owners: the Marshal owns `LAUNCH` and `IN_STACK`; a lane owns
`COMMENCED`, `ON_FINAL`, `BALL` and `BOLTER_WAVEOFF`; PriFly owns the pattern. The NLA tables are registered in the
same commit as the Roles (the `computeNla` fallback to the DEPARTURE table would have offered a MARSHAL Strip "Send
to Clearance"). The NLA out of `IN_STACK` reads the recovery Case and the lane the stack feeds, through two new
`ctx` functions.

The Block ids are `C`-prefixed as 0064 B3 said. Two target kinds are new: `carrier` (a field of the flight,
written by `fdr-store.js`'s `setCarrier`) and `carrier-derived` (display only).

### The CARRIER Facility (`facility-config.js`, `carrier/hull-config.js`)

As 0064 B1, plus the radar-selector extension 0064 recommended: a `{ kind: 'carrier' }` selector now takes
`radar: 'search' | 'approach'` and `hull: 'CVN-72'`, `radars.js` tags the two ship radars and carries the ship's
unit name and type, and `station-coverage.js` compares them. The bare selector still matches every ship. Hull
config ships as `config/efsp-carriers.json`, read once at startup and never written (P5).

### The CarrierStore (`carrier-store.js`)

One record per hull: `{ hullId, rev, recoveryCase, stacks: { MAIN }, shipInputs, transitions }`, with MARSA's
shape (record rev and `STALE_REV`, an audit line for refusals too, a never-throwing `apply`). The ship banner is
derived by a 1 Hz tick (`carrier-tick.js`) from the matched ship track, with the own coalition, the grid
convergence and the magnetic variation injected, and is held in memory only. Case and stack persist under
`carriers` and come back intact; a stack entry whose FDR is gone is dropped without closing up.

The wire view (`view()`) carries the record, the banner, the **derived stack** (so crc-desktop does no arithmetic),
a `display` object for every bearing (M, T or G, one implementation), the **slots** (what each slot would read if
a flight stood in it, for the drag preview) and the consistency findings. Messages: `efsp-carrier-mutation` in,
`efsp-carrier-ack` back, `efsp-carrier-delta` to everyone, and a `carriers` key in the snapshot.

### The hand-overs (`board-store.js`, `carrier/transfer-effects.js`)

`_applyCarrierTransfer` validates the model's row (`validateCarrierTransfer`: Case, sender, receiver), the Strip's
Role and state, the open-link guards, occupancy (covering Position when the receiver is unmanned), then applies the
**stack effect first** (Commence marks the flight pushed and renumbers nobody; a hand-over to PriFly removes it
leaving a vacancy) and only then the Strip (Role in place, state, owner, Bay). Nothing is half applied. The Strip
carries `carrierTransfer { kind, trigger, label, at, by, from, to }`, and the audit line carries the kind and the
trigger. A Strip leaving the recovery (`_retireStrip`) leaves the stack with a vacancy.

### Authority (`permission.js`)

`CARRIER_CAPABILITIES` (`setsCase`, `sequencesStack`, `editsShipInput`) with three one-parameter predicates and
`canRecordCarrierTransfer(pos, kind)`. `CarrierTransfer` is not in `OP_KINDS`; the dispatch asks the predicate.
Every CV Position's grant is a literal over `NON_CREATE_OPS`, which already excludes coordination, TOFI,
`ConvertToArrival` and airspace entry, so "the carrier does not talk to the centre" is by construction.

### The client

A banner over the Position tabs (ship state, Case selector for PriFly, read-only Case elsewhere, the advisory when
non-null, the altimeter input), the **slot board** at the top of the Marshal stack Bay (vacancies as empty slots
with the server's preview, Close up on a gap, Charlie time and marshal radial, a Case I altitude list with no push
column; dragging a row to a slot is one `Move`), the NLA button labelled and styled by its hand-over with "See you"
as the second button in Case II, FINAL with no inputs, and the final-bearing line on the map, drawn only from a
tracked ship on a TRUE bearing.

## What differs from 0064 Part B

- **An explicit `CarrierTransfer` op exists beside the NLA.** 0064 had the NLA only; the op gives "See you" (which
  is not the NLA) and the audit tag one implementation to share.
- **FINAL's identity Blocks are `carrier-derived`, and Block 5 is off the map**, so nothing is writable by
  construction rather than by a test over an `fdr`-routed map.
- **A drag into a hand-over's implied Bay is refused** (with the button's name). 0064 left the drag path
  unspecified; allowing it would move a Strip without the stack effect or the trigger tag. A bolter or waveoff is a
  drag, as 0064 said, through `alsoLegal` on the NLA result.
- **Typed values are converted on the server:** EEAT and the Charlie time as Zulu HHMM, the marshal radial as a
  magnetic bearing (decisions H15); the model only ever holds epoch ms and a true bearing.
- **A Case or stack change re-states every carrier Strip's NLA** through the NLA status monitor, because the
  Case decides the button.
- **A bound `CreateStrip` re-claims the flight's squawk.** The launch Strip's drop released it and the recovery
  Strip binds to the same flight (found by a walk: the next new flight could be given a live aircraft's code).
- **Night is derived from the mission clock and the sun's elevation at the ship** (6 degrees below the horizon,
  `[SOURCE-DEFINED]`). The advisory therefore speaks only at night: the ship's ceiling and visibility are not
  sourced (0064 B8).
- **LAUNCH is correlation-eligible.** Correlation matches the FDR against the track store, not against what a
  ship radar has illuminated, so `noGroundAircraft` does not hide a jet on deck.
- **The traffic count counts a carrier flight once**: a launch (MARSHAL at `LAUNCH`), a trap (FINAL at `BALL`) or a
  recovered pattern flight (PATTERN at `RECOVERED`).

## Alternatives considered

- **Only the NLA, no op** (0064): no home for "See you" and two implementations the moment a second entry exists.
- **A stack Bay re-ordered by the generic Strip drag.** The Strip drag needs the Strip and the target in view at
  once, and a Bay with a board above it does not fit a small panel. The board's rows are the drag; the Strip's own
  drag onto a slot is kept.
- **Client-side preview arithmetic** for a drag: rejected, it is the one-implementation rule again. The server
  sends the slot previews.
- **A weather source for the Case advisory** now: out of scope (0064 B8).

## Consequences

- WP7A's bullets 1 to 6 hold at the wire and in the UI; 3's "at once" is one delta.
- L18 builds RSU, SFA and PAR on `PATTERN` and `FINAL`. PAR's terminal event is its call (a PAR state or `BALL`
  under a neutral label); the Block Map for FINAL has no writable Block either way.
- A controller holding only CV_MARSHAL sees lane-owned Strips on no panel of theirs; they are reached through the
  lane Positions' tabs, as any Position's Strips are.
- The covering chain ends at the Marshal, who then holds approach Strips it cannot advance (`canActOnState`); they
  go back when the lane is manned (L23's `returnCoveredStrips`). Recorded, not changed.
- The `carrier-store.js` view is sent whole on every change; at one hull and at most twenty aircraft that is small.
