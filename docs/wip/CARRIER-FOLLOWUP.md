# Lane CARRIER-FOLLOWUP (2026-10-11)

Branch `lane/CARRIER-FOLLOWUP`, from `efsp-wp5-correlation` at 0fe5bfe3. ADR **0116** (the PAR is an airfield feature). Rulings:
H124 (2), S-ARCH-44 (finding), **H125** and **H126** (both arrived mid-lane via the supervisor).

## Scope as it ended up

| Item | Briefing | What happened |
|---|---|---|
| 1 | PAR course = the carrier's final bearing in force (H124 (1)) | **Dropped** (human: "PAR is an airfield feature, not a carrier feature"). Nothing built or committed for it; no revert needed. |
| 2 | Side number leads in every carrier view (H124 (2)) | Built (below). The PAR panel's carrier naming went with item 4. |
| 3 | Fresh ship position on the client (S-ARCH-44 finding) | Built: the banner republishes after 0.05 NM moved. |
| 4 | (H125) Take the carrier out of the PAR | Built; ADR 0116. |
| 5 | (H125) Carrier DIST Block = range to the ship for every carrier Position, from the live ship | Built. |
| H126 | Carrier FINAL Bay line has no range; the PAR panel stays a tab in the left group by default | Line has no range. PAR panel placement unchanged (no code change needed). |

## Item 3: a fresh ship position

`shipStateChanged` (`crc-sync/src/efsp/carrier/ship-state.js`) gains `positionStepNm` (default **0.05 NM**, ~93 m): the banner is
republished once the ship is that far from where it was last published (a position appearing or vanishing is a change too).
`CarrierStore#setShipState` keeps the last published state, so the step is measured from what clients hold.

Why this and not the alternatives:
- **Republish on a distance step (chosen).** One existing frame (`efsp-carrier-delta`), no wire change, no client change, and the
  rate follows the ship: ~every 6 s at 30 kt, ~12 s at 15 kt, never at anchor. Error bound 0.05 NM, half the DIST Block's 0.1 NM
  display step. Cost: the carrier view (one hull, its stack) every few seconds against a track delta every 500 ms.
- Ship position on the 500 ms track `delta`: a new field on a per-contact frame for every session, a wire change, and plumbing in
  the hub for something a carrier controller reads.
- Client measures from the ship's radar contact: not every carrier session has the ship in its picture, and the ADR 0059 rule is
  that the client is told what its sensors know, so the banner (the carrier's own data) is the right source.

Freeze goldens are unaffected by the step (no freeze scenario moves the ship); soak:selfcheck PASS.

## Item 4: the PAR is airfield-only (ADR 0116)

Server: `ParMonitor` samples only final Bays of a Facility with `runwayStatus` (an airfield); its carrier geometry, its
`carrierStore` / `tracks` / `ownCoalition` / `convergenceAt` dependencies and `CARRIER_FACILITY` are gone. `par.js` loses
`carrierTouchdown`, `validateHullApproach`, `HULL_APPROACH_KEYS`; `APPROACH_KEYS` loses `kind` and `hullId`; `INOP_REASONS` is
`NO_APPROACH`, `NO_TDZE`. The hull config (`config/efsp-carriers.json`) loses `approach` and `validateHullConfig` no longer
requires it, so a `state/efsp-carriers.json` without it starts again (PAR-1's open point (c)).

Client: the PAR panel names the flight by its callsign, its header is the runway's, its terminals are Landing assured / Missed
approach (`par-model.js`: `PAR_TERMINALS` is now one list, `parTerminals()`, `parTerminalOp()`; `flightName` removed). The carrier's
Ball / Waveoff moved to `bay-views.js` (`finalTerminalsFor(kind)`, `finalTerminalOp(kind, t)`, ops unchanged: Ball =
`CarrierHandoff FINAL_TO_LSO`, Waveoff = `SetState BOLTER_WAVEOFF`).

Carrier FINAL Bay line (`bay-views.js finalRowModel` / `_renderFinal`, CARRIER Bays): the side number leads (callsign until one is
typed), **no range** (H126), the name is a plain label (no PAR panel to open), Ball / Waveoff.

## Item 5: the carrier DIST Block (C17)

`carrier-final-distance.js`: `carrierDistanceNm(strip)` is the great-circle range from the banner's ship position to the flight's
correlated contact when the Strip is owned by a CARRIER Position (PriFly, the Marshal, the lanes: whoever can see the Strip sees
the same figure), and the PAR's range to the threshold otherwise (Incirlik's PAR FINAL Strip shares the FINAL Block Map). The
MARSHAL board's DME reads the same function. Because a Bay redraws only on a Board change, `bay-views.js refreshDistBlocks()`
rewrites every on-screen `.efsp-block-C17` in place at most once a second on the `scope` and `par` topics.

## Item 2: every view that names a carrier flight

One helper, `leadingFlightName(strip, flightData)` in `strip-fields.js`: the side number when `sideNumberLeads()` (SIDE-SWAP's
rule: a strip type with C1 and C18, owned by a CARRIER Position, a side number typed), else the callsign.

| View | Before | Now |
|---|---|---|
| PriFly pattern-board chip (`pattern-board.js`, `.efsp-pattern-cs`; model from `bay-views.js patternStripsFor`) | callsign | side number leads; the callsign moves to the chip's meta line (`aka`) while the side number leads; the "N min in pattern" advisory uses the same name. Chip field renamed `callsign` -> `name` (+ `aka`). RSU's chips unchanged. |
| Carrier FINAL Bay line (`bay-views.js`) | side number (PAR-2, via the PAR sample's `approach.kind`) | side number via `leadingFlightName` (no PAR sample needed now) |
| Refusal banner (`panel/refusal.js`) | callsign | side number for a carrier Strip (a refusal names the Strip as its face does) |
| "Arrived from" list (`panel/arrivals.js`) | callsign | side number for a carrier Strip |
| PAR panel (flight row, picks) | side number on a carrier lane | n/a: carrier out of the PAR; callsign (airfield) |

Checked and already leading with the side number (unchanged): the MARSHAL board (`marshal-board-model.js`, `r.side || r.callsign`,
marked when missing), the Case III picture (`marshal-picture.js`), the carrier map labels (`sideAltText`), the carrier Strips
(SIDE-SWAP). The carrier banner / management panel names no flight (the tanker is by side number already). Not changed (not carrier
views, or keyed on data rather than shown): MARSA/formation popovers, coordination exchanges, filed-plan cards, the duplicate-
callsign check, the radar map's own labels.

## Defaults taken (P2)

1. **0.05 NM** position step for the banner (above). `[SOURCE-DEFINED]`, ours.
2. **"Airfield" = a Facility with `runwayStatus`** for the PAR monitor (the carrier Facility has none). A future airfield with
   final Bays and no `parApproaches` still gets `NO_APPROACH` samples, as before.
3. **A hull config that still carries `approach` starts** (the hull config never refused unknown keys; not tightened here). The
   squadron should delete it from any `state/efsp-carriers.json`.
4. **The pattern chip shows the callsign on its meta line while the side number leads**, so PriFly can still match a radio
   callsign; dark cockpit: no colour, no new element.
5. **DIST on a carrier Strip measures to the ship's DCS position** (the banner), not a touchdown point: the touchdown geometry went
   with the PAR. Ship centre to contact, as before PAR-1.
6. **DIST refresh in place, 1 Hz, on `scope` and `par`**, instead of re-rendering Bays on every sweep.
7. **The carrier FINAL line's name is a label** (no button): nothing to open on the carrier.
8. The `ws-hub-par-sample` delivery test still routes hand-made samples tagged CARRIER positions; it tests routing by Position
   only and was left as is.

## Usage-guide wording (for `docs/efsp-usage-guide.md`)

- Carrier final: "There is no PAR on the carrier. The approach controller works the final from the FINAL Bay's flight line (the
  side number, Ball and Waveoff) and the CARRIER MAP. The FINAL Strip's DIST is the range from the ship to the aircraft."
- DIST: "On every carrier Strip that carries DIST, every carrier Position (PriFly, the Marshal, the approach lanes) sees the range
  from the ship to the aircraft, updated as both move. At Incirlik, PAR's FINAL Strip shows the PAR's range to the threshold."
- PriFly: "The pattern board names each aircraft by its side number once the Marshal has typed it, with the callsign beside it;
  until then by its callsign." Same sentence for the refusal banner and the arrivals line: "a carrier aircraft is named by its side
  number wherever the app names it."
- PAR section: drop every carrier sentence from PAR-1's / PAR-2's wording ("on the carrier, from the touchdown point...", "on the
  carrier: Ball and Waveoff", "on the carrier its side number"). The PAR panel is Incirlik's.
- PAR-1's carrier `approach` placeholder sentence ("the carrier's touchdown point ... `config/efsp-carriers.json`") goes.

## Walks

Done:
- **A flight with no side number yet**: the FINAL line and the pattern chip show the callsign (unit `efsp-bay-views`,
  `efsp-strip-fields`; e2e `side-swap` 02 chip without a side number).
- **A side number typed**: chip, FINAL line, Strip all lead with it (e2e `side-swap` 01, 02).
- **The ship moving / turning**: the banner republishes after 0.05 NM (unit); the DIST Block follows the ship 4.0 -> 3.0 NM with no
  Board change (e2e `carrier-map` 07); the map is centred on the banner position (carrier-map 01-06, already).
- **A carrier lane on final**: no `par-sample` frame for 1.5 s (three hub ticks), the client holds none, the FINAL line has the side
  number, no range, no PAR link, Ball / Waveoff; Waveoff from the line moves the Strip to BOLTER_WAVEOFF (e2e `par-panel` 07).
- **Carrier FINAL Strip at the monitor**: no sample from either carrier final Bay while Incirlik's PAR is still sampled (unit).
- **DIST for PriFly, the Marshal and the lane**: the same figure whoever owns the Strip; a stale PAR sample would not change it;
  no contact -> blank (unit `par-samples`).

Not walked: the FB override items (item 1 dropped); a live DCS ship (harness has none: ship injected in the spec); a second
session signed on only as PriFly looking at the FINAL Strip's DIST (covered by the owner-agnostic unit test, not e2e).

## Findings

1. **Item 1's question is moot** and nothing in ADR 0113 changes: the final bearing in force still drives the carrier map's
   centreline and the Strips' derived Blocks.
2. `docs/efsp-briefing.md` and the usage guide still describe the carrier in the PAR (PAR-1/PAR-2 wording): shared docs, not edited.
3. The `wire:record` scan of carrier view keys did not change (hull contents are not scanned, PAR-1 finding 4); the hull view
   simply no longer carries `approach`.
4. A Bay redraws only on Board topics; anything that shows a moving figure on a Strip needs an in-place refresh like
   `refreshDistBlocks` (PAR-2 finding 2 is the same lesson).

## Gates

| Gate | Before | After |
|---|---|---|
| crc-sync `npm test` | 2643 | 2640 (all pass: −4 carrier PAR tests, −1 carrier touchdown test, +1 no-carrier-sample test, +1 position-step test) |
| crc-desktop `npm test` | 1253 | 1254 (all pass: −2 PAR carrier name/terminal tests folded into bay-views, +1 leadingFlightName, +1 carrier DIST) |
| `npm run freeze` | 56/56 | 56/56 after one `freeze:update` (23 files, hash-only: the hull row without `approach`; separate commit) |
| `npm run walk` | | 23/23 |
| `npm run soak:selfcheck` | | PASS |
| `npm run wire:record` | | "WIRE_PROTOCOL stays 2 (last release speaks 1, already ahead of it); surface recorded." Diff: `approach` loses `kind`, `hullId`; INOP reasons lose `NO_SHIP`, `NO_COURSE` |
| module-graph fixture | | re-recorded: `bay-views.js` +`finalTerminalOp`, `finalTerminalsFor`, `refreshDistBlocks`; `carrier-final-distance.js` +`shipDistanceNm`; `par-model.js` −`flightName`, `terminalOp`, `terminalsFor`, +`parTerminalOp`, `parTerminals`; `strip-fields.js` +`leadingFlightName` |
| no-cycle / no-window-globals / html-sinks | | green (in `npm test`) |
| Playwright (E2E_LANE=3, each file alone) | | `par-panel` 7/7, `l17-carrier` 6/6, `carrier-map` 7/7 (new 07), `marshal-board` 7/7, `side-swap` 2/2, `l18-incirlik` 3/3 |
