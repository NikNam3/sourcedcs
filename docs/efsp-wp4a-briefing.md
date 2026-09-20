# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent/session. Read this, then the relevant part of
`EFSPImplementationGuide.md`, then start a proper plan before writing code — this is a handoff, not
a build order.

**This revision supersedes the previous one.** The previous revision described WP4A's second slice
(`TOFI`/`TACTICAL`/MRU Positions) as the outstanding deferred work and claimed nothing since ADR
0013 was committed. Both are now out of date: that slice is built, and everything through
`53fb563` is committed. Jump to §2/§3.

## 1. State of the tree

Committed and green: **crc-sync 576 tests, crc-desktop 211 tests** (`npm test` in each). Working
tree clean as of this writing. ADRs run `0001`–`0033`.

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

**Scenario-driven hardening** (`0027`–`0033`, this session). See §3.

## 3. The sortie traces, and what they found

Until this session every test exercised one mutation or one primitive in isolation. Nobody had ever
walked a whole flight through the system. Two sorties were traced through the real code and then
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

**The three long-standing gaps from the previous briefing are closed.** Void-time expiry is now the
5th forwarding obligation, so §3.8's required alert actually fires instead of only inhibiting a
button. The single-Position drop-target gap is closed — Positions a controller does not hold render
as drop-only tabs, scoped to Facilities they hold something at. And the WP1A Position-selection
deviation from D-9 finally has its ADR (`0033`).

## 4. What's genuinely left

**`RANGE` / airspace scheduling — newly identified, and the blocker for any real MOA sortie.** The
guide's §4.1 `RANGE` design (a using-agency Position, an airspace board with
scheduled/active/released/returned, a real PROPOSE/ACCEPT round trip) is **entirely unbuilt** —
`grep -rn "RANGE" crc-sync/src/efsp/*.js` returns nothing. Today a MOA transit is representable only
as the FDR's `airspace.owner` enum plus free text in `filed.route`/`filed.remarks`. That enum is now
auditable and cross-checked (`0032`), which is enough to fly the scenario honestly, but it is not
airspace scheduling. Deliberately deferred — this is a work package on the scale of a WP4A slice,
not a fix — and recorded as such in `0032`. **This is the natural next work package.**

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

- **Building `RANGE`**: read guide §4.1's Position table and §4.6.4, then `0032` for what was
  deferred and why. `facility-config.js`'s `DEFAULT_TACTICAL_CONFIG` is the template for adding a
  Facility (`0013`, `0025` both did it); `coordination.js`'s two tables are the template for a new
  exchange protocol, and `0025`'s reasoning about why TOFI needed its own table rather than a 6th
  row is the thing to re-read before deciding which shape airspace scheduling takes.
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
