# 0026 — A minimal `MISSION` Strip Role for TOFI; full ATO-driven richness stays WP7

## Context

The guide's own §13 work-package table assigns the *full* `MISSION` Strip Role to **WP7** ("ATO set parser and mapping; `MISSION` Strip Role and `TAC_C2` Bays; AR line ↔ tanker Strip join; ATO↔Strip binding on Mode 3/A"), with entry criteria **WP6** (the military layer) — neither of which is built. Guide §9.8 describes `MISSION` as structurally different from an ATC Strip in every dimension (keyed by mission number/package ID rather than callsign/beacon, a vul/on-station time model rather than clearance events, Mode 1/2/datalink identity rather than Mode 3/A, a control agency rather than a sector/position) and explicitly ties its full field set to ATO ingest (§9.9).

But `docs/adr/0020` deferred `TOFI` (guide §4.6.3) into WP4A's own remaining scope, not WP7's, and `docs/adr/0025`'s TOFI implementation structurally requires **some** MRU-side Strip to exist for the exchange to land on — `TAC_C2`/`GCI`'s Position table row names `MISSION` as their Strip Role, and a Facility's Bay Map needs a real Strip Role to configure Bays against. This is exactly the kind of "build only what a real, exercisable need requires" tension `docs/adr/0020` itself already navigated once, for `positionClass` — this ADR applies the identical reasoning to `MISSION`'s field richness instead.

## Decision

Build exactly this field set, and no more:

| Field | Block | Source |
|---|---|---|
| Mission number | `M1` | new `mission.missionNumber` |
| Package ID | `M2` | new `mission.packageId` |
| Callsign | `M3` | reused `identity.callsign` |
| Beacon (Mode 3/A — guide's own "bridge field") | `M4` | reused `identity.beaconAssigned` |
| Controlling agency | `M5` | new `mission.controllingAgency` |
| Vul window start/end | `M6`/`M7` | new `mission.vulWindowStartUtc`/`vulWindowEndUtc` |
| Remarks | `M8` | reused `filed.remarks` |

Lifecycle: the guide's own published states (§9.8, line 215) verbatim — `TASKED → AIRBORNE → ON_STATION → OFF_STATION → RTB → DROPPED` — with the simplest possible linear NLA (no occupancy gating, no `transferTo`), mirroring `OVERFLIGHT`'s own "self-originator owns the whole lifecycle solo" precedent (`docs/adr/0023`) rather than inventing cross-Position richness with nothing real to test it against.

**Explicitly deferred to WP6/WP7, not built this session:** Mode 1/2/datalink code (`fdr.identity.modeOne`/`modeTwo` stay the existing WP7-owned `null` hooks, untouched), the MARSA relation, ordnance state, ROZ/ACM airspace fields, the AR-line/tanker join (`tac-c2-tanker` Bay exists per guide §4.2's own naming but stays inert this slice, exactly as the original WP4A first slice's Coordination Bays were "present but inert" before this session made them real), and ATO ingest/parsing entirely.

`MISSION_BLOCK_MAP` gets its **own `M`-prefixed namespace**, drawn from the guide's own "military extension namespace" instruction (§9.8) — deliberately **not** a DEPARTURE/ARRIVAL field-reuse the way `OVERFLIGHT`'s Block Map was (`docs/adr/0023`). That precedent doesn't apply here: `OVERFLIGHT` is structurally an ATC Strip (callsign/beacon-keyed, sharing DEPARTURE's field shape) that simply doesn't touch Incirlik's ground; `MISSION` is guide-described as a different *kind* of record (a mission line, not a clearance strip) with no natural DEPARTURE/ARRIVAL field to reuse beyond identity/beacon/remarks, which are reused explicitly above.

## Alternatives considered

- **No `MISSION` artifact at all — TOFI acts purely on the ATC-side Strip by reference.** Rejected (see `docs/adr/0025`'s own "alternatives" for the mechanical reasoning): guide §9.8 and the Position table both name `MISSION` as `TAC_C2`/`GCI`'s Strip Role, and a Facility's Bay Map (`facility-config.js`) needs a real Role to configure Bays against — `TACTICAL`'s own `tac-c2-tasked`/`tac-c2-airborne`/`tac-c2-on-station` Bays would have nothing to hold without one.
- **Building the full WP7 scope now, to avoid touching `MISSION_BLOCK_MAP` twice.** Rejected, on identical grounds to `docs/adr/0020`'s own rejection of a preemptive `positionClass`: an ATO-driven mission-line Block Map with no ATO fixture to parse into it, no MARSA relation with a real edge to model, and no ROZ/ACM source data proves nothing about whether that richness is correctly built — the same "looks correct in every demo, tests nothing real" trap, applied to field richness instead of a permission axis. That work belongs alongside WP6/WP7's own real inputs (an ATO fixture, a MARSA scenario), not invented ahead of them.
- **Reusing an existing generic `WRITABLE_PATHS` entry for the 5 mission-only fields** rather than a dedicated `mission` sub-object. Rejected: `missionNumber`/`packageId`/`controllingAgency`/`vulWindowStartUtc`/`vulWindowEndUtc` have no existing FDR field that means the same thing (unlike `OVERFLIGHT`'s reuse of `filed.departureAirport` for "real origin," which genuinely was the same concept under a different role) — inventing new, clearly-named fields under their own `mission` namespace is more honest than repurposing an ARRIVAL- or DEPARTURE-shaped one to mean something it doesn't.

## Consequences

- WP7's own eventual `MISSION` Block Map work should treat this session's 8 Blocks as **additive baseline fields**, not a redesign — `M1`–`M8`/`M25`/`M26` stay exactly as defined here; ATO-driven richness (mission number/package auto-populated from `AMSNDAT`, Mode 1/2 from `MSNACFT`, vul window from `AMSNLOC`, per guide §9.9's own mapping table) layers on top as new Blocks in the same `M`-prefixed namespace, not a replacement of these.
- The stale test placeholders this closes (`crc-sync/tests/efsp-block-map.test.mjs`'s `requiredBlocksFor('MISSION')`/`isValidRole('MISSION')` assertions, `efsp-permission.test.mjs`'s `canActOnState('OPS', 'MISSION', ...)` comment) are updated in the same change that lands this ADR — grep `'MISSION'` across both test suites before any future MISSION-touching work, since ADR 0023's own precedent shows other tests can pick up the same "still-unbuilt example" placeholder pattern over time.
- Guide §13's WP4A acceptance criteria that reference `TOFI` and the three-field separation model are satisfied by this slice; guide §13's WP7 acceptance criteria (an ATO fixture producing correct mission Strips, the tanker/AR-line join, ATO↔Strip binding) are explicitly **not** claimed as met — only the minimal baseline this ADR defines is.
