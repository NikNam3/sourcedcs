# 0020 — WP4A's first slice is civil ATC↔ATC only; `TOFI`, the `TACTICAL` Facility, MRU Positions, and the D12 audit are deferred

## Context

`docs/efsp-wp4a-briefing.md` §4 (left by the previous agent, after completing this repo's own "Phase 1"/"Phase 2" covering guide WP0→WP4) recommended against building the full WP4A work package in one pass: *"WP4A as specified pulls in the TACTICAL Facility and its MRU Positions (TAC_C2, AIC, GCI) purely to prove the D12 refusal case — that's a genuinely different kind of Position (no ATC service at all) from anything built so far, and TOFI's MRU coordination is its own sub-protocol. Pulling all of that in at once mirrors exactly the mistake the existing Phase 2 plan deliberately avoided."* The briefing's own §4 point 5 explicitly asked that this deferral be recorded as an ADR — *"it's a genuine scope decision, not free."* The user confirmed this recommendation before implementation began.

## Decision

This work package builds only:
- The `CENTER` Facility and `CTR` Position (`docs/adr/0013`).
- `HANDOFF`, `POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, `AIT` between `APP` and `CTR` specifically (`docs/adr/0015`).
- Per-Facility Strip replication, the D13 mechanism (`docs/adr/0015`).
- Forwarding obligations, release-across-the-boundary, airspace-ownership-as-a-direction (`docs/adr/0017`, `0018`, `0021`).

Explicitly **not** built this session:
- `TRANSFER_OF_FLIGHT_INFORMATION` (`TOFI`, guide §4.6.3) — the two-step ATC↔MRU exchange, performed before entry and again before exit, followed by a separate communications transfer.
- The `TACTICAL` Facility and its Positions — `TAC_C2`, `AIC`, `GCI`, `JTAC`.
- The three-field separation model (`flight.ifr_active`/`radar_service`/`separation_regime`, guide §4.6.3) — `separation_regime`'s "no implicit derivation from airspace type" requirement (defect D14) is the direct analogue of `docs/adr/0018`'s airspace-ownership work, and should follow that ADR's dedicated-setter template when it lands.
- **Defect D12's MRU-refusal audit** (*"TAC_C2, GCI, AIC and JTAC have no handoff or point-out affordance at all — audited in the UI, not merely absent from the happy path"*) is not merely deferred but **structurally inapplicable this slice**: no MRU Position exists anywhere in the running system yet, so there is nothing to audit a refusal against. `permission.js`'s own header comment already carried this exact caveat since Phase 1 (*"a Military Radar Unit like TAC_C2 must never be granted HANDOFF/POINT_OUT... doesn't yet apply, since no MRU Position exists"*) — this ADR extends that same honest gap through WP4A's first slice rather than fabricating a premature "Position Class" concept with nothing real to gate.

## Alternatives considered

- **Build the full WP4A scope in one pass**, including `TACTICAL`/MRU Positions and `TOFI`, to satisfy every guide-listed WP4A acceptance criterion in a single work package (as the guide's own §13 table specifies WP4A as one unit). Rejected, per the briefing's own reasoning and the user's confirmation: the `TACTICAL` Facility is a genuinely different *kind* of Position (no ATC service at all — guide §4.1 rule 1), `TOFI` is its own sub-protocol, and pulling both in alongside the already-substantial D13 replication mechanism risks the exact "too much landing together, none of it well-tested" failure this repo's own Phase 1/Phase 2 split was designed to avoid.
- **Build a `positionClass`/"Position Class" concept now**, even without a real MRU Position to exercise it against, so the D12 gate exists in code ahead of need. Rejected: a permission table gated on a class with only one real value (`MILITARY_ATC`) proves nothing about correct per-class evaluation — the same "looks correct in every demo" trap the guide warns about for D21, applied to a new axis. The concept is better introduced alongside the first real Position that needs it (`TAC_C2`), where a genuine positive/negative test pair becomes possible.

## Consequences

- A future work package building `TOFI`/`TACTICAL`/MRU Positions should introduce a `positionClass` concept (e.g. `MILITARY_ATC`/`MRU`/`CIVIL_ATC`) in `facility-config.js`'s Position definitions and gate the 5 coordination op kinds on it in `permission.js`, rather than the current flat per-Position-ID `PERMISSIONS` table — `docs/adr/0015`'s own header comment already flags that the flat table only works because Position IDs are globally unique across Facilities in this slice, which a class-based gate would make explicit and future-proof rather than implicit.
- `separation_regime` (defect D14) should reuse `docs/adr/0018`'s `setAirspaceOwner` pattern exactly: a dedicated sub-object, a fixed enum (`ATC | MARSA | USING_AGENCY | DUE_REGARD | SEE_AND_AVOID`), a dedicated setter excluded from the generic `WRITABLE_PATHS` path, never derivable from `airspace.owner` or any other field.
- Guide §13's WP4A acceptance criteria that reference the deferred pieces (the D12 audit; `separation_regime` validation) are correspondingly not claimed as met by this work package — only the civil ATC↔ATC subset's criteria (POINT_OUT's dual-half rendering, two independently-removable replicas, track-degradation disabling silent transfer, the 15/3/30-minute obligation alerts, airspace ownership requiring a direction) are.
