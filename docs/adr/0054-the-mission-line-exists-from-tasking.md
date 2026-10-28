# 0054 — the mission line exists from tasking: `CreateStrip` binds to an existing FDR, and TOFI reuses the mission line it finds

## Context

`TAC_C2`/`GCI` work **mission lines**, not clearance strips — guide §9.8 keys one by *mission number and package ID*, concepts that exist while the jet is still cold, and says to *"bind it to the same FDR as any tower Strip for that flight."*

`docs/adr/0026` adopted the guide's lifecycle verbatim — `TASKED → AIRBORNE → ON_STATION → OFF_STATION → RTB` — but never said how a Strip reaches `TASKED` in a way `TASKED` could mean anything. In practice it could not:

- A MISSION Strip bound to an ATC flight only ever came into existence as a byproduct of TOFI ENTRY (`receiveTofiProposal`), and `docs/adr/0031` gates ENTRY to `HANDED_OFF`/`INBOUND`/`TRANSITING` — all airborne. So the Strip was born `TASKED` when the aircraft had been flying for twenty minutes, and `TAC_C2`'s first action was pressing "Airborne" on a jet that manifestly already was.
- `TAC_C2`/`GCI` *could* originate a standalone MISSION Strip (`CREATE_ROLE_PERMISSIONS`, and `CREATE_STRIP_ORIGINS` already routes it into `tac-c2-tasked`) — but `_applyCreateStrip` calls `fdrStore.createFdr` unconditionally, so it always minted a **fresh FDR**. A different flight, with its own beacon code.

So a mission line was either *bound but too late* or *early but a different flight*. There was no third option. And WP7 needs one regardless: its acceptance criterion is *"an ATO fixture produces mission Strips with correct mission number, package, vul window, controlling agency and IFF codes"* — ATO ingest creates mission lines **before anyone files a flight plan**, with no TOFI anywhere.

## Decision

### The shared `fdrId` is the link

No link object, no join table, no `missionLineId`. Two Strips are the same flight because they carry the same `fdrId` — which is already how this codebase answers that question everywhere: TOFI replicas, the 5 ATC↔ATC coordination replicas, correlation keyed by `fdrId` (`0045`), `liveStripsForFdr` refcounting (`0028`), the client's `+N` badge.

That also makes the binding **direction-independent for free**. Which record existed first does not matter, and the actor never changes: it is always `TAC_C2` picking a flight for a mission line. Flight-first is built now; ATO-first (WP7) is the same op run later against a mission line that already exists.

### `CreateStrip` gains an optional `op.fdrId`

Mutually exclusive with `op.fdr`. A field on the existing op rather than an op of its own, because every gate above it (known Bay, valid Role, `canCreateStripRole`) and everything below it (`cid`, `orderKey`, the Strip literal) applies identically — and `docs/adr/0023`'s precedent is that ARRIVAL Strips already originate "both ways" through this one op. Keeping it **role-agnostic** is what lets WP7's reverse direction reuse it with no server change.

The ladder, placed before `createFdr` so a refused create still has no side effects:

| Check | Refusal |
|---|---|
| `op.fdr` also supplied | `VALIDATION_ERROR` — one source of identity |
| FDR exists | `NOT_FOUND`, the same code and wording `receiveTofiProposal` already uses |
| no live **same-role** Strip for this FDR **on this Board** | `VALIDATION_ERROR` naming the owner |

The last check scans `this._strips` **locally**, deliberately not `rules.liveStripsForFdr` — that one is global and role-blind, and the coordination primitives legitimately put same-role Strips for one FDR on two Boards (`0013`). Within one Board, two same-role Strips on one FDR is §3.6's duplicate origination.

Three checks were considered and **not** added: no "must have a live ATC Strip" (it would make ATO-first impossible, and a mission line whose ATC Strip was dropped must stay legal), no second TAC_C2/GCI check (`canCreateStripRole` already says that, and duplicating it would block the reverse direction), no Facility check on the bound FDR (one shared `FdrStore` — an FDR has no home Facility).

**No beacon code is minted** on the bind path, because `createFdr` never runs. The mission line shares the flight's Mode 3/A, which is guide §9.8's own *"bridge field"* — and the strongest argument for a shared `fdrId` over any copy-the-fields design.

### TOFI finds before it mints

`receiveTofiProposal` now looks for a live MISSION Strip on that `fdrId` before creating one:

- **Found, owned by the target Position** → reuse it: write the ENTRY/`PROPOSED` record and touch **nothing else**. It is sitting in a real working Bay at a real state, and both belong to the MRU controller, not to this exchange. Refused if an exchange is already open on it.
- **Found, owned by the other MRU Position** → refuse, naming the holder. Ownership is per-Position (§4.8.1). Minting a second beside it would give one airframe two MRU records with independent lifecycles.
- **Not found** → mint exactly as before, so a never-tasked flight is unaffected.

### `mintedForTofi`, and the Bay bug it closes

`_applyTofiAccept` relocates an ENTRY replica out of the Coordination Bay via `bayForImpliedState(owner, strip.state)`. That helper **falls back to `bays[0]` when no Bay implies the state**; TAC_C2's `bays[0]` is `tac-c2-tasked`; and TAC_C2 has **no Bay implying `OFF_STATION` or `RTB`**. Copying that relocation onto the reuse path would therefore file a mission line at RTB back under *Tasked*.

So the mint branch records `mintedForTofi: true` on its `tofiCoordination`, and the relocation is gated on it — *relocate only out of the Coordination Bay this exchange put it in*. Recorded at propose time rather than re-derived at accept time by comparing `strip.bayId` against `coordinationBayFor()`: that derives the same answer until a controller drags the replica somewhere in between, and then silently skips a relocation that should have happened.

The same flag settles rejection. A Strip this exchange minted has no life of its own, so a refused exchange retires it — otherwise it lingers as residue, and find-before-mint then refuses the ATC controller's perfectly reasonable retry to the *other* counterpart. A mission line `TAC_C2` tasked itself is not residue and survives a rejection with its `REJECTED` record intact.

### Unbind is Drop; there is no re-bind

A mission line bound to the wrong flight carries that flight's callsign and beacon, so there is nothing worth salvaging — drop it and frag another. **Re-bind in place is deliberately not built**: it would mean mutating a Strip's `fdrId`, which nothing in this codebase does, and which would silently move correlation, MARSA membership and refcounting along with it.

The mis-bind is catchable because it is visible immediately: `M3` renders the bound flight's callsign off the shared FDR, so the wrong jet shows the wrong callsign the moment the line is fragged, before it is advanced.

### Parallel advancement is ungated, on purpose

`MISSION_STATE_OWNERS` already grants TAC_C2/GCI every state, so no permission change. Nothing stops the mission line running ahead of the departure, and nothing should:

- §9.8 makes the mission line a *plan*, not a clearance. `TASKED` means fragged; pressing "Airborne" records what the MRU heard on the tactical frequency.
- It would be the first rule in the system where one Strip's NLA reads another Strip's `state`. Every existing cross-Strip rule goes through the shared FDR or a coordination record; `computeNla` has no way to reach a peer Strip.
- It is unenforceable the moment the mission line has no ATC Strip — the ATO-first case, the never-filed case, and the flight-cancelled case.

## Alternatives considered

**A `BindMissionToFlight` op of its own.** Would re-implement five gates and a thirty-field Strip literal, and would be MISSION-shaped — so WP7's ATO-first direction would need a second one.

**ATC offers the mission line to `TAC_C2`.** Puts tasking with ATC, where §9.8 puts it with the MRU, and adds an exchange where none is needed.

**Auto-bind on the Mode 3/A.** The bridge field *is* a correlation, and `0045`/`0046` spent WP5 establishing that automatic identity matching gets its own store, its own evidence ladder, and an explicit "ambiguous" answer. Inferring a binding from a beacon code is that defect class with none of that machinery.

**Relax `TOFI_ELIGIBLE_STATES` so TOFI can be proposed on the ground.** One mechanism instead of two, and the reason to refuse is mechanical: `_retireStrip` hard-refuses to retire a Strip whose exchange is `ACTIVE`, so a flight cancelling before taxi could not have its Strip dropped at all. (Note the *correct* reason — accepting an ENTRY does not write `separationRegime`; see `0053`.)

## Consequences

- `TASKED` finally means something, and `tac-c2-tasked` holds Strips that belong there.
- **`identity.callsign` (M3) and `identity.beaconAssigned` (M4) are shared**: TAC_C2 editing either changes the ATC Strip's flight. True already for TOFI-minted mission lines; this makes it ordinary rather than rare. Restricting it is a Block Map decision of its own.
- **No cross-Strip `STALE_REV`.** `_applySetBlock` bumps `fdr.rev` and only the *acting* Strip's `rev`, so the other controller's `baseRev` stays current. But **the FDR has no optimistic concurrency at all** — a stated Phase-1 simplification — so two controllers writing different FDR fields both succeed, and the same field is last-write-wins. Pre-existing; now routine.
- **While a TOFI is ACTIVE, neither Strip can be retired.** Pre-existing (`_retireStrip`), but binding makes it reachable far more often. The escape hatch is EXIT, which needs `SREG` back at `ATC` — answerable only because `0053` makes somebody state a regime on the way in. Walked in `efsp-scenario-military.test.mjs` so it is a known property rather than an 0200 surprise.
- A mission line with no ATC Strip holds a beacon code, correctly. **WP7 must decide whether an ATO-created FDR allocates one at all** — noted here so that question is inherited rather than rediscovered.
- `_appliedMutations` is not persisted across restart, so a replayed bind after a restart would have created a second mission line. The per-Board same-role refusal now catches that.
- **`crc-desktop/tests/helpers/` now exists**, holding the DOM stub that had two hand-maintained copies. The briefing's rule was that two is the point to lift and the third should not be written; this is that lift. The two existing copies still stand and should migrate.
- WP7's acceptance criteria are **not** claimed. This builds the flight-first direction and leaves `op.fdrId` role-agnostic so ATO-first is a caller change, not a mechanism change.
- **Nothing here has been clicked.** The client work — the bind picker, `.mission`, the regime `<select>` from `0053` — is proven by tests that render the real panel against a DOM stub, which is wiring and not pixels. The hand-walk this owes is in `docs/efsp-wp6-plan.md`'s Verification section, and it should happen in the same sitting as the stereo-table pass.
