# EFSP usage guide

A working reference for the Electronic Flight Strip Panel — what's built, how to drive it, and what every field on a Strip/FDR is for. Kept current as the panel grows; see `docs/adr/` for the reasoning behind any of this, and `EFSPImplementationGuide.md` for the spec it implements.

## 1. Status right now

Built and tested (`npm test` in `crc-sync` and `crc-desktop`, both green per lane; the Playwright suite has not been recorded on the merged branch, see the briefing). This reflects `efsp-wp5-correlation`, including Incirlik's RSU/SFA/PAR (§8L) and OVERFLIGHT's four-state lifecycle (`adr/0087`):

- **WP0-WP4** (guide): domain model, Mutation protocol, Position occupancy/combination, Block Map, Bays/Racks/drag, States/NLA/transfer, 30s Undo.
- **WP4A first slice**: a second Facility (`CENTER`/`CTR`) alongside `INCIRLIK`'s five Positions; the 5 cross-Facility coordination primitives (`HANDOFF`/`POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`AIT`) between `APP` and `CTR`; per-Facility Strip replication (two independent Strips linked by `coordination`, not one moved Strip); `EDCT`/`CALL_FOR_RELEASE` release states + standing-release envelopes; airspace ownership as a direction; track-degradation soft interlock; timed forwarding-obligation alerts — see §8.
- **WP4A second slice**: the `TACTICAL` Facility (`TAC_C2`/`AIC`/`GCI`/`JTAC`), a `MISSION` Strip Role, and TOFI — the ATC⇄MRU exchange for handing a flight into tactical control and getting it back (`docs/adr/0025`/`0026`).
- **The `RANGE` station**: MOAs and ranges as real entities with a booked schedule, an activation approval round trip, and flights approved onto a working or range-control frequency — see §8A.
- **Flight-plan pre-fill**: `OPS`'s CreateStrip form looks up a pilot-submitted DD1801 (ICAO IFR) flight plan from sourcedcs-web by callsign and pre-fills the departure fields — see §4.
- **`ops-filed` queue**: `OPS`'s `ops-filed` Bay now shows every currently-filed DD1801 plan as a card, each with a one-click "Create Strip" — see §4. ⚠️ **Requires a deployment step to actually work** — see the callout at the end of §4.
- **Radar coverage follows the Positions you hold** — the radar selector is gone. See §8B.
- **WP5: correlation** — every Strip says which contact on the scope it is, clicking a Strip rings its contact, and clicking a contact selects its Strip. See §8C.
- **WP6** — the military layer:
  - **Stereo routes** — file a flight by short name (a picker in Block `9F`) and the server expands the whole route. See §4A. (The table ships empty; nothing works until somebody writes one.)
  - **MARSA** — declaring that the military is separating its own aircraft, as a relation between flights rather than a flag on one, with the pre-rendezvous course/altitude interlock. See §8D.
  - **The military Block namespace** — `ORDNANCE` (Block 3G) and `HOOK` (Block 3F) on every ATC Strip. `HUNG` ordnance raises an advisory chip on every Position's Strip for the flight (§6); arresting-gear gating (§9.7) reads a gear inventory Incirlik does not have, so it never fires. See §6.
  - **The mission line exists from tasking** — `TAC_C2` frags a mission line against a filed flight before it moves, and TOFI later lands on the one that is already there. Accepting tactical control now requires stating the separation regime. See §8C1.
  - **Every Block is reachable, and amendments are visible** — the `▼` button on a Strip opens the Blocks that have no chip, and a superseded value now shows struck through in the Block itself (§3.7). Heading and initial altitude are chips on a DEPARTURE Strip; the radar vector is one on ARRIVAL/OVERFLIGHT. See §4B.
  - **MTR fields** — the military training route a flight is on, where it enters and leaves, and the altitude it wants after exit. See §4C.
  - **The runway (field state)** — Tower owns the runway, everyone else asks; closing it or taking it out for works holds the traffic that would use it; the active runway comes from the wind at mission start. The FIELD STATE panel and the runway chips on the Strip are in. See §8G.
- **Forwarding-obligation alerts clear themselves** once the obligation is met or no longer due. Nothing to acknowledge. See §8.
- **Contact colours come from IFF interrogation**, not from the game's idea of a side, and nothing on the ground is hidden any more. See §8F.
- **All declutter is off** until the EFSP work is finished: formation labels and navpoint names both show. See §8F.
- **Alert and scramble** — Block `14E`; a scramble raises a red line on every tab and amber chips on ground traffic that must keep clear, and never reorders or holds anything. See §8H.
- **ATC scopes draw STARS-style blocks** at `TWR`, `APP` and `CTR`: white for yours, flashing for a handoff to you, green for someone else's. See §8F.
- **Headings are magnetic** (World Magnetic Model), and the transition altitude is per theater. See §8J.
- **Time Blocks and altitude blocks** — estimated times show in italics with their source on hover (§4B), and `ALT` takes a block such as `FL220-FL240`.
- **Finished flights are archived** after 2 hours or at the next mission, and a mission session decides which mission is current. See §8J. Every Mutation and refusal has exactly one audit entry (§10).
- **The tactical Positions are fenced**: a JTAC is sent only the lines it was handed, `AIC` hands back and cannot advance a line, and `TAC_C2` answers the TOFI exit on an AIC-held line. See §8C1.
- **Metrics and a traffic count**: the METRICS panel (PANELS → METRICS) and, behind it, two read endpoints on crc-sync. See §10.
- **ATO import** — `TAC_C2` pastes or drops a USMTF ATO (atobrief exports one) and it becomes mission lines on the Board, with the air-refuelling tanker/receiver join shown on the Strips. See §8I.
- **The carrier** — a `CARRIER` Facility with four Positions (`CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2`): a ship banner, PriFly's recovery Case, the Marshal stack board and four hand-over buttons, from launch to recovery. See §8K. Not yet seen against a real DCS ship.
- **Suggestions from surveillance** — a quiet `AIRBORNE? ▸` chip when a departure Strip still says it is on the ground but the aircraft is flying, a `STALE` badge when it was ignored, and a takeoff time stamped when a Strip enters Airborne. Surveillance informs; nothing moves by itself. See §8F.
- **Incirlik's pattern board and FINAL component** (RSU, SFA, PAR): the panels are mounted on the RSU and PAR Positions. See §8L.

Not built: WP6's arresting-gear data (DCS has no wires), the carrier's deck-state board and weather beyond night (`adr/0064` B8). `docs/efsp-briefing.md` is the current handoff note.

**Every time EFSP works with is in-game Zulu**: the DCS mission clock, never your PC's clock or real-world UTC. Every typed time (release, void, EDCT, MTR entry and exit, …) is typed as `HHMM` (`1432` or `14:32Z`) and dated by the mission's date: the nearest such time within 12 hours. Anything that is not a time is refused at the cell.

Facility/Position map as it stands:

| Facility | Positions | Notes |
|---|---|---|
| `INCIRLIK` | `OPS`, `CD`, `GND`, `TWR`, `APP` (+ `RSU`, `SFA`, `PAR`, §8L) | Covering chain `CD→GND→TWR→APP` (`SFA`, `PAR` → `APP`; `RSU` has none) |
| `CENTER` | `CTR` | No covering chain (mirrors `OPS`) |
| `CARRIER` | `CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2` | Covering chain `CV_APP2→CV_APP1→CV_MARSHAL`; `CV_PRIFLY` is outside it (§8K) |
| `TACTICAL` | `TAC_C2`, `AIC`, `GCI`, `JTAC` | `AIC`/`GCI`/`JTAC` covered by `TAC_C2`; `AIC` and `JTAC` work only lines `TAC_C2` hands them (§8C1) |
| `RANGES` | derived from the airspace config | One Position per range that has control of its own; works no Strips — see §8A |

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

### `OPS` — Operations (files flight plans; asks Tower for runway changes and signs off runway inspections)

| Bay | Implies state | Intended usage |
|---|---|---|
| `ops-filed` | — | **The filed-plan queue** (§4) — shows every currently-filed DD1801 plan as a card with a one-click "Create Strip," fetched from sourcedcs-web (throttled, refetched at most every 10s while this Bay is open). This is a client-local view, not real Board state — no actual Strip lives here until you press Create on a card, and (unlike every other Bay) it's **no longer a valid drag target**: dropping a Strip here would render nowhere, so both the Bay tab and OPS's Position-tab default were changed to route elsewhere (`ops-proposed`) instead. |
| `ops-proposed` | `PROPOSED` | **Where a newly created Strip lives.** This is the real starting point of the departure lifecycle — every `CreateStrip` from the OPS callsign box lands here (auto-filled from a matching DD1801 when one exists — §4). Get a beacon assigned, then press "Send to Clearance". |
| `ops-field-state` | — | **Inert, and it will stay so.** The runway board (§8G) is getting its own dock panel, not this Bay. Nothing lands here. |
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
| `twr-runway-queue` | `RUNWAY_QUEUE` | Departure sequencing — **one Rack per runway direction** (`rwy-05`, `rwy-23`). Order within a Rack *is* the departure sequence (guide §4.2) — this is the one Bay where Strip order in the Rack is operationally meaningful, not just cosmetic. GND's "To Runway Queue" files a Strip into the Rack of its runway: the one on its flight plan, else the active runway (§8G). |
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

## 4A. Stereo routes — filing by short name

A **stereo route** is a locally-defined canned route the squadron files by a short name instead of
filling in a whole flight plan. This is real practice, not a sim convenience: assigned aircraft at
Kunsan file locally-defined "Pack" routes by phone or email without the international form. The
guide calls it (§9.10) *"the single most authentic-feeling military flight-data behaviour
available."*

Type a callsign, pick `PACK 1`, press **+ New Strip** — the Strip is created with route, altitude,
departure and destination airports and remarks already filled in from the table.

> **The shipped table is empty.** That is deliberate: the real routes are squadron data, and
> inventing plausible-looking ones would put invented content on a Strip where it reads as doctrine.
> **Until you install a table, the stereo picker does not appear at all** and everything works
> exactly as it did before — that is not a bug, it is "no routes configured".

### Installing a table

The file is a JSON array. `name` and `route` are required; everything else is optional.

```jsonc
[
  {
    "name": "PACK 1",                                  // what a controller files it as
    "description": "north MOA and recover",            // shown in the picker
    "departureAirport": "LTAG",
    "destinationAirport": "LTAG",
    "route": "LTAG DCT ADANA DCT TOROS DCT LTAG",      // the expansion — the point of the record
    "requestedAltitude": "250",
    "remarks": "squadron standard"
  },
  {
    "name": "PACK 2",
    "route": "LTAG DCT BRAVO DCT LTAG",
    "active": false                                    // retired: not filable, not in the picker
  }
]
```

Three places it can live, highest priority first:

| Path | Use |
|---|---|
| `CRCSYNC_EFSP_STEREO_ROUTES_PATH` | an explicit override; mostly for tests |
| `crc-sync/state/efsp-stereo-routes.json` | **the live squadron table** — on the `crc-sync-state` volume, survives deploys |
| `crc-sync/config/efsp-stereo-routes.json` | the shipped default, baked into the image (ships `[]`) |

**Restart crc-sync after editing.** The table loads once at startup — there is no editing UI in this
slice, and a running process will not notice the file changed. If the file is malformed, crc-sync
logs a warning and starts with an empty table rather than refusing to boot.

Names are matched loosely: `PACK1`, `pack 1` and `PACK-1` all reach a route the table spells
`"PACK 1"`, and the Strip always shows the table's spelling. Two names that differ only in spacing
or case are rejected as a duplicate when the file loads — they would be the same route to a
controller.

### Filing one

- **The picker.** A dropdown appears beside the callsign box once a table exists. It only shows for
  `OPS`'s DEPARTURE origin — an arrival or a mission line has no filed route a canned departure
  route could seed — and only lists active routes.
- **`.stereo PACK1 VIPER11`** in the dot-command line does the same thing from the keyboard. The
  route name is **one token**: write `PACK1`, not `PACK 1`, and the loose matching above handles it.
  `.stereo` on its own, with an unknown route, or with a bad callsign tells you so in the preview
  line and sends nothing.

Picking a stereo **skips the DD1801 flight-plan lookup** (§4) rather than doing both — filing by
short name is the path taken when there is no filed form, so there is nothing to look up. Leave the
picker blank and §4's automatic pre-fill behaves exactly as before.

An unknown or retired name is **refused**, not quietly turned into a blank Strip, and the reason
appears next to the create box. That is on purpose and is different from the DD1801 lookup, which
degrades to blank: sourcedcs-web being down is a temporary failure, but a name that is not in the
table is simply wrong.

### Switching, and cancelling

The short name shows on the Strip as Block **`STEREO`** (`9F`), next to `RTE`. **It is a picker**:
click it and choose a route from the installed table, in table order. On `OPS` and `CD` it is on the
face; on `GND`, `TWR` and `APP` it is one `▼` away. A route the squadron has retired stays in the list
for a flight already filed with it. With no table installed (and no stereo on the flight) the cell is
plain text and says "no stereo routes configured" on hover.

**Choosing a route in `STEREO` re-files the flight.** *"VIPER11, request change to PACK 2"* is
one edit: the route, altitude, departure and destination are all rewritten from the table, and the
aircraft keeps the squawk and the CID it was already given. This works in both directions — a flight
that filed a plain route the normal way and then asks for the standard route on first contact is the
same edit.

Two things a re-file deliberately leaves alone: **Block 9E (remarks)**, which is your own text and
has nothing to do with the route, and **any clearance you have already issued** — amending what was
*filed* is not the same as re-clearing the aircraft, and that is still a conversation with the pilot.

**Choosing "—" in `STEREO` cancels the stereo without touching the route.** The flight keeps flying
what it was flying, it just stops being labelled as a canned route. "—" is only for "keep this route
but it is not PACK 2 any more": to file a different route, just edit Block 9, which clears the label by
itself.

**Editing Block 9 (the route) also clears the `STEREO` label**, in the other direction. An amended
route is no longer the canned one, and leaving the label would make the Strip claim a route it is not
flying — and would keep a standing release (§7) covering a flight the agreement no longer describes.

A name that is not in the table, or one that has been retired, is **refused and changes nothing at
all** — the Strip is left exactly as it was, with the reason shown. Retiring a route
(`"active": false`) stops new filings and re-files only; a flight already airborne on it keeps its
route and its label.

**Where this lives in code:** `crc-sync/src/efsp/stereo-routes.js` (the table, validation, name
resolution) → `fdr-store.js`'s `createFdr()` (the expansion, server-side) →
`GET /api/stereo-routes` → `crc-desktop/app/server.js` proxy →
`efsp-stereo-routes.js` → `efsp-panel.js`'s picker and `.stereo` verb. Design reasoning is in
`docs/adr/0050`.

## 4B. Reading and amending Blocks

### Reading a Strip (docs/adr/0056)

A Strip has three columns:

- **The tab, on the left.** Its header says the Role and state (`DEP · HANDED OFF`). Under it is
  one row for every exchange in progress — a handoff or other coordination, a TOFI, a MARSA
  relation waiting for rendezvous, an ambiguous track — each with its own buttons and a line
  saying how long it has waited or why it is blocked. At the bottom is the **next step** (the
  NLA). A Strip with something waiting on *you* has an amber edge.
- **The fields, in the middle**, then a row of **indicators**, but only when there is
  something to say (`adr/0058`). A Strip where nothing is wrong has no indicator row at all. In
  order: `STCA`, a conformance warning (`HDG 072`, `ALT ↓`, `BUST +600`, see §8E), `TRK` (only
  when the flight is *not* normally correlated), `AIRBORNE? ▸` and `STALE` (surveillance disagrees with the
  Strip, §8F), `MARSA`, `TOFI`, `AIRSPACE`, a forwarding
  obligation (`VOID TIME EXPIRED`, `ADVANCE FORWARDING`…, see §8), `+N`.
  Colour means something: amber is waiting on you or blocked, orange-red is something wrong;
  everything else is grey. Any reason the Strip owes you (a conflict, why the next step is
  refused, why a TOFI exit is blocked, a MARSA void) is a full line under them.
- **⋯ ▼ ✕ on the right.** **⋯** holds everything you *start*: Coordinate…, TOFI…, Airspace…,
  MARSA…, Bind…, Convert to Arrival, Offset. Something you cannot do right now is still listed,
  greyed, with the reason. **▼** opens the rest of the Blocks. **✕** drops the Strip.

**One-input gestures.** **Alt+click** on a Strip toggles OFFSET and **Ctrl/Cmd+click** steps its
HIGHLIGHT (yellow, cyan, lime, off); both are one input. The `⋯` item and the right-click swatches still
work (two inputs). On macOS Ctrl+click is a context click, so use the swatches there.

### Strip counts and arrivals (docs/adr/0057)

Every Bay tab shows how many Strips are in it, and each Position tab its total.

A Strip that moves into one of your Bays is an **arrival**, whoever moved it:
another controller handing it to you, a handoff or TOFI proposal landing in your
coordination Bay (also when one controller holds both ends, `APP` and `CTR` say: a coordination or TOFI
replica minted for you is an arrival whoever made it), or your own NLA or drag when you work several
Positions at once.

- In a Bay you are **not** looking at: that Bay's tab turns amber with **+N**, the
  Position tab gets an amber dot, and a line appears under the Bay tabs:
  `VIPER11 → twr-runway-queue from GND`. Click it to open the Bay with the Strip
  selected. Opening the Bay clears the tab and the line.
- In the Bay you **are** looking at: the Strip flashes once and keeps an amber edge
  and a **from GND** line in its tab until you touch it, or for 30 seconds.

Not announced: a Strip you just created, a reorder within a Bay, or a change that
leaves a Strip where it was. The "from" line names the Position it came from, or the
Bay when it moved within one Position.

### The fields, and the `▼` button

Each Position sees the fields it works, not all of them: Tower sees HOOK and ORDNANCE (ORDNANCE is always on
Tower's face and on OPS's departure face, where the load state is recorded; on APP, CTR and mission lines it
joins the face only once it is not CLEAN, and is always one `▼` away: a pilot reports hung ordnance to
whoever they are talking to, H55), APP and CTR see FREQ, and on a departure also RELEASE (Block `14A`, the
release state, where the release travels, §7), CTR sees the TOFI fields (`KEEP IFR` is TOFI's `ifrActive`:
the flight stays IFR under tactical control and ATC keeps separating it; hover it), the airfield Positions
see the runway, GND sees TAXI (`17`) and TWR TAKEOFF (`18`). TYPE already carries the aircraft and wake:
clicking it edits the bare aircraft type (Block `3A`); the wake category stays in `▼`. CID and TAIL are on
no Strip. The full table is in `docs/adr/0056`.

Everything else is behind **`▼`** — and *only* the rest: the panel never repeats a Block that is
already a field, so it is the short list of what you cannot otherwise see. One Strip is expanded
at a time, in Block Map order, which is the order of the paper strip.

(The one thing it does repeat is a Block whose history is too long for its field — that is what
the `+N` opens.)

⚠️ **`ALT` and `HDG` are the Blocks §9.2's MARSA interlock watches.** Writing
one on a flight in an active MARSA relation, before rendezvous, voids the relation.
That is the interlock working — but it now fires from the panel, where before it could
only be reached by a dot-command or the server.

### Amendments stay visible (§3.7)

Amending an annotation Block does not overwrite it. The prior value stays in the same
Block, **struck through**, until the Strip is dropped — FAA JO 7110.65 ¶2-3-1's *"do
not erase or overwrite any item."*

- The value in force keeps the field. The value it replaced shows small and struck beside the
  field's label, and **`+N`** counts any older ones; click it for the full chain in the expanded
  view.
- A Block written once shows no history at all.
- **`⌿` strikes a vacated altitude.** It marks the current value struck rather than
  removing it, and it is the controller's call: an altitude must not be struck until
  the aircraft has reported or is observed leaving it. Available on the assigned `ALT`
  of every Role.

### `ALT` and `HDG` belong to the flight, not the Strip

The assigned altitude (`ALT`) and assigned heading (`HDG`) are stored once per flight
(`adr/0058`). Whatever the departure controller clears is what the arrival Strip shows, and
every Strip of a flight shows the same value. The filed cruise altitude on a departure or
overflight is `CRUS ALT`, and changing it is an amendment to the flight plan, not a clearance.

Type an altitude as `FL180`, `A050`, `180` (hundreds of feet) or `5000` (feet), or a **block** as two
altitudes joined by `-`, `B` or `TO`, lower first: `FL220-FL240`, `FL220B240`, `220B240`, `5000-8000`.
A block is stored and shown in one canonical form (`FL220-FL240`; an end at or above the **theater's
transition altitude** and a whole hundred is written as a flight level, anything else in feet, e.g.
`8000-FL100` at Syria's 10,000 ft or `16000-FL200` elsewhere), and the text follows the theater the
mission was in when you typed it (it is not rewritten if the theater later changes). What is stored is
always feet, and `FL100` and `100` both mean 10,000 ft everywhere. A reversed or equal block, a half-written one (`FL220-`) and more than two ends are
refused with the entry unchanged. The MTR's after-exit altitude takes a block too. Type a heading as
`050`. Anything else is refused. `HDG` is usually left empty: set it when you vector, and the
conformance check (§8E) only watches a heading once one is assigned.

### Times: typed as HHMM, and italic estimates

Every time Block (`6`, `14`, `14B`–`14D`, `16`–`18`, the MTR times, and the mission line's vul window
`M6`/`M7`) is **typed as `HHMM`** and shown as `HHMM`; it is stored as an instant on the mission's
calendar. Something that is not a time is refused with the Block's name ("proposed departure time must be
a UTC time as HHMM, e.g. 1432"). The vul window's end is always *after* its start, so `2200`–`0130` runs
overnight; a typed end equal to the start means the next day.

Three times fall back to an estimate until a controller types the actual (§10.5):

| Block | Chain, first wins |
|---|---|
| `6` P-time (departure) | what a controller typed, then the filed DD-1801's item 13 (EOBT), then the ATO |
| `17` TAXI (off-block) | what a controller typed, then an estimate from the P-time |
| `18` TAKEOFF | what a controller typed, then the time the Strip entered Airborne (stamped by crc-sync, an actual, never italic), then an estimate from the off-block time |

- **An italic time is an estimate.** P-time is never italic. Type the actual (`1432`) over an estimate to
  replace it; clear your entry to get the estimate back.
- **Hover the value, or the label in `▼`,** to see where it came from, e.g. *"~1430Z estimate: P-time,
  from the filed DD-1801 (item 13, EOBT)"*. After you have typed one, the hover also says what you would
  get back if you cleared it.
- **Gotchas.** `TAXI` is on GND's face and `TAKEOFF` on TWR's. A `TAXI` or `TAKEOFF` a controller already
  typed does **not** move when the P-time later changes (a controller's entry stops the chain); one typed
  earlier than the (new) proposed departure is shown with a dotted underline and a hover saying why a
  typed time does not follow a P-time. **Retyping the value an estimate shows now accepts it as the
  actual** (the hover says "Type it again to accept it as the actual").
- **Takeoff is stamped for you.** When a DEPARTURE Strip enters Airborne (`DEPARTED`) or `HANDED_OFF` from a
  non-airborne state, crc-sync stamps that mission-clock time (first stamp wins); the hover says "stamped
  when the Strip entered Airborne". Taking the Strip back (Undo, a `SetState` to an earlier state) clears
  it, a Drop keeps it. It is not a plan amendment, so it does not trip the 30-minute amendment obligation.
- **A vul window** (`M6`/`M7`) cannot start at or after its end ("move the end first") nor end at or before
  its start; clearing is always allowed.

## 4C. MTR fields — a flight on a military training route

Six Blocks describe a flight's MTR (guide §9.4). Any Strip can reach them from **▼**:

| Label | Block | What goes in it |
|---|---|---|
| `MTR` | `9G-MTR` | the route designator, e.g. `IR107` |
| `ENTRY` | `9G-ENTRY` | the fix where the flight enters the route |
| `ENTRY TM` | `9G-TIME` | the entry time |
| `EXIT` | `9H-EXIT` | the fix where it leaves |
| `EXIT EST` | `9H-TIME` | the exit estimate |
| `EXIT ALT` | `9H-ALT` | the altitude it **requests** after exit |

**Once any of them has a value, the MTR group appears on the Strip's face as a row of its own**,
with the exit fields first, because the exit is what you need at a glance:

| Strip | Position | On the face |
|---|---|---|
| DEPARTURE, OVERFLIGHT | APP, CTR | all six: MTR · EXIT · EXIT EST · EXIT ALT · ENTRY · ENTRY TM |
| ARRIVAL | APP, CTR | MTR · EXIT · EXIT EST · EXIT ALT |
| any | OPS | MTR · ENTRY · ENTRY TM |
| any | CD | MTR |
| any | GND, TWR | none (still in ▼) |

A MISSION line has no MTR Blocks: the mission line shares the flight with its ATC Strip, and the
route is recorded once, there.

- **Designator and fixes** are free text, upper-cased. There is no route table yet, so nothing
  checks that a fix is on the route.
- **Times** are typed as `1432`, `14:32` or `1432Z`. They are in-game Zulu, and the day is the one
  nearest the mission's current time (within ±12 h), so `0010` typed at `2350Z` means tomorrow.
  Anything else is refused at the cell with the reason.
- **`EXIT ALT`** takes `FL210`, `080` (hundreds of feet) or `8000` (feet); a block altitude
  (`FL190B210`) is refused. It is the pilot's **request**. To approve it, write `ALT`: only `ALT` is
  a clearance, and only `ALT` voids MARSA before rendezvous (§8D).
- **The lost-comms rule** is a grey note at the top of ▼, and the hover title on the `EXIT ALT`
  label. It names the `ALT` clearance in force and says that minimum IFR altitudes are not in the
  system. It never appears on the face.
- **Clearing.** The row goes when every MTR field is empty. Clearing `MTR` alone leaves the exit
  data on the face, which is deliberate: stale exit data stays in sight until you deal with it.

Two things to know when a pilot changes his plan:

- **An MTR amendment overwrites.** Unlike the annotation Blocks (§4B), the previous exit fix,
  estimate or altitude is kept nowhere, so the Strip cannot answer "what was his old exit?".
- **Changing only the designator leaves the old exit fix in place with no warning.** Update or
  clear the other fields yourself.

## 5. Strip fields

```
Strip {
  stripId          UUID, immutable identity
  cid               3-digit sequential display code (Block 4) — [SOURCE-DEFINED] format
  fdrId             reference to the FDR this Strip presents (§6)
  rev               optimistic-concurrency counter — every Mutation must supply the baseRev it read
  role              'DEPARTURE' | 'ARRIVAL' | 'OVERFLIGHT' | 'MISSION' — picks which Block Map/NLA table applies
  state             the EfspState (Block 25) — see the tables in §2
  ownerPositionId   which Position currently controls this Strip (guide §4.4) — exactly one at a time
  bayId / rackId    current placement — which Bay/Rack it's sitting in (§3)
  orderKey          fractional-index string; sort order within a Rack
  annotations       { blockId: { blockId, entries: [{value, status, at, by}] } } — §3.7 append-only cells (below)
  flags             { offset, flipped, removeIndicator, highlight, attention } — the four paper gestures (below)
  correlation       which contact on the scope this Strip is — WP5, live. See §8C
  coordination      null, or the WP4A cross-Facility exchange record — see §8
  createdAt/updatedAt/updatedBy
}
```

**`flags`** — the "paper gestures" (guide §7.3), each one Mutation (`SetFlag`):
- `offset` (bool) — visually indents the Strip (⇥ button), no server meaning beyond display.
- `flipped` (bool) — shows only the callsign (Block 1), hides everything else (double-click to toggle).
- `removeIndicator` (bool) — set automatically by `DropStrip`; distinct from actual deletion (a `DROPPED` Strip stays on the server, just off the visible Board, until it is archived (§8J)).
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
    beaconObserved                                                  — what the aircraft is ACTUALLY squawking, from its correlated contact
    modeOne, modeTwo                                                — WP7/ATO-owned: written only by the ATO import (§8I), never by a controller (defect D24 guard)
    tailNumber, unit, homeStation
    trackDegradationFlag ('NONE'|'CST'|'FAIL'|'IF'|'NT'|'TRK')      — WP4A, radar-track quality (NOT equipment — see `degradation` above)
  }
  filed: {
    route, requestedAltitude, departureAirport, departureRunway, destinationAirport,
    proposedDepartureTimeUtc, fullRouteClearance, remarks,
    stereoRouteName (Block 9F)                                      — §9.10; writing it re-files the flight from the route table; cleared when `route` is amended (§4A)
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
  military: {                                                       — WP6, guide §6.4's military extension namespace (docs/adr/0052)
    ordnanceState ('CLEAN'|'LOADED'|'HUNG'|'EXPENDED')              — Block 3G, a picker. Setting HUNG raises the advisory chip (below)
    hookRequired (bool)                                             — Block 3F, a ✓ toggle. Means this aircraft REQUIRES arresting gear, not merely that it has a tailhook
    alertStatus ('NONE'|'ALERT'|'SCRAMBLE')                         — Block 14E, DEPARTURE only (§8H)
    mtr: { designator, entryFix, entryTimeUtc,
           exitFix, exitEstimateUtc, requestedAltitudeAfterExit }   — §9.4, Blocks 9G-* / 9H-* (§4C). Times are epoch ms, typed as HHMM
    altrvRef, arInfo, scl, fuelState, releaseAuthority              — present and unpopulated, no setter (guide §12)
  }
  trackRef      null   — permanently null; the correlation is its own record, keyed by fdrId (see §8C)
  airspace: { owner (null|'CONTROLLING_AGENCY'|'USING_AGENCY'), changedAt, changedBy }  — WP4A, §4.6.4, direction only, never a boolean
  provenance    { [path]: 'COMPUTER_GENERATED'|'CONTROLLER_ENTERED'|'SYSTEM_DERIVED' }
  createdAt/updatedAt/updatedBy
}
```

**Subbucket usage, in plain terms:**
- **`identity`** — "who/what is this aircraft" (callsign, type, squawk, equipment). Mostly filled at creation; `beaconAssigned` is minted automatically unless overridden.
- **`beaconAssigned` and `beaconObserved` are two fields on purpose**, and comparing them is the point: they match (all well), they differ (the pilot is squawking the wrong code — the Strip shows `TRK?`), or observed is null (assigned, nothing received — either the transponder is off or nothing has correlated yet). Collapsing them into one would hide a mismatch entirely, which is a defect the guide names by number. `beaconObserved` is written by the correlation subsystem, never by a controller.
- **`filed`** — "what the pilot/flight plan asked for" (route, altitude, airports, times). This is what `isFlightPlanValid` checks before `CLEARED` is reachable, and what §4's pre-fill populates.
- **`assigned`** — "what ATC has actually granted" (clearance, release state/timing, ATIS code, movement times). This is the bucket that changes as a flight progresses through the departure sequence.
- **`airspace`** — WP4A only, a delegated-airspace direction, orthogonal to everything else.
- **`military`** — guide §6.4's military extension namespace. Two single fields are live and enterable from the Strip: **Block 3G (`ORDNANCE`)**, a four-value picker, and **Block 3F (`HOOK`)**, a ✓ toggle; so are the six MTR fields (§4C). Both sit in the 3-family beside aircraft type and tail number, because they are facts about the airframe, and both are on DEPARTURE, ARRIVAL and OVERFLIGHT Strips. Everything else in the object is present but unwritable — the field exists so its arrival later is not a schema change, and the server refuses a write to it by name rather than ignoring one.
  - **`HOOK` ✓ means the aircraft requires arresting gear.** It is not "has a tailhook". The `HOOK` chip (§8G) reads it that way, and only when a runway has configured gear. DCS does not simulate arresting wires, so the runway's gear is kept as data only, and Incirlik has none configured.
  - **Setting `ORDNANCE` to `HUNG` raises an amber `HUNG` chip on every Position's Strip for that flight** (and on the mission line, which shares the FDR), with one reason line: *"Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller's call. Runway 05/23 (05) assigned."* On a departure it says "if it returns". The runway named is whatever the Strip resolves to (its runway Rack, then 8A/8B, then the active end); the line never recommends one, and the pad is a name with no position. **It is advice only: it never disables the next-step button, never reorders a queue, and the flight lands, taxis and drops as usual.** Set `CLEAN` or `EXPENDED` when the pilot reports the store safe and the chip goes. Nothing is raised for `LOADED`. With no field state (a Facility with no inventory) the line reads "The hot cargo pad is shown when field state is available."
  - **ORDNANCE is on the mission line too** (`3G` on `MISSION`, H55) because it is the same field as on the ATC twin. HOOK is not: it gates a runway, which a mission line never uses.
  - The guide numbers these `M14`/`M15` in its §6.4 table. **Those numbers are not used as Block ids here** — the `M`-prefix belongs to the MISSION Strip's own Block Map, which uses `M1`–`M8` with different meanings. The mapping between the guide's numbers and this system's Block ids is in `docs/adr/0052`.
- **`trackRef`** — permanently null, and kept only so its absence isn't a schema change later. The correlation lives in its own store keyed by `fdrId`, because one flight can have several Strips and they are all the same aircraft — see §8C.

## 7. Release states (why a Strip can be stuck at CLEARED/HELD)

Set the release state on Block **14A** (`RELEASE`, a picker; it was labelled `RLS ST` before UI-A) and, for a void time, Block **14D**.
Anything other than `RELEASED` holds the Strip at `CLEARED` — move it to `HELD`, which is what
`HELD` means, and the time-based gates below are checked there.

| `releaseState` | Meaning | What un-sticks it |
|---|---|---|
| `RELEASED` | Normal — no hold | n/a |
| `HOLD_FOR_RELEASE` | Held pending a standing-release match or explicit coordination | Matches a facility-configured `standingReleases` envelope (route/altitude), or file `OPERATIONAL_REQUEST` (§8) |
| `RELEASE_TIME` | Earliest departure time set | `releaseTimeUtc` must have passed |
| `CLEARANCE_VOID_TIME` | Void-time clearance | Must depart before `voidDeadlineUtc` (= `voidTimeUtc` + 30min) or the clearance expires |
| `EDCT` | Expected Departure Clearance Time | Window is `edctTimeUtc` ± 5 min |
| `CALL_FOR_RELEASE` | Call-for-release procedure | Window is `callForReleaseTimeUtc` − 2 / + 1 min |

`HELD`'s NLA ("Release") is inhibited when the release time has not been reached, when an EDCT or
call-for-release window is not open yet **or has already passed** (a missed slot needs a new one),
when a `HOLD_FOR_RELEASE` flight matches no standing-release envelope, or when the void time has
expired. `CLEARED`'s NLA is inhibited on anything other than `RELEASED`.

**Standing releases and stereo routes.** An envelope's `stereoRoute` is matched against the flight's
filed **short name** (§4A) when it has one, and against its route string when it does not. So an
envelope written as `"stereoRoute": "PACK 1"` covers every flight filed on PACK 1, whatever the
expansion is — and stops covering one the moment somebody amends its route, because that clears the
label. Envelopes configured before stereo routes existed, which named a route string, still work
unchanged.

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

### Forwarding obligations — the timer indicator

Some things have to happen by a time: forward an arrival at least 15 minutes before it reaches
the next Facility, forward again when its estimate moves by more than 3 minutes, get a void-time
flight airborne before its deadline, get an airspace activated before a flight works in it. When
one comes due, the Strip shows it by name in the indicator row (`ADVANCE FORWARDING`,
`VOID TIME EXPIRED`, …), amber while it is due and orange-red once it is overdue.
`ADVANCE FORWARDING` turns from amber to red when the ETA passes.

**It clears itself** the moment it is no longer due: the arrival forwarded, the void-expired flight
re-cleared or released, the airspace activated. There is nothing to acknowledge, and a reload or
reconnect shows only what is due now. `AMENDMENT INSIDE 30MIN` shows for about a minute after the
amendment, then clears. The one exception is `DATA ONLY VERIFICATION` (verify with a data-only
Facility within 3 minutes of accepting): there is no "verified" action yet, so once due it stays
raised.

## 8A. Airspace: MOAs, ranges and working frequencies

Open **Panels → AIRSPACE** for the airspace board. It is a separate panel from the Strip panel
because a range holds no Strips — you can have both open at once.

**Defining airspaces.** `crc-sync/config/efsp-airspaces.json` ships empty; nothing appears on the
board until it is filled in. One entry per MOA or range:

```json
[
  {
    "airspaceId": "MOA-EAST",
    "name": "East MOA",
    "type": "MOA",
    "controllingFacilityId": "CENTER",
    "controllingPositionId": "CTR",
    "workingFrequencyMhz": 134.25
  },
  {
    "airspaceId": "RANGE-SOUTH",
    "name": "South A/G Range",
    "type": "RANGE",
    "controllingFacilityId": "INCIRLIK",
    "controllingPositionId": "APP",
    "usingPositionId": "SOUTH_RANGE",
    "controlFrequencyMhz": 283.5
  }
]
```

- `controllingPositionId` is **who approves activation** — the Position that owns the airspace the
  MOA sits in. For the MOAs around Incirlik that is Ankara Center (`CTR`), not Incirlik Approach.
- `usingPositionId` is **only** for a range with a control tower of its own. Including it creates a
  Position under a `RANGES` Facility that somebody can act as; leaving it out (the ordinary MOA
  case) creates no Position at all, and the controlling Position runs the airspace by itself.
- `type` is one of `MOA`, `RANGE`, `DANGER`, `RESTRICTED`, `PROHIBITED`, `WARNING` — the FAA and
  ICAO names for overlapping things, since what the FAA calls a MOA is usually charted as a danger
  or restricted area here. It is a **label only**: nothing in the system behaves differently because
  of it, and nothing may — separation regime in particular is never derived from airspace type.
- Frequencies are **MHz as a number**, 30–400. A range's `controlFrequencyMhz` is its tower; a
  MOA's `workingFrequencyMhz` is what flights working inside it go to.
- `altLowerFt` / `altUpperFt` are optional published vertical limits, in whole feet. When set, any
  altitude block assigned to a flight has to fit inside them.
- crc-sync must be restarted after editing this file.

**The lifecycle.** `RETURNED` (available) → `SCHEDULED` (booked) → `ACTIVE` (in use) → `RELEASED`
(the using agency is finished) → `RETURNED` again. A range schedules its own airspace and requests
activation; the controlling ATC Position approves it, and takes it back at the end. A MOA with no
range control skips the request — its controlling Position schedules and activates directly.

If you hold both sides, you still press both buttons: the state changes are real, only the
conversation with another controller collapses.

**Putting a flight in.** On the Strip, **Airspace…** → pick the airspace → *Approve entry*. The
flight's frequency (Block 22, `FREQ`) is filled from the airspace, and a badge on the Strip names
where it is working. **Leave airspace** clears both. You keep the Strip throughout — approving a
frequency change hands over nothing.

Approving a flight into an airspace nobody has activated is allowed, not blocked — the block may
well be hot with the board simply not caught up — but the badge turns amber and an alert is raised.
Releasing a block with flights still in it is allowed for the same reason, and warns the same way.

**Sharing a block by altitude.** Approving entry takes an optional altitude block, which is how two
aircraft use one area: hold the working flight down to 5,000–15,000 while a transit crosses at
20,000–28,000. Re-issuing the approval on a flight already in that airspace **amends** the
restriction rather than being refused, so tightening it and later lifting it (pass `null`) are both
one action. No restriction at all is not the same as a restriction covering the whole area — the
first says nobody has deconflicted this flight yet, the second says somebody has. The board shows
each flight's block next to its callsign.

## 8B. Radar coverage — it follows what you're acting as

**There is no radar selector any more.** What you can see on the scope is decided by the Positions you
hold under **ACTING AS**, not by anything you tick. The Coverage list in the same panel is read-only:
it tells you which radars your Positions give you, and which Position gave you each one.

| Holding | You see |
|---|---|
| `TWR` | Incirlik's field surveillance radar (40 nm, and the only one that shows ground vehicles) |
| `APP` | that, plus the approach radar (80 nm) — you are the RAPCON |
| `CTR` | every airfield's approach radar in the theater, i.e. the en-route picture |
| `TAC_C2` / `AIC` / `GCI` | the own-coalition airborne picture (AWACS and fighter radars) |
| `OPS`, `CD`, `GND`, `JTAC` | **nothing** |

That last row is deliberate, not a fault. Ground and Clearance Delivery have no scope in any real
facility, so holding only those shows an empty map and a banner saying **NO RADAR COVERAGE — HOLD A
RADAR POSITION**. If you need the picture, take a radar Position; you will get it the moment you do.

Two consequences worth knowing:

- **Everyone holding the same Position sees the same thing**, down to when each contact's beam passed
  over it. Observers included — you get the picture for a Position somebody else is Primary at.
- **The picture can change without you touching anything**, when a colleague takes or hands back a
  Position, or when an AWACS takes off. The Coverage list is the place to look.

A radar whose aircraft is on the ground is listed with `GND` beside it and shows nothing — that is a
parked AWACS, not a fault. Which scope sits at which console is squadron configuration
(`positionRadars` in the facility config), and the shipped defaults are a guess.

## 8C. Correlation — how a Strip finds its contact

A Strip whose flight is correlated normally shows no badge at all. Anything else shows one:

| Badge | Means | What to do |
|---|---|---|
| *(nothing)* | **correlated**, by beacon code, callsign or a controller's binding. The contact on the scope now carries this Strip's callsign | nothing |
| `TRK?` | **provisional.** Hover it: usually the contact is squawking a different code from the one you assigned, or the callsign only nearly matches | check the squawk; bind it if you are sure |
| `NO TRK` | **uncorrelated.** Nothing on your scope matches this flight | `Bind…` it if you can see which one it is |
| `TRK ×2` | **ambiguous.** Two contacts match equally well, and the system will not guess | click it and pick the right one |
| `TRK ··` | **correlated, but the contact is outside your coverage.** Somebody else's radar has it; yours does not | nothing — it is not yours to see |

`NO TRK` in a warmer colour, with a coloured edge on the Strip, means something stronger: the contact
this flight *was* on has gone. That is different from never having found one, and it is worth a look.

That `TRK ··` row is worth understanding, because it is the seam between two ideas. Correlation is
worked out once, server-side, against every contact the server knows about — it is a fact about the
flight. Coverage is per-Position and is about *you*. So a flight can be correctly bound to a contact
that simply is not on your scope, which is the normal case for an en-route flight when you are working
Tower. Nothing is wrong, and there is nothing to click.

**`Bind…` is the override, and it wins over everything.** A jet with its transponder off, under a
callsign DCS spells differently from the flight plan, will not match automatically — but if you can
see it, you can say so, and the binding sticks until you `Unbind` it. It is also how you settle a
`TRK ×2`. From the keyboard: `.bind <track id>` and `.unbind` on the selected Strip.

**Clicking works both ways.** Click a Strip and its contact gets a ring on the map. Click a contact
and its Strip is selected and scrolled into view. Clicking a contact that has no Strip leaves your
Strip selection alone — the absence of a ring is the answer.

**After a DCS mission reload, every Strip briefly says `NO TRK` and then re-binds itself on the
squawk, usually within a second.** That is correct and expected: a reload gives every aircraft a new
internal identity, so the system drops the old one loudly rather than quietly pointing at something
that no longer exists. A flight whose transponder is off will stay `NO TRK` until somebody binds it.

The panel header shows a rate — `TRK 96% (24/25)` — of how many flights that could have a contact
have one. It turns amber below 95%, which the guide treats as a defect rather than a fact of life. A
flight still on the ramp is not counted.

## 8C1. TOFI — handing a flight to the military, and the mission line

Two records, one flight. The **ATC Strip** stays live and posted the whole time — the
flight keeps its IFR clearance, keeps its ATC squawk, and ATC still separates
non-participating traffic from it. The **mission line** is the MRU's own record of the
same aircraft, worked by `TAC_C2` or `GCI`.

### Fragging the mission line (`TAC_C2`)

**Do this at tasking, not at the boundary.** Pick `TAC_C2 · Mission` in the New Strip
toolbar and choose the flight from the **bind picker** beside it — rows read
`VIPER11 · 4201 · LTAG DCT ALPHA`, so two jets in one package with adjacent callsigns
are distinguishable. Or type `.mission VIPER11`.

- The mission line lands in **Tasked** and shares the flight's FDR, so it shows that
  flight's callsign and **its squawk** — one Mode 3/A, never a second. If the callsign
  is wrong you picked the wrong jet: drop it and frag another. There is no re-bind.
- Leave the picker blank for a mission that never touches ATC airspace at all — that
  files a standalone mission line with its own flight, as before.
- One flight gets **one** mission line. A second is refused, naming who holds it.
- Both Strips show a blue **`+1`**. Hover it: it names the other Strip's Facility,
  Position and Role, which is how the ATC controller spots a mis-bind.

The mission line then advances on its own — Tasked → Airborne → On Station → … —
**independently of what the departure is doing**. It is a plan, not a clearance; it is
normal for it to run ahead of, or behind, the ATC side.

### The handshake (`CTR` ⇄ `TAC_C2`/`GCI`)

TOFI is the exchange that moves tactical control. It is **not** what creates the
mission line, and it is deliberately only available once the flight is airborne and
being worked enroute (`HANDED_OFF` / `INBOUND` / `TRANSITING`).

1. `CTR` presses **TOFI…**, picks the counterpart, and sends. If the flight already
   has a mission line the proposal lands **on it** — no second Strip appears, and it
   does not move out of the Bay it is in.
2. The MRU presses **Accept TOFI Entry** — and **must pick a separation regime** from
   the `<select>` beside the button. This is what the FDR records as the answer to
   "who is separating this aircraft", and it is asked rather than guessed because it
   comes from the governing agreement. An accept without one is refused.
3. **Transfer Comms** is a separate press, from either side.

### Getting it back

`CTR` presses **TOFI Exit**, then the MRU accepts. When the paired mission line goes **Off Station** or
**RTB** while the ATC Strip's TOFI is active, the next-step slot on `CTR`'s Strip becomes a filled
**TOFI Exit** button (the ordinary next step would be Drop or Hand on, both blocked under an active TOFI);
the `⋯` item stays. Exit is the safety-critical
direction, so it is refused until **`SREG` is set back to `ATC`** — and only `CTR` can
do that, because `SREG` lives on the ATC-side Strip. If the MRU's Accept is greyed
out, that is why, and the tooltip says so.

⚠️ **While tactical control is ACTIVE, neither Strip can be dropped.** That is
deliberate — the flight is still flying and still yours. The way out is the exit above,
not a drop.

### Working a line as `AIC` or `JTAC`

`TAC_C2` owns a mission line's lifecycle; `AIC` and `JTAC` work a line only while `TAC_C2` has
handed it to them. What each Position may do is a capability table in `permission.js` (ADR `0080`), not
an accident of who owns the Strip. A refusal now says why (`TAC_C2 holds this Strip`, `ON_STATION is not
AIC's to change`).

- **AIC.** At check-in (the line is already **On Station**) `TAC_C2` transfers it to `aic-on-station`.
  AIC annotates it and moves it between On Station and Committed, but **cannot advance its state**: the
  next-step button is disabled with the reason, `SetState` is refused, and there is no Coordinate or TOFI
  on an AIC line. When the flight is done AIC hands it back from the `⋯` menu (**Hand back to TAC_C2**)
  or by dragging it to the `TAC_C2` tab, and `TAC_C2` takes it Off Station. AIC can hand a line to
  nobody but `TAC_C2`.
- **The TOFI exit on an AIC-held line is `TAC_C2`'s to answer.** `TAC_C2` accepts `CTR`'s exit (AIC
  "works under `TAC_C2`'s TOFI"). A controller holding both seats answers it from the AIC tab and it is
  sent as `TAC_C2`. A held `TAC_C2` also gets a **"with AIC/JTAC"** tab, only while there is something in
  it, listing the live MISSION lines AIC and JTAC hold, so a `TAC_C2`-only controller can see one and Accept
  `CTR`'s exit from the panel. It is read-only guidance: nothing can be dropped on it, and it lists mission
  lines only. **Gap:** a line `GCI` holds is not listed (GCI is not a `TAC_C2` delegate).
- **JTAC.** A JTAC is **sent only the lines `TAC_C2` has handed it**: its Strips, FDRs, correlations,
  MARSA and alerts for those flights, and nothing else on any Board. It annotates nothing, binds no
  contact, declares no MARSA, and can only **hand back** (to `TAC_C2`). A JTAC who leaves the seat leaves
  the line with `TAC_C2`. (A controller holding nothing but `JTAC` at the Facility is not given drop-only tabs
  for the other Positions, H59.) An observer of `TAC_C2` reads
  everything `TAC_C2` does.
- **A covering Position.** When a Position leaves, Strips routed to its cover land in the cover's own Bay
  for the line's state (else its first Bay implying no state, else they stay put with a warning, and the
  ack reports how many were `unplaced`). They carry `coveredFrom`, and go back to the Position they came
  from when it is manned again. The chain at `TACTICAL` is `AIC`/`GCI`/`JTAC` → `TAC_C2`. An unmanned
  Position with Strips and no cover still warns `routedTo: null`.
- **Coordination.** The proposer can **Cancel** an open proposal, or **End** an accepted exchange, from the
  `⋯` menu. If the receiver drops its side, the exchange ends on the proposer's Strip too (the link is
  cleared, not marked with a new state). Only a live (PROPOSED or ACTIVE) link ends: a completed handoff has
  moved ownership, so a later ordinary drop by the receiver does not touch the sender's Strip.
- **OPS alert status** is set by `OPS` at every state until the Strip is dropped (§8H).
- A `SetState` to `DROPPED` is a Drop, and is refused under an open proposal or active TOFI like one.

## 8D. MARSA — when the military separates its own

**MARSA** is *Military Authority Assumes Responsibility for Separation of Aircraft*. It is a
relationship between two or more flights, not a checkbox on one — so it lives on every participant's
Strip at once, and ending it ends it for all of them.

The usual case is air refuelling: the tanker tells you it is accepting MARSA, and from that moment
you stop separating it from its receivers. **You record the declaration; you do not make it.** That
is why the form asks who said it.

### Declaring one

`MARSA…` on the Strip, or `.marsa VIPER11` on the selected Strip (add a second callsign —
`.marsa VIPER11 SHELL71` — if the flight that declared it is not the one you have selected).

Pick the other flight, the start event, and when it ends. The typed form defaults to the refuelling
case (tanker accepted / until vertically positioned); the popover is where you pick an MTR entry or a
local declaration instead.

A flight is in **at most one** relation at a time. Once one is running, `.marsa <CALLSIGN>` means
"this flight is joining us" rather than "start another one".

### The badge, and the one that matters

| Badge | Means | What to do |
|---|---|---|
| `MARSA ⚠` | **declared, but they have not joined up yet.** The interlock is live | see below before you assign anything |
| `MARSA` | **joined up.** Rendezvous is marked, the interlock is spent | nothing |
| `MARSA ✕` | **voided.** Hover it — it says why. ATC is separating them again from that moment | resume separating them |

Selecting any participant outlines the others, so you can see at a glance who is in it.

### The interlock — the thing to know before you touch anything

> **While the badge reads `MARSA ⚠`, assigning a heading or an altitude to any participant voids the
> relation.**

That is doctrine, not a panel quirk: issuing a course or altitude change before the rendezvous breaks
the join-up, so the military can no longer be assumed to be separating them. The panel does **not**
refuse your clearance — it goes through, and MARSA ends underneath it, with every participant's Strip
showing `MARSA ✕` and the reason. Separation is yours again.

The Blocks that trip it are the ones that mean *ATC assigned this*:

| Strip | Heading | Altitude |
|---|---|---|
| Every Role | `HDG` | `ALT` |

Both belong to the flight (§4B), so assigning either at *any* Position voids the relation.

Amending the **filed** requested altitude (a departure's `CRUS ALT` chip) is not an assignment and does not
void anything. Neither does confirming a vacated altitude — that records where the aircraft has
*been*, not where you are sending it.

Once they are joined up, press **Mark rendezvous** (or `.rendezvous`). The badge drops to `MARSA` and
you can climb the tanker without voiding anything. Nothing marks it for you: whether two aircraft
have joined up is your call, not something the panel infers from the radar picture.

### Changing one

- **A late joiner** — `Add a flight…`, or `.marsa <CALLSIGN>` on a participant's Strip. The relation
  keeps its history; it is not restarted.
- **One breaking off** — `Remove this flight` on that flight's own Strip. The rest carry on. Remove
  the second-to-last and the relation ends by itself.
- **Done normally** — `End MARSA`, or `.endmarsa`.
- **Taking separation back early** — `Void MARSA`, or `.voidmarsa`.

Ending or voiding sets every participant's separation regime back to `ATC` for you.

**You cannot edit the `SEP REG` Block while a relation is live.** It would let the Strip and the
relation disagree about who is separating the aircraft. End or void the relation instead — that is
the thing you were reaching for anyway, and it sets the field back as part of doing it.

**A relation survives a crc-sync restart.** A tanker's declaration does not stop being true because
the server bounced, so it comes back exactly as it was, rendezvous and all.

## 8E. Conformance and short-term conflict alerts

crc-sync compares every correlated flight with its `ALT` and `HDG` once a second, and every pair of
airborne contacts with each other (`adr/0058`). **Nothing is shown when nothing is wrong.** When
something is, the Strip gets an orange-red edge, an indicator and a reason line, the data block on
the scope gets a coloured tag, and the track panel lists it.

| Indicator | Means |
|---|---|
| `HDG 072` | more than 5° off the assigned heading for 10 s (after 30 s to make the turn). The number is where it is actually going, **magnetic**; where the variation is unknown the heading is not checked at all |
| `ALT ↓` / `ALT ↑` | going the wrong way: told to climb and descending, or the reverse, faster than 500 ft/min |
| `BUST +600` | it reached its `ALT` and has since left it by more than 500 ft |
| `STCA SNAKE21 0:55` | on present course and rate it will be within 3 NM and 1,000 ft of SNAKE21 in 55 s. Only at an ATC Position (TWR, APP, CTR…), and only when both aircraft are on your scope |

Not a warning: a flight that has not started its climb or descent yet ("descend when ready"). Only
a flight going the opposite way alerts. Route conformance and terrain are not checked yet.

On the scope, an STCA conflict draws each aircraft's predicted path to the closest point and a line
between them there. Aircraft in the same active MARSA relation never raise STCA against each
other. Traffic without Strips still does. The tactical Positions get no STCA — a squadron
decision (`adr/0059`, `[SOURCE-DEFINED]`), not a statement of real-world doctrine.

Against a **block altitude** the deviation is zero anywhere inside the block and the distance to the
nearest edge outside it (same 400 ft reached / 500 ft bust tolerances, wrong-way means climbing away from
a block above or descending away from one below). The track panel and the scope's data block show the
block. The Strip's conformance reason line still quotes the nearest edge ("from FL240") rather than the
block. STCA does not read the assigned altitude at all.

Altitudes are compared as the controller reads them, on QNH below the transition altitude and as
flight levels above it. The thresholds are in crc-sync's `config/alerting.json`.

## 8F. Reading a contact — what your sensors can tell you

A contact on the scope shows only what the radars and links of the Positions **you** hold could
know (`adr/0059`). The same aircraft can read differently at two consoles.

| You see | Because |
|---|---|
| `TN00042`, no altitude | a primary return only: your radar has it, but either it does not interrogate or the aircraft is not squawking |
| `6123` / `080 G250` | it is squawking (code, Mode C altitude) and nothing identifies it yet. 6000–6777 is an AI aircraft's code |
| `VIPER11` / `180 G450` / `4521` | correlated to a Strip: its callsign is the Strip's, and its code sits underneath |
| `COLT31?` | correlated **provisionally** — check it |
| `230*` | an altitude from a height-finding radar (AWACS, fighter, carrier), not from the aircraft |
| `Enfield11` / `210L` | a datalink report from one of your own aircraft (tactical Positions) |
| `EMR` / `RDF` / `HIJ` in colour | squawking 7700 / 7600 / 7500 |

- **A player with no SRS client has no transponder.** Approach and tower radars see them as a track
  number with no altitude until SRS is running.
- **Airfield and approach radars are 2D with SSR.** Their altitude always comes from the aircraft.
- **Tags** (the track panel's text box, or clicking a ground vehicle) name a contact nothing else
  identifies, for everybody. A correlated flight's callsign takes over from a tag, and the box
  is disabled while it does.
- **The datalink** (TAC_C2, AIC, GCI) shows your own participating aircraft even with no radar
  on them, with dashed lines to what their radars are locked on — but only to contacts your own
  picture already has.
- The track panel's *Flight Plan* is the correlated flight's filed plan. **OVERLAY ROUTE** plots it.

### What the colours mean — IFF from interrogation

A contact's colour is what **your** radars' interrogators got back (`adr/0066`, `adr/0084`), not
the game's idea of which side it is on:

| Colour | Means |
|---|---|
| **Blue** (friendly) | it reports on your datalink, or one of your radars got a valid Mode 4 reply. Only our own side has the keys. Tactical radars (AWACS, fighter, ship) and the military field radars (tower, approach, carrier approach) all ask Mode 4 |
| **Grey** (neutral) | it answered Mode 3/C (it squawks a code) but gave no valid Mode 4 reply |
| **Yellow** (bogey) | nothing answered: it is silent, or your radar asks nothing |
| **Orange** (bandit) / **red** (hostile) | only a controller's declaration. Automatic IFF never gives either |

- **Two controllers can see one aircraft in different colours.** Each sees what their own
  Positions' radars know. Holding a tactical and an ATC radar, the tactical answer wins.
- A declaration shows at once. An automatic change (a pilot switching Mode 4 on) shows with the
  next sweep of a radar that sees it.
- Own AI aircraft and ships answer Mode 4 by themselves. Ground vehicles answer nothing, so they are
  bogeys unless somebody declares them.
- **For pilots:** turn Mode 4 on, or you are grey. With no SRS client you have no transponder at all
  and are a yellow primary return, unless your aircraft reports on the datalink.
- **Nothing on the ground is hidden.** The tower sees every aircraft on the ground within its
  radar's reach, enemy ramps included. That is on purpose for now.

### The ATC scope: STARS-style blocks (TWR, APP, CTR)

If you hold an ATC Position, contacts that only an airfield, approach or carrier-approach radar sees are
drawn the way a STARS scope draws them. A contact is still drawn the tactical way while any tactical
radar (AWACS, fighter, ship) or the datalink sees it, and a controller who holds no ATC Position sees the
tactical scheme only. What a block shows depends on **your relation to the flight**, not on whose side it
is:

| You see | Means |
|---|---|
| white block, your letter | **yours** (a Full Data Block) |
| flashing white block | being handed **to you** (click the blue disc to accept) |
| flashing yellow block with `PO` | a point-out **to you**; steady yellow once accepted, then a click turns it green, a second click makes it a green partial block |
| green `alt gs` (e.g. `120 28`) | **someone else's** (a Partial Data Block). The letter on the blue disc says whose: `T` Tower, `A` Approach, `C` Center, `M` a tactical Position (all tactical Positions, JTAC included) |
| green `code` / `alt` with `*` | squawking, **no flight plan** |
| `+` alone | primary return only |

Altitude is Mode C in hundreds of feet; ground speed is in tens of knots and alternates with the aircraft
type every 2 s; an assigned altitude shows with a trend arrow (`A060↓ H250`, or a block `A060B080`) and
an assigned heading (magnetic, as you typed it). Line 0, above the block, stacks by severity: `EM`/`RF`/
`HJ` (emergency), `CA` (a conflict alert), `SA` (a contact someone has declared **hostile**), then the
conformance tag (§8E, drawn in the app's own orange, not STARS's). A provisional correlation keeps its
`?`. `CST` means your correlated flight has stopped returning (after two sweeps of the slowest ATC radar,
6 s if none says how often).

- **Click the disc** to accept a handoff or point-out (it sends the same `ACCEPT` the Strip's button
  does), to acknowledge `EM` or `CA`, or to step a block down or expand it. **Click the block** for the
  track panel. Acknowledgements and click-downs are local to your scope and are not synced, as on STARS.
- A handoff you sent blinks for 5 s once accepted, then stays white until you click it green, then
  partial. It blinks only for something *this scope saw happen*: a reconnect shows the settled picture.
  A same-Facility transfer (TWR drags a Strip to APP) blinks at the sender too. `UN` blinks when a
  point-out you sent was rejected.
- **Settings → Map Overlays → "ATC Map Background"** off gives a strict black STARS scope, **only** when
  every radar you see is an ATC radar and there is no datalink.
- `M` means the flight is under tactical control after TOFI (§8C1). Letters for non-radar Positions:
  `OPS` `O`, `CD` `D`, `GND` `G`.

*What is ours, not doctrine:* `SA` on a hostile declaration, the single `M` for every tactical Position,
the colours (the approved mockup's) and the coast timing.

### When the picture disagrees with the Strip (surveillance informs, you advance)

crc-sync watches the contact a Strip is correlated to and tells you when the Strip and the aircraft
disagree. **It never moves a Strip by itself**; the controller does (`adr/0076`).

- **"Detected airborne"** means a *correlated* contact (never a provisional one) that is an aircraft, at
  60 kt or more, at least 200 ft above the nearest airfield while within its 5 km footprint (speed alone
  beyond it), for 5 seconds. The numbers are in `config/efsp-surveillance-hints.json`, read once at
  startup, and `[SOURCE-DEFINED]`: this guide says "a configured threshold" only.
- **`AIRBORNE? ▸`** (amber chip) appears on a DEPARTURE Strip that is still in PUSHBACK, TAXI, RUNWAY_QUEUE
  or LUAW once its aircraft is detected airborne. **Click it to advance the Strip to Airborne**, the same
  `SetState` you would send yourself with every rule on it (so it is refused while the runway is suspended,
  as the Airborne step is). It is a click target only for a Position you hold that owns the Strip; for
  anyone else it is information. It disappears by itself when the Strip leaves that state.
- **`STALE`** (quiet badge) appears when the contradiction has lasted 120 seconds after the chip would have
  shown: the Strip says one thing and the aircraft has been doing another. The hover says which. Update the
  Strip if it is wrong. The same badge covers any DEPARTURE, ARRIVAL, mission line or overflight whose state
  says airborne or on the ground and whose contact says the opposite (an ARRIVAL that says landed while the
  contact is still airborne, say); there is no chip for those, because surveillance does not decide a
  landing for you. **The carrier Roles expect nothing**: "airborne" is judged against an airfield's
  elevation and footprint, which means nothing for a moving deck.
  Each episode is logged once for the METRICS panel (§10).
- Neither indicator adds the Strip's attention styling or a reason line, and nothing in the sweep can move a
  Strip. Pressing Airborne yourself stamps the takeoff time (§4B).
- **A finished flight's aircraft is not claimed by the next flight.** A contact held by a flight that has
  since finished is not matched to another flight's callsign or code by itself; an explicit **Bind** still
  works. (A DCS re-mint of a lingering aircraft under a new track id is a new contact and is not covered.)

### Declutter is off

Every declutter behaviour is off until the EFSP work is finished, and was switched off once on
existing installs:

- **Settings › DECLTR › Sequential squawk declutter** (hides the labels of formation followers
  squawking sequential codes close to their lead).
- **Settings › DECLTR › navpoint declutter** ("Hide numbered navpoints", "5-letter names only").
  The map shows every navpoint (`WP1`, `NAV003`, …) until it is reworked with AIRAC data.

You can turn either back on in Settings; it stays as you set it.

## 8G. The runway — field state (Incirlik)

> **Server and panel are both built** (L1, L1b). The FIELD STATE panel is closed by default: open it
> from **PANELS → FIELD STATE**. It has no controls of its own beyond the buttons below, and every
> rule in this section is enforced by the server, not by the panel.

### The FIELD STATE panel

Each airfield with a runway inventory (today only Incirlik) shows:

- **The active end:** `▶ 05 ACTIVE`, and how it was set: from the mission wind at load, or by a runway
  change. `ACTIVE —` means nothing has set it yet (no mission wind yet).
- **Each runway** (`05/23`) with a badge: `OPEN`, `CLOSED`, `WORKS` (suspended for runway works) or
  `INSPECT` (works done, waiting for `OPS`'s inspection). Under the badge: who suspended or closed it,
  at which Position and when (Zulu), who asked; the last inspection; any request waiting on Tower; and
  the arresting gear. At Incirlik the gear reads "No arresting gear configured (SOURCE practice)",
  because DCS simulates no wires.
- **The runway change:** `05 → 23 · PROPOSED · proposed by TWR (name) 1440Z`, then one chip per
  acknowledger: `OPS ✓ 1441Z` (`✓ self` when the same person acknowledged it), `APP …` (still
  waiting), or `APP skipped` (nobody held APP when it was proposed). A rejection or withdrawal says who
  and why. After completion it reads `PENDING INSPECTION: 05/23`. A rejected change stays on the panel
  until the next proposal replaces it.
- **The pads:** the hot cargo pad and the alert pad, by name, and whether they are occupied.

**Buttons appear only for what your Positions may do** (the panel works out what Tower or `OPS` would
accept):

| You hold | Buttons |
|---|---|
| `TWR` | `CLOSE` (asks for a reason), `OPEN`, `WORKS`, `ACCEPT` / `REJECT` a request, `CHG RWY` (pick the end), `WITHDRAW`, `BEGIN`, `COMPLETE` |
| `OPS`, `CD`, `GND`, `APP` | `REQ CLS`, `REQ OPEN`, `REQ WRKS` (not offered to a controller who also holds `TWR`) |
| `OPS` | `WRK DONE` (works complete), `INSP OK` (the inspection, the only way back to `OPEN`) |
| `OPS`, `APP` | `ACK` or `REJECT` a proposed change |
| `TWR`, `OPS` and `APP` all | `SELF CHG` changes the runway in one input |

Close and every rejection prompt for a reason (`window.prompt`); optional notes are not asked for. When
a request is waiting on you as `TWR` the tab reads `FIELD STATE (1)`. A refused action shows in the
Strip panel's banner, starting with the runway it was about.

### On the Strip

- `RWY 05 SUSP` / `RWY 05 INSP` / `RWY 05 CLSD`: the runway this Strip will use is not open. Departures
  show it from CLEARED onward, arrivals from INBOUND to FINAL. When the server's own inhibit line
  already says it, the chip adds no second reason line.
- On FINAL the aircraft can still be marked LANDED.
- `RWY 05 INACT` (amber): the Strip sits in the Rack of the runway end that is not the active one. Move
  it to the active end's Rack, or leave it if the pilot needs 05.
- `HOOK`: a hook-equipped arrival (Block 3F) is heading for a runway whose *configured* arresting gear
  is not rigged. It is computed in the client and never stored, and **it never shows at Incirlik today**
  because no gear is configured (H57).

Incirlik's runway `05/23` is one pavement with two directions. Its board shows the runway's status
(OPEN, CLOSED, SUSPENDED for works, or SUSPENDED awaiting inspection), which end is active, any
runway change in progress, and any request waiting on Tower.

**Tower owns the runway.** Only `TWR` closes it, reopens it, or takes it out for works. `OPS`, `CD`,
`GND` and `APP` **ask** Tower: request close, request open, or request works, with an optional
note. Tower accepts, which carries it out and records who asked, or rejects.

**Runway works and the inspection.** (Formerly "barrier change". It is generic runway works plus an
inspection, H52; the inhibit reads `works in progress`.)

1. `TWR` suspends the runway, usually at `OPS`'s request. Both directions are suspended together.
2. When the work is done, `OPS` marks it complete. The runway stays suspended, now "awaiting
   inspection".
3. Only `OPS` can sign off the inspection, and that is what reopens the runway. Tower cannot simply
   reopen a suspended runway, and nobody can close it to get around the inspection.
4. The inspection records who signed it off, at which Position, and when.

**While a runway is suspended or closed:**

- Every departure queued for it, lined up on it, or taxiing towards it is held: its next-step
  button shows the reason and refuses, and so does dragging it into the runway queue. Every arrival
  handed to Tower for it is held short of FINAL.
- The reason names the runway and the cause: `runway 05/23 closed`,
  `runway 05/23 suspended — works in progress`, `runway 05/23 suspended — awaiting inspection`.
- An aircraft already on FINAL can always be marked LANDED. Touchdown is not a clearance, and an
  emergency onto a suspended runway gets nothing special: the Strip waits, you work it by voice.
- Moving a queued Strip to the other direction's Rack does not release it, because both Racks are
  the same pavement.

**Which runway a Strip is judged against**, in order: the runway Rack it sits in (or is being
dropped into), the runway on its flight plan (8A for a departure, 8B for an arrival), then the
active runway. A Strip that resolves to none of these is never held.

**Changing the active runway.**

1. `TWR` proposes the new end.
2. `OPS` and `APP` each acknowledge, in any order. Either may reject, and `TWR` may withdraw until
   it begins. Acknowledging is coordination, not permission.
3. `TWR` can begin once both have acknowledged. An acknowledger nobody holds is skipped and
   recorded, so an empty Position never deadlocks the change. A controller holding `TWR`, `OPS` and
   `APP` alone does it in one action (a self-coordinated runway change).
4. When `TWR` completes the change, the active end switches and the runway waits for `OPS`'s
   inspection, like any suspension. Its traffic is held until then.
5. After the inspection, departures sent to the queue go to the new end's Rack. Strips already
   queued for the old end are not moved: move them yourself.

**At the start of a mission** (a new *mission session*, §8J) the active runway is the end most into
the mission's wind (a pure crosswind picks 05). A reconnect or a crc-sync restart onto the same mission
keeps whatever Tower has chosen since. Restarting the same `.miz` is a new session, so it re-reads the
wind and starts a new metrics session.

**Arresting gear** is a stub: DCS does not simulate the wires, so gear is recorded as data and
nothing checks a `HOOK` ✓ flight against it.

The hot cargo pad and the alert pad exist by name only.

*What is ours, not doctrine:* Tower as sole authority over the runway, CLOSED holding traffic, the
request/accept flow, the wind rule and the skipped acknowledger are SOURCE's own choices.

## 8H. Alert and scramble (guide §9.6)

**Block `14E` (ALERT)** is on DEPARTURE Strips at `OPS`, `CD`, `GND` and `TWR`. Pick `NONE`, `ALERT` or
`SCRAMBLE`. `OPS` owns it: it may set it at any state until the Strip is dropped, whoever holds the
Strip (H56); the other three set it only while they own the Strip. `ALERT` shows only in the field.

**`SCRAMBLE`** raises a red line at the top of the Strip panel, on every tab, for every controller:
`SCRAMBLE VIPER11 INCIRLIK · CLEARED · <access route> constrained · N flagged`. Click the callsign to
jump to the Strip. The scrambling Strip gets a red `SCRAMBLE` chip. At the same field, every departure
at PUSHBACK, TAXI, RUNWAY_QUEUE or LUAW, and every arrival at LANDED or TAXI_IN, gets an amber
`SCRAMBLE` chip and a reason line telling it to keep clear of the alert-pad access route. Two
scramblers at once show as two rows, each ground Strip is counted once in "N flagged", and a scrambler
is never flagged against the other. The FIELD STATE panel names the access route as constrained too.

**Nothing is reordered, held or moved.** Sequencing is the controller's call; the chips are SOURCE
practice, not FAA doctrine. The indication ends by itself when the scrambler is DEPARTED or dropped.
To cancel on the ground, set `14E` back to `ALERT` or `NONE`: the field is never reset automatically.
The access route's name is a placeholder (`ALERT ACCESS TAXIWAY`) for the squadron to rename; the
"ground" set is Facility-wide because there is no taxi-route model.

## 8I. The ATO and the air-refuelling join (guide §9.8)

**Who imports.** `TAC_C2` (Primary at `TACTICAL`). The **Import ATO…** button in the Strip panel's
toolbar appears only while `TAC_C2` is held. Paste the USMTF text (atobrief's EXPORT dialog makes it),
or drop or choose a `.txt` file. Nothing is fetched from atobrief: it is paste or drop only (H65).

**The preview.** One row per mission line: mission number, callsign, package, vul window (Z), agency,
IFF Mode 1/2/3, missing fields and warnings, and an action per line: *Bind to <flight>* (showing why:
Mode 3 or callsign), *New flight*, *Update the tasked flight*, *Skip*. **Nothing happens until you press
Import N lines** (Enter previews/imports, Esc closes). Each line then reports its own result; one bad
line does not stop the others.

- **Binding.** A line binds to a flight already filed when its squawk matches the ATO's Mode 3 *and* the
  callsign agrees, or when only the callsign matches. Two possible flights, or a squawk held by a flight
  with a different callsign, are offered but never picked for you.
- **Callsigns** longer than 7 characters lose their vowels from the back (`ENFIELD11` becomes
  `ENFLD11`, H60). One that still does not fit needs a callsign typed in the preview first.
- **Squawks.** A new flight squawks the ATO's Mode 3 when crc-sync's allocator accepts it (H64);
  otherwise it gets crc-sync's own code and a warning. A flight that was already filed keeps its ATC
  code; if the ATO says another, every Strip of the flight shows `M3 ATO <code>` until the two agree.
- **Dates.** The ATO's date is ignored: its times go onto the mission's calendar (H68), and a note says
  so.
- **Mode 1 and 2** are read-only. See them, with the ATO's Mode 3, datalink, SCL, mission type, agency,
  frequencies, on-station time and AR detail, in the `▼` view of any Strip of the flight.
- **Re-import** an amended ATO: lines already on the Board become *Update*. ATO values are replaced and
  anything a controller typed is kept (the preview says which). Flights the new ATO no longer mentions
  are listed and left alone: nothing is torn down. Only one ATO is active at a time.
- **ATO first, filed later.** When `OPS` types the callsign of an ATO flight that has no ATC Strip, the
  toolbar offers "file against ATO mission <msn>"; the DEPARTURE is then the same flight with the same
  code.

**The AR badge.** `AR SHELL71` on a receiver, `AR ×2` on the tanker. Select any of them and the others
are highlighted (per client). **It is not MARSA** and declares nothing, separates nothing and changes no
`separationRegime`. If the tanker's Strip is dropped, the receivers keep their records and their badge
loses that peer. A re-import with a changed tanker rewires the join.

*What is ours, not doctrine:* the USMTF set layouts come from a community wiki
(`docs/parallel/research/usmtf-ato.md`), the vowel-cut rule and the one-ATO-at-a-time rule.

## 8J. Mission sessions, archiving and magnetic headings

### Mission sessions

crc-sync decides which mission it is in (`state/mission-session.json`). A **new session** starts on a DCS
`mission_start`, on a load of a different mission, or when the mission clock steps back by more than 5
minutes. A reconnect, or a crc-sync restart onto the same mission, stays in the same session. The
session number is what the metrics (§10) and the traffic count are bucketed by, and what the wind-derived
active runway and the archiving of finished flights (§8J) key off.

### Archiving finished flights

A dropped flight stays on the server for **2 hours** after its drop, or until the **next mission** (a new
mission session, above), whichever comes first. Then it is *archived*: gone from every screen, from the
server's memory and from the Board snapshot. Its history is the **Mutation log**
(`state/efsp-mutations*.jsonl`), which gets one `Archive` line per Strip and one `ArchiveFdr` line per
flight record; there is **no lookup in the app** (H73). Consequences: an archived drop cannot be undone
(Undo answers "not found"), live Strips are never touched by archiving (a mission change included), and
the traffic count is unaffected because every drop is counted before it can be archived. The sweep runs
once a minute; a Strip dropped by an unusual route (a `SetState` to `DROPPED`, a refused TOFI) may be
archived one sweep late, and a drop that was not counted at a mission change waits for the age sweep, so
it may stay up to 2 h.

### Headings are magnetic, and the transition altitude

Every heading and course you read or type is **magnetic**, from the World Magnetic Model (WMM2025) at
the aircraft's position and the mission's date. There is no manual "HDG correction" and the Airport
(APRT) panel's theater inputs are gone: it shows a read-only transition altitude and variation line. A
heading you type is converted by crc-sync; where the variation is unknown (no mission loaded) a bearing
shows `---` rather than a true value dressed up as magnetic. Mission dates outside 2025–2030 are
extrapolated and flagged. The topbar approach course and the APRT centreline are magnetic too.

The **transition altitude** is per theater (Syria 10,000 ft; every other theater 18,000 ft, a
`[SOURCE-DEFINED]` placeholder) and lives in crc-sync's `config/theaters.json`. Everything that shows or
writes an altitude uses it: block altitudes switch to flight levels at it (§4B), and the scope, the track
panel and the APRT card read it from crc-sync rather than a local default (the client shows 18,000 only
until the first theater message arrives). A squadron correction to
the variation goes in that file's `magneticVariation` (`fixedDeg` or `offsetDeg`) or in
`state/theaters.json`, and applies on restart. The airport weather popup, the APRT reference card and
the ATIS text give the wind **magnetic** (`NNN°M`; the reference card's tooltip shows the true value, and
the ATIS says "Wind not available." when the variation is unknown, H76).

## 8K. The carrier (`CARRIER` Facility, `adr/0074`)

Hold `CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1` or `CV_APP2` under **Panels → Acting As** (group `CARRIER`). A carrier
Strip has one of three Roles: **MARSHAL** (launch, then the stack), **FINAL** (the groove: nothing to type)
and **PATTERN** (in the visual pattern, then recovered). The covering chain is `CV_APP2` → `CV_APP1` →
`CV_MARSHAL`, which means a Marshal who covers for an approach Position then holds Strips it cannot advance;
`CV_PRIFLY` is outside the chain, so nothing strands on it and its Strips stay with it when it leaves.

- **The banner** across the top of the Strip panel is computed from DCS (ship speed, heading, final bearing,
  the ship's own weather where it is known). Only the **altimeter** can be set. A `T` or `G` suffix on a
  bearing means the variation or the convergence is missing, so it is not shown as magnetic; "hull not found"
  and "ship track lost" are shown as they are.
- **The recovery Case** is **PriFly's**: one setting for the whole ship, a selector in the banner. The other
  three Positions see it read-only, and every carrier Strip's next step changes at once when it changes. A
  weather advisory shows only when the Case you set is less restrictive than the floor, and never blocks.
  Today the floor knows only **night** (the sun more than 6 degrees below the horizon at the ship, from the
  mission clock); the ship's own ceiling and visibility are not sourced.
- **The Marshal stack board** (`cv-marshal-stack` Bay): one row per flight with slot, flight, angels, DME and
  push time. **The slot is the only number you set for a flight**: drag a row (or the Strip) to the slot you
  want and everyone above it moves up together. Taking a flight out leaves a gap; press **Close up** on it to
  compress the stack. Commence never moves anyone. A recovery check-in is appended at the next free slot,
  and a full stack is a warning.
  - **Case I** is an altitude list: type the squadron-assigned angels (2 to 20) per flight; there are no DME
    or push columns.
  - **Case II and III**: type the **Charlie time** as Zulu `HHMM` and the **marshal radial** as a **magnetic**
    bearing; Enter sets, and an empty Enter on the radial returns to the default (final bearing + 180).
- **On the launch Strip** set EEAT (Zulu `HHMM`, Block `C15`), approach, button (a number 1 to 20, never a
  frequency), bingo and low state. They are on the flight, so they are on the recovery Strip too. The
  squawk the launch Strip held is re-claimed by the recovery Strip if you dropped the launch Strip in
  between.
- **Four hand-overs, four buttons**, each recording its trigger type: **Commence** (Marshal to an approach
  lane), **Radar contact** (lane, MARSHAL becomes FINAL), **Ball** (FINAL to BALL) and **See you** (Case II
  only: the pilot has the ship, to PriFly as PATTERN). Case I has its own **To pattern**. **Dragging a Strip
  into a lane Bay does not do it; the button does** (the drag is refused with the button's name). The one
  allowed drag is a **bolter**: drag it to the Bolter Bay and the next step brings it back on final.
- **FINAL has nothing to type.** Its identity Blocks are derived and Block 5 is off its map.
- A launch, a trap and a recovered pattern flight each count once in the traffic count (§10).
- **Not walked against a real DCS ship**: the banner reads "hull not found" until a hull track exists; the
  deck-state board (`cv-prifly-deck`) is inert; two hulls were not tried.

## 8L. Incirlik: RSU, SFA and PAR (`adr/0075`, `0093`)

- **Eight Positions** at `INCIRLIK`: `OPS`, `CD`, `GND`, `TWR`, `RSU`, `APP`, `SFA`, `PAR`.
- **RSU** (runway supervisory unit): the **pattern board** (closed, initial, base, final as columns). Each
  chip has **Next leg** (the touch alternative to drag), **Landed** and **Drop**. A Strip whose Rack is not a
  leg shows in an UNPLACED column, never hidden. RSU originates PATTERN Strips, asks for a runway to be
  closed, opened or put out for works, and **never closes a runway itself** (only `TWR` does, H18). The board
  gives advice (a flight long in the pattern, more than one on the last leg); nothing is refused.
- **SFA** (single-frequency approach): five UHF frequency Racks, a header showing which Position is on which,
  and **Rotate to PAR** beside the next step. **Filing a Strip on a frequency Rack assigns it that
  frequency; rotating never changes it** (the frequency belongs to the flight, D17). Only **`APP`** edits the
  rotation record (a select per frequency); `SFA` and `PAR` cannot.
- **PAR** (precision approach): one aircraft on final at a time, shown in the **FINAL panel**: nothing to type
  (a test holds it to zero inputs), a 5-second cadence bar off the mission clock, and prompts for the required
  calls (mile, glidepath intercept, decision altitude, trend) that clear after 4 s. Two terminal buttons:
  **Landing assured** (to `BALL`) and **Missed approach** (to the `par-missed` Bay, state `BOLTER_WAVEOFF`).
  A rotation to PAR is refused while PAR is unmanned or already has an aircraft on final.
- **A vacated Position's Strips go to `APP`** (`SFA`, `PAR`) and come back to their own Racks when it is
  retaken; RSU has no covering Position. A PAR vacated with an aircraft on final leaves the Strip with `APP`,
  where `APP` cannot advance it (the same shape as the Marshal's).
- The glidepath tolerance (0.3 degrees), trend step (0.1), prompt hold (4 s), long-in-pattern (10 min) and the
  five placeholder frequencies (232.1 to 236.1 MHz) are `[SOURCE-DEFINED]`. The FINAL sample is the distance to
  the approach radar's site against a nominal 3-degree glidepath: it has never seen a live DCS track.

## 9. General controls — quick reference

- Set which Position(s) you're acting as under **Panels → Acting As** (grouped by Facility — `INCIRLIK`, `CENTER`, `TACTICAL` and, once any range is configured, `RANGES` are independent checkbox groups).
- Each held Position gets its own tab; each Position's Bays (§3) are its own tabs underneath.
- **Drag** a Strip onto another Position's tab to transfer it (same-Facility only); onto a Bay tab within your own Position to move it there.
- **Search**: `.find <text>` dot-command, or the search icon — matches callsign/beacon, opens a temporary search-results Bay.
- **Dot-commands**: `.drop [reason]`, `.undo`, `.find <text>`, `.bind <track id>`, `.unbind`, `.stereo <NAME> <CALLSIGN>`, and for MARSA (§8D) `.marsa <CALLSIGN> [DECLARER]`, `.rendezvous`, `.endmarsa`, `.voidmarsa` — all but `.find` and `.stereo` apply to whichever Strip is currently selected.
- **Undo**: 30-second window, state-only NLA transitions only (not transfers/handoffs — those revert via a manual transfer back).

## 10. Metrics and the traffic count

crc-sync counts what the Board does, and crc-desktop measures what a controller does with it (searches,
time to find a Strip, inputs per gesture). The METRICS panel shows both; behind it are two read endpoints
on crc-sync, open to any signed-in user. Nothing in either names a controller.

### The METRICS panel

Open it from **PANELS → METRICS** (it docks in the left cluster, closed by default). Anyone signed in can
open it, with or without a Position. It refreshes on open and every 30 s while it is on screen, and does
nothing while hidden.

- **Two columns.** *This mission* is everything since the current DCS mission loaded; *Last hour* is a
  rolling 60 minutes. The selector reads back an earlier mission (which has no last hour).
- **The verdicts.** `MET` / `NOT MET` compare the number with the guide's §11.5 target (only `NOT MET`
  is coloured). `TRENDING ↓/→/↑` compares the last three complete hours, for the three metrics whose
  target is "trending down"; it reads `NO TREND YET` until there are two complete hours, a flat series
  reads `→`, and no trend is ever coloured, `↑` included. `NO DATA` means measured, but nothing happened
  in this window. `NOT INSTRUMENTED` means nothing measures it yet, which is **not** zero: staleness
  was `not instrumented (L19)` until the staleness detector existed; it now reads `COLLECTING` from startup
  and `NO_DATA` until the first `STALE` episode (§8F).
- **Search is a failure symptom (§4.3).** Every search is counted, never what was searched for. A search
  count that is not trending down means controllers cannot find Strips where they expect them.
- **Time to find** runs from a Bay coming on screen to the first Strip you select in it. The clock
  ignores a Bay you leave without selecting, a Bay you hide, a Bay you ignore for 10 minutes, and a
  click on the arrivals line.
- **Inputs per gesture** is a declared cost per way of making a gesture: double-click flip 1, Shift+click
  attention 1, Alt+click offset **1**, Ctrl/Cmd+click highlight **1**, right-click + swatch highlight **2**,
  `⋯` → Offset **2**. The last two are over the ceiling of one input; whether the one-input forms settle
  that is still open (see the briefing).
- **Per Position** is folded behind a toggle and lists search and time-to-find by Position (H66). There
  is never a row per person.
- **Traffic count.** Pick a Facility (it starts on the first Facility where you hold a Position, else
  `INCIRLIK`). The first line is a partition: every counted flight is local, transient or unknown.
  Formation, SUA traversal and alert scramble are "of which" counts and can overlap. "Reconciles with the
  Mutation log" means the count agrees with a recount from the audit log; a mismatch is coloured. The
  request is scoped to the selected mission.
- Search per manned hour reads `—` until crc-sync's 60 s manning tick has recorded manned minutes.

### The endpoints

- **`GET /api/efsp/metrics`** — the metric set, per mission session (one DCS mission load to the
  next), with a rolling last hour beside it. `?hours=1..720` narrows it to the last N hours of the
  session, and `?missionSession=N` picks an earlier session (404 if there is none).
- **`GET /api/efsp/traffic-count`** — flights counted from dropped Strips. Optional `facilityId`,
  `from` and `to` (mission-time epoch ms, `to` exclusive; the default is the last 24 h of mission
  time), `missionSession`, and `detail=1` for the records.

**Reading the count.** One operation per dropped Strip per Facility; a formation is one operation,
with its aircraft counted beside it. Local + transient + unknown = flights. Formation, SUA and
scramble are overlapping subsets, not further partitions. `excludedByReason` explains the drops that
are not traffic. `CENTER` and `TACTICAL` show locality `UNKNOWN` by design, because they have no
home airport. Obligation figures are counts, not rates: only `ADVANCE_FORWARDING` and
`VOID_TIME_EXPIRED` can ever be "met".

**Retries and reconnects.** A retried Mutation is answered with its original outcome and the record as it
is now, on every path (Board ops, airspace, correlation, MARSA), and for 10 minutes across a crc-sync
restart (Board ops only). A resync is served as a delta only within one Board lifetime: the client sends
back the `boardEpoch` from its last snapshot, delta or ack, and without it (or after a restart) it gets a
snapshot. A change that moves other Strips (a rebalance of a Rack) now broadcasts every Strip it touched,
not only the one you addressed. Beacon codes rotate: a released code comes back only after the whole pool
has cycled, so a new flight is not handed the previous flight's still-airborne code.

**The audit trail.** Every Mutation, and every refusal, is logged in
`crc-sync/state/efsp-mutations.jsonl`, plus day segments `efsp-mutations.YYYY-MM-DD[.n].jsonl` named
by their newest entry. Read the segments in day order, then the live file. `ok:false` entries are
refusals; `source:'wire'` means the refusal was caught before any store saw it. Every outcome has exactly
one entry: a store logs what reaches it, and the wire layer logs the refusals that never reached one
(`unaudited`, never on the wire). Reading an entry:

- `facilityId` and the FDR are on every entry. `facilityId: null` means theater-wide (correlation and
  MARSA; a MARSA entry names its `fdrIds`). An airspace entry names the controlling Facility.
- `SetBlock` names the `blockId` and the `value` written. Coordination and TOFI entries name their
  `action` (`CANCEL`, ...). Airspace, correlation and MARSA entries carry the `clientMutationId`.
- `source:'peer'` is a change to a replica on this Facility's Board caused by the other Facility's
  Mutation: `causedBy` names it and `clientMutationId` is null. There are seven `Peer*` ops, plus
  `PeerCoordinationCancel`.
- `SystemReassign` has reason `position-vacated` (a Position left, Strips moved to its cover) or
  `position-retaken` (they moved back; not counted in the `systemReassigned` metric).
  `SystemCoordinationEnd` ends a link whose replica was retired.
- `Archive` / `ArchiveFdr` (§8J) are the end of a finished flight; `NotPersisted` (written at boot)
  voids the earlier line with the same `clientMutationId`, which never took effect because crc-sync died
  before saving it.
- A scramble called off while still on the ground is not counted as an alert scramble in the traffic
  count; one called off after departure is.
- A retry answered from the replay cache writes no second entry. Retention (30 days by
default) and the home airports that decide local vs transient are in
`crc-sync/config/efsp-instrumentation.json`, or a copy in `state/`; restart crc-sync to apply a
change.
