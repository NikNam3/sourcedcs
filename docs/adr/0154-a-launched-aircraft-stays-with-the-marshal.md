# 0154: A launched aircraft stays with the Marshal until the Marshal drops it

**Status.** Built (2026-11-07). Amends, without editing (P4): ADR 0064 and 0074 (a launch Strip's "Launched" was a drop).
Keeps ADR 0064's "the carrier does not talk to the centre" and ADR 0101 DR-3 (the Marshal receives a HANDOFF and proposes
none) as they are, on the human's ruling of 2026-11-07.

## Context

"Launched" on a MARSHAL Strip at LAUNCH dropped the Strip. The aircraft was airborne, under the ship's departure control,
and nothing on the Board showed it any more: the Marshal lost the flight the moment it left the deck. The human asked for
the launched aircraft to stay with the Marshal, and ruled against an outbound handoff: the Marshal does not hand it off,
the next controller (CTR, a GCI) creates their own Strip.

## Decision

1. A new MARSHAL state, **`LAUNCHED`** (the name collides with no other strip type's state, ADR 0074's rule), owned by
   `CV_MARSHAL`. The NLA at `LAUNCH` is **Launched** → `LAUNCHED`; the NLA at `LAUNCHED` is **Drop** → `DROPPED`.
2. A new Bay at CV_MARSHAL, `cv-marshal-airborne`, `impliesState: LAUNCHED` (`config/efsp-facility-carrier.json`). A
   `state/` copy of the carrier facility file without it keeps working: with no Bay implying `LAUNCHED`, the Strip stays
   in the departures Bay (`Placement#relocateForImpliedState` moves only to a Bay that implies the new state).
3. No coordination: the Marshal's grants are unchanged. The aircraft reaches the next controller by that controller's
   own CreateStrip.
4. The launch still counts once (traffic count): `countablePreDropStates` and `classifyLocality` read `LAUNCHED` as a
   launch. It is correlation-eligible and expects nothing of the surveillance hints, as `LAUNCH` is.
5. The MARSHAL board leaves out every launch Strip (`LAUNCH` or `LAUNCHED`): it is not the flight's recovery.

## Consequences

- The duplicate-origination check is unchanged: a recovery Strip bound to the same flight is refused while its launch
  Strip is still at `LAUNCHED`. The Marshal drops the launch first. A recovery typed by callsign is a new flight anyway.
- The airborne launch keeps the flight's squawk until it is dropped, which is what the aircraft is squawking.
