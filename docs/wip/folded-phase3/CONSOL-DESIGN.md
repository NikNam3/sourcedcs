# CONSOL-DESIGN working note

Lane CONSOL-DESIGN (design only, no code), branch `lane/CONSOL-DESIGN-consol-design`, base `4f6be7d8`. Ruling H104
GCLC-3 (a). Deliverables: ADR 0110 (Proposed), `docs/parallel/questions-consol.md` (Q-C1..Q-C3),
`docs/parallel/next/CONSOL-BUILD.md`. No tests run (none needed); tests were read.

## The design in five lines

1. No Strip moves when an ATC Position is left; it stays with its Position.
2. `consolidation` becomes an ordered offer list per Position (`CD: [GC, LC, AP]`), no transitive walk; lane symmetry
   (`CV_APP1 ↔ CV_APP2`) is why the shape changes. GC→LC comes back as 0105's offer.
3. The offer is standing derived state (`hatOffers` on each Position entry), so sign-on later, reconnect and resync all
   show it; Observers of a Primary-less Position are offered it first.
4. A hand-off into an unstaffed Position with a hat-taker is delivered there and warned, not routed elsewhere.
5. LC combination warnings cover every non-local Position (AP included), LUAW makes them severe, never a block.
   TACTICAL keeps its reassignment, renamed `handBack`.

## Defaults taken (P2)

- Offered, not automatic (H104 GCLC-1 b's choice for GC, generalised).
- RSU→LC restored as an offer (guide default; ADR 0075's "strand" reason lapses; ¶10-3-8a4 allows LC with local positions).
- OPS and AP have no list (OPS not a control position; AP→CTR crosses a Facility, ADR 0013).
- Carrier: no combination warnings (no source in the repo).
- `onRunway` = DEPARTURE in LUAW + ARRIVAL in FINAL (not `RUNWAY_GATED_STATES`, which includes DEPARTED).
- Self-offer (the leaver is the first staffed member) is derived but hidden by the leaver's client.
- `returnConsolidatedStrips` kept general, which drains Strips persisted under the old reassignment (no migration code).

## Findings (for other lanes)

- **F1** An Observer at a Position whose Primary signs off non-abruptly is stuck: no Primary, cannot become it
  (`position-store.js:230-247`, `166-168`; `requestPrimary`/`releasePrimaryTo` have no wire). Guide §4.8.6 rule 1 unbuilt.
  ADR 0110 fixes it with "re-declaring makes you Primary"; it is useful independently.
- **F4** A cross-Facility HANDOFF replica appears to be minted at an unstaffed receiving Position with no staffing check
  (none found in `board/coordination.js` or the HANDOFF ops), although ADR 0101's table says "staffed or consolidated".
  Owner: whoever next touches ADR 0101's paths; worth a test.
- No test vacates a carrier Position; the carrier's consolidation was never exercised.
- AP's own arrival NLA (INBOUND→HANDED_TO_TOWER) with LC empty is routed back to AP itself as HANDED_TO_TOWER, frozen
  (today's code; fixed by 0110 §4).
- Today an aircraft in LUAW is parked in `ap-coordination` when LC signs off: the worst case of the old mechanism.

## What the guide should say (CONSOL-C owns the edit)

§8M "Taking a hat": the rule for every Facility; the offer row (standing, "Not now"); the Observer prompt; the LC
warnings (GC/CD/OPS ¶2-6-5b; AP/SFA/PAR ¶2-6-12; LUAW ¶2-6-5c); a hand-off into an empty Position is delivered and
offered. Facility table and §8F1: the lists and the deviations (GC→LC and RSU→LC return as offers; PriFly per Q-C2;
TACTICAL is a hand-back). §8K, §8L: remove "a Marshal … then holds Strips it cannot advance" and "PAR … leaves the Strip
with AP".

## Release note (draft)

"When a controller signs off a Position that still holds Strips, the Strips stay with that Position and the next
controller is offered it ("Take CD as well?"), on every Incirlik and carrier Position, at any time, including after a
reconnect. Nothing is parked at a Position that cannot work it any more."

## Not walked

- Two hulls (one CARRIER Facility, one Marshal per hull?): out of scope, as in ADR 0109.
- The radio panel (GCLC-4): `monitoring` already gives the union of a combined controller's frequencies; nothing here
  changes it.
