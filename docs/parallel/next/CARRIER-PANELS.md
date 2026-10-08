# Briefing: the carrier and PAR panels (build lanes)

Written 2026-10-08 by the supervisor after the human approved the designs. **One agent at a time (H112)**: run these lanes
in the order below, each in its own worktree per `docs/parallel/lane-rules.md`, Sonnet for code (Opus only if a lane is
mostly design). Every lane runs **both unit suites**, commits at every green step, and follows the **dark-cockpit rule**
(memory `feedback_dark_cockpit_ui`, decisions H115–H119): grey unless something is a problem (amber = needs attention,
orange-red = something failed, red = past a limit), show only what the controller needs, never tell them their job,
panels are ordinary dockable panels, app-wide font only (Consolas stack), tokens from `crc-desktop/app/public/css/efsp-panel.css`.

## Sources of truth, in order

1. `docs/parallel/decisions.md` **H112–H119** (the human's words; they win).
2. The approved mockups in `docs/mockups/` (published at https://claude.ai/artifact/EA92HZDXSC7cmDHdAMmx7X):
   `par-panel.html` (revision 4), `marshal-stack-panel.html` (revision 7), `carrier-map-panel.html` (revision 5). They are
   interactive; open them in a browser. Their sample data is invented.
3. `docs/wip/PANELS-DESIGN.md`: the research (cited) and the data gaps. **Its panel designs are superseded** by the
   mockups and H115–H119; its findings about existing code still hold (FINAL measures range from the approach radar's site,
   not the threshold, `bay-views.js:204`, `radars.js:172`; the wire altitude is rounded to 100 ft; push time is never
   stored, so `SetCharlieTime` rewrites pushed flights; `marshalMessage()` is built but never sent).
4. CV NATOPS (NAVAIR 00-80T-105, 2009, https://info.publicintelligence.net/CV-NATOPS-JUL09.pdf): 6.2 Case I, 6.3 Case II,
   6.4 Case III (6.4.9 Delta, verified), 6.10.3 recovery tanker pattern; glossary: ramp time, EAT, Charlie.
5. FAA JO 7110.65 5-10, 5-12 (PAR); AIM 4-5-4.

ADR numbers reserved: **0111** Divert (separate briefing `DIVERT.md`), **0112** PAR sample and approach geometry,
**0113** carrier state and its overrides (incl. Charlie/EAT per NATOPS), **0114** marshal board ops.

## Order

| # | Lane | Size | Depends on |
|---|---|---|---|
| 1 | SETTINGS-TABS | S | — |
| 2 | CARRIER-STATE | M | — (wire change) |
| 3 | MARSHAL-BOARD | M–L | CARRIER-STATE (wire change) |
| 4 | CARRIER-MAP | M | CARRIER-STATE, MARSHAL-BOARD |
| 5 | PAR-1 (server) | M | — (wire change) |
| 6 | PAR-2 (client) | M | PAR-1, SETTINGS-TABS |

DIVERT (`DIVERT.md`) can go anywhere in this queue; the supervisor's recommendation is right after SETTINGS-TABS, since
it closes a functional gap the human hit live.

## 1. SETTINGS-TABS (client, S)

The Settings panel becomes tabbed, one tab per panel (General, EFSP, Radar, PAR, Marshal, Carrier map, SRS, …; sketch in
both mockups). Per-controller values, persisted where the existing settings persist. Move today's settings into General /
the panel they belong to. Provide a tiny API so a panel lane registers its tab and fields (`registerSettingsTab(id, fields)`)
instead of editing the Settings panel. Tests: tab registration, persistence round-trip, a spec opening each tab.
No server change.

## 2. CARRIER-STATE (server + client panel, M) — ADR 0113

The **carrier management panel** (`carrier-map-panel.html`, right/below the map). One server-side carrier state per hull,
each value with a **source** and an optional **override**:

- BRC (default: the ship's heading from DCS), final bearing (default BRC − angled-deck offset), Case (I/II/III),
  **ramp time** (Charlie), marshal radial (default final bearing + 180) and first fix (default 21 DME),
  weather at the ship (ceiling, visibility, wind over deck, altimeter; defaults from DCS, wind over deck = wind + ship speed),
  recovery tanker (side number, altitude, give, pattern side, on station yes/no).
- Typing overrides; "Use DCS" / "Use default" removes the override. Every change is an audited Mutation.
- **Who edits:** default taken H119: CV_PRIFLY and CV_MARSHAL; the other carrier Positions read it. Everyone else only reads
  (the recovery board shows the marshal position read-only).
- **Charlie and EAT follow CV NATOPS (H118):** the ramp time is when the first aircraft is expected at the ramp; an EAT is
  the time a holding aircraft leaves its fix inbound; push times are worked back from the ramp time with one-minute
  spacing. This replaces ADR 0064's EAT = Charlie + slot. Write the derivation down in ADR 0113 with the NATOPS text and
  the approach-time assumption it needs (time from fix to ramp at the 250 kt / 4,000 fpm then 1,200 ft profile), as a
  tuning value.
- Absorb what exists: PriFly's Case, `SetMarshalRadial`, `SetCharlieTime`, `hull-config.js`, the ship banner. No backwards
  compatibility.
- Wire change: run `npm run wire:record`. Freeze goldens move: `freeze:update` once, small diff, separate commit.

## 3. MARSHAL-BOARD (server + client, M–L) — ADR 0114

The **recovery board** (`marshal-stack-panel.html` revision 7). Server half:

- **Side numbers** identify carrier aircraft everywhere in the carrier regime (H117): the Strip's side number (modex) is
  shown, not the callsign. Find where the modex lives (flight data / ATO / typed Block) or add a Block for it.
- Store `pushedAt` when a flight commences (mission clock) so later ramp-time changes never rewrite it.
- **Delta** op (CV NATOPS 6.4.9): N minutes, even, never less than four; moves the EATs of holding flights only; new EATs are
  issued top of the stack down.
- **Back to stack** op (H117): a commenced flight returns to marshal at the next free slot at the top.
- Status values for the board: HOLD, COMM, APP A / APP B (lane), BOLTER, and what the approach lanes already know
  (lane assignment in the view, `marshalMessage()` actually sent if the board needs it).
- Low state: fuel within the margin of bingo (margin a per-controller setting, default 1.0 k lb) is computed client-side
  from the typed fuel and bingo Blocks; nothing server-side unless a lane finds a reason.

Client half: a new `marshal` panel. Landing order (next to land at the top): SEQ, SIDE, TYPE, FUEL:EAT (fuel in k lb, EAT
minute), ANG (holding angels; no DME column, it is angels + 15), STATUS. Drag a HOLD row to re-sequence (one existing stack
op); changed angels/EAT shown amber until the row is clicked (passed); Commence (the one blue button) on the next flight to
push; Back to stack on commenced rows; Delta…; ramp time shown; header with Case, approach, BRC, FB, marshal position
(radial + DME range, read-only), clock; TO GO at the foot. The Case III picture beside the table: ship at top, final bearing
0–12 nm to scale with DME marks, compressed out to the marshal fixes, the stack along the radial from 21 DME with each fix at
angels + 15 and the racetrack's outbound leg on the hot side, aircraft by DME labelled side + lane + fuel, the bolter
racetrack with the **turn-in at each flight's assigned approach turn (4/6/8 nm, H118)**, no milestone labels. Remove the
`cv-marshal-stack` Bay's ordering and slot board (`carrierOrderRack`); the Bay keeps the Strips. Marshal settings tab:
low-state margin, mark changed clearances. Specs: the situations in the mockup (normal, low state, past EAT, Delta, bolter,
back to stack, foul deck if deck state exists — it does not yet; leave it out unless the lane builds deck state).

## 4. CARRIER-MAP (client, M; server only if a gap appears)

The **carrier map** panel (`carrier-map-panel.html` revision 5):

- Fixed on the ship, **always north-up** (H119, no option). Zoom 2.5–65 nm (range = radius of the shorter side); the map
  fills the panel and **rings continue to the corners**. Rings dark green (`#1f5a2e`, the 10 nm ring `#2f8a45` and always
  drawn, labels `#3f9a55`); ring spacing in the map's settings tab.
- Extended centreline astern along the final bearing to the edge, a tick every mile.
- Final bearing; the marshal radial and stack fixes (from CARRIER-STATE); aircraft by side number and altitude (hundreds of
  feet), grey, amber low state, red at bingo; the tanker labelled "side alt TKR" (no give on the map).
- **Patterns only while occupied (human, 2026-10-08):** Case III bolter/waveoff racetrack; Case I/II port holding, the
  break/landing pattern with the INITIAL point, the spin circle; the tanker racetrack only while the tanker is on station.
  No altitude/distance labels on them. Decide "occupied" from Strip state first (carrier Strip types and the board's
  status), geometry only as a fallback; write the rule in the lane note.
- Label text at a fixed pixel size (the mockup scales it; the panel must not). Declutter at the stack when labels overlap.
- Fullscreen like any panel (the app's own mechanism, not the mockup's button).

## 5. PAR-1 (server, M) — ADR 0112

- Approach geometry per runway end / carrier lane: threshold position, final approach course, **glideslope default 3.06°**
  (an approach's published angle wins), TCH, decision altitude; in facility config, `[SOURCE-DEFINED]` until someone copies
  the real plate. Carrier lanes: moving touchdown from the hull config, 3.5° (to confirm).
- A `surveillance/par.js` sample per aircraft on final: range to threshold, height above TDZE (exact, not the 100 ft wire
  value), elevation and azimuth deviation in degrees and feet, ground speed, vertical speed, at ≤ 1 s, sent only to the
  signed-on PAR / approach-lane Position (`efsp-par-sample` or a field on an existing frame; the lane decides, ADR says why).
- Fix the FINAL range bug (measure to the threshold, not the radar site).
- Wire change: `wire:record`.

## 6. PAR-2 (client, M)

The **PAR panel** (`par-panel.html` revision 4, H115/H116): a normal panel. Approach header; flight row (side number on a
carrier lane, callsign at Incirlik), GS, VS (no "need" value); range to TD; elevation and azimuth scopes against range from
touchdown, **TD fixed in the bottom-left corner** (azimuth: left edge), wheel = range for both, Shift+wheel = this scope's
vertical, **no pan**; **autoscale** (settings switch): the track at the golden-ratio point until the window is 10 NM, a manual
zoom pauses it, double-click resumes; track style **E** (magenta diamond `#e58bff`, dark halo, magenta trail), reference lines
dimmed; tolerance **±1° elevation and azimuth** (settings), red outside, **nothing coloured below DA** and the dashed
tolerance lines start at DA; amber only for no plot for 3 s; EL/AZ INOP blanks that scope in orange-red; Landing assured /
Missed approach as plain buttons. PAR settings tab: autoscale, default glideslope, both tolerances. Replaces the FINAL Bay
view's rendering (`final-panel.js`); the terminal buttons' ops stay.

## Gates (every lane)

Both unit suites; crc-sync `npm run freeze` / `walk` / `soak:selfcheck` when Board, wire, sync or hub files moved;
`wire:record` on any wire change (protocol 2 locally; the last release speaks 1); the module-graph fixture and the
no-cycle / no-window-globals / html-sinks tests stay green; Playwright only for the specs the lane touched, on its own
`E2E_LANE`, never the full suite (the supervisor runs it after the merge). Report per lane-rules rule 8, including the
wording the usage guide should get.
