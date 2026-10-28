# 0045 — Correlation is a fourth store keyed by `fdrId`, and its uncorrelated warning is a field so that it can retract

## Context

WP5's brief is guide §6.6, and the guide is unusually direct about why it is a subsystem rather than a join:

> **Measured in the real prototype:** 100% of Strip selections whose targets existed on the surveillance display highlighted in under 1 second, but only **85–90% of Strips matched a surveillance target**, largely because *"entity id changes are not picked up on the FDM but are propagated to the TIDS"*.
>
> **Identity reconciliation between the flight-data domain and the track domain is a named, measured defect class. Treat it as a first-class subsystem, not a join.**

Rule 2 then fixes the shape: *"`TrackRef` MUST tolerate the underlying track identity changing. Store the correlation as its own record with its own history; do not store a raw track ID on the FDR."* And rule 3 fixes the behaviour: *"A track identity change MUST NOT silently break the binding. It MUST either re-bind on the beacon code or raise an uncorrelated warning on the Strip."*

Phase 1 left three hooks for this, and **one of them was wrong**. `strip.correlation` was set to an inert `{ state: 'UNCORRELATED' }` on `CreateStrip` (`board-store.js:399`), on both cross-Facility replica-minting paths, and reset by `ConvertToArrival` — i.e. **keyed by `stripId`**.

## Decision

**A fourth store, `correlation-store.js`, peer to `FdrStore`, `BoardStore` and `AirspaceStore`, keyed by `fdrId`.** Built on `airspace-store.js` throughout: own `_records` Map, per-record `rev`, own `_seq`, `setMutationLog`, a `_recordAudit` that logs refusals, append-only `transitions[]`, one never-throwing entry point, and `snapshot`/`restore` that skip records which no longer resolve.

### Why `fdrId` and not `stripId`

One FDR legitimately has several Strips: per-Facility replicas (`docs/adr/0013`), a TOFI `MISSION` Strip on the same FDR, and `ConvertToArrival` keeping one `stripId` across a role change (`docs/adr/0023`). A `stripId` key lets an INCIRLIK replica and its CENTER replica hold **different answers to "which contact is this airframe"** — and two answers to an identity question *is* the defect class §6.6 names, arriving from inside the panel instead of from the track domain. Correlation is a fact about the airframe, and the FDR is the airframe (§3.1).

**`strip.correlation` is removed, not left inert.** §12's rule that a deferral leaves its fields present governs deferrals; this is a wrongly-keyed duplicate of live state, and a Strip reading `UNCORRELATED` beside a record reading `CORRELATED` is the bug. `BoardStore.restore()` deletes the key off any pre-WP5 snapshot record — migrating it would carry a second, stale answer through a restore, which is the failure the key change removes.

**A server-computed mirror stamped back onto the Strip is also wrong, for a second and independent reason.** It would bump `strip.rev` and the board `_seq` at reconcile cadence. A Strip is broadcast *whole* on every update (`docs/adr/0004`), so that would flood the delta ring buffer and invalidate controllers' optimistic edits once a second — precisely what §3.1's FDR/Strip split exists to prevent (*"every track update invalidates the controller's optimistic edit"*). The client joins on `fdrId` instead, which costs one Map lookup.

### `ConvertToArrival`'s reset was a defect, and it was always a defect

The line `strip.correlation = { state: 'UNCORRELATED' }` in `_applyConvertToArrival` fired on the same `stripId`, the same `fdrId`, the same airframe — still airborne, still squawking the code ADR 0023 went out of its way to keep, and still the same contact on the scope. It threw away a correct binding for the one aircraft that certainly has one.

That is §6.6 rule 3's *silent break*, reached through a Strip role change instead of a track-id change. It never hurt anybody only because the field was inert. Under the `fdrId` key there is nothing there to reset, which is a second, independent argument for the key: the correct behaviour falls out of the shape rather than having to be remembered. `tests/efsp-scenario-correlation.test.mjs` walks it, and `tests/efsp-board-store-coordination.test.mjs`'s assertion — which used to pin the reset — now pins its absence.

### The warning is a field, not an event, and that is the whole point

Raising an uncorrelated warning is easy. **Retracting one is what needs a shape.** `record.warning` is set when a match is lost and set back to `null` on the next successful match, and because the record arrives whole in every delta and snapshot, retraction needs **no new mechanism at all** — the next delta simply carries `warning: null`. Nothing is erased: the raise *and* the retraction both sit in `transitions[]`. **The display clears; the record does not.**

This is deliberately **not** the obligation-alert shape. `ForwardingObligationMonitor` cannot retract, because an alert is a fire-and-forget broadcast with no record behind it to update — the briefing carries that as a known gap and `efsp-state.js`'s own comment admits it (*"the server never retracts an alert once raised this slice"*). It would have been the nearest precedent to copy, and copying it would have shipped a Strip stuck at `NO TRK` until someone reloaded.

`transitions[]` appends **only on a change** to `state`, `matchedBy` or `trackId` — never per tick — so a whole flight yields a handful of entries and JO 7110.65 ¶2-3-1's *"do not erase or overwrite any item"* holds literally with no pruning. Same discipline `airspace-store.js` already applies when it passes `null` for a non-transition.

### What does get written to the FDR: `identity.beaconObserved`

`setBeaconObserved()`, a dedicated setter structurally excluded from `WRITABLE_PATHS`. That exclusion has a different reason from `setAirspaceOwner`'s and `setTofi`'s: those need validation beyond an allow-list check, while this one **is not a controller-entered value at all**. Its provenance is `UPSTREAM_TRACK`, and a generic-path route to it would be a route for a client to claim an aircraft is squawking something it is not.

It writes **only on change**, and does not bump `rev` otherwise — the reconciler calls it once a second per correlated flight.

This finally gives §3.10.2 rule 1 real data: *"Assigned and observed are two separate fields. Never one. The panel derives a mismatch state by comparing them, and renders three cases: matching, mismatched, and assigned but nothing received."* `beaconAssigned` has been written since Phase 1; nothing ever wrote the other half, so defect **D22** could not be tested and the three-case render had nothing behind it.

### `fdr.trackRef` stays null, permanently

Kept present per §12's rule, comment rewritten from "WP5 hook" to a settled statement. Guide §3.1 types it `TrackRef?`, but §6.6 rule 2 then forbids the only thing it could usefully hold. Anything else is either a staleable duplicate of the record's state — which is the defect, not the fix — or the `fdrId`, i.e. the record's own key.

### Two entry points, and two different audit trails

`apply(mutation, actingPositionId, by)` for the two controller ops (`BindTrack`, `UnbindTrack`), with optimistic concurrency on the record's own rev. `reconcile(resolutions, now)` for the sweep: **not a Mutation** — no `actingPositionId`, no `baseRev`, no MutationLog entry, because surveillance is not a controller.

`transitions[]` holds where the correlation has *been*, including every reconciler re-bind. The MutationLog holds what a controller *asked for*, refusals included — the split `airspace-store.js` already documents. Logging every re-bind to the MutationLog would drown it.

**Divergence from `airspace-store.js`, stated so it is not read as an oversight:** that store returns early on `NOT_FOUND`/`STALE_REV` without auditing. This one audits those too, because *"a refusal is the interesting half of an authority model"* is the reason the hook exists, and a refused ask that leaves no trace anywhere defeats it.

### Persistence, and one deliberate asymmetry

`restore()` **nulls `trackId` and `binding.trackId`, sets `UNCORRELATED`, and keeps `transitions[]`.** A persisted track id is a lie the instant the process restarts, because DCS re-mints ids. So an explicit binding does **not** survive a restart, which is correct: it was a statement about a contact on a scope that no longer exists. That it happened is preserved in the history; the claim that it is still true is not.

**The reconciler does not trigger `_persist()`.** A guaranteed 1 Hz atomic whole-snapshot write is exactly the cost `index.js`'s `_persist` comment already frets about, and the only thing at risk in a crash is a few seconds of correlation history — the state itself recomputes within one tick of boot. Correlation history rides along on the next controller Mutation's existing write. Recorded here rather than left to be discovered.

## Alternatives considered

- **Key by `stripId` and keep the existing hook.** Rejected: see the Decision. It is the shape that lets two replicas of one airframe disagree, and it is what made `ConvertToArrival`'s reset look reasonable.
- **Key by `fdrId` but mirror the state onto each Strip for rendering.** Rejected, and this was the tempting one — it would have made the client a pure read of `strip.correlation` with no join. But it reintroduces the divergence (two copies, one authoritative) *and* adds the rev-churn problem, so it is worse than either pure option.
- **Put the correlation on the FDR** as `trackRef`, as §3.1's type signature suggests. Rejected by §6.6 rule 2, which forbids the raw track id, and by rev churn: writing it would bump `fdr.rev` and the provenance map at reconcile cadence, and an FDR is broadcast whole too.
- **Make the warning an `efsp-correlation-alert` broadcast**, mirroring the obligation alerts. Rejected: it cannot retract, which fails §6.6 rule 3's second half — a Strip would sit at `NO TRK` after re-binding until somebody reloaded. This is the one place where following the nearest precedent would have been the mistake.
- **Store a beacon-mismatch warning kind** alongside the others. Rejected: `observedBeacon` plus `beaconAssigned` is exactly the pair §3.10.2 rule 1 asks the panel to compare, and the client holds both, so the three-case render is derived. A mismatch *does* affect `state` — it degrades a `CALLSIGN_*` match to `PROVISIONAL` — which is a `state` fact, not a warning. One fact, one home.
- **Persist the track id and re-validate it at boot** rather than nulling it. Rejected: "re-validate" means "check whether a contact with that id exists", and after a restart one probably does — belonging to a different aircraft. That is worse than having no answer.
- **Prune `transitions[]` above some length.** Rejected as unnecessary rather than wrong: appending only on change makes the array small by construction, so a cap would only ever fire on a flight that had genuinely re-bound dozens of times — which is the one case somebody would want to read.

## Consequences

- **`tests/efsp-correlation-store.test.mjs` pins the retraction explicitly**, including that `transitions[]` afterwards reads `['FIRST_MATCH', 'TRACK_GONE', 'REBOUND_ON_BEACON']` — the raise and the recovery both present. That assertion is the ADR's whole argument in one line.
- **A bug the tests caught, worth recording because it is the defect class hiding in the audit trail.** The first implementation set `record.trackId = null` when a match was lost, so a re-bind one tick later saw `before.trackId === null` and recorded `FIRST_MATCH` instead of `REBOUND_ON_BEACON`. The behaviour was right and the *history* silently lost the identity change — §6.6 rule 3's silent break, relocated. `reconcile` now falls back to `warning.lostTrackId`, and `_matchReason` checks the re-bind case before the first-match case.
- **`tests/efsp-scenario-correlation.test.mjs` is the acceptance gate** — fourteen sorties, four of them walking the named defect class by name (mission reload, stale-then-renumbered, a changed squawk, two flights one callsign).
- **`efsp-fdr-store.test.mjs` gains nine cases** covering `setBeaconObserved`: octal validation, null as a real value, write-only-on-change, `UPSTREAM_TRACK` provenance, no `updatedBy` stamp, no generic `setField` route, and `trackRef` staying unwritable.
- **`_reconcileRestored` gained a clause**: a correlation record whose FDR did not come back is dropped rather than reported. Unlike the missing-FDR Strip case beside it, a correlation without an FDR is invisible either way, so a warning would be noise.
- **The snapshot file grows a `correlations` key.** An older snapshot without it restores to no records, which the next tick rebuilds — no migration.
- **`permission.canCorrelate` is new**, refusing correlation ops to the `USING_AGENCY` class by class rather than by table, on the same basis as `canMutate`'s first line: a range Position works no flights (§4.1 rule 2) and, under `docs/adr/0042`, has no scope on which to have seen anything. Everything else may bind, including an MRU — **D12** is about being asked to provide ATC *service*, and "which blip is this" is not that.
- **`efsp-ws.js` now requires `permission.js` directly**, the only module it requires. Every other rule reaches it through `ctx`, but a correlation op targets no Strip and no Board, so there is no `rules` object on its path.
