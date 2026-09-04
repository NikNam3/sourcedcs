# EFSP usage guide

A working reference for the Electronic Flight Strip Panel — what's built, how to drive it, and what every field on a Strip/FDR is for. Written after WP4A's first slice (`docs/adr/0013`-`0021`); see those and `docs/adr/0001`-`0012` for the reasoning behind any of this, and `EFSPImplementationGuide.md` for the spec it implements.

## 1. Status right now

Built and tested (749 tests across `crc-sync`/`crc-desktop`/`sourcedcs-web`, all green):

- **WP0-WP4** (guide): domain model, Mutation protocol, Position occupancy/combination, Block Map, Bays/Racks/drag, States/NLA/transfer, 30s Undo.
- **WP4A first slice**: a second Facility (`CENTER`/`CTR`) alongside `INCIRLIK`'s five Positions; the 5 cross-Facility coordination primitives (`HANDOFF`/`POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`AIT`) between `APP` and `CTR`; per-Facility Strip replication (two independent Strips linked by `coordination`, not one moved Strip); `EDCT`/`CALL_FOR_RELEASE` release states + standing-release envelopes; airspace ownership as a direction; track-degradation soft interlock; timed forwarding-obligation alerts.
- **Flight-plan pre-fill**: `OPS`'s CreateStrip form looks up a pilot-submitted DD1801 (ICAO IFR) flight plan from sourcedcs-web by callsign and pre-fills the departure fields — see §4.
- **`ops-filed` queue**: `OPS`'s `ops-filed` Bay now shows every currently-filed DD1801 plan as a card, each with a one-click "Create Strip" — see §4. ⚠️ **Requires a deployment step to actually work** — see the callout at the end of §4.

Deferred (see `docs/adr/0020`): `TOFI`, the `TACTICAL` Facility, MRU Positions (`TAC_C2`/`AIC`/`GCI`/`JTAC`), the D12 MRU-refusal audit.

Facility/Position map as it stands:

| Facility | Positions | Notes |
|---|---|---|
| `INCIRLIK` | `OPS`, `CD`, `GND`, `TWR`, `APP` | Covering chain `CD→GND→TWR→APP` |
| `CENTER` | `CTR` | No covering chain (mirrors `OPS`) |

## 2. How to mark a Strip CLEARED

The full pre-departure chain is `PROPOSED → PENDING_CLEARANCE → CLEARED → HELD/PUSHBACK → ...`. To get a Strip to `CLEARED`:

1. **Strip must exist and be owned by `OPS`, state `PROPOSED`.** Create one via the callsign box (OPS only) or `.` dot-commands. If `OPS` holds a filed DD1801 plan for that callsign, it's auto-fetched and pre-fills the flight plan fields — see §4.
2. **`OPS` presses the NLA button ("Send to Clearance")** — requires a beacon code already assigned (Block 5) and `CD` occupied (or its covering Position). This is transfer-shaped: it both advances the state to `PENDING_CLEARANCE` *and* moves ownership to `CD` in one action (`docs/adr/0012`) — you don't drag it separately.
3. **Now acting as `CD`, confirm/fill in the flight plan fields:** `filed.route` (Block 9), `filed.requestedAltitude` (Block 7), `filed.departureAirport` (Block 8), `filed.destinationAirport` (Block 8B). All four are required — `computeNla` checks `isFlightPlanValid`, and `PENDING_CLEARANCE`'s NLA is inhibited with `"flight plan invalid"` until they're all non-empty. If step 1's auto-fill found a match these are likely already populated — review them like any pre-filled field, they're fully editable (an ordinary Block edit, same as if `CD` had typed them).
4. **`CD` presses the NLA button ("Mark Cleared").** This is state-only (`CLEARED` is still `CD`'s own state, no Position boundary crossed) — the Strip stays with `CD`, state becomes `CLEARED`.

Equivalently: drag the Strip directly into `CD`'s `cd-cleared` Bay — `_validateBayImpliedTransition` enforces the exact same flight-plan-valid gate on the drag path (guide §3.5 rule 4: NLA is an accelerator, never the *only* path).

One extra gate exists on the state **after** CLEARED: `CLEARED`'s own NLA ("Approve Pushback") additionally checks `fdr.assigned.releaseState === 'RELEASED'` — if the flight has any other release state (`HOLD_FOR_RELEASE`, `RELEASE_TIME`, `CLEARANCE_VOID_TIME`, `EDCT`, `CALL_FOR_RELEASE`), pushing past `CLEARED` is inhibited (`"a hold is in force"`) until that clears — see §7 below.

Per-State authority table for reference (who's allowed to advance a Strip **out of** its current state):

| State | Owner | NLA label | Advances to |
|---|---|---|---|
| `PROPOSED` | `OPS` | Send to Clearance | `PENDING_CLEARANCE` (transfers to `CD`) |
| `PENDING_CLEARANCE` | `CD` | Mark Cleared | `CLEARED` |
| `CLEARED` | `CD` | Approve Pushback | `PUSHBACK` (transfers to `GND`) |
| `HELD` | `CD` or `GND` | Release | `PUSHBACK` (transfers to `GND`) |
| `PUSHBACK` | `GND` | Taxi | `TAXI` |
| `TAXI` | `GND` | To Runway Queue | `RUNWAY_QUEUE` (transfers to `TWR`) |
| `RUNWAY_QUEUE` | `TWR` | Line Up and Wait | `LUAW` |
| `LUAW` | `TWR` | Cleared for Takeoff | `DEPARTED` |
| `DEPARTED` | `TWR` | Hand Off to APP | `HANDED_OFF` (transfers to `APP`, intrafacility) |
| `HANDED_OFF` | `APP` | Drop | `DROPPED` |

ARRIVAL lifecycle is `INBOUND → HANDED_TO_TOWER → FINAL → LANDED → TAXI_IN → DROPPED`, owned by `APP`(or `CTR`)/`TWR`/`TWR`/`TWR`/`GND` respectively. A `CENTER`-held `INBOUND` Strip has **no** ordinary NLA at all — its next action is the **Coordinate** button (§8), not this table.

## 3. Bays by station — intended usage

Every Position's Bay set is fixed by `facility-config.js` (guide §4.2). A Bay with an **implied state** (`impliesState`) is a real lifecycle stop — dropping/NLA-ing a Strip into it both relocates *and* advances it (§2). A Bay with no implied state is a holding/staging area — placement there is purely organizational, it never changes `strip.state` on its own.

### `OPS` — Operations (files flight plans, owns Field State)

| Bay | Implies state | Intended usage |
|---|---|---|
| `ops-filed` | — | **The filed-plan queue** (§4) — shows every currently-filed DD1801 plan as a card with a one-click "Create Strip," fetched from sourcedcs-web (throttled, refetched at most every 10s while this Bay is open). This is a client-local view, not real Board state — no actual Strip lives here until you press Create on a card, and (unlike every other Bay) it's **no longer a valid drag target**: dropping a Strip here would render nowhere, so both the Bay tab and OPS's Position-tab default were changed to route elsewhere (`ops-proposed`) instead. |
| `ops-proposed` | `PROPOSED` | **Where a newly created Strip lives.** This is the real starting point of the departure lifecycle — every `CreateStrip` from the OPS callsign box lands here (auto-filled from a matching DD1801 when one exists — §4). Get a beacon assigned, then press "Send to Clearance". |
| `ops-field-state` | — | WP6 hook (arresting-gear/runway-state board) — **inert, nothing populates it yet.** Don't rely on it. |
| `ops-coordination` | — | Present for structural symmetry with every other Position's Coordination Bay — **inert this slice**, since no coordination primitive targets `OPS` (only `APP`/`CTR` can send/receive `HANDOFF` etc.). Nothing ever lands here right now. |

### `CD` — Clearance Delivery
| Bay | Implies state | Intended usage |
|---|---|---|
| `cd-pending-clearance` | `PENDING_CLEARANCE` | **Your intake queue.** Everything `OPS` sends via "Send to Clearance" lands here. Review/complete the flight plan (route, altitude, departure/destination airport), then advance to `cd-cleared`. |
| `cd-cleared` | `CLEARED` | Strips you've cleared, still yours, waiting on release conditions (§7) before pushback can be approved. If a hold is in force, "Approve Pushback" stays inhibited here — check `cd-held` isn't where it actually belongs. |
| `cd-held` | `HELD` | Strips on an active hold — `HOLD_FOR_RELEASE`/`RELEASE_TIME`/`CLEARANCE_VOID_TIME`/`EDCT`/`CALL_FOR_RELEASE`. Shared ownership with `GND` (either can hold a Strip here) — release it once the hold condition clears, which transfers it on to `GND`. |
| `cd-coordination` | — | Inert this slice (see `ops-coordination`). |

### `GND` — Ground

| Bay | Implies state | Intended usage |
|---|---|---|
| `gnd-pushback` | `PUSHBACK` | Strips released and approved for push/engine start. Once physically moving, advance to Taxi. |
| `gnd-taxi-out` | `TAXI` | Departing traffic taxiing to the runway — your outbound ground-movement queue. Hands off to `TWR` once at/approaching the runway. |
| `gnd-taxi-in` | `TAXI_IN` | **Arrivals**, not departures — landed traffic taxiing in from `TWR` to parking. This is the terminal Bay of the `ARRIVAL` lifecycle before Drop. |
| `gnd-coordination` | — | Inert this slice. |

### `TWR` — Tower

| Bay | Implies state | Intended usage |
|---|---|---|
| `twr-runway-queue` | `RUNWAY_QUEUE` | Departure sequencing — **one Rack per runway** (`rwy-05`, `rwy-23`). Order within a Rack *is* the departure sequence (guide §4.2) — this is the one Bay where Strip order in the Rack is operationally meaningful, not just cosmetic. |
| `twr-airborne` | `DEPARTED` | Strips that have taken off, waiting on "Hand Off to APP" (occupancy-gated — nothing happens until `APP` is occupied or covered). |
| `twr-arrivals` | `HANDED_TO_TOWER` | **Arrivals** handed to you from `APP`'s inbound sequence — your intake queue for the arrival side. |
| `twr-final` | `FINAL` | Arrivals on final approach. |
| `twr-landed` | `LANDED` | Just-landed arrivals, waiting on hand-off to `GND` for taxi-in. |
| `twr-coordination` | — | Inert this slice. |

### `APP` — Approach/Departure (RAPCON)

| Bay | Implies state | Intended usage |
|---|---|---|
| `app-inbound` | `INBOUND` | Arrivals you're working. **Populated by accepting a `HANDOFF` from `CTR`'s Coordinate button** (§8) — `APP` no longer self-originates arrivals (`docs/adr/0014` superseded the old stub). Advance to `HANDED_TO_TOWER` once ready to pass to `TWR`. |
| `app-departures` | `HANDED_OFF` | Departures `TWR` has handed off to you — the terminal parking spot for a completed departure before you Drop it. |
| `app-coordination` | — | **Genuinely live this slice** — proposed `HANDOFF`/`POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`AIT` Strips *from* `CTR` land here with `coordination.state: 'PROPOSED'`, showing Accept/Reject buttons instead of the normal NLA. This is your inbox for cross-Facility proposals. |

### `CTR` — Ankara Center (`CENTER` Facility)

| Bay | Implies state | Intended usage |
|---|---|---|
| `ctr-enroute` | `INBOUND` | Where a `CTR`-originated Strip lives (the callsign box works for `CTR` too — it's the new terminus stub since no Facility exists further upstream of `CENTER` yet, `docs/adr/0014`). Also where your **own sent** proposal's Strip stays after you press Coordinate → it doesn't move until you drop it yourself; each side of an exchange is independently removable. |
| `ctr-app-coordination` | — | Your inbox for proposals **from** `APP` (e.g. an `APP`-initiated `POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`AIT` targeting `CTR`). Same Accept/Reject mechanism as `app-coordination`, mirrored. |

**Rule of thumb across every station:** an implied-state Bay is "the state's home" — you drag/NLA a Strip *into* it to advance the lifecycle. A Coordination Bay only ever holds a Strip **you didn't create yourself** (a proposal someone else sent you) — your own outgoing proposal's Strip stays put in whatever Bay it already lived in.

## 4. Flight-plan pre-fill (OPS CreateStrip)

When `OPS` creates a Strip, the client looks up a pilot-submitted **DD1801 (ICAO IFR)** flight plan from sourcedcs-web by the entered callsign and, if one exists, pre-fills the departure fields before the Strip is even created — no separate button, it's automatic.

**Flow:**
1. Type a callsign in the create-strip box, press Enter or **+ New Strip**.
2. The box shows *"Looking up flight plan…"* for up to a few seconds while `crc-desktop` asks `crc-sync`, which asks sourcedcs-web (`GET /api/fpl1801/by-callsign/:callsign`) and maps the result onto `route`/`requestedAltitude`/`departureAirport`/`destinationAirport`/`remarks`.
3. If a plan is found, the Strip is created with those fields already populated and the status briefly reads *"Creating (flight plan found)…"*. If nothing matches, the lookup times out, or sourcedcs-web is unreachable, the Strip is still created — just blank, exactly like before this existed. **Strip creation is never blocked or delayed indefinitely by this** — it degrades to a normal manual entry every time.
4. Every pre-filled field is a completely ordinary Block, editable the normal way (click to edit) — nothing about a pre-filled Strip behaves differently from a hand-typed one afterward.

**Scope, on purpose:**
- Only `OPS`'s `DEPARTURE`-role creation triggers this — `CTR`'s `ARRIVAL`-role creation does not, since DD1801's fields (route/departure/destination airport) don't line up with `ARRIVAL`'s filed shape (`originAirport`/`arrivalFix`/`estimatedArrivalTimeUtc`) at all.
- Only **DD1801** is wired up, not the squadron's other flight-plan form (DD175, military-style) — DD1801 has a public by-callsign lookup endpoint; DD175 doesn't (only an auth-gated full list), and reaching it would need forwarding a controller's own login token, a bigger design decision not made here.
- The disabled/greyed create-strip box during the lookup means don't worry about double-submitting — a second Enter/click while it's fetching is simply ignored until the lookup resolves.

**Where this lives in code** (for anyone extending it): `crc-sync/src/efsp/flight-plan-lookup.js` (server-side fetch + field mapping, `GET /api/flight-plan-lookup/:callsign`) → `crc-desktop/app/server.js` (local reverse-proxy, same pattern as `/api/apt-weather`) → `crc-desktop/app/public/js/panels/efsp/efsp-flight-plan-lookup.js` (renderer-side call) → `efsp-panel.js`'s `_submitCreateStrip()`. Every layer is designed to never throw — sourcedcs-web being down or slow can never crash or hang `crc-sync`, and never blocks Strip creation client-side either.

### The `ops-filed` queue — browsing filed plans without knowing a callsign

The by-callsign lookup above only helps if `OPS` already knows the callsign. `ops-filed` (§3) is the complementary view: open that Bay and it shows **every** currently-filed DD1801 plan as a card (callsign, departure/destination/route summary, who filed it), each with a **Create Strip** button that seeds `CreateStrip` directly from that plan's data — no callsign typing, no lookup round trip, since the data's already in hand. The list refreshes automatically (throttled to once per 10 seconds while the Bay stays open). Pressing Create again on the same card after using it once still works (labeled "Create Again") — the queue itself is just a *view* of sourcedcs-web's filed plans, so using one doesn't remove it or mark it consumed anywhere; a small "Strip already created this session" note is the only guard, and it resets on reload.

**This is architecturally different from the by-callsign lookup**, because it needs to see *every* pilot's filed plan, not just one looked up by name — which meant a real access-control decision, not just a second URL:

- sourcedcs-web's endpoint for listing all filed plans (`GET /api/fpl1801`) is normally restricted to admins/controllers, checked against a Casdoor-session JWT `crc-sync` doesn't have (crc-sync has no interactive login of its own).
- Rather than have `crc-sync` fabricate a token *claiming* an admin role — which sourcedcs-web's JWT handling would technically accept, since it only decodes the token's claims without verifying a signature — a **dedicated service credential** was added instead: a new endpoint, `GET /api/fpl1801/service/all`, gated by a shared secret (`FLIGHT_PLAN_SERVICE_TOKEN`) rather than a user session. Same shape as the existing `RELEASE_UPLOAD_TOKEN` crc-desktop's release CI already uses to reach sourcedcs-web.
- Path: `crc-sync/src/efsp/flight-plan-lookup.js`'s `listFiledFlightPlans()` → `GET /api/flight-plan-list` (crc-sync) → `app/server.js` proxy (crc-desktop) → `efsp-flight-plan-lookup.js`'s `listFiledFlightPlansClient()` → `bay-view.js`'s `ops-filed` rendering. Every layer degrades to an empty list on any failure, same never-block discipline as the by-callsign path.

> ⚠️ **Deployment step required, not yet live**: `FLIGHT_PLAN_SERVICE_TOKEN` must be set to the **same** value in both sourcedcs-web's and crc-sync's environment (`.env.example` has the entry; `infra/docker-compose.yml` wires it through) before this actually returns anything — until it's set, `ops-filed` will just always show "No filed flight plans waiting." (fails closed, not broken). The live dev `sourcedcs-web` instance also needs restarting to pick up its side of this change (the auth route is new code) — that wasn't done as part of this work, since restarting a shared, more actively-used service wasn't this session's call to make unilaterally.

## 5. Strip fields

```
Strip {
  stripId          UUID, immutable identity
  cid               3-digit sequential display code (Block 4) — [SOURCE-DEFINED] format
  fdrId             reference to the FDR this Strip presents (§6)
  rev               optimistic-concurrency counter — every Mutation must supply the baseRev it read
  role              'DEPARTURE' | 'ARRIVAL' — picks which Block Map/NLA table applies
  state             the EfspState (Block 25) — see the tables in §2
  ownerPositionId   which Position currently controls this Strip (guide §4.4) — exactly one at a time
  bayId / rackId    current placement — which Bay/Rack it's sitting in (§3)
  orderKey          fractional-index string; sort order within a Rack
  annotations       { blockId: { blockId, entries: [{value, status, at, by}] } } — §3.7 append-only cells (below)
  flags             { offset, flipped, removeIndicator, highlight, attention } — the four paper gestures (below)
  correlation       { state: 'UNCORRELATED' } — WP5 track-correlation hook, always inert right now
  coordination      null, or the WP4A cross-Facility exchange record — see §8
  createdAt/updatedAt/updatedBy
}
```

**`flags`** — the "paper gestures" (guide §7.3), each one Mutation (`SetFlag`):
- `offset` (bool) — visually indents the Strip (⇥ button), no server meaning beyond display.
- `flipped` (bool) — shows only the callsign (Block 1), hides everything else (double-click to toggle).
- `removeIndicator` (bool) — set automatically by `DropStrip`; distinct from actual deletion (a `DROPPED` Strip stays queryable, just off the visible Board).
- `highlight` (`null|'yellow'|'cyan'|'lime'`) — right-click swatch popover. Never red — red is reserved for `attention`.
- `attention` (`null|'red'`) — Shift+click. The one saturated-red channel on the Board, per guide §7.7 rule 4.

**`annotations`** — append-only cells for any Block routed `{kind:'annotation'}` in the Block Map (§6). Each cell is a list of `Entry{value, status, at, by}`; `status ∈ ACTIVE|SUPERSEDED|STRUCK|PREPLANNED`. Amending appends a new `ACTIVE` entry and marks the old one `SUPERSEDED` — never overwrites (guide §3.7, FAA JO 7110.65 ¶2-3-1: "do not erase or overwrite any item"). `confirmVacated: true` on a `SetBlock` marks the current `ACTIVE` entry `STRUCK` instead (for altitude-type Blocks — a controller confirming the aircraft has actually left an altitude, never automatic on assignment).

## 6. FDR fields

The FDR (`Flight Data Record`) is the authoritative flight record a Strip presents — separate on purpose (guide §3.1): one FDR per flight, N Strip *presentations* of it (only one this slice, except a WP4A coordination replica — §8). `assigned` fields are the ones ATC actually writes.

```
FDR {
  fdrId, rev
  identity: {
    callsign, flightSize, aircraftType, wakeCategory,
    equipmentCodes, equipmentSuffix (derived from equipmentCodes, never write directly),
    degradation ('NONE'|'TRANSPONDER_FAILED'|'MODE_C_FAILED')      — equipment failure
    beaconAssigned (Block 5, controller/system-set)
    beaconObserved                                                  — WP5 hook, always null
    modeOne, modeTwo                                                — WP7/ATO-owned, no setter exists (defect D24 guard)
    tailNumber, unit, homeStation
    trackDegradationFlag ('NONE'|'CST'|'FAIL'|'IF'|'NT'|'TRK')      — WP4A, radar-track quality (NOT equipment — see `degradation` above)
  }
  filed: {
    route, requestedAltitude, departureAirport, departureRunway, destinationAirport,
    proposedDepartureTimeUtc, fullRouteClearance, remarks,
    originAirport, arrivalFix, estimatedArrivalTimeUtc              — ARRIVAL-role fields only
  }
  assigned: {
    clearedRoute, clearedAltitude,
    releaseState ('RELEASED'|'HOLD_FOR_RELEASE'|'RELEASE_TIME'|'CLEARANCE_VOID_TIME'|'EDCT'|'CALL_FOR_RELEASE'),
    releaseTimeUtc, voidTimeUtc, voidDeadlineUtc (derived, +30min)
    edctTimeUtc, edctWindowStartUtc/EndUtc (derived, ±5min)          — WP4A, §4.6.2
    callForReleaseTimeUtc, callForReleaseWindowStartUtc/EndUtc (derived, −2/+1min) — WP4A
    delayInfo, atisCode, datalinkClearanceIndicator ('NONE'|'ISSUED'),
    movementAreaEntryTimeUtc, taxiTimeUtc, takeoffTimeUtc,
    landingRunway                                                   — ARRIVAL-role field
  }
  military      null   — WP6 hook, inert
  trackRef      null   — WP5 hook, inert
  airspace: { owner (null|'CONTROLLING_AGENCY'|'USING_AGENCY'), changedAt, changedBy }  — WP4A, §4.6.4, direction only, never a boolean
  provenance    { [path]: 'COMPUTER_GENERATED'|'CONTROLLER_ENTERED'|'SYSTEM_DERIVED' }
  createdAt/updatedAt/updatedBy
}
```

**Subbucket usage, in plain terms:**
- **`identity`** — "who/what is this aircraft" (callsign, type, squawk, equipment). Mostly filled at creation; `beaconAssigned` is minted automatically unless overridden.
- **`filed`** — "what the pilot/flight plan asked for" (route, altitude, airports, times). This is what `isFlightPlanValid` checks before `CLEARED` is reachable, and what §4's pre-fill populates.
- **`assigned`** — "what ATC has actually granted" (clearance, release state/timing, ATIS code, movement times). This is the bucket that changes as a flight progresses through the departure sequence.
- **`airspace`** — WP4A only, a delegated-airspace direction, orthogonal to everything else.
- **`military`/`trackRef`** — reserved for WP6/WP5, don't populate them, nothing reads them yet.

## 7. Release states (why a Strip can be stuck at CLEARED/HELD)

| `releaseState` | Meaning | What un-sticks it |
|---|---|---|
| `RELEASED` | Normal — no hold | n/a |
| `HOLD_FOR_RELEASE` | Held pending a standing-release match or explicit coordination | Matches a facility-configured `standingReleases` envelope (route/altitude), or file `OPERATIONAL_REQUEST` (§8) |
| `RELEASE_TIME` | Earliest departure time set | `releaseTimeUtc` must have passed |
| `CLEARANCE_VOID_TIME` | Void-time clearance | Must depart before `voidDeadlineUtc` (= `voidTimeUtc` + 30min) or the clearance expires |
| `EDCT` | Expected Departure Clearance Time | Window is `edctTimeUtc` ± 5 min |
| `CALL_FOR_RELEASE` | Call-for-release procedure | Window is `callForReleaseTimeUtc` − 2 / + 1 min |

`HELD`'s NLA ("Release") is inhibited on `RELEASE_TIME` (not yet reached) or void-time-expired; `CLEARED`'s NLA is inhibited on anything other than `RELEASED`.

## 8. WP4A: cross-Facility coordination (APP ↔ CTR)

Only `APP` and `CTR` can use this. It's a **separate mechanism** from the ordinary NLA chain above — "the Strip does not cross the Facility boundary" (guide §4.6). A `HANDOFF`/etc. creates a **second, independent Strip** at the receiving Facility, linked (not merged) to the sender's.

**To hand an inbound flight from `CTR` to `APP`:**
1. Acting as `CTR`, create a Strip (the callsign box works for `CTR` too now — it originates an `ARRIVAL` Strip in `ctr-enroute`; no flight-plan pre-fill for this path, see §4's scope note).
2. Click **Coordinate…** on the Strip, pick `HANDOFF`, add a note if the FDR has a `trackDegradationFlag` set (required in that case), press Send.
3. This creates a new Strip in `APP`'s `app-coordination` Bay, `coordination.state: 'PROPOSED'`.
4. Acting as `APP`, click **Accept** on that Strip — it moves to `app-inbound`, `state: INBOUND`, and both sides' `coordination.state` become `'ACTIVE'`. Data ownership and separation responsibility both move to `APP` (`HANDOFF`'s full-jurisdiction row).
5. From here the `APP`-side Strip proceeds through the normal `ARRIVAL` chain (§2). The `CTR`-side Strip stays in `ctr-enroute` — drop it manually once you're done with it (each side is independently removable).

`coordination` record shape on a Strip:
```
coordination: {
  primitive           'HANDOFF'|'POINT_OUT'|'TRAFFIC'|'OPERATIONAL_REQUEST'|'AIT'
  state               'PROPOSED'|'ACTIVE'|'REJECTED'
  peerFacilityId, peerStripId, peerPositionId    — the OTHER replica's coordinates
  dataOwnerPositionRef            { facilityId, positionId }  — who "owns" the data
  separationResponsibilityRef     { facilityId, positionId }  — who's separating traffic (only POINT_OUT ever splits these two)
  radarIdTransferred, commsTransferred   — booleans, per the primitive's guide-table row
  lastForwardedEtaUtc, note, initiatedAt/By, acceptedAt/By
}
```

Primitive cheat sheet (what moves on ACCEPT):

| Primitive | Data ownership | Separation | Radar ID | Comms |
|---|---|---|---|---|
| `HANDOFF` | moves | moves | transfers | transfers |
| `POINT_OUT` | **stays** | moves | transfers | stays |
| `TRAFFIC` | stays | stays | transfers | stays |
| `OPERATIONAL_REQUEST` | stays | stays | — | — |
| `AIT` | moves | moves | transfers | transfers |

`POINT_OUT` shows two badges on the Strip ("DATA: X" / "SEP: Y") since those can genuinely differ.

## 9. General controls — quick reference

- Set which Position(s) you're acting as under **Panels → Acting As** (grouped by Facility now — `INCIRLIK` and `CENTER` are independent checkbox groups).
- Each held Position gets its own tab; each Position's Bays (§3) are its own tabs underneath.
- **Drag** a Strip onto another Position's tab to transfer it (same-Facility only); onto a Bay tab within your own Position to move it there.
- **Search**: `.find <text>` dot-command, or the search icon — matches callsign/beacon, opens a temporary search-results Bay.
- **Dot-commands**: `.drop [reason]`, `.undo`, `.find <text>`, applied to whichever Strip is currently selected.
- **Undo**: 30-second window, state-only NLA transitions only (not transfers/handoffs — those revert via a manual transfer back).
