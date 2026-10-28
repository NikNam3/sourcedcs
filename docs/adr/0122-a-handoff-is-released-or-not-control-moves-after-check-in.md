# 0122: A handoff is released or not; control never moves before check-in, then at once or inside the receiver's airspace

**Status.** Built (lane U-RELEASE, 2026-10-15). Rulings: decisions.md **H142** (the model), **H143**/**H144**/**H145** (the
areas), **H141 U-RQ2 c** (no withdraw; H141's U-RQ1 and U-RQ3 are void). Research: `docs/parallel/research/release-and-par.md`
R1–R5 (code locations only; its build sketch assumed the void answers). Uses **ADR 0125** (jurisdiction areas). Leaves a
seam for **ADR 0120** (the RSU). Round-2 findings **U5–U8** (`docs/parallel/live-test-2026-10-13.md` §B).

**Replaces** ADR 0101's release model (its partial scopes TURNS/CLIMB/DESCENT/FULL, climb/descent limits, condition,
`effectiveAt`, WITHDRAW, the two marks TRANSFER_COMMS/TRANSFER_CONTROL and the trigger `COMMS_AND_FULL_RELEASE`), and so
the parts of ADR 0017 and ADR 0039 that 0101 had already superseded. ADR 0101's control invariant, its retirement and
repair paths, the control-axis attestation and "ACCEPT moves radar identification and the Strip only" all stand. Those
ADRs are not edited. ADR 0101 cites "¶2-1-15 b" for when control moves; that is wrong: ¶2-1-15 **a 1**, **a 2** and **c**
are the paragraphs, below.

## Context

JO 7110.65BB (Basic 2-20-25 with Chg 3, 7-9-26), ¶2-1-15 CONTROL TRANSFER:

> a. Transfer control of an aircraft in accordance with the following conditions:
> 1. At a prescribed or coordinated location, time, fix, or altitude; or,
> 2. At the time a radar handoff and frequency change to the receiving controller have been completed and when authorized
> by a facility directive or letter of agreement which specifies the type and extent of control that is transferred.
> ...
> c. Assume control of an aircraft only after it is in your area of jurisdiction unless specifically coordinated or as
> specified by letter of agreement or a facility directive.

¶2-1-17 a: *"Transfer radio communications before an aircraft enters the receiving controller's area of jurisdiction
unless otherwise coordinated or specified by a letter of agreement or a facility directive."*

ADR 0101 modelled every step as its own button (Comms to …, Control to …, a release form with scopes, limits, a condition
and a time, Withdraw). The live test (U5–U8) found it too many steps, a receiver that could take control by hand, Request
release offered on a handoff that was already released and after control had moved (U8), and a "release complete" line
that told the controller nothing (U7). H142 replaced it with one switch and one receiver step.

## Decision

### 1. One switch on the handoff: released (default) or not released

`HANDOFF PROPOSE` takes `released: boolean` (absent: `true`). Any other value is refused; on any other primitive it is
refused. Both Strips of the exchange carry `coordination.released` from PROPOSE on. There are no partial scopes anywhere.
Released is ¶2-1-15 **a 2** (control at handoff + frequency change, the squadron's standing directive); not released is
¶2-1-15 **a 1**/**c** (control at the boundary of the receiver's area of jurisdiction).

### 2. The receiver's one step: CHECKED_IN

The handing-off station presses only Hand off: there is no "Comms to …" (the handoff tells the pilot to contact the
receiver, ¶2-1-17 a, ¶5-4-5 i). The receiver ACCEPTs, and marks `HANDOFF CHECKED_IN` when the pilot calls. Only the
receiving side may; a second one, one before ACCEPT, after REJECT or CANCEL, or toward a receiver that is not staffed is
refused. It writes `comms: { transferred: true, at, by, byPositionId, trigger: 'CHECKED_IN' }` on both Strips. It is the one
undoable HANDOFF action (10 s, H100 DR-5; label "Checked in with AP"). TRANSFER_COMMS and TRANSFER_CONTROL are now
unknown HANDOFF actions (TOFI's own TRANSFER_COMMS is unchanged).

### 3. When control moves

**Control never moves before CHECKED_IN** (it takes precedence over everything below). Then:

| Handoff | Control moves | `control.trigger` |
|---|---|---|
| released | in the CHECKED_IN op itself, one audit entry | `CHECKED_IN` |
| not released | when the aircraft is **inside the receiving Position's airspace** (the control tick, §4) | `IN_AIRSPACE` (+ `airspaceId`, null for CENTER's fallback) |
| not released, release then granted | at the grant if already checked in (inside the GRANT entry), else at check-in | `RELEASED` / `CHECKED_IN` |

The receiver **never takes control by hand** (there is no action for it). The safety nets of ADR 0101 (a retired
transferring Strip, a repair) still move control without a check-in: they exist because nobody else holds it.
`controlPatch` stays the one place control and `separationResponsibilityRef` move together, and the control invariant is
asserted after every path.

### 4. The control tick

`efsp.settleHandoffControl()` runs once a second (ticker `handoff-control`, `src/app/tickers.js`). For every transferring
Strip whose not-released HANDOFF is ACTIVE, checked in and still with the transferring side (`BoardStore#boundaryCandidates`),
it locates the flight's **correlated** contact (`locateTrack`, the same indicated feet the airspace-entry alert and the TOFI
regime use: `indicatedAltFt` of the DCS metres) and asks ADR 0125's `isInsideJurisdictionOf(receivingPositionId, where)`.
Yes: `BoardStore#settleAtBoundary` moves control (a system write, `by: 'system'`, a `HandoffControlInAirspace` system
entry on the transferring Board and the usual mirror on the receiving one), persists, and sends a board-delta per Facility
through `WsHub#deliverEfsp`. **Control never moves on a null answer**: no correlated contact, no position, an altitude that
cannot be judged, Class G (nobody's). Such a handoff waits, and the receiver sees NOT RELEASED and CTRL with the
transferring Position; nothing else is raised (H142 §8). A receiver that is not live and covered, or a guard (§6) that says
no, moves nothing; the tick asks again next second. A tick's move is a system change, so it blocks an open undo of the
check-in (UNDO_BLOCKED), like any repair.

The receiver's airspace is its Position's area (H143, ADR 0125): LC and GC the tower's (LTAG CTR control zone), AP and
PAR RAPCON's, carrier Positions the carrier circle while the hull is found, CTR the fallback (everything nobody else owns
and is not Class G).

### 5. Request release, only on a not-released handoff

`ControlRelease` keeps its name (H94, H98) and three actions:

- `REQUEST` (the receiver; optional `note`): refused on a released handoff and after control moved (**U8**), and while
  one request is open.
- `GRANT` (the handing-off station; no fields): answers the open request and sets `released: true` on both Strips;
  control moves now if the aircraft is checked in (trigger `RELEASED`), else at check-in. All or nothing.
- `REFUSE` (the handing-off station; optional `reason`): answers it; the handoff stays not released.

There is **no WITHDRAW** (H141 U-RQ2 c): after a grant, the way back is a handoff the other way once control has moved
(¶8-2-2 a). Grant and refuse need an open request. None of the three is undoable. The Marshal may REQUEST, as before.

### 6. The handoff guards (the seam ADR 0120 asked for)

`src/efsp/handoff-guards.js` holds `HANDOFF_GUARDS`, **empty today**. Each guard is
`({ phase, strip, flightData, receivingFacilityId, receivingPositionId }) => null | { reason, detail }`, keyed on the
**receiving** Position, and runs twice for a HANDOFF:

- `phase: 'OFFER'` at PROPOSE (`strip` is the transferring one): a refusal refuses the PROPOSE with that reason.
- `phase: 'CONTROL'` wherever control would move to the receiver: CHECKED_IN of a released handoff, a GRANT on a
  checked-in aircraft (each refused whole, nothing written), and the control tick (moves nothing, asks again).

The RSU lane adds ADR 0120's `IFR_NOT_CANCELLED` here (its reason code goes into `refusal-codes.js` then). Retirement and
repair paths do not ask the guards: they move control because nobody else can hold it.

### 7. Attention, dark cockpit (U7)

Nothing is shown once control has moved: no "release complete". COMMS and CTRL chips stay grey (H138 U3). Until control
moves the receiver's Strip shows **RELEASED** or **NOT RELEASED** in the same grey; the handing-off station's Strip shows
neither. Attention (amber) only for what needs a controller:

- an offered handoff to answer (unchanged);
- **NOT_CHECKED_IN**: the receiver's Strip, an accepted handoff not checked in after `alerting.json`
  `handoff.notCheckedInSec` (60 s, ours; `state/alerting.json` overrides);
- **IN_AIRSPACE_NOT_CHECKED_IN**: both Strips, a not-released handoff whose aircraft is already inside the receiver's
  airspace but is not checked in (control cannot move);
- a release request: amber on the handing-off station's Strip while open (it must answer), grey on the receiver's;
  a refused request amber on the receiver's Strip while the handoff stays not released;
- control repair (ADR 0101's CONTROL_UNCOVERED / CONTROL_REPAIRED, unchanged).

### 8. Unchanged

TOFI (ADR 0053/0102) and tactical handoffs, POINT_OUT, AIT and the other primitives. The control-axis attestation of ADR
0101 stays for every heading or altitude written before control moves, from either side; with no partial release left,
nothing short of control waives it. Intrafacility moves (TransferStrip, NLA, AP→LC, AP→PAR) keep ADR 0101's "control
follows the owner inside a Facility": no HANDOFF record, so no switch and no check-in (see "Not done").

## The record (both Strips)

```
coordination.released:       boolean                       the switch (§1); true after a GRANT
coordination.comms:          { transferred, at, by, byPositionId, trigger? }    trigger CHECKED_IN, or a retirement/repair
coordination.control:        { holder: 'TRANSFERRING'|'RECEIVING', at, by, trigger, airspaceId? }
coordination.releaseRequest: null | { note, requestedAt, requestedBy, requestedByPositionId, answer: null|'GRANTED'|'REFUSED', answeredAt, answeredBy, reason }
coordination.repair:         as ADR 0101
```

`coordination.release` is gone. A Board snapshot that still holds it is an unknown persisted shape and stops start-up
(`checkPersistedShape`, ADR 0095): no migration (P5).

## Wire

The op and action kinds are not in the wire-surface scan; the record changed inside a Strip, so `npm run wire:record --
--bump` was run: `WIRE_PROTOCOL` stays 2 (already ahead of the last release, 1).

## Consequences

- One click for the receiver in the common case; nothing for the handing-off station after Hand off.
- The server judges the boundary from the correlated contact. An uncorrelated flight on a not-released handoff never gets
  control moved by the tick; the receiver can ask for a release, which the handing-off station grants.
- Freeze goldens changed by the record's shape (hash only) and by the soak driver, which now checks in and requests and
  grants a release (it never refuses: a refusal mix blurred the selfcheck's leak detector, `docs/wip/U-RELEASE.md`).

## Not done

- H143's "AP→LC not released moves control on entering the tower area" and "AP→PAR at check-in": inside one Facility a
  handoff is a TransferStrip with no HANDOFF record, and LC/PAR take no HANDOFF, so there is nothing to switch or check in.
  Giving intrafacility transfers the released/check-in model is a decision for the supervisor (`docs/wip/U-RELEASE.md`).
  The tick's area question already answers per receiving Position, so it would apply unchanged.
- ControlRelease ops are not in the freeze hub op matrix.
