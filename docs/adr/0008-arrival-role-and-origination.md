# 0008 — ARRIVAL Strip Role added; originated by APP, not OPS; Block Map is [SOURCE-DEFINED]

## Context

Phase 1 built `DEPARTURE` only. Phase 2 extends the same single Facility (`INCIRLIK`) with the `ARRIVAL` lifecycle (guide §3.4: `INBOUND → HANDED_TO_TOWER → FINAL → LANDED → TAXI_IN → DROPPED`) and Block Map (§6.3), still without WP4A's cross-Facility coordination and without a `CTR` Facility.

Two problems the guide's own text doesn't resolve for a single-Facility build:

1. **Origination.** The guide's real design has an arrival Strip originate from a `HANDOFF` forwarded by the previous Facility (typically `CTR`). Phase 2 has no `CTR` Facility to hand off from. Something has to originate `ARRIVAL` Strips locally, analogous to how ADR 0005 handled `DEPARTED`'s missing `APP` — an explicit, labelled stub rather than a silently fabricated cross-Facility exchange.
2. **Block Map content.** Guide §6.3 describes the Arrival strip only at the level of "Block 9A carries minimum fuel, destination, point-out, radar vector and speed adjustment" — not a full block-by-block layout the way §6.2 gives for Departure. The underlying Annex (`[Annex §2.2]`) isn't in this repository.

## Decision

**Origination:** `APP` gets a role-scoped `CreateStrip` right for `role: 'ARRIVAL'` at initial state `INBOUND` (`permission.js`'s `CREATE_ROLE_PERMISSIONS.APP = new Set(['ARRIVAL'])`), mirroring `OPS`'s existing `role: 'DEPARTURE'` right (guide §4.1 rule 3's real BASOPS-originates-the-FDR pattern). This is a Phase-2 stub for "no CTR Facility to hand off from yet," structurally the same shape as ADR 0005's `DEPARTED` stub, and is the seam WP4A's real `HANDOFF` will eventually replace (an inbound flight will then originate its Strip from a forwarded cross-Facility exchange, not a local `CreateStrip`).

This asymmetry — `OPS` originates `DEPARTURE` only, `APP` originates `ARRIVAL` only, neither extends to the other's role — is also what makes a genuine defect-D21 regression test possible for the first time: Phase 1's `CD`/`GND`/`TWR` were permission-identical, so no test scenario could distinguish correct per-acting-Position evaluation from a union-of-held-Positions bug. See `efsp-permission.test.mjs`'s new D21 tests.

**Block Map:** `block-map.js`'s `ARRIVAL_BLOCK_MAP` and `strip-template.js`'s client mirror are constructed by following `DEPARTURE_BLOCK_MAP`'s *structural* pattern (FAA-style block numbering, the `required`/`target` shape) rather than transcribing sourced doctrine that isn't available. Per guide §0.2's provenance discipline, this is labelled `[SOURCE-DEFINED]` in both modules' header comments and MUST NOT be presented as real FAA numbering in UI text or documentation — the same rule already applied to the EFSP State/NLA tables (`nla.js`'s own header comment).

Specific construction choices worth recording:

- **Block 7** (assigned/cleared altitude) is annotation-routed, not fdr-routed like `DEPARTURE`'s Block 7 — this is deliberate, so it carries the append-only + `confirmVacated` model (guide §3.7 rule 3). A descending arrival's sequence of altitude clearances is exactly where "don't strike a vacated altitude until confirmed" matters operationally.
- **The 9A-* sub-fields** (minimum fuel, destination, point-out, radar vector, speed adjustment — guide §6.3 note 1) are modelled as five separate annotation-routed Blocks (`9A-FUEL`, `9A-DEST`, `9A-PTOUT`, `9A-VECTOR`, `9A-SPEED`) rather than one opaque composite field, specifically so `blockVisibility`/`validateFacilityConfig` can enforce the doctrinal exception per-Block (minimum fuel MUST stay visible; the rest MAY be omitted) with no new validator logic — the existing required-Block check already does this correctly once minimum fuel is its own Block.
- **Blocks 20/21** (radar-automation scratchpads) stay Strip-local annotations, same as `DEPARTURE`'s, even though guide §6.3 note 2 says the real system binds these to track scratchpads — WP5 (track correlation) isn't built yet, so there's nothing to bind to. Documented as a temporary Phase 2 simplification, not a silent doctrine violation, to be revisited once WP5 lands.
- **Blocks 11/14/16/17/18** (APREQ, release/movement/taxi/takeoff times) are deliberately NOT carried over from `DEPARTURE` — they're clearance-delivery concepts with no arrival equivalent.

New arrival-specific FDR fields (`fdr-store.js`): `filed.originAirport`, `filed.arrivalFix`, `filed.estimatedArrivalTimeUtc`, `assigned.landingRunway` — separately named from the departure fields (not repurposed), since `filed.departureAirport` means something different from `filed.originAirport` and conflating them would be a real bug.

## Alternatives considered

- **`OPS` originates ARRIVAL too** (matching `OPS`'s real BASOPS role, which does touch both directions of traffic in practice). Rejected: it would make `OPS`'s `CreateStrip` right maximally permissive again, exactly the "looks correct in every demo" trap the guide warns about for D21, and would remove the only permission asymmetry Phase 2 has to actually test per-acting-Position evaluation against.
- **Leave ARRIVAL Strips uncreatable in Phase 2** (inhibited until WP4A). Rejected, same reasoning as ADR 0005's equivalent alternative: it would make the ARRIVAL lifecycle entirely undemonstrable end-to-end, which defeats the purpose of building it now.

## Consequences

- WP4A, when it lands, replaces `APP`'s local `CreateStrip(ARRIVAL)` stub with real Strip origination via the cross-Facility `HANDOFF` primitive from `CTR`. That change should show up as an intentional, reviewed permission-table change (removing `ARRIVAL` from `CREATE_ROLE_PERMISSIONS.APP`, or scoping it further), not a silent regression — mirroring ADR 0005's own consequence note about `efsp-nla.test.mjs`'s explicit stub test.
- The Block Map's `[SOURCE-DEFINED]` labelling must be preserved through any future editing pass — a conforming editor's pass (guide §0.1) still needs to either source it for real or keep the label.
- `efsp-block-map-parity.test.js` extends automatically to `ARRIVAL_BLOCK_MAP` now that both sides define it, closing the same kind of server/client drift risk ADR 0001 flagged for `DEPARTURE_BLOCK_MAP`.
