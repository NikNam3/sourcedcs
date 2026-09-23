# 0053 — accepting tactical control requires stating the separation regime, because nothing ever did and the FDR was free to say nothing at all

## Context

Guide §4.6.3 models separation as three independent fields, and is emphatic about the third:

> `flight.separation_regime ∈ ATC | MARSA | USING_AGENCY | DUE_REGARD | SEE_AND_AVOID`
>
> **`separation_regime` MUST NOT be derived from airspace type.** Three internal regimes exist and the governing agreement picks one — including the case where ATC continues to separate inside.

§4.8.3 says what happens when it is wrong: *"if a second controller takes `TAC_C2` ten minutes later, the state must already be correct, or they inherit a lie."*

`docs/adr/0025` built TOFI and `docs/adr/0026` the MISSION Role. Between them the exchange works: `PROPOSE → ACCEPT`, a MISSION Strip on the MRU side, an EXIT that is hard-refused unless the regime is back at `ATC`. What neither did — and what this ADR found while planning the mission-line work — is require the regime to be set **at all**.

Reading the code rather than the intent:

- `fdr.tofi.separationRegime` initialises to `null` (`fdr-store.js`).
- `_applyTofiAccept` sets `tofiCoordination.state` and relocates the Strip. It writes nothing to `fdr.tofi`.
- `TOFI_EFFECTS` / `tofiEffect` in `coordination.js` — the table that *looks* like it applies the exchange's effects — has **no runtime consumer anywhere**. It holds two accept phrases and is never read.
- The only writers of `separationRegime` are Block `SREG` (via `fdrStore.setTofi`) and `marsa-store.js`'s injected setter.

So the whole of tactical control could run with the FDR saying nothing about who was separating the aircraft. Nobody is lying; the record is simply empty, which §4.8.3's second controller cannot distinguish from `ATC`. And the `null` then fails the EXIT gate twenty minutes later, producing a refusal whose cause is long out of sight.

This was nearly recorded as a footnote justifying an unrelated decision. It is not a footnote — it is a live defect in shipped behaviour, worth fixing on its own.

## Decision

**ENTRY `ACCEPT` requires `op.separationRegime`, validated against `SEPARATION_REGIMES`, and writes it through the existing `fdrStore.setTofi` path.** An accept without one is refused with a reason that names the five values and says where they come from:

> `accepting tactical control requires a separation regime (ATC, MARSA, USING_AGENCY, DUE_REGARD, SEE_AND_AVOID) — it comes from the governing agreement and cannot be derived`

**Asked for, never derived.** This is the whole point, and the distinction the guide draws. Auto-writing `MARSA` because the Facility is `TACTICAL`, or `USING_AGENCY` because the airspace is a MOA, is exactly defect D14 — and it would be worse than the gap it closes, because a derived value looks authoritative. Refusing to derive it is correct; refusing to *ask* for it was the mistake.

**EXIT `ACCEPT` is unchanged.** It already hard-refuses unless the regime is `ATC` (§4.6.3 rule 3, *"ATC separation MUST be re-established before the aircraft leaves the protected block"*), and that gate is now answerable, because something made a controller state a regime on the way in.

**An ACTIVE MARSA relation is the one exception.** `docs/adr/0051` gives the relation ownership of the regime while it holds, and `_applySetBlock` already refuses a direct `SREG` write for that reason. So when `rules.activeMarsaFor` returns a relation, no regime is required and none is written; supplying anything other than `MARSA` is refused, naming the declaring callsign. Asking for a choice that cannot be honoured would be worse than not asking.

## Alternatives considered

**Derive the regime from the airspace or the Facility.** Defect D14 by name, and the guide spends a paragraph on why. A derived value carries the same authority on screen as a stated one and is wrong more often.

**Write `MARSA` as a default, since it is the common military case.** The same objection wearing a plausible hat. "Common" is not "agreed", and the one time it is wrong is the time it matters.

**Leave the accept alone and warn when the regime is still null at EXIT.** Where the failure surfaces today, and it is the worst place for it: twenty minutes downstream of the decision, to a controller who may not be the one who took the aircraft.

**Wire `TOFI_EFFECTS` up instead, since it exists.** It holds accept *phrases*, not effects — wiring it would not write a regime. It is dead and should be documented as descriptive or deleted; that is a separate, smaller decision.

## Consequences

- **Every existing ENTRY `ACCEPT` caller had to change.** Four test call sites carry `separationRegime: 'MARSA'` now. That is the intended blast radius of a required field, not incidental churn — a client that accepts without one is refused with a message that says what to send.
- The MRU controller states the regime at the moment they take the aircraft, which is when they know it and when they heard it agreed.
- `fdr.tofi.separationRegime` is non-null for the whole of tactical control, so §4.8.3's second controller inherits a fact instead of an absence.
- The EXIT gate becomes a real interlock rather than one that frequently fails for a reason nobody can trace.
- This is a **prerequisite** for `docs/adr/0054`, not merely adjacent to it: while a TOFI is ACTIVE, `_retireStrip` refuses to retire either Strip, and the only way out is an EXIT that needs the regime back at `ATC`. A regime that was never set makes that exit path unreachable.
- `TOFI_EFFECTS`/`tofiEffect` remain dead. Recorded here so the next reader does not assume, as this one briefly did, that they are what applies the exchange.
- **The client gained a regime picker beside "Accept TOFI Entry"**, because without one this change would have broken a working workflow outright: the panel sent no `separationRegime`, so every accept from the UI would have been refused. It is a five-option `<select>` defaulting to `MARSA` — a default nobody can accept without seeing, which is the point. `efsp-ui-reachability.test.js` asserts the picker exists and that the accept carries its value, which is exactly the class of gap that test was written for.
- **Unverified by eye.** The picker's wiring is asserted by test; nobody has looked at a Strip carrying a `<select>` between its Accept and Reject buttons. Named in `0054`'s hand-walk.
