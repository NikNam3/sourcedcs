# U-CARRIER: the carrier panels' v2 prototype fixes (U18–U22), lane note

ADR **0137**. Scope H159: prototype fixes only, no redesign. Branch `lane/U-CARRIER`, commits `1bd97cba..` (one per item, then
goldens and the module-graph fixture).

## What was done

| Item | Cause / change |
|---|---|
| U18 | The server always allowed CV_MARSHAL to create MARSHAL Strips; the client's `CREATE_STRIP_ORIGINS` had no carrier entry, so New Strip was disabled. Two origins: **Marshal · Recovery** (`cv-marshal-stack`, IN_STACK) and **Marshal · Launch** (`cv-marshal-departures`, LAUNCH). No DD1801 lookup for a carrier Strip. |
| U19 | `cv-prifly-pattern` lost its four leg Racks (one Rack `main`) and `view: 'pattern'`; `pattern-board.js`, its test and CSS are deleted; `facility-schema.js` `BAY_VIEWS` no longer has `pattern`. |
| U20 | New Bay **`cv-prifly-recovered`** (implies RECOVERED). Trapped is the carrier handoff **`FINAL_TRAPPED`**: FINAL/BALL at the lane becomes PATTERN/RECOVERED at PriFly in that Bay, the stack entry removed (vacancy, no close-up). Case I "Recovered" lands there by implied state. PriFly's NLA there is Drop. A recovered flight is off the MARSHAL board. |
| U21 | Carrier map: the stack is the 6.4.1.1 left-hand racetrack (`marshalHolding`, 8 nm legs, 2.6 nm wide, stroke 2.5); the path after marshal (`approachPath`: radial to the platform, 10 and 6 nm fixes on the final bearing, the ship) while anyone recovers in Case II/III; the landing pattern while a flight holds in Case I/II (as well as while one is in it). |
| U22 | Stack op **`SetEat {flightDataId, eat: 'HHMM' \| null}`**, entry key `eatOverrideUtc` (only while set), derived `eatSet: true`. FUEL and EAT on a holding row in the MARSHAL panel are click-to-edit for the Marshal; fuel writes the Strip's C12 (`lowStateLb`). |

## Research (U22): CV NATOPS, NAVAIR 00-80T-105, July 2009

The public PDF host did not answer from this session; the quotes below are the ones ADR 0113/0114 already carry, re-read:
- 6.4.2 (p. 6-7): marshal instructions include "expected approach time".
- 6.4.4 (p. 6-8): "Each pilot shall adjust his holding pattern to depart marshal at the **assigned** EAT."
- 6.4.5 (p. 6-8): "Unless weather or operating circumstances dictate otherwise, aircraft departing marshal will normally be
  separated by 1 minute."
- 6.4.9 item 3 (p. 6-17): new EATs are issued "to preclude two aircraft having the same EAT".
- 6.4.1.1 (p. 6-6): "The holding pattern is a left-hand, 6-minute racetrack pattern. The inbound leg shall pass over the holding fix."
- 6.4.7.2 (p. 6-9) and glossary: 250 KIAS, 4,000 fpm to the platform (5,000 ft), 2,000 fpm to the 10 nm DME fix; the 6 nm fix at 1,200 ft.

Conclusion: marshal control assigns the EAT; the slot spacing is the normal case. The briefing's recommended default (override per
flight, wins until cleared, shown set, Delta still shifts all) matches. 9° and 6 min kept (H156 CV-Q1 a).

## Defaults taken (P2)

1. U18: only the Marshal creates (as the server's table always said); PriFly and the lanes create nothing. A recovery typed by
   callsign is a new flight (it does not bind to the launched flight of the same callsign); v3.
2. U19: "remove the pattern section" read as: remove the leg board and leg Racks, keep the Bay with one Rack so Case I / Case II
   See-you Strips still have a home at PriFly (bay id `cv-prifly-pattern` kept: specs and the tab label use it).
3. U20: Trapped hands the Strip to PriFly instead of dropping it; with PriFly unstaffed the hat offer delivers it (ADR 0110), as every
   carrier handoff. Trigger type CONTROLLER_INITIATED (the four §9.12 trigger types stay four). Any Case.
4. U21: racetrack size ours (from 6 min at 250 kt, standard-rate turns); platform drawn 1 nm inside the first fix (base altitude
   6,000 ft, 15 s at 4,000 fpm). The path is drawn while anyone holds, has commenced or is on the approach (Case II/III); the landing
   pattern also while anyone holds in Case I/II (the "planned" pattern; S-ARCH-36's "only while occupied" widened to "while a
   recovery is under way"). `carrier-map.spec.js` 04 updated accordingly.
5. U22: an assigned EAT the same minute as another holding flight's is **refused** (6.4.9). Delta moves it; a new ramp time does not;
   Commence records it and clears it; Back to stack clears it; a Move keeps it. Refused in Case I. Marked until passed (ADR 0115).
   No Undo (like the other stack ops). Fuel typed under 100 is thousands ("4.8" = 4,800 lb, NATOPS 6.4.13.2), otherwise pounds;
   fuel is editable on holding rows only, sent as the Strip's owner.

## What the usage guide / briefing should say (supervisor's docs pass)

- Guide, carrier: "The Marshal creates the carrier's Strips with New Strip: Recovery (it joins the stack) or Launch. PriFly's Bay
  lists the flights coming to the deck; there are no pattern legs. **Trapped** sends the Strip to PriFly's RECOVERED Bay; PriFly
  drops it from there. Case I **Recovered** puts it there too."
- Guide, MARSHAL panel: "Click a holding flight's fuel to type its low state (4.8 is 4,800 lb). Click its EAT to assign one by hand
  (HHMM); it stays underlined until you clear it (an empty entry gives the slot's EAT back). Delta moves it with the others; two
  flights cannot share a minute."
- Guide, carrier map: "The marshal stack is drawn as the holding pattern; while flights recover, the path after marshal (platform,
  10 and 6 miles) and the pattern they will fly are drawn."
- Briefing §3K: `FINAL_TRAPPED` carrier handoff, `cv-prifly-recovered`, no `view: 'pattern'`, `SetEat`/`eatOverrideUtc`/`eatSet`.

## Walks not done

- No DCS ship or real contacts (as every carrier spec). A Case change while a flight has an assigned EAT (Case I hides it; back to
  III shows it again: not walked). Two Marshals assigning EATs at once. Undo of a Trapped (the generic carrier-handoff Undo covers
  it by scope; not walked by hand).

## Left for v3

Recovery bound to its launch flight; a prompt when a Move leaves an assigned EAT out of order; per-aircraft orbits; a real CV ATC
(00-80T-114) check of the panel's columns.

## Files of other lanes touched (minimal hunks)

- U-ROLE-POSITIONS: `authority/strip-types/final.js` (the BALL line only), `carrier/handoffs.js` (one new row, literal `from`/`to`
  as the other rows: they become roles there), `carrier/handoff-effects.js` (one row, `defaultTo: 'CV_PRIFLY'`, a role name in their
  resolution), `carrier-store.js` (`_stackOp`, the SetEat block), `facility-schema.js` (`BAY_VIEWS`), `config/efsp-facility-carrier.json`
  (bays only), `panel/create-strip.js` (two origins with literal `actingPositionId: 'CV_MARSHAL'`, like the others there until their
  conversion), `efsp-nla.js` (one `CARRIER_HANDOFFS` row with literal lane ids, like the others). **Rule 9:** these follow the
  existing literal tables because U-ROLE-POSITIONS is converting them; nothing new invents a literal outside those tables.
- None of U-SMALL-FIXES's files.
