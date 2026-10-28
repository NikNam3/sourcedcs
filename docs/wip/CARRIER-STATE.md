# Lane CARRIER-STATE (2026-10-08)

Branch `lane/CARRIER-STATE-build`. ADR **0113**. Briefing: `docs/parallel/next/CARRIER-PANELS.md` section 2. Rulings: H118, H119.
What was built: one server-side carrier state per hull, every value with a source (`dcs` / `default` / `override` / `none`) and an
optional override; one op `SetCarrierState { field, value }` (null clears); PriFly and the Marshal edit, the lanes read; every
change an audited Mutation; Charlie / EAT per CV NATOPS (EAT worked back from the ramp time); the carrier management panel as
an ordinary dockable panel. ADR 0113 has the design and the NATOPS text; this note is what the other lanes and the docs need.

## CV NATOPS citations (NAVAIR 00-80T-105, July 2009; page numbers as printed)

All quoted in ADR 0113. Used for: glossary "ramp time", "expected approach time", "CHARLIE", "BRC" (the ship's magnetic heading),
"final bearing" (magnetic, an extension of the landing area centreline), "platform", "six nautical miles DME fix"; 6.4.1.1 (marshal
fix = 180 from the final bearing, angels + 15, base 6,000 ft: p. 6-6); 6.4.4 and 6.4.5 (depart marshal at the EAT, one minute
apart: p. 6-8); 6.4.7.2 (250 KIAS, 4,000 fpm to the platform, 2,000 fpm to 10 DME, configuration at 8 nm: p. 6-9); 6.4.2 (marshal
instructions: p. 6-7); 6.2 (Case I check-in: expected Charlie time); the air officer provides CATCC the ramp time for Case III
(p. 6-21); 6.10.3 (tanker pattern: p. 6-39). 6.4.9 Delta is MARSHAL-BOARD's.

## Tuning values (`crc-sync/config/efsp-carrier-recovery.json`, a new tuning file; `state/efsp-carrier-recovery.json` overrides key by key)

| key | value | source |
|---|---|---|
| `firstFixDme` | 21 | NATOPS 6.4.1.1: base 6,000 ft, angels + 15 |
| `pushSpacingSec` | 60 | NATOPS 6.4.5 |
| `fixToRampSec` | 360 | **ours** (derivation in ADR 0113: 13 nm at 250 kt, 8 nm at an assumed 150 kt average, 6.3 min taken as 6) |
| `tanker.altitudeFt` | 6000 | **ours** (NATOPS 6.10.3 sets none) |
| `tanker.patternSide` | port | **ours** |

Not tuning (code constants, ours, sanity bounds): the ranges `validateField` accepts (`carrier/carrier-state.js` `FIELDS`):
first fix 10-40, ceiling 0-60,000 ft, visibility 0-99 nm, wind over deck 0-99 kt, altimeter 27.00-32.00 inHg (the banner's old
band), tanker altitude 500-40,000 ft, give 0-99 k lb, side number 1-8 letters or digits. `DECK_HEIGHT_M` 20 m for the wind
query, `REFRESH_MS` 60 s (the airports' period).

## Defaults taken (P2)

1. **Ceiling and visibility have no DCS source** (DCS-gRPC's atmosphere service gives wind, temperature, pressure only). They
   start `none` ("not known") until typed. The briefing said "defaults from DCS"; there is none to take.
2. Wind over deck default = DCS wind at the ship (a `GetWind` at 20 m via `getAptWeather`) as a vector, minus the ship's
   vector; whole knots. The briefing's "wind + ship speed" is this, exactly for a head wind.
3. Altimeter default = the theater pressure (as the banner's was); the typed altimeter moved from the banner's `inputs` to the
   overrides, and the banner (`ShipState`) now holds only what the game says.
4. Ramp time has no default (`none`); clearing it is "Clear". Case default III (ADR 0064's), clearing it is "Use default".
5. The first fix is overridable and moves every slot's DME (`marshalDme = firstFix + slot`); angels stay 6 + slot. The
   consistency check now compares `DME - angels` with `firstFix - 6`.
6. One `fixToRamp` for every slot (not per DME): the slots' fixes differ by a mile (a quarter minute at 250 kt), inside the
   10 s push window's order of magnitude. Revisit if the squadron measures otherwise.
7. `SetCarrierState` carries no base revision from the client; the field is last-writer-wins and both writes are audited. A
   same-value write is `ok` with `unchanged: true` and burns no revision (the Case is the exception: same Case is refused as
   before).
8. The carrier panel has **no per-controller settings**, so no settings tab was registered (`registerSettingsTab` not used).
9. Panel placement: a `carrier` dock panel in the left cluster like the others (`PANEL_TITLES.carrier` = `CARRIER`, a row in the
   Panels list). The banner in the Strip panel stays (read-only now); the Strip panel's stack board stays too, with `RAMP` and
   `RADIAL` read-only in its header, until MARSHAL-BOARD replaces it.
10. The `pushTimeUtc` wire name is kept and now means the EAT; `rampEtaUtc` is new beside it.
11. Unit label texts ("ours; CV NATOPS sets none" on the tanker altitude, "III unless set" on the Case) are static text in the
    panel, not tooltips.

## Wire / state change, and what the supervisor must do at merge

- The hull view changed shape (`state`, `overrides`, `tuning`; `stacks.MAIN` lost `charlieTimeUtc` and `marshalRadialDeg`;
  the record lost `shipInputs`; the op kinds changed). `npm run wire:record` reports **no surface change** (the scan does not see
  op kinds inside the carrier store) and `WIRE_PROTOCOL` stays 2, already ahead of the last release (1), so this ships with the
  others. If the supervisor wants a bump for the meaning change: `npm run wire:record -- --bump` will not (it never bumps twice
  between releases).
- **`state/efsp-board.json` of any running crc-sync has the old carrier shape and will stop start-up on the next start**, naming
  `carriers[].shipInputs` (H88, no migration; tested in `efsp-restore-refusal.test.mjs`). The fix is the one the error says:
  delete `state/efsp-board.json` and `state/efsp-mutations.jsonl`. That loses the whole Board, not just the carrier; if that is not
  wanted before the deploy, the carrier slice can be hand-edited (remove `shipInputs`, `charlieTimeUtc`, `marshalRadialDeg`).
  **Decision for the supervisor / human**: the live :3000 and the production volume.
- A new shipped file `config/efsp-carrier-recovery.json` (baked into the image like the others; `tools/soak/host-client.js` and
  `tuning-defaults.test.mjs` know it).

## Usage-guide wording (for `docs/efsp-usage-guide.md`, §4.1 carrier and the Marshal)

- "The **carrier panel** shows the ship's state: BRC, final bearing, Case, ramp time, the marshal radial and first fix, the
  weather at the ship, and the recovery tanker. Beside each value it says where it comes from: DCS, default, set, or not known.
  CV_PRIFLY and CV_MARSHAL type over a value (Enter sets it, Esc puts it back); **Use DCS** or **Use default** beside a value
  that was typed puts the automatic value back, and an empty field and Enter does the same. Everyone else at the carrier sees the
  values and cannot change them."
- "Bearings are typed magnetic. If the ship cannot be found there is no magnetic variation to convert with, and a typed bearing is
  refused until it can."
- "The **ramp time** is the time the first aircraft of a Case III recovery is expected at the ramp (the Charlie time). The stack's
  push time, the **EAT**, is when an aircraft leaves its marshal fix inbound: it is worked back from the ramp time, one minute
  apart per slot, by the time an aircraft takes from its fix to the ramp (6 minutes unless the squadron changes
  `fixToRampSec`). Changing the ramp time moves every EAT together; nobody changes slots."
- "The Case is set in the carrier panel by PriFly or the Marshal. It is never refused on the weather; the Strip panel's banner
  says when the Case is less restrictive than the weather you typed (or night) allows."
- Replaces the old text about the Case selector and the Charlie / radial fields on the stack board.

## Walks (pilot requests, not just the lifecycle)

Done, as tests in `crc-sync/tests/efsp-carrier-state-store.test.mjs` (and the e2e spec 06):

- **A ramp time changed while flights are in marshal**: every EAT moves by the same amount, the stack record is byte-identical, a
  flight that has pushed keeps its place and status, clearing the ramp time takes the EATs away and invents none.
- **A Case change mid-recovery**: Case I drops DME / EAT / radial from the derived entries, keeps the stack, the ramp time and
  every override; back at the default the derived entries are byte-identical to before; Case II reads like III.
- **An override cleared back to DCS / default**: BRC, first fix, altimeter, tanker side; the DCS value keeps moving under an
  override (a turn changes `default`, not the typed final bearing); clearing what was never set burns no revision.
- **Two editors (PriFly and Marshal) at once**: different fields both land; the same field is last-writer-wins, both audited; a
  stale base revision is `STALE_REV`.
- Authority: lanes and other Positions refused (`PERMISSION_DENIED`), each refusal audited with the field.
- Restart: overrides, the Case, the ramp time survive; an out-of-range stored value is dropped, not refused.
- Mission reset: overrides and the Case clear (ADR 0108), the stack stays empty.

Not done:

- **A flight that has already pushed when the ramp time changes**: its derived EAT moves with the ramp time, because push time is
  still never stored (PANELS-DESIGN finding, still true). The old `SetCharlieTime` had the same flaw. Needs `pushedAt` on the
  stack entry (MARSHAL-BOARD, ADR 0114); the seam is `deriveEntry(entry, inputs)` in `marshal-stack.js`: prefer the entry's own
  `pushedAtUtc` over the derived EAT when `status === 'PUSHED'` and add `pushedAtUtc` to `ENTRY_KEYS` / `normalizeStack`.
- A Case change while a flight is **commenced** (in a lane): the stack entry is PUSHED and a Case I check-in rules apply; not
  walked beyond the NLA re-statement test that already exists (`a Case change re-states every carrier Strip's NLA`).
- The DCS wind with a real DCS: no DCS in the harness; `getAptWeather` was exercised through a fake (`ship-wind` helper test).
  The wind's direction convention is the existing airport weather's (`windFrom`, true).
- The wind cache is not cleared at a mission change; it refreshes within a minute.

## Seams for the later lanes

**MARSHAL-BOARD (ADR 0114).** Read from the hull view (`getEfspCarrier()`): `view.state.{case, rampTime, radial, firstFix, brc,
finalBearing}` (each `{ value, source, override, default }`, bearings with `ref` and `display` magnetic), `view.derived.MAIN[]`
(`stackIndex`, `angels`, `marshalDme`, `pushTimeUtc` = EAT, `rampEtaUtc`, `pushWindowUtc`, `status`), `view.tuning` (`fixToRampMs`,
`pushSpacingMs`), `view.hull.angledDeckDeg`. Header "marshal position, read-only" = `state.radial.display` + `state.firstFix.value`
(already shown that way in the stack board header: `carrier-panel.js` `renderCarrierStackBoard`, remove with the board). Helpers:
`carrierStateOf`, `carrierBannerParts`, `carrierBearingText`, `carrierHhmm` (carrier-state.js); `sendCarrier('sequencesStack', op)`
(carrier-send.js). New stack ops go in `STACK_OP_KINDS` / `_DISPATCH` (marshal-stack.js) and are gated by `canSequenceMarshalStack`
in `CarrierStore._dispatch`; Delta changes EATs, so it needs the stored per-entry EAT above (it cannot be derived from the ramp
time any more). `carrierOrderRack` and `renderCarrierStackBoard` are still in `carrier-panel.js` for it to remove.

**CARRIER-MAP.** Ship position `view.shipState.{lat, lon, found, stale}`; BRC / final bearing / radial in force
`view.state.*.value` with `.ref` ('TRUE' only is safe to draw; the final-bearing line `buildCarrierFinalLine` already refuses
otherwise) and `.display`; the first fix `state.firstFix.value`; angels + 15 per slot from `derived` (DME); tanker
`state.tanker.{sideNumber, altitude, give, patternSide, onStation}` (`onStation.value` is the "occupied" signal for the tanker's
racetrack; patterns' own occupancy is from Strip state, not here). The wind over deck is a speed only; if the map wants its
direction relative to the BRC, `windOverDeckKt` in `carrier/carrier-state.js` already computes the vector, return it beside the
speed. The panel's settings (ring spacing) go in a settings tab via `registerSettingsTab`; this lane registered none.

## Findings for other lanes

- The Strip panel's EAT / PUSH Block (C8) now shows the NATOPS EAT: six minutes earlier than before for the same Charlie input.
  The usage guide must say it (above) or controllers will think it is a bug.
- `marshalMessage()` (flight-record.js) is still built and never sent; it now takes the resolved `state` (altimeter in force and
  the ship's weather) when given one. MARSHAL-BOARD decides whether anything sends it.
- Observed once, not caused by this lane: `l17-carrier.spec.js` test 03 failed a run on `strip(...).scrollIntoViewIfNeeded()`
  ("Element is not attached to the DOM": the Strip re-rendered under the scroll) and passed on rerun. Pre-existing race in the spec,
  not touched.
- The `CarrierStore` constructor now loads the shipped tuning when none is given; any new test host that sets
  `CRCSYNC_CONFIG_DIR` to a copy of `config/` must copy `efsp-carrier-recovery.json` too (the soak host did not; fixed).
- The Case advisory (ADR 0064 B8) now speaks from typed ceiling / visibility as well as night; with nothing typed it behaves as
  before.

## Gates

Both unit suites, crc-sync freeze (goldens moved once: `freeze:update`, separate commit; hub goldens move by a hash per connect
because the carrier view is hashed in every connect frame), walk (depth 4), soak:selfcheck (the soak host file moved),
`wire:record` (no surface change), module-graph fixture re-recorded (new modules `carrier-send.js`, `carrier-management-panel.js`),
no-cycle / no-window-globals / html-sinks green, Playwright `l17-carrier.spec.js` only, on `E2E_LANE=3`.
