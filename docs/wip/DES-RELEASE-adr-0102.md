> Amended for H100 (2026-10-01): DR-7 (a) and DR-8 (a) settled as recommended; no design change.

# 0102: The separation regime picked at TOFI ENTRY accept becomes effective when the flight is inside an airspace ACTIVE for that MRU, or at a manual "entered" mark

**Status.** Draft (DES-RELEASE, docs only). The TOFI-REGIME lane copies it to `docs/adr/` when it builds it. Rulings:
H97 (the change, and that TOFI gets no ControlRelease), H79/AIRSP-7/R3-12 (airspaces have geometry: drawn polygon or
DCS drawing), S-R3-80 (`kind: AREA | ROUTE`), S-desk3/R3-16 (clocks), H95 (undo). Research:
`docs/parallel/research/control-release.md` § "ATC <-> military" (JO 7610.14 8-1-1, 8-1-7, 8-1-10, 8-1-11).
Choices marked **settled H100** are the human's answers (decisions.md H100) to the questions in `docs/wip/DES-RELEASE.md`. Post-RENAME vocabulary as in
ADR 0101 (flight data = today's FDR; strip type = today's Role).

## Depends on

**ADR 0098 (the airspace registry, AIRSP phase 2)**, specifically its containment module built by lane
**AIRSP-2S-A** (`crc-sync/src/efsp/airspace/containment.js`). This ADR uses only the interface below, asked of
DES-AIRSP and accepted by it (draft `docs/wip/DES-AIRSP-adr-0098.md` on DES-AIRSP's branch, §3, §6, §7):

- **I1** A definition has **at most one** using agency: `usingPositionId` (a RANGES Position) **xor**
  `usingFacilityId` (e.g. `TACTICAL`, the MRU); both set is a `VALIDATION_ERROR`, neither means the controlling
  Position acts for both sides. `usingFacilityId` can only change while the record is RETURNED. Which Positions of the
  using Facility schedule, request and release is the authority capability `airspaceUse` (0098 DA-7, settled H100 (a): TAC_C2
  only). *ACTIVE for MRU F* ⇔ the record's state is `ACTIVE` and (`usingFacilityId === F` or `usingPositionId` is a
  Position of F).
- **I2** `activeContaining({ lat, lon, altFt }, { usingFacilityId }) → { inside: [{airspaceId, kind, name}],
  unknown: [{airspaceId, kind, name}] }`: pure, synchronous, no I/O, reads the **current theater only**
  (`MissionSession.theatre`), and is handed to the caller through its deps (never `require`d). AREA: point in polygon
  and `altLowerFt <= altFt <= altUpperFt` (inclusive, null = unbounded). ROUTE: legs run from `segments[i].fix` to
  `segments[i+1].fix` (the last element is only the exit fix); inside = within half the leg's width (or the default)
  of the leg centreline and inside that leg's band. `unknown` happens **only when `geometry === null`**: a DCS drawing's
  points are copied into the definition when it is selected (0098 DA-2), so there is no unresolved-drawing case.
- **I3** `isActiveFor(airspaceId, usingFacilityId) → boolean`.
- **I4** Limits are **indicated feet**, the basis of `altimetry.js` `indicatedAltFt` (QNH feet below the theater's
  transition altitude, FL × 100 at and above it). The caller converts the track altitude and polls; there is no
  change listener.
- Also available, not needed here: `containing({ lat, lon, altFt })`, every containing airspace in any state.

**Merge order:** AIRSP-2S-A merges before TOFI-REGIME. TOFI-REGIME may start earlier and code against the signature
with a stub in its tests, but it does not merge until 2S-A has. If 2S-A lands a different shape, the lane adapts the
call sites and records it here.

## Decisions at a glance

1. **TOFI's handshake is unchanged** (ATC Strip stays live, regime picked at ENTRY accept, comms a separate step,
   EXIT gated on the regime back to ATC). No ControlRelease (H97: an MRU takes no aircraft-level transfer of control;
   JO 7610.14 8-1-7).
2. **Picked ≠ effective.** At ENTRY accept the picked regime is stored as `pendingSeparationRegime`; the flight's
   `separationRegime` (what every reader uses: the EXIT gate, SEP REG Block, displays, alerting) is written `ATC`
   until entry. Picking `ATC` leaves nothing pending. An active MARSA relation still owns the regime (ADR 0051) and
   nothing is pending.
3. **Entry** = the flight's correlated track is `inside` an airspace ACTIVE for the accepting MRU Facility (I2), or
   the MRU side records a manual **Entered** mark. Then `separationRegime := pendingSeparationRegime`, pending cleared,
   `regimeEffective: { at, trigger: 'AIRSPACE'|'MANUAL', airspaceId|null, by }` stamped. Already inside at accept →
   effective at accept.
4. **Leaving, or the airspace deactivating, does not change the regime** **settled H100 (DR-7 a)**. The regime monitor
   raises the alert `REGIME_OUTSIDE_AIRSPACE`, shown on both Strips (ATC and MISSION) while a non-ATC effective regime's flight is
   not inside any airspace ACTIVE for its MRU, and clears it when the flight is back inside or the regime returns to
   ATC. The way out stays the EXIT handshake (SREG back to ATC, JO 7610.14 8-1-7, 8-1-11: ATC re-establishes
   separation). An automatic revert to ATC would claim ATC is separating when nobody told ATC.
5. **The manual Entered mark** is made by the MRU Position owning the MISSION Strip **settled H100 (DR-8 a)**. Allowed with
   or without a containing airspace; without one (no geometry, no correlation, or truly outside) it carries the warning
   `NOT_IN_ACTIVE_AIRSPACE` and the audit says so. It is the only path when the airspace is `unknown` (I2: an
   airspace without geometry) or the flight has no correlated track.
6. **Timers.** Containment is evaluated on a monitor tick (1 s). Entry needs the flight inside on 2 consecutive ticks;
   leaving raises the alert after `regimeExitGraceS` (default 10 s, `alerting.json`) **wall clock** (a pure duration,
   ADR 0096); every stamped `at`/`since` is mission time.

## Context

Today `_applyTofiAccept` (`board-store.js`; target `board/tofi.js` `Tofi`) writes the picked regime straight onto the
flight data (`fdrStore.setTofi`) at ACCEPT. JO 7610.14 8-1-10 puts the Using Agency's separation responsibility
"within the ATCAA/SUA" released to it, and 8-1-11 forbids the MRU to direct changes "prior to entering". Before
entry, ATC is still separating; the regime the MRU states at accept is the agreement for inside the block. H97 asks
that the regime becomes effective only inside an airspace ACTIVE for that MRU, or at a manual mark, and that it is
built with the airspace registry.

## Decision

### The record (on the flight data, `tofi` sub-object; written only via `setTofi`)

```
tofi: { ifrActive, radarService, separationRegime,          // unchanged; effective regime
        pendingSeparationRegime: null | 'MARSA'|'USING_AGENCY'|'DUE_REGARD'|'SEE_AND_AVOID',
        pendingSince: ms|null, pendingFacilityId: string|null,   // the accepting MRU Facility
        regimeEffective: null | { at, trigger: 'AIRSPACE'|'MANUAL', airspaceId, by },
        changedAt, changedBy }
```

On the flight data because the regime already lives there (ADR 0025/0053) and both Strips (ATC and MISSION) read
the same flight data. The SEP REG Block: before entry a write sets the pending value (a correction of what was
picked); after entry it sets the effective value as today; writing `ATC` at any time clears pending.

### Who runs it

A **TOFI regime monitor** (`createApp` ticker `tofi-regime`, conformance's shape: `trackStore`, `correlationStore`,
`indicatedAltFt`, the registry, the flight-data store, a clock and a wall clock). Each tick, for every flight data
with `pendingSeparationRegime` or a non-ATC effective regime under an ACTIVE TOFI, it reads the correlated track,
calls I2 with the TOFI's MRU Facility, and asks the Tofi collaborator to apply: `markEntered(flightDataId,
{ trigger: 'AIRSPACE', airspaceId })` (an audited system mutation, actor `system`, ADR 0083 one entry) and it sets or
clears its own `REGIME_OUTSIDE_AIRSPACE` alert (monitor state, not audited, as conformance's alerts are not). No correlation → no
automatic entry and no outside alert (unknown is not outside); the Strip shows "position unknown".

### Wire and audit

- Op: `TOFI` gains action `MARK_ENTERED` (MISSION side) on the ordinary Board mutation; the flight data rides on the
  result as on ACCEPT (ADR 0053's F-306 lesson). Audit `TOFI` with `{ tofiRegime: { trigger, airspaceId, regime,
  warning } }`; the automatic one is the same kind with actor `system`.
- The alert is monitor state, like conformance: a new list `tofiRegime: [{ fdrId, kind: 'REGIME_OUTSIDE_AIRSPACE' |
  'AWAITING_ENTRY_UNKNOWN', since }]` on the existing `efsp-alerts` message (composed in `ws-hub.js`, filtered by
  `read-scope.js` by flight like conformance), recomputed every tick and sent whole, so reconnect needs nothing new.

### Undo (H95)

`MARK_ENTERED` is a one-click mark: undoable within 10 s, restoring pending and the effective regime. The automatic
entry is not undoable (no controller made it); a wrong one is corrected by writing SEP REG.

### Edge cases

| Case | Behaviour |
|---|---|
| Accepted inside the airspace | effective at accept, trigger `AIRSPACE` |
| Regime picked `ATC` | nothing pending, no alert ever |
| MARSA relation active | MARSA owns the regime (ADR 0051); nothing pending; the monitor ignores the flight |
| MARSA ends before entry | the relation writes back as today; the pending value (if any) is not resurrected |
| Airspace never activated for this MRU | stays pending; Strip shows "awaiting entry"; manual mark possible with warning |
| Airspace deactivated (ACTIVE→RELEASED) with flights inside | regime stays, alert on each flight; the existing occupied-release warning still fires |
| Two ACTIVE airspaces overlap | inside either is inside; `airspaceId` = the first returned (registry order) |
| EXIT accepted while still pending | effective is ATC, so the gate passes; pending cleared |
| The TOFI is rejected or ends | pending cleared with it |

## Consequences

- The ENTRY accept no longer changes who separates by itself; tests that assert `separationRegime` after accept
  change to assert `pendingSeparationRegime` (behaviour change, no golden maintained after the window).
- The ATC controller's Strip now says honestly that ATC still separates until entry.
- Depends on 0098 geometry being present; without it the manual mark is the only path, which is today's effective
  behaviour plus one click.

## Alternatives rejected

- **Effective at accept (today).** H97 overturns it.
- **Use `strip.airspaceEntry` (RANGE's ApproveAirspaceEntry) as the trigger.** That is an approval to enter, not
  presence, and it belongs to the RANGE Position's slice, not the MRU's.
- **Auto-revert to ATC on leaving.** See decision 4 (DR-7 lists it as option b).
