# 0005 — DEPARTED's Next Logical Action is a Phase-1 stub, not the real HANDOFF primitive

## Context

`EFSPImplementationGuide.md` §3.5's NLA table gives `DEPARTED` the action "Hand Off," inhibited when "no receiving Position present (§4.5)." The real HANDOFF primitive (guide §4.6) is a cross-Facility coordination mechanism — it requires `APP` to exist as a configured Position, jurisdiction to actually pass to a receiving Facility, and the fuller coordination machinery (`POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, `TOFI`) that guide work package WP4A builds.

Phase 1 (this implementation) covers only `INCIRLIK`/`OPS`/`CD`/`GND`/`TWR` — `APP` is not a configured Position at all in Phase 1, not merely unoccupied. Reusing the guide's real `NO_RECEIVING_POSITION` inhibit here would misleadingly imply `APP` exists and is simply unstaffed, when it doesn't exist yet in this build.

## Decision

`src/efsp/nla.js`'s `computeNla()` gives `DEPARTED` a Phase-1-only stub: it always transitions to `HANDED_OFF`, never inhibited, with no real cross-Facility protocol behind it. The client renders this as "Mark Handed Off (local)," distinct from the real HANDOFF affordance WP4A will add. Confirmed with the project owner before implementation (see the Phase 1 implementation plan's judgment-call sign-off).

The `HANDOFF`/`POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`TOFI` op kinds are correspondingly **absent** from the Mutation op union entirely in Phase 1 (not stubbed) — per defects D12/D13's own warning that a fake coordination affordance is worse than none at all.

## Alternatives considered

- **Reuse `NO_RECEIVING_POSITION` with `APP` always "unoccupied."** Rejected: fabricates the appearance of a Position that isn't configured, which the codebase's own doctrine-fabrication discipline (guide §0.2, defect D11) argues against.
- **Leave `DEPARTED` with no NLA at all** (inhibited unconditionally until WP4A). Rejected: blocks the only path to `HANDED_OFF`/`DROPPED`, meaning Phase 1 could never close out a departed Strip at all, which would make the DEPARTURE lifecycle un-demonstrable end-to-end.

## Consequences

- This is the literal seam work package WP4A replaces: when `APP` and cross-Facility coordination are built, `DEPARTED`'s NLA changes from this stub to the real `HANDOFF` primitive, gated on `APP`'s actual occupancy.
- `efsp-nla.test.mjs` tests this exact stub behavior explicitly ("DEPARTED uses the Phase-1 stub — advances straight to HANDED_OFF, never inhibited") so a future WP4A change to this logic shows up as an intentional, reviewed test change, not a silent regression.
