# 0034 — An airspace is an entity in a third store, not a field on the FDR and not a Strip on a Board

## Context

docs/adr/0032 deferred `RANGE` and recorded, verbatim, the design question that deferral left open:

> does an airspace entity live on the FDR, on a Board, or in a third store?

It also recorded the observation that settles it. Arguing against a hard gate on TOFI exit, 0032 wrote: *"A MOA stays hot after one flight leaves it whenever other participants remain."* That sentence is about airspace state outliving any one flight, which is exactly the property a storage decision has to respect.

The guide constrains the answer from the other side. §4.1's Position table gives `RANGE` the Class *"Using agency"*, the Primitives *"**no strip primitives** — owns airspace state"*, and the Strip Roles *"none"*. §4.1 rule 2: *"`RANGE` works no Strips. It owns airspace state — schedule, activation, release direction. Give it a Field State board."* §4.2's board table: *"Airspace board (not a strip rack) — scheduled, active, released, returned."* And §9.7's design consequence makes the category explicit — *"the field-state model (§9.7) is a peer of the Strip model, not a subsidiary of it."*

Until this slice the only artifact was `fdr.airspace.owner` (docs/adr/0018), a per-flight direction, which 0032's own consequences section described as *"a record of a decision rather than a model of the airspace."*

## Decision

**A third store.** `crc-sync/src/efsp/airspace-store.js` exports `AirspaceStore`, constructed in `index.js`'s composition root alongside `FdrStore` and the per-Facility `BoardStore`s, and reachable as `efsp.airspaceStore`.

**One store shared across every Facility**, like `FdrStore` and unlike `BoardStore`. An airspace names its controlling Facility (`controllingFacilityId`) rather than being replicated into each one, so the D13 replication question — *"the Strip does not cross the Facility boundary"* — never arises: nothing is ever handed across a boundary, and the record has exactly one home.

**Definition and state are split**, the same way a Strip's are. The static definitions live in `airspace-config.js` (docs/adr/0035); this store holds only what changes. `getAirspace(airspaceId)` merges the two on read, so callers see one object without the store owning config it does not manage.

**The four state names are the guide's own**, normatively:

```js
const AIRSPACE_STATES = ['SCHEDULED', 'ACTIVE', 'RELEASED', 'RETURNED'];
```

§4.6.4: *"Internal state names MUST use scheduled / active / released / returned; 'hot/cold' is display sugar only"* — *"'Hot' and 'cold' are not defined terms in any FAA or DoD publication reached."* Nothing in the store, the wire protocol or the panel uses "hot" or "cold".

**The record deliberately carries no second ownership-direction field**, and this is the subtle half of the decision. §4.6.4's prohibition — the one docs/adr/0018 was written to satisfy — is against a bare `released` **boolean**, because *"the word is used in both directions in the source material: released to the using agency means active, released to the controlling agency means available."* The ambiguity is a property of a two-valued flag, not of the word. Four distinctly named states resolve it by construction: `ACTIVE` and `RETURNED` say which direction was meant without a second field to disagree with. Adding an `owner` direction alongside them would create two fields that must agree about one fact, which is a different and worse defect class than the one D15 names.

`fdr.airspace.owner` (docs/adr/0018, extended by 0032) is untouched. It remains a different fact — about a *flight*, not about the airspace — and the two are still cross-checked only softly, on TOFI exit, exactly as 0032 left them.

**`LEGAL_TRANSITIONS` is a table, not a switch:**

```js
const LEGAL_TRANSITIONS = {
  SCHEDULED: ['ACTIVE', 'RETURNED'],   // RETURNED here = a schedule cancelled before it ever went active
  ACTIVE:    ['RELEASED'],
  RELEASED:  ['RETURNED'],
  RETURNED:  ['SCHEDULED'],
};
```

`RETURNED` is the initial state and is **not terminal**. An airspace is a standing entity that gets booked over and over, so `RETURNED → SCHEDULED` closes the loop; `INITIAL_STATE = 'RETURNED'` means "available, nothing booked" rather than "finished". `SCHEDULED → RETURNED` is the one non-obvious edge: a booking cancelled before it ever went active, which has to be expressible without inventing a fifth state for it.

**An append-only `transitions` history**, the same shape and for the same reason docs/adr/0032 gave `fdr.airspace.transitions`: JO 7110.65 ¶2-3-1's *"do not erase or overwrite any item"*. An after-action review has to be able to say when the block went hot and who approved it, not only where it is now. `_touch()` appends on every genuine state change; `RequestActivation` and `DenyActivation` deliberately pass `null` and append nothing, because `transitions` records where the airspace has *been*, not what was asked for — the request itself lives in `pendingRequest` and `lastDenial`.

**`apply()` mirrors `BoardStore.applyMutation`** in contract: optimistic concurrency on the record's own `rev`, never throws (a `try`/`catch` backstop converts an unexpected error into a rejection for that one op rather than a crash for every connected client), and always returns a result the caller can turn into an ack.

**Persistence covers state only** (docs/adr/0002). `snapshot()` writes the records; `_persist` in `index.js` adds them to the existing `{boards, fdr}` blob as `airspaces`. `restore()` skips any saved record whose `airspaceId` is no longer configured, and an airspace newly added to config simply starts at `RETURNED`. There is no migration in either direction, which is the same property that keeps facility configuration out of the snapshot.

## Alternatives considered

- **Put it on the FDR**, extending `fdr.airspace`. Rejected: it makes every flight carry its own private copy of a fact about the world. Two aircraft working the same MOA would hold two independent answers to "is this block active", with nothing to reconcile them, and the airspace would cease to exist the moment its last Strip was dropped — which is precisely the case 0032 identified as wrong ("a MOA stays hot after one flight leaves it").
- **A Board of Strips**, reusing `BoardStore` so the airspace board gets Bays, Racks, drag and the delta protocol for free. Rejected as directly contrary to §4.1 rule 2 and §4.2: a Board holds Strips, and `RANGE`'s Strip Roles column is "none". It would also have inherited per-Facility scoping and the D13 replication question for an entity that belongs to no one Facility.
- **A second `owner` direction field alongside the four states.** Rejected: see the Decision. It reads like compliance with D15 but actually introduces a consistency burden D15 does not ask for. The four names already carry the direction.
- **Making `RETURNED` terminal with a separate `AVAILABLE` state.** Rejected as a fifth state for something the guide names four of; "returned to the controlling agency" and "available" are the same condition described from two sides, which is the naming trap §4.6.4 is warning about in the first place.

## Consequences

- `crc-sync/tests/efsp-airspace-store.test.mjs` covers the lifecycle end to end, both authority shapes, the illegal transitions, the append-only history, `STALE_REV`, and the snapshot round trip including the dropped-from-config case. It asserts `AIRSPACE_STATES` is exactly the guide's four names, which is the regression guard against "hot"/"cold" creeping back in.
- The store is injected, not required, by `AirspaceStore`'s constructor (`constructor(airspaceConfig)`), so tests drive a fixture without touching disk — the pattern the scenario tests use.
- `forwarding-obligations.js` receives the store as `airspaceStore` and calls `isActive(airspaceId)` for the §9.11 alert (docs/adr/0037). That is currently the only consumer outside the airspace board itself, and it reads state rather than mutating it.
- A future work package that needs airspace *geometry* — for "is this track inside that block", which nothing in the repo can answer today — extends the definition in `airspace-config.js`, not this store. The state machine here is deliberately indifferent to where the airspace is.
- Nothing yet reconciles `fdr.airspace.owner` with an airspace record's state. They remain two records of related facts with one soft cross-check between them (0032). Tightening that is a real follow-up, and would want its own ADR because the honest answer may be that the per-flight direction becomes derived.
