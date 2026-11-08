# 0156: The carrier strip flow: two strip types, a Case per flight, and one Marshal panel for every arrival

**Status.** Proposed (2026-11-08), not built. Design: `docs/wip/CARRIER-FLOW.md`. Amends, without editing (P4): ADR 0064
and 0074 (the MARSHAL, FINAL and PATTERN carrier strip types and their states), ADR 0114 (the MARSHAL board's columns and
colours, Angels and DME derived only), ADR 0137 (the Marshal creates the recovery by callsign, FINAL_TRAPPED and PriFly's
RECOVERED Bay, the Case II "See you"), ADR 0154 (the airborne launch stays with the Marshal; a recovery is a new Strip)
and ADR 0155 (Case I and II launch straight to the Marshal). [SOURCE-DEFINED]: the human's rulings of 2026-11-08 in
session; CV NATOPS was not re-read for this.

## Context

The carrier's Strips grew lane by lane (0064, 0074, 0113, 0114, 0137, 0154, 0155): three strip types whose states mean
different things by Case, a recovery that has to be a new Strip, a Case II exit to PriFly, a trap that goes to PriFly,
and a MARSHAL board that shows only part of the recovery. The human laid out the whole flow in one piece: what each
Position does, in each Case, with one panel the Marshal and both approach controllers look at.

## Decision

1. **Two carrier strip types replace MARSHAL and PATTERN, and the carrier stops using FINAL** (PAR keeps FINAL):
   - `CV_DEP`: `ON_DECK` · `CV_AIRBORNE` · `KILO` · `DROPPED`;
   - `CV_ARR`: `STACK` · `COMMENCED` · `FINAL_APPROACH` · `DIRTY` · `BULLSEYE` · `CV_PATTERN` · `DROPPED`.
   The names collide with no other strip type's state (ADR 0074's rule): `AIRBORNE` is MISSION's, so the carrier's is
   `CV_AIRBORNE`; `CV_PATTERN` stays clear of `IN_PATTERN` and `TRAFFIC_PATTERN`. The panel and the Strip show the plain
   words (AIRBORNE, PATTERN).
2. **A Case per flight.** A `CV_ARR` Strip takes the ship's Case when it enters the stack (`recoveryCase`) and keeps it
   until it is dropped. A later change of the ship's Case moves no flight. The one exception is the Marshal's **Abort to
   the Case II/III stack** ("…" menu), offered on a Case I flight only while the ship's Case is II or III: the flight
   becomes a Case II/III arrival at `STACK` with a new slot. A `CV_DEP` Strip follows the ship's Case at creation.
3. **Departures.** PriFly creates the Strip at `ON_DECK`.
   - Case I: PriFly drops it, or hands it to the Marshal.
   - Case II and III: PriFly hands it to departure control (`CV_AIRBORNE`), which advances it to `KILO`, then drops it
     or hands it to the Marshal.
   A handoff to the Marshal changes the Strip in place to `CV_ARR` at `STACK` (same Strip, same flight, same squawk) and
   is accepted automatically. ADR 0154's "the recovery is a new MARSHAL Strip" and the Marshal's airborne Bay are gone.
4. **Arrivals, Case II and III.** One button per state, owned as follows:

   | State | Owner | Button |
   |---|---|---|
   | STACK | Marshal | COMMENCE |
   | COMMENCED | Marshal | TO APPR: hands it to APP1 or APP2 (alternation in push order, H30, the Marshal may override) at FINAL_APPROACH |
   | FINAL_APPROACH | lane | DIRTY UP |
   | DIRTY | lane | FLY BULLS |
   | BULLSEYE | lane | TO PATTERN |
   | CV_PATTERN | lane | DROP |

   The Marshal may send a flight back to the stack from STACK, COMMENCED, FINAL_APPROACH or DIRTY ("…" menu, any Strip
   the Marshal can see); the lane may hand a flight back to the Marshal from FINAL_APPROACH or DIRTY. Both are the same
   thing: the flight returns as a new arrival (next free slot, new EAT, Angels and DME derived again, assignments
   cleared). A flight at BULLSEYE or in the pattern does not leave the pattern.
5. **Arrivals, Case I.** STACK (Marshal, button TO PATTERN, hands it to PriFly) → CV_PATTERN (PriFly, button DROP).
6. **Removed:** `MARSHAL_TO_PRIFLY` ("See you"), `FINAL_TRAPPED` and `cv-prifly-recovered`, `APPROACH_TO_FINAL`
   ("Radar contact"), `FINAL_TO_LSO` ("Ball"), the carrier's BOLTER_WAVEOFF, `cv-marshal-airborne`.
7. **Creation by side number.** A carrier Strip is created with its side number, not a callsign. PriFly also types the
   type and the departure radial (a new field); the Marshal the type and fuel. In Case II and III the squawk is allocated
   as for any Strip. The callsign is optional and is not a Block: "…" → **Set callsign**. The ATO bind (ADR 0109) is made
   then, by callsign as before; a Strip without a callsign has no ATO line.
8. **Blocks.** A carrier Strip carries nothing else:
   - `CV_DEP`: SIDE, TYPE, DEP RADIAL; Case II/III also SQUAWK, HDG, SPD, ALT;
   - `CV_ARR` Case I: SIDE, TYPE, FUEL, ANG;
   - `CV_ARR` Case II/III: SIDE, TYPE, FUEL, ANG, EAT, SQUAWK, HDG, SPD, ALT.
9. **Assignments and conformance (Case II and III only).** HDG, SPD and ALT may be assigned on any Case II/III carrier
   Strip. The conformance monitor checks only what was assigned; nothing is implied (a holding flight is not checked
   against its Angels). Back to stack and the hand back clear all three.
10. **The Marshal panel is the one panel for arrivals.** Every `CV_ARR` Strip from STACK to its drop, in any Case, at the
    Marshal, APP1 and APP2 alike; departures never. The button is the status: COMMENCE, TO APPR, DIRTY UP, FLY BULLS,
    TO PATTERN, DROP, live only for the Strip's owner. Columns:
    - Case I: SEQ, SIDE, TYPE, FUEL, ANG, beside a **circle**: the overhead stack, ship-up (BRC up), each aircraft at its
      live bearing and range from the ship, labelled side number and Angels;
    - Case II/III: SEQ, SIDE, TYPE, FUEL, EAT, ANG, DME, and the graphic as today. DME is the **assigned holding-fix DME**
      (Angels + 15, NATOPS 6.4.1.1); the graphic still puts each aircraft at its real range from the ship.
    The Marshal may type FUEL, EAT, ANG and DME on any row the Marshal owns; an override holds until cleared, as SetEat
    does (ADR 0137 §4). The bingo colouring and its margin setting are removed: the panel has no fuel rule.
11. **Correlation.** Case I is never correlated automatically (no radar service is given to a Case I aircraft); the
    controller binds a track by hand if they want one. Case II and III correlate by squawk.
12. **What the scopes show** (`surveillance/presentation.js`, the one choke point, ADR 0059):
    - the carrier map is the only place a carrier Strip's label (side number, Angels) is drawn;
    - every other radar scope, the carrier Positions' main map included, shows the aircraft by its sensors alone: a
      primary contact, or a primary contact with its transponder reply when it squawks; never the side number, never the
      Strip's callsign;
    - a tactical Position (L16) sees the Strip's callsign and the ATO mission once a callsign is set; without one, a
      primary contact like everyone else.
13. **No conflict alert between two carrier aircraft.** A pair where both aircraft are correlated to a live carrier
    Strip raises no conflict alert. A carrier aircraft against any other still alerts. MCI is unchanged.
14. **The carrier map gets the main map's measure line** (heading magnetic and range in nm, drag to draw, the next click
    clears), the same behaviour, not a new tool.
15. **The radial and distance from the ship beside the cursor, on the carrier map only**: `RRR/DDD`, the radial magnetic
    from the ship and the range in nm, while the cursor is over the carrier map. Its own style, not the bullseye BRA's:
    the ring-label green (`COL.ringText` in `carrier-map-panel.js`). The ship is the one the carrier map is drawn around,
    so a second carrier is a second hull, not a new rule. The main map's bullseye readout is unchanged.

## Consequences

- `WIRE_PROTOCOL` bump (`wire:record`: strip types, states, handoff kinds, stack ops, the new fields). crc-sync and
  crc-desktop ship together.
- Carrier Strips on a persisted Board are not migrated; the mission reset (ADR 0108) clears them. A `state/` copy of
  `efsp-facility-carrier.json` must be deleted (its Bays imply removed states).
- Freeze goldens holding carrier states, Bays or the permission tables are re-recorded.
- `docs/efsp-usage-guide.md` (the carrier chapter) and the release notes are rewritten for the new flow.
