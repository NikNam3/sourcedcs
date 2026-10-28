# 0038 — Altitude blocks inside an airspace, a taxonomy that spans FAA and ICAO, and a warning when a block is released occupied

## Context

Three things the project owner raised about the airspace model built in docs/adr/0034–0037, all of which turn on the same observation: a block is not one aircraft's private workspace.

The first is the operational case they asked for directly — *"someone is currently working and gets restricted to a specific altitude block while another flight crosses the danger area."* Two aircraft in one block, deconflicted vertically, is ordinary. Nothing in the slice could express it: `strip.airspaceEntry` recorded *which* airspace a flight was working and on what frequency, and there was no way to say *where* in it.

The second is their parenthetical — *"MOAs are generally danger or restricted airspaces (see FAA manual)"*. `AIRSPACE_TYPES` shipped as `MOA | RANGE`, which is a fragment of the FAA's special-use vocabulary and none of ICAO's. Turkey publishes danger and restricted areas; a squadron flying there describing them all as MOAs is mislabelling the airspace it works in.

The third came out of walking the sorties: releasing a block while flights were still approved into it succeeded silently. docs/adr/0034 had already articulated why that matters, in the sentence it used to argue airspace state belongs in a store of its own — *"a MOA stays hot after one flight leaves it whenever other participants remain."* The inverse is the dangerous direction, and nothing said anything about it.

The guide constrains one of these hard. §4.6.3 rule 1: **`separation_regime` MUST NOT be derived from airspace type** — *"Three internal regimes exist and the governing agreement picks one — including the case where ATC continues to separate inside the airspace."* That is defect **D14**, and WP4A's acceptance criteria make attempting it *"a validation error."*

## Decision

### Altitude blocks

`strip.airspaceEntry` gains `altitudeBlock`, either `{lowerFt, upperFt}` or `null`, set through an optional `altitudeBlock` on `ApproveAirspaceEntry` and validated by `_validateAltitudeBlock` in `board-store.js`: whole feet, upper above lower, and — when the airspace publishes vertical limits of its own — inside them.

`airspace-config.js` gains the limits it validates against: optional `altLowerFt`/`altUpperFt`, whole feet between `MIN_ALTITUDE_FT` (0) and `MAX_ALTITUDE_FT` (100000), with `altUpperFt` above `altLowerFt`. An airspace that publishes neither is unbounded as far as this system is concerned, which is honest — the real limits are charted elsewhere and this is not a charting tool.

Two choices inside that are worth stating, because both could reasonably have gone the other way.

**`null` means "the whole block", and is deliberately not defaulted to the airspace's own limits.** An aircraft working a block alone is *unrestricted*; an aircraft told to stay between 5,000 and 28,000 in a block that runs 5,000 to 28,000 has been *restricted to exactly the block*. Those render identically on a Strip and mean different things to the next controller who has to fit somebody else in: the first can be squeezed, the second has already been. Materialising the default would erase that distinction at the moment it was created.

**Re-issuing `ApproveAirspaceEntry` on a Strip already in the same airspace amends the restriction in place** rather than being rejected as a double entry. Tightening a block to let a crossing flight through, and lifting it again once they are clear, is the normal shape of the sortie — not an error state. A separate amend op would have been a second way to say the same thing, with two code paths to keep in agreement about frequency defaulting.

The worked case is `tests/efsp-scenario-airspace.test.mjs`: a flight working a danger area unrestricted, squeezed to 5,000–15,000 while another crosses at 20,000–28,000, then released back to the whole block. A companion test asserts a block below the airspace's floor, above its ceiling, or upside-down is refused, and that an airspace publishing no limits accepts any sane restriction.

### The taxonomy

`AIRSPACE_TYPES` becomes `MOA | RANGE | DANGER | RESTRICTED | PROHIBITED | WARNING`, spanning both vocabularies rather than picking one and mistranslating into it. The FAA and ICAO name overlapping things — a MOA in FAA terms is commonly charted as a danger or restricted area elsewhere — and a config that can only say `MOA` forces every entry to be labelled with the wrong word.

**It is purely descriptive, and nothing may ever derive behaviour from it.** This is the D14 constraint, and the risk is real precisely because the names are suggestive: `RESTRICTED` and `DANGER` sound like they should imply something about separation. They must not. The governing agreement picks the regime, including the case where ATC keeps separating inside the block. The constraint is stated in `airspace-config.js` immediately above the set, where anyone adding a type will read it.

What actually drives behaviour is named in the same comment, so the contrast is on the page: `usingPositionId` (whether a `RANGE` Position exists for this airspace at all — docs/adr/0035) and which frequency field is set (`controlFrequencyMhz` for a range with its own tower, `workingFrequencyMhz` otherwise — docs/adr/0037). Neither is inferred from `type`.

### `AIRSPACE_STILL_OCCUPIED`

`ReleaseAirspace` now counts the flights still approved into the block and returns `warning: 'AIRSPACE_STILL_OCCUPIED'` with `occupied` when that count is non-zero. **The release still succeeds.**

That is the same judgement §9.11 produced for entry into an unactivated block (docs/adr/0037) and rests on the same asymmetry: the controller may well know those flights are clear while the board has not caught up, so refusing would be wrong more often than right. What was missing is a signal, not a prohibition.

The count arrives through an injected `occupancyFor` callback on `AirspaceStore`'s constructor, wired in `index.js` to iterate every Facility's Board for non-`DROPPED` Strips whose `airspaceEntry.airspaceId` matches. This mirrors `liveStripsForFdr`'s shape (docs/adr/0028) and exists for the same reason: the store has no business reaching into Boards, and the Boards do not exist yet when it is constructed. The count is also recorded on the transition itself as `occupiedAtRelease`, so the append-only history says how many were left behind rather than only that a release happened.

The two mechanisms compose, and that is the point. A flight left in a released block is, from the next tick onward, a flight in airspace nobody holds — which is exactly the condition `UNACTIVATED_AIRSPACE_ENTRY` alerts on. The warning tells the releasing controller at the moment they act; the obligation keeps telling whoever holds the flight until it is resolved.

## Alternatives considered

- **Default `altitudeBlock` to the airspace's published limits** instead of `null`. Rejected: see the Decision. It collapses "unrestricted" and "restricted to the full block" into one representation at the exact moment the difference is created.
- **A separate `AmendAirspaceEntry` op** for changing a restriction. Rejected: a second op meaning almost the same thing, with the frequency-defaulting logic duplicated across both or awkwardly shared. Re-issuing the approval is what a controller is doing anyway.
- **Store the restriction on the FDR** next to `comms`, rather than on the Strip's `airspaceEntry`. Rejected: the restriction is scoped to working *this* airspace and ends when the flight leaves it, which is exactly `airspaceEntry`'s lifetime. On the FDR it would outlive its own meaning, and would have to be cleared by hand.
- **Validate altitude blocks against each other**, refusing one that overlaps another flight's in the same airspace. Rejected for this slice: it is a real deconfliction feature and wants its own design — vertical separation minima are not 1 foot, the flights may be separated laterally, and a panel that refuses a controller's judgement about separation is the wrong shape (the same reasoning that keeps duplicate beacon codes a warning under D23). Recording what was assigned is the prerequisite; checking it is a follow-on.
- **Keep `MOA | RANGE` and put the real designation in `name`.** Rejected: `name` is display text, and the type is what a future filter or chart layer would key on. Encoding the taxonomy in prose loses it.
- **Derive a default `separation_regime` from `type`** — `RESTRICTED` implying one thing, `MOA` another. Rejected outright: this is D14, named as a defect, and WP4A's acceptance criteria require attempting it to be a validation error.
- **Refuse to release an occupied block.** Rejected: it blocks a correct operation whenever the board lags reality, and there is no way for the system to know better than the controller who is looking at the scope.

## Consequences

- `tests/efsp-scenario-airspace.test.mjs` is the worked record of all three: the altitude-block sortie, its validation boundaries, the two-flights-one-block case docs/adr/0034 argued from and nothing had ever tested, and the release-while-occupied case asserting both the `AIRSPACE_STILL_OCCUPIED` warning and the `UNACTIVATED_AIRSPACE_ENTRY` alert that follows it.
- The client renders the restriction on the airspace board's flight list (`VIPER1 (135.500, 5000–15000 ft)`) so a range controller sees how their block is divided, and surfaces the release warning through the existing mutation-warning banner naming the count.
- **Nothing checks altitude blocks for overlap.** Two flights can be assigned the same slice, and the panel will record it without comment. That is a deliberate scope line (see Alternatives), but it means the feature assists deconfliction rather than enforcing it, and should be described that way to controllers.
- **`type` remains unused by any logic.** That is the intended end state, not an omission — a future reader looking for where `DANGER` changes behaviour should find nothing, and the comment above the set says so.
- Airspace vertical limits are optional and most entries will likely omit them, in which case `_validateAltitudeBlock` only checks internal consistency. An airspace that does publish limits gets the stricter check for free, which is a reason to fill them in.
- `occupancyFor` is a scan over every Strip on every Board per release. That is the same cost profile as `liveStripsForFdr` and runs on a controller action rather than a tick, so it is not worth indexing until a Board is orders of magnitude larger than a squadron's.
