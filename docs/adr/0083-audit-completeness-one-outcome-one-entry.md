# 0083 — Audit completeness: one Mutation outcome, one log entry, naming its Facility and FDR

## Context

The Mutation log (`state/efsp-mutations.jsonl`, ADR 0065) is the squadron's audit trail and the
traffic count's source. L5 and L6 found four gaps (decision S-L5, L6's F12):

1. an airspace entry had no `clientMutationId`, because `efsp-ws.js` never handed it to the store;
2. some refusals were never logged: airspace `NOT_FOUND`/`STALE_REV`, and refusals `efsp-ws.js`
   makes before a store is consulted (class `PERMISSION_DENIED`, "no store"), which the tap could
   only catch by guessing from the reason code;
3. peer replica writes were unlogged: a coordination or TOFI exchange changes the receiving
   Facility's Board from inside the sender's Mutation, and left no line;
4. entries carried no `facilityId` and, on a Board entry, no FDR, so the traffic count looked the
   Facility up on a Board that archiving (ADR 0082) may no longer hold the Strip on.

Later decisions added: `SetBlock` entries must name the Block and value (S-L12, S-L13), a scramble
cancelled on the ground is the Strip's ordinary operation (S-L13), L23's new log strings must be
classified (S-L23), and the field state must carry the configured acknowledgers and inspection
authority on the wire (S-L1b).

## Decision

### One outcome, one entry, by one rule

**A store logs what reaches it. The metrics tap logs what does not.**

- `AirspaceStore.apply` logs its `NOT_FOUND` and `STALE_REV` returns, like correlation and MARSA.
- A refusal that `efsp-ws.js` returns before a store is consulted (no store, `NOT_HOLDING_POSITION`
  on every path, the class `PERMISSION_DENIED` of correlation and MARSA, an unknown `facilityId`)
  carries **`unaudited: true`**, a sibling of `ack` that never reaches the wire (ws-hub sends
  `result.ack` and `.broadcast` only). The tap's condition is
  `!ok && (msg.type === 'efsp-mutation' || result.unaudited === true)`; it replaces the old guess
  by reason (`NOT_HOLDING_POSITION`). `efsp-mutation` refusals stay tap-logged because `BoardStore`
  logs successes only (ADR 0065).
- A cached replay (ADR 0081) is answered before the store, is not `unaudited`, and writes nothing.

This changes ADR 0065's "which refusals are logged, and by whom" and the airspace store's comment
that it did not log its early returns.

### Peer entries and `causedBy`

Each `receive…` method on a Board writes one entry for the change it makes there:
`PeerCoordinationProposal`, `PeerCoordinationResponse` (`action` = ACCEPT/REJECT/STAND_BY),
`PeerCoordinationCancel`, `PeerTofiProposal`, `PeerTofiExitProposal`, `PeerTofiResponse`
(`action` = ACCEPT/REJECT/TRANSFER_COMMS), with `source: 'peer'`, `facilityId` (the Board's own),
`fromFacilityId`, `fdrId`, `before`/`after`.

- **`clientMutationId` is `null`** and **`causedBy`** is the sender's `clientMutationId`, taken from
  `BoardStore._activeCmid`, which `applyMutation` sets around `_dispatch`. No reader mistakes a peer
  line for a second application of the sender's Mutation, so "one cmid, one application" holds.
- `SystemCoordinationEnd` (peer replica retired) carries `causedBy` too.
- A peer entry is never a drop transition (`isDropTransition` rejects `source: 'peer'`): a replica
  retired by a cancelled proposal is an artifact, not traffic.

### Every entry names its Facility and FDR

| Writer | `facilityId` | FDR |
|---|---|---|
| Board entries, `SystemReassign` (both reasons), `SystemCoordinationEnd`, peer entries | the Board's Facility | `fdrId` |
| airspace | the airspace's `controllingFacilityId`, or `null` when unknown | none |
| correlation | `null` (theater-wide, ADR 0013) | `fdrId` |
| MARSA | `null` | `fdrIds`: the relation's participants, or the op's own on a refusal |
| field state | the Facility, beside the existing `fieldStateFacilityId` | none |
| tap (wire) entries | as before | `fdrId` when the message names one |

`traffic-count.js` `_buildRecord` uses `entry.facilityId` and falls back to looking the Strip up, so
a backfilled drop of an archived Strip keeps its Facility.

### Smaller classifications

- A `SetBlock` entry records `blockId` and `value`; a coordination or TOFI entry records `action`
  (so a `CANCEL` is distinguishable from a `PROPOSE`, which `op` alone never said).
- The traffic count clears the scramble latch when a `SetBlock` `14E` that is not `SCRAMBLE` is
  applied while the DEPARTURE Strip is still pre-airborne: a scramble cancelled on the ground is the
  Strip's ordinary operation. Called off after departure it was flown, and the latch stays (S-L13).
- `systemReassigned` counts `position-vacated` only. `position-retaken` hands covered Strips back
  and is not a loss of a Position; `SystemCoordinationEnd` and a coordination `CANCEL` are not
  counted by the tap (it counts no coordination attempts).
- `getFieldState()` carries `runwayChangeAcknowledgers` and `inspectionAuthorityPositionId` (S-L1b).

## Consequences

- The soak ledger reconciles airspace per message; its aggregate workaround is gone.
- Out of scope, and listed rather than logged: the reconciler's `setBeaconObserved` and MARSA regime
  writes (already logged under the causing cmid).
- Entries written before this ADR lack the new keys; readers fall back (`_facilityOf`).
