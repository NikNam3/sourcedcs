# EFSP usage guide

A working reference for the Electronic Flight Strip Panel — what's built, how to drive it, and what every field on a Strip/FDR is for. Kept current as the panel grows; see `docs/adr/` for the reasoning behind any of this, and `EFSPImplementationGuide.md` for the spec it implements.

## 1. Status right now

Built and tested (`npm test` in `crc-sync` and `crc-desktop`, both green):

- **WP0-WP4** (guide): domain model, Mutation protocol, Position occupancy/combination, Block Map, Bays/Racks/drag, States/NLA/transfer, 30s Undo.
- **WP4A first slice**: a second Facility (`CENTER`/`CTR`) alongside `INCIRLIK`'s five Positions; the 5 cross-Facility coordination primitives (`HANDOFF`/`POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`AIT`) between `APP` and `CTR`; per-Facility Strip replication (two independent Strips linked by `coordination`, not one moved Strip); `EDCT`/`CALL_FOR_RELEASE` release states + standing-release envelopes; airspace ownership as a direction; track-degradation soft interlock; timed forwarding-obligation alerts — see §8.
- **WP4A second slice**: the `TACTICAL` Facility (`TAC_C2`/`AIC`/`GCI`/`JTAC`), a `MISSION` Strip Role, and TOFI — the ATC⇄MRU exchange for handing a flight into tactical control and getting it back (`docs/adr/0025`/`0026`).
- **The `RANGE` station**: MOAs and ranges as real entities with a booked schedule, an activation approval round trip, and flights approved onto a working or range-control frequency — see §8A.
- **Flight-plan pre-fill**: `OPS`'s CreateStrip form looks up a pilot-submitted DD1801 (ICAO IFR) flight plan from sourcedcs-web by callsign and pre-fills the departure fields — see §4.
- **`ops-filed` queue**: `OPS`'s `ops-filed` Bay now shows every currently-filed DD1801 plan as a card, each with a one-click "Create Strip" — see §4. ⚠️ **Requires a deployment step to actually work** — see the callout at the end of §4.
- **Radar coverage follows the Positions you hold** — the radar selector is gone. See §8B.
- **WP5: correlation** — every Strip says which contact on the scope it is, clicking a Strip rings its contact, and clicking a contact selects its Strip. See §8C.
- **WP6, in progress** — the military layer, landing a deliverable at a time:
  - **Stereo routes** — file a flight by short name and the server expands the whole route. See §4A. (The table ships empty; nothing works until somebody writes one.)
  - **MARSA** — declaring that the military is separating its own aircraft, as a relation between flights rather than a flag on one, with the pre-rendezvous course/altitude interlock. See §8D.
  - **The military Block namespace** — `ORDNANCE` (Block 3G) and `HOOK` (Block 3F) on every ATC Strip. The fields are live and recorded; the behaviour that reads them (§9.5's hung-ordnance advisory, §9.7's arresting-gear gating) is not built yet. See §6.
  - **The mission line exists from tasking** — `TAC_C2` frags a mission line against a filed flight before it moves, and TOFI later lands on the one that is already there. Accepting tactical control now requires stating the separation regime. See §8C1.
  - **Every Block is reachable, and amendments are visible** — the `▼` button on a Strip opens the Blocks that have no chip, and a superseded value now shows struck through in the Block itself (§3.7). Heading and initial altitude are chips on a DEPARTURE Strip; the radar vector is one on ARRIVAL/OVERFLIGHT. See §4B.

Not built: the rest of WP6 — field state and arresting-gear gating (§9.7), alert/scramble (§9.6), the hung-ordnance advisory (§9.5), MTR fields (§9.4) — plus WP7 (ATO ingest), WP7A (carrier/PAR) and WP8 (instrumentation). `docs/efsp-briefing.md` is the current handoff note.

Facility/Position map as it stands:

| Facility | Positions | Notes |
|---|---|---|
| `INCIRLIK` | `OPS`, `CD`, `GND`, `TWR`, `APP` | Covering chain `CD→GND→TWR→APP` |
| `CENTER` | `CTR` | No covering chain (mirrors `OPS`) |
| `TACTICAL` | `TAC_C2`, `AIC`, `GCI`, `JTAC` | `AIC`/`GCI` covered by `TAC_C2`; `JTAC` is read-only |
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

The short name shows on the Strip as Block **`STEREO`** (`9F`), next to `RTE`, and you edit it the
ordinary way — click, type, enter.

**Typing a route name into `STEREO` re-files the flight.** *"VIPER11, request change to PACK 2"* is
one edit: the route, altitude, departure and destination are all rewritten from the table, and the
aircraft keeps the squawk and the CID it was already given. This works in both directions — a flight
that filed a plain route the normal way and then asks for the standard route on first contact is the
same edit.

Two things a re-file deliberately leaves alone: **Block 9E (remarks)**, which is your own text and
has nothing to do with the route, and **any clearance you have already issued** — amending what was
*filed* is not the same as re-clearing the aircraft, and that is still a conversation with the pilot.

**Clearing `STEREO` cancels the stereo without touching the route.** The flight keeps flying what it
was flying, it just stops being labelled as a canned route. If you want the route gone too, edit
Block 9.

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
- **The fields, in the middle**, then a row of **indicators** (`TRK`, `MARSA`, `TOFI`,
  `AIRSPACE`, `TIMER`, `+N`). The indicators are always drawn and dim when off, so each is in the
  same place on every Strip. Colour means something: amber is waiting on you or blocked, orange-red
  is something failed; everything else is grey. Any reason the Strip owes you (why the next step
  is refused, why a TOFI exit is blocked, a MARSA void) is a full line under them.
- **⋯ ▼ ✕ on the right.** **⋯** holds everything you *start*: Coordinate…, TOFI…, Airspace…,
  MARSA…, Bind…, Convert to Arrival, Offset. Something you cannot do right now is still listed,
  greyed, with the reason. **▼** opens the rest of the Blocks. **✕** drops the Strip.

### The fields, and the `▼` button

Each Position sees the fields it works, not all of them: Tower sees HOOK and ORDNANCE, APP and CTR
see FREQ, CTR sees the TOFI fields, the airfield Positions see the runway. TYPE already carries the
aircraft and wake, so they have no fields of their own; CID and TAIL are on no Strip. The full
table is in `docs/adr/0056`.

Everything else is behind **`▼`** — and *only* the rest: the panel never repeats a Block that is
already a field, so it is the short list of what you cannot otherwise see. One Strip is expanded
at a time, in Block Map order, which is the order of the paper strip.

(The one thing it does repeat is a Block whose history is too long for its field — that is what
the `+N` opens.)

⚠️ **`INIT ALT` and `VECTOR` are the Blocks §9.2's MARSA interlock watches.** Writing
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
  the aircraft has reported or is observed leaving it. Available on DEPARTURE's
  `INIT ALT` and ARRIVAL's `ALT`.

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
  correlation       which contact on the scope this Strip is — WP5, live. See §8C
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
    beaconObserved                                                  — what the aircraft is ACTUALLY squawking, from its correlated contact
    modeOne, modeTwo                                                — WP7/ATO-owned, no setter exists (defect D24 guard)
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
    ordnanceState ('CLEAN'|'LOADED'|'HUNG'|'EXPENDED')              — Block 3G, a picker. Recorded now; §9.5's hung-ordnance advisory is not built yet
    hookRequired (bool)                                             — Block 3F, a ✓ toggle. Means this aircraft REQUIRES arresting gear, not merely that it has a tailhook
    alertStatus ('NONE'|'ALERT'|'SCRAMBLE')                         — no Block yet; §9.6 picks one
    mtr: { designator, entryFix, entryTimeUtc,
           exitFix, exitEstimateUtc, requestedAltitudeAfterExit }   — §9.4, present and unpopulated; no way to write any of it yet
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
- **`military`** — guide §6.4's military extension namespace. Two fields are live and enterable from the Strip: **Block 3G (`ORDNANCE`)**, a four-value picker, and **Block 3F (`HOOK`)**, a ✓ toggle. Both sit in the 3-family beside aircraft type and tail number, because they are facts about the airframe, and both are on DEPARTURE, ARRIVAL and OVERFLIGHT Strips. Everything else in the object is present but unwritable — the field exists so its arrival later is not a schema change, and the server refuses a write to it by name rather than ignoring one.
  - **`HOOK` ✓ means the aircraft requires arresting gear.** It is not "has a tailhook". §9.7's gear check will read it that way.
  - **Setting `ORDNANCE` to `HUNG` raises no advisory yet.** It is recorded, audited and broadcast; the runway-selection advisory the guide asks for is §9.5's deliverable and is not built. Tell the tower by voice, as now.
  - The guide numbers these `M14`/`M15` in its §6.4 table. **Those numbers are not used as Block ids here** — the `M`-prefix belongs to the MISSION Strip's own Block Map, which uses `M1`–`M8` with different meanings. The mapping between the guide's numbers and this system's Block ids is in `docs/adr/0052`.
- **`trackRef`** — permanently null, and kept only so its absence isn't a schema change later. The correlation lives in its own store keyed by `fdrId`, because one flight can have several Strips and they are all the same aircraft — see §8C.

## 7. Release states (why a Strip can be stuck at CLEARED/HELD)

Set the release state on Block **14A** (`RLS ST`, a picker) and, for a void time, Block **14D**.
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

Every Strip carries a badge saying which surveillance contact it is:

| Badge | Means | What to do |
|---|---|---|
| `TRK VIPER11` | **correlated.** Hover it to see how — its beacon code, its callsign, or a controller's binding | nothing |
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

`CTR` presses **TOFI Exit**, then the MRU accepts. Exit is the safety-critical
direction, so it is refused until **`SREG` is set back to `ATC`** — and only `CTR` can
do that, because `SREG` lives on the ATC-side Strip. If the MRU's Accept is greyed
out, that is why, and the tooltip says so.

⚠️ **While tactical control is ACTIVE, neither Strip can be dropped.** That is
deliberate — the flight is still flying and still yours. The way out is the exit above,
not a drop.

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
| Departure | `HDG` (Block 20) | `INIT ALT` (Block 21) |
| Arrival | `VECTOR` | Block 7, the cleared altitude |
| Overflight | `VECTOR` | `ASGN ALT` |

Amending the **filed** requested altitude (a departure's `ALT` chip) is not an assignment and does not
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

## 9. General controls — quick reference

- Set which Position(s) you're acting as under **Panels → Acting As** (grouped by Facility — `INCIRLIK`, `CENTER`, `TACTICAL` and, once any range is configured, `RANGES` are independent checkbox groups).
- Each held Position gets its own tab; each Position's Bays (§3) are its own tabs underneath.
- **Drag** a Strip onto another Position's tab to transfer it (same-Facility only); onto a Bay tab within your own Position to move it there.
- **Search**: `.find <text>` dot-command, or the search icon — matches callsign/beacon, opens a temporary search-results Bay.
- **Dot-commands**: `.drop [reason]`, `.undo`, `.find <text>`, `.bind <track id>`, `.unbind`, `.stereo <NAME> <CALLSIGN>`, and for MARSA (§8D) `.marsa <CALLSIGN> [DECLARER]`, `.rendezvous`, `.endmarsa`, `.voidmarsa` — all but `.find` and `.stereo` apply to whichever Strip is currently selected.
- **Undo**: 30-second window, state-only NLA transitions only (not transfers/handoffs — those revert via a manual transfer back).
