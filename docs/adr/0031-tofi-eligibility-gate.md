# 0031 — TOFI gains a (role, state) eligibility gate, mirroring the five primitives'

## Context

The five ATC↔ATC coordination primitives have been gated on the Strip's Role and State since docs/adr/0022, via `coordination.js`:

```js
const COORDINATION_ELIGIBLE_STATES = { ARRIVAL: 'INBOUND', DEPARTURE: 'HANDED_OFF' };
```

consulted server-side in `_applyCoordinationPropose` and mirrored client-side in `bay-view.js`'s `_canProposeCoordination`, with a drift guard in `tests/efsp-coordination-client.test.js`.

TOFI (docs/adr/0025) shipped with no equivalent. `_applyTofiPropose` validated the direction, the one-open-proposal rule, that the target Facility differed from its own, and that the target was a legal counterpart (`TOFI_COUNTERPARTS`) — but never what the Strip itself was doing. Client-side, `_canProposeTofiEntry` checked only that the owning Position had counterparts at all and that the Role was not `MISSION`.

So the "TOFI…" button rendered, and the mutation succeeded, on **any** Strip the acting Position owned in **any** state: an `ARRIVAL` still at `INBOUND` that had not been worked yet, an `ARRIVAL` already `HANDED_TO_TOWER` and on short final, anything. Nothing in the guide forbids this explicitly, so it was an asymmetry in rigour rather than a stated-rule violation — but it is exactly the class of gap docs/adr/0020 and 0025 warn about elsewhere: it looks correct in every demo, because a demo proposes TOFI on a Strip that happens to be in a sensible state.

The end-to-end trace surfaced it as the odd one out: every other cross-Facility affordance in the system asks "is this Strip in a state where this makes sense," and this one did not.

## Decision

**A parallel table in `coordination.js`, alongside `COORDINATION_ELIGIBLE_STATES` rather than folded into it:**

```js
const TOFI_ELIGIBLE_STATES = { DEPARTURE: 'HANDED_OFF', ARRIVAL: 'INBOUND', OVERFLIGHT: 'TRANSITING' };
```

exposed as `tofiEligibleState(role)`, wired in `index.js` as `rules.tofiEligibleState`, and checked in `_applyTofiPropose`'s ENTRY branch with a `detail` that distinguishes the two failure modes:

```js
detail: required
  ? `a ${strip.role} Strip must be at ${required} to enter tactical control, not ${strip.state}`
  : `a ${strip.role} Strip can never open a TOFI exchange`
```

The gate applies to **ENTRY only**. EXIT re-enters an existing link (`receiveTofiExitProposal`, docs/adr/0025) and its eligibility is already fully determined by that link's own state — there is no separate question to ask about the Strip.

**Why a separate table rather than reusing `COORDINATION_ELIGIBLE_STATES`.** The two differ in their Role sets, and the difference is meaningful rather than incidental:

- **`OVERFLIGHT` is included here and absent there.** docs/adr/0023 added `OVERFLIGHT` (`TRANSITING → DROPPED`, owned by `APP`/`CTR`) for a flight crossing CENTER's airspace that never touches Incirlik. It has no entry in the coordination table because it never originates a `HANDOFF` — not because it is ever on the ground. An overflight transiting CENTER's airspace is precisely the kind of traffic that gets passed to a Military Radar Unit, so excluding it would have been a real functional gap, introduced by copying a table whose omission meant something else entirely.
- **`MISSION` is excluded from both.** It is the MRU-side Role that TOFI *creates* (docs/adr/0026 — `TAC_C2`/`GCI` originate it, `receiveTofiProposal` mints it), never a Role that opens an exchange of its own. The client already refused it explicitly via `if (strip.role === 'MISSION') return false;`; its absence from this table now makes the same statement server-side, and by construction rather than by a special case.

The three states themselves are the states in which a flight is airborne and being worked by an enroute Position — the only condition under which entering tactically controlled airspace is meaningful.

**Client mirror** in `efsp-nla.js`, consulted by `_canProposeTofiEntry`:

```js
if (TOFI_ELIGIBLE_STATES[strip.role] !== strip.state) return false;
```

carrying the same "UX convenience, the server has the real gate" caveat as every other mirror in that file, and drift-guarded in `tests/efsp-coordination-client.test.js` with the established `assert.deepEqual(clientCopy, serverCopy)` template — plus a second test asserting the Role set is exactly `ARRIVAL`/`DEPARTURE`/`OVERFLIGHT` and that `MISSION` is absent, so a future edit has to confront both decisions above deliberately.

## Alternatives considered

- **Reuse `COORDINATION_ELIGIBLE_STATES` directly.** Rejected: it would silently exclude `OVERFLIGHT` for a reason that has nothing to do with TOFI, and it would couple two tables that are free to diverge — a change to which states may open a `HANDOFF` has no business changing which may open a TOFI.
- **Add an `OVERFLIGHT` entry to `COORDINATION_ELIGIBLE_STATES` and share the one table.** Rejected as the worse version of the same coupling: it changes the five primitives' behaviour (offering `HANDOFF`/`POINT_OUT`/`TRAFFIC`/`AIT` on `OVERFLIGHT` Strips) as a side effect of a TOFI fix. Whether overflights should be able to originate those primitives is a genuine question, and it deserves its own decision rather than arriving by accident.
- **Gate on the Position rather than the Strip**, relying on `TOFI_COUNTERPARTS` alone. Rejected: that table already answers "may this Position speak to that one," which is a different question from "is this flight in a state where tactical control applies." Both are needed; the counterpart check remains directly after this one.
- **No gate at all**, on the grounds the guide does not mandate one. Rejected — the guide does not mandate `COORDINATION_ELIGIBLE_STATES` either; it emerged from docs/adr/0022 as a practical consequence of which (Role, State) pairs have a Bay configured to receive them on the other side, and the same reasoning applies here.

## Consequences

- The "TOFI…" button now appears only on an airborne, enroute Strip, which is also the set of Strips for which the minted `MISSION` replica lands somewhere sensible on `TACTICAL`'s Board.
- `tests/efsp-scenarios.test.mjs` covers both sides: an `ARRIVAL` at `INBOUND` proposes successfully, and one advanced to `HANDED_TO_TOWER` is refused with `/must be at INBOUND to enter tactical control/`.
- The guard uses the optional-rule shape (`if (this._rules.tofiEligibleState)`) consistent with every other rule in `board-store.js`, so hand-built test fixtures that omit it — including the existing `tests/efsp-tofi.test.mjs` — are unaffected and continue to exercise the TOFI protocol itself without needing to satisfy this.
- A future work package adding a Role that can open a TOFI exchange (the guide's `CARRIER` Facility, say) adds one line to this table and inherits the client gate through the drift test.
