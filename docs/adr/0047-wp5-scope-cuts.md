# 0047 — What WP5 deliberately does not build, and two stale comments it corrects

## Context

Correlation unblocks several things the guide specifies, and it would have been easy to build them in the same pass because the missing input has just arrived. This records what was left out and why, so the next reader finds a decision rather than a gap — and corrects two comments in the tree that stop being true the day WP5 lands.

The standing habit this follows: a capability found mid-pass gets a deferral with its reasoning, not an opportunistic build. `docs/adr/0016` and `docs/adr/0020` are the precedent.

## Decision

### §10.3's suggestion chip — not built, and ring-fenced

§10.3 is one of the guide's few flat prohibitions:

> **MUST NOT** move Strips between Bays based on detected aircraft position. The prototype did exactly this and it *"caused the participant controllers some confusion"* and required redesign. This is the most important single finding for anyone building auto-advancing bays.

What it permits instead is *"a **suggestion chip** on the Strip — 'aircraft detected airborne; advance?' — that the controller accepts with one input."*

The chip is not built, because it needs a definition of "detected airborne" that WP5 does not have: AGL? groundspeed? `checkOnGround`'s 5 km / 50 ft footprint? That is §10.4's question, and shipping a chip on a half-defined threshold is precisely how auto-advance creeps back in — the controller starts accepting a suggestion that is sometimes wrong, and the Bay moves anyway.

**The prohibition is ring-fenced by construction rather than by care.** `CorrelationReconciler` is handed a read-only view of the Boards and never a `BoardStore` it could mutate, so no code path in the subsystem can write `strip.state` or `strip.bayId`. Two tests assert the Strips the sweep saw came back byte-identical, including the case that most invites a move: an airborne contact under a Strip the board still has at `PUSHBACK`.

### §10.4's staleness detection — deferred to WP8

> a Strip whose State contradicts its correlated track state for longer than a configured threshold MUST raise a low-severity indication. Log every occurrence for §11.5 analysis.

Deferred, with its blocker now cleared: the input it lacked — a correlated contact's position and altitude against the Strip's state — exists as of this pass. `transitions[]` is where *"log every occurrence"* will read from, and `record.warning` is the retraction-capable shape a staleness indication wants (`docs/adr/0045`).

It is WP8's by the guide's own work-package list, and it needs the same threshold definition the chip does. Doing it here would mean defining that threshold twice or building both — which is the WP-sized scope creep the deferral avoids.

### ADR 0019's `trackDegradationFlag` automation — refused, not deferred

`docs/adr/0019` left a standing note to WP5: nothing sets `fdr.identity.trackDegradationFlag` (`NONE|CST|FAIL|IF|NT|TRK`) automatically from surveillance data.

**This is refused rather than deferred, because the input does not exist and will not.** DCS and SRS emit no track-quality signal at all — no coast flag, no quality number, nothing that maps onto those five values. Synthesising one from "the correlation went `UNCORRELATED`" would be doctrine fabrication (defect **D11**): an uncorrelated *flight strip* is not a *coasting radar track*, and 0019's own reasoning is that conflating a surveillance concept with an equipment concept is *"a real correctness bug, not just an awkward reuse."*

It would also be actively harmful. The flag's real effect is to force verbal coordination on a `PROPOSE` (`_applyCoordinationPropose` rejects without a note). Driving it from correlation state would impose that on **every DCS re-ID** — which happens to every flight on every mission reload — turning the defect class into an operational penalty on the controllers dealing with it.

The field stays controller-set. If DCS-gRPC ever exposes track quality, this is the ADR to revisit.

### ADR 0019's "no Block targets it" — that note is stale, and is corrected here

0019 also recorded that *"no Block currently targets `identity.trackDegradationFlag`... it is settable via `setField` directly/tests, and via a future dedicated control."*

**Verified false as of this pass.** Block `5A` targets `identity.trackDegradationFlag` in all three Block Maps (`block-map.js:56`, `:168`, `:222`), carries the label `DEGR` client-side, is an enum `<select>` with all six values (`strip-template.js:322`), and is in `compactBlocksFor`. WP4A's gap closure (`docs/adr/0022`) added it, after 0019 was written.

So WP5 owes nothing here but the correction. Recorded because a stale note in an ADR is worse than no note: it sends the next reader to build something that exists.

### `release-envelope.js`'s `radiusNm` — still unmatched, comment corrected

`matchesStandingRelease` treats a radius-only envelope as unmatched, with the comment *"no Strip/FDR field in this slice carries one (WP5 track correlation isn't built)"*.

A position is now obtainable. It stays unmatched anyway, and the comment is rewritten to cite this ADR — otherwise the tree starts lying the day this lands.

The reason is not laziness: a radius envelope would make a **release decision** depend on surveillance correlation, so a DCS re-ID would silently withdraw a standing release mid-taxi. It needs its own decision on the uncorrelated case, and both answers are bad in isolation — fail closed and a controller gets spurious `OPERATIONAL_REQUEST`s every time an id churns; fail open and a release is granted outside its envelope. That belongs in a release-model slice with §3.8 in front of it, not bolted onto a correlation pass.

### `block-map.js`'s ARRIVAL Blocks 20/21 — resolved, not deferred

The comment reads: *"§6.3 note 2 — bind to the CRC track scratchpads, not Strip-local storage... a documented Phase 2 simplification, to be revisited once WP5 lands."*

WP5 has landed, and **the answer is that they stay Strip-local annotations.** The comment becomes a settled statement rather than a promise.

`CollaborativeStore` has no per-track scratchpad to bind to — only `iff`, `rename` and `trackNumber` — so "bind to the track scratchpad" would mean inventing a shared per-track free-text store with its own conflict, retention and `MAX_FREE_TEXT` questions, for two Blocks. And a track-hosted scratchpad would **vanish on a DCS re-ID**, which is strictly worse than Strip-local for a field a controller typed by hand. The guide's instinct assumes a radar system with real track scratchpads; this track domain has none.

## Alternatives considered

- **Build the chip with `checkOnGround` as the threshold**, since it already exists and is already used by the coverage sweep. Rejected: it answers "is this within 5 km of an airfield and below 50 ft AGL", which is a radar-masking heuristic, not an "aircraft is airborne" determination. Using it would define §10.4's threshold by accident, in the wrong place, and make the definition hard to revisit.
- **Build staleness detection now, and the chip in WP8.** Rejected: they share the threshold, so building either first fixes it for the other. Whichever comes first should come with the threshold as its own decision.
- **Drive `trackDegradationFlag` from correlation state but exempt mission reloads.** Rejected: the exemption admits the mapping is wrong. If a re-ID must not count as track degradation, then correlation state is not track degradation.
- **Add a sixth `trackDegradationFlag` value** for "uncorrelated". Rejected harder: the five values are quoted from `[Coord]`'s cross-Facility coordination doctrine, and adding a SOURCE-invented sixth to a doctrinal enum is defect **D11** in its most literal form.
- **Make `radiusNm` fail open** and ship it. Rejected: it grants a release outside its envelope, which is the wrong direction for a release rule to fail in, and it would be discovered by a flight departing when it should not have.
- **Invent a per-track scratchpad store** for Blocks 20/21. Rejected on cost against benefit: a whole shared-state store with conflict and retention semantics, for two annotation Blocks, whose contents would then be destroyed by an event that happens every mission reload.
- **Say nothing about the two stale comments** and leave them for whoever next reads those files. Rejected: `release-envelope.js`'s and `block-map.js`'s comments both say "WP5 isn't built", and WP5 is built. A comment that is false is worse than a comment that is absent, because it is trusted.

## Consequences

- **`tests/efsp-correlation-reconciler.test.mjs` holds the §10.3 ring fence**, with §10.3's own words quoted at the assertion. It fails the moment anything in the subsystem writes a Strip.
- **`docs/adr/0019`'s two open items are now both closed**: the automation is refused with reasons, and the Block-Map note is corrected. Neither is left dangling for WP6 to trip over.
- **Two comments in the tree were rewritten** — `release-envelope.js`'s `radiusNm` caveat and `block-map.js`'s Blocks 20/21 note — from "WP5 isn't built" to what is actually true now. Both cite this ADR.
- **§10.4 is named in the briefing as WP8's**, alongside `recordMet()`, rather than sitting in the "smaller, known, non-blocking" list where a reader might take it for a bug.
- **The threshold question is now the explicit prerequisite for both §10.3 and §10.4**, and whichever is built first should define it. Written down so it is not defined implicitly by whichever helper happens to be nearest.
