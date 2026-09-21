# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent/session. Read this, then the relevant part of
`EFSPImplementationGuide.md`, then start a proper plan before writing code — this is a handoff, not
a build order.

**This revision supersedes the previous one.** The previous revision named `RANGE`/airspace
scheduling as the next work package. It is now built (§3A), so that recommendation is spent — jump
to §4 for what is genuinely left.

## 1. State of the tree

Committed and green: **crc-sync 611 tests, crc-desktop 222 tests** (`npm test` in each). Working
tree clean as of this writing. ADRs run `0001`–`0037`.

## 2. What's built

**WP0–WP4** (Phase 1 / Phase 2). WP0 reconnaissance (`0003`). WP1 domain model and protocol
(`0001`, `0002`). WP1A Position occupancy, combination, handover, self-coordination, permission
evaluation. WP2 Block Map. WP3 Bays/Racks/drag/gestures/search/staleness. WP4 states, NLA, the
transfer protocol, 30s Undo (`0007`–`0012`).

**WP4A first slice — civil ATC↔ATC** (`0013`–`0024`). The `CENTER` Facility and `CTR` Position; the
5 coordination primitives (`HANDOFF`, `POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, `AIT`); D13
per-Facility Strip replication; forwarding obligations; release across the boundary
(`EDCT`/`CALL_FOR_RELEASE`, standing-release envelopes); airspace ownership as a direction;
track-degradation gating; the `OVERFLIGHT` Role and `ConvertToArrival` (`0023`); Block labels
(`0024`).

**WP4A second slice — the military layer** (`0025`, `0026`). A `positionClass` concept that makes
D12 true by construction (MRU Positions structurally cannot hold the 5 ATC↔ATC primitives, however
`PERMISSIONS` is authored); the `TACTICAL` Facility with `TAC_C2`/`AIC`/`GCI`/`JTAC`; a minimal
`MISSION` Strip Role owned by `TAC_C2`/`GCI`; and TOFI as a genuinely separate sub-protocol —
jurisdiction never transfers, the MISSION Strip shares the ATC-side Strip's `fdrId`, EXIT re-enters
the same link, and `TRANSFER_COMMS` is its own action.

**Scenario-driven hardening** (`0027`–`0033`). See §3.

**The `RANGE` station and the airspace board** (`0034`–`0037`). See §3A.

## 3. The sortie traces, and what they found

Before that pass every test exercised one mutation or one primitive in isolation, and nobody had
ever walked a whole flight through the system. Two sorties were traced through the real code and then
encoded as end-to-end tests (`crc-sync/tests/efsp-scenarios.test.mjs`): a **civil round trip**
(Incirlik IFR → `CTR` → airspace to the using agency and back → return leg → landed and dropped) and
a **military round trip** (Incirlik IFR → `CTR` → tactical control under `TAC_C2` → goes VFR → TOFI
exit → return).

Both sorties are walkable. They also turned up **eleven defects**, all now fixed:

| | Defect | ADR |
|---|---|---|
| 1 | Every Role's terminal "Drop" NLA routed through a generic state setter, so it skipped `DropStrip`'s rules entirely — including §4.6.3 rule 2's unconditional refusal to drop under live tactical control, bypassable from the default UI on both sides | `0027` |
| 2 | …and on that same path, the remove indicator was never set and the beacon code never released (pre-existing since Phase 1, every Role) | `0027` |
| 3 | `releaseFdr` had no reference counting, so retiring a MISSION Strip freed the shared code of a still-airborne flight | `0028` |
| 4 | `actingPositionId` was an unchecked client claim — any client could drive any Strip by naming its owner | `0029` |
| 5 | `ConvertToArrival` discarded an open coordination or TOFI link with no guard at all | `0030` |
| 6 | `convertStripToArrival` sent `strip.ownerPositionId` unconditionally rather than resolving a held Position | `0029` |
| 7 | TOFI had no (role, state) eligibility gate, unlike the 5 primitives | `0031` |
| 8 | A TOFI exit's Accept gave a generic rejection for something only the *other* controller could fix | `0031` |
| 9 | `airspace.owner` overwrote its own history, so a there-and-back airspace round trip left no record of the first transition | `0032` |
| 10 | Nothing cross-checked airspace ownership against a TOFI exit | `0032` |
| 11 | `blockVisibility` was validated at config load but never enforced on write | — |

Two things the traces showed were *missing* rather than wrong, also added: a badge on a Strip whose
flight has other live Strips elsewhere (one sortie legitimately leaves several, and a stale one was
invisible), and a two-press warning when originating a Strip for a callsign that already has one.

**The three long-standing gaps that briefing had carried are closed.** Void-time expiry is now the
5th forwarding obligation, so §3.8's required alert actually fires instead of only inhibiting a
button. The single-Position drop-target gap is closed — Positions a controller does not hold render
as drop-only tabs, scoped to Facilities they hold something at. And the WP1A Position-selection
deviation from D-9 finally has its ADR (`0033`).

## 3A. The RANGE station

An airspace is now a first-class entity with its own store (`0034`), not a per-flight enum. It
carries the guide's four state names, a booked window, an append-only history, and a real approval
round trip between the using agency and whichever ATC Position owns it (`0036`). Flights are
approved onto a working frequency, or onto a range control tower's own frequency, through the
guide's Block 22 — structured at last rather than free text (`0037`).

Two things about the shape are worth knowing before extending it:

- **A range Position works no Strips, structurally.** Guide §4.1's own Class column for `RANGE` is
  "Using agency", its Primitives column reads "no strip primitives — owns airspace state", and its
  Strip Roles column is "none". `permission.js` refuses every Strip op to the `USING_AGENCY` class
  in `canMutate`, by class rather than by absence from the table — because the `RANGES` Facility's
  Positions are *derived* from the airspace config and are never hand-listed (`0035`).
- **Most MOAs have no range control.** A Position exists only for a range that genuinely has one;
  an ordinary MOA is scheduled and activated by the ATC Position that owns the airspace it sits in,
  with no second party and no request step. That is the common case, not an exception.

`crc-sync/config/efsp-airspaces.json` ships **empty**: the real MOAs, ranges, owning authorities and
frequencies are squadron data. Nothing works until it is filled in, and the panel says so rather
than rendering blank. `tests/efsp-scenarios.test.mjs` writes its own fixture, which is the place to
look for the config shape in use.

## 4. What's genuinely left

**Fill in the airspace config.** Everything above is exercised only by test fixtures until the real
names, frequencies and owning authorities land in `efsp-airspaces.json`.

**`AIC`/`JTAC` are configured but barely exercised.** `0025` gave them Bays and classes; no scenario
has driven a Strip through them. `JTAC`'s read-only-ness is enforced only by the absence of an
ownership grant — the D12 audit `0020` asked for (MRU Positions must have *zero* handoff/point-out
affordance, even via a combined-Position union) has been made structural in `permission.js`, but has
still never been audited against the rendered UI.

**Not started, correctly, per the guide's own build order (§16):** WP5 (track correlation), WP6 (the
military layer beyond what `0025`/`0026` built), WP7 (ATO ingest), WP7A (carrier/PAR), WP8
(instrumentation — `getComplianceStats()` is the only hook that exists, and `recordMet()` still has
no caller).

**Smaller, known, non-blocking:**
- The server never retracts an obligation alert once raised (`efsp-state.js` notes this) — a Strip
  that gets released after a void-time alert keeps the badge until the client reloads.
- `_applyUndo` re-claims a released beacon code, but declines if it has gone to another FDR inside
  the 30s window. That is the right call (D23: duplicates warn, never block), but the controller is
  not told it happened.
- The duplicate-callsign warning is client-side only; the server still has no callsign-collision
  check in `CreateStrip`.

## 5. Where to start, depending on what's next

- **Extending the airspace model** (geometry, entry detection, a scheduling calendar): read `0034`
  for why the entity is a third store and what its lifecycle means, then `0036` for the authority
  split. Note that nothing in the repo does point-in-polygon or geofencing of any kind — "is this
  track inside that airspace" has no implementation anywhere, so automatic entry detection is a
  genuine new capability rather than a wiring job. `atobrief`'s `aco.acms` already models named
  airspace with geometry and a controlling agency, and `tools/miztoyaml` builds those from DCS
  mission drawings; crc-sync's own `grpc-client.js` reads the same drawings but drops their `name`,
  which is a one-line change if that route is taken.
- **The D12 UI audit**: `permission.js`'s `COORDINATION_OP_KINDS`-stripping loop is the structural
  guarantee; what's missing is walking the actual rendered UI for a controller holding `TAC_C2` and
  `CTR` simultaneously and confirming no forbidden affordance appears.
- **Starting WP5/WP6/WP7**: re-read the guide's §16 build order first; `strip.correlation` is a
  live hook (`{state:'UNCORRELATED'}` on every Strip) and `fdr.military`/`fdr.trackRef` are
  deliberate WP6/WP5 nulls.
- Write ADRs as decisions are actually made — this repo's convention (`docs/adr/NNNN-title.md`,
  Context/Decision/Alternatives/Consequences) — not speculatively upfront. Pure bugfixes don't get
  one.

## 6. Two things worth knowing before you touch this

- **Restart the local crc-sync process after editing `crc-sync/src/`.** Node does not hot-reload it,
  and a stale process looks exactly like a broken change.
- **The scenario tests take ~4s**, almost all of it deliberate waiting: `_applyInvokeNla` has a
  400ms double-tap guard, so a test walking a whole NLA chain has to space its presses. See
  `advance()` in `efsp-scenarios.test.mjs` — if you add scenario steps, use it rather than trying to
  defeat the guard.
