# 0016 — `DEPARTED`'s Hand Off to `APP` stays the existing intrafacility `TransferStrip`, deliberately untouched by WP4A this slice

## Context

`docs/adr/0007` made `DEPARTURE`'s `DEPARTED` state's NLA a real, occupancy-gated `TransferStrip` from `TWR` to `APP` — both `INCIRLIK` Positions. That ADR was explicit about what it was *not*: *"the real cross-Facility HANDOFF primitive (§4.6) is between APP and CTR — a different Facility, still entirely unbuilt (WP4A, deliberately out of scope for Phase 2)."* `docs/adr/0015` now builds that real cross-Facility `HANDOFF` primitive. It would be easy to assume `DEPARTED`'s existing transition should now route through it — this ADR records explicitly that it does not, this slice, so the omission reads as a decision rather than an oversight.

## Decision

`nla.js`'s `computeDepartureNla`'s `DEPARTED` case is unchanged: `{toState: 'HANDED_OFF', transferTo: 'APP'}`, occupancy-gated against `APP` within `INCIRLIK`'s own `PositionStore`, routed through the ordinary intrafacility `_applyTransferStrip` — exactly as ADR 0007 left it. A real departing flight's onward leg beyond `APP`'s delegated airspace (`APP → CTR`, the genuine cross-Facility direction for a departure) is not built this session.

## Alternatives considered

- **Route `DEPARTED → HANDED_OFF` through the new `HANDOFF` coordination primitive instead of `TransferStrip`.** Rejected: `TWR` and `APP` are both `INCIRLIK` Positions — there is no Facility boundary between them at all. Guide §4.6's coordination primitives are specifically for crossing one; using `HANDOFF` here would misrepresent an intrafacility hand-off as a cross-Facility exchange, creating a spurious second Strip replica for a transition that has never needed one.
- **Also build the genuine `APP → CTR` departure hand-off this slice**, so a departing flight's full real path (`TWR → APP` intrafacility, then `APP → CTR` cross-Facility) is complete end-to-end. Deferred, not rejected: this slice's user-confirmed scope (per `docs/efsp-wp4a-briefing.md`'s recommendation) is the *first* civil ATC↔ATC coordination slice, proven via the `CTR → APP` arrival direction (`docs/adr/0014`). The departure direction is symmetric machinery on top of the same `docs/adr/0015` mechanism and is natural follow-on work, not something this slice's scope required to demonstrate the mechanism itself.

## Consequences

- `HANDED_OFF` remains `DEPARTURE`'s terminal-adjacent state, unowned by any cross-Facility concept — `permission.js`'s `DEPARTURE_STATE_OWNERS.HANDED_OFF: ['APP']` and `nla.js`'s `HANDED_OFF → DROPPED` are both untouched.
- A future work package building the real `APP → CTR` departure hand-off should replace `DEPARTED`'s `transferTo: 'APP'` with a `HANDOFF`-primitive proposal to `CTR`, mirroring exactly how `docs/adr/0014` replaced `ARRIVAL`'s `INBOUND` origination stub — the same seam, the other direction.
- No test changes were needed for this ADR — it is a confirmation of unchanged behavior, verified by `efsp-nla.test.mjs`'s existing `DEPARTED` coverage continuing to pass unmodified.
