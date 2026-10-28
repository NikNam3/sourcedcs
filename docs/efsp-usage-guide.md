# EFSP usage guide

A working reference for the Electronic Flight Strip Panel — what's built, how to drive it, and what every field on a Strip/flight data is for. Kept current as the panel grows; see `docs/adr/` for the reasoning behind any of this, and `EFSPImplementationGuide.md` for the spec it implements.

## 1. Status right now

Built and tested (`npm test` in `crc-sync` and `crc-desktop`, both green per lane; the last full Playwright run is recorded in the briefing's §1). This reflects `efsp-wp5-correlation` as it goes out for the v2 launch: a working EFSP panel, a first working prototype of the carrier panels, the PAR and the single frequency approach (§8K, §8L), and OVERFLIGHT's four-state lifecycle (`adr/0087`):

- **WP0-WP4** (guide): domain model, Mutation protocol, Position staffing/combination, Block Map, Bays/Racks/drag, Strip states/NLA/strip transfer, 10 s Undo.
- **WP4A first slice**: a second Facility (`CENTER`/`CTR`) alongside `INCIRLIK`'s five Positions; the 5 cross-Facility coordination primitives (`HANDOFF`/`POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`AIT`) between `AP` and `CTR`; per-Facility Strip replication (two independent Strips linked by `coordination`, not one moved Strip); `EDCT`/`CALL_FOR_RELEASE` departure release states + standing-release envelopes; airspace ownership as a direction; track-degradation soft interlock; timed forwarding-obligation alerts — see §8.
- **WP4A second slice**: the `TACTICAL` Facility (`TAC_C2`/`AIC`/`GCI`/`JTAC`), a `MISSION` strip type, and TOFI — the ATC⇄MRU exchange for handing a flight into tactical control and getting it back (`docs/adr/0025`/`0026`).
- **The `RANGE` Position**: MOAs and ranges as real entities with a booked schedule, an activation approval round trip, and flights approved onto a working or range-control frequency — see §8A.
- **Flight-plan pre-fill**: `OPS`'s CreateStrip form looks up a pilot-submitted DD1801 (ICAO IFR) flight plan from sourcedcs-web by callsign and pre-fills the departure fields — see §4.
- **`ops-filed` queue**: `OPS`'s `ops-filed` Bay now shows every currently-filed DD1801 plan as a card, each with a one-click "Create Strip" — see §4. ⚠️ **Requires a deployment step to actually work** — see the callout at the end of §4.
- **Radar coverage follows the Positions you are signed on to** — the radar selector is gone. See §8B.
- **WP5: correlation** — every Strip says which contact on the scope it is; **Show on map** in the Strip's `⋯` menu rings its contact, and clicking a contact selects its Strip. A contact squawking a Strip's assigned code is that flight, whatever flew as it before. See §8C.
- **Flight following** — start radar service on a contact with no Strip in one action (Strip, code and track together), and end it with "Radar service terminated". See §8C2.
- **WP6** — the military layer:
  - **Stereo routes** — file a flight by short name (a picker in Block `9F`) and the server expands the whole route. See §4A. (The shipped table holds the squadron's Incirlik departures: KEMER1, MANAZ2, MANAZ3, TARSU4.)
  - **MARSA** — declaring that the military is separating its own aircraft, as a relation between flights rather than a flag on one, with the pre-rendezvous course/altitude interlock. See §8D.
  - **The military Block namespace** — `ORDNANCE` (Block 3G) and `HOOK` (Block 3F) on every ATC Strip. `HUNG` ordnance raises an advisory chip on every Position's Strip for the flight (§6); arresting-gear gating (§9.7) reads a gear inventory Incirlik does not have, so it never fires. See §6.
  - **The mission line exists from tasking** — `TAC_C2` frags a mission line against a filed flight before it moves, and TOFI later lands on the one that is already there. Accepting tactical control now requires stating the separation regime, which takes effect when the flight enters an active airspace or the MRU presses Entered. See §8C1.
  - **Every Block is reachable, and amendments are visible** — the `▼` button on a Strip opens the Blocks that have no chip, and a superseded value now shows struck through in the Block itself (§3.7). Heading and initial altitude are chips on a DEPARTURE Strip; the radar vector is one on ARRIVAL/OVERFLIGHT. See §4B.
  - **MTR fields** — the military training route a flight is on, where it enters and leaves, and the altitude it wants after exit. See §4C.
  - **The runway (runway status)** — Tower owns the runway, everyone else asks; closing it or taking it out for works holds the traffic that would use it; the active runway comes from the wind at mission start. The RUNWAY STATUS panel and the runway chips on the Strip are in. See §8G.
- **Forwarding-obligation alerts clear themselves** once the obligation is met or no longer due. Nothing to acknowledge. See §8.
- **Contact colours come from IFF interrogation**, not from the game's idea of a side, and nothing on the ground is hidden any more. See §8F.
- **Formation and navpoint declutter are off** until the EFSP work is finished: formation labels and navpoint names both show. What else the map draws (DCS drawings, text marks, the airport surface) is a switch each in Settings → RADAR → Map. No radar shows ground vehicles. See §8F and §8O.
- **Alert and scramble** — Block `14E`; a scramble raises a red line on every tab and amber chips on ground traffic that must keep clear, and never reorders or holds anything. See §8H.
- **ATC scopes draw STARS-style blocks** at `LC`, `AP` and `CTR`: white for yours, flashing for a handoff to you, green for someone else's. See §8F.
- **Headings are magnetic** (World Magnetic Model), and the transition altitude is per theater. See §8J.
- **Time Blocks and altitude blocks** — estimated times show in italics with their source on hover (§4B), and `ALT` takes a block such as `FL220-FL240`.
- **Taking a hat** — when you leave a Position that still has Strips, nothing moves; the next controller on its list is offered it, also if they sign on later or reconnect. See §8M.
- **A new mission clears the Board** — once, by the system, with a notice. See §8J.
- **Finished flights are archived** after 12 hours or at the next mission, and a mission session decides which mission is current. See §8J. Every Mutation and refusal has exactly one audit entry (§10).
- **The tactical Positions are fenced**: a JTAC is sent only the lines it was handed, `AIC` hands back and cannot advance a line, and `TAC_C2` answers the TOFI exit on an AIC-held line. See §8C1.
- **Metrics and a traffic count**: the METRICS panel (PANELS → METRICS), with what crc-sync itself costs in CPU and memory, and, behind it, read endpoints on crc-sync. See §10.
- **ATO import** — `TAC_C2` pastes or drops a USMTF ATO (atobrief exports one) and it becomes mission lines on the Board, with the air-refuelling tanker/receiver join shown on the Strips. See §8I.
- **The carrier (a first working prototype)** — a `CARRIER` Facility with four Positions (`CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2`): the Marshal creates the carrier's Strips (Recovery or Launch), a read-only ship banner, the **CARRIER** panel (BRC, final bearing, Case, ramp time, marshal position, weather at the ship, recovery tanker; PriFly and the Marshal set them), the **MARSHAL** panel (the recovery board: re-sequence, Commence, Back to stack, Delta, an EAT and the fuel typed by hand, changed clearances marked until passed), the **CARRIER MAP** panel (a radar picture fixed on the ship, with the stack, the approach path and the pattern), PriFly's Bay of recovered aircraft, and the handoff buttons from launch to recovery. Every carrier view names an aircraft by its **side number**. There is no PAR on the carrier. See §8K. Not yet seen against a real DCS ship.
- **Suggestions from surveillance** — a quiet `AIRBORNE? ▸` chip when a departure Strip still says it is on the ground but the aircraft is flying, a `STALE` badge when it was ignored, and a takeoff time stamped when a Strip enters Airborne. Surveillance informs; nothing moves by itself. See §8F.
- **Incirlik's tower pattern, the single frequency approach and the PAR** (LC, AP, PAR): the tower works pattern traffic on its ordinary Strips (P/S and OPT cells, an IN PATTERN Bay, Closed traffic and Leave pattern); AP's SFA frequency Bay and **Hand off to PAR**; PAR's FINAL Strip (HDG, ALT, Begin descent, Cleared to land, Landed, Missed approach) and the PAR panel, whose elevation and azimuth scopes crc-sync measures against approach values the PAR controller sets. There is no RSU and no SFA Position. See §8L.
- **Mode C intruder alerts and MARSA groups** — Conflict Alert is between two aircraft with Strips; an aircraft with no Strip that squawks is a Mode C intruder (`MCI`); one formation and one MARSA never alert against each other; a receiver under tanker MARSA is watched against the tanker. See §8E and §8D.
- **The airspace-conflict alert** — an aircraft inside an active airspace it may not be in raises an amber `SAA`, by airspace type; the using agency (OPS at Incirlik) approves entry, and only the controlling Position defines an airspace. See §8A.
- **The airspace card lists its flights** (inside and filed through) with **Approve** for whoever approves entry; **transits** through an active MOA, warning or restricted area are requested on the Strip, decided by whoever separates its users and ended by hand with **Transit complete**; a grey `COORD` mark shows a flight filed through one that nobody has coordinated yet. The Strip's airspace badge is amber only while the aircraft is inside an approved airspace that is not active. See §8A.
- **Jurisdiction areas** — the airspaces panel shows whose airspace an aircraft is in: the LTAG control zone (the tower's), the Incirlik RAPCON (AP's and PAR's), the carrier area, and CENTER's everywhere else. See §8A.
- **Handoffs are released or not** — the receiver marks the aircraft **Checked in** when the pilot calls, and control moves then (released) or once the aircraft is inside the receiver's airspace (not released); **Request release…** asks for it sooner. See §8.
- **Frequencies are set at run time** — the FREQUENCIES panel lists each Facility's station frequencies and the SFA pool; a controller edits, adds and removes their own Facility's. See §8N.
- **The mission clock holds while DCS is paused** — the topbar clock reads `PAUSED` and no EFSP time moves. See §8J.
- **The map needs no MapTiler key to work** — labels are drawn with fonts the app ships, the basemap falls back to a free one when MapTiler refuses, and terrain heights come from DCS itself. See §8O.
- **Remarks on every Strip** — a one-line RMKS row, the whole remark in a small window on a click; a long value is cut with "…" in its cell. See §4B.
- **Divert** — `AP` and `CTR` give a flight a new destination and a new clearance on the same Strip. See §8.
- **Correlation is by beacon code or a binding, never by callsign** — an AI flight correlates once you type the code
  it squawks into its Strip. See §8C.
- **VFR at Incirlik** — the RAPCON is the unclassified Adana MTMA (IFR separated from VFR), the control zone is Class D;
  every area has a VFR service. `CD` creates departures itself and makes a **VFR departure** in one step (code and
  Strip, no plan). See §3 and §8A.
- **Special use airspace is the FAA's** — MOA, restricted, prohibited and warning areas only (a range is a using
  agency, not a type); a prohibited area is always in force; an approved transit is ended by hand with **Transit
  complete**. See §8A.
- **Click a data block to assign** heading, speed or altitude on a flight whose Strip you own. See §8F.
- **On a PAR final only the glidepath alerts**, the PAR panel shows the heading that holds the final course, and the
  heading grace scales with the turn. See §8E and §8L.
- **A click never moves a Strip**, and every coloured left edge says what it is on hover. See §9.
- **Settings has one tab per panel** (General, Colours, Radar, SRS, Tools, and PAR, Marshal and Carrier map for the panels that have settings of their own). See §9.

Not built: WP6's arresting-gear data (DCS has no wires) and the carrier's deck-state board (`adr/0064` B8). `docs/efsp-briefing.md` is the current handoff note.

**Every time EFSP works with is in-game Zulu**: the DCS mission clock, never your PC's clock or real-world UTC. Every typed time (release, void, EDCT, MTR entry and exit, …) is typed as `HHMM` (`1432` or `14:32Z`) and dated by the mission's date: the nearest such time within 12 hours. Anything that is not a time is refused at the cell.

Facility/Position map as it stands:

| Facility | Positions | Notes |
|---|---|---|
| `INCIRLIK` | `OPS`, `CD`, `GC`, `LC`, `AP` (+ `PAR`, §8L) | Hat offers, in order (§8M): `CD` → `GC`, `LC`, `AP`; `GC` → `LC`, `AP`; `LC` → `AP`; `PAR` → `AP`. `OPS` and `AP` have none. Nothing moves when a Position is left |
| `CENTER` | `CTR` | No offers (mirrors `OPS`) |
| `CARRIER` | `CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2` | Hat offers (§8K): `CV_APP1` → `CV_MARSHAL`, `CV_APP2`, `CV_PRIFLY`; `CV_APP2` → `CV_MARSHAL`, `CV_APP1`, `CV_PRIFLY`; `CV_PRIFLY` → `CV_MARSHAL`, `CV_APP1`, `CV_APP2`; `CV_MARSHAL` → `CV_APP1`, `CV_APP2`, `CV_PRIFLY` |
| `TACTICAL` | `TAC_C2`, `AIC`, `GCI`, `JTAC` | `AIC`/`GCI`/`JTAC` hand their lines back to `TAC_C2` (the one place Strips still move at a sign-off, below); `AIC` and `JTAC` work only lines `TAC_C2` hands them (§8C1) |
| `RANGES` | derived from the airspace config | One Position per range that has control of its own; works no Strips — see §8A |

## 2. How to mark a Strip CLEARED

The full pre-departure chain is `PROPOSED → PENDING_CLEARANCE → CLEARED → HELD/PUSHBACK → ...`. To get a Strip to `CLEARED`:

1. **Strip must exist and be owned by `OPS`, state `PROPOSED`.** Create one via the callsign box (OPS only) or `.` dot-commands. If `OPS` holds a filed DD1801 plan for that callsign, it's auto-fetched and pre-fills the flight plan fields — see §4.
2. **`OPS` presses the NLA button ("Send to Clearance")** — requires a beacon code already assigned (Block 5) and `CD` staffed (or an empty `CD` that a staffed Position is offered, §8M). This is strip-transfer-shaped: it both advances the state to `PENDING_CLEARANCE` *and* moves ownership to `CD` in one action (`docs/adr/0012`) — you don't drag it separately.
3. **Now acting as `CD`, confirm/fill in the flight plan fields:** `filed.route` (Block 9), `filed.requestedAltitude` (Block 7), `filed.departureAirport` (Block 8), `filed.destinationAirport` (Block 8B). All four are required — `computeNla` checks `isFlightPlanValid`, and `PENDING_CLEARANCE`'s NLA is inhibited with `"flight plan invalid"` until they're all non-empty. If step 1's auto-fill found a match these are likely already populated — review them like any pre-filled field, they're fully editable (an ordinary Block edit, same as if `CD` had typed them).
4. **`CD` presses the NLA button ("Mark Cleared").** This is state-only (`CLEARED` is still `CD`'s own state, no Position boundary crossed) — the Strip stays with `CD`, state becomes `CLEARED`.

Equivalently: drag the Strip directly into `CD`'s `cd-cleared` Bay — `board/placement.js`'s `Placement#validateBayImpliedTransition` enforces the exact same flight-plan-valid gate on the drag path (guide §3.5 rule 4: NLA is an accelerator, never the *only* path).

One extra gate exists on the state **after** CLEARED: `CLEARED`'s own NLA ("Approve Pushback") additionally checks `flightData.assigned.departureRelease === 'RELEASED'` — if the flight has any other departure release state (`HOLD_FOR_RELEASE`, `RELEASE_TIME`, `CLEARANCE_VOID_TIME`, `EDCT`, `CALL_FOR_RELEASE`), pushing past `CLEARED` is inhibited (`"a hold is in force"`) until that clears — see §7 below.

Per-State authority table for reference (who's allowed to advance a Strip **out of** its current state):

| State | Owner | NLA label | Advances to |
|---|---|---|---|
| `PROPOSED` | `OPS` | Send to Clearance | `PENDING_CLEARANCE` (transfers to `CD`) |
| `PENDING_CLEARANCE` | `CD` | Mark Cleared | `CLEARED` |
| `CLEARED` | `CD` | Approve Pushback | `PUSHBACK` (transfers to `GC`) |
| `HELD` | `CD` or `GC` | Release | `PUSHBACK` (transfers to `GC`) |
| `PUSHBACK` | `GC` | Taxi | `TAXI` |
| `TAXI` | `GC` | To Runway Queue | `RUNWAY_QUEUE` (transfers to `LC`) |
| `RUNWAY_QUEUE` | `LC` | Line Up and Wait | `LUAW` |
| `LUAW` | `LC` | Cleared for Takeoff | `DEPARTED` |
| `DEPARTED` | `LC` | Hand Off to AP | `HANDED_OFF` (transfers to `AP`, intrafacility) |
| `HANDED_OFF` | `AP` | Drop | `DROPPED` |

The states, who owns each one and the button labels are SOURCE's own lifecycle (guide §3.4 and §3.5, `[SOURCE-DEFINED]`); real TFDM publishes none of them. See §8F1.

ARRIVAL lifecycle is `INBOUND → HANDED_TO_TOWER → FINAL → LANDED → TAXI_IN → DROPPED`, owned by `AP`(or `CTR`)/`LC`/`LC`/`LC`/`GC` respectively, with `TRAFFIC_PATTERN` (`LC`, shown as IN PATTERN) between `HANDED_TO_TOWER` and `FINAL` for an aircraft that works the pattern (§8L). A `CENTER`-held `INBOUND` Strip has **no** ordinary NLA at all — its next action is the **Coordinate** button (§8), not this table.

## 3. Bays by Position — intended usage

Every Position's Bay set is fixed by the facility files (`facility-config.js` loads them): guide §4.2's default Bay sets, which are SOURCE's own (the real TFDM bay names are not published; §8F1). A Bay with an **implied state** (`impliesState`) is a real lifecycle stop — dropping/NLA-ing a Strip into it both relocates *and* advances it (§2). A Bay with no implied state is a holding/staging area — placement there is purely organizational, it never changes `strip.state` on its own.

### `OPS` — Operations (files flight plans; asks Tower for runway changes and signs off runway inspections)

| Bay | Implies state | Intended usage |
|---|---|---|
| `ops-filed` | — | **The filed-plan queue** (§4) — shows every currently-filed DD1801 plan as a card with a one-click "Create Strip," fetched from sourcedcs-web (throttled, refetched at most every 10s while this Bay is open). This is a client-local view, not real Board state — no actual Strip lives here until you press Create on a card, and (unlike every other Bay) it's **no longer a valid drag target**: dropping a Strip here would render nowhere, so both the Bay tab and OPS's Position-tab default were changed to route elsewhere (`ops-proposed`) instead. |
| `ops-proposed` | `PROPOSED` | **Where a newly created Strip lives.** This is the real starting point of the departure lifecycle — every `CreateStrip` from the OPS callsign box lands here (auto-filled from a matching DD1801 when one exists — §4). Get a beacon assigned, then press "Send to Clearance". |
| `ops-runway-status` | — | **Inert, and it will stay so.** The runway board (§8G) is getting its own dock panel, not this Bay. Nothing lands here. |
| `ops-coordination` | — | Present for structural symmetry with every other Position's Coordination Bay — **inert this slice**, since no coordination primitive targets `OPS` (only `AP`/`CTR` can send/receive `HANDOFF` etc.). Nothing ever lands here right now. |

### `CD` — Clearance Delivery
| Bay | Implies state | Intended usage |
|---|---|---|
| `cd-pending-clearance` | `PENDING_CLEARANCE` | **Your intake queue.** Everything `OPS` sends via "Send to Clearance" lands here. Review/complete the flight plan (route, altitude, departure/destination airport), then advance to `cd-cleared`. |
| `cd-cleared` | `CLEARED` | Strips you've cleared, still yours, waiting on release conditions (§7) before pushback can be approved. If a hold is in force, "Approve Pushback" stays inhibited here — check `cd-held` isn't where it actually belongs. |
| `cd-held` | `HELD` | Strips on an active hold — `HOLD_FOR_RELEASE`/`RELEASE_TIME`/`CLEARANCE_VOID_TIME`/`EDCT`/`CALL_FOR_RELEASE`. Shared ownership with `GC` (either can hold a Strip here) — release it once the hold condition clears, which transfers it on to `GC`. |
| `cd-coordination` | — | Inert this slice (see `ops-coordination`). |

**A departure with nothing at OPS.** `CD` creates a DEPARTURE Strip itself: the create box's **CD · Departure**
origin (callsign, Enter) puts it in `cd-pending-clearance`, in Pending Clearance, with the same flight-plan lookup as
OPS's (§4). From there it is cleared like any other.

**VFR departure.** A VFR pilot calls for traffic advisories with the proposed direction of flight; there is no flight
plan to look up (a VFR flight plan is a search-and-rescue record with Flight Service, which ATC never gets). Press
**VFR…** in the toolbar (shown only at `CD`), type the callsign and the type (`F16`, `2/F16`), pick **DIR** (N…NW) and,
if the pilot asked for one, the runway (empty = the active runway), then **Create VFR** (or Enter). Keyboard:
`.vfr VIPER11 F16 NW [23]`. In one step the flight gets flight data, a **discrete code** and a DEPARTURE Strip in
`cd-cleared`; the form shows the callsign and the code it got (`VIPER11 4321`). It skips Pending Clearance:
there is no clearance to review, no altitude or destination needed, no release or void time. From there it is an
ordinary departure: **Approve Pushback** to `GC`, taxi, `LC`'s runway queue, departed, **Hand Off to AP**. A refusal
(bad callsign, type or direction, a runway this airfield does not have, no free code) shows in the form in red and
spends no code. **Undo** within 10 s removes the Strip and frees the code. Why a code before takeoff: a few minutes
after it leaves the Class D control zone it is in the Adana MTMA, where Approach separates IFR traffic from it (§8A).

### `GC` — Ground

| Bay | Implies state | Intended usage |
|---|---|---|
| `gc-pushback` | `PUSHBACK` | Strips released and approved for push/engine start. Once physically moving, advance to Taxi. |
| `gc-taxi-out` | `TAXI` | Departing traffic taxiing to the runway — your outbound ground-movement queue. Hands off to `LC` once at/approaching the runway. |
| `gc-taxi-in` | `TAXI_IN` | **Arrivals**, not departures — landed traffic taxiing in from `LC` to parking. This is the terminal Bay of the `ARRIVAL` lifecycle before Drop. |
| `gc-coordination` | — | Inert this slice. |

### `LC` — Tower

| Bay | Implies state | Intended usage |
|---|---|---|
| `lc-runway-queue` | `RUNWAY_QUEUE` | Departure sequencing — **one Rack per runway direction** (`rwy-05`, `rwy-23`). Order within a Rack *is* the departure sequence (guide §1 "Rack", Annex §9) — this is the one Bay where Strip order in the Rack is operationally meaningful, not just cosmetic. GC's "To Runway Queue" files a Strip into the Rack of its runway: the one on its flight plan, else the active runway (§8G). |
| `lc-airborne` | `DEPARTED` | Strips that have taken off, waiting on "Hand Off to AP" (staffing-gated — nothing happens until `AP` is staffed: `AP` has no hat list, so nobody covers it). |
| `lc-arrivals` | `HANDED_TO_TOWER` | **Arrivals** handed to you from `AP`'s inbound sequence — your intake queue for the arrival side. |
| `lc-pattern` | `TRAFFIC_PATTERN` | **Pattern traffic** (tab reads `ARR · IN PATTERN`): arrivals working the pattern, and local departures you turned into closed traffic (§8L). |
| `lc-final` | `FINAL` | Arrivals on final approach. |
| `lc-landed` | `LANDED` | Just-landed arrivals, waiting on hand-off to `GC` for taxi-in. |
| `lc-coordination` | — | Inert this slice. |

On `LC`'s departure face P/S, OPT and HOOK are not shown (they are arrival matters); a departure that needs one sets it
in the expanded `▼` view. `LC`'s and `AP`'s arrivals keep P/S and OPT on the face (§8L).

### `AP` — Approach/Departure (RAPCON)

| Bay | Implies state | Intended usage |
|---|---|---|
| `ap-inbound` | `INBOUND` | Arrivals you're working. **Populated by accepting a `HANDOFF` from `CTR`'s Coordinate button** (§8) — `AP` no longer self-originates arrivals (`docs/adr/0014` superseded the old stub). Advance to `HANDED_TO_TOWER` once ready to pass to `LC`. |
| `ap-sfa` | `INBOUND` | **The single frequency approach** (§8L): one Rack per SFA frequency. Filing an arrival on a Rack gives the flight that frequency; **Hand off to PAR** sends it to the final. A missed approach comes back here, on its frequency. |
| `ap-departures` | `HANDED_OFF` | Departures `LC` has handed off to you — the terminal parking spot for a completed departure before you Drop it. |
| `ap-overflight` | — | Overflights you are working, including a flight-following Strip (§8C2), which starts here in sector. |
| `ap-coordination` | — | **Genuinely live this slice** — proposed `HANDOFF`/`POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`AIT` Strips *from* `CTR` land here with `coordination.state: 'PROPOSED'`, showing Accept/Reject buttons instead of the normal NLA. This is your inbox for cross-Facility proposals. |

### `PAR` — Precision approach radar (§8L)

| Bay | Implies state | Intended usage |
|---|---|---|
| `par-final` | `ON_FINAL` | **The final**: the FINAL Strip of the aircraft you are talking down, an ordinary Strip face. One aircraft at a time. |
| `par-missed` | `BOLTER_WAVEOFF` | A missed approach you keep yourself; its next step is **Back to AP**. |

### `CTR` — Ankara Center (`CENTER` Facility)

| Bay | Implies state | Intended usage |
|---|---|---|
| `ctr-enroute` | `INBOUND` | Where a `CTR`-originated Strip lives (the callsign box works for `CTR` too — it's the new terminus stub since no Facility exists further upstream of `CENTER` yet, `docs/adr/0014`). Also where your **own sent** proposal's Strip stays after you press Coordinate → it doesn't move until you drop it yourself; each side of an exchange is independently removable. |
| `ctr-departures` | `HANDED_OFF` | Departures handed on to you. |
| `ctr-overflight` | — | Overflights you are working, including a flight-following Strip (§8C2). |
| `ctr-ap-coordination` | — | Your inbox for proposals **from** `AP` (e.g. an `AP`-initiated `POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`AIT` targeting `CTR`). Same Accept/Reject mechanism as `ap-coordination`, mirrored. |

**Rule of thumb across every Position:** an implied-state Bay is "the state's home" — you drag/NLA a Strip *into* it to advance the lifecycle. A Coordination Bay only ever holds a Strip **you didn't create yourself** (a proposal someone else sent you) — your own outgoing proposal's Strip stays put in whatever Bay it already lived in.

## 4. Flight-plan pre-fill (OPS CreateStrip)

When `OPS` creates a Strip, the client looks up a pilot-submitted **DD1801 (ICAO IFR)** flight plan from sourcedcs-web by the entered callsign and, if one exists, pre-fills the departure fields before the Strip is even created — no separate button, it's automatic.

**Flow:**
1. Type a callsign in the create-strip box, press Enter or **+ New Strip**.
2. The box shows *"Looking up flight plan…"* for up to a few seconds while `crc-desktop` asks `crc-sync`, which asks sourcedcs-web (`GET /api/fpl1801/by-callsign/:callsign`) and maps the result onto `route`/`requestedAltitude`/`departureAirport`/`destinationAirport`/`remarks`.
3. If a plan is found, the Strip is created with those fields already populated and the status briefly reads *"Creating (flight plan found)…"*. If nothing matches, the lookup times out, or sourcedcs-web is unreachable, the Strip is still created — just blank, exactly like before this existed. **Strip creation is never blocked or delayed indefinitely by this** — it degrades to a normal manual entry every time.
4. Every pre-filled field is a completely ordinary Block, editable the normal way (click to edit) — nothing about a pre-filled Strip behaves differently from a hand-typed one afterward.
5. The aircraft type arrives as its ICAO designator, with its wake: a plan that says `F-16C` gives TYPE `F16/M`, `KC-135R` gives `K35R/H`. A type name the table does not know arrives as written (upper-cased), for you to correct; it is never guessed. The ATO import (§8I) does the same.

**Scope, on purpose:**
- Only `OPS`'s `DEPARTURE`-strip-type creation triggers this — `CTR`'s `ARRIVAL`-strip-type creation does not, since DD1801's fields (route/departure/destination airport) don't line up with `ARRIVAL`'s filed shape (`originAirport`/`arrivalFix`/`estimatedArrivalTimeUtc`) at all.
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

Type a callsign, pick `PACK 1`, press **+ New Strip** — the Strip is created with route, requested
altitude, departure and destination airports already filled in from the table. **A stereo route sets
no remarks**: the Strip's remarks (Block 9E) stay the controller's own.

> **The shipped table holds the squadron's own Incirlik departures** (KEMER1, MANAZ2, MANAZ3, TARSU4,
> supplied by the squadron on 2026-10-12): the filed route, FL220, departure and destination LTAG, and the
> runway 05/23 departure text as the description (kept in the file, never shown or filed). Nothing in it is
> invented. With an empty table the stereo picker stays beside "+ New Strip", greyed out and empty.
>
> Their fixes (KEMER, ERGEP, MANAZ, MUT, TARSU, DAN) have **no coordinates** in crc-sync until AIRAC data is
> built (a v3 item), so a stereo route is never found to be "filed through" an airspace (§8A): it is not listed on an
> airspace card as filed and raises no `COORD` mark, unless the DCS mission happens to have nav points of those names.

### Installing a table

The file is a JSON array. `name` and `route` are required; `description`, `departureAirport`,
`destinationAirport`, `requestedAltitude` and `active` are optional. **Any other key, `remarks` included,
refuses the table**: crc-sync does not start and names the file and the key.

```jsonc
[
  {
    "name": "PACK 1",                                  // what a controller files it as, and all the picker shows
    "description": "north MOA and recover",            // the squadron's own note; never shown or filed
    "departureAirport": "LTAG",
    "destinationAirport": "LTAG",
    "route": "LTAG DCT ADANA DCT TOROS DCT LTAG",      // the expansion — the point of the record
    "requestedAltitude": "250"
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
| `crc-sync/config/efsp-stereo-routes.json` | the shipped default, baked into the image (the squadron's Incirlik departures) |

**Restart crc-sync after editing.** The table loads once at startup — there is no editing UI in this
slice, and a running process will not notice the file changed. A file that cannot be read or does not
validate (an unknown key, a missing name or route, a duplicate name) **stops start-up** with the file and
the reason named: correct it, or delete the `state/` copy to use the shipped table.

Names are matched loosely: `PACK1`, `pack 1` and `PACK-1` all reach a route the table spells
`"PACK 1"`, and the Strip always shows the table's spelling. Two names that differ only in spacing
or case are rejected as a duplicate when the file loads — they would be the same route to a
controller.

### Filing one

- **The picker.** A dropdown beside the callsign box lists the active routes **by name only**. It only
  shows for `OPS`'s DEPARTURE origin — an arrival or a mission line has no filed route a canned departure
  route could seed — and is greyed out and empty when no routes are installed.
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
face; on `GC`, `LC` and `AP` it is one `▼` away. A route the squadron has retired stays in the list
for a flight already filed with it. With no table installed (and no stereo on the flight) the cell is
plain text and says "no stereo routes configured" on hover.

**Choosing a route in `STEREO` re-files the flight.** *"VIPER11, request change to PACK 2"* is
one edit: the route, altitude, departure and destination are all rewritten from the table, and the
aircraft keeps the beacon code and the CID it was already given. This works in both directions — a flight
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
resolution) → `flight-data-store.js`'s `createFlightData()` (the expansion, server-side) →
`GET /api/stereo-routes` → `crc-desktop/app/server.js` proxy →
`efsp-stereo-routes.js` → `efsp-panel.js`'s picker and `.stereo` verb. Design reasoning is in
`docs/adr/0050`.

## 4B. Reading and amending Blocks

### Reading a Strip (docs/adr/0056)

A Strip has three columns:

- **The tab, on the left.** Its header says the strip type and strip state (`DEP · HANDED OFF`). Under it is
  one row for every exchange in progress — a handoff or other coordination, a TOFI, a MARSA
  relation waiting for rendezvous, an ambiguous track — each with its own buttons and a line
  saying how long it has waited or why it is blocked. At the bottom is the **next step** (the
  NLA). A Strip with something waiting on *you* has an amber edge.
- **The fields, in the middle**, then a row of **indicators**, but only when there is
  something to say (`adr/0058`). A Strip where nothing is wrong has no indicator row at all. In
  order: `Conflict Alert` or `Mode C Intruder`, a conformance warning (`HDG 072`, `ALT ↓`, `BUST +600`,
  `AR 3.8 NM`, see §8E), the runway, ordnance and scramble chips, `Airspace conflict <name>` (§8A), `TRK` (only
  when the flight is *not* normally correlated), `AIRBORNE? ▸` and `STALE` (surveillance disagrees with the
  Strip, §8F), `MARSA`, `TOFI`, the airspace badge, a transit or `COORD` mark (§8A), a forwarding
  obligation (`VOID TIME EXPIRED`, `ADVANCE FORWARDING`, `NOT CHECKED IN`…, see §8), `+N`.
  Colour means something: amber is waiting on you or blocked, orange-red is something wrong;
  everything else is grey. Any reason the Strip owes you (a conflict, why the next step is
  refused, why a TOFI exit is blocked, a MARSA void) is a full line under them.
- **⋯ ▼ ✕ on the right.** **⋯** holds everything you *start*: Coordinate…, TOFI… (or **TOFI to CTR**
  when there is only one counterpart: it sends at once), Airspace…, Entry block…, Request transit <area>,
  MARSA…, Split…/Join formation…, Show on map, Bind…, Radar service terminated, Convert to Arrival,
  Divert…, Closed traffic / Leave pattern (LC), the Final group on a PAR final, Edit remarks…, Offset. The
  items are grouped (Start, Flight, Formation, Final, Strip), each heading once. Something you cannot do right now is still listed, greyed, with the
  reason; something your Position can never do is left out. **▼** opens the rest of the Blocks. **✕**
  drops the Strip.
- **RMKS, the last row**, when the flight has remarks (below).

**A long value is cut, never spilled.** A value longer than its cell (a long route, say) ends in "…"
inside the cell; hover it for the whole value, click it to edit as usual. The same on every strip type
and in the `▼` view.

**Remarks.** When a flight has remarks, the Strip's last row shows them (RMKS), on every strip type,
the carrier's MARSHAL, FINAL and PATTERN Strips included (Block `9E`; `M8` on a mission line). The row
is one line and never grows the Strip: a long remark is cut at a word with "…", and the hover shows all
of it. Click it (or Enter/Space on it) to open the remark in a small window: edit it there and press
**Save** or Ctrl+Enter; **Esc** or Cancel leaves it unchanged. Saving an empty box clears the remark and
the row goes. Only the controller holding the Strip's Position can edit; anyone else (a Strip found with
`.find`, say) sees it read-only. To write the first remark on a Strip that has none, use `⋯` → **Edit
remarks…**. A refusal keeps the window open with what you typed. (The carrier's FINAL Bays draw a one-line
list, not Strip faces, so a carrier FINAL Strip's remarks are not on screen there. Incirlik's PAR final is
ordinary Strip faces and shows them.)

**One-input gestures.** **Alt+click** on a Strip toggles OFFSET and **Ctrl/Cmd+click** steps its
HIGHLIGHT (yellow, cyan, lime, off); both are one input. The `⋯` item and the right-click swatches still
work (two inputs). On macOS Ctrl+click is a context click, so use the swatches there.

### Strip counts and arrivals (docs/adr/0057)

Every Bay tab shows how many Strips are in it, and each Position tab its total.

A Strip that moves into one of your Bays is an **arrival**, whoever moved it:
another controller handing it to you, a handoff or TOFI proposal landing in your
coordination Bay (also when one controller is signed on to both ends, `AP` and `CTR` say: a coordination or TOFI
replica minted for you is an arrival whoever made it), or your own NLA or drag when you work several
Positions at once.

- In a Bay you are **not** looking at: that Bay's tab turns amber with **+N**, the
  Position tab gets an amber dot, and a line appears under the Bay tabs:
  `VIPER11 → lc-runway-queue from GC`. Click it to open the Bay with the Strip
  selected. Opening the Bay clears the tab and the line.
- In the Bay you **are** looking at: the Strip flashes once (a Strip rebuilt while it flashes keeps flashing to the
  end; it is never replayed) and keeps an amber edge
  and a **from GC** line in its tab until you touch it, or for 30 seconds. A press clears
  them when it ends, not when it starts, so a button you press on that Strip does not
  move under your pointer.

Not announced: a Strip you just created, a reorder within a Bay, or a change that
leaves a Strip where it was. The "from" line names the Position it came from, or the
Bay when it moved within one Position.

### The fields, and the `▼` button

Each Position sees the fields it works, not all of them: Tower sees HOOK and ORDNANCE (ORDNANCE is always on
Tower's face and on OPS's departure face, where the load state is recorded; on AP, CTR and mission lines it
joins the face only once it is not CLEAN, and is always one `▼` away: a pilot reports hung ordnance to
whoever they are talking to, H55), AP and CTR see FREQ, and on a departure also RELEASE (Block `14A`, the
departure release state, where the release travels, §7), CTR sees the TOFI fields (`KEEP IFR` is TOFI's `ifrActive`:
the flight stays IFR under tactical control and ATC keeps separating it; hover it), the airfield Positions
see the runway, GC sees TAXI (`17`) and LC TAKEOFF (`18`). CID and TAIL are on no Strip. **DIR** (Block `9K`) is
a VFR departure's direction of flight (§3 `CD`): on CD's, GC's, LC's and AP's departure face once set, never empty on
an IFR departure. On a Strip you do not hold, a cell you may not write is read-only; the one exception is `OPS`, which
sets ALERT/SCRAMBLE (`14E`) and ORDNANCE (`3G`) on a departure whoever holds it. The full table is in
`docs/adr/0056`.

**Labels.** Block 1 is labelled **ACID** (aircraft identification) on DEPARTURE, ARRIVAL and OVERFLIGHT
Strips (CALLSIGN on the mission line and the carrier's). Hover any label on those three strip types to see
the FAA block it is, for example *Block 7, requested altitude*; *(ours)* marks a field the FAA strip does
not have, *#≠* one the FAA numbers differently from us.

**TYPE (Block 3)** shows the aircraft in ICAO order: the number of aircraft when more than one, the type
designator, the ICAO wake category (**L** light, **M** medium, **H** heavy, **J** super) and the equipment
suffix, for example `F16/M` or `2/F16/M/G`. Click it and type `TYPE/WAKE`, with the number in front for a
formation: `2/F16/M` (the number is the formation size). Leave the wake out and it is filled from the type
when the type is one we know (`2/K35R` becomes `2/K35R/H`); type it to override. `M/F16` is read the same as
`F16/M`. The equipment suffix comes from the flight's equipment codes and is not typed here (a third part is
refused). A type must be a designator, 2 to 4 letters or digits starting with a letter (`F16`, `K35R`):
`F-16` is refused, and so is an empty TYPE. A new type typed without a wake takes the new type's wake: a
wake typed for the old type does not carry over. Every row of the wake
table is ICAO's own (Doc 8643; six of them also quoted from JO 7360.1K); a type it does not know gets no wake
until you type one.

Everything else is behind **`▼`** — and *only* the rest: the panel never repeats a Block that is
already a field, so it is the short list of what you cannot otherwise see. One Strip is expanded
at a time, in Block Map order. For a DEPARTURE Strip that is the FAA paper strip's order (guide §6.2); the other strip types' orders are ours (§8F1).

(The one thing it does repeat is a Block whose history is too long for its field — that is what
the `+N` opens.)

⚠️ **`ALT` and `HDG` are the Blocks §9.2's MARSA interlock watches.** Writing
one on a flight in an active tanker MARSA relation, before rendezvous, voids the relation (§8D).
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
  of every strip type.

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
`M6`/`M7`, the carrier's EEAT `C15`) is **typed as `HHMM`** (an empty time field shows `HHMM` when you
start typing, and its label's hover ends "UTC HHMM") and shown as `HHMM`; it is stored as an instant on the mission's
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
- **Gotchas.** `TAXI` is on GC's face and `TAKEOFF` on LC's. A `TAXI` or `TAKEOFF` a controller already
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
| DEPARTURE, OVERFLIGHT | AP, CTR | all six: MTR · EXIT · EXIT EST · EXIT ALT · ENTRY · ENTRY TM |
| ARRIVAL | AP, CTR | MTR · EXIT · EXIT EST · EXIT ALT |
| any | OPS | MTR · ENTRY · ENTRY TM |
| any | CD | MTR |
| any | GC, LC | none (still in ▼) |

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
  flightDataId             reference to the flight data this Strip presents (§6)
  rev               optimistic-concurrency counter — every Mutation must supply the baseRev it read
  stripType              'DEPARTURE' | 'ARRIVAL' | 'OVERFLIGHT' | 'MISSION' — picks which Block Map/NLA table applies
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

## 6. flight data fields

The flight data (`flight data`) is the authoritative flight record a Strip presents — separate on purpose (guide §3.1): one flight data per flight, N Strip *presentations* of it (only one this slice, except a WP4A coordination replica — §8). `assigned` fields are the ones ATC actually writes.

```
flight data {
  flightDataId, rev
  identity: {
    callsign, flightSize, aircraftType, wakeCategory (ICAO L/M/H/J, from the type unless typed; Block 3, §4B),
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
    originAirport, arrivalFix, estimatedArrivalTimeUtc              — ARRIVAL-strip-type fields only
  }
  assigned: {
    clearedRoute, clearedAltitude,
    departureRelease ('RELEASED'|'HOLD_FOR_RELEASE'|'RELEASE_TIME'|'CLEARANCE_VOID_TIME'|'EDCT'|'CALL_FOR_RELEASE'),
    releaseTimeUtc, voidTimeUtc, voidDeadlineUtc (derived, +30min)
    edctTimeUtc, edctWindowStartUtc/EndUtc (derived, ±5min)          — WP4A, §4.6.2
    callForReleaseTimeUtc, callForReleaseWindowStartUtc/EndUtc (derived, −2/+1min) — WP4A
    delayInfo, atisCode, datalinkClearanceIndicator ('NONE'|'ISSUED'),
    movementAreaEntryTimeUtc, taxiTimeUtc, takeoffTimeUtc,
    landingRunway                                                   — ARRIVAL-strip-type field
  }
  military: {                                                       — WP6, guide §6.4's military extension namespace (docs/adr/0052)
    ordnanceState ('CLEAN'|'LOADED'|'HUNG'|'EXPENDED')              — Block 3G, a picker. Setting HUNG raises the advisory chip (below)
    hookRequired (bool)                                             — Block 3F, a ✓ toggle. Means this aircraft REQUIRES arresting gear, not merely that it has a tailhook
    alertStatus ('NONE'|'ALERT'|'SCRAMBLE')                         — Block 14E, DEPARTURE only (§8H)
    mtr: { designator, entryFix, entryTimeUtc,
           exitFix, exitEstimateUtc, requestedAltitudeAfterExit }   — §9.4, Blocks 9G-* / 9H-* (§4C). Times are epoch ms, typed as HHMM
    altrvRef, arInfo, scl, fuelState, releaseAuthority              — present and unpopulated, no setter (guide §12)
  }
  trackRef      null   — permanently null; the correlation is its own record, keyed by flightDataId (see §8C)
  airspace: { owner (null|'CONTROLLING_AGENCY'|'USING_AGENCY'), changedAt, changedBy, transitions }  — WP4A, §4.6.4 (ARSPC, Block 24A), direction only, never a boolean; choosing — clears it back to null, and every change stays in `transitions`
  provenance    { [path]: 'COMPUTER_GENERATED'|'CONTROLLER_ENTERED'|'SYSTEM_DERIVED' }
  createdAt/updatedAt/updatedBy
}
```

**Subbucket usage, in plain terms:**
- **`identity`** — "who/what is this aircraft" (callsign, type, beacon code, equipment). Mostly filled at creation; `beaconAssigned` is minted automatically unless overridden.
- **`beaconAssigned` and `beaconObserved` are two fields on purpose**, and comparing them is the point: they match (all well), they differ (the pilot is squawking the wrong code — the Strip shows `NO TRK` until you bind it; once bound, both codes stay visible), or observed is null (assigned, nothing received — either the transponder is off or nothing has correlated yet). Collapsing them into one would hide a mismatch entirely, which is a defect the guide names by number. `beaconObserved` is written by the correlation subsystem, never by a controller.
- **`filed`** — "what the pilot/flight plan asked for" (route, altitude, airports, times). This is what `isFlightPlanValid` checks before `CLEARED` is reachable, and what §4's pre-fill populates.
- **`assigned`** — "what ATC has actually granted" (clearance, departure release state/timing, ATIS code, movement times). This is the bucket that changes as a flight progresses through the departure sequence.
- **`airspace`** — WP4A only, a delegated-airspace direction, orthogonal to everything else.
- **`military`** — guide §6.4's military extension namespace. Two single fields are live and enterable from the Strip: **Block 3G (`ORDNANCE`)**, a four-value picker, and **Block 3F (`HOOK`)**, a ✓ toggle; so are the six MTR fields (§4C). Both sit in the 3-family beside aircraft type and tail number, because they are facts about the airframe, and both are on DEPARTURE, ARRIVAL and OVERFLIGHT Strips. Everything else in the object is present but unwritable — the field exists so its arrival later is not a schema change, and the server refuses a write to it by name rather than ignoring one.
  - **`HOOK` ✓ means the aircraft requires arresting gear.** It is not "has a tailhook". The `HOOK` chip (§8G) reads it that way, and only when a runway has configured gear. DCS does not simulate arresting wires, so the runway's gear is kept as data only, and Incirlik has none configured.
  - **Setting `ORDNANCE` to `HUNG` raises an amber `HUNG` chip on every Position's Strip for that flight** (and on the mission line, which shares the flight data), with one reason line: *"Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller's call. Runway 05/23 (05) assigned."* On a departure it says "if it returns". The runway named is whatever the Strip resolves to (its runway Rack, then 8A/8B, then the active end); the line never recommends one, and the pad is a name with no position. **It is advice only: it never disables the next-step button, never reorders a queue, and the flight lands, taxis and drops as usual.** Set `CLEAN` or `EXPENDED` when the pilot reports the store safe and the chip goes. Nothing is raised for `LOADED`. With no runway status (a Facility with no inventory) the line reads "The hot cargo pad is shown when runway status is available."
  - **ORDNANCE is on the mission line too** (`3G` on `MISSION`, H55) because it is the same field as on the ATC twin. HOOK is not: it gates a runway, which a mission line never uses.
  - The guide numbers these `M14`/`M15` in its §6.4 table. **Those numbers are not used as Block ids here** — the `M`-prefix belongs to the MISSION Strip's own Block Map, which uses `M1`–`M8` with different meanings. The mapping between the guide's numbers and this system's Block ids is in `docs/adr/0052`.
- **`trackRef`** — permanently null, and kept only so its absence isn't a schema change later. The correlation lives in its own store keyed by `flightDataId`, because one flight can have several Strips and they are all the same aircraft — see §8C.

## 7. Departure release states (why a Strip can be stuck at CLEARED/HELD)

Set the departure release state on Block **14A** (`RELEASE`, a picker; it was labelled `RLS ST` before UI-A) and, for a void time, Block **14D**.
Anything other than `RELEASED` holds the Strip at `CLEARED` — move it to `HELD`, which is what
`HELD` means, and the time-based gates below are checked there.

| `departureRelease` | Meaning | What un-sticks it |
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

## 8. WP4A: cross-Facility coordination (AP ↔ CTR)

Only `AP` and `CTR` can use this. It's a **separate mechanism** from the ordinary NLA chain above — "the Strip does not cross the Facility boundary" (guide §4.6). A `HANDOFF`/etc. creates a **second, independent Strip** at the receiving Facility, linked (not merged) to the sender's.

**To hand an inbound flight from `CTR` to `AP`:**
1. Acting as `CTR`, create a Strip (the callsign box works for `CTR` too now — it originates an `ARRIVAL` Strip in `ctr-enroute`; no flight-plan pre-fill for this path, see §4's scope note).
2. Click **Coordinate…** on the Strip, pick `HANDOFF`, add a note if the flight data has a `trackDegradationFlag` set (required in that case), leave **Released** ticked or untick it (next subsection), press the send button. It says what it does and to whom: **Hand off to AP**, **Point out to AP**, **Traffic to AP**, **Request to AP**, **AIT to AP**; when an arrival can go to Approach or to the carrier's Marshal, pick the target in the second list and the button follows (**Hand off to CV_MARSHAL**). Tell the pilot to contact the receiver; there is no separate comms button.
3. This creates a new Strip in `AP`'s `ap-coordination` Bay, `coordination.state: 'INITIATED'`.
4. Acting as `AP`, click **Accept** on that Strip — it moves to `ap-inbound`, `state: INBOUND`, and both sides' `coordination.state` become `'ACTIVE'`. Radar identification and the Strip move to `AP`; communications and control stay with `CTR` until the pilot checks in (next subsection).
5. From here the `AP`-side Strip proceeds through the normal `ARRIVAL` chain (§2). The `CTR`-side Strip stays in `ctr-enroute` — drop it manually once you're done with it (each side is independently removable).

`coordination` record shape on a Strip:
```
coordination: {
  primitive           'HANDOFF'|'POINT_OUT'|'TRAFFIC'|'OPERATIONAL_REQUEST'|'AIT'
  state               'INITIATED'|'ACTIVE'|'REJECTED'
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
| `HANDOFF` | moves | stays until control moves (below) | transfers | stays until **Checked in** |
| `POINT_OUT` | **stays** | moves | transfers | stays |
| `TRAFFIC` | stays | stays | transfers | stays |
| `OPERATIONAL_REQUEST` | stays | stays | — | — |
| `AIT` | moves | moves | transfers | transfers |

`POINT_OUT` shows two badges on the Strip ("DATA: X" / "SEP: Y") since those can genuinely differ.

### HANDOFF after Accept: check-in, release and control (`docs/adr/0122`)

**Accept on a `HANDOFF` moves radar identification and the Strip only.** The flight is now on the receiving Position's
Bay, but the transferring Position still has communications and control. (`AIT` still moves everything at Accept.) The
`HANDOFF` row on **both** Strips carries `COMMS: CTR` and `CTRL: CTR`, the Position that has each, in plain grey
whoever it is: colour on a handoff row means something needs you.

**Handing off.** Coordinate… → Hand off. Leave **Released** ticked (the normal case): control passes when the receiver
marks the aircraft checked in. Untick it to keep control until the aircraft is inside the receiver's airspace as well
(its jurisdiction area, §8A). Tell the pilot to contact the receiver; there is no separate comms button. The
**Released** box is offered for a hand-off only.

**Receiving.** Accept the handoff. When the pilot calls, press **Checked in** on the handoff row. On a released handoff
control is yours at once; on a not-released one it becomes yours by itself once the aircraft is inside your airspace
(until then your Strip says `NOT RELEASED`, and `RELEASED` on a released one until you check it in). You cannot take
control by hand. **Checked in** can be undone for 10 seconds.

**Request release…** (the receiver, on a not-released handoff only, until control has moved) asks for the release
sooner, with an optional note. The handing-off station sees `RELEASE REQUESTED` in amber and answers **Release** (one
click: control is yours at once if the aircraft has checked in, else at check-in) or **Unable** (with an optional reason;
your Strip then shows `RELEASE REFUSED` in amber, and control waits for your airspace). One request at a time; none of
them is undoable, and there is no withdrawing a release: after it, the way back is a handoff the other way.

Nothing is shown once control has moved. **Amber means:** a handoff to answer; an aircraft accepted a minute ago and
not yet checked in (`NOT CHECKED IN`, on the receiver's Strip); a not-released aircraft already in the receiver's
airspace but not checked in (`IN AIRSPACE · NOT CHECKED IN`, both Strips: control cannot move); a release request
waiting for your answer (handing-off station); a refused request (receiver).

A handoff is between two Facilities. Inside one Facility (`AP` to `LC`, `AP` to `PAR`, a drag onto another Position's tab)
the Strip is simply transferred: control goes with it, with no switch and no check-in.

**Before control moves, a heading or an altitude has to be coordinated.** Anything either side writes into `HDG` or `ALT`
before control has moved brings up a line above the Strips: "CLIMB is a control instruction and CTR still has control of
this flight. Coordinated with CTR?". **Coordinated with CTR** sends your write again with the attestation (it is
audited); **Cancel** drops it. Nothing is sent without your click. If the transferring side drops its Strip, comms and
control both move to the receiver (a warning says so); if the receiver drops its replica, what it held goes back. If
nobody staffed can hold either, the Strip shows `NO CONTROL HOLDER` (sign on at the Position that should) and a repair by
the system shows as `CONTROL MOVED` and a `… MOVED BY THE SYSTEM` chip.

**To the carrier.** `AP` or `CTR` can hand an `ARRIVAL` at `INBOUND` to `CV_MARSHAL`: in **Coordinate…** pick `HANDOFF`,
then **to CV_MARSHAL**. The Marshal gets it in `cv-marshal-coordination`, Accepts, and the flight joins the stack at the next
free slot as a Marshal Strip; from then on the same rows and steps apply, with the Marshal as the receiver (it can Accept or
Reject, mark the aircraft checked in and request a release, but proposes nothing). The carrier's own area (§8A) is its
airspace for a not-released handoff, while the ship is found.

### Divert: a new destination and a new clearance (`docs/adr/0111`)

**Divert…** is in the Strip's `⋯` menu for `AP` and `CTR`. The flight is now going to a different airport, on the same Strip
and the same flight data. Type the new destination; fill the route, the altitude (and its restrictions), holding and special
information you gave the pilot. A field you leave blank stays as it was; a route you type replaces the whole route. The form's
fields and their order are the clearance items of FAA JO 7110.65 ¶4-2-1 (clearance limit, route, altitude data, holding,
special information); ¶4-2-5 is why the altitude restrictions sit beside the maintain altitude (an amended route or altitude
restates them), ¶4-5-7 the maintain altitude. What you say on frequency is yours: the form stores the result.

| The Strip now | New destination | Result |
|---|---|---|
| OVERFLIGHT (`INBOUND`, `IN_SECTOR`) | Incirlik or the carrier (a field we run) | an ARRIVAL at `INBOUND`, handed on as usual (`CTR` to `AP`, or to `CV_MARSHAL`) |
| OVERFLIGHT | anywhere else (outside our airspace, untowered, no Facility) | stays an OVERFLIGHT with you, with the new destination, until you hand it off or terminate it |
| ARRIVAL at `INBOUND` | another field we run | an ARRIVAL for it |
| ARRIVAL at `INBOUND` | anywhere else | an OVERFLIGHT at `IN_SECTOR` |

A name is enough ("Incirlik" finds `LTAG`). The old destination stays on the Strip, struck through, and the new altitude
goes into the altitude history like any other. **Undo** works for 10 seconds; diverting back is a second divert, and both
are in the audit. A departure does not divert (the menu item is greyed with the reason, and the server refuses it): a
departure that turns back is told to call Center. An ARRIVAL already with the tower is the tower's. Divert is refused while
a coordination proposal or a TOFI is open on the Strip, on the sending side of an accepted HANDOFF, and on the receiving side
until control has moved (a new route or altitude is a control instruction); the refusal says which.

The Divert action, the table above and the guards are ours; only the clearance items are the FAA's. A carrier flight has
no Divert: the Marshal drops its Strip.

### Forwarding obligations — the timer indicator

Some things have to happen by a time: forward an arrival at least 15 minutes before it reaches
the next Facility, forward again when its estimate moves by more than 3 minutes, get a void-time
flight airborne before its deadline, get an airspace activated once a flight approved into it is working inside it. When
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

**Defining airspaces.** An airspace is defined in the panel's editor by its controlling Position (below), or listed in
crc-sync's standing list, `config/efsp-airspaces.json`, keyed by theater. Each id in the list is imported once, on the
first mission load on that theater (a later delete in the panel is not undone; a later addition lands); after that the
panel's edits are what counts. The list ships the three jurisdiction areas of Syria (below) and no MOA or range. A copy in
`state/efsp-airspaces.json` replaces the shipped file whole, so it must carry the jurisdiction areas too; one that does
not validate stops start-up. One entry per MOA or range looks like this:

```json
{
  "Syria": [
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
      "type": "RESTRICTED",
      "controllingFacilityId": "INCIRLIK",
      "controllingPositionId": "AP",
      "usingPositionId": "SOUTH_RANGE",
      "controlFrequencyMhz": 283.5
    }
  ]
}
```

- `controllingPositionId` is **who approves activation** — the Position that owns the airspace the
  MOA sits in. In SOURCE's model (the project owner's airspace picture, `adr/0036`) the MOAs around Incirlik belong to Ankara Center (`CTR`), not Incirlik Approach. The sourced rule is only that ATC, not the using agency, approves activation (guide §9.11).
- `usingPositionId` is **only** for a range with a control tower of its own. Including it creates a
  Position under a `RANGES` Facility that somebody can act as; leaving it out (the ordinary MOA
  case) creates no Position at all, and the controlling Position runs the airspace by itself.
- `type` is one of `MOA`, `RESTRICTED`, `PROHIBITED`, `WARNING` (an area: the FAA's special use airspace types), or a
  route type (an MTR). It decides which aircraft inside an active airspace raise the airspace-conflict alert (below),
  which areas take a transit, and that a prohibited area is always in force. The separation regime is never derived
  from it.
- **A range is not an airspace type.** A range is a place on the ground and its controller is the airspace's using
  agency. Make the airspace over the range **restricted** (over land, hazardous activity), **warning** (offshore, beyond
  3 NM) or a **MOA** (non-hazardous), and name the range control Position in `usingPositionId`, as in the example above.
  There is no `RANGE` or `DANGER` type: a Board or a `state/efsp-airspaces.json` that still holds one does not start, and
  crc-sync names the airspace (delete it or retype it).
- Frequencies are **MHz as a number**, 30–400. A range's `controlFrequencyMhz` is its tower; a
  MOA's `workingFrequencyMhz` is what flights working inside it go to.
- `altLowerFt` / `altUpperFt` are optional published vertical limits, in whole feet. When set, any
  altitude block assigned to a flight has to fit inside them.
- crc-sync must be restarted after editing this file. The panel's own edits need no restart.

**The lifecycle.** `RETURNED` (available) → `SCHEDULED` (booked) → `ACTIVE` (in use) → `RELEASED`
(the using agency is finished) → `RETURNED` again. A range schedules its own airspace and requests
activation; the controlling ATC Position approves it, and takes it back at the end. A MOA with no
range control skips the request — its controlling Position schedules and activates directly.

**Prohibited areas are always in force.** They have no schedule, no activation and no release; the card reads
`IN FORCE`, has no state buttons, and the map draws the area as an active one (it shows under the ACTIVE filter too).
Any aircraft inside one without an approved entry alerts, VFR included. Approve an entry only on the using agency's
word (**Airspace…** on the Strip, or the card's **Approve**). A prohibited area has no transit.

If you are signed on to both sides, you still press both buttons: the state changes are real, only the
conversation with another controller collapses.

**Who defines, who uses.** Only the airspace's **controlling Position** creates, edits and deletes its definition
(and the web admin). The **using agency** uses it: at Incirlik that is `OPS`, which schedules, requests activation,
releases and approves entry for the airspace Incirlik uses, but defines none (JO 7400.2R ¶21-1-10, ¶21-1-11). The
airspace editor acts as the airspace's controlling Position when you hold it, and its header says which (*Creating as
CTR*): signed on to `OPS` and `CTR`, a CENTER airspace is created as `CTR`. A refusal names who may do it ("OPS may not
create MOA-GAZIPASA: only CTR may").

**On the map**, an airspace whose outline was copied from a mission drawing replaces that drawing while the airspace is
shown and the drawing still has the copied shape. Hide the airspace in the Airspaces menu and the drawing comes back
(ours).

**Putting a flight in.** Working and range-control frequencies, and approving a flight onto one, are this squadron's operating practice, not an FAA or DoD procedure (`[SOURCE-DEFINED]`, `adr/0037`); the approval round trip itself is guide §9.11. On the Strip, **Airspace…** → pick the airspace → *Approve entry*. The
flight's frequency (Block 22, `FREQ`) is filled from the airspace, and a badge on the Strip names
where it is working. **Leave airspace** clears both. You keep the Strip throughout — approving a
frequency change hands over nothing. Entry is approved by the Position working the Strip (it relays the
using agency's permission, JO 7110.65 ¶9-3-1 NOTE) or by the airspace's **using agency** itself on a Strip of
its own Facility that it does not hold: `⋯` → **Airspace…** lists only the airspaces that Position uses. The
using agency's Bays do not show other Positions' Strips, so in practice the Position working the Strip
approves.

Approving a flight into an airspace nobody has activated is allowed, not blocked — the block may
well be hot with the board simply not caught up. Releasing a block with flights still in it is allowed for the same
reason.

**The airspace badge** (`adr/0134`). A Strip approved into an airspace shows the airspace's name, frequency and entry
block. It is grey while the aircraft is on the ground, en route, or inside an active airspace. It turns **amber** only
while the aircraft is airborne inside its approved airspace and that airspace has not been activated (hover: "East MOA
is SCHEDULED, not active"): the block still belongs to the controlling agency, so the aircraft is working it
unprotected. Activate the airspace, or move the aircraft out. Only the controller holding the Strip sees the amber.
The orange-red forwarding-obligation chip `UNACTIVATED AIRSPACE ENTRY` (§8) follows the same rule: it appears only while
the flight is airborne inside the airspace you approved it into and that airspace is not active, the moment the badge
turns amber. Approving early, on the ground or en route, raises nothing; it goes when the airspace is activated, the
flight leaves, or the approval is cleared.

**Sharing a block by altitude.** Approving entry takes an optional altitude block, which is how, in this model,
two aircraft share one area: hold the working flight down to 5,000–15,000 while a transit crosses at
20,000–28,000. Type it in the lower and upper fields of the **Airspace…** form, or later with `⋯` → **Entry block…**,
which re-issues the approval to **amend** the restriction (empty fields lift it). No restriction at all is not the same
as a restriction covering the whole area — the first says nobody has deconflicted this flight yet, the second says
somebody has. The board shows each flight's block next to its callsign. When the flight has no assigned `ALT`, the
conformance check (§8E) watches it against its entry block; an assigned altitude wins.

### The airspace card's flight list (`adr/0124`)

If you hold the airspace's using agency (OPS at Incirlik) or its controlling Position, the card of a restricted,
prohibited or warning area or a MOA lists the flights **inside** it and those **filed** through it (the filed route
crosses it, it is the flight's working airspace, or the flight is already approved into it). Each row shows the
callsign, why it is listed, and **Approve**, or a grey "approved" once entry is approved. A row turns **amber** only
while the flight is inside without approval and raising the airspace-conflict alert. **Approve** approves entry on the
flight's Strip, wherever the Strip is (AP's, CTR's); the Strip stays where it is and the alert clears for everyone. A
flight without a Strip (an uncorrelated contact) is not listed: correlate it first. Other Positions see no list.

"Filed through" is worked out from the filed route's points: DCS mission nav points, airport ICAO codes and our own
ROUTE airspaces' fixes. A route whose fixes are none of these (the stereo routes' fixes, until AIRAC data, §4A) is not
filed through anything.

### Transit through an active MOA, warning or restricted area (`adr/0128`, `0136`, `0144`)

If an IFR flight you work needs to go through an active MOA, warning or restricted area, open its Strip's
`⋯` menu and choose **Request transit <area>** (with several, **Transit…** opens a picker). The request goes to whoever
separates that airspace's users: `TAC_C2` when the using agency is TACTICAL, otherwise the airspace's controlling
Position (OPS only sees it). They answer on the airspace card with **Approve transit** or **Decline transit** (an
optional reason). Your Strip shows a grey `TRANSIT <area> REQ`, then `TRANSIT <area>` or `TRANSIT <area> DECLINED`; you
can **Cancel transit request <area>** while it waits. An approved transit is an approved entry: no airspace-conflict
alert. It does not move the flight's frequency.

The restrictions are the ordinary assignments: give the transit its altitude (`ALT`) and the users theirs (`ALT`, or
**Entry block…** for an approved entry); clear them when the transit is through. The decider may approve a listed flight
without a request, and may decline one already approved. If you hold both sides, the item reads **Transit <area>
(approve)** and the request is approved at once.

A **decline stays** on the Strip (`TRANSIT <area> DECLINED`) and on the card until a controller holding the flight's
Strip picks **Acknowledge transit decline <area>** from the Strip's menu, or **Acknowledge** on the card row.

**Transit complete.** When a flight with an approved transit has left the area, choose **Transit complete <area>** on
its Strip's `⋯`, or **Transit complete** on its row of the airspace card. The `TRANSIT <area>` mark leaves the Strip. If
the flight comes back in, it is an unapproved entry again: it alerts and needs a new transit. If you are not the side
that decided the transit, the decider's card row shows a grey `transit complete` until they press **Acknowledge**.
Nothing on anyone's Strip changes: if you restricted the area's users for the transit, change their altitudes
yourself. If you decide the transit yourself, Transit complete ends it with nothing to acknowledge. There is no Undo:
if you ended it by mistake, request the transit again.

A transit also ends when the flight's last Strip goes, when the airspace is released, or on a new mission. A VFR flight
needs no transit (VFR is not denied a MOA, below).

**The `COORD` mark.** A grey `COORD <area>` on a Strip means the flight's filed route crosses that active MOA, warning
or restricted area and nothing is coordinated yet (no transit, no entry approval). It goes when you request
a transit, approve its entry, or the airspace goes cold. It stays away while a completed transit waits for the
decider's Acknowledge; after that it comes back if the filed route still crosses the active area, even when the flight
has passed it (the route check looks at the whole filed route). Only the controller holding the Strip sees it. A cleared
`ALT`/`HDG` (an emptied field) is no clearance: the flight reads as VFR again for the transit and entry rules.

### Jurisdiction areas: whose airspace an aircraft is in (`adr/0125`)

The airspaces panel lists, under the airspace cards, the **JURISDICTION** areas that say whose airspace an aircraft is
in: the **LTAG CTR (control zone)**, the tower's (`LC` and `GC`); the **Incirlik RAPCON** (`AP` and `PAR`; the control
zone is cut out of it); and the **carrier area** (50 nm round the ship, every carrier Position; it wins wherever the
ship is, and is nowhere while the hull is not found). Everywhere else is CENTER's. Each card shows its class (if it
has one), its limits (feet MSL), **its VFR service** and its shape, with the published text it came from.

Türkiye does not classify its airspace: the **Incirlik RAPCON is the Adana MTMA** and has no class. Its VFR service is
**IFR separated from VFR; VFR to VFR traffic advisories**: Approach separates IFR traffic from VFR, and gives VFR
traffic advisories about other VFR. The **LTAG CTR (control zone)** is **Class D**, so VFR gets traffic advisories and
no separation from IFR in the air (its line ends "(Class D)"). The carrier area and everything outside the areas
(CENTER's) are Class E (VFR: traffic advisories, no separation). The three VFR services are *VFR separated from IFR and
VFR* (Class B's), *IFR separated from VFR; VFR to VFR traffic advisories* (Class C's) and *VFR: traffic advisories, no
separation* (Classes D to F); a class gives its service, Class A and G have none, and an unclassified area must name
one.

The Position that controls an area edits its **CLASS** (with *none (unclassified)*), its **VFR SERVICE** (*by the
class: …*, or one of the three), its limits and its shape with **Edit…** (`AP` the RAPCON, `LC` the control zone, `CV_PRIFLY` or `CV_MARSHAL` the carrier area,
whose ship cannot be changed). crc-sync refuses an edit that would make two areas other than the carrier's overlap, and
says which. Nobody creates or deletes one in the panel, and no flight is approved into one. On the map they are off by
default: **Airspaces ▾ → KIND → JURISDICTION** draws them as thin grey outlines.

They decide where control of a not-released handoff moves (§8). The limits of the control zone and the RAPCON are AIP
Türkiye's; the control zone's Class D is the squadron's choice; the Class E areas and the carrier area are ours.

### The airspace-conflict alert (`adr/0119`)

An aircraft inside an **ACTIVE** airspace that it may not be in raises an alert. Who may be in it follows the FAA, by
airspace type:

| Type | A flight with a Strip and no approved entry | A VFR flight with a Strip | A contact with no Strip |
|---|---|---|---|
| `RESTRICTED`, `PROHIBITED` (always in force) | alerts | alerts | alerts |
| `MOA`, `WARNING` | alerts (ours: an IFR flight goes through only by agreement) | **never** (VFR is not denied a MOA) | alerts |
| a route (MTR) | never | never | never |

- **VFR** here means the flight has no assigned altitude and no assigned heading: there is no flight-rules field (§8C2).
- **Approved** means the flight is working that airspace (`Airspace…` → Approve entry, above), or the military unit it
  was handed to by TOFI has the airspace active. Approving entry, or the aircraft leaving, ends the alert.
- A contact with no Strip alerts only when its transponder reports altitude; a formation's wingmen are the flight (one
  alert per flight and airspace). Nothing alerts below 50 kt or in a track's first 10 s (`alerting.json`
  `airspaceEntry`, ours, as Conflict Alert). It looks at where the aircraft is now; there is no look-ahead.
- **Who sees it:** the airspace's controlling Position and every Position holding a Strip of the flight (a contact
  with no Strip: the controlling Position only).
- **How it looks:** amber. On the ATC scope, line 0 of the data block reads `SAA`, blinking until you click the target
  to acknowledge it (on your scope only; a new entry blinks again); the classic label shows `SAA` too. The Strip gets the
  chip `Airspace conflict <name>`, and the track panel a line. An untracked contact is answered by starting flight
  following on it (§8C2) and then approving its entry.

The FAA's nearest equivalent is the en-route probe's aircraft-to-airspace alert (P/CG AIRSPACE CONFLICT); ours fires on
containment, at every ATC Position, and the `SAA` tag is ours.

## 8B. Radar coverage — it follows what you're acting as

**There is no radar selector any more.** What you can see on the scope is decided by the Positions you
are signed on to under **ACTING AS**, not by anything you tick. The PANELS panel reads ACTING AS (at the top), then
PANELS, then the radars your Positions see, behind one grey line, `RADARS · n ▸` (plus `· k GND` when some are on the
ground and sweeping nothing). Click the line to show or hide the list; the client remembers whether you left it open.
The list is read-only: it tells you which radars your Positions give you, and which Position gave you each one. With no
radar it reads `RADARS · 0` and says why ("No radar coverage — select a Position under ACTING AS above.").

These are the shipped `positionRadars` defaults and radar figures: SOURCE's guess at which scope sits at which console, not any real facility's equipment (`adr/0042`, `0043`; §8F1).

| Signed on to | You see |
|---|---|
| `LC` | the field radar crc-sync models for Incirlik (40 nm in our model); aircraft on the ground show on it |
| `AP` | that, plus the approach radar crc-sync models there (80 nm) — you are the RAPCON |
| `CTR` | every airfield's approach radar in the theater, i.e. the en-route picture |
| `TAC_C2` / `AIC` / `GCI` | the own-coalition airborne picture (AWACS and fighter radars) |
| `OPS`, `CD`, `GC`, `JTAC` | **nothing** |

That last row is deliberate, not a fault. In our model (`adr/0033`) Ground and Clearance Delivery work no scope,
so being signed on to only those shows an empty map and a banner saying **NO RADAR COVERAGE — HOLD A
RADAR POSITION**. If you need the picture, take a radar Position; you will get it the moment you do.

Two consequences worth knowing:

- **Everyone signed on to the same Position sees the same thing**, down to when each contact's beam passed
  over it. Observers included — you get the picture for a Position somebody else is Primary at.
- **The picture can change without you touching anything**, when a colleague takes or hands back a
  Position, or when an AWACS takes off. The radar list (`RADARS · n`, open it) is the place to look.

A radar whose aircraft is on the ground is listed with `GC` beside it and shows nothing — that is a
parked AWACS, not a fault. Which scope sits at which console is squadron configuration
(`positionRadars` in the facility config).

- **No radar shows ground vehicles** (`adr/0121`): none of the radars we model is a surface movement radar, so a DCS
  ground unit is never drawn, whatever saw it, and never becomes a Strip's contact. Aircraft on the ground still show.
- **Terrain hides what it should.** A radar does not see through a mountain: the terrain heights come from DCS itself,
  from a cache built once per map on the server (§8O). Without that cache for the mission's map, nothing is masked and
  every radar sees to its full range.

## 8C. Correlation — how a Strip finds its contact

A Strip whose flight is correlated normally shows no badge at all. Anything else shows one:

| Badge | Means | What to do |
|---|---|---|
| *(nothing)* | **correlated**, by its beacon code or a controller's binding. The contact on the scope now carries this Strip's callsign | nothing |
| `NO TRK` | **uncorrelated.** No contact is squawking this flight's code and nobody has bound one. Hover it: if the contact squawking this flight's code is already another flight's, it says which one; if the AI aircraft's code went to a different aircraft, it says *this code now belongs to a different AI aircraft* | `Bind…` it if you can see which one it is, or give the Strip the code it is squawking |
| `TRK ×2` | **ambiguous.** Two contacts are squawking this flight's code, and the system will not guess | click it and pick the right one |
| `TRK ··` | **correlated, but the contact is outside your coverage.** Somebody else's radar has it; yours does not | nothing — it is not yours to see |

`NO TRK` in a warmer colour, with a coloured edge on the Strip, means something stronger: the contact
this flight *was* on has gone. That is different from never having found one, and it is worth a look.

That `TRK ··` row is worth understanding, because it is the seam between two ideas. Correlation is
worked out once, server-side, against every contact the server knows about — it is a fact about the
flight. Coverage is per-Position and is about *you*. So a flight can be correctly bound to a contact
that simply is not on your scope, which is the normal case for an en-route flight when you are working
Tower. Nothing is wrong, and there is nothing to click.

**A flight is never matched by its callsign.** A jet with its transponder off, or squawking a different code,
stays `NO TRK` until you bind it or give the Strip the code it is squawking.

**`Bind…` is the override, and it wins over everything.** If you can see the contact, you can say so, and
the binding sticks until you `Unbind` it. It is also how you settle a
`TRK ×2`. From the keyboard: `.bind <track id>` and `.unbind` on the selected Strip.

**The assigned code finds the jet, whatever it flew as before.** A contact squawking a Strip's Block 5 code is
correlated to that Strip even if an earlier, finished flight had that same jet: that is how the FAA's automation
acquires a flight (JO 7110.65BB ¶5-3-3 d, ¶5-3-4; a finished flight holds no code). Two flights assigned the same code cannot both
have the one contact squawking it: the second says `NO TRK` and names the first.

**Correlating an AI flight.** An AI aircraft squawks a code from crc-sync's synthetic block (6000–6777 as shipped).
Read it off the contact's data block and type it into the Strip's beacon code (Block 5): the Strip correlates on the
next second. crc-sync never assigns such a code itself, and an ATO's Mode 3 in that block is still refused. When that
AI aircraft leaves, crc-sync may give its code to another AI aircraft; the Strip does not follow it, it says `NO TRK`
(*this code now belongs to a different AI aircraft*). Bind the new aircraft if it is yours, or enter the code of the
one you mean. A discrete code is different: whichever aircraft squawks it is the flight, as above.

**Finding the contact.** Selecting a Strip does not mark its aircraft on the map. To find it, open the Strip's `⋯` menu
and choose **Show on map**: the contact is ringed for 8 seconds (ours) and the map pans to it if it is off screen (the
zoom stays). The item is greyed out when the flight's contact is outside your radar coverage, and missing when the
flight has no contact (use `Bind…`). Clicking a contact on the map still selects its Strip and scrolls it into view;
clicking a contact that has no Strip leaves your selection alone.

**After a DCS mission reload, every Strip briefly says `NO TRK` and then re-binds itself on the
squawk, usually within a second.** That is correct and expected: a reload gives every aircraft a new
internal identity, so the system drops the old one loudly rather than quietly pointing at something
that no longer exists. A flight whose transponder is off will stay `NO TRK` until somebody binds it.

The panel header shows a rate — `TRK 96% (24/25)` — of how many flights that could have a contact
have one. It turns amber below 95%, which the guide treats as a defect rather than a fact of life. A
flight still on the ramp is not counted.

## 8C1. TOFI — handing a flight to the military, and the mission line

Two records, one flight. The **ATC Strip** stays live and posted the whole time — the
flight keeps its IFR clearance, keeps its ATC beacon code, and ATC still separates
non-participating traffic from it. The **mission line** is the MRU's own record of the
same aircraft, worked by `TAC_C2` or `GCI`.

### Fragging the mission line (`TAC_C2`)

**Do this at tasking, not at the boundary.** Pick `TAC_C2 · Mission` in the New Strip
toolbar and choose the flight from the **bind picker** beside it — rows read
`VIPER11 · 4201 · LTAG DCT ALPHA`, so two jets in one package with adjacent callsigns
are distinguishable. Or type `.mission VIPER11`.

- The mission line lands in **Tasked** and shares the flight's flight data, so it shows that
  flight's callsign and **its beacon code** — one Mode 3/A, never a second. If the callsign
  is wrong you picked the wrong jet: drop it and frag another. There is no re-bind.
- Leave the picker blank for a mission that never touches ATC airspace at all — that
  files a standalone mission line with its own flight, as before.
- One flight gets **one** mission line. A second is refused, naming who holds it.
- Both Strips show a blue **`+1`**. Hover it: it names the other Strip's Facility,
  Position and strip type, which is how the ATC controller spots a mis-bind.

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
   With one counterpart the `⋯` menu offers **TOFI to CTR**, which sends at once; CTR's **TOFI…** opens a picker
   whose button names the choice (**TOFI to TAC_C2**, **TOFI to GCI**).
2. The MRU presses **Accept TOFI Entry** — and **must pick a separation regime** from
   the `<select>` beside the button. This is what the flight data records as the answer to
   "who is separating this aircraft", and it is asked rather than guessed because it
   comes from the governing agreement. An accept without one is refused. The regime does
   **not** take effect at the accept: ATC keeps separating the flight until it is inside
   an airspace (see "When the regime takes effect" below).
3. **Transfer Comms** is a separate press, from either side.

### When the regime takes effect

The regime you pick at accept is **pending**, not in force. `SEP REG` stays `ATC` and the
MRU's Strip shows `SEP REG ATC → USING_AGENCY on entry` (CTR's `SEP REG` Block shows the
same as `→ USING_AGENCY on entry` beside the value). It becomes the effective regime when
either happens, and only then:

- The flight is inside an airspace that is **active for the MRU's Facility** for two
  consecutive seconds (the system notices this by itself; it needs the flight correlated to
  a contact), or it already was at the accept.
- The MRU presses **Entered** on the mission line (the exchange row, MRU side only). It is
  always allowed. If the flight is not inside an active airspace, the amber line under the
  Strips says so ("not inside an airspace active for you") and the regime is made effective
  anyway: you are telling the system something it cannot see. Undo (10 s) puts it back to
  pending. Picking ATC at the accept leaves nothing pending.

Before entry, a non-ATC value typed into `SEP REG` replaces the pending one, and `ATC`
clears it. A TOFI exit while a regime is still pending is not blocked by it (`SREG` is
`ATC`), and the exit drops the pending regime.

Two chips on the Strip are advisories and never change the regime: **OUTSIDE AIRSPACE**
(after entry the flight has been outside for 10 s, or the airspace was deactivated; the MRU
decides what that means) and **ENTRY UNKNOWN** (the airspace has no geometry or the contact
cannot be placed, so entry is not detected: press **Entered** yourself).

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
  "works under `TAC_C2`'s TOFI"). A controller signed on to both Positions answers it from the AIC tab and it is
  sent as `TAC_C2`. A signed-on `TAC_C2` also gets a **"with AIC/JTAC"** tab, only while there is something in
  it, listing the live MISSION lines AIC and JTAC hold, so a `TAC_C2`-only controller can see one and Accept
  `CTR`'s exit from the panel. It is read-only guidance: nothing can be dropped on it, and it lists mission
  lines only. **Gap:** a line `GCI` holds is not listed (GCI is not a `TAC_C2` delegate).
- **JTAC.** A JTAC is **sent only the lines `TAC_C2` has handed it**: its Strips, flight data, correlations,
  MARSA and alerts for those flights, and nothing else on any Board. It annotates nothing, binds no
  contact, declares no MARSA, and can only **hand back** (to `TAC_C2`). A JTAC who signs off leaves
  the line with `TAC_C2`. (A controller signed on to nothing but `JTAC` at the Facility is not given drop-only tabs
  for the other Positions, H59.) An observer of `TAC_C2` reads
  everything `TAC_C2` does.
- **The hand-back.** `TACTICAL` is not air traffic control, so it is the one Facility where a sign-off still moves Strips: when `AIC`, `GCI` or `JTAC` signs off, its lines go to `TAC_C2`, into the Bay for the line's state (else the first Bay implying no state, else they stay put with a warning, and the ack reports how many were `unplaced`). They carry `consolidatedFrom` and go back when the Position is staffed again; the warning is `routedTo: TAC_C2`. At every other Facility nothing moves at a sign-off: see §8M.
- **Coordination.** The proposer can **Cancel** an open proposal, or **End** an accepted exchange, from the
  `⋯` menu. If the receiver drops its side, the exchange ends on the proposer's Strip too (the link is
  cleared, not marked with a new state). Only a live (PROPOSED or ACTIVE) link ends: a completed handoff has
  moved ownership, so a later ordinary drop by the receiver does not touch the sender's Strip.
- **OPS alert status** is set by `OPS` at every state until the Strip is dropped (§8H).
- A `SetState` to `DROPPED` is a Drop, and is refused under an open proposal or active TOFI like one.

## 8C2. Flight following — radar service for a contact with no Strip

**Flight following** (VFR radar traffic advisories) starts on the contact itself. Signed on as Primary to a Position
with a VFR Bay, click a contact that has no Strip: its menu offers **AT**, **ACID** and **TYPE**. Type the callsign and,
optionally, the aircraft type and press **TRACK** (or Enter); TRACK with no ACID opens the track panel, whose **Tag VFR**
section does the same. Or type `.ff <track number> <CALLSIGN> [TYPE] [@POSITION]`, where the track number is the one the
data block shows.

**AT is where the strip goes**: one button per Position you work that has a VFR Bay, the lit one taking it. The menu and
the track panel share the pick, and it stays until you pick another or stop working that Position. `.ff` shows nothing on
screen, so when more than one of your Positions could take the strip it asks for `@AP` (or whichever); with one, it needs
none. "IFR cancelled" makes no new strip: the Strip turns VFR where it is, at its holder.

In one step the flight gets flight data, a **discrete code** to issue, and an **OVERFLIGHT** Strip in your Overflight
Bay (`ap-overflight` / `ctr-overflight`), already **in sector**, and the contact is tracked under its callsign (bound to
the Strip, as `Bind…` would). The FAA's three acts, track and tag (JO 7110.65BB ¶5-14-4 c), a code (¶5-2-7 a) and radar
contact (¶5-3-7), are one action here (ours). A refusal (the contact is already tracked as another flight, no
Overflight Bay or room in it, a bad callsign or type, no free code) shows on the panel's own line and spends no code.
A flight that leaves or lands at our field is filed the ordinary way, as a DEPARTURE or ARRIVAL.

**VFR is shown the FAA way**: there is no flight-rules field. A flight-following Strip is a Strip with no clearance, no
assigned `ALT` or `HDG`, so conformance has nothing to check on it (§8E). Its equipment suffix comes from its equipment
codes as for any flight; nothing is asked at the start. Approve its entry into active airspace from `⋯` → **Airspace…**
as for any flight (§8A).

`KEEP IFR` is not on a flight-following Strip's face (VFR has no IFR to keep); it is in the expanded view, and stays on
the face once set. A cleared `ALT` or `HDG` (the field emptied) is no clearance: the flight reads as VFR again.

**Ending it** ("radar service terminated, squawk VFR", ¶5-1-9 a): `⋯` → **Radar service terminated** (or `.term` on the
selected Strip), offered on an overflight Strip or a VFR departure with no clearance that your `AP` or `CTR` owns, and greyed while a
coordination or TOFI exchange is open on it. The Strip is dropped, the code released, any airspace entry cleared and
the contact untracked at once. It is not the Strip's next step: that stays **Leaves Sector**, the handoff path.

**A VFR departure** (CD's **VFR…**, §3) reaches `AP` as an ordinary handed-off DEPARTURE with no clearance. `AP`
keeps flight following on it, or, when it leaves the MTMA or the pilot cancels, `⋯` → **Radar service terminated**. Its
**DIR** cell shows where it is heading.

**Undo** takes either back within 10 s: Undo of the start removes the Strip, the flight data and the binding; Undo of
the termination puts back the Strip, code, entry and binding, but never takes a contact another flight has picked up
since (the Strip then stays unbound, with a warning).

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
case (tanker accepted / until vertically positioned), our default because it is the case guide §9.2 spells out in full; the popover is where you pick an MTR entry or a
local declaration instead.

A flight is in **at most one** relation at a time. Once one is running, `.marsa <CALLSIGN>` means
"this flight is joining us" rather than "start another one".

### The badge, and the one that matters

| Badge | Means | What to do |
|---|---|---|
| `MARSA ⚠` | **a tanker MARSA, declared, but they have not joined up yet.** The interlock is live | see below before you assign anything |
| `MARSA` | **joined up** (rendezvous is marked, the interlock is spent), or a MARSA declared at an MTR entry or locally, which has no interlock | nothing |
| `MARSA ✕` | **voided.** Hover it — it says why. ATC is separating them again from that moment | resume separating them |

Selecting any participant outlines the others, so you can see at a glance who is in it.

**A void stays until acknowledged.** A voided relation shows a row on every participant's Strip, `MARSA VOIDED ·
<the others>`, with the reason in the red line under it, until a controller holding one of the participants' Strips
presses **Acknowledge**; then nothing is shown.

**Air refuelling: the receiver is watched against the tanker.** Once the tanker has accepted MARSA, a receiver is not
checked against its own assigned altitude or heading but against the tanker: within 1,000 ft above or below it (ours)
and within 3 NM (JO 7110.65 ¶9-2-13 c NOTE 3, JO 7610.14A ¶5-5-3 c). Outside that it raises `AR ↓`/`AR ↑` (outside the
block and moving away from it: 2,000 ft below and climbing toward it is fine, 1,350 ft below and descending is not), `AR −700`/`AR +700` (left the
block after being in it) or `AR 3.8 NM` (more than 3 NM away, once it has first closed inside 3 NM). The tanker is
checked as usual. The tanker is the ATO's AR tanker, else the flight whose callsign declared the MARSA; with no tanker
found, no participant is checked. When MARSA ends the receiver is back on its own clearance, and a level aircraft
away from its old altitude does not alert until it has reached it again. A MARSA at an MTR entry or declared locally
keeps ordinary conformance.

### The interlock — the thing to know before you touch anything

> **While the badge reads `MARSA ⚠`, assigning a heading or an altitude to any participant voids the
> relation.**

Only a **tanker** MARSA (start event "tanker accepted") has the interlock and shows `MARSA ⚠` and **Mark rendezvous**. A
MARSA declared at an MTR entry or locally (two fighters working a MOA, say) is never voided by an assignment: keep
working them.

That is doctrine, not a panel quirk: issuing a course or altitude change before the rendezvous breaks
the join-up, so the military can no longer be assumed to be separating them. The panel does **not**
refuse your clearance — it goes through, and MARSA ends underneath it, with every participant's Strip
showing `MARSA ✕` and the reason. Separation is yours again.

The Blocks that trip it are the ones that mean *ATC assigned this*:

| Strip | Heading | Altitude |
|---|---|---|
| Every strip type | `HDG` | `ALT` |

Both belong to the flight (§4B), so assigning either at *any* Position voids a tanker relation before rendezvous.

**MARSA in a MOA, click by click.** On either flight's Strip: `⋯` → **MARSA…**; pick the other flight, start event
**local declaration**, end condition **until ATC separation is re-established**, type the declaring callsign →
**Declare**. Both Strips show `MARSA` and `SREG` reads MARSA: no CA or MCI between them, alerts against everyone else
stay. Headings and altitudes you assign do not void it. Each flight still needs its own entry approval into the MOA
(§8A: the airspace card's **Approve**, or **Airspace…** on its Strip); MARSA approves nobody. End it with **MARSA…** →
**End MARSA** when ATC separation is re-established.

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

## 8D1. Splitting and joining a formation (`adr/0099`)

A formation is one Strip with a size above 1. Any ATC Position (not the tactical or carrier ones) that owns a live
DEPARTURE, ARRIVAL or OVERFLIGHT Strip can break it up or fold another flight into it.

- **Split.** Strip menu, group Formation, **Split...**: `Leaving` (1 up to size minus 1, with "of 4, 3 remain"), the
  departing part's `Callsign` (always typed), and an `Assignment`: heading, speed or altitude. The assignment is
  required unless the Strip is on the ground (DEPARTURE up to LUAW, ARRIVAL LANDED and TAXI_IN), where the row is
  hidden. `Back from MARSA` records that the split is being noted on return from MARSA; the assignment is still
  required. The part appears directly after the lead with its own new beacon code and a copy of the plan. It is an
  ordinary flight on the Board: nothing on its Strip says it was split. The split is in the Mutation log, and Undo still
  reverses it. A split is binary: for 1+1+2, split twice.
- **Join.** Menu **Join formation...** on the joining Strip lists your other live Strips; one click sends it. The joiner
  ends as joined (it leaves the Board like a drop), its beacon code is released and the lead's size grows. A joiner that
  still has a Strip at another Facility is not offered: resolve that first. There is no confirm; Undo covers a mistake.
- **Typing it.** On the selected Strip: `.split <k> <CALLSIGN> <H270|S250|SM.80|A120|FL240>`, add `MARSA` for a return
  from MARSA, drop the assignment on a ground Strip; `.join <LEAD-CALLSIGN>`.
- Speed is a recorded assignment only: it shows in the SPEED Block, nothing checks the aircraft against it.
- A refusal from the server (for example the code pool being empty) appears in the red banner.

## 8E. Conformance and Conflict Alert (CA)

crc-sync compares every correlated flight with its `ALT` and `HDG` once a second, and pairs of
airborne contacts with each other (who against whom: below) (`adr/0058`). **Nothing is shown when nothing is wrong.** When
something is, the Strip gets an orange-red edge, an indicator and a reason line, the data block on
the scope gets a coloured tag, and the track panel lists it.

| Indicator | Means |
|---|---|
| `HDG 072` | more than 5° off the assigned heading for 10 s, once it has had time to make the turn (below). The number is where it is actually going, **magnetic**; where the variation is unknown the heading is not checked at all |
| `ALT ↓` / `ALT ↑` | going the wrong way: told to climb and descending, or the reverse, faster than 500 ft/min |
| `BUST +600` | it reached its `ALT` and has since left it by more than 500 ft |
| `Conflict Alert SNAKE21 0:55` | on present course and rate it will be within 3 NM and 1,000 ft of SNAKE21 in 55 s. Both aircraft are tracked (they have Strips). Only at an ATC Position (LC, AP, CTR…), and only when both aircraft are on your scope |
| `Mode C Intruder TN00042 0:40` | the same prediction against an aircraft with **no** Strip (named by its tag or track number) whose transponder reports altitude, above the Facility's base altitude (below) |
| `AR ↓`, `AR −700`, `AR 3.8 NM` | a receiver under tanker MARSA has left the refuelling block around the tanker (§8D) |
| `GP ↓` / `GP ↑` | on a PAR final after **Begin descent**, more than 0.5° below or 1° above the glidepath for 2 s, above DA (§8L) |

**Time to make the turn.** A new heading gets as long as the turn takes plus 15 s: the turn is measured the short way
round, at 3° a second, or slower where 25° of bank gives less at the aircraft's ground speed (a 180° turn at 450 kt
gets well over a minute). While it turns, the turn left to go has to keep shrinking: if it stops (levelled off short of
the heading, or turning the wrong way) `HDG` appears 10 s after the last progress. The figures are in `alerting.json`
(`headingTurnRateDegPerSec`, `headingTurnMaxBankDeg`, `headingGraceMarginSec`, `headingPersistSec`).

The "for 10 s", "for 3 s" and "for 2 s" in this table (heading, wrong-way, level-bust and glidepath persistence, and the turn time) are real elapsed seconds on the server's own clock, not mission seconds (`adr/0096`). If the mission is paused or its clock jumps, they keep counting, so an alert appears the same number of real seconds after the deviation is first seen; the `since` time shown with an alert is still mission Zulu.

Not a warning: a flight that has not started its climb or descent yet ("descend when ready"). Only
a flight going the opposite way alerts. Route conformance and terrain are not checked yet. A flight with no
assigned altitude or heading (a flight-following Strip, §8C2) has nothing to check.

**On a final.** Once the final controller holds the flight (PAR's `ON_FINAL`, or the carrier's BALL), nothing of its
clearance alerts: no `HDG`, no `ALT ↓`/`↑`, no `BUST`, also before Begin descent (a descent PAR gives on the way down is
not checked against the earlier altitude). Course and height guidance are the final controller's own. At an airfield
the one alert is the glidepath, `GP ↓`/`GP ↑`, after **Begin descent** and above DA (§8L); the carrier has none. A
missed approach is checked again against what is then assigned (§8L).

On the scope, a Conflict Alert (CA) draws each aircraft's predicted path to the closest point and a line
between them there. **Settings → RADAR → Conflict Alert → Show predicted paths** (on by default, yours only) hides the
dashed paths and the line; the CA in the data block and the closest-point marker with its countdown always show. **Who alerts against whom** (`adr/0118`, the FAA model, P/CG CONFLICT ALERT and MODE C
INTRUDER ALERT):

- **CA** is only between two **tracked** aircraft: each correlated to a Strip.
- **MCI** (Mode C Intruder) is a tracked aircraft against one with no Strip that **reports altitude**, above the
  Facility's base altitude: 500 ft above the ground at Incirlik and the carrier, 5,000 ft MSL at CENTER (1,500 ft above
  the ground where the ground is higher). Where the ground is not known (no terrain data) it counts as sea level. The
  data block tag is `MCI` (a CA wins when a pair is both); an MCI you acknowledged stays acknowledged if the pair
  becomes a CA. A Facility can inhibit MCI for chosen Positions in its facility file (`modeCIntruder`); there is no
  switch for the controller.
- **Nothing** between two aircraft without Strips.
- **Never inside one group:** two aircraft of one flight (one flight data), or in one active MARSA relation, never alert
  against each other. An uncorrelated wingman within 1 NM and 1,000 ft of a tracked formation (size above 1) is one of
  its members (ours, `alerting.json` `formationLateralNm`/`formationVerticalFt`), and counts as tracked against
  everyone else.

The tactical Positions get no CA — a squadron decision (`adr/0059`, `[SOURCE-DEFINED]`), not a statement of real-world
doctrine. There is no manual suppress of a single alert.

Against a **block altitude** the deviation is zero anywhere inside the block and the distance to the
nearest edge outside it (same 400 ft reached / 500 ft bust tolerances, wrong-way means climbing away from
a block above or descending away from one below). The track panel and the scope's data block show the
block. The Strip's conformance reason line still quotes the nearest edge ("from FL240") rather than the
block. CA does not read the assigned altitude at all.

Altitudes are compared as the controller reads them, on QNH below the theater's transition altitude (§8J) and as
flight levels above it. Every threshold on this page is SOURCE's own choice (crc-sync's `config/alerting.json`, `adr/0058`), not a published standard.

## 8F. Reading a contact — what your sensors can tell you

A contact on the scope shows only what the radars and links of the Positions **you** are signed on to could
know (`adr/0059`). The same aircraft can read differently at two consoles.

| You see | Because |
|---|---|
| `TN00042`, no altitude | a primary return only: your radar has it, but either it does not interrogate or the aircraft is not squawking |
| `6123` / `080 G250` | it is squawking (code, Mode C altitude) and nothing identifies it yet. 6000–6777 is the block crc-sync gives AI aircraft (our convention, `adr/0059`; not a real code allocation) |
| `VIPER11` / `180 G450` | correlated to a Strip: its callsign is the Strip's. Its code (`4521`) shows only while the aircraft is not squawking the code it was assigned (JO 7110.65BB ¶5-4-6 e NOTE); an emergency code always shows. A contact named by the datalink or a tag still shows its code |
| `230*` | an altitude from a radar crc-sync models as height-finding (AWACS, fighter, carrier), not from the aircraft |
| `Enfield11` / `210L` | a datalink report from one of your own aircraft (tactical Positions) |
| `EMR` / `RDF` / `HIJ` in colour | squawking 7700 / 7600 / 7500 |

- **In crc-sync's model a player's transponder is whatever SRS reports, so a player with no SRS client has none.** Approach and tower radars see them as a track
  number with no altitude until SRS is running.
- **crc-sync models airfield and approach radars as 2D with SSR.** Their altitude always comes from the aircraft.
- **Tags** (the track panel's text box) name a contact nothing else
  identifies, for everybody. A correlated flight's callsign takes over from a tag, and the box
  is disabled while it does.
- **The datalink** (crc-sync's model of one, `[SOURCE-DEFINED]`: which types take part is in `sensor-specs.json`) at TAC_C2, AIC and GCI shows your own participating aircraft even with no radar
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
  Positions' radars know. Signed on to a tactical and an ATC radar, the tactical answer wins.
- A declaration shows at once. An automatic change (a pilot switching Mode 4 on) shows with the
  next sweep of a radar that sees it.
- Own AI aircraft and ships answer Mode 4 by themselves. Ground vehicles are never shown (§8B).
- **For pilots:** turn Mode 4 on, or you are grey. With no SRS client you have no transponder at all
  and are a yellow primary return, unless your aircraft reports on the datalink.
- **No aircraft on the ground is hidden.** The tower sees every aircraft on the ground within its
  radar's reach, enemy ramps included. That is on purpose for now. Ground vehicles are not aircraft and no radar we
  model shows them (§8B).

### The ATC scope: STARS-style blocks (LC, AP, CTR)

If you are signed on to an ATC Position, contacts that only an airfield, approach or carrier-approach radar sees are
drawn the way a STARS scope draws them. A contact is still drawn the tactical way while any tactical
radar (AWACS, fighter, ship) or the datalink sees it, and a controller who is signed on to no ATC Position sees the
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
an assigned heading (magnetic, as you typed it). While the aircraft squawks a code other than its assigned one, line 3
starts with the code it is squawking (`4521 A060↓ H250`), as STARS does (¶5-4-6 e NOTE). Line 0, above the block, stacks by severity: `EM`/`RF`/
`HJ` (emergency), `CA` or `MCI` (a conflict alert or Mode C intruder, §8E), `SAA` in amber (an airspace conflict,
§8A), `SA` (a contact someone has declared **hostile**), then the conformance tag (§8E, drawn in the app's own orange, not STARS's). `CST` means your correlated flight has stopped returning (after two sweeps of the slowest ATC radar,
6 s if none says how often).

- **Click the disc** to accept a handoff or point-out (it sends the same `ACCEPT` the Strip's button
  does), to acknowledge `EM`, `CA`/`MCI` or `SAA`, or to step a block down or expand it.
- **Click the block** of a flight whose Strip you own to assign it a heading, speed or altitude: a small menu opens
  on **HDG**; type the value and Enter. Tab to **SPEED** and **ALT**; Enter sends every changed value, as if typed in
  the Strip's cells (same refusals, same "Coordinated with …" line). Esc closes. **TRACK**, or Shift+click on the
  block, opens the track panel. If you don't own the Strip, or the contact has none, the click opens the track panel.
  A tactical label answers the same click. Acknowledgements and click-downs are local to your scope and are not synced, as on STARS.
- A handoff you sent blinks for 5 s once accepted, then stays white until you click it green, then
  partial. It blinks only for something *this scope saw happen*: a reconnect shows the settled picture.
  A same-Facility transfer (LC drags a Strip to AP) blinks at the sender too. `UN` blinks when a
  point-out you sent was rejected.
- **Settings → Map Overlays → "ATC Map Background"** off gives a strict black STARS scope, **only** when
  every radar you see is an ATC radar and there is no datalink.
- `M` means the flight is under tactical control after TOFI (§8C1). Letters for non-radar Positions:
  `OPS` `O`, `CD` `D`, `GC` `G`.

*What is ours, not doctrine* (see also §8F1): `SA` on a hostile declaration, the single `M` for every tactical Position,
the colours (the approved mockup's) and the coast timing.

### When the picture disagrees with the Strip (surveillance informs, you advance)

crc-sync watches the contact a Strip is correlated to and tells you when the Strip and the aircraft
disagree. **It never moves a Strip by itself**; the controller does (`adr/0076`).

- **"Detected airborne"** means a *correlated* contact that is an aircraft, at
  60 kt or more, at least 200 ft above the nearest airfield while within its 5 km footprint (speed alone
  beyond it), for 5 seconds. The numbers are in `config/efsp-surveillance-hints.json`, read once at
  startup, and `[SOURCE-DEFINED]`: this guide says "a configured threshold" only.
- **`AIRBORNE? ▸`** (amber chip) appears on a DEPARTURE Strip that is still in PUSHBACK, TAXI, RUNWAY_QUEUE
  or LUAW once its aircraft is detected airborne. **Click it to advance the Strip to Airborne**, the same
  `SetState` you would send yourself with every rule on it (so it is refused while the runway is suspended,
  as the Airborne step is). It is a click target only for a Position you are signed on to that owns the Strip; for
  anyone else it is information. It disappears by itself when the Strip leaves that state.
- **`STALE`** (quiet badge) appears when the contradiction has lasted 120 seconds after the chip would have
  shown: the Strip says one thing and the aircraft has been doing another. The hover says which. Update the
  Strip if it is wrong. The same badge covers any DEPARTURE, ARRIVAL, mission line or overflight whose state
  says airborne or on the ground and whose contact says the opposite (an ARRIVAL that says landed while the
  contact is still airborne, say); there is no chip for those, because surveillance does not decide a
  landing for you. **The carrier strip types expect nothing**: "airborne" is judged against an airfield's
  elevation and footprint, which means nothing for a moving deck.
  Each episode is logged once for the METRICS panel (§10).
- Neither indicator adds the Strip's attention styling or a reason line, and nothing in the sweep can move a
  Strip. Pressing Airborne yourself stamps the takeoff time (§4B).
- **A finished flight's aircraft is not claimed by the next flight's callsign.** A contact held by a flight that
  has since finished is not matched to another flight's callsign by itself; the assigned **code** still finds it
  (§8C), and an explicit **Bind** always works. (A DCS re-mint of a lingering aircraft under a new track id is a new
  contact and is not covered.)

### Declutter

Formation and navpoint declutter are off until the EFSP work is finished, and were switched off once on
existing installs:

- **Settings › RADAR › Sequential squawk declutter** (hides the labels of formation followers
  squawking sequential codes close to their lead).
- **Settings › RADAR › navpoint declutter** ("Hide numbered navpoints", "5-letter names only").
  The map shows every navpoint (`WP1`, `NAV003`, …) until it is reworked with AIRAC data.

You can turn either back on in Settings; it stays as you set it. What else the map draws is in the **Map** group at the
top of the same tab (§8O): **DCS drawings** (on), **DCS text marks** (off) and **Airport surface** (on).

## 8F1. What is ours and what is sourced

EFSP follows `EFSPImplementationGuide.md` and the FAA and ICAO texts it cites. Where the guide is silent, SOURCE
chose, and in code and config that choice is marked `[SOURCE-DEFINED]`. The screen carries no such marker, because
a label makes no claim, so this section lists the things you see without one, once. "SOURCE practice" in a
message means the same thing: it is how this squadron does it, not a published rule. Nothing below is wrong
for being ours; it is only not doctrine, and not to be quoted as doctrine.

| What you see | Ours or sourced | Where it is decided |
|---|---|---|
| **State names, who owns each state, the button labels** (`PENDING_CLEARANCE`, "Send to Clearance", "Hand Off to AP", the ARRIVAL, OVERFLIGHT and MISSION lifecycles) | Ours (guide §3.4, §3.5 are `[SOURCE-DEFINED]`; real TFDM publishes none of it). The OVERFLIGHT lifecycle is the guide's four-state one (`adr/0087`), itself `[SOURCE-DEFINED]` there | `adr/0012`, `0023`, `0087` |
| **Bay names and Bay sets**, the Rack per runway end, the Coordination Bays | The Incirlik Bay table is the guide's §4.2 default and is itself `[SOURCE-DEFINED]`; the `CENTER`, `TACTICAL` and `CARRIER` sets, JTAC's viewing Bay, the tower's `lc-pattern`, the SFA and PAR Bays and PriFly's recovered Bay are ours | `adr/0013`, `0025`, `0074`, `0117`, `0126`, `0137` |
| **Block Maps** for ARRIVAL, OVERFLIGHT and MISSION, all sub-lettered Blocks (`3A`-`3G`, `7A`, `9A-*`, `9F`, `9K`, `M1`-`M8`), the CID format, the equipment suffix (naive: sorted code letters, nothing fills it today) | Ours. The DEPARTURE Block Map is the FAA strip's (guide §6.2, Annex §2.1); the label hovers name the FAA block and mark ours *(ours)* | `adr/0008`, `0023`, `0026`, `0056` |
| **The wake table** (ICAO L/M/H/J by type) and the type names an ATO or DD-1801 is turned into | Sourced: six rows quoted from JO 7360.1K App. A, every other row read from ICAO Doc 8643. The name-to-designator map (`F-16C` → `F16`) is ours | `crc-sync/src/efsp/aircraft-data.js` |
| **Which Positions exist**, their letters on the scope | Incirlik's six (OPS, CD, GC, LC, AP, PAR), `CTR` and the tactical four are the guide's; the `CARRIER` Facility and the PAR Position are ours. There is no RSU (a real RSU is manned by pilots, not an ATC unit: the tower works the pattern) and no SFA Position (the single frequency approach is AP's and PAR's, JO 7610.14A ¶7-1-5). The Position letters are ours | `adr/0074`, `0088`, `0117`, `0126` |
| **Consolidation** (who is offered an unstaffed Position) | The guide's default (§4.8.6 rule 2) moves an unstaffed Position's Strips along a chain. We ship the FAA meaning instead (JO 7210.3 ¶2-2-3: one controller signed on and responsible for each open position, including consolidated ones): **no Strip moves at a sign-off at any ATC Facility**, and the next controller takes the hat, offered in an ordered list per Position (`adr/0110`, H111; the lists are in the Facility table and the facility files' `consolidation`). The order is the squadron's: AP last on every tower list, carrier Marshal first, then the approach lanes, then PriFly (H111). PAR → AP is the guide's default. Nothing crosses a Facility (`adr/0013`), so `OPS`, `AP`, `CTR` and `TAC_C2` have no list. `TACTICAL` keeps the guide's hand-back to `TAC_C2` as `handBack` (`adr/0080`); `JTAC → TAC_C2` is ours. Sign-off warns, it does not block (guide §4.8.6) | `facility-schema.js` notes |
| **Runway status**: which states count as using the runway (`RUNWAY_GATED_STATES`: a DEPARTURE in `RUNWAY_QUEUE`, `LUAW` or `DEPARTED`; an ARRIVAL in `FINAL`), the button labels (CLOSE, OPEN, WORKS, WRK DONE, INSP OK, ACCEPT, REJECT, REQ CLS, REQ WRKS, REQ OPEN, CHG RWY, SELF CHG, ACK, WITHDRAW, BEGIN), the "works in progress" and "runway change in progress" wordings, Tower as sole authority, the wind rule for the active end, the skipped acknowledger | Ours | `adr/0061`, `0068`, `0070` |
| **Incirlik's runway data**: runway 05/23 with true headings 52.7 and 232.7 (DCS's own `RW05`/`RW23` points; the PAR final course and thresholds are the same), the airport `LTAG` whose wind picks the active end, acknowledgers `OPS` and `AP`, `OPS` as inspection authority, the hot cargo and alert pad names and the alert access route, no arresting gear | Squadron data, **to verify**; the headings are DCS's runway, true, not magnetic | `adr/0061`, `0070` |
| **SFA, PAR and the pattern**: five UHF frequencies 232.1 to 236.1 MHz and which is initial contact, rotating or spare; Landed going straight to GC, a missed approach going back to AP, no clearance alerts once the final controller holds the flight, the glidepath alert's 2 s, the fixed ±3° azimuth window and the final-heading display; the PAR's coverage (20 NM, ±15°, −1° to +7°, from the AN/FPN-68A), its 500 ms sample, the 3-second no-plot age, the PAR panel's look, the azimuth window's ±15° cap and its 0.1° readout, the approach values' ranges; the tower's P/S and OPT cells, the IN PATTERN Bay, Closed traffic and Leave pattern as conversions | Ours; the frequencies are placeholders, editable in the FREQUENCIES panel (§8N). Sourced: at least five frequencies, three rotating between AP and PAR (JO 7610.14A ¶7-1-5), the pilot keeping the frequency (JO 7110.65BB ¶5-10-15), Begin descent ending the altitude (¶5-12-3); the elevation limit 0.5° below the glidepath (the lower safe limit of Order 8200.1D); the pattern's boundary (JO 7110.65BB ¶3-8-2) and the option (AIM 4-3-23; stop-and-go and missed approach are not offered). The PAR defaults (3.06° glideslope, ±1° azimuth, 1° above the glidepath, no tolerance below DA) are the squadron's. The approach values (TDZE, TCH, DH, glidepath angle) are the PAR controller's to set; the facility file's are defaults only | `adr/0075`, `0093`, `0112`, `0117`, `0123`, `0126`, `0130` |
| **Carrier figures**: default Case III, approach types and button range, Marshal stack limit, the angled deck, night as the sun 6 degrees below the horizon, the alternating CV_APP lanes; the 6-minute fix-to-ramp time under every EAT, the tanker's 6,000 ft and port pattern, Delta's 60-minute cap, the 6 nm approach turn when none is assigned, the carrier map's figures NATOPS leaves open and its spin rule (3.5 nm, 1,000 ft), DIST to the ship's centre | Ours, where the guide's §9.12 and CV NATOPS give none. Sourced from CV NATOPS: ramp time, EAT, the marshal fix (angels + 15, 21 DME), one minute between pushes, Delta, the pattern shapes. Not yet seen against a real DCS ship | `adr/0064`, `0074`, `0113`-`0116` |
| **Divert**: the action itself, which destinations make an ARRIVAL or an OVERFLIGHT, the guards, a blank field meaning "unchanged" | Ours. The form's fields and their order are FAA JO 7110.65 ¶4-2-1, ¶4-2-5, ¶4-5-7 | `adr/0111` |
| **Radar picture**: which scope sits at which console (`positionRadars`), the figures and kinds in `sensor-specs.json` (range, sweep, 2D or height-finding, SSR, Mode 4), which scheme draws which radar (ATC or TACTICAL), the datalink membership | Ours. DCS publishes none of it, and none of it describes a real system | `adr/0042`, `0043`, `0059`, `0066`, `0088` |
| **The synthetic code block `6000`-`6777`** that crc-sync gives AI aircraft | Ours; not a real code allocation | `adr/0059` |
| **Conformance, Conflict Alert and MCI thresholds** (`config/alerting.json`), the formation-member distances, the refuelling block's ±1,000 ft | Ours, not a published standard; the turn time's 3°/s and 25° of bank follow the AIM's holding turns (¶5-3-8), its 15 s margin is ours. The tactical Positions get no CA: a squadron decision. Sourced: CA between tracked targets and MCI against untracked ones reporting altitude (P/CG), MCI's 500 ft AGL / 5,000 ft MSL base (STARS / ERAM), the refuelling block's 3 NM | `adr/0058`, `0059`, `0118` |
| **Surveillance hints** (airborne at 60 kt, 200 ft, 5 s; `STALE` after 120 s) | Ours | `adr/0076` |
| **Flight following as one action**, the 8 s Show on map ring | Ours. The acts it bundles are the FAA's (track and tag ¶5-14-4 c, code ¶5-2-7 a, radar contact ¶5-3-7, termination ¶5-1-9 a) | no ADR |
| **The transition altitude**: Syria 10,000 ft, 18,000 ft elsewhere | A per-theater setting in `config/theaters.json`; the 18,000 ft is a placeholder | `adr/0085` |
| **Airspace**: working and range-control frequencies and approving a flight onto one, MOAs around Incirlik belonging to `CTR`, the shipped airspace list (the jurisdiction areas only); the airspace-conflict alert's containment rule, the `SAA` tag, an IFR flight alerting in a MOA; a mission drawing hidden under its airspace; the badge's amber rule; the card list; the transit request, who decides it, its marks, Transit complete by hand and the decider's acknowledgement, and the `COORD` mark; the Class E of the carrier area and CENTER, the control zone's Class D (the squadron's), the RAPCON's surface floor and the carrier area | Ours (squadron practice and the project owner's airspace picture). Sourced: "ATC approves activation" (guide §9.11); the controlling and using agencies (JO 7400.2R ¶21-1-10, ¶21-1-11); who may be in which airspace (14 CFR 73.13, 91.133, JO 7400.2R ¶25-1-6); activation deciding who owns the block (JO 7110.65BB ¶9-3-1 c, ¶9-3-4); the transit decided by whoever separates the users (JO 7610.14A ¶8-1-9 b.1, ¶3-3-4 a); the control zone and the RAPCON's lateral limits and the RAPCON being unclassified (AIP Türkiye); the area types (the FAA's special use airspace, 14 CFR 73, JO 7400.2R) and a prohibited area being continuous (¶22-1-4); the VFR services by class (JO 7110.65BB ¶7-9-4, ¶7-8-2, ¶7-6-1) | `adr/0036`, `0037`, `0119`, `0124`, `0125`, `0128`, `0134`, `0136`, `0143`, `0144` |
| **The VFR departure** in one step, its read-out line, DIR as Block `9K` | Ours; the phraseology is JO 7110.65BB ¶7-6-10, and a VFR plan never reaching ATC is the FAA's (Flight Service holds it) | `adr/0143` |
| **The data-block menu** (HDG, SPEED, ALT for the Strip's owner) | Ours | `adr/0140` |
| **Handoffs**: released by default, check-in by the receiver, the not-checked-in time (60 s) and the two amber obligations, control at the jurisdiction area's edge | Sourced: control at a coordinated point or after handoff and frequency change (JO 7110.65BB ¶2-1-15 a 1, a 2, c), communications before the boundary (¶2-1-17 a). The released default and the 60 s are ours | `adr/0122` |
| **Station frequencies at run time**: who may edit, the channel grid, an added SFA frequency being a spare | Ours | `adr/0131`, `0138` |
| **The ATO import**: the USMTF set layouts (from a community wiki), the vowel-cut rule, one ATO at a time | Ours | `adr/0071`, `0078` |
| **Metrics targets** and the 30 s time-to-find window: every target in the panel is ours (the header says so once); the Server section's thresholds | Ours | `adr/0072`, `0141` |
| **Instrumentation and archiving** (the 12 h retention of finished flights) | Ours. The instrumentation thresholds are tunable in config; the 12 h retention is a constant (`ARCHIVE_AFTER_MS`), not a setting | `adr/0065`, `0082`, `0107` |

**What is sourced, with its clause:** the cross-Facility primitives (HANDOFF, POINT_OUT, TRAFFIC, OPERATIONAL_REQUEST,
AIT; guide §4.6), the forwarding-obligation timers (§4.6.1, §4.6.2), MARSA (§9.2), amendments (§3.7), beacon codes
(§3.10), stereo routes (§9.10), activation of a MOA (§9.11), the DEPARTURE Strip (§6.2), the runway-status rules the
guide spells out (§9.7), alert and scramble (§9.6) and the carrier rules the guide gives (§9.12, §9.13).

Corrections to earlier ADRs (they are never edited) are collected in `adr/0077`.

## 8G. The runway — runway status (Incirlik)

> **Server and panel are both built** (L1, L1b). The RUNWAY STATUS panel is closed by default: open it
> from **PANELS → RUNWAY STATUS**. It has no controls of its own beyond the buttons below, and every
> rule in this section is enforced by the server, not by the panel.

### The RUNWAY STATUS panel

Each airfield with a runway inventory (today only Incirlik) shows:

- **The active end:** `▶ 05 ACTIVE`, and how it was set: from the mission wind at load, or by a runway
  change. `ACTIVE —` means nothing has set it yet (no mission wind yet).
- **Each runway** (`05/23`) with a badge: `OPEN`, `CLOSED`, `WORKS` (suspended for runway works) or
  `INSPECT` (works done, waiting for `OPS`'s inspection). Under the badge: who suspended or closed it,
  at which Position and when (Zulu), who asked; the last inspection; any request waiting on Tower; and
  the arresting gear. At Incirlik the gear reads "No arresting gear configured (SOURCE practice)",
  because DCS simulates no wires.
- **The runway change:** `05 → 23 · PROPOSED · proposed by LC (name) 1440Z`, then one chip per
  acknowledger: `OPS ✓ 1441Z` (`✓ self` when the same person acknowledged it), `AP …` (still
  waiting), or `AP skipped` (nobody was signed on to AP when it was proposed). A rejection or withdrawal says who
  and why. After completion it reads `PENDING INSPECTION: 05/23`. A rejected change stays on the panel
  until the next proposal replaces it.
- **The pads:** the hot cargo pad and the alert pad, by name, and whether they are occupied.

**Buttons appear only for what your Positions may do** (the panel works out what Tower or `OPS` would
accept):

| You are signed on to | Buttons |
|---|---|
| `LC` | `CLOSE` (asks for a reason), `OPEN`, `WORKS`, `ACCEPT` / `REJECT` a request, `CHG RWY` (pick the end), `WITHDRAW`, `BEGIN`, `COMPLETE` |
| `OPS`, `CD`, `GC`, `AP` | `REQ CLS`, `REQ OPEN`, `REQ WRKS` (not offered to a controller who is also signed on to `LC`) |
| `OPS` | `WRK DONE` (works complete), `INSP OK` (the inspection, the only way back to `OPEN`) |
| `OPS`, `AP` | `ACK` or `REJECT` a proposed change |
| `LC`, `OPS` and `AP` all | `SELF CHG` changes the runway in one input |

Close and every rejection ask for a reason in an inline row under the buttons (type it, **Enter** sends, **Escape** or Cancel abandons; what you typed survives the panel redrawing); optional notes are not asked for. When
a request is waiting on you as `LC` the tab reads `RUNWAY STATUS (1)`. A refused action shows in the
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

**Tower owns the runway.** Only `LC` closes it, reopens it, or takes it out for works. `OPS`, `CD`,
`GC` and `AP` **ask** Tower: request close, request open, or request works, with an optional
note. Tower accepts, which carries it out and records who asked, or rejects.

**Runway works and the inspection.** (Formerly "barrier change". It is generic runway works plus an
inspection, H52; the inhibit reads `works in progress`.)

1. `LC` suspends the runway, usually at `OPS`'s request. Both directions are suspended together.
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

1. `LC` proposes the new end.
2. `OPS` and `AP` each acknowledge, in any order. Either may reject, and `LC` may withdraw until
   it begins. Acknowledging is coordination, not permission.
3. `LC` can begin once both have acknowledged. An acknowledger nobody is signed on to is skipped and
   recorded, so an empty Position never deadlocks the change. A controller signed on to `LC`, `OPS` and
   `AP` alone does it in one action (a self-coordinated runway change).
4. When `LC` completes the change, the active end switches and the runway waits for `OPS`'s
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

*What is ours, not doctrine* (see also §8F1): Tower as sole authority over the runway, CLOSED holding traffic, the
request/accept flow, the wind rule and the skipped acknowledger are SOURCE's own choices.

## 8H. Alert and scramble (guide §9.6)

**Block `14E` (ALERT)** is on DEPARTURE Strips at `OPS`, `CD`, `GC` and `LC`. Pick `NONE`, `ALERT` or
`SCRAMBLE`. `OPS` owns it: it may set it at any state until the Strip is dropped, whoever holds the
Strip (H56); the other three set it only while they own the Strip. `ALERT` shows only in the field.

**`SCRAMBLE`** raises a red line at the top of the Strip panel, on every tab, for every controller:
`SCRAMBLE VIPER11 INCIRLIK · CLEARED · <access route> constrained · N flagged`. Click the callsign to
jump to the Strip. The scrambling Strip gets a red `SCRAMBLE` chip. At the same field, every departure
at PUSHBACK, TAXI, RUNWAY_QUEUE or LUAW, and every arrival at LANDED or TAXI_IN, gets an amber
`SCRAMBLE` chip and a reason line telling it to keep clear of the alert-pad access route. Two
scramblers at once show as two rows, each ground Strip is counted once in "N flagged", and a scrambler
is never flagged against the other. The RUNWAY STATUS panel names the access route as constrained too.

**Nothing is reordered, held or moved.** Sequencing is the controller's call; the chips are SOURCE
practice, not FAA doctrine. The indication ends by itself when the scrambler is DEPARTED or dropped.
To cancel on the ground, set `14E` back to `ALERT` or `NONE`: the field is never reset automatically.
The access route's name is a placeholder (`ALERT ACCESS TAXIWAY`) for the squadron to rename; the
"ground" set is Facility-wide because there is no taxi-route model.

## 8I. The ATO and the air-refuelling join (guide §9.8)

**Who imports.** `TAC_C2` (Primary at `TACTICAL`). The **Import ATO…** button in the Strip panel's
toolbar appears only while `TAC_C2` is signed on. Paste the USMTF text (atobrief's EXPORT dialog makes it),
or drop or choose a `.txt` file. Nothing is fetched from atobrief: it is paste or drop only (H65).

**The preview.** One row per mission line: mission number, callsign, package, vul window (Z), agency,
IFF Mode 1/2/3, missing fields and warnings, and an action per line: *Bind to <flight>* (showing why:
Mode 3 or callsign), *New flight*, *Update the tasked flight*, *Skip*. **Nothing happens until you press
Import N lines** (Enter previews/imports, Esc closes). Each line then reports its own result; one bad
line does not stop the others.

- **Binding.** A line binds to a flight already filed when its beacon code matches the ATO's Mode 3 *and* the
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
- **Carrier missions** (`adr/0109`). A line whose DEPLOC or ARRLOC names the carrier (`UNION`, `CVN-72`, `USS UNION`)
  is a carrier mission: it gets its MISSION line like any other, and the preview and the flight record the hull and
  whether it departs from and/or recovers on it. When `CV_MARSHAL` then creates the **launch** with that callsign, the
  launch is the same flight (same code, the line's plan, MARSA and military Blocks) and says "launches against its ATO
  mission". If two lines share the callsign, or the flight already has a Strip, it is a new flight. Import the ATO after
  the launch exists and the line binds to the launched flight by callsign, as for a land departure.
  In the preview a carrier line carries the hull tag (`UNION`) beside its cells; there is no tag on the Strip.

**The AR badge.** `AR SHELL71` on a receiver, `AR ×2` on the tanker. Select any of them and the others
are highlighted (per client). **It is not MARSA** and declares nothing, separates nothing and changes no
`separationRegime`. If the tanker's Strip is dropped, the receivers keep their records and their badge
loses that peer. A re-import with a changed tanker rewires the join.

*What is ours, not doctrine* (see also §8F1): the USMTF set layouts come from a community wiki
(`docs/parallel/research/usmtf-ato.md`), the vowel-cut rule and the one-ATO-at-a-time rule.

## 8J. Mission sessions, archiving and magnetic headings

### Mission sessions

crc-sync decides which mission it is in (`state/mission-session.json`). A **new session** starts on a DCS
`mission_start`, on a load of a different mission, or when the mission clock steps back by more than 5
minutes (the last two clear the Board at once, below). A reconnect, or a crc-sync restart onto the same mission, stays in the same session. The
session number is what the metrics (§10) and the traffic count are bucketed by, and what the wind-derived
active runway and the archiving of finished flights (§8J) key off.

### A new mission clears the Board

When crc-sync is sure DCS started a **new mission** (a DCS crash and restart, a different mission loaded, or the same
mission restarted), the Board is cleared for you, once, by the system: every live Strip on every Facility is dropped
(including a line under TOFI tactical control), runway works, suspensions and runway changes are over (every runway is
OPEN), the carrier goes back to a fresh recovery (Case, empty Marshal stack, default ship inputs), MARSA relations end,
and correlations are forgotten. ALERT and SCRAMBLE flags, coordination and TOFI
links go with their Strips. Your airspace definitions and bookings, the Facility configuration, Position staffing and the stereo
routes are **not** touched. The dropped Strips are filed like any drop (traffic count, Mutation log: one `MissionResetStrip`
line per Strip and one `MissionReset` line per Board with the counts, actor `system`). ATO MISSION lines on TACTICAL go too: import the ATO again.
There is no Undo for it. You are told: a notice "New mission — the Board was cleared (N Strips)" appears with the Undo messages (click to dismiss), an open popover on a cleared Strip closes, and a pending edit of yours on one fails with "no longer on the Board".

What does **not** clear it: a crc-sync restart, a lost and regained link to DCS, or a `mission_start` on the **same** mission
while the mission clock simply carries on. A `mission_start` for the same mission clears only once the mission clock is then seen
more than a minute behind where it was (a real restart puts it back at the mission start), within ten minutes. If DCS crashed
and came back with the same mission and a clock that did not go back, nothing is cleared: drop the old Strips by hand.

### The topbar clock: PAUSED and WALL (`adr/0129`)

The topbar clock is the mission clock, in-game Zulu. A grey flag beside it says when it is not reading a fresh DCS time:

- **`PAUSED`**: the DCS mission is paused (hover: "DCS mission is paused — mission time is held"). Mission time is held,
  and no EFSP time (a void time, a release time, an EAT, a timed obligation) moves until the game is unpaused. It
  appears within about 15 seconds of the pause; on unpause the clock steps back by at most 12 seconds.
- **`WALL`**: DCS is really gone (no link for 30 seconds), or it shows for a second or two right after a reconnect or a
  mission restart. Times then run on the server's own clock.
- **`?`**: mission time on a theater crc-sync has no UTC offset for (`config/theaters.json`), so it may be hours out.

A restarted mission starts its new session from the new mission's own time, not the old one's.

### Archiving finished flights

A dropped flight stays on the server for **12 hours** after its drop (sorties run 6-8 hours, and the returning flight must still find its flight data, ATO line and MARSA; `adr/0107`), or until the **next mission** (a new
mission session, above), whichever comes first. Then it is *archived*: gone from every screen, from the
server's memory and from the Board snapshot. Its history is the **Mutation log**
(`state/efsp-mutations*.jsonl`), which gets one `Archive` line per Strip and one `ArchiveFlightData` line per
flight record; there is **no lookup in the app** (H73). Consequences: an archived drop cannot be undone
(Undo answers "not found"), archiving never touches a live Strip (a new mission drops them first, see above), and
the traffic count is unaffected because every drop is counted before it can be archived. The sweep runs
once a minute; a Strip dropped by an unusual route (a `SetState` to `DROPPED`, a refused TOFI) may be
archived one sweep late, and a drop that was not counted at a mission change waits for the age sweep, so
it may stay up to 12 h.

### Headings are magnetic, and the transition altitude

Every heading and course you read or type is **magnetic**, from the World Magnetic Model (WMM2025) at
the aircraft's position and the mission's date. There is no manual "HDG correction" and the Airport
(APRT) panel's theater inputs are gone: it shows a read-only transition altitude and variation line. A
heading you type is converted by crc-sync; where the variation is unknown (no mission loaded) a bearing
shows `---` rather than a true value dressed up as magnetic. Mission dates outside 2025–2030 are
extrapolated and flagged. The topbar approach course and the APRT centreline are magnetic too.

**The DCS ruler reads differently, and that is DCS.** DCS's F10 map and Mission Editor ruler measure from **grid
north** of DCS's flat map, not true north. At Incirlik the runway 05 final lies on 052.7° true, which is **047**
magnetic on the mission's date; the DCS ruler reads about 049.6 for the same two points (grid 055.0 less DCS's own
variation). The aircraft's heading indicator is the reference a controller vectors by, so the scope stays on true
north and the World Magnetic Model. Incirlik's runway headings and PAR final course are DCS's own runway (052.7/232.7
true), so the PAR panel reads the final as 047.

The **transition altitude** is per theater (Syria 10,000 ft; every other theater 18,000 ft, a
`[SOURCE-DEFINED]` placeholder) and lives in crc-sync's `config/theaters.json`. Everything that shows or
writes an altitude uses it: block altitudes switch to flight levels at it (§4B), and the scope, the track
panel and the APRT card read it from crc-sync rather than a local default (the client shows 18,000 only
until the first theater message arrives). A squadron correction to
the variation goes in that file's `magneticVariation` (`fixedDeg` or `offsetDeg`) or in
`state/theaters.json`, and applies on restart. The airport weather popup, the APRT reference card and
the ATIS text give the wind **magnetic** (`NNN°M`; the reference card's tooltip shows the true value, and
the ATIS says "Wind not available." when the variation is unknown, H76).

## 8K. The carrier (`CARRIER` Facility, `adr/0074`, `0113`-`0116`, `0137`)

Sign on to `CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1` or `CV_APP2` under **Panels → Acting As** (group `CARRIER`). A carrier
Strip has one of three strip types: **MARSHAL** (launch, then the stack), **FINAL** (the groove: nothing to type)
and **PATTERN** (in the visual pattern, then recovered). **The Marshal creates the carrier's Strips**: in the New Strip
toolbar pick **Marshal · Recovery** (the flight joins the stack) or **Marshal · Launch**, and type the callsign. There is
no flight-plan lookup for a carrier Strip, and a recovery typed by callsign is a new flight (it is not joined to the
launch of the same callsign). PriFly and the approach lanes create nothing. When a carrier Position is left, its Strips stay with it and
the next controller on its list is **offered** the hat (§8M): `CV_APP1` → `CV_MARSHAL`, `CV_APP2`, `CV_PRIFLY`;
`CV_APP2` → `CV_MARSHAL`, `CV_APP1`, `CV_PRIFLY`; `CV_PRIFLY` → `CV_MARSHAL`, `CV_APP1`, `CV_APP2`; `CV_MARSHAL` →
`CV_APP1`, `CV_APP2`, `CV_PRIFLY`. The Marshal comes first (the human's order, H111). Whoever takes a Position holds it
as well as their own, so a Marshal who takes an approach lane can advance its Strips only as an approach Position would
(the Marshal owns LAUNCH and IN_STACK); take the hat only if you will work it. The carrier raises no combination warning:
there is no source in the repo for one. A hand-off into an empty carrier Position that somebody is offered is delivered
there and says so; one nobody is offered is refused.

Four panels belong to the carrier, each an ordinary dockable panel opened from **PANELS**: the Strip panel's carrier
Bays, **CARRIER** (the ship's state), **MARSHAL** (the recovery board) and **CARRIER MAP** (the picture around the
ship). There is **no PAR on the carrier** (`adr/0116`): the PAR panel is Incirlik's (§8L).

### The side number names the aircraft

In the carrier regime an aircraft is named by its **side number**. The Marshal types it in the Strip's **SIDE** Block
(`C18`); from then on it leads everywhere the carrier names that flight:

- **On a carrier Strip** (MARSHAL, FINAL, PATTERN owned by a carrier Position) the side number moves to the first, wide
  field and the callsign moves to SIDE's place. Until a side number is typed the callsign leads (a PATTERN Strip then shows
  no SIDE at all). Incirlik's FINAL and PATTERN Strips are unchanged.
- **On the MARSHAL board, the CARRIER MAP labels, the FINAL Bay line, the refusal banner and the "arrived from"
  line**. A flight with no side number yet is shown
  by its callsign; on the MARSHAL board that row is grey.
- The Bay search finds a Strip by its side number too.

### The banner and the CARRIER panel (`adr/0113`)

- **The banner** across the top of the Strip panel is read-only: the ship's speed and heading from DCS and the values in
  force from the CARRIER panel. A `T` or `G` suffix on a bearing means the variation or the convergence is missing, so it
  is not shown as magnetic; "hull not found" and "ship track lost" are shown as they are. It says when the Case is less
  restrictive than the weather you typed (or night) allows; it never blocks.
- **The CARRIER panel** shows the ship's state: BRC, final bearing, Case, ramp time, the marshal radial and first fix,
  the weather at the ship (ceiling, visibility, wind over deck, altimeter), and the recovery tanker (side number,
  altitude, give, pattern side, on station). Beside each value it says where it comes from: **DCS**, **default**,
  **set**, or **not known**. `CV_PRIFLY` and `CV_MARSHAL` type over a value (Enter sets it, Esc puts it back); **Use DCS**
  or **Use default** beside a value that was typed puts the automatic value back (**Clear** for a value with none), and an
  empty field and Enter does the same. Everyone else at the carrier sees the values and cannot change them. Every change
  is audited.
- **Bearings are typed magnetic.** If the ship cannot be found there is no magnetic variation to convert with, and a
  typed bearing is refused until it can.
- Ceiling and visibility have no DCS source: they read "not known" until somebody types them. The wind over deck is the
  DCS wind at the ship less the ship's own motion. The tanker's 6,000 ft and port pattern defaults are ours (CV NATOPS
  sets none), and the panel says so.
- **The Case** is set here by PriFly or the Marshal (III unless set), one setting for the whole ship; every carrier Strip's
  next step changes at once when it changes. It is never refused on the weather.

### Ramp time and EAT (CV NATOPS)

- The **ramp time** is the time the first aircraft of a Case III recovery is expected at the ramp (the Charlie time,
  CV NATOPS glossary). It has no default; type it as Zulu `HHMM`.
- An aircraft's **EAT** is when it leaves its marshal fix inbound (CV NATOPS 6.4.4). It is worked back from the ramp
  time: one minute apart per slot (6.4.5), less the time an aircraft takes from its fix to the ramp, **6 minutes**
  unless the squadron changes `fixToRampSec` (that figure is ours, worked out from the 6.4.7.2 profile). Changing the ramp
  time moves every holding EAT together; nobody changes slots. With no ramp time there is no EAT.
- **The EAT/PUSH Block on the Strip now reads this EAT, six minutes earlier than the old "Charlie + slot" figure for the
  same ramp time.** That is the NATOPS definition, not a fault.
- The marshal fix is on the marshal radial (final bearing + 180 by default) at the first fix, **21 DME** at angels 6, one
  mile and 1,000 ft higher per slot (CV NATOPS 6.4.1.1: angels + 15). The radial and the first fix are set in the
  CARRIER panel.

### The MARSHAL panel: the recovery board (`adr/0114`, `0115`)

- It lists every aircraft in the recovery in landing order, next to land at the top: sequence, side number, type, fuel
  (thousands of pounds) and EAT minute, angels, and status (**HOLD**, **COMM**, **APP A** or **B**, **BOLTER**, **BALL**,
  **PATTERN**). Its header shows the Case, the ramp time and the marshal position (`MARSHAL` radial and first fix),
  read-only: they are set in the CARRIER panel. Beside it is the Case III picture of the stack. Only the Marshal changes
  anything; the other carrier Positions read it.
- **Fuel and EAT by hand.** Click a holding flight's fuel to type its low state (`4.8` is 4,800 lb: a number under 100
  is thousands); it is the Strip's Low state Block. Click its EAT to assign one by hand (`HHMM`): it stays underlined
  until you clear it (an empty entry gives the slot's EAT back), and is marked until passed like any changed clearance.
  Delta moves it with the others; a new ramp time does not; Commence records it, Back to stack clears it. Two holding
  flights cannot share a minute (CV NATOPS 6.4.9), and there is no hand EAT in Case I.
- **Drag** a HOLD row onto another HOLD row to re-sequence. A recovery check-in joins at the next free slot. A flight that
  leaves the stack leaves a gap (a vacancy row); **Close up** on it compresses the stack.
- **Commence** is on the next flight to push. The flight keeps the EAT it was working to and the time it left: a later
  ramp time or Delta does not rewrite it.
- **Back to stack** (Case II and III) sends a commenced flight back into holding: it takes the next free slot at the top,
  with a new angels and EAT.
- **Delta…** (CV NATOPS 6.4.9: even minutes, never less than four) moves the EATs of the aircraft **holding**; commenced
  aircraft are not moved. It needs a ramp time and somebody holding; a new ramp time clears it. The 60-minute cap is ours.
- **Changed, not yet passed.** An angels or EAT that changed (a re-sequence, a Delta, a new ramp time, Back to stack)
  shows amber until you click the row to say you passed it to the pilot. The marks are the ship's, not your window's:
  every Marshal controller sees the same ones, they are still there after a reload or a crc-sync restart, and when you
  click the row it clears for everyone. If the clearance changed again just before your click, the click is refused:
  read the row again and pass the new value. A mark stays until passed, even if the value moves back. Commence clears it.
  Only the Marshal clears a mark; the other carrier Positions see it. **Settings → Marshal → "Mark changed clearances
  until passed"** hides the amber on your screen only (and then your click passes nothing).
- **Colours.** Grey unless something is wrong. Amber is fuel within the margin above bingo (Settings → Marshal,
  1.0 k lb by default), a flight past its EAT that has not pushed, and a changed clearance not yet passed; red is fuel at
  or below bingo. Fuel and bingo are the Strip's Low state and Bingo fuel Blocks.
- The side number (`C18`) and the approach turn (`C19`: 4, 6 or 8 nm; drawn at 6 when none is assigned, ours) are Strip
  Blocks the Marshal types; the FINAL Strip shows them read-only.

### The CARRIER MAP panel

- A radar picture fixed on the ship, **north up**, behaving like the radar map: the wheel zooms (2.5 to 65 nm), a double
  click zooms in, Shift and double click out; the ship stays in the middle and there is no pan. Range rings are dark
  green and the **10 nm ring** is always drawn; the ring spacing and the range are in **Settings → Carrier map**. There is
  no basemap.
- The extended centreline runs astern along the final bearing in force, with a tick every mile. In Case II and III the
  marshal radial and the fixes in use are drawn. Aircraft are labelled by side number and altitude in hundreds of feet;
  amber is fuel within the margin of bingo and red at or below it (Settings → Marshal). The recovery tanker is labelled
  `TKR`. The header carries the hull, Case, BRC, FB and range; it turns amber only for a lost ship track or a bearing it
  cannot draw.
- **The marshal stack is drawn as the holding pattern**: the left-hand racetrack of CV NATOPS 6.4.1.1 (its size,
  8 nm legs and 2.6 nm wide, is ours). While anyone holds, has commenced or is on the approach in Case II or III, the
  **path after marshal** is drawn too: the radial to the platform, the 10 and 6 nm fixes on the final bearing, and the
  ship.
- **A pattern is drawn only while a recovery needs it**, from the Strips: the bolter racetrack (turning in at each flight's
  approach turn) while a FINAL Strip is BOLTER/WAVEOFF; port holding while a flight holds in Case I or II (Case II with
  holding flights draws both the stack and port holding); the break and landing pattern with the initial while a flight
  holds in Case I or II or is in the pattern, or the spin circle when its contact is within 3.5 nm of the ship at
  1,000 ft or above (that rule is ours); the tanker's racetrack while the tanker is on station. The patterns carry no altitude or distance labels.
  Their shapes follow CV NATOPS 6.2, 6.4.8 and 6.10.3; the figures NATOPS leaves open (the bolter's 2 nm abeam, the break
  point, the 180, the tanker's 4 nm abeam) are ours.

### Launch, handoffs and the final

- **On the launch Strip** set EEAT (Zulu `HHMM`, Block `C15`), approach, button (a number 1 to 20, never a
  frequency), bingo and low state. They are on the flight, so they are on the recovery Strip too. The
  squawk the launch Strip held is re-claimed by the recovery Strip if you dropped the launch Strip in
  between.
- **The handoffs, one button each**, each recording its trigger type: **Commence** (Marshal to an approach
  lane), **Radar contact** (lane, MARSHAL becomes FINAL), **Ball** (FINAL to BALL), **Trapped** (the lane, at BALL:
  the Strip goes to PriFly's RECOVERED Bay, `cv-prifly-recovered`, and leaves the MARSHAL board) and **See you** (Case II
  only: the pilot has the ship, to PriFly as PATTERN). Case I has its own **To pattern**; a Case I **Recovered** also
  puts the Strip in PriFly's RECOVERED Bay. PriFly's next step there is **Drop**. **Dragging a Strip
  into a lane Bay does not do it; the button does** (the drag is refused with the button's name). The one
  allowed drag is a **bolter**: drag it to the Bolter Bay and the next step brings it back on final.
- **The carrier final.** The approach controller works the final from the **FINAL Bay's flight line** and the
  **CARRIER MAP**. The line names each aircraft on the final by its side number and carries **Ball** and **Waveoff**;
  it has no range and no link to a PAR panel.
- **DIST** (Block `C17`) on a carrier Strip is the range from the ship to the aircraft, the same figure for every
  carrier Position (PriFly, the Marshal, the approach lanes), updated about once a second as both move. With no radar
  contact it is blank. The MARSHAL board's DME is the same measurement.
- **FINAL has nothing to type** but its remarks (Block 9E). Its identity Blocks are derived, Block 5 is off its map,
  and the HDG and ALT an Incirlik PAR final carries are neither shown nor accepted on the carrier's.
- **PriFly's Bays** list the flights coming to the deck (`cv-prifly-pattern`, one Rack: there are no pattern legs any
  more) and those recovered (`cv-prifly-recovered`).
- A launch, a trap and a recovered pattern flight each count once in the traffic count (§10). The ship is the CARRIER
  Facility's home field (`UNION` in `config/efsp-instrumentation.json`): a launch whose ATO line (or plan) recovers on the
  ship is **local**, one that recovers at Incirlik is **transient**, and one with no plan or ATO line is **unknown**
  (`adr/0109`). The ATO line carries the carrier mission's hull (§8I).
- **Not walked against a real DCS ship**: the banner reads "hull not found" until a hull track exists, so no panel has
  shown live contacts around a real ship; the deck-state board (`cv-prifly-deck`) is inert; two hulls were not tried.

## 8L. Incirlik: the tower's pattern, the single frequency approach and PAR (`adr/0117`, `0123`, `0126`, `0130`)

- **Six Positions** at `INCIRLIK`: `OPS`, `CD`, `GC`, `LC`, `AP`, `PAR`. There is no RSU (a real RSU is manned by
  pilots, not an ATC unit) and no `SFA` Position.

### The tower's pattern (`adr/0126`)

`LC` works pattern traffic on its ordinary Strips. Two cells sit on `LC`'s arrivals (on its departures they are in the
expanded `▼` view) and on `AP`'s arrivals, so `AP` can note what the pilot wants before handing over: **P/S** (`PAT` = enter the pattern, `STR` =
straight-in) and **OPT** (`T&G` = touch-and-go, `FS` = full stop, `LA` = low approach). Click a cell to step through its
values (and back to empty); whoever holds the Strip sets them. They are on the flight, so every Strip of it shows them.

The next-step button follows them: an arrival with `PAT` goes **In pattern** into the `lc-pattern` Bay (its tab says
`ARR · IN PATTERN`, grey); from there **On Final**; on final a `T&G` or `LA` brings it back with **Closed traffic**, a
full stop (or an empty OPT) is **Landed** and then **Taxi In** to `GC` as always. If the pilot changes his mind, change
the cell, or drag the Strip to the other Bay.

- **A local departure that wants closed traffic:** on its airborne Strip, `⋯` → **Closed traffic**. It becomes an
  arrival in the pattern, same Strip and code; it never goes to `AP`.
- **An aircraft departing the pattern:** `⋯` → **Leave pattern** (from the pattern or from final; it becomes a departure
  again) and then **Hand Off to AP**, or **Drop** a VFR flight that leaves; the pilot calls Approach like any VFR
  aircraft.
- There is no stop-and-go and no missed-approach value in OPT, no circuit count and no time in the pattern.

The boundary is JO 7110.65BB ¶3-8-2; the option is AIM 4-3-23. Only `LC` has Closed traffic and Leave pattern.

### The single frequency approach (`adr/0117`)

- The single frequency approach is worked by `AP` and `PAR` (JO 7610.14A ¶7-1-5). `AP` files the arrival on one
  of the frequency Racks of its **SFA** Bay (`ap-sfa`), which gives the flight that frequency. Of the five frequencies,
  three rotate between `AP` and `PAR`; the first is `AP`'s initial-contact frequency and the last a spare. The grey header
  over the Racks shows each frequency with who has it now on the three that rotate (`PAR` while it works a flight on it,
  otherwise `AP`) and `INIT` or `SPARE` on the others; nobody sets it. To hand the aircraft to the final controller press
  **Hand off to PAR** beside the Strip's next step (offered on an arrival on a rotating frequency), or drag it onto
  `PAR`: any arrival can be handed to PAR that way. The Strip becomes PAR's FINAL Strip, on final. The pilot does not
  change frequency (JO 7110.65BB ¶5-10-15), and the frequency is never touched. PAR holds **one aircraft on final at a
  time** (`par-final`); a second handoff is refused naming the one on it. A handoff to an unstaffed PAR is delivered and
  `AP` is offered PAR's hat (§8M).
- **A flight follows its frequency.** An airspace approval, a cleared entry or a typed `FREQ` (Block 22) that changes
  the frequency of a Strip on the SFA Bay moves it to that frequency's Rack, or to `ap-inbound` when the pool has none.
- The frequencies themselves are set in the FREQUENCIES panel (§8N), where `AP` can also add a spare. An SFA frequency
  with a flight on it cannot be changed or removed.

### The PAR final (`adr/0117`)

- **PAR** (precision approach radar) is an airfield feature, Incirlik's only. The **FINAL Bay** holds the ordinary FINAL
  Strip like any other Bay. Type the assigned heading and altitude in its **HDG** and **ALT** fields. Beside **Landed**
  (the next step, which sends the Strip to `GC` as an arrival at taxi-in) is your next call, **Begin descent** and then
  **Cleared to land**; each is recorded once and then stays in the Strip's `⋯` menu, greyed, as the record. The `⋯`
  menu's **Final** group also has **Missed approach** and **Show in PAR panel**, which draws the flight in the PAR panel
  and opens it.
  - **Begin descent** ends the assigned altitude (¶5-12-3). From the handoff to PAR nothing of the clearance alerts;
    after Begin descent the only alert is the glidepath (`GP ↓`/`GP ↑` on the Strip, `BELOW GLIDEPATH` or
    `ABOVE GLIDEPATH` in red on the panel's EL row): outside +1°/−0.5° of the glidepath for 2 s, above DA. These limits
    are the same for everyone (`alerting.json` `glidepathAboveDeg`, `glidepathBelowDeg`, `glidepathPersistSec`); your
    own tolerance settings move only the panel's lines and its red.
    **Cleared to land** records that you relayed the tower's clearance.
  - **Landed** hands the Strip to `GC` (Taxi In, `gc-taxi-in`) and frees the final for the next aircraft. With `GC`
    unstaffed it is delivered if somebody is offered `GC`'s hat, else refused.
  - **Missed approach** hands the aircraft back to `AP` for another approach (ours: the orders do not say who works the
    climb-out). Give the climb-out heading and altitude in HDG and ALT first (¶5-10-12); they stay assigned and are
    conformance-checked. The Strip goes to `AP`'s SFA Bay, on its frequency's Rack (else `ap-inbound`), and your final and
    that frequency are free. Begin descent and Cleared to land start fresh on the next approach (the earlier calls stay
    in the Mutation log). `AP` presses **Hand off to PAR** again when it is sequenced. Refused when nobody can take `AP`.
  - To keep the aircraft yourself after a missed approach, drag it to the missed-approach Bay (`par-missed`); its next
    step there is **Back to AP**.
  - Every call is the final controller's alone; `AP` cannot press them.

### The PAR panel (`adr/0112`, `0123`, `0130`)

- **The PAR is your Position's own sensor.** While you are signed on to `PAR` and an aircraft is on your final, crc-sync
  measures it twice a second: range from the runway threshold along the final approach course, its height above the
  touchdown zone to the foot, how far above or below the glidepath and left or right of the course it is (left and right
  as the pilot sees them), its ground speed and vertical speed. Nobody else is sent these numbers. If you sign off, the
  next controller to sign on to your Position sees the same approach, with its trail; if you also hold `AP`, signing off
  `PAR` alone keeps the picture, because `AP` takes PAR's hat (§8M).
- **The PAR panel** (PANELS → PAR, a tab in the left panel group until you move it) shows the approach (runway, final
  approach course and the approach values, below), the aircraft (callsign, type, beacon, ground speed, vertical speed,
  range to touchdown), and two scopes: elevation and azimuth against range from touchdown. Touchdown is always in the
  bottom-left corner. The wheel zooms the range of both scopes; Shift+wheel zooms the height (elevation) or the angle
  (azimuth) of the scope under the pointer. There is no panning. With **Autoscale** on (Settings → PAR) the range and the
  height follow the aircraft until the window is 10 NM wide; any zoom pauses it, a double-click resumes it. The azimuth
  window is not autoscaled: it is fixed at **±3°** of the course, Shift+wheel on the azimuth scope zooms it (without
  pausing the autoscale) and a double-click puts it back to ±3°. With no aircraft on your final it reads "No aircraft on
  your final."
- **The final heading.** On the deviation row, `FIN HDG 049  HDG 054`: **FIN HDG** is the heading that holds the final
  approach course in the field's wind at the aircraft's speed, **HDG** the heading the aircraft is flying, both magnetic.
  At the top middle of the azimuth scope a small heading scale (±10°) marks the final heading in grey and the
  aircraft's heading in magenta (hollow at the edge when it is off the scale). With no field wind there is no final
  heading (`—`), never the bare course; an aircraft that reports no heading shows none.
- **The azimuth scope is in degrees**: the course is the 0° line, left of course is below it, and the dashed tolerance
  lines are straight. Its readout is the angle off the course, e.g. `AZ 0.4° L` (`0.0°` on the course). The window is at
  most ±15° (the PAR's coverage). A plot beyond the edge of the window is drawn on the edge.
- **Colours.** The panel is grey while the approach is normal; the aircraft is the magenta diamond with its trail. Red
  means outside your tolerance above DA: by default more than **1° above** or **0.5° below** the glidepath (the FAA
  lower safe limit, Order 8200.1D) or more than 1° either side of the course; each is a setting in Settings → PAR
  (**Elevation tolerance above**, **Elevation tolerance below**, **Azimuth tolerance ±**, and **Autoscale**: four in all).
  Below DA nothing is coloured and the dashed tolerance lines stop at DA. Amber `NO PLOT` means no new radar plot for 3
  seconds (DCS has not moved the aircraft, or it is outside the PAR's coverage: 20 NM, 15° either side, up to 7° up). An
  orange-red scope with `NO ELEVATION DATA` or `NO AZIMUTH DATA` has failed; the reason is under it.
- **Approach values.** The panel's header shows the approach you are working: **TDZE**, **TCH**, **DH** and **GPA**
  (glidepath angle), then **DA** (TDZE + DH). They start as the field's defaults. To change one, click it, type the value
  and press Enter; an empty field or **Default** puts the default back, Escape leaves it as it was. The value is held by
  crc-sync for that runway end, so every PAR scope and the PAR sample use the same numbers, and it stays until someone
  changes it (a new mission keeps it). A value you set is underlined with a small mark; its tooltip shows the default.
  Ranges: TDZE −1,500 to 15,000 ft, TCH 0 to 200 ft, DH 100 to 1,000 ft, GPA 2.5° to 3.5° (ours). Only the PAR Position
  sets them (`AP` holding PAR's hat, too). The 0.5° lower safe limit follows the angle you set; the obstacle clearance it
  stands for was surveyed for the published angle. A changed value is measured on the next DCS fix, within about a second.
- **With an empty final** the header still shows the approach the next aircraft will fly (the active runway's), under
  *No aircraft on your final.*; you set TDZE, TCH, DH and the angle there exactly as with a flight. With no active runway
  there is no approach to show. Working more than one airfield's final, pick the approach from the row above the header
  (`RWY 05 · LTAG`). The first aircraft brings the whole panel back with the same header.
- With more than one aircraft on your finals their names appear above the header; click one to watch it, and your
  choice stays until it leaves the final. **Begin descent**, **Cleared to land**, **Landed** and **Missed approach** are
  in the panel too, the same calls as on the FINAL Strip. PAR's FINAL Strip shows the PAR's range to the threshold in DIST.
- **A vacated Position's Strips stay with it** (`adr/0110`). `PAR` offers the hat to `AP`: the next controller takes it
  (§8M) or the Strips wait. A PAR vacated with an aircraft on final leaves the Strip with `PAR` until `AP` takes the hat.
- **Placeholders.** The facility file's approach figures (`config/efsp-facility-incirlik.json`, `parApproaches`:
  threshold, TDZE, TCH, DH, glidepath angle) are defaults only, for the PAR controller to change at run time; the five
  SFA frequencies (232.1 to 236.1 MHz) and the PAR coverage figures are ours. The PAR has never seen a live DCS track.

## 8M. Taking a hat: consolidation at every Facility (`adr/0105`, `adr/0110`)

When a Position is left, **nothing moves**: its Strips stay its own. Consolidation means a controller takes on the
Position's job (the FAA's meaning, JO 7210.3 ¶2-2-3), so the next controller on its list is **offered** the hat. Taking
it is a *combination*: one person signed on to two Positions, two groups of Bays, and each Strip is still worked by the
rules of the Position that owns it. The lists per Facility are in the table at the top and in §8K; the order is the
squadron's (H111). `TACTICAL` alone still hands lines back to `TAC_C2` (§8C1).

- **The offer.** It stands while the Position is unstaffed and owns at least one live Strip, and it is shown to the
  **Primary** of the first staffed Position on its list (never to an Observer): "CD is unstaffed with 3 Strips (callsigns).
  Take CD as well?" with **Take CD** and **Not now**. Taking it is an ordinary sign-on to the Position (use the Position
  selector, or the button): you now hold both and its Strips are yours to advance. The row stays in the panel above
  the Position tabs until the Position is staffed or owns no live Strip, so a controller who **signs on later**, a
  **reconnect** and a reload all show it again. **Not now** hides the row on your screen until the Strip count (or the
  count on the runway) grows. The Position you left yourself is not offered back to you until its count grows either.
- **An Observer.** A Position you observe that has no Primary and still owns Strips asks you "LC has no Primary and 2
  Strips. Take LC?". Taking it re-declares your Positions and makes you Primary (guide §4.8.2 rule 2); the longest-waiting
  Observer is offered it first, and whoever declares first wins.
- **A hand-off into an empty Position.** If somebody is offered it, the Strip is **delivered there** (its own Bay) and the
  sender is told ("Q is unstaffed: offered to P"); the offer at P appears at once. A hand-off, a clearance-delivery send
  or `LC`'s arrival press into an empty `GC` is delivered the same way when `LC` or `AP` is staffed. If nobody is
  offered it, it is inhibited ("no receiving Position present") or refused (`NO_RECEIVING_POSITION`); a coordination
  HANDOFF proposed to an empty Position nobody is offered is refused too. (Whether `GC` is on a list is a configuration
  line; delete it and `GC` is refused as before.)
- **The sign-off warning.** "N Strip(s) stay with LC; AP is offered LC (nobody has taken it yet)", with "(K on the
  runway)" when an aircraft is in `LUAW` or `FINAL`; with nobody to offer it says "nobody is offered it". It never blocks.
- **The combination line.** While you hold `LC` with a non-local Position (`OPS`, `CD`, `GC`, `AP` or `PAR`), a grey
  line above the Position tabs lists only the frequencies to monitor, for example *Monitor TWR 251.0, GND 275.8*
  (¶3-3-3). Click it (or Enter/Space) to acknowledge; it stays away until the combination changes (a Position joins or
  leaves it, or LUAW starts or stops). The acknowledgement is your window's only and comes back after a reload. With a
  departure lined up (LUAW) while combined the line is coloured and says so: *LUAW in use while LC is combined. Monitor
  …* (¶2-6-5c, ¶10-3-8a4); putting a Strip into `LUAW` as `LC` while holding a non-local Position shows a refusal-style
  line too: *LUAW while LC is combined with a non-local Position*. `CD` with `GC` raises none (¶10-4-6). The offer to take a hat ends at "Take
  GC as well?". All of it **warns and never blocks**: the EFSP's departure lifecycle always passes through LUAW, so a
  block would end the one-controller tower. Background, not on screen: combining local and non-local positions is for
  significantly reduced traffic (JO 7210.3 ¶2-6-5b), tower and radar approach not normally outside the midwatch
  (¶2-6-12); the FAA's doctrine applied to a USAF field by analogy.
- **Frequencies.** Each Position can carry frequencies (§8N). They are shown in the Position selector and on the Position
  tab, and a controller holding two Positions has both. Incirlik ships `GC` GND 275.8 and `LC` TWR 251.0:
  **placeholders**, which a controller changes in the FREQUENCIES panel. Nothing tunes a radio from them yet.
- **Metrics.** The transfers row counts `to an unstaffed Position` (a delivery under `UNSTAFFED_RECEIVER`, and a
  `TACTICAL` hand-back) where it used to count `routed to a consolidated Position`.
- Sign-on and sign-off are not undoable one-click moves (`adr/0100`).

## 8N. Frequencies: the FREQUENCIES panel (`adr/0131`, `0138`)

Open **FREQUENCIES** from the PANELS list. It lists each Facility's station frequencies: each Position's (GND, TWR, …)
and the SFA pool. The facility files hold the defaults; what controllers set is kept by crc-sync across restarts and
new missions.

- **You set your own Facility's frequencies**: each Facility's rows are editable from one of its Positions you are
  Primary at; another Facility's rows only read. Signed on to no Position, the panel says "Sign on to a Position to set
  frequencies."
- **Change one:** click the value, type the new one, Enter. A value you or another controller set shows a grey **SET**
  with the default and who set it when; **RESET** puts the default back. Everyone sees a change at once; the last write
  wins.
- **Add one:** **ADD** beside the Facility's name: pick the Position (or SFA), type a label (up to 12 characters) and the
  frequency, Enter. An added frequency is marked SET with `added`, and **REMOVE** takes it away. A frequency from the
  facility file cannot be removed, only reset. An added SFA frequency is a spare and gets its own Rack in `AP`'s SFA Bay.
- **A frequency already given to a flight is not changed.** An SFA frequency with a flight on it can be neither changed
  nor removed: move or hand off the flight first. A Position's frequency changes no Strip.
- Values are MHz in the UHF and VHF bands (30–400 MHz, UHF 225–399.975), on a 25 kHz channel or an 8.33 kHz channel name
  between 118 and 137 MHz (the grid is ours). SFA frequencies must differ within the pool.
- The airspace frequencies are edited in the airspace editor (§8A), not here. Your SRS radio's own frequencies are in
  crc-desktop's `config.json` and the radio panel; nothing here tunes a radio.

## 8O. The map: basemap, labels, terrain and the airport surface

- **The basemap** is MapTiler's, with the key crc-sync gives the client after login. When MapTiler refuses (no key, a
  refused or exhausted key) or is down, the map switches by itself to a free basemap (**OpenFreeMap**, keyless) and a quiet
  grey **FALLBACK BASEMAP** note shows; it stays on the fallback for the session and goes back to MapTiler only when a
  new key arrives. If neither answers, the note reads **NO BASEMAP** and the map draws everything we own on a plain
  background. Nothing you need (tracks, data blocks, airspaces, Strips) depends on the basemap.
- **Labels** are drawn with fonts the app ships, so tracks and data blocks show with no MapTiler key at all.
- **Terrain and contours come from DCS itself**: a height grid of the whole map, built once per map on the server
  (`infra/RUNBOOK.md`). Radar masking (§8B), the elevation contours (Settings → GENERAL → Map Overlays) and the radar-debug
  line of sight all read it. Without a grid for the mission's map there are no contours and no masking.
- **Settings → RADAR → Map** (yours only): **DCS drawings** (on: the mission editor's shapes; off hides them all),
  **DCS text marks** (off) and **Airport surface** (on). The runway lines always show.
- **The airport surface** (aprons, taxiways, runway numbers and taxiway, apron and gate names, when zoomed in on a field,
  from zoom 12) shows while you are signed on (Primary or Observer) at a Position your Facility lists for it (Incirlik:
  `GC` and `LC`), together with any other Positions you hold, and on both backgrounds: on the black ATC scope it is
  drawn in the video map's dim grey, nothing brighter than the runways. Signed on only at `AP`, `CTR` or another radar
  Position, the scope shows the runways without the surface. The switch above turns it off for you. A facility file
  names its surface Positions in `airportSurfacePositions`. The surface is OpenStreetMap's field as it is today, which
  can differ from the DCS model.
- **The bullseye readout beside the cursor** (bearing and range from the bullseye) is blank while every radar
  you have is an ATC one, and whenever the pointer is off the map (also over a panel on the map).
- **The selected airport's range ring** (the APRT panel's airport) always draws, at the radar's range. The APRT
  panel's **extended centreline** follows the runway's true course where a Facility describes the field (Incirlik);
  elsewhere it is drawn from the runway number × 10 as magnetic, which is only approximate. It starts at the airfield's
  reference point, not the threshold.
- **Picking a DCS drawing** in the airspace editor: hover or arrow through the **Pick DCS drawing** list to see each
  drawing outlined on the map in turquoise (also when DCS drawings are switched off); the small **show** button on a row
  brings an off-screen drawing into view. Hovering never moves the map.
- **Every panel scrolls** when you make it smaller than its contents, except the two maps and the PAR panel's scopes;
  Settings scrolls under its tabs.

## 9. General controls — quick reference

- Set which Position(s) you're acting as under **Panels → Acting As** (grouped by Facility — `INCIRLIK`, `CENTER`, `TACTICAL`, `CARRIER` and, once any range is configured, `RANGES` are independent checkbox groups).
- Each signed-on Position gets its own tab; each Position's Bays (§3) are its own tabs underneath.
- **Drag** a Strip onto another Position's tab to transfer it (same-Facility only); onto a Bay tab within your own Position to move it there. The drop follows the dragged Strip, not the cursor: it lands in the slot nearest the ghost's top edge. A release with the ghost over its own slot is no move and sends nothing, so a click or double-click never moves a Strip. A Position or Bay tab takes a drop only after more than 16 px of travel.
- **The left edge of a Strip** (Highlight, an obligation due or overdue, MARSA armed or voided, contact lost, an alert) names itself and what to do in a hover tooltip: the colour drawn first, then "Also:" and any others underneath. Hover the edge itself.
- **Search**: `.find <text>` dot-command, or the search icon — matches callsign/beacon (and a carrier aircraft's side number), opens a temporary search-results Bay.
- **Dot-commands**: `.drop [reason]`, `.undo` (undoes the action in the Undo slot, no Strip needs selecting), `.find <text>`, `.bind <track id>`, `.unbind`, `.stereo <NAME> <CALLSIGN>`, `.ff <track number> <CALLSIGN> [TYPE] [@POSITION]` and `.term` (flight following, §8C2), `.vfr <CALLSIGN> <TYPE> <DIR> [runway]` (a VFR departure at `CD`, §3), and for MARSA (§8D) `.marsa <CALLSIGN> [DECLARER]`, `.rendezvous`, `.endmarsa`, `.voidmarsa` — all but `.find`, `.stereo`, `.ff`, `.vfr` and `.undo` apply to whichever Strip is currently selected.
- **Undo** (ADR 0100): every one-click move you made (NLA step, hand-off, Checked in, carrier handoff, Hand off to PAR, Landed, Missed approach, Closed traffic, Leave pattern, surveillance chip, TOFI Exit, Split/Join, Divert, Start flight following, Radar service terminated) can be undone for 10 seconds, by the Position that did it. The panel shows one slot, "Undo · Hand off VIPER1 → APP · 7 s"; click it, press Ctrl+Z with the panel in use, or type `.undo`. The newest undoable action replaces the slot. Changes other controllers in your Facility made to the same records in the meantime are voided (a voided clearance stays visible, marked VOIDED); the Position that made them gets a message in its panel ("LC undid Hand off VIPER1; your annotation was voided", click to dismiss; nothing is marked on the Strip). An Undo is refused if another Facility has since answered, or the Strip was dropped and archived; the slot line says why. Undoing a Split removes the part's Strip and its flight data on every client at once.
- **Settings** has one tab per panel: General, Colours, Radar (the Map group, declutter, navpoints, track visibility,
  Conflict Alert, extended centreline, debug), SRS and Tools, and one for each panel that has settings of its own:
  **PAR** (§8L), **Marshal** and **Carrier map** (§8K). The values are yours and are kept on this computer; nobody else
  sees them.
- **Panels** (PANELS list): the Strip panel, AIRSPACE, RUNWAY STATUS, FREQUENCIES, METRICS, PAR, the carrier's CARRIER,
  MARSHAL and CARRIER MAP, and the rest; every docked panel scrolls when it is smaller than its contents (§8O).

## 10. Metrics and the traffic count

crc-sync counts what the Board does, and crc-desktop measures what a controller does with it (searches,
time to find a Strip, inputs per gesture). The METRICS panel shows both, and what the server costs; behind it are three read endpoints
on crc-sync, open to any signed-in user. Nothing in either names a controller.

### The METRICS panel

Open it from **PANELS → METRICS** (it docks in the left cluster, closed by default). Anyone signed in can
open it, with or without a Position. It refreshes on open and every 30 s while it is on screen, and does
nothing while hidden.

- **Two columns.** *This mission* is everything since the current DCS mission loaded; *Last hour* is a
  rolling 60 minutes. A mission shorter than an hour shows one column (its last hour is the whole mission), and the
  per-Position tables drop their *Last hour* column too. The selector reads back an earlier mission (which has no last
  hour).
- **The verdicts.** `MET` / `NOT MET` compare the number with the guide's §11.5 target (only `NOT MET`
  is coloured). Every target is ours, from the implementation guide, not an FAA figure: the header says "Metric ·
  target (ours)". `TRENDING ↓/→/↑` compares the last three complete hours, for the three metrics whose
  target is "trending down"; it reads `NO TREND YET` until there are two complete hours, a flat series
  reads `→`, and no trend is ever coloured, `↑` included. `NO DATA` means measured, but nothing happened
  in this window. `NOT INSTRUMENTED` means nothing measures it yet, which is **not** zero: staleness
  was `not instrumented (L19)` until the staleness detector existed; it now reads `COLLECTING` from startup
  and `NO_DATA` until the first `STALE` episode (§8F).
- **Search is a failure symptom (§4.3).** Every search is counted, never what was searched for. A search
  count that is not trending down means controllers cannot find Strips where they expect them.
- **Time to find** runs from a Bay coming on screen to the first Strip you select in it, counted only when
  that selection comes **within 30 seconds** (ours: later than that you came back to work a Strip, not to find
  one). The clock ignores a Bay you leave without selecting, a Bay you hide, and a click on the arrivals line.
- **Inputs per gesture** is a declared cost per way of making a gesture: double-click flip 1, Shift+click
  attention 1, Alt+click offset **1**, Ctrl/Cmd+click highlight **1**, right-click + swatch highlight **2**,
  `⋯` → Offset **2**. The last two are over the ceiling of one input; whether the one-input forms settle
  that is still open (see the briefing).
- **Per Position** is folded behind a toggle and lists search and time-to-find by Position (H66). There
  is never a row per person.
- **Traffic count.** Pick a Facility (it starts on the first Facility where you are signed on to a Position, else
  `INCIRLIK`). The first line is a partition: every counted flight is local, transient or unknown.
  Formation, SUA traversal and alert scramble are "of which" counts and can overlap. "Reconciles with the
  Mutation log" means the count agrees with a recount from the audit log; a mismatch is coloured. The
  request is scoped to the selected mission.
- Search per staffed hour reads `—` until crc-sync's 60 s manning tick has recorded staffed minutes.
- **Server (crc-sync) · last 60 s**, at the bottom: what the server process costs over the last minute: CPU (one core
  = 100 %), memory, event-loop delay, what it carries (sessions, tracks) and the busiest ticker (or the ones over their
  limit), with every ticker in a folded table. Grey is normal; an amber row is past its threshold in crc-sync's
  `config/server-resources.json` (CPU 80 %, event-loop p99 100 ms, memory 1,024 MB, one ticker run 100 ms). At squadron
  load (20 aircraft, a dozen controllers) crc-sync uses a few percent of one core and about 110 MB.

### The endpoints

- **`GET /api/efsp/metrics`** — the metric set, per mission session (one DCS mission load to the
  next), with a rolling last hour beside it. `?hours=1..720` narrows it to the last N hours of the
  session, and `?missionSession=N` picks an earlier session (404 if there is none).
- **`GET /api/server/resources`** — the Server section's numbers (signed in), for a look from outside the client.
- **`GET /api/efsp/traffic-count`** — flights counted from dropped Strips. Optional `facilityId`,
  `from` and `to` (mission-time epoch ms, `to` exclusive; the default is the last 24 h of mission
  time), `missionSession`, and `detail=1` for the records.

**Reading the count.** One operation per dropped Strip per Facility; a formation is one operation,
with its aircraft counted beside it. Local + transient + unknown = flights. Formation, SUA and
scramble are overlapping subsets, not further partitions. `excludedByReason` explains the drops that
are not traffic. `CENTER` and `TACTICAL` show locality `UNKNOWN` by design, because they have no
home airport. Obligation figures are counts, not rates: only `ADVANCE_FORWARDING` and
`VOID_TIME_EXPIRED` can ever be "met".

**Retries and reconnects.** If crc-sync cannot be reached when you press a button, the red banner says so ("Not connected to crc-sync — nothing was sent"); if the link drops before the answer, it says "The connection to crc-sync dropped before it answered — check whether that went through", and a form or the Undo slot that was waiting stops waiting. A **Create Strip** you sent just before a drop is sent again by itself after the reconnect with the same id, so a lost answer neither doubles nor loses the Strip. A Send from a popover (coordination, TOFI, split, join, release, MARSA) closes the popover when it is accepted; when it is refused the popover **stays open with what you typed** and the red banner says why. A retried Mutation is answered with its original outcome and the record as it
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

- `facilityId` and the flight data are on every entry. `facilityId: null` means theater-wide (correlation and
  MARSA; a MARSA entry names its `flightDataIds`). An airspace entry names the controlling Facility.
- `SetBlock` names the `blockId` and the `value` written. Coordination and TOFI entries name their
  `action` (`CANCEL`, ...). Airspace, correlation and MARSA entries carry the `clientMutationId`.
- `source:'peer'` is a change to a replica on this Facility's Board caused by the other Facility's
  Mutation: `causedBy` names it and `clientMutationId` is null. There are seven `Peer*` ops, plus
  `InterfacilityCoordinationCancel`.
- `SystemReassign` has reason `position-vacated` (a `TACTICAL` Position left, its lines moved to `TAC_C2`; also drains Strips an older Board persisted as moved) or
  `position-retaken` (they moved back; not counted in the `systemReassigned` metric).
  `SystemCoordinationEnd` ends a link whose replica was retired.
- `Archive` / `ArchiveFlightData` (§8J) are the end of a finished flight; `NotPersisted` (written at boot)
  voids the earlier line with the same `clientMutationId`, which never took effect because crc-sync died
  before saving it.
- A scramble called off while still on the ground is not counted as an alert scramble in the traffic
  count; one called off after departure is.
- A retry answered from the replay cache writes no second entry. Retention (30 days by
default) and the home airports that decide local vs transient are in
`crc-sync/config/efsp-instrumentation.json`, or a copy in `state/`; restart crc-sync to apply a
change.
