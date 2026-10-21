# 0137: The carrier prototype: the Marshal creates its Strips, PriFly has no pattern legs and keeps the recovered aircraft, and the Marshal may assign one flight an EAT

**Status.** Built (lane U-CARRIER, 2026-10-21). Live test 2026-10-13 §F **U18–U22**; scope **H159** (v2 ships a first working
prototype of the carrier panels; upgraded panels are v3). **H156 CV-Q1 a** kept: 9° angled deck and 6 min fix-to-ramp.
Amends, without editing (P4): ADR 0064/0074 (FINAL's BALL NLA was a drop; PriFly's Bay had four leg Racks), ADR 0075 (the
pattern board), ADR 0113/0114 (no op names an EAT). Edition: CV NATOPS, NAVAIR 00-80T-105, 31 July 2009 (the public copy of
`docs/wip/PANELS-DESIGN.md` S7); paragraph text as quoted in ADR 0113 and 0114, which this lane re-read (the PDF host was not
reachable from this session, so nothing here is quoted that those two ADRs do not already quote).

## Context

1. **U18.** The carrier could not create a Strip. The server always let CV_MARSHAL create MARSHAL Strips
   (`createsStripTypes`); the client's New Strip origins listed only OPS, AP, CTR, TAC_C2 and GCI, so the control was disabled
   at every carrier Position. Every carrier spec created its Strips through `crc.ws.sendEfspCreateStrip`, which hid it.
2. **U19.** PriFly's Bay `cv-prifly-pattern` had four Racks (INITIAL, BREAK, DOWNWIND, GROOVE) and a leg board over them
   (`view: 'pattern'`, `pattern-board.js`). The pattern is flown zip-lip: no controller moves a flight from leg to leg.
3. **U20.** No Bay for recovered aircraft. "Trapped" (FINAL at BALL) dropped the Strip at the lane; a Case I flight's
   "Recovered" (PATTERN at RECOVERED) stayed in the pattern Bay.
4. **U22.** The MARSHAL panel's FUEL:EAT cell was display only. Fuel was typed on the Strip; the EAT was derived from the slot
   and the ramp time, and `marshal-stack.js` refused any op that names it.

What CV NATOPS says about the EAT:

- **6.4.2 Marshal Instructions (p. 6-7):** marshal control gives each aircraft, among the rest, "expected approach time".
- **6.4.4 Departing Marshal (p. 6-8):** "Each pilot shall adjust his holding pattern to depart marshal at the **assigned** EAT."
- **6.4.5 Initial Separation (p. 6-8):** "Unless weather or operating circumstances dictate otherwise, aircraft departing marshal
  will normally be separated by 1 minute."
- **6.4.9 Delta, item 3 (p. 6-17):** "Marshal control shall issue new EATs as soon as possible. To preclude two aircraft having the
  same EAT, new EATs shall be issued from the latest to the earliest."
- **Glossary, EAT:** "The future time at which an aircraft is cleared to depart inbound or penetrate from a preassigned fix."

So the EAT is something marshal control **assigns**; the one-minute slot spacing is the normal case, not a rule; and two flights
never share one. The slot model stays the default and the per-flight value is an exception the Marshal makes.

## Decision

1. **The Marshal creates both carrier Strips from the toolbar** (U18): "Marshal · Recovery" (a MARSHAL Strip in
   `cv-marshal-stack`, IN_STACK, which joins the stack) and "Marshal · Launch" (`cv-marshal-departures`, LAUNCH; ADR 0109 binds it
   to an ATO mission line by callsign). The same create flow as the airfield; no DD1801 lookup for a carrier Strip. PriFly and the
   lanes create nothing: their Strips come by a carrier handoff, as before.
2. **PriFly's pattern legs are gone** (U19). `cv-prifly-pattern` has one Rack, `main`; the Bay view `pattern`, `pattern-board.js`,
   its CSS and its test are removed, and `facility-schema.js` no longer accepts `view: 'pattern'`. PATTERN Strips are ordinary
   Strips in that Bay (side number leading, H124), with their NLA (Recovered).
3. **A RECOVERED Bay at PriFly** (U20), `cv-prifly-recovered`, implying RECOVERED. "Trapped" is a carrier handoff of its own,
   **`FINAL_TRAPPED`** (CONTROLLER_INITIATED, from the lanes to PriFly, any Case): the lane's FINAL Strip at BALL becomes PriFly's
   PATTERN Strip at RECOVERED in that Bay, in place (same Strip, same flight); the flight leaves the Marshal stack there (a vacancy,
   no close-up, H28) as the drop did. A Case I flight's "Recovered" lands in the same Bay by its implied state. PriFly drops it from
   there like any finished Strip (NLA "Drop"); the movement counts once, as RECOVERED is PATTERN's countable state. A recovered
   flight is off the MARSHAL board. If PriFly is unstaffed, the handoff goes to whoever its hat is offered to (ADR 0110), as every
   carrier handoff does.
4. **The Marshal may assign one holding flight an EAT** (U22). New stack op **`SetEat {flightDataId, eat}`**: `eat` a Zulu HHMM the
   server dates on the mission clock, or empty/null to clear. Stored on the entry as `eatOverrideUtc`, present only while set. It
   wins over the slot's EAT until cleared; the derived entry carries `eatSet: true` and the panel underlines the figure (grey, no
   colour: it is not a problem). **Delta** moves it by the same minutes as every holding EAT; a new ramp time does not (the Marshal's
   value stays the Marshal's); **Commence** records it as the EAT worked to and clears it; **Back to stack** clears it. Refused at a
   Position without `sequencesStack`, in Case I (no EAT), for a commenced flight, for a value that is not HHMM, and for a minute
   another holding flight already has (6.4.9). A change is marked until passed (ADR 0115) like any EAT change. No Undo, like the
   other stack ops. Angels and DME stay derived only; `DERIVED_KEYS` is unchanged.
5. **Fuel is typed in the panel too** (U22): clicking FUEL on a holding row edits the Strip's LOW ST Block (C12, `lowStateLb`), the
   same field the Strip writes, sent as the Strip's owner. Typed in thousands as spoken ("4.8", NATOPS 6.4.13.2) or in pounds.
6. **The carrier map** (U21, client only): the marshal stack is drawn as the 6.4.1.1 holding pattern, a left-hand racetrack whose
   inbound leg runs down the radial over the fixes, wider and bolder than the old line; while a flight is commenced or on the
   approach the Case III path after Marshal is drawn (the radial in to the platform, 10 nm and 6 nm fixes on the final bearing, to
   the ship), and the landing pattern while a flight is in it (as before).

## Consequences

- `WIRE_PROTOCOL` stays 2 (already ahead of release 1); `wire:record` registered `FINAL_TRAPPED`, `SetEat`, `eatOverrideUtc` and
  `eatSet`.
- Freeze goldens that held `cv-prifly-pattern/initial` or the trap's drop were re-recorded.
- Left for v3 (H159): binding a recovery check-in to the flight that launched (ADR 0074's recovery-on-the-same-flight is still a
  bind by flight id only); an assigned EAT for a flight that moves slot keeps the Marshal's value (no prompt); no warning when an
  assigned EAT breaks the one-minute order of the stack beside it; the racetrack's size is ours (NATOPS gives the 6-minute pattern
  and the left turns, not a drawn width).
