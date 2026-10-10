# Lane CARRIER-MAP (2026-10-10)

Branch `lane/CARRIER-MAP-build`. No ADR (client only; no decision needed one). Briefing: `docs/parallel/next/CARRIER-PANELS.md`
section 4. Rulings: H117, H118, H119, S-ARCH-36, and **H121** (below). Mockup `docs/mockups/carrier-map-panel.html` revision 5.

## H121 (human, 2026-10-10, via the supervisor)

"no full screen is not needed, should just behave similar to the current map display". So: no fullscreen or maximize at all (the
mockup's button and the open question about a double-click-on-tab maximize are dropped). The carrier map is an ordinary dockable
panel that behaves like the radar map: same docking and resizing, the same zoom feel, the same contact look where it applies, within
the approved constraints (fixed on the ship, always north-up, 2.5 to 65 nm).

What is shared with the radar map, and what is not:

- **Shared:** the label text (`track-label.js`, new `sideAltText`, the only place a presented contact becomes text: side number,
  else the contact's usual name, and `altitudeShort` with its source mark); the label size (`scope-constants.js`
  `getTextSizePx`, the scope's 11 px times the controller's scale, so it never changes with zoom); the contacts and their history
  (`picture.js` `getAllTracks`, `history`); the airborne symbol (the radar map's hollow diamond, history dots); the wheel's feel
  (MapLibre's rate, a zoom level per 450 px of wheel delta, one zoom level = half or double the range); double click zooms in,
  Shift+double click out (MapLibre's defaults); no drag-pan and no rotation (the radar map has rotation off; this one is also fixed on
  the ship).
- **Not shared:** MapLibre itself. A second MapLibre map would need its own style, sprites and glyphs (the glyphs come from MapTiler
  and need the key the harness and an offline client lack), draws in Web Mercator rather than about the ship, and its collision
  placement cannot be told to keep the stack's labels in landing order. The picture is SVG, in the ship's frame, redrawn from the
  same data the radar map reads. Say if the squadron wants the basemap under it; that is the one thing MapLibre would add.

## CV NATOPS citations (NAVAIR 00-80T-105, July 2009; pages as printed)

- **6.2.1** (p. 6-2) port holding: "a left-hand pattern tangent to the BRC or expected BRC with the ship in the 3-o'clock position and a
  maximum diameter of 5 nm"; descent "to arrive at the initial (3 miles astern, 800 feet) wings level, paralleling the BRC"; "A spin
  should normally be initiated at the bow. The spin pattern shall be flown at 1,200 feet within 3 nm of the ship"; "No aircraft shall
  break more than 4 miles ahead of the ship".
- **6.2.4.1, 6.2.4.2** (p. 6-3) the break at 800 ft; "The landing pattern downwind leg is flown at 600 feet, 1 to 1-1/2 nm abeam the
  ship's stern"; the approach turn from the 180 to the angled deck's extended centreline.
- **6.3** (pp. 6-5/6-6) Case II: Case III procedures outside 10 nm, Case I inside with the ship in sight; "If a flight does not have the
  ship in sight at 5 miles, both aircraft shall be vectored into the bolter/waveoff pattern".
- **6.4.8** (p. 6-17) "climb straight ahead on the extended final bearing to 1,200 feet"; "All waveoff/bolter pattern turns shall be
  level"; no instructions by "4 miles or 2 minutes ahead of the ship" -> turn downwind; "commence turn to final at the 4 nm DME or 2
  minutes past abeam position". The turn-in at the assigned approach turn is H118.
- **6.10.3** (p. 6-39) recovery tanking pattern: "a racetrack pattern in the vicinity of the ship ... should not proceed more than 10
  miles ahead of the ship. The downwind leg should be 3 to 5 miles abeam and tanking should be completed prior to reaching a point 6
  miles astern".

## Geometry (`carrier-map-model.js` `GEOMETRY`)

| what | number | source |
|---|---|---|
| bolter upwind before the turn | 4 nm | NATOPS 6.4.8 (the no-instructions turn point) |
| bolter downwind abeam | 2 nm to port | **ours** (the mockup's) |
| bolter turn-in | the flight's approach turn, 4 / 6 / 8 nm; 6 when unassigned | H118; 6 is **ours** (as the MARSHAL picture) |
| port holding | circle 5 nm across, centre 2.5 nm abeam to port | NATOPS 6.2.1 (maximum diameter drawn) |
| initial | 3 nm astern on the BRC | NATOPS 6.2.1 |
| break | 0.4 nm ahead | **ours** (NATOPS: at the bow, never more than 4 nm ahead) |
| landing pattern downwind | 1.25 nm abeam to port | **ours**, inside NATOPS 6.2.4.2's 1 to 1.5 |
| the 180 | 0.6 nm astern | **ours** |
| spin | 3 nm circle round the ship | NATOPS 6.2.1 ("within 3 nm"); the circle is the mockup's |
| tanker racetrack | 10 nm ahead to 6 nm astern, 4 nm abeam on the pattern side, round ends | NATOPS 6.10.3; 4 nm is **ours** (inside 3 to 5) |
| spin vs landing pattern (fallback) | contact within 3.5 nm and at or above 1,000 ft = spin | **ours** (NATOPS: spin 1,200 within 3; break 800; downwind 600) |
| centreline | from 2 nm ahead along the final bearing, astern to the panel's corner, a tick every mile | briefing; 2 nm ahead is the mockup's |
| marshal stack | the radial from the first fix to the highest fix in use (first fix + 1 when nobody holds), a mark per fix in use, `MARSHAL <radial> <first fix>` | server values (ADR 0113/0114), label the mockup's |
| rings | spacing by range (<=5: 1, <=15: 2.5, <=40: 5, else 10) or the controller's; out to the corners; 10 nm ring `#2f8a45` always | mockup / briefing |

All bearings are true (the map is true north up); a bearing whose `ref` is not `TRUE` (a GRID heading) is not drawn and the header
says so in amber, as the radar map's final-bearing line refuses it.

## The "occupied" rule (`carrier-map-model.js` `occupancy`)

Strip state first, from the recovery board's rows (`marshal-board-model.js` `buildBoard`, one live carrier Strip per flight):

1. A FINAL Strip in **BOLTER_WAVEOFF** -> the Case III bolter/waveoff racetrack, one per distinct assigned approach turn among the
   flights in it (4, 6, 8; 6 when unassigned). Any Case (NATOPS 6.3 sends Case II flights without the ship at 5 miles into it).
2. A MARSHAL Strip **IN_STACK** while the Case is **I or II** -> port holding. In Case II/III the marshal radial and stack fixes are
   drawn as well (the mockup's), in Case I they are not (the server derives no DME then).
3. A PATTERN Strip **IN_PATTERN** at the carrier -> the break and landing pattern with the initial; **geometry only here**, because the
   Strip state is the same in the break, the downwind and the spin: if that flight's contact is within 3.5 nm and at or above
   1,000 ft, the spin circle instead. No contact -> the landing pattern.
4. The tanker's racetrack while the carrier state says the tanker is **on station** (`state.tanker.onStation`).

Nothing else draws a pattern: an uncorrelated contact flying a pattern shape draws nothing (it is not in the recovery as far as the
Board knows). A pattern goes the moment its last Strip leaves the state (dropped, trapped, back on final, back to stack).

## Defaults taken (P2)

1. **No fullscreen** (H121; first raised as a gap: the app has no panel maximize).
2. SVG rather than a second MapLibre map (above). The radar map's sweep fade is not copied: contacts are drawn from what the server
   last delivered (`getAllTracks`), as the MARSHAL panel measures DME.
3. The range is a setting (`carrierMapRangeNm`, 2.5-65, default 30) so the wheel's last zoom is kept per controller; it also shows in
   the tab. Ring spacing `carrierMapRingSpacing`: `by range` (default), 1, 2.5, 5, 10 nm. Settings tab `Carrier map`.
4. All AIR contacts are drawn, not only the recovery: the side number when the contact is correlated to a flight with one, else the
   radar map's name. Colour: grey; amber/red only from fuel against bingo with the MARSHAL panel's margin setting
   (`marshalLowStateMarginKlb`, `fuelLevel`), for any flight with both typed.
5. The tanker is the contact correlated to a live Strip whose flight carries the tanker's side number (`state.tanker.sideNumber`);
   its label is `side alt` with `TKR` under it (the mockup's two lines), whether or not on station. No give on the map.
6. Declutter: problems first (red, amber), then the tanker, then nearest the ship; each label tries its own place, the other three
   corners, then steps up and down; labels keep clear of the ship, every symbol and the stack's name; a moved label gets a leader.
7. The header: hull, Case, BRC, FB (magnetic, as everywhere), range; an amber note only for "ship track lost — last known values",
   the server's final-bearing problem, or a non-true bearing. A hull not found empties the panel with the server's reason.
8. A redraw once a second while the panel is open (a setting another panel owns changes no frame), plus on every carrier, Board and
   scope change (scope at most four times a second); a redraw that changes nothing is a signature compare.
9. `buildBoard` now takes only CARRIER Strips: a PATTERN Strip at Incirlik (its TWR's type) was listed on the MARSHAL board and would
   have drawn the carrier's landing pattern.

## Usage-guide wording (docs/efsp-usage-guide.md, section 4.1)

- "The **CARRIER MAP** panel is a radar picture fixed on the ship, north up. The wheel zooms (2.5 to 65 nm, a double click zooms in,
  Shift and double click out); the ship stays in the middle. Range rings are dark green, the 10 nm ring is always drawn; the ring
  spacing is in Settings, Carrier map."
- "The extended centreline runs astern along the final bearing with a tick every mile. In Case II and III the marshal radial and the
  fixes in use are drawn. Aircraft are labelled by side number and altitude in hundreds of feet; amber is fuel within the margin of
  bingo and red at or below it (Settings, Marshal). The recovery tanker is labelled TKR."
- "A pattern is drawn only while someone is in it, from the Strips: the bolter racetrack (turning in at each flight's approach turn)
  while a FINAL Strip is BOLTER/WAVEOFF; port holding while a flight holds in Case I or II; the break and landing pattern with the
  initial while a flight is in the pattern, or the spin circle when its contact is close to the ship at spin altitude; the tanker's
  racetrack while the tanker is on station."

## Walks

Done, as Playwright tests (`e2e/carrier-map.spec.js`, lane 3) and unit tests (`tests/carrier-map-model.test.mjs`):
- **Case change mid-recovery:** a holding flight in Case III (stack drawn, no port holding) -> Case I: port holding, the stack gone ->
  Commence: PATTERN, landing pattern and initial -> its contact at spin altitude near the ship: spin -> back low on the downwind:
  landing pattern -> trapped: nothing.
- **Final bearing overridden:** the centreline follows the new bearing (spec 06; unit test on the model).
- **Tanker going off station:** racetrack on, then off; the contact keeps `TKR`.
- **Bolters with a 4 nm and an 8 nm turn:** two racetracks, one per turn; the 8 nm one goes when its flight is back on final, the
  other when trapped.
- **A hull lost from DCS:** stale -> amber "ship track lost"; not found -> the panel empties with "hull not found"; found again ->
  the picture comes back.

Not done:
- A real DCS ship and real radar contacts: the harness has none, so the spec puts a ship under every carrier frame (an EFSP message
  observer) and places contacts and correlations in the client. The radar map's contact/label code paths are reused, not re-tested.
- Two bolters with the same turn-in on top of each other (one racetrack, by design).
- Case II with holding flights draws both the stack and port holding; whether Case II should show only one is for the squadron.

## Findings

- The MARSHAL board listed any PATTERN Strip, including Incirlik's (`buildBoard` had no Facility filter). Fixed here (default 9),
  with a test.
- The harness can never show the map (no ship): any future carrier spec needs the same ship injection; the observer in
  `e2e/carrier-map.spec.js` `mapPage` is the pattern to copy.
- A snapshot or store resync replaces correlations without a delta (`_replaceCorrelations`); a spec that injects correlations must
  keep re-applying them (the spec does, every 100 ms).
- For the supervisor / human (not this lane's): the MARSHAL panel's "changed, not yet passed" marks live only in one controller's
  window (MARSHAL-BOARD default 9): a reload clears them silently and two Marshal controllers do not share them. Raised by the user
  during this lane; decide whether they should be stored on the server and shared.

## Gates

crc-desktop unit 1224 -> 1238 (new `carrier-map-model.test.mjs`, one `track-label` test); crc-sync 2597 (unchanged, no crc-sync
file touched, so no freeze / walk / soak:selfcheck / wire:record). Module-graph fixture re-recorded (new modules
`carrier-map-model.js`, `carrier-map-panel.js`; new export `sideAltText`); no-cycle, no-window-globals, html-sinks green. Playwright
on `E2E_LANE=3`: `carrier-map.spec.js` 6/6 (three runs), `marshal-board.spec.js` 6/6 (its model gained the Facility filter).
