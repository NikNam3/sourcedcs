# RADIO-SET: the derived radio set, link groups, bands, prefs and the RADIO 2 panel (ADR 0158 step 3)

Branch `lane/RADIO-SET`. ADR: none (0158 covers it). Rulings applied: `docs/parallel/decisions.md` S-RADIO-1 and
S-RADIO-2 (questions RQ9, RQ12 to RQ19 in `docs/parallel/questions-radio.md`), and H183, which keeps the intercom
(it overrides RQ18 on that point).

## What was built

`crc-desktop/app/public/js/radio/`, one job per file, the largest is 165 lines:

| File | Job |
|---|---|
| `bands.js` | VHF 118.000 to 136.975, UHF 225.000 to 399.975, in integer kHz, both edges inclusive (RQ16). A leaf |
| `radio-set.js` | the radios from the staffed Positions, the frequency rows, the guards and the manual radios; the 11 SRS slots (RQ13); the rows outside both bands and the Positions with no row. Pure |
| `link-groups.js` | the automatic group and the controller's groups, one frequency per group, create/rename/delete/move, the PTT target and which radios a PTT keys. Pure, a leaf |
| `radio-prefs.js` | RQ17's one `radio` object: audio per radio identity, groups, membership, manual radios, devices, PTT key, max TX, PTT target, gains, sound set, noise. A leaf with injected storage |
| `radio-prefs-storage.js` | binds it to `settings.js` (`settings.radio`, new in DEFAULTS); first load copies `srs_pref_ptt_key` and `srs_pref_ptt_max_tx_s` |
| `radio-inputs.js` | reads `getSignedOnPositions`/`isObserverAt` (efsp-ws.js) and `getFrequencyRows` (frequency-state.js); copies nothing |
| `device-choice.js` | which device a saved `{ deviceId, label }` means now: id, else label, else the default and a grey note (RQ9). Pure |
| `radio-panel-model.js` | sections, link menu, RX/TX, the grey notes, the engine line, the rebuild key. Pure |
| `radio-panel.js` | the panel: recompute on `snapshot`/`positions` and on every prefs change, rebuild rows only when the key changes, repaint RX/TX in place |
| `radio-row.js`, `link-group-editor.js`, `manual-radio-form.js`, `radio-setup.js` | the panel's DOM, by section |
| `radio-ptt.js` | the panel's PTT controller (RQ12) over `engine.setPtt` |
| `radio-engine-sync.js` | sends the engine only what changed |
| `intercom-unit-select.js` | the intercom's unit picker, ported from `srs-radio.js` `_rebuildIntercomUnitSelect` (H183) |
| `radio-dom.js` | `el()` |
| `radio-engine-stub.js` | the stub engine, deleted at integration |

Also: `crc-sync/src/radio/bands.js`; `css/radio-panel.css`; `#radio-panel` in `index.html`; dock component `radio2`
titled "RADIO 2" (`dock-handle.js` `PANEL_TITLES`, `dock.js`, the PANELS list in `radar-panel.js`). It opens as a tab
beside RADIO when that is open, else as its own bottom strip. It is not in the default layout; RADIO stays the default.

Tests (each run alone with `nice -n 19`, all green): `radio-bands-parity` 4, `radio-set` 30, `radio-prefs` 7,
`radio-device-choice` 4, `radio-intercom` 6, `radio-panel` 8 (wiring against `helpers/dom-stub.js` and the stub
engine). The
`module-graph-exports.json` fixture got the radio modules' export names by script, with nothing else changed. The
module-graph and no-window-globals tests were not run. A script check found the graph still has no cycle and every
file is reachable.

## Defaults taken

- **First UHF row and first VHF row** in table order. "Table order" is the server's row order with shipped rows put
  before added rows (a stable split on `added`).
- **Radio order**, which is also the order that settles the one-frequency rule: Position radios (Facility order, then
  the signed-on order, UHF before VHF), then the guards, then the manual radios. SRS slots go in the order RQ13 gives:
  guards, Positions, manual.
- **Labels.** A Position radio is `<positionId> <row label>`, or just the Position when the row is named after it. The
  guards are `GUARD UHF` and `GUARD VHF`. A manual radio uses its typed label in upper case, else `MANUAL`.
- **The automatic group** has id `AUTO` and is shown as `POSITIONS`. Nobody can rename or delete it, and no user group
  may take that name. User groups have ids `G1`, `G2`…, names of 1 to 12 characters in upper case, A to Z by default,
  then `G27`, `G28`….
- **A guard or manual radio may be put into the automatic group** by hand ("move any radio into one").
- **A radio refused by the one-frequency rule** gets `groupId: null` and `conflict: 'frequency already in group <name>'`
  in amber. The engine treats it as unlinked: tuned, and transmitting alone. Its membership is kept, so it rejoins once
  the other radio leaves. The first radio keeps the frequency.
- **A radio past the 11th slot** gets `conflict: 'no SRS slot (11 in use)'` (`NO_SLOT_CONFLICT`) in grey, with
  `groupId: null`. It may not be the PTT target.
- **Deleting a group** stores `null` (unlinked) for its radios, so a Position radio does not fall back into the
  automatic group.
- **The PTT target** (RQ17): the controller's choice while it can transmit. Otherwise the automatic group's first radio,
  else the first radio that can transmit. This fallback is not saved. A transmission releases on the radio it was keyed
  on, even if the target changes while the key is held.
- **Manual radios** accept what the FREQUENCIES panel accepts (`parseFrequencyInput`: 30 to 400 MHz, on a channel).
  A manual radio outside both bands is kept, and shows `--` as its band. AM and FM are toggled on the row (RQ18).
  Volume is 0 to 5x as before; pan runs from -1 to 1, and a double-click centres it.
- **The engine line is empty when all is well** (dark cockpit). It is amber for no Opus, for an engine `error`, and
  for "radio not connected". The stub always reports "radio engine not joined yet (stub)".
- **SETUP** is a collapsed section in the panel, not the Settings panel's SRS tab (which still belongs to the old
  panel). It holds the microphone (with TEST), input gain, speaker, output gain, the PTT key, the maximum transmit
  time (new: it was a localStorage value with no UI), the TX sound set and the noise.

## The intercom (H183)

- **It is its own radio kind.** `kind: 'INTERCOM'`, identity `INTERCOM`, `modulation: 'INTERCOM'`, `band: null`,
  `mhz: null`. lxsrs tuned it to 100.0 with `IntercomUnitId`; that tuning is the engine's job, not part of the set.
- **There is at most one.** It is added by + INTERCOM and removed by its ✕. Nothing is seeded (RQ19's rule, kept).
  Prefs keep `intercom: { unitId } | null`, where `unitId: null` is the shared, non-DCS intercom (lxsrs's unit 1).
- **It is never linked.**
  - It is in no group, the automatic one included.
  - Its row has the unit picker where the link menu would be, so it cannot be moved anywhere.
  - `moveRadio` stores nothing for it.
  - A stored membership for it is refused in `link-groups.js` with `conflict: 'the intercom is never linked'`
    (`INTERCOM_CONFLICT`), and it stays alone.
  - PTT on it keys the intercom alone, and it may be the PTT target.
- **Slots.** It takes its own SRS slot, counted right after the guards (lxsrs kept it at slot 0).
- **The unit picker.** It lists "shared (non-DCS)" first, then the SRS clients by name, as `Viper 1-1 (ID 42)`. A
  chosen unit that has left SRS stays listed as `ID 42 (not on SRS)`, so a client that drops and reconnects does not
  move the controller off it.

## What the usage guide should say (RADIO 2)

- RADIO 2 shows a radio for each Position you are signed on at: its first UHF frequency and its first VHF frequency
  in the FREQUENCIES panel. It also always shows the two guards, 243.000 and 121.500, and any radios you added.
- The Position radios are linked in POSITIONS. Pressing PTT on any of them transmits on all of them. To take one out,
  choose UNLINK in its link menu. To make groups of your own, use + GROUP; then put radios into a group through their
  link menus. A frequency can be in only one group: a second radio on it is shown in amber and stays unlinked.
- ● marks the radio PTT transmits on, and the whole group of that radio is keyed. Click ○ on another radio to change it.
- At a Position where you are an Observer, its radios are RX ONLY: you hear them, and cannot key or link them.
- A Position with no frequency shows "AP: no frequency (FREQUENCIES panel)". A frequency outside both bands gets no
  radio and is noted in grey.
- Volume, pan and mute belong to the radio, not the frequency, so a retune keeps them.
- + INTERCOM adds the intercom, which is never linked. Choose whose intercom to join in its row: shared, or an SRS
  client by name.

## Findings for RADIO-CORE

- The contract fields RADIO-SET sends: `receiveOnly` on every radio (tune it, never put it in a TX packet), and
  `modulation` `'AM'`, or `'FM'` on a manual radio. The panel calls `setAudioOptions({ inputGain, outputGain,
  soundSet, noise })` when they change, and `testMic()` from SETUP's TEST.
- A radio whose `conflict` is `'no SRS slot (11 in use)'` must not be tuned. A radio with any other conflict is tuned and
  unlinked. Several radios can share one frequency and modulation (with no conflict): one slot, and the RX maps to all
  their ids.
- `setPtt(true, id)` repeats every 400 ms while the key is held (a keepalive), and `setPtt(false, id)` uses the same
  id as the start.
- `setDevices({ inputId, outputId })` gets ids already resolved from the saved `{ deviceId, label }`; null means the
  system default.
- **Contract additions for the intercom (H183):**
  - `kind` gains `'INTERCOM'`, and `modulation` gains `'INTERCOM'`. The intercom radio has `mhz: null`, so tune it as
    the intercom slot.
  - `setIntercomUnit(unitId | null)`: null joins the shared, non-DCS intercom.
  - `onState` gains `srsClients: [{ name, unitId }]`, the SRS client list the old panel read from lxsrs
    (`srs_clients`). The unit picker needs it.
  - The relay (step 4) must never relay the intercom.
- The panel does not rely on `onState` calling back at once (the stub does), but it does rely on `txRadioIds` and
  `rxRadioIds` being complete lists on every call.

## For the supervisor

- **Integration.** In `radio/radio-panel.js`, change `import * as engine from './radio-engine-stub.js'` to
  `./radio-engine.js`, delete the stub, and change `tests/radio-panel.test.mjs`. It reads `_stubInspect` and
  `_stubReceive`, so it needs either a fake engine injected or the engine's own test hooks. Re-record the module-graph
  fixture.
- **The PTT key** is bound only after `setRadioPanelIsClient(true)` (`radio/radio-ptt.js`). Call it from wherever the
  RQ11 `radioClient` choice reaches the renderer. Until then RADIO 2 binds no key, and its PTT button still works.
- **Placement.** `radio2` shares the `bottom` side's remembered size with `radio`, so on its own it opens at RADIO's
  height.
- **Not ported (RQ18):** the old panel hiding itself while disconnected (RADIO 2 says it instead, in the
  engine line); the old green/yellow connection dot (the engine line replaces it). Nothing else is dropped.
- **Open with the human** (S-RADIO-2): only Incirlik GC (275.800) and LC (251.000) have frequency rows today, so at
  most Positions RADIO 2 shows only the guards and the "no frequency" line. Which UHF and VHF rows the shipped
  Positions get is squadron data. `config.json` ships 305.500, which no Position row has: the human may want it as a
  row. No manual radio is seeded (RQ19).
- **Lane rule 9:** no Position id is written in code. Facilities come from `allFacilityIds()` and the frequency rows.
  `DEFAULT_FACILITY_ID` is not used.
