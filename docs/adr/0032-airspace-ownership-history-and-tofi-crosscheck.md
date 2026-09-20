# 0032 — Airspace ownership becomes append-only and is soft-checked on TOFI exit; the `RANGE` Facility stays deferred

## Context

Three related findings, all surfaced by tracing a civil sortie that departs Incirlik IFR, transits a MOA under CENTER, and returns.

**There is no airspace-scheduling concept in this codebase at all.** The guide describes one in detail — §4.1's Position table gives `RANGE` (*"Range Control"*, the **using agency**, *"**no strip primitives** — owns airspace state"*), §4.2's board table gives it *"Airspace board (not a strip rack) — scheduled, active, released, returned"*, §4.1 rule 2 states *"`RANGE` works no Strips. It owns airspace state — schedule, activation, release direction. Give it a Field State board,"* and §1105 asks for airspace activation modelled as state owned by `APP` with `RANGE` scheduling and releasing it, *"with request and approval as recorded actions. Aircraft entering unactivated airspace MUST alert."* None of it exists: `grep -rn "RANGE" crc-sync/src/efsp/*.js` returns nothing, and `facility-config.js`'s `DEFAULT_CONFIGS` holds only `INCIRLIK`, `CENTER` and `TACTICAL`.

The only artifact that represents any of this is a single FDR field, `fdr.airspace.owner ∈ {null, CONTROLLING_AGENCY, USING_AGENCY}` (docs/adr/0018), reachable as Block `24A` on `DEPARTURE`/`ARRIVAL`/`OVERFLIGHT`. So a MOA sortie is representable today only as that one enum plus free text in `filed.route`/`filed.remarks` — there is no airspace entity, no schedule, no using-agency Position to negotiate with, and nothing anywhere *reads* `airspace.owner` (`nla.js`, `coordination.js`, `permission.js` and `forwarding-obligations.js` never consult it).

**Within that, the field overwrote its own history.** `setAirspaceOwner` did `fdr.airspace = {owner, changedAt, changedBy}` — a flat replace. A MOA given to the using agency at 14:03 and taken back at 14:22 read afterwards as though it had only ever been taken back. Every other controller-entered doctrinal fact in the system is append-only, via the §3.7 annotation model, precisely because JO 7110.65 ¶2-3-1 forbids erasure (*"do not erase or overwrite any item"*). `airspace.owner` is structurally excluded from that model by design — docs/adr/0018 routes it through a dedicated setter specifically so no generic path can write it — which was right for validation and wrong for retention. No test covered a round trip; `tests/efsp-fdr-store.test.mjs` set the field once, in one direction.

**And it was never cross-checked against a TOFI exit.** `_applyTofiAccept`'s EXIT branch hard-gates on `fdr.tofi.separationRegime === 'ATC'` — guide rule 3's "exit is the safety-critical direction," implemented as a real precondition (docs/adr/0025). Nothing looked at `airspace.owner` at that same moment, so a flight could complete a TOFI exit — nominally back under ATC control — with the airspace still booked out to the using agency. Two independently maintained "who has authority" fields for one real-world event, only one of them gated.

## Decision

**(a) `airspace.owner` keeps its current value and gains an append-only history.**

```js
fdr.airspace = {
  owner,
  changedAt: now,
  changedBy: by || null,
  transitions: [...(fdr.airspace.transitions || []), { owner, at: now, by: by || null }],
};
```

`owner`/`changedAt`/`changedBy` are unchanged in meaning and position, so every existing reader — `block-map.js`'s `24A` routing, `bay-view.js`'s enum `<select>` (docs/adr/0022), the D15 no-boolean-path guarantee — is untouched. `createFdr` seeds `transitions: []`. The setter remains the only write path, which is what makes the history trustworthy: there is no route that mutates `owner` without appending.

**(b) A soft warning, not a second hard gate, on TOFI exit.** `_applyTofiAccept` returns `warning: 'AIRSPACE_STILL_WITH_USING_AGENCY'` when an EXIT completes while `fdr.airspace.owner === 'USING_AGENCY'`. The exit still succeeds.

This is the §4.6 verbal-path interlock shape (guide §4.6 rule 4: *"requires verbal approval. Implement as a soft interlock that warns"*), not rule 3's precondition, and the distinction is substantive: airspace release and control handback are genuinely separable in real operations. A MOA stays hot after one flight leaves it whenever other participants remain, so blocking the exit would be wrong far more often than it would be right. What was missing was not a prohibition but a *reminder* — the controller had no signal at all that the two records disagreed.

**(c) `RANGE` and the airspace board stay deferred, and this ADR is the record of that.** Building it means a fourth Facility, a using-agency Position that works no Strips, a Field State board that is not a strip rack, an airspace entity with a `scheduled → active → released → returned` lifecycle, and a real PROPOSE/ACCEPT round trip between `APP` and `RANGE` — a work package on the scale of a WP4A slice, not a fix that belongs in a bug-fix pass. (a) and (b) harden the one artifact that does exist so the interim representation is at least honest and auditable.

## Alternatives considered

- **Build `RANGE` now.** Rejected as scope: it would have dominated a pass whose purpose was fixing defects found by tracing, and it needs its own design decisions (does an airspace entity live on the FDR, on a Board, or in a third store? is activation a Mutation? what alerts on §1105's *"aircraft entering unactivated airspace"*?) that deserve a work package rather than being settled in passing.
- **Route `airspace.owner` through the §3.7 annotation model** to get append-only behaviour for free. Rejected: docs/adr/0018 excluded it from that model deliberately — annotations are free-text cells with vacate/supersede semantics, whereas this is a two-value enum whose whole point is that nothing but a direction can be written. A dedicated `transitions` array preserves both properties; annotation routing would give up the validation to gain the history.
- **A hard gate on TOFI exit**, mirroring `separationRegime`. Rejected: see (b) — it would block a correct and common operation, and the guide reserves hard preconditions for the case where the data is broken by proceeding (rule 2's drop prohibition, rule 3's separation regime), not where two records merely disagree.
- **Also cross-check on `DropStrip`/`ConvertToArrival`.** Rejected for now: those are not the moment control returns, and adding the warning everywhere it is *technically* true would dilute it. The TOFI exit is the one point where a controller is explicitly asserting "this flight is back with ATC."
- **Cap `transitions`.** Rejected as premature — a sortie produces a handful of entries at most, and the annotation model it mirrors is likewise uncapped.

## Consequences

- **`RANGE`/airspace scheduling is the named blocker for any real airspace scenario**, and should be read as the first candidate work package for anyone picking this up: the civil MOA sortie is walkable today only because "the MOA is hot" is representable as an FDR enum and a remark, which is a record of a decision rather than a model of the airspace.
- `tests/efsp-scenarios.test.mjs`'s civil round trip asserts the round trip the old implementation could not represent: `owner` ends at `CONTROLLING_AGENCY` **and** `transitions.map(t => t.owner)` is `['USING_AGENCY', 'CONTROLLING_AGENCY']` — *"a flat overwrite would show only the second."* A dedicated test covers the soft warning completing an exit rather than blocking it.
- `tests/efsp-fdr-store.test.mjs`'s fresh-FDR assertion now includes `transitions: []`, which is the one place the shape change is visible to an existing test.
- The history is durable — `fdr.airspace` is part of the FDR and so of the snapshot (docs/adr/0002) — so it survives a restart, unlike the compliance counters in docs/adr/0021. That is correct for an audit record and worth not regressing.
- Nothing yet *renders* `transitions`. The natural home is wherever annotation history is surfaced; until then the record exists and is queryable, which is the part that could not be added retroactively.
