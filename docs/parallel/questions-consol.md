# Questions: CONSOL (who takes the hat), for the human

Written by CONSOL-DESIGN on 2026-10-04 for ADR 0110 (draft, `docs/adr/0110-consolidation-means-the-next-controller-takes-the-hat.md`).
Only squadron practice is asked here; everything else is decided in the ADR with its reasons. Nothing in `decisions.md`
is re-asked: H104 already settled that combinations **warn and never block** (GCLC-1, GCLC-2) and that the next
controller is **offered** the Position, not signed on automatically (GCLC-1 b).

Background in one paragraph: when a controller signs off a Position that still holds Strips, the Strips no longer move
to another Position that may not be allowed to work them. They stay where they are, and the next controller in a list
gets a standing offer, "CD is unstaffed with 3 Strips. Take CD as well?". Taking it is a sign-on: one person, two
Positions, like LC taking GC today (usage guide §8M). The questions are only about **who is on each list, in what order**.
Each list lives in the facility config and is one line to change later.

## Summary

| Tag | Ids |
|---|---|
| HUMAN (squadron practice) | Q-C1, Q-C2, Q-C3 |
| Blocking | none: the build lane ships the recommended lists and the answers change one config line each |

---

### Q-C1: Does the radar controller (AP) get offered the tower Positions when the tower is empty?   [lanes: CONSOL-BUILD]  [who: HUMAN]  [blocking: no]
- Context: today LC's Strips move to AP when LC signs off, and AP cannot advance any of them (an aircraft in LUAW ends up
  in AP's coordination Bay). Under ADR 0110 they stay at LC and somebody is offered LC. The FAA says tower and radar
  approach are "not normally consolidated during non-midwatch operations" (JO 7210.3 ¶2-6-12), and our Incirlik is one
  Facility with a RAPCON position (AP) in it. A real USAF RAPCON is a separate unit from the tower; we could not read the
  USAF manual.
- Question: When LC (or GC, CD) is left with Strips and nobody else in the tower can take it, is the AP controller offered it?
- Options:
  (a) yes, AP is last on every tower list: `CD: [GC, LC, AP]`, `GC: [LC, AP]`, `LC: [AP]`. Taking LC as AP shows a
  "tower and radar combined" warning, red while a departure is lined up (warn only);
  (b) only LC goes to AP (today's link): `LC: [AP]`, while CD and GC stop in the tower (`CD: [GC, LC]`, `GC: [LC]`);
  (c) never: the tower and the radar room do not take each other's Positions (`LC` has no list). A tower left empty
  shows "nobody to offer them to".
- **Recommended: (a).** An offer can always be declined, and with our manning the AP controller is often the only one
  left who can clear a lined-up aircraft for takeoff. The warning says what the FAA says.

### Q-C2: On the carrier, who takes whose Position?   [lanes: CONSOL-BUILD]  [who: HUMAN]  [blocking: no]
- Context: the carrier has four Positions: Marshal, PriFly (the Air Boss: sets the Case, owns the pattern) and two
  approach lanes. Today the order is lane 2 → lane 1 → Marshal, and PriFly is on no list, so PriFly's pattern Strips are
  left with nobody when PriFly leaves, and a recovery handed in by CTR while nobody holds Marshal waits with no prompt.
  The repo has no Navy (CV NATOPS / CATCC) text, so this is squadron practice only.
- Question: When a carrier Position is left with Strips, who is offered it, in what order?
- Options:
  (a) the radar room covers itself: each lane offers to the other lane, then the Marshal; the Marshal offers to lane 1,
  then lane 2. PriFly stays apart (its Strips wait for a new PriFly);
  (b) as (a), and **Marshal and PriFly cover each other**: PriFly's Position is offered to the Marshal, and the Marshal's to
  the lanes, then PriFly. One controller can then end up running the whole ship, Case selector included;
  (c) keep today's order only (lane 2 → lane 1 → Marshal), as offers.
- **Recommended: (b).** In a small squadron one person often runs the whole carrier, and nothing moves unless they
  accept. (a) is the closer fit if PriFly is normally a separate person (an LSO/Boss) who never gives the job to CATCC.

### Q-C3: When one approach lane signs off, does the other lane take that Position, or take the aircraft?   [lanes: CONSOL-BUILD]  [who: HUMAN]  [blocking: no]
- Context: the two lanes can both work every final-approach Strip. Today lane 2's aircraft are moved to lane 1 on
  sign-off (they then belong to lane 1 and its frequency). ADR 0110 would instead offer lane 1 the lane 2 Position: the
  lane 1 controller holds both, works both frequencies, and the stack keeps feeding both lanes alternately.
- Question: Which one matches how the squadron would really run it?
- Options:
  (a) take the Position (ADR 0110): one controller, both lane frequencies, nothing moves;
  (b) take the aircraft (today): they move to the remaining lane, and the aircraft are switched to its frequency;
  new aircraft all go to the remaining lane.
- **Recommended: (a).** It is the same rule as every other Position (one meaning of the word everywhere), and nobody has
  to tell aircraft on final to change frequency.
