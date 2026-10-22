### Changed: FAA vocabulary (read this first)
- Positions are renamed after the FAA's operating-position designators: Tower is now **LC** (Local Control), Ground is **GC** (Ground Control), Approach is **AP**. Their Bays follow (`lc-…`, `gc-…`, `ap-…`). `OPS`, `CD`, `RSU`, `SFA`, `PAR`, `CTR` and the tactical and carrier Positions keep their names
- The FIELD STATE panel is now **RUNWAY STATUS**; the short-term conflict alert tag is now **CA** (Conflict Alert); Block 5's label is **BEACON** (the assigned code); a Strip's Role is now its **strip type**; "FDR" is **flight data**
- Positions are **staffed / unstaffed** (not occupied / unmanned), you **sign on** to them (not hold them), and an unstaffed Position's Strips go to the Position it is **consolidated at** (not its covering Position); a coordination that is waiting is **INITIATED** (not PROPOSED)
- `docs/glossary.md` maps every old word to the new one; the controller's guide and the usage guide use the new words
- The server's EFSP state is reset with this release (no migration): open Strips, the Mutation log and the runway status start empty. Your saved panel layout resets once; panels return to the default positions
- For the server operator: before deploying client and server together, edit `infra/.env` (rename `ASACS_DOMAIN`/`ASACS_URL` to `CRCSYNC_DOMAIN`/`CRCSYNC_URL` if set; the old names are no longer read) and, in the `crc-sync-state` volume, delete `efsp-board.json`, `efsp-mutations.jsonl` and every `efsp-facility-*.json`, and delete `alerting.json` if it still has an `stca` key (the key is `conflictAlert` now; an unknown key stops start-up). A state file with an unknown key or an old shape stops start-up with the file named; delete that file for a clean start

### Changed: after the live test
- Incirlik has no SFA Position any more: AP files a single frequency approach on its SFA Bay's frequency Racks and presses **Hand off to PAR**; the pilot keeps the frequency
- PAR's final line has HDG and ALT, **Begin descent**, **Cleared to land**, **Landed** (hands the Strip to GC) and **Missed approach** (back to AP for another approach); "Landing assured" is gone. Heading is not checked on a final, and altitude only until Begin descent
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
- The airspace card lists the flights inside and filed through a restricted area, MOA, warning area, range or danger area, with **Approve**
- Transits: **Request transit** through an active MOA, warning or restricted area from the Strip's ⋯ menu; the side that separates its users approves or declines on the airspace card. A grey `COORD` mark shows a flight filed through one that nobody has coordinated
- **Entry block…** in the ⋯ menu sets or lifts an approved entry's altitude block
- The FREQUENCIES panel: set, add and remove your own Facility's station frequencies at run time, including SFA spares
- The topbar clock reads `PAUSED` while the DCS mission is paused; no EFSP time moves until it resumes
- The map works without MapTiler: labels use bundled fonts, the basemap falls back to OpenFreeMap (a grey FALLBACK BASEMAP note), and terrain masking and contours come from DCS itself
- Settings → RADAR → Map: DCS drawings, DCS text marks and Airport surface (aprons, taxiways, runway numbers when zoomed in on a field); Conflict Alert → Show predicted paths
- The airspace editor's Pick DCS drawing list outlines the drawing on the map as you hover it
- The MARSHAL panel: click a holding flight's fuel or EAT to type it; the carrier map draws the marshal stack as its holding pattern, and the approach path and pattern while a recovery is under way
- Every panel scrolls when made small, with thin dark scrollbars
