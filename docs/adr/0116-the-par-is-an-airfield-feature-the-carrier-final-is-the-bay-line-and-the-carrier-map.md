# 0116: The PAR is an airfield feature; the carrier final is the Bay line, the DIST Block and the carrier map

**Status.** Built (lane CARRIER-FOLLOWUP, 2026-10-11). Rulings: decisions.md **H125** ("precision approach radar PAR is an
airfield feature, not a carrier feature"; the carrier final controller gets the FINAL Bay line and the carrier map; the carrier
DIST Block shows the range to the ship for every carrier Position again, from the live ship position) and **H126** (the carrier
FINAL Bay line has no range: the Strip's DIST Block carries it). Replaces ADR 0112's carrier half: decision 2's "a carrier lane"
bullet, the hull `approach` key, the `NO_SHIP` / `NO_COURSE` INOP reasons, and decision 8's carrier DIST Block. The airfield
half of ADR 0112 (Incirlik's `parApproaches`, the sample, its delivery, the PAR panel) stands unchanged. Builds on ADR 0064/0074
(the carrier Strips and the banner), 0113 (the carrier's state), H122/H124 (the side number leads in the carrier regime).

## Context

ADR 0112 put the carrier's approach lanes (CV_APP1, CV_APP2) into the PAR: a sample measured from a touchdown point on the
angled deck, worked out each tick from the live ship and a per-hull `approach` geometry, with the course the ship's heading less
the angled deck. Two questions followed (S-ARCH-44): which course (the physical deck or the final bearing in force) and who sees
the DIST Block (only the lane's controller was sent the sample, so PriFly and the Marshal saw a blank). The human answered by
taking the carrier out of the PAR: the carrier's final is talked down by the CCA controllers on the carrier's own picture, and
the PAR's scopes, glidepath and tolerances are an airfield's.

## Decisions

1. **No PAR sample for a carrier Strip.** `ParMonitor` samples only the final Bays (`view: 'final'`) of an airfield Facility, one
   whose config has `runwayStatus`. The carrier's `cv-app1-final` / `cv-app2-final` stay final Bays (their view is still the
   flight line) but produce no sample. `par.js` loses `carrierTouchdown` and `validateHullApproach`; the sample's `approach`
   loses `kind` (always a runway now) and `hullId`; `INOP_REASONS` is `NO_APPROACH`, `NO_TDZE`.
2. **The hull config has no `approach`.** The key and its start-up check are gone, so a `state/efsp-carriers.json` copy without
   it starts again. The hull config never refused unknown keys and still does not, so a copy that kept `approach` also starts
   (the key is ignored); the squadron should delete it.
3. **The PAR panel is airfield-only.** It names the flight by its callsign, its header is the runway's, and its terminals are
   Landing assured / Missed approach (`par-model.js PAR_TERMINALS`). It stays a tab in the left panel group by default (H126).
4. **The carrier final controller works from the FINAL Bay line and the carrier map.** The line (`bay-views.js`, view `final` on
   a CARRIER Bay) names each aircraft on the final by its side number, the callsign until one is typed (H124), carries no range
   (H126), and has the two terminal buttons with their ops unchanged: Ball is the recorded `FINAL_TO_LSO` handoff, Waveoff the
   `BOLTER_WAVEOFF` state. The name is a label there, not a link to the PAR panel.
5. **The carrier DIST Block (C17) is the range from the ship to the flight's correlated contact, for every carrier Position**
   (PriFly, the Marshal, the lanes; a Strip owned by a CARRIER Position), measured in the client between two server positions:
   the banner's ship position and the contact. The banner is republished once the ship has moved 0.05 NM from where it was last
   published (`shipStateChanged`'s `positionStepNm`), so the reference is never more than that out; a ship making 30 kt
   republishes about every 6 s, one at anchor never. The Strip rewrites the figure in place at most once a second as the
   contact moves. At an airfield (Incirlik's PAR FINAL Strip, which shares the FINAL Block Map) DIST stays the PAR's range to
   the threshold (ADR 0112 decision 8). The MARSHAL board's DME reads the same function.

## Consequences

- `par-sample` frames go to Incirlik's PAR (and whoever holds its hat) only; a carrier lane controller gets none (the client also
  clears every sample it holds on each snapshot).
- The wire surface changes (`approach` keys, INOP reasons); `WIRE_PROTOCOL` stays 2 (already ahead of the last release, 1).
- The carrier banner (`efsp-carrier-delta`) is sent more often while the ship steams: one per 0.05 NM, a small frame, against a
  track delta every 500 ms. It advances the carrier store's seq like any banner change.
- The question of which course a carrier PAR should measure (S-ARCH-44 (a), H124 (1)) is moot and was not built.
