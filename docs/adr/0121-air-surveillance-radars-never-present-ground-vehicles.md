# 0121: Air-surveillance radars never present ground vehicles

**Status.** Accepted (lane U-DECLUTTER, 2026-10-16). Rulings: decisions.md **H134** LT-Q1 **c** (ground vehicles stay
until the declutter work, with the named item *air-surveillance radars never present ground vehicles*) and LT-RQ11
**a** (never presented; no speed gate), **H6** (every declutter behaviour waits for the end of the EFSP work: that is
now), **H128** (FAA model, always). Live-test finding **T4** (`docs/parallel/live-test-2026-10-11.md`).

**Amends** ADR 0066's "Nothing is hidden on the ground any more" for ground **vehicles** only (ADR 0066 is not edited).
Aircraft on the ground are unchanged: presented like any other contact, as 0066 and H6 decided.

## Context

Live test T4: friendly ground units showed on the tower's scope as primary-only bogeys. That was deliberate under
ADR 0066 (its contact table: *any ground vehicle — no transponder, no Mode 4, no datalink*) and H6. 0066 listed the
realistic refinements as later work: MTI/ground clutter and a surface range gate. In our model only the airport radar
(`apt:*`, `seesGround: true`) ever returned a vehicle.

What the sources say (quoted in `docs/parallel/research/live-test-faa.md` Q10, read for LT-RESEARCH on 2026-10-12; not
re-read for this ADR):

- **P/CG, AIRPORT SURVEILLANCE RADAR:** *"Approach control radar used to detect and display an aircraft's position in
  the terminal area."* **AIR ROUTE SURVEILLANCE RADAR:** *"ARTCC radar used primarily to detect and display an
  aircraft's position while en route between terminal areas."*
- **P/CG, MOVING TARGET INDICATOR:** *"An electronic device which will permit radar scope presentation only from
  targets which are in motion. A partial remedy for ground clutter."* **GROUND CLUTTER:** *"A pattern produced on the
  radar scope by ground returns … The effect of ground clutter is minimized by the use of moving target indicator (MTI)
  circuits in the radar equipment resulting in a radar presentation which displays only targets which are in
  motion."*
- **AIM ¶4-5-1 b.1(b):** *"… using beacon radar and electronically eliminating stationary and slow moving targets by a
  method called moving target indicator (MTI) usually negate the problem."*
- **P/CG, AIRPORT SURFACE DETECTION EQUIPMENT (ASDE):** *"Surveillance equipment specifically designed to detect
  aircraft, vehicular traffic, and other objects, on the surface of an airport, and to present the image on a tower
  display."* **JO 7110.65BB ¶3-6-1 b:** *"Use ASDE systems to augment visual observation of aircraft landing or
  departing, and aircraft or vehicular movements on runways and taxiways …"*
- **USAF E-3 fact sheet** (GCI/AWACS; the FAA orders are silent): *"The radar combined with an identification friend or
  foe subsystem can look down to detect …"* low-flying aircraft *"… by eliminating ground clutter returns that confuse
  other radar systems."*

So the radars that show vehicles are surface-movement radars (ASDE), on the tower display; every radar crc-sync models
(airport, approach, carrier approach, AWACS, fighter, ship search) is an air-surveillance radar.

## Decision

1. **No radar we model presents a ground vehicle** (DCS unit category 3), at any range, in any scheme, to any
   Position. The rule lives at the single choke point: `surveillance/presentation.js` `presentTrack()` returns `null`
   for one (`presentable()`), whatever saw it or answered for it. The coverage engine (`coverage.js`) also skips
   vehicles, so they cost nothing per tick; the airport radar's `seesGround` flag is gone, and with it the
   "ground contacts skip terrain masking" exception that only vehicles used.
2. **No speed gate** (LT-RQ11 a). A real MTI passes a fast vehicle on a road; the sources do not say how often, and the
   ATC orders never treat vehicles as radar traffic outside ASDE. `[SOURCE-DEFINED]`: the absolute rule is ours, chosen
   for simplicity.
3. **No ASDE is modelled.** The tower sees vehicles out of the window, as it does today in DCS.
4. **A vehicle with a transponder, Mode 4 or the datalink: still not presented.** From the sources: a squawking vehicle
   is ASDE-X/multilateration traffic, not ASR traffic, and an air-surveillance radar's beacon side presents aircraft.
   In our model it cannot arise anyway: `transponder.js` gives only aircraft a code and Mode 4 only to aircraft and
   ships, and `datalink.js` reports only aircraft and ships. A controller **declaration** or **tag** on a vehicle
   (left in `state/collab-overlay.json` from before) does not bring it back either; it is simply never drawn.
5. **A datalink lock on a vehicle is dropped** (`ws-hub.js` `_present()`): the lock line would otherwise carry the
   vehicle's track id to a controller who is never shown it, the same leak 0059 closes for a contact outside the
   picture.
6. **Correlation never matches a vehicle** (`efsp/correlation-match.js` `buildTrackIndices()`): neither the beacon nor
   the callsign rungs index one, so a DCS ground unit whose callsign happens to share a flight's stem cannot become a
   Strip's contact. An explicit binding (rung 1) is untouched; no controller can make one to a contact they never see.

## Consequences

- The tower's scope loses every vehicle; ships and aircraft (parked included) are as before.
- The client's ground-vehicle drawing is dead and removed: the `gnd-*` icons, the vehicle tag popup (click a vehicle to
  tag it) and Settings → RADAR **Hide ground units** (`settings.hideGroundUnits`). The wire's `domain` is now
  `AIR` or `SEA` only; the value set is not part of the wire-protocol scan (record contents), and an old client simply
  never receives a `GROUND` contact, so no protocol bump.
- Consumers that count contacts read DCS truth, not the presentation, and already ignored vehicles: conflict alert and
  MCI (`AIRBORNE_CATEGORIES`, airplane and helicopter), the airspace entry alert and the airspace card's flight list
  (the same set), surveillance hints (`airborne.js`, aircraft only). Correlation is item 6.
- Freeze goldens: no change expected (the soak/golden tracks are aircraft and ships); see the lane's wip note.

## Open

- A surface range gate / ASDE for the tower, if the squadron ever wants vehicles on a scope (0066's Open, unchanged).
