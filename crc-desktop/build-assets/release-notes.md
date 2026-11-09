### Fixed in 2.1.5
- **MARSHAL: TYPE and FUEL are boxes again** on every row the Marshal holds: type and press Enter (fuel in thousands, 4.8; Escape puts it back)

### Changed in 2.1.4
- **CARRIER MAP: click a contact.** On one with no Strip, type a side number and **CREATE STRIP**: it is checked in at the Marshal's stack, bound to that contact (Case II/III: its squawk and an EAT from where it is; no transponder: a warning, and the Strip all the same). On one whose Strip you hold: HDG, SPD and ALT, as on the main map
- **Case I:** the Marshal's TO PATTERN is now **SGNL C**
- **MARSHAL header reads the last flight in the stack**: its DME, ANG, EAT and APPR (the one you just checked in), or 21 NM, angels 6, EAT 00 with nobody in the stack
- **MARSHAL table columns** are now SEQ, SIDE, TYPE, FUEL, DME, ANG, EAT

### Changed in 2.1.3
- **MARSHAL: APPR in the header is the next check-in's approach button**, changing with every flight that checks in, so you can give it on initial contact. A flight keeps the lane it was told even when a flight below it leaves; Back to stack tells it a new one
- **MARSHAL: a flight checked in from the panel with its squawk gets its EAT from where it is**: ((range − 20 nm) + the 20 nm arc to the marshal radial) ÷ 5 nm a minute + 5 minutes, and always after the latest EAT in the stack. With no contact squawking that code, the slot's EAT
- This release changes the wire protocol: update CRC, an older version shows "Update required"

### Changed in 2.1.2
- **MARSHAL: check a flight in from the panel.** Type the side number (and the squawk, Case II/III) beside **+ New Strip** in the MARSHAL header: the flight joins the stack at the next slot
- **MARSHAL header** reads as one line: `CVN-72 CASE III CV-1 BRC 082M FB 073M ALTIMETER 30.06 MARSHAL 270 21NM ANG 6 EAT 04 APPR 15`, where the NM, ANG and EAT are what the next flight to check in gets and APPR the approach the next flight goes to (15 for APP 1, 17 for APP 2). In Case I it ends at ANG, the next altitude from 2
- **Case I**: a flight checking in is given the next altitude, one above the highest (from 2)
- **A carrier Strip is created by its side number alone.** The TYPE and DEP RAD / FUEL boxes beside New Strip are gone: type the side number, press New Strip, and type the type, the departure radial or the fuel on the Strip as on any Strip

### Fixed in 2.1.1
- **The Linux build of 2.1.0 was not published**: 2.1.1 is the carrier flow release (see 2.1.0) for both Windows and Linux
- **SRS radio: the microphone is sent in 40 ms frames**, what the SRS client itself sends, so its receivers' jitter buffer gets whole packets
- crc-sync starts on a Board saved by an older version: the carrier's old MARSHAL/PATTERN Strips are left out (a server fix: crc-sync is redeployed with this release)

### Changed in 2.1.0: the carrier flow
- **Carrier Strips are made by side number.** PriFly's and the Marshal's New Strip ask for the side number only; the type, departure radial and fuel are typed on the Strip; the callsign is set later from ⋯ → Set callsign…, which joins the flight to its ATO mission
- **Departures:** ON DECK → (Case II/III) LAUNCHED to departure control → KILO → DROP, or TO MARSHAL; in Case I PriFly drops it or hands it TO MARSHAL. TO MARSHAL makes the launch the flight's recovery in the stack (same Strip, same squawk)
- **Arrivals, Case II/III:** COMMENCE, TO APPR (to APP 1 or 2), DIRTY UP, FLY BULLS, TO PATTERN, DROP. **Case I:** TO PATTERN to PriFly, DROP. Each flight keeps the Case it was given on check-in; ⋯ → Abort to Case II/III stack sends a Case I flight to the stack once the ship is in Case II or III
- **The MARSHAL panel is the one panel for arrivals:** every recovery to its drop, one table per Case (Case I beside an overhead circle), each row's button its state and live for the Strip's owner only. The Marshal types fuel, EAT, angels and the holding DME. The fuel/bingo colouring is gone
- **Back to stack** is in ⋯ (the Marshal from COMMENCED on, the lane on its own approach); it clears the flight's heading, speed and altitude
- Carrier Strips carry only what the controller needs; Case II/III flights get HDG, SPD and ALT with conformance (heading and altitude). A Case I flight gets no squawk
- Carrier aircraft are labelled only on the CARRIER MAP; other scopes show them by their sensors. No conflict alert between two carrier aircraft
- **CARRIER MAP:** the cursor shows its radial and range from the ship; a right-drag measures
- This release changes the wire protocol: update CRC, an older version shows "Update required". For the server operator: delete `efsp-facility-carrier.json` from the `crc-sync-state` volume if a copy is there (its Bays name removed states), and carrier Strips on the Board are cleared by the mission reset

### Changed in 2.0.5
- **The carrier has a Departure Position (`CV_DEP`).** In Case III a launch now goes PriFly → Departure → Marshal: PriFly's **Launched** hands the airborne aircraft to Departure, whose **To Marshal** passes it to the Marshal's airborne Bay. In Case I and II there is no Departure and **Launched** goes straight to the Marshal
- **PriFly creates the launch Strip** (**PriFly · Launch**, in PriFly's new launch Bay); the Marshal's New Strip makes only the recovery
- This release changes the wire protocol: update CRC, an older version shows "Update required" (a server change: crc-sync is redeployed with this release)

### Changed in 2.0.4
- **A launched aircraft stays with the Marshal.** **Launched** no longer drops the launch Strip: it moves to the Marshal's new airborne Bay, and the Marshal presses **Drop** once the next controller (CTR, a GCI) has made their own Strip. The carrier still hands nothing off (a server change: crc-sync is redeployed with this release)
- **Acting As shows who holds a Position.** A Position someone else is Primary at shows their name in grey; signing on there makes you an Observer

### Fixed in 2.0.3
- **The carrier Positions have radar again.** MARSHAL, PRI-FLY and the CV approach Positions now see the carrier's radars whenever the carrier panel finds the ship. Before, a CVN-72 whose DCS unit was not named exactly `UNION` had a working carrier panel but no radar at any carrier Position (a server fix: crc-sync is redeployed with this release)

### Fixed in 2.0.2
- **MARSHAL: the fuel is a box you type in.** On a holding flight whose Strip you own, FUEL is always an input: type the low state in thousands (4.8) and press Enter. A figure that is not one is outlined and not sent; Escape puts the shown fuel back
- MARSHAL: typing in a fuel, EAT or angels box no longer freezes the rest of the board, and the click after it (EAT, Commence, the next fuel box) is no longer lost
- 2.0.1's login fix reaches Linux with this release (the 2.0.1 AppImage was not built)

### Fixed in 2.0.1
- **Login works again on a fresh install.** CRC no longer asks Casdoor to skip its login page, so if you are not already signed in you now get the Discord sign-in instead of "Session state missing"
- A login error from Casdoor is shown as itself (for example "Auth error: login_required") instead of a CSRF warning

### Changed: FAA vocabulary (read this first)
- Positions are renamed after the FAA's operating-position designators: Tower is now **LC** (Local Control), Ground is **GC** (Ground Control), Approach is **AP**. Their Bays follow (`lc-…`, `gc-…`, `ap-…`). `OPS`, `CD`, `RSU`, `SFA`, `PAR`, `CTR` and the tactical and carrier Positions keep their names
- The FIELD STATE panel is now **RUNWAY STATUS**; the short-term conflict alert tag is now **CA** (Conflict Alert); Block 5's label is **BEACON** (the assigned code); a Strip's Role is now its **strip type**; "FDR" is **flight data**
- Positions are **staffed / unstaffed** (not occupied / unmanned), you **sign on** to them (not hold them), and an unstaffed Position's Strips go to the Position it is **consolidated at** (not its covering Position); a coordination that is waiting is **INITIATED** (not PROPOSED)
- `docs/glossary.md` maps every old word to the new one; the controller's guide and the usage guide use the new words
- The server's EFSP state is reset with this release (no migration): open Strips, the Mutation log and the runway status start empty. Your saved panel layout resets once; panels return to the default positions
- For the server operator: before deploying client and server together, edit `infra/.env` (rename `ASACS_DOMAIN`/`ASACS_URL` to `CRCSYNC_DOMAIN`/`CRCSYNC_URL` if set; the old names are no longer read) and, in the `crc-sync-state` volume, delete `efsp-board.json`, `efsp-mutations.jsonl` and every `efsp-facility-*.json`, and delete `alerting.json` if it still has an `stca` key (the key is `conflictAlert` now; an unknown key stops start-up). A state file with an unknown key or an old shape stops start-up with the file named; delete that file for a clean start

### Changed: after the live test
- Incirlik has no SFA Position any more: AP files a single frequency approach on its SFA Bay's frequency Racks and presses **Hand off to PAR**; the pilot keeps the frequency
- PAR's final line has HDG and ALT, **Begin descent**, **Cleared to land**, **Landed** (hands the Strip to GC) and **Missed approach** (back to AP for another approach); "Landing assured" is gone
- Conflict Alert is only between two aircraft with Strips; an aircraft with no Strip that squawks altitude is a **Mode C Intruder** (MCI). One formation, and one MARSA, never alert against each other
- Selecting a Strip no longer rings its aircraft: use **Show on map** in the Strip's ⋯ menu. Clicking a contact still selects its Strip
- A contact squawking a Strip's assigned code is that flight, even if an earlier flight had the same jet; `NO TRK` names the flight that has a duplicate code
- TYPE (Block 3) is typed in ICAO order as one field, `2/F16/M`; the wake is ICAO L/M/H/J and filled from the type. Block 1 is labelled ACID, and every label's hover names its FAA block
- Only an airspace's controlling Position defines it; OPS, Incirlik's using agency, schedules, activates and approves entry
- The handoff chips `COMMS:` and `CTRL:` are plain grey; the coordination send button names its target ("Hand off to CTR"); the SPLIT chip is gone
- The combination line lists only the frequencies to monitor, in grey; click it to acknowledge
- Time-to-find counts a first selection within 30 seconds; a mission under an hour shows one metrics column
- Stereo routes fill route, altitude and airports only, no remarks; the picker shows their names
- For the server operator: delete or fix `efsp-board.json` in the `crc-sync-state` volume before starting this crc-sync (a Board saved with the old SFA rotation stops start-up), and remove any `remarks` key from a `state/efsp-stereo-routes.json` (an unknown key stops start-up)

### Changed: for the v2 launch
- There is no RSU: the tower works pattern traffic on its own Strips. P/S (PAT/STR) and OPT (T&G/FS/LA) cells, an IN PATTERN Bay, and ⋯ **Closed traffic** / **Leave pattern**
- Handoffs are **released** by default: the receiver presses **Checked in** when the pilot calls and control moves then; untick Released to keep control until the aircraft is in the receiver's airspace. **Request release…** asks for it sooner. The old Comms to / Control to / release form are gone
- The PAR final is an ordinary Strip (HDG, ALT, Landed, Begin descent, Cleared to land; Missed approach and Show in PAR panel in ⋯). The PAR azimuth scope is in degrees; red below the glidepath starts at 0.5° (the FAA lower safe limit). The "Default glideslope" setting is gone: the PAR controller sets TDZE, TCH, DH and GPA in the PAR panel's header
- MARSA declared locally or at an MTR entry is no longer voided by an assigned heading or altitude; only a tanker MARSA before rendezvous is
- The Strip's airspace badge is amber only while the aircraft is inside an approved airspace that is not active
- No radar shows ground vehicles; Settings "Hide ground units" is gone. A flight's code shows in its data block only while it squawks the wrong one
- TOFI with one counterpart reads **TOFI to CTR** and sends at once; the ⋯ menu prints each heading once
- ATO and DD-1801 types arrive as ICAO designators (F-16C becomes F16)
- The carrier: the Marshal creates Strips (**Marshal · Recovery** / **Marshal · Launch**); PriFly has no pattern legs; **Trapped** sends the Strip to PriFly's RECOVERED Bay
- For the server operator: before deploying, read `infra/RUNBOOK.md` "v2 launch": delete `efsp-board.json` and `efsp-mutations*.jsonl` (an old handoff or RSU Strip stops start-up), check any `state/efsp-facility-incirlik.json` (no RSU) and `state/efsp-airspaces.json` (it must carry the jurisdiction areas), then build the terrain cache

### Changed: after the final tests
- Correlation is by beacon code or a binding only, never by callsign: `TRK?` and the `?` on a label are gone. To correlate an AI flight, type the code it squawks (6000–6777) into its Strip's beacon code; if that code later goes to a different AI aircraft the Strip says `NO TRK` instead of following it
- Airspace types are the FAA's: MOA, restricted, prohibited and warning. A range is no airspace type (make the airspace over it restricted, warning or a MOA, with the range controller as its user). A prohibited area is always in force (`IN FORCE`, no activation)
- The Incirlik RAPCON is the unclassified Adana MTMA (IFR separated from VFR, VFR to VFR traffic advisories); the control zone is Class D. Each jurisdiction area shows its VFR service, and Edit… sets CLASS and VFR SERVICE
- Once PAR has the flight nothing of its clearance alerts; after Begin descent only leaving the glidepath does (`GP ↓`/`GP ↑` on the Strip, `BELOW`/`ABOVE GLIDEPATH` on the PAR panel). The PAR azimuth window is fixed at ±3° (Shift+wheel zooms, double-click resets)
- The heading alert waits as long as the turn takes (3° a second, slower for a fast aircraft at 25° of bank) plus 15 s, and fires early if the turn stops or goes the wrong way
- Incirlik's runway and PAR final course are DCS's own runway (052.7°/232.7° true, 047° magnetic): they were 3° off. The DCS F10 ruler reads about 049.6 for the same line because it measures from grid north
- The PAR approach values can be set with nobody on the final; the `UNACTIVATED AIRSPACE ENTRY` chip appears only while the aircraft is inside the non-active airspace, like the amber badge
- The airport surface shows while you hold GC or LC (Incirlik), also on the black ATC scope, in dim grey
- LC's departure face no longer shows P/S, OPT and HOOK (they are in ▼); a cell you may not write on someone else's Strip is read-only
- The PANELS panel starts with ACTING AS; the radar list is folded behind one grey `RADARS · n` line
- The bullseye readout beside the cursor is hidden on an ATC-only scope and off the map
- A click or double-click never moves a Strip: the drop follows the dragged Strip, and a tab takes a drop only after 16 px of travel. A Strip that flashes on arrival keeps flashing when it is redrawn
- For the server operator: before deploying, read `infra/RUNBOOK.md` "v2 launch": a `RANGE` or `DANGER` airspace or `headingGraceSec` in `state/alerting.json` stops start-up; after the deploy AP edits LTAG-RAPCON to unclassified (or reset the Board)

### New
- Radar line-of-sight: radars now respect terrain — a target can be masked by mountains/terrain between it and the radar, instead of every radar seeing straight through the ground within its range ring
- Ground/ship radars use a realistic assumed antenna height (airborne radars still use live altitude) so LOS masking isn't unrealistically easy to trigger
- LOS terrain profile chart: hover a radar in the RADARS panel (with Radar Debug on) to see a terrain-vs-distance chart along its current beam, with the sight line and exactly where it's blocked
- Elevation contour overlay, toggleable under Settings → Map Overlays
- In-app update indicator in the topbar (checking / downloading % / ready-to-restart), so you can see and control an update without digging through logs
- "What's New" dialog after an update installs, showing what changed in the new version
- Flight following: start radar service on a contact with no Strip from the track panel (Strip, code and track in one step), and end it with **Radar service terminated** in the Strip's ⋯ menu
- The airspace-conflict alert: an aircraft inside an active airspace it may not be in shows an amber `SAA` on the scope and "Airspace conflict" on its Strip, by airspace type
- MARSA: a receiver under tanker MARSA is watched against the tanker (1,000 ft, 3 NM); a void stays shown until someone presses **Acknowledge**
- Remarks on every Strip: a one-line RMKS row, the whole remark in a small window on a click (Save, Ctrl+Enter, Esc); ⋯ → Edit remarks… writes the first one. A long value is cut with "…" and shown whole on hover
- ARSPC can be cleared back to undecided; an airspace copied from a mission drawing replaces the drawing on the map
- Map labels appear after login without a reload
- Jurisdiction areas: the airspaces panel shows whose airspace an aircraft is in (the LTAG control zone, the Incirlik RAPCON, the carrier area); off-by-default outlines on the map
- The airspace card lists the flights inside and filed through a restricted, prohibited or warning area or a MOA, with **Approve**
- Transits: **Request transit** through an active MOA, warning or restricted area from the Strip's ⋯ menu; the side that separates its users approves or declines on the airspace card. A grey `COORD` mark shows a flight filed through one that nobody has coordinated
- **Entry block…** in the ⋯ menu sets or lifts an approved entry's altitude block
- The FREQUENCIES panel: set, add and remove your own Facility's station frequencies at run time, including SFA spares
- The topbar clock reads `PAUSED` while the DCS mission is paused; no EFSP time moves until it resumes
- The map works without MapTiler: labels use bundled fonts, the basemap falls back to OpenFreeMap (a grey FALLBACK BASEMAP note), and terrain masking and contours come from DCS itself
- Settings → RADAR → Map: DCS drawings, DCS text marks and Airport surface (aprons, taxiways, runway numbers when zoomed in on a field); Conflict Alert → Show predicted paths
- The airspace editor's Pick DCS drawing list outlines the drawing on the map as you hover it
- The MARSHAL panel: click a holding flight's fuel or EAT to type it; the carrier map draws the marshal stack as its holding pattern, and the approach path and pattern while a recovery is under way
- Every panel scrolls when made small, with thin dark scrollbars
- Click a contact's data block to assign heading, speed or altitude when you own its Strip (Enter sends, Tab moves, Esc closes; TRACK or Shift+click opens the track panel)
- CD can create a departure Strip itself, and **VFR…** (or `.vfr`) makes a VFR departure in one step: a discrete code, a Strip in Cleared with its direction of flight (DIR), and the line to read
- **Transit complete** ends an approved transit by hand; the deciding side sees a grey `transit complete` line until it presses **Acknowledge**
- The PAR panel shows **FIN HDG** (the heading that holds the final course in the wind) beside the aircraft's heading, with a small heading scale on the azimuth scope
- The METRICS panel's Server section shows what crc-sync costs in CPU, memory and event-loop delay over the last minute
- Hover a Strip's coloured left edge to see what it means and what to do
