# 0093: Bay descriptors carry `view`, `replacesRacks` and `capacity`; the SFA rotation is a record plus a transfer, and a frequency is assigned by filing on a Rack

**Status.** Built (the server half of lane L18). It is ADR 0075's Part B: where 0075 proposed and `docs/wip/L18.md`
specified, this records what was built and the four places it departs from the spec. 0075 is not edited (P4).

## Decisions

1. **Bay descriptor flags.** A Bay in facility-config may carry `view` (`'pattern' | 'final' | 'sfa-freqs'`), the client
   component it mounts; `replacesRacks` (needs a `view`), meaning the component is the Bay's interface and its Strip
   racks are not drawn; and `capacity`, the number of Strips the Bay holds, enforced by the server (a move, a
   transfer, a state change or a rotation into a full Bay is refused with the occupant named). `validateConfig` rejects
   an unknown key, an unknown view and a bad capacity. L17 had no flag (its Bays were found by `bayId`); the carrier's
   PriFly pattern and final Bays now carry `view` and keep their racks, RSU's and PAR's replace them. The carrier's final Bays
   are NOT given a `capacity` here: that changes L17's behaviour and is a decision for its owner.
2. **Three Positions, one capability table.** RSU, SFA and PAR are `MILITARY_ATC`. Every grant is derived from
   `INCIRLIK_CAPABILITIES` in `permission.js` (ops, createsRoles, ownsStates, requestsRunwayStatus, rotatesSfa,
   sendsSfaRotation, receivesSfaRotation), so no Position name appears in a second table. RSU originates PATTERN Strips,
   asks about a runway and never closes or opens one (H18). PAR works FINAL, SFA works ARRIVAL INBOUND.
3. **The rotation record is a store, not a field on a Strip.** `sfa-store.js` holds `{ rackId: positionId }` (which
   Position is on which pool frequency), persisted with the EFSP state, one whole delta (`efsp-sfa-delta`), every op
   audited. Authority is two-sided: the table's `rotatesSfa` is a ceiling, config's `jurisdiction` (APP) narrows it.
   Only Positions with an SFA column can be put on a frequency; one Position holds one frequency.
4. **SFA_ROTATION is a Strip op (`SfaRotation`) shaped like a carrier hand-over.** ARRIVAL at INBOUND becomes FINAL at
   ON_FINAL in place, ownership moves to PAR, trigger type `CONTROLLER_INITIATED` (the four stay four), and the flight's
   comms record is never touched (D17). It does not edit the rotation record. PAR must be manned (no covering fallback: a
   FINAL Strip at APP would sit in a Bay APP does not have); PAR's final Bay holds one Strip.
5. **A frequency is the FDR's working frequency, and the Rack is that frequency.** Filing a Strip on an SFA Rack
   (a Move or a Transfer the controller makes) writes the Rack's pool frequency to the flight, the same field the
   airspace approval writes; a system placement (a Position retaken, a covering hand-back) puts the Strip back on the
   Rack that matches its frequency. Nothing that changes a controller writes a frequency.
6. **PAR gets a second Bay, `par-missed`** (implies BOLTER_WAVEOFF), as the carrier has a Bolter Bay: "Missed approach" is
   FINAL's own state and needs a place to sit. PAR's "Landing assured" is BALL with no hand-over: FINAL's NLA gives the
   `FINAL_TO_LSO` carrier hand-over only on the CARRIER Facility.

## Alternatives considered

- **Write the frequency on the rotation transfer.** Rejected: it is D17.
- **Let the rotation record be edited by SFA or PAR.** Rejected: guide 4.7 gives APP jurisdiction over it.
- **A covering fallback for an unmanned PAR.** Rejected: see 4.
- **Mount the pattern board and FINAL panel on the carrier Bays in place of the racks.** Rejected for now: the carrier's
  hand-over buttons live on the Strips (L17); the component sits above them instead.
