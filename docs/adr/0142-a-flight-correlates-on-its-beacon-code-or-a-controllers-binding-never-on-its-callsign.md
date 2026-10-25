# 0142: A flight correlates on its beacon code or a controller's binding, never on its callsign

**Status.** Accepted (lane U-BEACON-ONLY, 2026-10-25). Ruling: decisions.md **H165** ("i dont want the autobind
feature. its enough if the controller can set the beacon code and it then correlates corectly"). **Supersedes** the
callsign rungs (3 exact, 4 fuzzy) of the correlation ladder in ADR 0046 and the PROVISIONAL state ADR 0045 gave the
record. **Amends** ADR 0059 (the synthetic block: a controller may now type a code from it into a Strip), ADR 0076
(S-L27's former-holder exclusion, which only guarded the callsign rungs, is gone with them) and H135 (unchanged for a
discrete code; a synthetic code gets the rule in 3 below).

## Context

An AI flight filed as `COLT1` and flying as DCS's `COLT11` correlated on the fuzzy callsign rung. Its Strip showed
`TRK?`, the contact's label `COLT1?`, and nothing let the controller confirm the guess. The human ruled that the
automatic callsign match goes: a controller who can enter the code is enough. FAA automation does the same thing: a
track is acquired by the discrete code an active flight was assigned (JO 7110.65BB ¶5-3-3 d, ¶5-3-4 a), or by a
controller starting the track by hand. It is never acquired by name.

There was one catch. An AI aircraft has no SRS transponder; crc-sync gives it a synthetic code from the reserved block
(`sensor-specs.json` `transponder.syntheticBlock`, 6000–6777 as shipped), and `code-allocator.js` refused that block on
a Strip. With the callsign rungs gone, an AI flight could only ever be bound by hand.

## Decision

1. **The ladder is two rungs:** an explicit binding (BindTrack, `.bind`, Bind…, flight following's start), then the
   Mode 3/A code the contact's transponder is sending, matched to the flight's assigned code. Nothing else is evidence.
   A Strip with neither is `NO TRK`. Two contacts on its code is `AMBIGUOUS_BEACON` (`TRK ×n`, bind one), as before.
   A duplicate assignment is still accepted with `DUPLICATE_IGNORED_WARNING`; the first flight in sweep order takes the
   contact and the other's NO TRK names it.
2. **A controller may enter a synthetic code.** `validateAssignment(code, flightDataId, { controllerEntered })`: the
   synthetic block is accepted when `controllerEntered` is true, which only `setBeaconAssigned` (SetBlock on the beacon
   cell) passes. The allocator still never hands one out, and an ATO's Mode 3 in the block is still refused. So: the
   controller reads the AI's code off the scope, types it into the Strip, and the Strip correlates on the beacon rung.
3. **A synthetic code does not follow a re-mint.** crc-sync gives a synthetic code back to the block when its AI unit
   leaves the picture, and may mint it to another AI aircraft. The reconciler remembers, per flight, the contact its
   synthetic code was last seen on (a beacon match, or a binding to the contact squawking it; memory only, cleared on a
   mission reload, a restart or a code change). A *different* contact on that code is not claimed: the record goes
   UNCORRELATED with the new warning kind **`CODE_REISSUED`** (`candidateTrackIds`: the new holder; detail "… is now
   squawked by a different AI aircraft — bind it, or enter its code"). Binding the new holder moves the memory to it.
   A discrete code keeps H135: any aircraft squawking an active flight's code is acquired, as the FAA does.
4. **Removed, with every reader:** the `PROVISIONAL` state (`CORRELATION_STATES` is CORRELATED / UNCORRELATED), the
   match keys `CALLSIGN_EXACT` / `CALLSIGN_FUZZY`, the warning `AMBIGUOUS_CALLSIGN`, the transition reason
   `REBOUND_ON_CALLSIGN`, the record's `confidence`, `callsignAffinity` and the callsign normaliser in
   `correlation-match.js`, the `byStem` index, the former-holder map, the presentation source `FLIGHT_DATA_PROVISIONAL`,
   the client's `trackNameSuffix` (the label `?`) and the `TRK?` badge. CA/MCI, airspace-entry, conformance and identity
   now count only CORRELATED, which is what "tracked" always meant for them. The correlation rate is `correlated /
   eligible`; the stats' `matchKeyCounts` are `{ BINDING, BEACON }`.
5. **Persisted state.** A record's state, match key and trackId were already volatile (nulled on restore). Old
   transitions keep their old reasons (history is never rewritten). The persisted shape still **accepts** a record's
   `confidence` key and `restore()` drops it, because every snapshot written before this ADR carries it on every
   record and refusing it would stop the deployed server until its Board was deleted (left to the supervisor to remove).

## Consequences

- A controller correlates an AI flight by typing its code; there is no "confirm" control to build.
- A pilot squawking the wrong code is now NO TRK (it used to survive as a provisional callsign match). The
  assigned-versus-observed pair is still shown once the controller binds the contact.
- The wire protocol stays 2: record contents are not part of the scanned surface, and 2 is already ahead of the last
  released client (`wire:record -- --bump` ran and kept it).
