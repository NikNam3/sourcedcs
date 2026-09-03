# 0015 — The 5 cross-Facility coordination primitives, and the concrete D13 Strip-replication mechanism

## Context

Guide §4.6: *"The Strip does not cross the Facility boundary... one logical Flight Data Record; N per-Facility Strip replicas; synchronised by data messages plus coordination events."* Implementing this as a Strip *move* is defect class D13. `docs/adr/0007`'s `TransferStrip` (everything built through WP4) moves ownership of *one* Strip within a Facility by mutating it in place — `board-store.js`'s `_applyTransferStrip` confirmed by inspection: same object, owner/Bay/Rack/state reassigned together, never a second Strip created. WP4A's primitives need a genuinely different mechanism.

## Decision

**Mechanism.** `docs/adr/0013` gives each Facility its own `BoardStore` instance. A coordination primitive's `PROPOSE` action mutates the SENDER's own existing Strip (ownership-gated exactly like every other op — `_dispatch`'s existing `NOT_OWNER` check already covers it, no new gate needed) and, on success, calls a new public method — `receiveCoordinationProposal(...)` — on the RECEIVING Facility's own `BoardStore` instance (reached via `rules.peerBoard(facilityId)`, a lazy accessor closing over both instances once they exist). That method mints a **brand-new Strip object** — fresh `stripId`, fresh `orderKey` — in the receiver's own `_strips` Map, landing in the receiving Position's Coordination Bay (`facility-config.js`'s `coordinationBayFor`, the Bay every Position has had, present-but-inert, since Phase 2's own header comment flagged it as "the WP4A seam"). From that point the two replicas are two rows in two separate Maps, linked only by a `coordination.peerStripId`/`peerFacilityId` pair — never a shared identity.

`ACCEPT` (dispatched against the RECEIVING replica's own `stripId`/`baseRev`, through the normal ownership-gated path) moves it out of the Coordination Bay into the Position's real `INBOUND` working Bay, sets `coordination.state: 'ACTIVE'`, applies the primitive's jurisdiction-transfer effects (below), and calls back across the peer link (`receiveCoordinationResponse`) so the SENDER's own Strip agrees the exchange is live too. `REJECT` is symmetric, leaving both sides `REJECTED` and un-relocated.

**Independent removability** (a WP4A acceptance criterion — "a cross-Facility exchange produces two Strip replicas, each independently removable") falls out of this **by construction**: `_applyDropStrip` on one `BoardStore` instance structurally cannot reach the other instance's `_strips` Map at all. No guard code exists for this because none is needed — this is the strongest argument for two instances over a shared Map with a `facilityId` filter, where independent removability would have to be actively enforced.

**Op-kind shape.** `permission.js`'s `OP_KINDS` gains 5 new entries — `HANDOFF`, `POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, `AIT` — each carrying an `action` sub-field (`PROPOSE`/`ACCEPT`/`REJECT`) rather than 15 separate op kinds. Only `APP` and `CTR` are granted these (`PERMISSIONS`), the second genuine per-Position permission asymmetry in this codebase after ADR 0008's `CreateStrip` split — deliberately, since D12 (no MRU Position may ever be offered a coordination primitive) is enforced by the same table once MRU Positions exist (`docs/adr/0020`).

**`strip.coordination` shape** (`null` unless the Strip is/was party to an exchange):
```js
{
  primitive, state,                       // 'PROPOSED'|'ACTIVE'|'REJECTED'
  peerFacilityId, peerStripId, peerPositionId,
  dataOwnerPositionRef: {facilityId, positionId},
  separationResponsibilityRef: {facilityId, positionId},
  radarIdTransferred, commsTransferred, lastForwardedEtaUtc,
  note, initiatedAt, initiatedBy, acceptedAt, acceptedBy,
}
```
Two independent refs, not one, because `POINT_OUT` is the one primitive where they split (guide rule 1: *"the initiator retains data ownership while the receiver takes separation responsibility."*). A new `coordination.js` module holds the doctrinal effect table (`COORDINATION_EFFECTS`, guide §4.6's primitive table reproduced exactly: which of `radarIdTransfers`/`commsTransfers`/`dataOwnershipMoves`/`separationResponsibilityMoves` each primitive sets on `ACCEPT`), injected into `board-store.js` as `rules.coordinationEffect` — the same "doctrine lives in its own module, injected, never known directly to board-store.js's mechanics" pattern `nla.js`/`block-map.js`/`permission.js` already establish.

**`OPERATIONAL_REQUEST` reuses the same PROPOSE/ACCEPT/REJECT replica mechanism as the other 4**, deliberately — a simplification versus the plan drafted before implementation, which described it as a structurally distinct, no-replica primitive keyed on callsign+beacon with a response delivered back to the requester's own Strip. During implementation this proved unworkable as specified: the responding controller (e.g. `CTR` responding to `APP`'s request) would need to mutate a Strip they don't own, on a Board that isn't theirs, which has no coherent addressing scheme inside the existing ownership-gated `_dispatch()` — every other op requires the acting Position to own the Strip it targets. Reusing the replica mechanism with a zeroed-out effect row (`dataOwnershipMoves: false`, `separationResponsibilityMoves: false`, `radarIdTransfers: false`, `commsTransfers: false`) is what actually enforces guide §4.6's "jurisdiction stays with requester" — nothing moves on `ACCEPT` — while keeping every one of the 5 primitives addressable through one consistent, already-gated mechanism.

**Track-degradation soft interlock** (guide rule 5): `PROPOSE` is rejected with `VALIDATION_ERROR` unless a `note` is supplied, whenever the FDR's `identity.trackDegradationFlag` (`docs/adr/0019`) is not `NONE` — the electronic stand-in for "verbal coordination occurred."

**Guide rule 6** ("cross-Facility coordination MUST key on callsign plus beacon code, never on an internal record ID") is satisfied *vacuously* here, not violated: `docs/adr/0013`'s shared-`FdrStore` simplification means there is only ever one system of record to begin with, so there is no second system's internal ID to key against by mistake. This is a direct consequence of that ADR's own scope-simplifying decision, not a separate choice made here.

## Alternatives considered

- **A `facilityId` column on a single shared `_strips` Map instead of two instances.** See `docs/adr/0013` — settled there, at the composition-root level; this ADR's mechanism assumes that decision.
- **`OPERATIONAL_REQUEST` as a genuinely separate, no-replica primitive** (the originally planned design). Rejected during implementation for the addressing-scheme reason above — see the Decision section.
- **15 separate op kinds** (`HANDOFF_PROPOSE`, `HANDOFF_ACCEPT`, ... one per primitive×action). Rejected: the wire vocabulary would balloon 3x for no behavioral gain, and `permission.js`'s per-Position grant table would need to repeat the same 3-way split 5 times instead of once.

## Consequences

- `efsp-coordination.test.mjs` checks `coordination.js`'s table byte-for-byte against guide §4.6's table — the highest transcription-error-risk artifact in this slice.
- `efsp-board-store-coordination.test.mjs` directly verifies the D13 acceptance criterion: two real `BoardStore` instances wired via `peerBoard`, a full `HANDOFF` PROPOSE→ACCEPT, then independent `DropStrip` on either side with zero effect on the other.
- `efsp-index.test.mjs` gained a restart test mirroring WP4's own "test with an actual restart" acceptance criterion: a `HANDOFF` interrupted mid-`PROPOSE` (before `ACCEPT`) resolves to a determinate state on both replicas after a simulated restart, and the exchange can still be completed afterward.
- A real production bug was found and fixed during this work: the WS broadcast/ack paths (`efsp-ws.js`) were not stamping `facilityId` onto individual Strip records the way the snapshot path already did — a client that only ever saw deltas after its first connect would have ended up with Strip records missing `facilityId` entirely, breaking any Facility-scoped filtering. Fixed in the same commit as this mechanism; regression-tested in `efsp-ws-coordination.test.mjs`.
- `docs/adr/0020` covers what this ADR deliberately does not: `TOFI`, the `TACTICAL` Facility, and D12's MRU-refusal audit (no MRU Position exists yet, so nothing to audit against).
