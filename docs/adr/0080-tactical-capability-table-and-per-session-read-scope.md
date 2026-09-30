# 0080 — the tactical Positions are one capability table, and a session reads only what it owns

## Context

L8 walked the two tactical working Positions that no sortie had ever exercised, AIC and JTAC, and
found seven defects (B1 to B7). Two rulings set the model they were held to:

- **H2.** TAC_C2 transfers a mission line to the AIC at check-in (ON_STATION). The AIC moves it
  between On Station and Committed and annotates it, never advances its state, and transfers it
  back to TAC_C2 to go OFF_STATION. The AIC is to get more capabilities in a future version, so it
  must be built modularly.
- **H40.** A JTAC sees only the Strips TAC_C2 has handed it, with the same transfer-in and
  transfer-back model as the AIC. Nothing else is visible to a JTAC. H59 adds that the JTAC's UI
  shows only what a JTAC knows, and lets the server filter more if that is clearer.

Against them the server did this:

- **B1.** A JTAC was granted nothing, so a line handed to it could never come back.
- **B2.** ADR 0025 says AIC "works under TAC_C2's TOFI". Nobody could answer a TOFI exit on an
  AIC-held line: AIC has no TOFI grant, and TAC_C2 is refused as a non-owner.
- **B3.** A covering reassignment, and a `TransferStrip` routed to the covering Position, moved the
  owner but not the Bay. The client builds its tabs from the Bays of the Positions it holds, so the
  line was on nobody's screen.
- **B4.** `TransferStrip` accepted a Bay that belongs to another Position.
- **B5.** A JTAC could bind a contact and declare MARSA.
- **B6.** Every session was sent every Strip on every Board. The whole read path was unconditional
  by design (`permission.js`'s JTAC comment said so).
- **B7.** ADR 0027 made `SetState` the unchecked escape hatch, so AIC could put a line into
  OFF_STATION, and leave it in a Bay that implied ON_STATION.

Two more defects from later rulings sit in the same code: an unmanned Position's Strips were routed
to a covering Position that could not advance them and were never given back (F10, from L6), and a
coordination link on the proposer's Strip outlived the only side that could answer it (U7).

## Decision

### One capability table

`permission.js` gains a static table (P5: no writer), one row per tactical Position and one column
per capability:

```js
const TACTICAL_CAPABILITIES = {
  AIC:  { handBackTo: ['TAC_C2'], tofiAnsweredBy: 'TAC_C2', readScope: 'ALL' },
  JTAC: { handBackTo: ['TAC_C2'], tofiAnsweredBy: null,     readScope: 'OWNED' },
};
```

with accessors `handBackTargetsFor`, `tofiAnswererFor` and `readScopeFor`. A Position with no row
gets the defaults (no hand-back limit, no TOFI answerer, `ALL`). The next AIC capability is a
column, not a rewrite. Nothing in `board-store.js` or `ws-hub.js` names AIC or JTAC: they read the
table through rules.

`PERMISSIONS.JTAC` is now exactly `TransferStrip`, written as a literal (never a `.filter()`, which
is the header's maximally-permissive trap). What narrows it is the table.

### B1: the hand-back

`_applyTransferStrip` refuses a `toPositionId` outside the acting Position's `handBackTo`, with
`PERMISSION_DENIED` and a detail (`JTAC may only hand a line back to TAC_C2`). The same rule now
narrows AIC's transfers (it could hand a line anywhere before). TACTICAL's covering chain gains
`JTAC: 'TAC_C2'`, so a JTAC who walks away leaves the line with TAC_C2.

### B2: the TOFI answer

The ownership gate admits one narrow exception, `permission.js`'s `mayActBesideOwner`: TOFI ACCEPT,
REJECT or TRANSFER_COMMS on a **MISSION** Strip, by the Position `tofiAnswererFor(owner)` names
(TAC_C2 for an AIC-held line). Nothing else crosses the gate. In particular TAC_C2 still cannot
write, flag, advance or transfer an AIC-held line, and GCI (which has no row) answers nothing on
it. ADR 0025's "AIC works under TAC_C2's TOFI" is now enforced as written; it is not edited.

The same predicate carries decisions.md S-L13: OPS may write Block `14E` (alert status) on a
DEPARTURE whatever its owner, until the Strip is DROPPED. That keeps H56 ("OPS owns alert status")
true at every state.

Every `NOT_OWNER` refusal now carries a `detail` naming the owner (`AIC holds this Strip`); B1 and
B2 were invisible for want of it.

### B3 and B4: the Bay follows the owner

`_bayForNewOwner(positionId, state)` gives the Bay a Strip in `state` sits in when a new owner
takes it without choosing one: the owner's Bay that implies the state; else its first Bay that
implies none; else null (the Strip keeps its Bay and the ack says so). `reassignPositionStrips`
and the routed branch of `_applyTransferStrip` use it, and take the rack from the ordinary
placement rule. `TransferStrip` refuses a Bay that is not one of `toPositionId`'s (`VALIDATION_ERROR`,
`tac-c2-tanker is not a Bay of AIC`).

### F10: a covering Position gives the Strips back

Reassignment stamps `coveredFrom` (the first Position, kept through a second hop). When that
Position is occupied again, `returnCoveredStrips` puts each Strip back into a Bay of it and audits a
`SystemReassign` with reason `position-retaken`. A Strip anyone transferred on by decision has lost
its `coveredFrom` and stays where it was sent.

### B5: no scope, no correlation, no MARSA

`canCorrelate` and `canDeclareMarsa` also refuse the `NON_ATC` class, derived from the class so a
future non-ATC Position is covered without an edit. Both stay one-parameter predicates.

### B7 and S-L24: SetState is owner-checked and retires through one path

A controller's `SetState` needs the acting Position to own the Strip's **current** state per
`STATE_OWNERS_BY_ROLE`, for every Role (decisions.md S-R2-14). This **changes ADR 0027**, which made
`SetState` the unchecked escape hatch. The check runs before L1's runway inhibit (authority before
availability). A legal `SetState` that leaves the Strip in a Bay implying another state, because its
owner has no Bay for the new one, adds an ack `warning` and moves nothing.

`SetState` to DROPPED, and a refused TOFI's minted MISSION Strip, now go through `_retireStrip`
(the S-L24 note): the same open-proposal and active-TOFI guards, the remove indicator, the beacon
release, MARSA retirement and the archive clock, instead of a bare state write.

### U7: a coordination link cannot outlive the side that could answer it

Retiring a receiver's replica ends a PROPOSED or ACTIVE link on the proposer's Strip
(`SystemCoordinationEnd`, reason `peer-dropped`, audited) and is broadcast to the proposer's
Facility. And the proposer gets a new action on every primitive, `CANCEL`: legal in any state of the
link, on the proposer's Strip only. An unanswered or refused replica is retired with it, an accepted
one loses its link, and the replica cannot cancel (it answers with ACCEPT or REJECT). D13's
criterion (each replica independently removable) holds: nothing is removed from the other Board,
only the link record on the proposer's Strip ends.

### B6: a per-session read scope (`read-scope.js`)

ADR 0059 says the wire carries only what a session's own sensors know. H40 applies the same idea to
Strips.

**Scope.** Computed on demand from what a session holds, at every Facility: `ALL` when it holds
**any** Position whose `readScope` is `ALL` (the default) or holds nothing (H58: an unassigned
session sees the whole Board, as today); otherwise `OWNED`, with the set of Positions it holds per
Facility. Union semantics: a controller holding JTAC and TAC_C2 sees what TAC_C2 sees. Nothing is
cached, so nothing goes stale.

**What `OWNED` filters (flights only, per H59/Q7).** Strips whose owner is a Position the session
holds, their FDRs, correlation records, MARSA relations with a visible participant, and the
conformance and obligation alerts of visible flights. Positions, Bays, airspaces, field state and
config are not flights and are sent as before.

| Path | Rule |
|---|---|
| connect snapshot | filtered (`snapshotFor(session)`) |
| `efsp-board-delta` (Mutation, peer, NLA sweep, set-positions re-stamp) | visible Strips stay; every other updated Strip goes into `strips.gone` (stateless); FDRs of visible Strips ride along; always sent, even empty, so `boardSeq` stays continuous |
| `efsp-correlation-delta`, `efsp-marsa-delta` | visible records; skipped when none is left |
| `efsp-alerts` | scoped as above |
| resync | **always the filtered snapshot** for an `OWNED` session (the ring replays unfiltered history; a snapshot is the other of §5.6's two answers) |
| the session's own ack | unchanged: it acted on that Strip |

A Strip that has just become visible (handed to the session) also brings its correlation record and
MARSA relations (`supplementFor`), because a record only changes with the flight and every earlier
delta of it was filtered out. A change of held set that changes the scope sends the session a fresh
snapshot: giving up TAC_C2 while keeping JTAC removes TAC_C2's Strips, taking it back fills them in.
Every EFSP send in `ws-hub.js` goes through one `_broadcastEfsp`, which sends an `ALL` session the
identical message object and stringifies once per distinct message.

## Alternatives considered

- **Only take `SetState` away from AIC.** Leaves the escape hatch for every other Position, and the
  same defect for any future capability. The per-state authority already exists and is applied to
  `InvokeNla` and the drag, so `SetState` was the one path missing it.
- **Refuse a transfer to AIC while TOFI is ACTIVE** (B2). Contradicts H2: the line is under TOFI at
  check-in.
- **A general "TAC_C2 may act on AIC's lines".** Undoes H2. The exception is TOFI, MISSION and one
  Position, all read from the table.
- **Always the new owner's coordination Bay** (B3). Puts an ON_STATION line under Tasked at TAC_C2.
- **A per-session "sent" set so `gone` names only Strips the session has seen** (Q10). Memory that
  can drift or be lost on reconnect, for an id with no flight data. Ids are opaque UUIDs.
- **Filter airspaces, field state and occupancy too** (Q7 (b)). Airspace status is what a JTAC
  coordinates against. H59 lets it be tightened later; the filter is the one place to do it.

## Consequences

- AIC's and JTAC's capabilities are one table row each. The AIC update H2 promises is a row edit.
- A JTAC-only session holds no flight it was not handed. Its panel still draws drop-only tabs for
  the other TACTICAL Positions (the Bays are config), and so does not hide that they exist.
- Cost: the per-session filter is noise at H12's scale (1 to 4 controllers, at most 20 aircraft),
  and the fast path keeps `ALL` sessions at today's cost.
- A controller holding only TAC_C2 does not see an AIC-held line on its panel (AIC's tab is
  drop-only), so it cannot press Accept on the TOFI exit there. Answering needs a controller holding
  both, who now sends the answer as TAC_C2. Surfacing AIC-held lines to TAC_C2 is a client follow-up.
- `SetState` is owner-checked for every Role. It was the unchecked escape hatch (ADR 0027).
- ADR 0004/0006 (immediate broadcast; a reconnect is a full snapshot) hold; a resync from an `OWNED`
  session is now always the snapshot.
- Older ADRs are not edited (P4). This one changes: 0025 (AIC's TOFI is now enforced as TAC_C2's),
  0027 (`SetState` owner-checked), 0013 point 4 (the covering chain gains `JTAC` to `TAC_C2`, still
  inside one Facility) and the read-path stance in `permission.js` (no longer unconditional).
